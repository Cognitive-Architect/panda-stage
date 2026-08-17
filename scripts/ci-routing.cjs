const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'scripts', 'verification-manifest.json');

function loadManifest(file = manifestPath) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function globToRegExp(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

function matchesAny(filePath, patterns = []) {
  const normalized = filePath.replaceAll('\\', '/');
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

function routePatternField(filePath) {
  if (filePath.startsWith('tests/')) return 'testPatterns';
  if (filePath.startsWith('scripts/verify-')) return 'verifierPatterns';
  return 'sourcePatterns';
}

function unique(values) {
  return [...new Set(values)];
}

function fullSuiteIds(manifest) {
  return [...manifest.routing.fullRegressionSuites];
}

function validateRoutingManifest(manifest, featureDirectories = []) {
  const errors = [];
  const routing = manifest.routing;
  if (!routing || routing.schemaVersion !== 2) {
    return ['routing.schemaVersion must be 2'];
  }

  const gateById = new Map(manifest.gates.map((gate) => [gate.id, gate]));
  const allRoutes = [...routing.fullRiskRoutes, ...routing.routes];
  const routeIds = allRoutes.map((route) => route.id);
  if (new Set(routeIds).size !== routeIds.length) errors.push('routing route ids must be unique');

  for (const route of allRoutes) {
    for (const field of ['sourcePatterns', 'testPatterns', 'verifierPatterns', 'suites']) {
      if (!Array.isArray(route[field])) errors.push(`route ${route.id} must declare ${field}`);
    }
    if (!['targeted', 'full'].includes(route.riskPolicy)) {
      errors.push(`route ${route.id} has invalid riskPolicy ${route.riskPolicy}`);
    }
    if (route.riskPolicy === 'full' && !['focused', 'ci-selftest'].includes(route.draftPolicy)) {
      errors.push(`full route ${route.id} must declare a focused Draft policy`);
    }
    if (route.riskPolicy === 'targeted' && route.draftPolicy) {
      errors.push(`targeted route ${route.id} must not override its Draft policy`);
    }
    if (typeof route.incrementalEligible !== 'boolean') {
      errors.push(`route ${route.id} must declare incrementalEligible`);
    }
    if (!route.owner || !route.notes) errors.push(`route ${route.id} must declare owner and notes`);
    if (route.riskPolicy === 'full' && route.incrementalEligible) {
      errors.push(`full route ${route.id} cannot be incrementally eligible`);
    }
    for (const suite of route.suites) {
      const gate = gateById.get(suite);
      if (!gate || gate.status !== 'active' || gate.script !== `verify:${suite}`) {
        errors.push(`route ${route.id} references non-executable suite ${suite}`);
      }
    }
    if (route.riskPolicy === 'targeted' && route.suites.length === 0) {
      errors.push(`targeted route ${route.id} must select at least one suite`);
    }
  }

  for (const suite of routing.fullRegressionSuites) {
    const gate = gateById.get(suite);
    if (!gate || gate.status !== 'active' || gate.script !== `verify:${suite}`) {
      errors.push(`full regression references non-executable suite ${suite}`);
    }
  }

  for (const directory of featureDirectories) {
    const probe = `src/renderer/features/${directory}/__route_probe__.tsx`;
    const declared = allRoutes.some((route) => matchesAny(probe, route.sourcePatterns));
    if (!declared) errors.push(`renderer feature directory has no declared route: ${directory}`);
  }

  return errors;
}

function classifyChanges({
  manifest,
  changes,
  eventName,
  eventAction,
  isDraft,
  comparisonMode = 'base',
  provenance,
}) {
  const routing = manifest.routing;
  const allRoutes = [...routing.fullRiskRoutes, ...routing.routes];
  const matchedRoutes = [];
  const areas = [];
  const suites = [];
  let docsOnly = true;
  let unknown = false;
  let unsafeStatus = false;
  const unknownPaths = [];

  if (eventName === 'push') {
    if (provenance?.proven) {
      return {
        tier: 'provenance',
        reason: provenance.reason,
        areas: ['delivery-provenance'],
        suites: [],
        comparisonMode: 'provenance',
        unknownPaths: [],
      };
    }
    return {
      tier: 'full',
      reason: provenance?.reason || 'untrusted push to main requires full regression',
      areas: ['infra'],
      suites: fullSuiteIds(manifest),
      comparisonMode: 'event',
      unknownPaths: [],
    };
  }
  if (eventName === 'workflow_dispatch') {
    return {
      tier: 'full',
      reason: 'manual dispatch explicitly requests the full regression path',
      areas: ['infra'],
      suites: fullSuiteIds(manifest),
      comparisonMode: 'event',
      unknownPaths: [],
    };
  }
  if (!changes || changes.length === 0) {
    return {
      tier: isDraft ? 'unknown' : 'full',
      reason: isDraft
        ? 'Draft comparison is unavailable; fix the comparison before continuing'
        : 'changed-file list unavailable; fail safe to full regression',
      areas: ['unknown'],
      suites: isDraft ? [] : fullSuiteIds(manifest),
      comparisonMode,
      unknownPaths: [],
    };
  }

  for (const change of changes) {
    if (!['A', 'M'].includes(change.status)) {
      unsafeStatus = true;
    }
    for (const filePath of change.paths) {
      if (matchesAny(filePath, routing.docsPatterns)) continue;
      docsOnly = false;
      const field = routePatternField(filePath);
      const route = allRoutes.find((candidate) => matchesAny(filePath, candidate[field]));
      if (!route) {
        unknown = true;
        areas.push('unknown');
        unknownPaths.push(filePath);
        continue;
      }
      matchedRoutes.push(route);
      areas.push(route.id);
      suites.push(...route.suites);
    }
  }

  if (unknown) {
    return {
      tier: 'unknown',
      reason: `Unknown production route: ${unknownPaths.join(', ')}. Register ownership and risk policy in the verification manifest.`,
      areas: unique(areas),
      suites: [],
      comparisonMode,
      matchedRouteIds: unique(matchedRoutes.map((route) => route.id)),
      unknownPaths: unique(unknownPaths),
    };
  }

  if (!isDraft || eventAction === 'ready_for_review') {
    return {
      tier: 'full',
      reason: 'Ready/non-draft candidate requires complete base-to-HEAD Full regression',
      areas: unique(areas),
      suites: fullSuiteIds(manifest),
      comparisonMode: 'base',
      matchedRouteIds: unique(matchedRoutes.map((route) => route.id)),
      unknownPaths: [],
    };
  }

  if (unsafeStatus) {
    return {
      tier: 'focused',
      reason: 'Draft rename, copy, delete, or unsupported status requires focused safety checks',
      areas: unique([...areas, 'structural-change']),
      suites: [],
      comparisonMode,
      matchedRouteIds: unique(matchedRoutes.map((route) => route.id)),
      unknownPaths: [],
    };
  }

  if (docsOnly) {
    return {
      tier: 'docs',
      reason: 'all changed files are approved Markdown documentation files',
      areas: [],
      suites: [],
      comparisonMode,
      matchedRouteIds: [],
      unknownPaths: [],
    };
  }

  const draftPolicies = matchedRoutes.map((route) => (
    route.riskPolicy === 'targeted' ? 'targeted' : route.draftPolicy
  ));
  const tier = draftPolicies.includes('focused') || (
    draftPolicies.includes('ci-selftest') && draftPolicies.includes('targeted')
  )
    ? 'focused'
    : draftPolicies.includes('ci-selftest')
      ? 'ci-selftest'
      : 'targeted';
  const reasons = {
    focused: 'Draft core/release change uses focused development checks without Full regression',
    'ci-selftest': 'Draft CI mechanics change uses focused CI self-tests without Full regression',
    targeted: 'Draft renderer/business change uses manifest-selected targeted suites',
  };
  return {
    tier,
    reason: reasons[tier],
    areas: unique(areas),
    suites: ['targeted', 'focused'].includes(tier) ? unique(suites) : [],
    comparisonMode,
    matchedRouteIds: unique(matchedRoutes.map((route) => route.id)),
    unknownPaths: [],
  };
}

function parseNameStatus(raw) {
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\t');
      const statusToken = fields.shift();
      const status = statusToken[0];
      return { status, statusToken, paths: fields };
    });
}

