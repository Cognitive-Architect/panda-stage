import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

const root = resolve(process.cwd());
const manifest = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'css-split-manifest.json'), 'utf8'),
) as {
  phase2CanonicalMap: {
    path: string;
    commit: string;
    sha256: string;
    lineCount: number;
    approvedForAutomaticRelocation: boolean;
  };
  rootEntry: { path: string };
  slices: Array<{
    id: string;
    range: { startLine: number; endLine: number };
    sourceParts?: Array<{
      id: string;
      kind: 'remainder' | 'semantic';
      relocationId?: string;
      sourceRange: { startLine: number; endLine: number };
      targetPath: string;
    }>;
  }>;
  semanticRelocations: Array<{
    id: string;
    segment: string;
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
  }>;
};

const b01Ids = [
  'S14-14',
  'S15-01',
  'S15-03',
  'S15-04',
  'S15-06',
  'S15-12',
  'S15-14',
  'S15-15',
  'S16-07',
] as const;

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
  const entryPath = resolve(root, manifest.rootEntry.path);
  const importPath = relative(dirname(entryPath), resolve(root, targetPath))
    .replaceAll(String.fromCharCode(92), '/');
  return './' + importPath.replace(/^\.\//u, '');
}

describe('Issue #545 P2-B01 shared character foundations', () => {
  it('pins the non-automatic Phase 2 map and the nine B01 identities', () => {
    expect(manifest.phase2CanonicalMap).toMatchObject({
      path: 'docs/decisions/PandaStage_Phase2_Canonical_Section_Map_v1.1_2026-09-16.md',
      commit: 'f5d25ef8adddbe88d42dcab2cc2212b4c0203590',
      sha256: '7a7ba422a451ece5cef1af87acbc8b3be4ff92d33deaf7783db9bd23948cbd3b',
      lineCount: 1462,
      approvedForAutomaticRelocation: false,
    });

    const relocations = b01Ids.map((id) => {
      const relocation = manifest.semanticRelocations.find((item) => item.id === id);
      expect(relocation).toBeDefined();
      return relocation!;
    });
    expect(relocations.map(({ id }) => id)).toEqual([...b01Ids]);
    expect(relocations.map(({ canonicalOrder }) => canonicalOrder)).toEqual([
      149, 151, 153, 154, 156, 162, 164, 165, 179,
    ]);
    expect(relocations.map(({ segment }) => segment)).toEqual([
      'G124', 'G126', 'G128', 'G129', 'G131', 'G133', 'G135', 'G136', 'G147',
    ]);
  });

  it('covers each B01 source slice with contiguous ordered parts', () => {
    for (const sliceId of ['S14', 'S15', 'S16']) {
      const slice = manifest.slices.find(({ id }) => id === sliceId);
      expect(slice?.sourceParts).toBeDefined();
      const parts = slice!.sourceParts!;
      let cursor = 1;
      for (const part of parts) {
        expect(part.sourceRange.startLine).toBe(cursor);
        expect(part.sourceRange.endLine).toBeGreaterThanOrEqual(part.sourceRange.startLine);
        cursor = part.sourceRange.endLine + 1;
      }
      expect(cursor).toBe(slice!.range.endLine - slice!.range.startLine + 2);
    }

    const semanticRelocations = manifest.semanticRelocations.filter(({ id }) =>
      b01Ids.includes(id as (typeof b01Ids)[number]),
    );
    for (const relocation of semanticRelocations) {
      const slice = manifest.slices.find(({ id }) => id === relocation.sourceSlice)!;
      const part = slice.sourceParts!.find(({ relocationId }) => relocationId === relocation.id);
      expect(part).toBeDefined();
      expect(part).toMatchObject({
        kind: 'semantic',
        targetPath: relocation.targetPath,
        sourceRange: relocation.sourceLocalRange,
      });
    }
  });

  it('loads B01 parts exactly once in canonical source order', () => {
    const expected = ['S14', 'S15', 'S16'].flatMap((sliceId) => {
      const slice = manifest.slices.find(({ id }) => id === sliceId)!;
      return slice.sourceParts!.map(({ targetPath }) => entryImportPath(targetPath));
    });
    const imports = importPaths();
    const start = imports.indexOf(expected[0]!);
    expect(start).toBeGreaterThan(-1);
    expect(imports.slice(start, start + expected.length)).toEqual(expected);
    for (const path of expected) {
      expect(imports.filter((candidate) => candidate === path)).toHaveLength(1);
    }
  });

  it('keeps unchanged moved targets exact and reconstructs the current stylesheet', () => {
    for (const id of b01Ids) {
      const relocation = manifest.semanticRelocations.find((item) => item.id === id)!;
      const target = normalize(readFileSync(resolve(root, relocation.targetPath), 'utf8'));
      if (id === 'S14-14') {
        // Issue #555 intentionally evolves this target; its selected-surface
        // contract is covered by issue555-p3-01-selected-asset-surface.test.ts.
        continue;
      }
      expect(sha256(target)).toBe(relocation.sourceSha256);
      expect(Buffer.byteLength(target, 'utf8')).toBe(
        relocation.sourceEndByteExclusive - relocation.sourceStartByte,
      );
    }
    expect(sha256(readOrderedStylesheetSource())).toBe(
      'd27c94e09c50ca7ce48643d78264d33cdfb5680051427928530ad186c2baef4d',
    );
  });
});
