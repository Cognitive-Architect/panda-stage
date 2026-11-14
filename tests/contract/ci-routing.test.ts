import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { isDocsOnly } = require('../../scripts/ci-routing.cjs');
const yaml = require('js-yaml');
const workflow = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8'));

describe('CI-LEAN-03 Core Integration lean', () => {
  it('parses one Core with single typecheck, direct build commands, and a stable final check', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['core', 'final']);
    const commands = workflow.jobs.core.steps.map((step: { run?: string }) => step.run).filter(Boolean).join('\n');
    for (const command of ['git diff --check', 'pnpm typecheck', 'pnpm lint', 'pnpm test:unit', 'pnpm test:integration', 'pnpm build:renderer && pnpm build:electron']) expect(commands).toContain(command);
    expect(commands.match(/pnpm typecheck/g)).toHaveLength(1);
    expect(commands).not.toContain('pnpm build\n');
    expect(workflow.jobs.final.needs).toBe('core');
    expect(workflow.jobs.final.name).toBe('Final CI result');
    expect(workflow.jobs.core.steps.filter((step: { run?: string }) => step.run === 'pnpm install --frozen-lockfile')).toHaveLength(1);
    expect(commands).not.toMatch(/verify:|full-suites|subsystem/i);
    expect(commands).not.toContain('diagnose:left-workspace');
    expect(existsSync('.github/workflows/full-ci.yml')).toBe(false);
  });
  it('keeps left-workspace Electron acceptance available only through its manual command', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    const integrationConfig = readFileSync('vitest.integration.config.ts', 'utf8');
    const manualConfig = readFileSync('vitest.left-workspace.config.ts', 'utf8');
    expect(packageJson.scripts['diagnose:left-workspace']).toBe('vitest run --config vitest.left-workspace.config.ts');
    expect(integrationConfig).toContain("include: ['tests/integration/**/*.test.ts']");
    expect(existsSync('tests/integration/left-workspace.test.ts')).toBe(false);
    expect(manualConfig).toContain("include: ['tests/manual/left-workspace-electron.test.ts']");
    expect(existsSync('tests/manual/left-workspace-electron.test.ts')).toBe(true);
  });
  it('cancels superseded PR runs', () => {
    expect(workflow.concurrency).toEqual({ group: 'ci-${{ github.ref }}', 'cancel-in-progress': "${{ github.ref != 'refs/heads/main' }}" });
  });
  it('uses the small docs-only fast path and sends mixed, unknown and empty diffs to Core', () => {
    expect(isDocsOnly(['README.md', 'docs/development.md'])).toBe(true);
    expect(isDocsOnly(['docs\\architecture.md'])).toBe(true);
    for (const files of [[], ['new/unknown.ts'], ['README.md', 'src/main/index.ts'], ['docs/fixture.png'], ['package.json']]) expect(isDocsOnly(files)).toBe(false);
  });
});
