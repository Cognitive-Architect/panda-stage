import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const manifest = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'css-split-manifest.json'), 'utf8'),
) as {
  rootEntry: { path: string };
  semanticRelocations: Array<{
    id: string;
    segment: string;
    sectionIds: string[];
    sourceSlice: string;
    owner: string;
    migrationMode: string;
    canonicalOrder: number;
    predecessor: string;
    successor: string;
    sourceRange: { startLine: number; endLine: number };
    sourceSha256: string;
    targetPath: string;
  }>;
  remainderParts: Array<{
    id: string;
    sourceSlice: string;
    sourceRange: { startLine: number; endLine: number };
    targetPath: string;
  }>;
};

function normalize(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function importPaths(): string[] {
  return normalize(readFileSync(resolve(root, manifest.rootEntry.path), 'utf8'))
    .split('\n')
    .map((line) => /^\s*@import\s+['"]([^'"]+)['"]\s*;\s*$/u.exec(line)?.[1] ?? null)
    .filter((path): path is string => path !== null);
}

function entryImportPath(targetPath: string): string {
  return `./${targetPath.replace(/^src\/renderer\//u, '')}`;
}

const expectedB06 = [
  {
    id: 'G044',
    sectionIds: ['S06-01'],
    sourceSlice: 'S06',
    owner: 'canvas',
    canonicalOrder: 49,
    predecessor: 'S05-13/G043',
    successor: 'S06-02/G045',
    targetPath: 'src/renderer/styles/features/canvas/s06-01--canvas-internals.css',
  },
  {
    id: 'G045',
    sectionIds: ['S06-02'],
    sourceSlice: 'S06',
    owner: 'layer-properties',
    canonicalOrder: 50,
    predecessor: 'S06-01/G044',
    successor: 'S06-03/G046',
    targetPath: 'src/renderer/styles/features/properties/s06-02--position-background-base.css',
  },
  {
    id: 'G047',
    sectionIds: ['S06-04'],
    sourceSlice: 'S06',
    owner: 'layer-properties',
    canonicalOrder: 52,
    predecessor: 'S06-03/G046',
    successor: 'S06-05/G048',
    targetPath: 'src/renderer/styles/features/properties/s06-04--transform-order-base.css',
  },
  {
    id: 'G051',
    sectionIds: ['S06-09'],
    sourceSlice: 'S06',
    owner: 'product-preview',
    canonicalOrder: 57,
    predecessor: 'S06-08/G050',
    successor: 'S06-10/G052',
    targetPath: 'src/renderer/styles/shell/product-preview/s06-09--product-preview.css',
  },
  {
    id: 'G066',
    sectionIds: ['S07-10'],
    sourceSlice: 'S07',
    owner: 'layer-properties',
    canonicalOrder: 74,
    predecessor: 'S07-09/G065',
    successor: 'S07-11/G067',
    targetPath: 'src/renderer/styles/features/properties/s07-10--portrait-layer-forms.css',
  },
  {
    id: 'G067',
    sectionIds: ['S07-11'],
    sourceSlice: 'S07',
    owner: 'canvas',
    canonicalOrder: 75,
    predecessor: 'S07-10/G066',
    successor: 'S07-12/G068',
    targetPath: 'src/renderer/styles/features/canvas/s07-11--portrait-timeline-canvas.css',
  },
  {
    id: 'G081',
    sectionIds: ['S08-12', 'S08-13', 'S08-14'],
    sourceSlice: 'S08',
    owner: 'layer-properties',
    canonicalOrder: 92,
    predecessor: 'S08-11/G080',
    successor: 'S08-15/G082',
    targetPath: 'src/renderer/styles/features/properties/s08-12--portrait-appearance.css',
  },
  {
    id: 'G100',
    sectionIds: ['S11-05', 'S11-06', 'S11-07'],
    sourceSlice: 'S11',
    owner: 'layer-properties',
    canonicalOrder: 116,
    predecessor: 'S11-04/G099',
    successor: 'S11-08/G101',
    targetPath: 'src/renderer/styles/features/properties/s11-05--landscape-layer-controls.css',
  },
] as const;

describe('Issue #546 P2-B06 ordered semantic stylesheet continuation', () => {
  it('records only the approved Layer Properties, Canvas, and Product Preview segments', () => {
    const actual = manifest.semanticRelocations
      .filter(({ id }) => expectedB06.some((segment) => segment.id === id))
      .map(({ id, sectionIds, sourceSlice, owner, canonicalOrder, predecessor, successor, targetPath }) => ({
        id,
        sectionIds,
        sourceSlice,
        owner,
        canonicalOrder,
        predecessor,
        successor,
        targetPath,
      }));
    expect(actual).toEqual(expectedB06);
    expect(manifest.semanticRelocations.filter(({ id }) => id === 'S11-01')).toHaveLength(1);
  });

  it('keeps each moved target exact and loads it once in canonical production order', () => {
    const imports = importPaths();
    const actual = manifest.semanticRelocations.filter(({ id }) =>
      expectedB06.some((segment) => segment.id === id),
    );
    const importIndexes = actual.map(({ targetPath }) => {
      const path = entryImportPath(targetPath);
      expect(imports.filter((candidate) => candidate === path)).toHaveLength(1);
      return imports.indexOf(path);
    });
    expect(importIndexes).toEqual([...importIndexes].sort((left, right) => left - right));
    expect(actual.map(({ canonicalOrder }) => canonicalOrder)).toEqual(
      expectedB06.map(({ canonicalOrder }) => canonicalOrder),
    );

    for (const relocation of actual) {
      const target = normalize(readFileSync(resolve(root, relocation.targetPath), 'utf8'));
      expect(sha256(target)).toBe(relocation.sourceSha256);
      expect(relocation.sourceRange.startLine).toBeLessThanOrEqual(relocation.sourceRange.endLine);
    }
  });

  it('declares the ordered remainder boundaries required for interior relocations', () => {
    expect(manifest.remainderParts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'S06-R01',
        sourceSlice: 'S06',
        sourceRange: { startLine: 10190, endLine: 10211 },
      }),
      expect.objectContaining({
        id: 'S06-R02',
        sourceSlice: 'S06',
        sourceRange: { startLine: 10328, endLine: 10699 },
      }),
      expect.objectContaining({
        id: 'S07-R01',
        sourceSlice: 'S07',
        sourceRange: { startLine: 11884, endLine: 12000 },
      }),
      expect.objectContaining({
        id: 'S08-R01',
        sourceSlice: 'S08',
        sourceRange: { startLine: 13802, endLine: 13982 },
      }),
      expect.objectContaining({
        id: 'S11-R01',
        sourceSlice: 'S11',
        sourceRange: { startLine: 21857, endLine: 22049 },
      }),
    ]));
  });
});
