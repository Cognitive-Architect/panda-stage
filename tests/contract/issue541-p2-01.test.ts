import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

const root = resolve(process.cwd());
const manifest = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'css-split-manifest.json'), 'utf8'),
) as {
  baseline: { commit: string; sourcePath: string };
  rootEntry: { path: string };
  semanticRelocations: Array<{
    id: string;
    sourceSlice: string;
    owner: string;
    migrationMode: string;
    canonicalOrder: number;
    predecessor: string;
    successor: string;
    sourceRange: { startLine: number; endLine: number };
    targetPath: string;
    insertBefore: string;
    sourceSha256: string;
  }>;
};

function normalize(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function baselineSource(): string {
  return normalize(
    execFileSync(
      'git',
      ['show', `${manifest.baseline.commit}:${manifest.baseline.sourcePath}`],
      { cwd: root, encoding: 'utf8' },
    ),
  );
}

function sourceLines(value: string): string[] {
  const lines = normalize(value).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function importPaths(): string[] {
  return sourceLines(readFileSync(resolve(root, manifest.rootEntry.path), 'utf8'))
    .map((line) => /^\s*@import\s+['"]([^'"]+)['"]\s*;\s*$/u.exec(line)?.[1] ?? null)
    .filter((path): path is string => path !== null);
}

describe('Issue #541 P2-01 semantic stylesheet continuation', () => {
  it('records the approved S11-01 boundary and ownership chain', () => {
    expect(manifest.semanticRelocations).toHaveLength(1);
    expect(manifest.semanticRelocations[0]).toMatchObject({
      id: 'S11-01',
      sourceSlice: 'S11',
      owner: 'shell-tools',
      migrationMode: 'DIRECT+VERIFICATION',
      canonicalOrder: 112,
      predecessor: 'S10-08/G096',
      successor: 'S11-02/G098',
      sourceRange: { startLine: 21803, endLine: 21856 },
      targetPath: 'src/renderer/styles/shell/tools/view-mode.css',
      insertBefore: 'src/renderer/styles/legacy-slices/11-tools-inspector-timeline-start.css',
    });
  });

  it('loads the semantic segment once at the original production position', () => {
    const imports = importPaths();
    const semanticIndex = imports.indexOf('./styles/shell/tools/view-mode.css');
    const legacyIndex = imports.indexOf('./styles/legacy-slices/11-tools-inspector-timeline-start.css');
    expect(semanticIndex).toBeGreaterThan(-1);
    expect(legacyIndex).toBe(semanticIndex + 1);
    expect(imports.filter((path) => path === './styles/shell/tools/view-mode.css')).toHaveLength(1);
  });

  it('reconstructs the pinned source through the real production entry', () => {
    expect(readOrderedStylesheetSource()).toBe(baselineSource());
  });

  it('keeps the moved bytes exact and leaves the action-preset section in the legacy remainder', () => {
    const relocation = manifest.semanticRelocations[0]!;
    const baseline = sourceLines(baselineSource());
    const expected = `${baseline.slice(relocation.sourceRange.startLine - 1, relocation.sourceRange.endLine).join('\n')}\n`;
    const target = normalize(readFileSync(resolve(root, relocation.targetPath), 'utf8'));
    const legacy = normalize(
      readFileSync(
        resolve(root, 'src/renderer/styles/legacy-slices/11-tools-inspector-timeline-start.css'),
        'utf8',
      ),
    );
    expect(target).toBe(expected);
    expect(legacy).not.toContain('.project-tools-view-mode-card');
    expect(legacy.startsWith('.project-tools-action-presets-view {')).toBe(true);
  });
});
