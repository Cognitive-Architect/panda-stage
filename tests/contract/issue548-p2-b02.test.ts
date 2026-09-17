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

const expectedP204 = [
  {
    id: 'G034',
    segment: 'G034',
    sectionIds: ['S05-02'],
    sourceSlice: 'S05',
    owner: 'characters-workspace',
    migrationMode: 'DIRECT',
    canonicalOrder: 37,
    predecessor: 'S05-01/G033',
    successor: 'S05-03/G035',
    sourceRange: { startLine: 8630, endLine: 8949 },
    sourceLocalRange: { startLine: 592, endLine: 911 },
    sourceStartByte: 10643,
    sourceEndByteExclusive: 16448,
    sourceSha256: '472ddc6d2105306c62a4a6fbc65058f894e2a6cb26473c0737ada5685a4f0012',
    targetPath: 'src/renderer/styles/features/characters/workspace/s05-02--characters-base.css',
  },
  {
    id: 'G038',
    segment: 'G038',
    sectionIds: ['S05-06', 'S05-07', 'S05-08'],
    sourceSlice: 'S05',
    owner: 'characters-workspace',
    migrationMode: 'DIRECT',
    canonicalOrder: 41,
    predecessor: 'S05-05/G037',
    successor: 'S05-09/G039',
    sourceRange: { startLine: 9350, endLine: 9430 },
    sourceLocalRange: { startLine: 1312, endLine: 1392 },
    sourceStartByte: 23290,
    sourceEndByteExclusive: 24908,
    sourceSha256: '70a2144668b76b1f6c7e42d1fa79b6323e89a6acc4606cfc144a96994e403b6e',
    targetPath: 'src/renderer/styles/features/characters/workspace/s05-06--character-resource-host.css',
  },
  {
    id: 'G071',
    segment: 'G071',
    sectionIds: ['S07-15'],
    sourceSlice: 'S07',
    owner: 'characters-workspace',
    migrationMode: 'DIRECT',
    canonicalOrder: 79,
    predecessor: 'S07-14/G070',
    successor: 'S07-16/G072',
    sourceRange: { startLine: 13579, endLine: 13631 },
    sourceLocalRange: { startLine: 1696, endLine: 1748 },
    sourceStartByte: 49028,
    sourceEndByteExclusive: 50165,
    sourceSha256: '5003914a5fdd8270ea93c312ee7653abd84ab524d55e62b9beb96644f6d0e4b4',
    targetPath: 'src/renderer/styles/features/characters/workspace/s07-15--landscape-characters-original.css',
  },
  {
    id: 'G090',
    segment: 'G090',
    sectionIds: ['S10-02'],
    sourceSlice: 'S10',
    owner: 'characters-workspace',
    migrationMode: 'DIRECT',
    canonicalOrder: 105,
    predecessor: 'S10-01/G089',
    successor: 'S10-03/G091',
    sourceRange: { startLine: 19784, endLine: 21030 },
    sourceLocalRange: { startLine: 1, endLine: 1247 },
    sourceStartByte: 0,
    sourceEndByteExclusive: 38342,
    sourceSha256: '5274f89c5c4a11da4567623afb7e7fadd29a840802eab548192a5a19d51196c9',
    targetPath: 'src/renderer/styles/features/characters/workspace/s10-02--landscape-character-workbench.css',
  },
  {
    id: 'G127',
    segment: 'G127',
    sectionIds: ['S15-02'],
    sourceSlice: 'S15',
    owner: 'characters-workspace',
    migrationMode: 'DIRECT',
    canonicalOrder: 152,
    predecessor: 'S15-01/G126',
    successor: 'S15-03/G128',
    sourceRange: { startLine: 30094, endLine: 30206 },
    sourceLocalRange: { startLine: 300, endLine: 412 },
    sourceStartByte: 6499,
    sourceEndByteExclusive: 8779,
    sourceSha256: '4ec3ca21dcfbc6891f1f60e0542f0a8e35fddb9fff48cad4cbb9a95e73fec6eb',
    targetPath: 'src/renderer/styles/features/characters/workspace/s15-02--character-list-and-summary-495.css',
  },
  {
    id: 'G130',
    segment: 'G130',
    sectionIds: ['S15-05'],
    sourceSlice: 'S15',
    owner: 'characters-workspace',
    migrationMode: 'DIRECT',
    canonicalOrder: 155,
    predecessor: 'S15-04/G129',
    successor: 'S15-06/G131',
    sourceRange: { startLine: 30332, endLine: 30349 },
    sourceLocalRange: { startLine: 538, endLine: 555 },
    sourceStartByte: 11806,
    sourceEndByteExclusive: 12368,
    sourceSha256: 'b073c39ed01fef2b64204678036008f763abce9fb17de69c48e49b50496b4dde',
    targetPath: 'src/renderer/styles/features/characters/workspace/s15-05--character-list-width701.css',
  },
  {
    id: 'G140',
    segment: 'G140',
    sectionIds: ['S15-19', 'S15-20'],
    sourceSlice: 'S15',
    owner: 'characters-workspace',
    migrationMode: 'DIRECT',
    canonicalOrder: 169,
    predecessor: 'S15-18/G139',
    successor: 'S15-21/G141',
    sourceRange: { startLine: 31146, endLine: 31592 },
    sourceLocalRange: { startLine: 1352, endLine: 1798 },
    sourceStartByte: 33319,
    sourceEndByteExclusive: 48225,
    sourceSha256: 'b4e38e23661d1cd61b5ce560a078e85ea559547b0bfed21d72658001a5377d2c',
    targetPath: 'src/renderer/styles/features/characters/workspace/s15-19--character-detail-polish-524.css',
  },
  {
    id: 'G142',
    segment: 'G142',
    sectionIds: ['S15-22'],
    sourceSlice: 'S15',
    owner: 'characters-workspace',
    migrationMode: 'DIRECT',
    canonicalOrder: 172,
    predecessor: 'S15-21/G141',
    successor: 'EOF',
    sourceRange: { startLine: 31623, endLine: 31795 },
    sourceLocalRange: { startLine: 1829, endLine: 2001 },
    sourceStartByte: 48908,
    sourceEndByteExclusive: 54582,
    sourceSha256: '68b025472f4d4977e9a0d05d96e7b93fff1c65052e24c41f8325d74bab68bf47',
    targetPath: 'src/renderer/styles/features/characters/workspace/s15-22--character-workspace-consolidated-523.css',
  },
  {
    id: 'G144',
    segment: 'G144',
    sectionIds: ['S16-03'],
    sourceSlice: 'S16',
    owner: 'characters-workspace',
    migrationMode: 'DIRECT',
    canonicalOrder: 175,
    predecessor: 'S16-02/G143',
    successor: 'S16-04/G145',
    sourceRange: { startLine: 32292, endLine: 32303 },
    sourceLocalRange: { startLine: 497, endLine: 508 },
    sourceStartByte: 15552,
    sourceEndByteExclusive: 16060,
    sourceSha256: 'd927995d4b5aec3dc9affe12f364466d7343d43383543e8717158317a9c68724',
    targetPath: 'src/renderer/styles/features/characters/workspace/s16-03--character-rename-final-width360.css',
  },
] as const;

