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
  const entryPath = resolve(root, manifest.rootEntry.path);
  const importPath = relative(dirname(entryPath), resolve(root, targetPath))
    .replaceAll(String.fromCharCode(92), '/');
  return './' + importPath.replace(/^\.\//u, '');
}

const expectedB05 = [
  {
    id: 'G073',
    segment: 'G073',
    sectionIds: ['S08-02'],
    sourceSlice: 'S08',
    owner: 'dialogue-properties',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 82,
    predecessor: 'S08-01/G072',
    successor: 'S08-03/G074',
    sourceRange: { startLine: 13983, endLine: 14157 },
    sourceLocalRange: { startLine: 182, endLine: 356 },
    sourceStartByte: 3964,
    sourceEndByteExclusive: 7885,
    sourceSha256: 'db74b4f10b8aa343fd78b97ea171d3dfd7eeb2b0d44d92e968dc2026a2205c5c',
    targetPath: 'src/renderer/styles/features/dialogue/properties/s08-02--landscape-inspector-original.css',
  },
  {
    id: 'G083',
    segment: 'G083',
    sectionIds: ['S09-02'],
    sourceSlice: 'S09',
    owner: 'dialogue-properties',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 97,
    predecessor: 'S09-01/G082',
    successor: 'S09-03/G084',
    sourceRange: { startLine: 18218, endLine: 18686 },
    sourceLocalRange: { startLine: 399, endLine: 867 },
    sourceStartByte: 12214,
    sourceEndByteExclusive: 27355,
    sourceSha256: '4fda011562bc79c6a857cdbadefc9f28d54612e70f2481abf5bd005706bb2a39',
    targetPath: 'src/renderer/styles/features/dialogue/properties/s09-02--portrait-properties-precision.css',
  },
  {
    id: 'G106',
    segment: 'G106',
    sectionIds: ['S12-06', 'S12-07'],
    sourceSlice: 'S12',
    owner: 'dialogue-properties',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 127,
    predecessor: 'S12-05/G105',
    successor: 'S12-08/G107',
    sourceRange: { startLine: 24878, endLine: 25734 },
    sourceLocalRange: { startLine: 1079, endLine: 1935 },
    sourceStartByte: 32640,
    sourceEndByteExclusive: 59072,
    sourceSha256: '8c3f14153456c7ac5e1ad928698ef74345de37a920a4c7f8d127a136b49b4b05',
    targetPath: 'src/renderer/styles/features/dialogue/properties/s12-06--landscape-properties-quick-inspect.css',
  },
  {
    id: 'G115',
    segment: 'G115',
    sectionIds: ['S14-03'],
    sourceSlice: 'S14',
    owner: 'dialogue-properties',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 138,
    predecessor: 'S14-02/G114',
    successor: 'S14-04/G116',
    sourceRange: { startLine: 28218, endLine: 28409 },
    sourceLocalRange: { startLine: 221, endLine: 412 },
    sourceStartByte: 5132,
    sourceEndByteExclusive: 9711,
    sourceSha256: '5f42da77b2319f9f3a8d417933300f041f08db92746478d26414fd81cca3ebd3',
    targetPath: 'src/renderer/styles/features/dialogue/properties/s14-03--properties-447.css',
  },
  {
    id: 'G117',
    segment: 'G117',
    sectionIds: ['S14-05'],
    sourceSlice: 'S14',
    owner: 'dialogue-properties',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 140,
    predecessor: 'S14-04/G116',
    successor: 'S14-06/G118',
    sourceRange: { startLine: 28481, endLine: 28581 },
    sourceLocalRange: { startLine: 484, endLine: 584 },
    sourceStartByte: 11166,
    sourceEndByteExclusive: 13997,
    sourceSha256: '8e0a01aa25a594ded75acb9a563247c0a2d31389881318cbe1a838bfae9aad5d',
    targetPath: 'src/renderer/styles/features/dialogue/properties/s14-05--properties-width420.css',
  },
  {
    id: 'G119',
    segment: 'G119',
    sectionIds: ['S14-07', 'S14-08'],
    sourceSlice: 'S14',
    owner: 'dialogue-properties',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 142,
    predecessor: 'S14-06/G118',
    successor: 'S14-09/G120',
    sourceRange: { startLine: 28594, endLine: 28884 },
    sourceLocalRange: { startLine: 597, endLine: 887 },
    sourceStartByte: 14255,
    sourceEndByteExclusive: 22408,
    sourceSha256: 'd9c7207401f9e8fb9e405131d1e67cef42d7c65482841113728f07ce905c147f',
    targetPath: 'src/renderer/styles/features/dialogue/properties/s14-07--properties-spacing-448a.css',
  },
  {
    id: 'G123',
    segment: 'G123',
    sectionIds: ['S14-12', 'S14-13'],
    sourceSlice: 'S14',
    owner: 'dialogue-properties',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 147,
    predecessor: 'S14-11/G122',
    successor: 'S14-14/G124',
    sourceRange: { startLine: 29284, endLine: 29428 },
    sourceLocalRange: { startLine: 1287, endLine: 1431 },
    sourceStartByte: 31789,
    sourceEndByteExclusive: 36096,
    sourceSha256: '003f05a63ec793df04e647149fd5d70c96883e4e4b20bb08abfbc256cd1db37a',
    targetPath: 'src/renderer/styles/features/dialogue/properties/s14-12--timing-seconds-463.css',
  },
] as const;

