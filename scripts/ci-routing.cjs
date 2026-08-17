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
  if (!routing || routing.schemaVersion !== 1) {
    return ['routing.schemaVersion must be 1'];
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

function classifyChanges({ manifest, changes, eventName, isDraft, comparisonMode = 'base' }) {
  const routing = manifest.routing;
  const allRoutes = [...routing.fullRiskRoutes, ...routing.routes];
  const matchedRoutes = [];
  const areas = [];
  const suites = [];
  let docsOnly = true;
  let full = false;
  let unknown = false;
  let unsafeStatus = false;

  if (eventName === 'push') {
    return {
      tier: 'full',
      reason: 'push to main keeps the full regression path',
      areas: ['infra'],
      suites: fullSuiteIds(manifest),
      comparisonMode: 'event',
    };
  }
  if (eventName === 'workflow_dispatch') {
    return {
      tier: 'full',
      reason: 'manual dispatch explicitly requests the full regression path',
      areas: ['infra'],
      suites: fullSuiteIds(manifest),
      comparisonMode: 'event',
    };
  }
  if (!changes || changes.length === 0) {
    return {
      tier: 'full',
      reason: 'changed-file list unavailable; fail safe to full regression',
      areas: ['unknown'],
      suites: fullSuiteIds(manifest),
      comparisonMode,
    };
  }

  for (const change of changes) {
    if (!['A', 'M'].includes(change.status)) {
      unsafeStatus = true;
      full = true;
    }
    for (const filePath of change.paths) {
      if (matchesAny(filePath, routing.docsPatterns)) continue;
      docsOnly = false;
      const field = routePatternField(filePath);
      const route = allRoutes.find((candidate) => matchesAny(filePath, candidate[field]));
      if (!route) {
        unknown = true;
        full = true;
        areas.push('unknown');
        continue;
      }
      matchedRoutes.push(route);
      areas.push(route.id);
      suites.push(...route.suites);
      if (route.riskPolicy === 'full') full = true;
      if (comparisonMode === 'incremental' && !route.incrementalEligible) full = true;
    }
  }

  let reason;
  if (unknown) reason = 'unknown path changed; fail safe to full regression';
  else if (unsafeStatus) reason = 'rename, copy, delete, or unsupported change status; fail safe to full regression';
  else if (full) reason = 'full-escalation route changed';
  else if (docsOnly) reason = 'all changed files are approved Markdown documentation files';
  else if (!isDraft) {
    full = true;
    reason = 'non-draft PR requires full regression';
  } else if (comparisonMode === 'incremental') {
    reason = 'Draft PR uses targeted incremental regression from a proven same-PR Full-green HEAD';
  } else {
    reason = 'Draft PR uses targeted subsystem regression';
  }

  return {
    tier: docsOnly && !full ? 'docs' : full ? 'full' : 'targeted',
    reason,
    areas: unique(areas),
    suites: full ? fullSuiteIds(manifest) : unique(suites),
    comparisonMode,
    matchedRouteIds: unique(matchedRoutes.map((route) => route.id)),
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
  ];
  if (process.env.GITHUB_OUTPUT) {
    require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
  console.log(`Risk tier: ${result.tier}`);
  console.log(`Reason: ${result.reason}`);
  console.log(`Comparison: ${result.comparisonMode}`);
  console.log(`Areas: ${result.areas.join(' ')}`);
  console.log(`Suites: ${result.suites.join(' ')}`);
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
  const isDraft = process.env.IS_DRAFT === 'true';
  const head = process.env.HEAD_SHA;
  const base = process.env.INCREMENTAL_BASE_SHA || process.env.BASE_SHA;
  const comparisonMode = process.env.INCREMENTAL_BASE_SHA ? 'incremental' : 'base';
  let changes;
  if (eventName !== 'push' && eventName !== 'workflow_dispatch') {
    if (!base || !head || /^0+$/.test(base)) {
      writeGithubOutput({
        tier: 'full', reason: 'comparison range unavailable; fail safe to full regression',
        areas: ['unknown'], suites: fullSuiteIds(manifest), comparisonMode: 'unavailable',
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
  writeGithubOutput(classifyChanges({ manifest, changes, eventName, isDraft, comparisonMode }));
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
