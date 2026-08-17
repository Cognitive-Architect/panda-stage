import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const { classifyChanges, loadManifest, matchesAny, validateRoutingManifest } = require('../../scripts/ci-routing.cjs');
const { findFullGreenBaseline } = require('../../scripts/find-full-green-baseline.cjs');
const manifest = loadManifest();
const workflow = readFileSync(resolve(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const change = (file: string, status = 'M') => ({ status, statusToken: status, paths: [file] });
const draft = (changes: ReturnType<typeof change>[], comparisonMode = 'base') =>
  classifyChanges({ manifest, changes, eventName: 'pull_request', isDraft: true, comparisonMode });

describe('RH-05 manifest-backed CI routing', () => {
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

  it.each([
    'src/domain/services/DialogueService.ts',
    'src/shared/project-contract.ts',
    'src/main/export/ExportService.ts',
    'src/preload/index.ts',
    'src/renderer/stores/editorProjectStore.ts',
  ])('keeps core path %s on Full', (file) => {
    expect(draft([change(file)]).tier).toBe('full');
  });

  it('fails unknown production paths safe to Full', () => {
    const result = draft([change('src/renderer/new-unowned-area/Widget.tsx', 'A')]);
    expect(result.tier).toBe('full');
    expect(result.areas).toContain('unknown');
  });

  it.each(['D', 'R'])('fails %s status safe to Full', (status) => {
    const paths = status === 'R'
      ? ['src/renderer/features/dialogue/Old.tsx', 'src/renderer/features/dialogue/New.tsx']
      : ['src/renderer/features/dialogue/Old.tsx'];
    expect(draft([{ status, statusToken: status, paths }]).tier).toBe('full');
  });

  it('forces otherwise-targeted non-draft PRs to Full', () => {
    const result = classifyChanges({
      manifest,
      changes: [change('src/renderer/features/dialogue/DialogueTrack.tsx')],
      eventName: 'pull_request',
      isDraft: false,
      comparisonMode: 'base',
    });
    expect(result.tier).toBe('full');
    expect(result.reason).toContain('non-draft');
  });

  it.each(['push', 'workflow_dispatch'])('forces %s to Full', (eventName) => {
    expect(classifyChanges({ manifest, changes: [], eventName, isDraft: false }).tier).toBe('full');
  });

  it('allows a narrow eligible delta after a proven baseline', () => {
    const result = draft([change('src/renderer/features/dialogue/DialogueTrack.tsx')], 'incremental');
    expect(result.tier).toBe('targeted');
    expect(result.comparisonMode).toBe('incremental');
  });

  it('keeps a Full-risk incremental delta on Full', () => {
    expect(draft([change('src/domain/services/DialogueService.ts')], 'incremental').tier).toBe('full');
  });

  it('uses the proven incremental baseline consistently in the docs job', () => {
    const docsJob = workflow.split('  quality_docs:')[1]?.split('  quality_targeted:')[0] ?? '';
    expect(docsJob).toContain(
      'BASE_SHA: ${{ needs.classify.outputs.incremental_baseline || github.event.pull_request.base.sha }}',
    );
    expect(docsJob.match(/BASE_SHA:/gu)).toHaveLength(1);
    expect(docsJob.match(/HEAD_SHA:/gu)).toHaveLength(1);
  });

  it('routes owned Day28 test-only changes and fails unowned tests safe to Full', () => {
    expect(draft([change('tests/unit/dialogue-gesture.test.ts')]).tier).toBe('targeted');
    expect(draft([change('tests/e2e/future-workflow.test.ts', 'A')]).tier).toBe('full');
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
    const result = classifyChanges({
      manifest: fixture,
      changes: [change('src/renderer/features/hypothetical/View.tsx', 'A')],
      eventName: 'pull_request',
      isDraft: true,
      comparisonMode: 'base',
    });
    expect(result.tier).toBe('targeted');
    expect(result.suites).toEqual(['editor']);
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

describe('RH-05 incremental baseline proof', () => {
  const baseInput = {
    repository: 'owner/repo',
    pullRequestNumber: 225,
    headRef: 'agent/rh-05-ci-routing',
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
          id: 99, run_number: 9, head_sha: 'head-a', conclusion: 'success',
          pull_requests: [{ number: 225 }], jobs_url: 'https://jobs/99', html_url: 'https://run/99',
        }] })
      : response(fullGreenJobs);
    await expect(findFullGreenBaseline({ ...baseInput, fetchImpl })).resolves.toMatchObject({
      sha: 'head-a', runId: 99,
    });
  });

  it.each([
    ['different PR', [{ number: 224 }], fullGreenJobs],
    ['missing Full job', [{ number: 225 }], { jobs: fullGreenJobs.jobs.filter((job) => !job.name.startsWith('Full')) }],
  ])('rejects an untrusted baseline: %s', async (_, pullRequests, jobs) => {
    const fetchImpl = async (url: string) => url.includes('/runs?')
      ? response({ workflow_runs: [{
          id: 98, run_number: 8, head_sha: 'head-a', conclusion: 'success',
          pull_requests: pullRequests, jobs_url: 'https://jobs/98', html_url: 'https://run/98',
        }] })
      : response(jobs);
    await expect(findFullGreenBaseline({ ...baseInput, fetchImpl })).resolves.toBeNull();
  });

  it('rejects a successful same-PR run whose HEAD is not an ancestor', async () => {
    const fetchImpl = async (url: string) => url.includes('/runs?')
      ? response({ workflow_runs: [{
          id: 97, run_number: 7, head_sha: 'side-branch', conclusion: 'success',
          pull_requests: [{ number: 225 }], jobs_url: 'https://jobs/97', html_url: 'https://run/97',
        }] })
      : response(fullGreenJobs);
    await expect(findFullGreenBaseline({ ...baseInput, fetchImpl })).resolves.toBeNull();
  });
});
