import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
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
    sectionIds: string[];
    sourceSlice: string;
    owner: string;
    migrationMode: string;
    canonicalOrder: number;
    predecessor: string;
    successor: string;
    sourceRange: { startLine: number; endLine: number };
    sourceLocalRange: { startLine: number; endLine: number };
    sourceStartByte: number;
    sourceEndByteExclusive: number;
    sourceSha256: string;
    targetPath: string;
    sourceSegments?: Array<{
      sourceSlice: string;
      sourceRange: { startLine: number; endLine: number };
      sourceLocalRange: { startLine: number; endLine: number };
      sourceStartByte: number;
      sourceEndByteExclusive: number;
      sourceSha256: string;
    }>;
  }>;
};

type ExpectedSegment = {
  id: string;
  sourceSlice: string;
  canonicalOrder: number;
  sourceRange: { startLine: number; endLine: number };
  targetPath: string;
};

const expectedSer02: ExpectedSegment[] = [
  {
    id: 'G001', sourceSlice: 'S01', canonicalOrder: 1,
    sourceRange: { startLine: 3, endLine: 59 },
    targetPath: 'src/renderer/styles/base/native-foundation/s01-01--native-foundation.css',
  },
  {
    id: 'G003', sourceSlice: 'S01', canonicalOrder: 3,
    sourceRange: { startLine: 78, endLine: 157 },
    targetPath: 'src/renderer/styles/shell/project-entry/s01-03--project-center-start.css',
  },
  {
    id: 'G014', sourceSlice: 'S01', canonicalOrder: 14,
    sourceRange: { startLine: 1392, endLine: 1560 },
    targetPath: 'src/renderer/styles/compat/debug-preview/s01-14--gate-probe-and-transport.css',
  },
  {
    id: 'G015', sourceSlice: 'S01', canonicalOrder: 16,
    sourceRange: { startLine: 1561, endLine: 1571 },
    targetPath: 'src/renderer/styles/features/recovery/s01-16--recovery-panel-base.css',
  },
  {
    id: 'G016', sourceSlice: 'S01', canonicalOrder: 17,
    sourceRange: { startLine: 1572, endLine: 1582 },
    targetPath: 'src/renderer/styles/shell/project-entry/s01-17--recent-panel-base.css',
  },
  {
    id: 'G018', sourceSlice: 'S01', canonicalOrder: 19,
    sourceRange: { startLine: 1672, endLine: 2115 },
    targetPath: 'src/renderer/styles/features/fla-import/review/s01-19--review-base.css',
  },
  {
    id: 'G019', sourceSlice: 'S02', canonicalOrder: 20,
    sourceRange: { startLine: 2116, endLine: 2705 },
    targetPath: 'src/renderer/styles/features/fla-import/raster/s02-02--raster-workbench-and-shared-header.css',
  },
  {
    id: 'G023', sourceSlice: 'S03', canonicalOrder: 24,
    sourceRange: { startLine: 3917, endLine: 4227 },
    targetPath: 'src/renderer/styles/features/fla-import/status/s03-01--terminal-g.css',
  },
  {
    id: 'G024', sourceSlice: 'S03', canonicalOrder: 25,
    sourceRange: { startLine: 4228, endLine: 4446 },
    targetPath: 'src/renderer/styles/features/fla-import/review/s03-02--inspection-a.css',
  },
  {
    id: 'G025', sourceSlice: 'S03', canonicalOrder: 26,
    sourceRange: { startLine: 4447, endLine: 4682 },
    targetPath: 'src/renderer/styles/features/fla-import/raster/s03-03--raster-browser-tail.css',
  },
  {
    id: 'G026', sourceSlice: 'S03', canonicalOrder: 27,
    sourceRange: { startLine: 4683, endLine: 5070 },
    targetPath: 'src/renderer/styles/features/fla-import/status/s03-04--severity-f.css',
  },
  {
    id: 'G027', sourceSlice: 'S03', canonicalOrder: 28,
    sourceRange: { startLine: 5071, endLine: 5350 },
    targetPath: 'src/renderer/styles/features/fla-import/render/s03-05--render-bounded-v11.css',
  },
  {
    id: 'G028', sourceSlice: 'S03', canonicalOrder: 30,
    sourceRange: { startLine: 5351, endLine: 6529 },
    targetPath: 'src/renderer/styles/shell/project-entry/s03-06--launcher-412.css',
  },
  {
    id: 'G029', sourceSlice: 'S04', canonicalOrder: 32,
    sourceRange: { startLine: 6530, endLine: 7264 },
    targetPath: 'src/renderer/styles/features/fla-import/sequence/s04-02--sequence-e-and-scroll.css',
  },
  {
    id: 'G030', sourceSlice: 'S04', canonicalOrder: 33,
    sourceRange: { startLine: 7265, endLine: 7948 },
    targetPath: 'src/renderer/styles/features/fla-import/render/s04-03--render-shell-and-snapshot-d.css',
  },
  {
    id: 'G031', sourceSlice: 'S04', canonicalOrder: 34,
    sourceRange: { startLine: 7949, endLine: 7960 },
    targetPath: 'src/renderer/styles/base/native-foundation/s04-04--sr-only.css',
  },
  {
    id: 'G032', sourceSlice: 'S04', canonicalOrder: 35,
    sourceRange: { startLine: 7961, endLine: 8038 },
    targetPath: 'src/renderer/styles/features/fla-import/render/s04-05--render-responsive-tail.css',
  },
  {
    id: 'G039', sourceSlice: 'S05', canonicalOrder: 44,
    sourceRange: { startLine: 9431, endLine: 9506 },
    targetPath: 'src/renderer/styles/shell/project-entry/s05-09--recent-projects-base.css',
  },
  {
    id: 'G040', sourceSlice: 'S05', canonicalOrder: 45,
    sourceRange: { startLine: 9507, endLine: 9756 },
    targetPath: 'src/renderer/styles/features/recovery/s05-10--recovery-status-and-prompt.css',
  },
  {
    id: 'G041', sourceSlice: 'S05', canonicalOrder: 46,
    sourceRange: { startLine: 9757, endLine: 9771 },
    targetPath: 'src/renderer/styles/compat/debug-preview/s05-11--preview-panel.css',
  },
  {
    id: 'G042', sourceSlice: 'S05', canonicalOrder: 47,
    sourceRange: { startLine: 9772, endLine: 9786 },
    targetPath: 'src/renderer/styles/base/native-foundation/s05-12--eyebrow-and-h1.css',
  },
  {
    id: 'G043', sourceSlice: 'S05', canonicalOrder: 48,
    sourceRange: { startLine: 9787, endLine: 9839 },
    targetPath: 'src/renderer/styles/compat/debug-preview/s05-13--stage-preview-base.css',
  },
  {
    id: 'G048', sourceSlice: 'S06', canonicalOrder: 53,
    sourceRange: { startLine: 10289, endLine: 10327 },
    targetPath: 'src/renderer/styles/compat/debug-preview/s06-05--transport-hidden-stage.css',
  },
  {
    id: 'G050', sourceSlice: 'S06', canonicalOrder: 56,
    sourceRange: { startLine: 10700, endLine: 10792 },
    targetPath: 'src/renderer/styles/shell/project-entry/s06-08--new-project-dialog.css',
  },
  {
    id: 'G052', sourceSlice: 'S06', canonicalOrder: 58,
    sourceRange: { startLine: 10968, endLine: 11053 },
    targetPath: 'src/renderer/styles/shell/project-entry/s06-10--close-confirm.css',
  },
  {
    id: 'G095', sourceSlice: 'S10', canonicalOrder: 110,
    sourceRange: { startLine: 21746, endLine: 21766 },
    targetPath: 'src/renderer/styles/shell/project-entry/s10-07--recent-maintenance.css',
  },
  {
    id: 'G111', sourceSlice: 'S13', canonicalOrder: 134,
    sourceRange: { startLine: 27612, endLine: 27859 },
    targetPath: 'src/renderer/styles/features/fla-import/render/s13-04--render-final-398.css',
  },
];