const expectedP205 = [
  {
    id: 'G091',
    segment: 'G091',
    sectionIds: ['S10-03'],
    sourceSlice: 'S10',
    owner: 'characters-expression',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 106,
    predecessor: 'S10-02/G090',
    successor: 'S10-04/G092',
    sourceRange: { startLine: 21031, endLine: 21524 },
    sourceLocalRange: { startLine: 1248, endLine: 1741 },
    sourceStartByte: 38342,
    sourceEndByteExclusive: 49345,
    sourceSha256: '40bbc1319596b69a8d1067c0dfcbd6c743dc5cfd85947251693657098ce0e5ed',
    targetPath: 'src/renderer/styles/features/characters/expression/s10-03--landscape-expression-workbench.css',
  },
  {
    id: 'G125',
    segment: 'G125',
    sectionIds: ['S14-15'],
    sourceSlice: 'S14',
    owner: 'characters-settings',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 150,
    predecessor: 'S14-14/G124',
    successor: 'S15-01/G126',
    sourceRange: { startLine: 29763, endLine: 29794 },
    sourceLocalRange: { startLine: 1766, endLine: 1797 },
    sourceStartByte: 43004,
    sourceEndByteExclusive: 44011,
    sourceSha256: '1bbed87c0472c24aef2ad2cc3f60e422bfe20674ca6e6466d69c40283a88eeba',
    targetPath: 'src/renderer/styles/features/characters/settings/s14-15--mouth-picker-host.css',
  },
  {
    id: 'G143',
    segment: 'G143',
    sectionIds: ['S16-01', 'S16-02'],
    sourceSlice: 'S16',
    owner: 'characters-settings',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 173,
    predecessor: 'S15-22/G142',
    successor: 'S16-03/G144',
    sourceRange: { startLine: 31796, endLine: 32291 },
    sourceLocalRange: { startLine: 1, endLine: 496 },
    sourceStartByte: 0,
    sourceEndByteExclusive: 15552,
    sourceSha256: '096df69c617bc61c40820a24b8b4c2d433211c3df05801b652998d91baeef0d8',
    targetPath: 'src/renderer/styles/features/characters/settings/s16-01--character-settings-and-expression-523.css',
  },
  {
    id: 'G145',
    segment: 'G145',
    sectionIds: ['S16-04', 'S16-05'],
    sourceSlice: 'S16',
    owner: 'characters-settings',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 176,
    predecessor: 'S16-03/G144',
    successor: 'S16-06/G146',
    sourceRange: { startLine: 32304, endLine: 32684 },
    sourceLocalRange: { startLine: 509, endLine: 889 },
    sourceStartByte: 16060,
    sourceEndByteExclusive: 28638,
    sourceSha256: '1b9be030bea32693c92ba07a84a475765e8adc230520dab1e887fcf493a0e713',
    targetPath: 'src/renderer/styles/features/characters/settings/s16-04--character-settings-polish-526.css',
  },
  {
    id: 'G146',
    segment: 'G146',
    sectionIds: ['S16-06'],
    sourceSlice: 'S16',
    owner: 'characters-expression',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 178,
    predecessor: 'S16-05/G145',
    successor: 'S16-07/G147',
    sourceRange: { startLine: 32685, endLine: 32756 },
    sourceLocalRange: { startLine: 890, endLine: 961 },
    sourceStartByte: 28638,
    sourceEndByteExclusive: 31109,
    sourceSha256: '00472563d3fa96f4a49608b3ae0a61cd4cc5f564dd50b04802dbea06dc068ad2',
    targetPath: 'src/renderer/styles/features/characters/expression/s16-06--expression-inline-final-528.css',
  },
] as const;

