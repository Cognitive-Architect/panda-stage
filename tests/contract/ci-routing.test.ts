import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const {
  classifyChanges,
  loadManifest,
  matchesAny,
  validateRoutingManifest,
} = require('../../scripts/ci-routing.cjs');
const { findFullGreenBaseline } = require('../../scripts/find-full-green-baseline.cjs');
const manifest = loadManifest();
const workflowSource = readFileSync(resolve(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const workflow = yaml.load(workflowSource) as { jobs: Record<string, Record<string, unknown>> };
const change = (file: string, status = 'M') => ({
  status,
  statusToken: status,
  paths: [file],
});
const draft = (changes: ReturnType<typeof change>[], comparisonMode = 'draft-delta') => (
  classifyChanges({
    manifest,
    changes,
    eventName: 'pull_request',
    eventAction: 'synchronize',
    isDraft: true,
    comparisonMode,
  })
);
const ready = (changes: ReturnType<typeof change>[]) => classifyChanges({
  manifest,
  changes,
  eventName: 'pull_request',
  eventAction: 'ready_for_review',
  isDraft: false,
  comparisonMode: 'base',
});

describe('RH-07 FAST Draft policy', () => {
  it.each([
    ['timeline', 'src/renderer/features/timeline/Timeline.tsx', ['timeline']],
    ['dialogue', 'src/renderer/features/dialogue/DialogueTrack.tsx', ['editor', 'timeline']],
    ['subtitles', 'src/renderer/features/subtitles/SubtitleOverlay.tsx', ['canvas', 'timeline']],
  ])('routes isolated %s renderer changes to deterministic targeted suites', (_, file, suites) => {
    const result = draft([change(file)]);
    expect(result.tier).toBe('targeted');
    expect(result.suites).toEqual(suites);
    expect(result.areas).not.toContain('unknown');
  });

  it('unions dialogue and subtitle suites without duplicates', () => {
    const result = draft([
      change('src/renderer/features/dialogue/DialogueTrack.tsx'),
      change('src/renderer/features/subtitles/SubtitleOverlay.tsx'),
    ]);
    expect(result.tier).toBe('targeted');
    expect(result.suites).toEqual(['editor', 'timeline', 'canvas']);
  });

  it('keeps approved Markdown on the docs fast path', () => {
    expect(draft([change('docs/ci-routing.md')]).tier).toBe('docs');
  });

  it.each([
    '.github/workflows/ci.yml',
    'scripts/ci-routing.cjs',
    'scripts/ci-provenance.cjs',
    'scripts/verification-manifest.json',
    'tests/contract/ci-routing.test.ts',
    'tests/contract/ci-provenance.test.ts',
  ])('routes Draft CI mechanics %s to self-test, never Full', (file) => {
    const result = draft([change(file)]);
    expect(result.tier).toBe('ci-selftest');
    expect(result.suites).toEqual([]);
  });

  it.each([
    'src/domain/services/DialogueService.ts',
    'src/shared/project-contract.ts',
    'src/main/export/ExportService.ts',
    'src/preload/index.ts',
    'src/renderer/stores/editorProjectStore.ts',
    'build/installer.yml',
    'tests/contract/fixtures/ci-routing/core/focused-probe.ts',
  ])('routes Draft core/release path %s to focused checks, never Full', (file) => {
    const result = draft([change(file)]);
    expect(result.tier).toBe('focused');
    expect(result.suites).toEqual([]);
  });

  it('combines CI self-tests with manifest-selected renderer suites without Full', () => {
    const result = draft([
      change('.github/workflows/ci.yml'),
      change('src/renderer/features/dialogue/DialogueTrack.tsx'),
    ]);
    expect(result.tier).toBe('focused');
    expect(result.suites).toEqual(['editor', 'timeline']);
  });

  it('fails an unknown production path fast with actionable ownership guidance', () => {
    const result = draft([change('src/renderer/features/unowned-new/Widget.tsx', 'A')]);
    expect(result.tier).toBe('unknown');
    expect(result.reason).toContain('Unknown production route');
    expect(result.reason).toContain('verification manifest');
    expect(result.unknownPaths).toEqual(['src/renderer/features/unowned-new/Widget.tsx']);
  });

  it.each([
    'tests/helpers/fla-structural-probe.ts',
    'tests/integration/fla-b0-structural-probe.test.ts',
  ])('routes V1.5-B0 FLA probe path %s into the existing fla-import targeted route', (file) => {
    const result = draft([change(file)]);
    expect(result.tier).toBe('targeted');
    expect(result.areas).not.toContain('unknown');
    expect(result.matchedRouteIds).toContain('fla-import');
    expect(result.suites).toEqual(['assets']);
  });

  it('keeps both V1.5-B0 FLA probe paths on the fla-import targeted route together, never Full', () => {
    const result = draft([
      change('tests/helpers/fla-structural-probe.ts'),
      change('tests/integration/fla-b0-structural-probe.test.ts'),
    ]);
    expect(result.tier).toBe('targeted');
    expect(result.areas).not.toContain('unknown');
    expect(result.matchedRouteIds).toEqual(['fla-import']);
    expect(result.areas).toEqual(['fla-import']);
  });

  it.each([
    'tests/unit/fla-derive-structure-summary.test.ts',
    'tests/integration/fla-b1-structural-fields.test.ts',
  ])('routes V1.5-B1 FLA evidence path %s into the fla-import targeted route', (file) => {
    const result = draft([change(file)]);
    expect(result.tier).toBe('targeted');
    expect(result.areas).not.toContain('unknown');
    expect(result.matchedRouteIds).toEqual(['fla-import']);
    expect(result.areas).toEqual(['fla-import']);
    expect(result.suites).toEqual(['assets']);
  });

  it('routes V1.5-B1 production source into the fla-import targeted route (B0 evidence + B1 contract)', () => {
    const result = draft([
      change('src/renderer/fla-import/derive-fla-structure-summary.ts'),
      change('src/renderer/fla-import/fla-viewer-adapter.ts'),
      change('src/renderer/fla-import/FlaCompatibilityReviewSession.tsx'),
    ]);
    expect(result.tier).toBe('targeted');
    expect(result.areas).toEqual(['fla-import']);
    expect(result.matchedRouteIds).toEqual(['fla-import']);
  });

  it('promotes to focused when a B1 change also touches the shared contract (expected cross-process propagation)', () => {
    const result = draft([
      change('src/renderer/fla-import/derive-fla-structure-summary.ts'),
      change('src/renderer/fla-import/fla-viewer-adapter.ts'),
      change('src/renderer/fla-import/FlaCompatibilityReviewSession.tsx'),
      change('src/shared/fla-import-api.ts'),
    ]);
    expect(result.tier).toBe('focused');
    expect(result.areas).toContain('fla-import');
    expect(result.areas).toContain('cross-process-core');
    expect(result.matchedRouteIds).toContain('fla-import');
    expect(result.matchedRouteIds).toContain('cross-process-core');
  });

  it('does not let the B0 registration absorb unrelated unknown test paths', () => {
    const result = draft([change('tests/integration/fla-b1-unregistered-spike.test.ts', 'A')]);
    expect(result.tier).toBe('unknown');
    expect(result.unknownPaths).toEqual(['tests/integration/fla-b1-unregistered-spike.test.ts']);
  });

  it('does not let the B1 registration absorb still-future V1.5-D test paths', () => {
    const result = draft([change('tests/integration/fla-d-corpus-extension.test.ts', 'A')]);
    expect(result.tier).toBe('unknown');
    expect(result.unknownPaths).toEqual(['tests/integration/fla-d-corpus-extension.test.ts']);
  });

  it.each(['D', 'R', 'C'])('routes %s structural changes to focused safety checks', (status) => {
    const paths = ['R', 'C'].includes(status)
      ? ['src/renderer/features/dialogue/Old.tsx', 'src/renderer/features/dialogue/New.tsx']
      : ['src/renderer/features/dialogue/Old.tsx'];
    const result = draft([{ status, statusToken: status, paths }]);
    expect(result.tier).toBe('focused');
    expect(result.areas).toContain('structural-change');
  });

  it('fails fast when a Draft comparison range is unavailable', () => {
    const result = classifyChanges({
      manifest,
      changes: [],
      eventName: 'pull_request',
      eventAction: 'synchronize',
      isDraft: true,
      comparisonMode: 'unavailable',
    });
    expect(result.tier).toBe('unknown');
  });
});

describe('RH-07 FULL delivery policy', () => {
  it.each([
    'src/renderer/features/dialogue/DialogueTrack.tsx',
    'src/domain/services/DialogueService.ts',
    '.github/workflows/ci.yml',
  ])('forces Ready candidate path %s to complete Full', (file) => {
    const result = ready([change(file)]);
    expect(result.tier).toBe('full');
    expect(result.suites).toEqual(manifest.routing.fullRegressionSuites);
    expect(result.comparisonMode).toBe('base');
  });

  it('forces a synchronize on an already-Ready PR to Full for the changed candidate', () => {
    const result = classifyChanges({
      manifest,
      changes: [change('src/renderer/features/dialogue/DialogueTrack.tsx')],
      eventName: 'pull_request',
      eventAction: 'synchronize',
      isDraft: false,
      comparisonMode: 'base',
    });
    expect(result.tier).toBe('full');
  });

  it('keeps workflow_dispatch explicitly Full', () => {
    expect(classifyChanges({
      manifest,
      changes: [],
      eventName: 'workflow_dispatch',
      isDraft: false,
    }).tier).toBe('full');
  });

  it('uses provenance only for a proven main merge and otherwise falls back Full', () => {
    expect(classifyChanges({
      manifest,
      eventName: 'push',
      isDraft: false,
      provenance: { proven: true, reason: 'exact tree proof' },
    }).tier).toBe('provenance');
    expect(classifyChanges({
      manifest,
      eventName: 'push',
      isDraft: false,
      provenance: { proven: false, reason: 'tree mismatch' },
    }).tier).toBe('full');
  });
});

describe('RH-07 workflow and manifest contracts', () => {
  it('parses the workflow YAML and declares all FAST/FULL/VERIFY jobs', () => {
    expect(Object.keys(workflow.jobs)).toEqual(expect.arrayContaining([
      'classify',
      'quality_docs',
      'quality_ci_selftest',
      'quality_focused',
      'quality_targeted',
      'quality_unknown',
      'quality_full',
      'ready_proof',
      'quality_provenance',
      'quality',
    ]));
  });

  it('keeps Draft CI self-test and delivery Full jobs on mutually exclusive tiers', () => {
    const ciSelftestCondition = String(workflow.jobs.quality_ci_selftest?.if);
    const fullCondition = String(workflow.jobs.quality_full?.if);
    expect(ciSelftestCondition).toContain("tier == 'ci-selftest'");
    expect(fullCondition).toContain("tier == 'full'");
    expect(ciSelftestCondition).not.toContain("tier == 'full'");
  });

  it('uses event before only for Draft synchronize and complete base for Ready', () => {
    expect(workflowSource).toContain('"$IS_DRAFT" == true && "$EVENT_ACTION" == synchronize');
    expect(workflowSource).toContain('echo "base_sha=$EVENT_BEFORE_SHA"');
    expect(workflowSource).toContain('echo "base_sha=$PR_BASE_SHA"');
    expect(workflowSource).toContain('EVENT_ACTION: ${{ github.event.action }}');
  });

  it('keeps Final stable and requires Ready proof for a non-draft Full', () => {
    expect(workflowSource).toContain('name: Final CI result');
    expect(workflowSource).toContain('name: Ready candidate proof');
    expect(workflowSource).toContain('node scripts/ci-provenance.cjs record-ready');
    expect(workflowSource).toContain('[[ "$READY_PROOF_RESULT" == success ]]');
  });

  it('does not embed renderer subsystem names in workflow control flow', () => {
    for (const subsystem of ['dialogue', 'subtitles', 'timeline', 'canvas']) {
      expect(workflowSource).not.toMatch(new RegExp(`tier.*${subsystem}|${subsystem}.*tier`, 'iu'));
    }
  });

  it('validates the RH-07 manifest schema and focused Draft policies', () => {
    expect(manifest.routing.schemaVersion).toBe(2);
    expect(validateRoutingManifest(manifest)).toEqual([]);
    for (const route of manifest.routing.fullRiskRoutes) {
      expect(['focused', 'ci-selftest']).toContain(route.draftPolicy);
    }
  });

  it('detects an invalid Full-risk route without a focused Draft policy', () => {
    const fixture = structuredClone(manifest);
    delete fixture.routing.fullRiskRoutes[0].draftPolicy;
    expect(validateRoutingManifest(fixture)).toContain(
      `full route ${fixture.routing.fullRiskRoutes[0].id} must declare a focused Draft policy`,
    );
  });

  it('covers every current first-party renderer feature directory', () => {
    const directories = readdirSync(resolve(root, 'src', 'renderer', 'features'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(validateRoutingManifest(manifest, directories)).toEqual([]);
  });

  it('detects a newly introduced renderer feature without a route', () => {
    expect(validateRoutingManifest(manifest, ['hypothetical-new-subsystem'])).toContain(
      'renderer feature directory has no declared route: hypothetical-new-subsystem',
    );
  });

  it('registers a hypothetical subsystem through manifest data only', () => {
    const fixture = structuredClone(manifest);
    fixture.routing.routes.push({
      id: 'hypothetical',
      sourcePatterns: ['src/renderer/features/hypothetical/**'],
      testPatterns: ['tests/unit/hypothetical-*.test.ts'],
      verifierPatterns: [],
      suites: ['editor'],
      riskPolicy: 'targeted',
      incrementalEligible: true,
      owner: 'fixture',
      notes: 'Contract fixture only; no production path is declared.',
    });
    expect(classifyChanges({
      manifest: fixture,
      changes: [change('src/renderer/features/hypothetical/View.tsx', 'A')],
      eventName: 'pull_request',
      eventAction: 'synchronize',
      isDraft: true,
    })).toMatchObject({ tier: 'targeted', suites: ['editor'] });
  });

  it('detects nonexistent suite references', () => {
    const fixture = structuredClone(manifest);
    fixture.routing.routes[0].suites = ['does-not-exist'];
    expect(validateRoutingManifest(fixture)).toContain(
      `route ${fixture.routing.routes[0].id} references non-executable suite does-not-exist`,
    );
  });

  it('keeps every active verifier file associated with a declared route', () => {
    const pkg = require('../../package.json') as { scripts: Record<string, string> };
    const routes = [...manifest.routing.fullRiskRoutes, ...manifest.routing.routes] as Array<{
      verifierPatterns: string[];
    }>;
    const gates = manifest.gates as Array<{ status: string; script: string }>;
    const unowned: string[] = [];
    for (const gate of gates.filter((entry) => entry.status === 'active')) {
      const files = [...(pkg.scripts[gate.script] ?? '').matchAll(/scripts\/(verify-[a-zA-Z0-9_-]+\.cjs)/g)]
        .map((match) => `scripts/${match[1]}`);
      for (const file of files) {
        if (!routes.some((route) => matchesAny(file, route.verifierPatterns))) {
          unowned.push(`${gate.script}: ${file}`);
        }
      }
    }
    expect(unowned).toEqual([]);
  });
});

describe('RH-05 legacy incremental baseline helper remains fail-safe', () => {
  const baseInput = {
    repository: 'owner/repo',
    pullRequestNumber: 230,
    headRef: 'agent/rh-07-ci-policy',
    currentHead: 'head-b',
    token: 'test-token',
    isAncestor: (candidate: string) => candidate === 'head-a',
  };
  const response = (body: unknown) => ({ ok: true, json: async () => body });
  const fullGreenJobs = {
    jobs: [
      { name: 'Classify change risk', conclusion: 'success' },
      { name: 'Full quality and regression', conclusion: 'success' },
      { name: 'Final CI result', conclusion: 'success' },
    ],
  };

  it('accepts only an ancestor HEAD from the same PR with successful Full and final jobs', async () => {
    const fetchImpl = async (url: string) => url.includes('/runs?')
      ? response({ workflow_runs: [{
          id: 99,
          head_sha: 'head-a',
          conclusion: 'success',
          pull_requests: [{ number: 230 }],
          jobs_url: 'https://jobs/99',
          html_url: 'https://run/99',
        }] })
      : response(fullGreenJobs);
    await expect(findFullGreenBaseline({ ...baseInput, fetchImpl })).resolves.toMatchObject({
      sha: 'head-a',
      runId: 99,
    });
  });

  it('rejects a Full result belonging to a different PR', async () => {
    const fetchImpl = async (url: string) => url.includes('/runs?')
      ? response({ workflow_runs: [{
          id: 98,
          head_sha: 'head-a',
          conclusion: 'success',
          pull_requests: [{ number: 225 }],
          jobs_url: 'https://jobs/98',
        }] })
      : response(fullGreenJobs);
    await expect(findFullGreenBaseline({ ...baseInput, fetchImpl })).resolves.toBeNull();
  });
});