const baseline = normalize(execFileSync(
  'git',
  ['show', `${manifest.baseline.commit}:${manifest.baseline.sourcePath}`],
  { encoding: 'utf8' },
));

function normalize(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function sourceLines(value: string): string[] {
  const lines = normalize(value).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function rangeText(value: string, startLine: number, endLine: number): string {
  return `${sourceLines(value).slice(startLine - 1, endLine).join('\n')}\n`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function importPaths(): string[] {
  return sourceLines(readFileSync(resolve(root, manifest.rootEntry.path), 'utf8'))
    .map((line) => /^\s*@import\s+['"]([^'"]+)['"]\s*;\s*$/u.exec(line)?.[1] ?? null)
    .filter((path): path is string => path !== null);
}

function entryImportPath(targetPath: string): string {
  const entryPath = resolve(root, manifest.rootEntry.path);
  const importPath = relative(dirname(entryPath), resolve(root, targetPath))
    .replaceAll(String.fromCharCode(92), '/');
  return './' + importPath.replace(/^\.\//u, '');
}

function relocationText(relocation: (typeof manifest.semanticRelocations)[number]): string {
  if (relocation.sourceSegments?.length) {
    return relocation.sourceSegments
      .map(({ sourceRange }) => rangeText(baseline, sourceRange.startLine, sourceRange.endLine))
      .join('');
  }
  return rangeText(
    baseline,
    relocation.sourceRange.startLine,
    relocation.sourceRange.endLine,
  );
}

describe('Issue #549 SER-02 final stylesheet contract', () => {
  it('registers exactly the approved B07/B08/B09 segments and canonical positions', () => {
    const expectedIds = expectedSer02.map(({ id }) => id);
    const actual = manifest.semanticRelocations
      .filter(({ id }) => expectedIds.includes(id))
      .sort((left, right) => left.canonicalOrder - right.canonicalOrder)
      .map(({ id, sourceSlice, canonicalOrder, sourceRange, targetPath }) => ({
        id,
        sourceSlice,
        canonicalOrder,
        sourceRange,
        targetPath,
      }));

    expect(actual).toEqual(expectedSer02);
    expect(new Set(actual.map(({ id }) => id)).size).toBe(expectedSer02.length);
  });

  it('loads every SER-02 target exactly once in source order', () => {
    const imports = importPaths();
    const indexes = expectedSer02.map(({ id }) => {
      const relocation = manifest.semanticRelocations.find((item) => item.id === id);
      expect(relocation).toBeDefined();
      const path = entryImportPath(relocation!.targetPath);
      expect(imports.filter((candidate) => candidate === path)).toHaveLength(1);
      return imports.indexOf(path);
    });

    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
  });

  it('keeps every SER-02 target byte-exact and reconstructs the pinned stylesheet', () => {
    for (const expected of expectedSer02) {
      const relocation = manifest.semanticRelocations.find(({ id }) => id === expected.id);
      expect(relocation).toBeDefined();
      const target = normalize(readFileSync(resolve(root, expected.targetPath), 'utf8'));
      const expectedText = relocationText(relocation!);

      expect(target).toBe(expectedText);
      expect(sha256(target)).toBe(relocation!.sourceSha256);
      expect(Buffer.byteLength(target, 'utf8')).toBe(
        relocation!.sourceEndByteExclusive - relocation!.sourceStartByte,
      );
    }

    expect(sha256(readOrderedStylesheetSource())).toBe(
      '2404124609c88ee552288a51ffa3f5408cd2193adc754235af234cdd922ba3e7',
    );
    expect(normalize(readOrderedStylesheetSource())).toBe(baseline);
  });

  it('keeps all six rolling receipts and the deferred compatibility boundary explicit', () => {
    for (const workItem of ['p2-20', 'p2-22', 'p2-23', 'p2-24', 'p2-25', 'p2-26']) {
      const receiptPath = resolve(root, 'docs', 'evidence', `issue-549-${workItem}`, 'receipt.json');
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
        workItem: string;
        status: string;
        preflight: string;
      };
      expect(receipt.workItem.toLowerCase()).toBe(workItem);
      expect(receipt.status).toBe('validated-implementation-pending-human-acceptance');
      expect(receipt.preflight).toBe(`docs/evidence/issue-549-${workItem}/preflight.json`);
    }

    expect(manifest.semanticRelocations.some(({ id }) => id === 'G049')).toBe(false);
    expect(manifest.semanticRelocations.some(({ id }) => id === 'G112')).toBe(false);
  });
});