const p204Ids = expectedP204.map(({ id }) => id);
const p205Ids = expectedP205.map(({ id }) => id);

describe('Issue #548 P2-B02 character workspace relocation', () => {
  it('pins the non-automatic Phase 2 map and all nine P2-04 identities', () => {
    expect(manifest.phase2CanonicalMap).toMatchObject({
      path: 'docs/decisions/PandaStage_Phase2_Canonical_Section_Map_v1.1_2026-09-16.md',
      commit: 'f5d25ef8adddbe88d42dcab2cc2212b4c0203590',
      sha256: '7a7ba422a451ece5cef1af87acbc8b3be4ff92d33deaf7783db9bd23948cbd3b',
      lineCount: 1462,
      approvedForAutomaticRelocation: false,
    });

    const actual = p204Ids.map((id) => {
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
    expect(actual).toEqual(expectedP204);
  });

  it('preserves the P2-04 gaps and the B05-updated S15/S16 handoff', () => {
    expect(manifest.remainderParts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'S05-R02', sourceRange: { startLine: 9303, endLine: 9331 } }),
      expect.objectContaining({ id: 'S05-R03', sourceRange: { startLine: 9349, endLine: 9349 } }),
      expect.objectContaining({ id: 'S07-R04', sourceRange: { startLine: 13578, endLine: 13578 } }),
      expect.objectContaining({ id: 'S07-R05', sourceRange: { startLine: 13632, endLine: 13801 } }),
      expect.objectContaining({ id: 'S10-R01', sourceRange: { startLine: 21525, endLine: 21745 } }),
      expect.objectContaining({ id: 'S10-R02', sourceRange: { startLine: 21767, endLine: 21802 } }),
    ]));

    const s15 = manifest.slices.find(({ id }) => id === 'S15');
    expect(s15?.sourceParts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'G127', kind: 'semantic', sourceRange: { startLine: 300, endLine: 412 } }),
      expect.objectContaining({ id: 'G130', kind: 'semantic', sourceRange: { startLine: 538, endLine: 555 } }),
      expect.objectContaining({ id: 'G139', kind: 'semantic', sourceRange: { startLine: 962, endLine: 1351 } }),
      expect.objectContaining({ id: 'G140', kind: 'semantic', sourceRange: { startLine: 1352, endLine: 1798 } }),
      expect.objectContaining({ id: 'G141', kind: 'semantic', sourceRange: { startLine: 1799, endLine: 1828 } }),
      expect.objectContaining({ id: 'G142', kind: 'semantic', sourceRange: { startLine: 1829, endLine: 2001 } }),
    ]));

    const s16 = manifest.slices.find(({ id }) => id === 'S16');
    expect(s16?.sourceParts).toEqual([
      { id: 'G143', kind: 'semantic', relocationId: 'G143', sourceRange: { startLine: 1, endLine: 496 }, targetPath: 'src/renderer/styles/features/characters/settings/s16-01--character-settings-and-expression-523.css' },
      { id: 'G144', kind: 'semantic', relocationId: 'G144', sourceRange: { startLine: 497, endLine: 508 }, targetPath: 'src/renderer/styles/features/characters/workspace/s16-03--character-rename-final-width360.css' },
      { id: 'G145', kind: 'semantic', relocationId: 'G145', sourceRange: { startLine: 509, endLine: 889 }, targetPath: 'src/renderer/styles/features/characters/settings/s16-04--character-settings-polish-526.css' },
      { id: 'G146', kind: 'semantic', relocationId: 'G146', sourceRange: { startLine: 890, endLine: 961 }, targetPath: 'src/renderer/styles/features/characters/expression/s16-06--expression-inline-final-528.css' },
      { id: 'S16-07', kind: 'semantic', relocationId: 'S16-07', sourceRange: { startLine: 962, endLine: 1023 }, targetPath: 'src/renderer/styles/features/characters/image-picker/s16-07--image-picker-inline-and-host.css' },
    ]);

    const s14 = manifest.slices.find(({ id }) => id === 'S14');
    expect(s14?.sourceParts).toEqual(expect.arrayContaining([
      { id: 'G125', kind: 'semantic', relocationId: 'G125', sourceRange: { startLine: 1766, endLine: 1797 }, targetPath: 'src/renderer/styles/features/characters/settings/s14-15--mouth-picker-host.css' },
    ]));

    for (const id of p205Ids) {
      expect(manifest.semanticRelocations.some((item) => item.id === id)).toBe(true);
    }
  });

  it('loads every P2-04 target exactly once in canonical production order', () => {
    const imports = importPaths();
    const indexes = expectedP204.map(({ targetPath }) => {
      const path = entryImportPath(targetPath);
      expect(imports.filter((candidate) => candidate === path)).toHaveLength(1);
      return imports.indexOf(path);
    });
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));

    const s15 = manifest.slices.find(({ id }) => id === 'S15')!;
    const s15Paths = s15.sourceParts!.map(({ targetPath }) => entryImportPath(targetPath));
    const s15Start = imports.indexOf(s15Paths[0]!);
    expect(imports.slice(s15Start, s15Start + s15Paths.length)).toEqual(s15Paths);
  });

  it('loads every P2-05 target exactly once in canonical production order', () => {
    const imports = importPaths();
    const indexes = expectedP205.map(({ targetPath }) => {
      const path = entryImportPath(targetPath);
      expect(imports.filter((candidate) => candidate === path)).toHaveLength(1);
      return imports.indexOf(path);
    });
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));

    const g124Path = entryImportPath(
      manifest.semanticRelocations.find(({ id }) => id === 'S14-14')!.targetPath,
    );
    const g125Path = entryImportPath(
      manifest.semanticRelocations.find(({ id }) => id === 'G125')!.targetPath,
    );
    expect(imports.indexOf(g125Path)).toBe(imports.indexOf(g124Path) + 1);

    const s16 = manifest.slices.find(({ id }) => id === 'S16')!;
    const s16Paths = s16.sourceParts!.map(({ targetPath }) => entryImportPath(targetPath));
    const s16Start = imports.indexOf(s16Paths[0]!);
    expect(imports.slice(s16Start, s16Start + s16Paths.length)).toEqual(s16Paths);
  });

  it('keeps every P2-04 target byte-exact and reconstructs the pinned stylesheet', () => {
    for (const relocation of expectedP204) {
      const target = normalize(readFileSync(resolve(root, relocation.targetPath), 'utf8'));
      expect(sha256(target)).toBe(relocation.sourceSha256);
      expect(Buffer.byteLength(target, 'utf8')).toBe(
        relocation.sourceEndByteExclusive - relocation.sourceStartByte,
      );
    }

    for (const relocation of expectedP205) {
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