function writeGithubOutput(result) {
  const lines = [
    `tier=${result.tier}`,
    `reason=${result.reason}`,
    `areas=${result.areas.join(' ')}`,
    `suites=${result.suites.join(' ')}`,
    `comparison_mode=${result.comparisonMode}`,
    `unknown_paths=${(result.unknownPaths || []).join('|')}`,
  ];
  if (process.env.GITHUB_OUTPUT) {
    require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
  console.log(`Risk tier: ${result.tier}`);
  console.log(`Reason: ${result.reason}`);
  console.log(`Comparison: ${result.comparisonMode}`);
  console.log(`Areas: ${result.areas.join(' ')}`);
  console.log(`Suites: ${result.suites.join(' ')}`);
  if (result.unknownPaths?.length) console.log(`Unknown paths: ${result.unknownPaths.join(', ')}`);
}

function runCli() {
  const command = process.argv[2];
  const manifest = loadManifest();
  if (command === 'full-suites') {
    console.log(fullSuiteIds(manifest).join(' '));
    return;
  }
  if (command !== 'classify') throw new Error(`Unknown command: ${command}`);

  const eventName = process.env.EVENT_NAME;
  const eventAction = process.env.EVENT_ACTION;
  const isDraft = process.env.IS_DRAFT === 'true';
  const head = process.env.HEAD_SHA;
  const base = process.env.BASE_SHA;
  const comparisonMode = process.env.COMPARISON_MODE || 'base';
  const provenance = eventName === 'push'
    ? {
        proven: process.env.PROVENANCE_VERIFIED === 'true',
        reason: process.env.PROVENANCE_REASON || 'main provenance was not verified',
      }
    : undefined;
  let changes;
  if (eventName !== 'push' && eventName !== 'workflow_dispatch') {
    if (!base || !head || /^0+$/.test(base)) {
      writeGithubOutput({
        tier: isDraft ? 'unknown' : 'full',
        reason: isDraft
          ? 'Draft comparison range unavailable; fix the comparison before continuing'
          : 'comparison range unavailable; fail safe to full regression',
        areas: ['unknown'], suites: isDraft ? [] : fullSuiteIds(manifest),
        comparisonMode: 'unavailable', unknownPaths: [],
      });
      return;
    }
    try {
      const raw = execFileSync('git', ['diff', '--name-status', '--find-renames', base, head], {
        cwd: root, encoding: 'utf8',
      });
      changes = parseNameStatus(raw);
      for (const change of changes) {
        console.log(`Changed path [${change.statusToken}]: ${change.paths.join(' -> ')}`);
      }
    } catch {
      changes = [];
    }
  }
  writeGithubOutput(classifyChanges({
    manifest,
    changes,
    eventName,
    eventAction,
    isDraft,
    comparisonMode,
    provenance,
  }));
}

if (require.main === module) runCli();

module.exports = {
  classifyChanges,
  fullSuiteIds,
  globToRegExp,
  loadManifest,
  matchesAny,
  parseNameStatus,
  validateRoutingManifest,
};
