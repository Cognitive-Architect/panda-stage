import { createHash } from 'node:crypto';
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

const preflight = JSON.parse(
  readFileSync(resolve(root, 'docs', 'evidence', 'issue-541-p2-01', 'preflight.json'), 'utf8'),
) as {
  sourceSlice: string;
  section: string;
  segment: string;
};

const ledger = JSON.parse(
  readFileSync(resolve(root, 'docs', 'evidence', 'issue-541-p2-01', 'ledger.json'), 'utf8'),
) as {
  canonicalSection: string;
  segment: string;
  livePrHeadAuthority: string;
  selfReferenceRule: string;
  legacyReceiptFieldSemantics: Record<string, string>;
};

function normalize(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function sourceLines(value: string): string[] {
  const lines = normalize(value).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

  it('keeps Section and Segment identities distinct in the evidence ledger', () => {
    expect(preflight).toMatchObject({
      sourceSlice: 'S11',
      section: 'S11-01',
      segment: 'G097',
    });
    expect(ledger).toMatchObject({
      canonicalSection: 'S11-01',
      segment: 'G097',
      livePrHeadAuthority: 'GitHub PR #542 metadata',
    });
    expect(ledger.selfReferenceRule).toContain('Do not store the current/final PR HEAD');
    expect(ledger.legacyReceiptFieldSemantics['receipt.json.finalHead']).toContain('DEPRECATED NAME');
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
    expect(sha256(readOrderedStylesheetSource())).toBe(
      '2404124609c88ee552288a51ffa3f5408cd2193adc754235af234cdd922ba3e7',
    );
  });

  it('keeps the moved bytes exact and leaves the action-preset section in the legacy remainder', () => {
    const relocation = manifest.semanticRelocations[0]!;
    const target = normalize(readFileSync(resolve(root, relocation.targetPath), 'utf8'));
    const legacy = normalize(
      readFileSync(
        resolve(root, 'src/renderer/styles/legacy-slices/11-tools-inspector-timeline-start.css'),
        'utf8',
      ),
    );
    expect(sha256(target)).toBe(relocation.sourceSha256);
    expect(legacy).not.toContain('.project-tools-view-mode-card');
    expect(legacy.startsWith('.project-tools-action-presets-view {')).toBe(true);
  });
});
