import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { selectSubsystems } = require('../../scripts/ci-routing.cjs');
const yaml = require('js-yaml');
const manifest = JSON.parse(readFileSync('scripts/verification-manifest.json', 'utf8'));
const workflow = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8'));
const full = yaml.load(readFileSync('.github/workflows/full-ci.yml', 'utf8'));

describe('CI-LEAN-01', () => {
  it('keeps one Core with all quality commands, selected regression and a stable final check', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['core', 'final']);
    const commands = workflow.jobs.core.steps.map((step: { run?: string }) => step.run).filter(Boolean).join('\n');
    for (const command of ['git diff --check', 'pnpm typecheck', 'pnpm lint', 'pnpm test:unit', 'pnpm test:integration', 'pnpm build']) expect(commands).toContain(command);
    expect(workflow.jobs.final.needs).toBe('core');
    expect(workflow.jobs.final.name).toBe('Final CI result');
    expect(workflow.jobs.core.steps.filter((step: { run?: string }) => step.run === 'pnpm install --frozen-lockfile')).toHaveLength(1);
  });
  it('cancels superseded PR runs and keeps Full manual', () => {
    expect(workflow.concurrency).toEqual({ group: 'ci-${{ github.ref }}', 'cancel-in-progress': "${{ github.ref != 'refs/heads/main' }}" });
    expect(Object.keys(full.on)).toEqual(['workflow_dispatch']);
    expect(full.jobs.full.steps.some((step: { run?: string }) => step.run?.includes('full-suites'))).toBe(true);
  });
  it('maps known paths to all relevant suites, deduplicates, and keeps unknown paths non-blocking', () => {
    expect(selectSubsystems(['src/renderer/features/canvas/CanvasStage.tsx', 'src/renderer/features/assets/AssetCard.tsx']).suites).toEqual(['canvas', 'history', 'assets', 'character']);
    expect(selectSubsystems(['new/unknown.ts'])).toEqual({ docsOnly: false, suites: [], unmapped: ['new/unknown.ts'] });
    const mixed = selectSubsystems(['new/unknown.ts', 'src/renderer/features/canvas/CanvasStage.tsx']);
    expect(mixed.suites).toEqual(['canvas', 'history']);
    expect(mixed.unmapped).toEqual(['new/unknown.ts']);
    expect(selectSubsystems(['README.md', 'docs/development.md']).docsOnly).toBe(true);
    expect(selectSubsystems([]).docsOnly).toBe(false);
  });
  it('keeps every mapped and Full suite executable without another risk database', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const suites = new Set([...manifest.routing.fullRegressionSuites, ...manifest.routing.routes.flatMap((route: { suites: string[] }) => route.suites)]);
    for (const suite of suites) expect(pkg.scripts[`verify:${suite}`]).toBeTruthy();
    expect(manifest.routing.fullRegressionSuites).toEqual(['project', 'assets', 'character', 'shot', 'canvas', 'history', 'editor', 'timeline']);
  });
});