const b05Ids = expectedB05.map(({ id }) => id);

describe('Issue #548 P2-B05 dialogue properties and subtitle-style foundation relocation', () => {
  it('pins the non-automatic Phase 2 map and all seven P2-10 identities', () => {
    expect(manifest.phase2CanonicalMap).toMatchObject({
      path: 'docs/decisions/PandaStage_Phase2_Canonical_Section_Map_v1.1_2026-09-16.md',
      commit: 'f5d25ef8adddbe88d42dcab2cc2212b4c0203590',
      sha256: '7a7ba422a451ece5cef1af87acbc8b3be4ff92d33deaf7783db9bd23948cbd3b',
      lineCount: 1462,
      approvedForAutomaticRelocation: false,
    });

    const actual = b05Ids.map((id) => {
      const relocation = manifest.semanticRelocations.find((item) => item.id === id);
      expect(relocation).toBeDefined();
      return relocation && {
        id: relocation.id,
        segment: relocation.segment,
        sectionIds: relocation.sectionIds,
        sourceSlice: relocation.sourceSlice,
        owner: relocation.owner,
        migrationMode: relocation.migrationMode,
        canonicalOrder: relocation.canonicalOrder,
        predecessor: relocation.predecessor,
        successor: relocation.successor,
        sourceRange: relocation.sourceRange,
        sourceLocalRange: relocation.sourceLocalRange,
        sourceStartByte: relocation.sourceStartByte,
        sourceEndByteExclusive: relocation.sourceEndByteExclusive,
        sourceSha256: relocation.sourceSha256,
        targetPath: relocation.targetPath,
      };
    });
    expect(actual).toEqual(expectedB05);
  });

  it('keeps each P2-10 seam and the S14 dialogue cascade contiguous', () => {
    expect(manifest.remainderParts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'S08-R01',
        sourceRange: { startLine: 13802, endLine: 13982 },
      }),
      expect.objectContaining({
        id: 'S08-R04',
        sourceRange: { startLine: 14158, endLine: 15158 },
      }),
      expect.objectContaining({
        id: 'S09-R01',
        sourceRange: { startLine: 17820, endLine: 18217 },
      }),
      expect.objectContaining({
        id: 'S09-R02',
        sourceRange: { startLine: 18687, endLine: 18827 },
      }),
      expect.objectContaining({
        id: 'S12-R01',
        sourceRange: { startLine: 23800, endLine: 24877 },
      }),
      expect.objectContaining({
        id: 'S12-R02',
        sourceRange: { startLine: 25735, endLine: 25876 },
      }),
    ]));

    const s14 = manifest.slices.find(({ id }) => id === 'S14');
    expect(s14?.sourceParts).toEqual([
      { id: 'G113', kind: 'semantic', relocationId: 'G113', sourceRange: { startLine: 1, endLine: 30 }, targetPath: 'src/renderer/styles/features/dialogue/workspace/s14-01--pending-hints-443.css' },
      { id: 'G114', kind: 'semantic', relocationId: 'G114', sourceRange: { startLine: 31, endLine: 220 }, targetPath: 'src/renderer/styles/features/dialogue/batch/s14-02--batch-447.css' },
      { id: 'G115', kind: 'semantic', relocationId: 'G115', sourceRange: { startLine: 221, endLine: 412 }, targetPath: 'src/renderer/styles/features/dialogue/properties/s14-03--properties-447.css' },
      { id: 'S14-R01', kind: 'remainder', sourceRange: { startLine: 413, endLine: 483 }, targetPath: 'src/renderer/styles/legacy-slices/14-dialogue-polish-image-picker.css' },
      { id: 'G117', kind: 'semantic', relocationId: 'G117', sourceRange: { startLine: 484, endLine: 584 }, targetPath: 'src/renderer/styles/features/dialogue/properties/s14-05--properties-width420.css' },
      { id: 'G118', kind: 'semantic', relocationId: 'G118', sourceRange: { startLine: 585, endLine: 596 }, targetPath: 'src/renderer/styles/features/dialogue/batch/s14-06--batch-footer-host.css' },
      { id: 'G119', kind: 'semantic', relocationId: 'G119', sourceRange: { startLine: 597, endLine: 887 }, targetPath: 'src/renderer/styles/features/dialogue/properties/s14-07--properties-spacing-448a.css' },
      { id: 'S14-R02', kind: 'remainder', sourceRange: { startLine: 888, endLine: 1286 }, targetPath: 'src/renderer/styles/legacy-slices/14-dialogue-polish-image-picker-after-batch-footer.css' },
      { id: 'G123', kind: 'semantic', relocationId: 'G123', sourceRange: { startLine: 1287, endLine: 1431 }, targetPath: 'src/renderer/styles/features/dialogue/properties/s14-12--timing-seconds-463.css' },
      { id: 'S14-14', kind: 'semantic', relocationId: 'S14-14', sourceRange: { startLine: 1432, endLine: 1765 }, targetPath: 'src/renderer/styles/features/characters/image-picker/s14-14--image-picker-base-492.css' },
      { id: 'S14-R03', kind: 'remainder', sourceRange: { startLine: 1766, endLine: 1797 }, targetPath: 'src/renderer/styles/legacy-slices/14-dialogue-polish-image-picker-tail.css' },
    ]);
  });

  it('loads every P2-10 target exactly once in canonical production order', () => {
    const imports = importPaths();
    const indexes = expectedB05.map(({ targetPath }) => {
      const path = entryImportPath(targetPath);
      expect(imports.filter((candidate) => candidate === path)).toHaveLength(1);
      return imports.indexOf(path);
    });
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));

    const s14 = manifest.slices.find(({ id }) => id === 'S14')!;
    const s14Paths = s14.sourceParts!.map(({ targetPath }) => entryImportPath(targetPath));
    const s14Start = imports.indexOf(s14Paths[0]!);
    expect(imports.slice(s14Start, s14Start + s14Paths.length)).toEqual(s14Paths);
  });

  it('keeps every P2-10 target byte-exact and reconstructs the pinned stylesheet', () => {
    for (const relocation of expectedB05) {
      const target = normalize(readFileSync(resolve(root, relocation.targetPath), 'utf8'));
      expect(sha256(target)).toBe(relocation.sourceSha256);
      expect(Buffer.byteLength(target, 'utf8')).toBe(
        relocation.sourceEndByteExclusive - relocation.sourceStartByte,
      );
    }

    expect(sha256(readOrderedStylesheetSource())).toBe(
      '2404124609c88ee552288a51ffa3f5408cd2193adc754235af234cdd922ba3e7',
    );
  });
});
