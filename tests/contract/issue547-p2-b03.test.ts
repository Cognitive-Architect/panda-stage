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

const expectedB03 = [
  {
    id: 'G017',
    segment: 'G017',
    sectionIds: ['S01-18'],
    sourceSlice: 'S01',
    owner: 'assets',
    migrationMode: 'DIRECT',
    canonicalOrder: 18,
    predecessor: 'S01-17/G016',
    successor: 'S01-19/G018',
    sourceRange: { startLine: 1583, endLine: 1671 },
    sourceLocalRange: { startLine: 1581, endLine: 1669 },
    sourceStartByte: 30195,
    sourceEndByteExclusive: 31598,
    sourceSha256: '69305f5a1169f946704ac04ec9cc5dac958dda2aa88370a106a6693abf9d627b',
    targetPath: 'src/renderer/styles/features/assets/s01-18--asset-import-base.css',
  },
  {
    id: 'G033',
    segment: 'G033',
    sectionIds: ['S05-01'],
    sourceSlice: 'S05',
    owner: 'assets',
    migrationMode: 'DIRECT',
    canonicalOrder: 36,
    predecessor: 'S04-05/G032',
    successor: 'S05-02/G034',
    sourceRange: { startLine: 8039, endLine: 8629 },
    sourceLocalRange: { startLine: 1, endLine: 591 },
    sourceStartByte: 0,
    sourceEndByteExclusive: 10643,
    sourceSha256: '0e8ceef06c35eab1b712dff64a0ac0545bb8049b307751d17b3d675b0eaba727',
    targetPath: 'src/renderer/styles/features/assets/s05-01--asset-library-base.css',
  },
  {
    id: 'G035',
    segment: 'G035',
    sectionIds: ['S05-03'],
    sourceSlice: 'S05',
    owner: 'shots',
    migrationMode: 'DIRECT',
    canonicalOrder: 38,
    predecessor: 'S05-02/G034',
    successor: 'S05-04/G036',
    sourceRange: { startLine: 8950, endLine: 9302 },
    sourceLocalRange: { startLine: 912, endLine: 1264 },
    sourceStartByte: 16448,
    sourceEndByteExclusive: 22380,
    sourceSha256: 'b7512c309e5afc63a1b0dcccd9a443d98f8d080242bc4eb5b952a2900c43fb17',
    targetPath: 'src/renderer/styles/features/shots/s05-03--shots-base.css',
  },
  {
    id: 'G037',
    segment: 'G037',
    sectionIds: ['S05-05'],
    sourceSlice: 'S05',
    owner: 'shots',
    migrationMode: 'DIRECT',
    canonicalOrder: 40,
    predecessor: 'S05-04/G036',
    successor: 'S05-06/G038',
    sourceRange: { startLine: 9332, endLine: 9348 },
    sourceLocalRange: { startLine: 1294, endLine: 1310 },
    sourceStartByte: 23048,
    sourceEndByteExclusive: 23289,
    sourceSha256: '956cf443102403bdd7d53cdedd78cf5bcaff6c8aec1beacf7273521c4431b18a',
    targetPath: 'src/renderer/styles/features/shots/s05-05--shot-create-host.css',
  },
  {
    id: 'G058',
    segment: 'G058',
    sectionIds: ['S07-02'],
    sourceSlice: 'S07',
    owner: 'assets',
    migrationMode: 'DIRECT',
    canonicalOrder: 66,
    predecessor: 'S07-01/G057',
    successor: 'S07-03/G059',
    sourceRange: { startLine: 12001, endLine: 12348 },
    sourceLocalRange: { startLine: 118, endLine: 465 },
    sourceStartByte: 3668,
    sourceEndByteExclusive: 14851,
    sourceSha256: '1ade8efb341cfac5425f88421d4a17a89c009a7319220f28e6eb40228f1cdf15',
    targetPath: 'src/renderer/styles/features/assets/s07-02--portrait-assets-content.css',
  },
  {
    id: 'G069',
    segment: 'G069',
    sectionIds: ['S07-13'],
    sourceSlice: 'S07',
    owner: 'shots',
    migrationMode: 'DIRECT',
    canonicalOrder: 77,
    predecessor: 'S07-12/G068',
    successor: 'S07-14/G070',
    sourceRange: { startLine: 13227, endLine: 13366 },
    sourceLocalRange: { startLine: 1344, endLine: 1483 },
    sourceStartByte: 41183,
    sourceEndByteExclusive: 44513,
    sourceSha256: 'f1241d35bf54b636f33a48e0af2209ef21b4e26b4711f5819e762ca7b4d6c8d6',
    targetPath: 'src/renderer/styles/features/shots/s07-13--landscape-shots-original.css',
  },
  {
    id: 'G070',
    segment: 'G070',
    sectionIds: ['S07-14'],
    sourceSlice: 'S07',
    owner: 'assets',
    migrationMode: 'DIRECT',
    canonicalOrder: 78,
    predecessor: 'S07-13/G069',
    successor: 'S07-15/G071',
    sourceRange: { startLine: 13367, endLine: 13577 },
    sourceLocalRange: { startLine: 1484, endLine: 1694 },
    sourceStartByte: 44513,
    sourceEndByteExclusive: 49027,
    sourceSha256: '8e1460ff070faa20b3599b50f7eb913237f4f84a8d28ce788c23306e065408bb',
    targetPath: 'src/renderer/styles/features/assets/s07-14--landscape-assets-original.css',
  },
  {
    id: 'G078',
    segment: 'G078',
    sectionIds: ['S08-07'],
    sourceSlice: 'S08',
    owner: 'shots',
    migrationMode: 'DIRECT',
    canonicalOrder: 87,
    predecessor: 'S08-06/G077',
    successor: 'S08-08/G079',
    sourceRange: { startLine: 15159, endLine: 15588 },
    sourceLocalRange: { startLine: 1358, endLine: 1787 },
    sourceStartByte: 40003,
    sourceEndByteExclusive: 54463,
    sourceSha256: '66f38eac3e33f24b42cd98c06a7d250937c9cd0d3ab133d5807a145e78d2d5d8',
    targetPath: 'src/renderer/styles/features/shots/s08-07--portrait-shot-detail.css',
  },
  {
    id: 'G086',
    segment: 'G086',
    sectionIds: ['S09-05', 'S09-06'],
    sourceSlice: 'S09',
    owner: 'shots',
    migrationMode: 'DIRECT',
    canonicalOrder: 100,
    predecessor: 'S09-04/G085',
    successor: 'S09-07/G087',
    sourceRange: { startLine: 18828, endLine: 19325 },
    sourceLocalRange: { startLine: 1009, endLine: 1506 },
    sourceStartByte: 32286,
    sourceEndByteExclusive: 44982,
    sourceSha256: '66c2a087e0f44484b7b26feb1e3ca66da2d1e3b484fe2a9c37c0000b169d15f7',
    targetPath: 'src/renderer/styles/features/shots/s09-05--landscape-shot-quick-actions.css',
  },
  {
    id: 'G088',
    segment: 'G088',
    sectionIds: ['S09-08'],
    sourceSlice: 'S09',
    owner: 'assets',
    migrationMode: 'DIRECT',
    canonicalOrder: 103,
    predecessor: 'S09-07/G087',
    successor: 'EOF',
    sourceRange: { startLine: 19326, endLine: 19783 },
    sourceLocalRange: { startLine: 1507, endLine: 1964 },
    sourceStartByte: 44982,
    sourceEndByteExclusive: 60652,
    sourceSha256: '7f4b0b230e9db16be96a1ffb5f269e37c127eb4a243ff47683cca1bbe1683180',
    targetPath: 'src/renderer/styles/features/assets/s09-08--landscape-asset-visual.css',
  },
  {
    id: 'G138',
    segment: 'G138',
    sectionIds: ['S15-17'],
    sourceSlice: 'S15',
    owner: 'shots',
    migrationMode: 'DIRECT',
    canonicalOrder: 167,
    predecessor: 'S15-16/G137',
    successor: 'S15-18/G139',
    sourceRange: { startLine: 30747, endLine: 30755 },
    sourceLocalRange: { startLine: 953, endLine: 961 },
    sourceStartByte: 23612,
    sourceEndByteExclusive: 23817,
    sourceSha256: 'd8a22949a149c3d284c8dc37fb219e0b08613a69fff4c7d01dbc8be2745ee46d',
    targetPath: 'src/renderer/styles/features/shots/s15-17--ready-thumbnail-final-508.css',
  },
] as const;

const b03Ids = expectedB03.map(({ id }) => id);

describe('Issue #547 P2-B03 assets and shots relocation', () => {
  it('pins the non-automatic Phase 2 map and all eleven B03 identities', () => {
    expect(manifest.phase2CanonicalMap).toMatchObject({
      path: 'docs/decisions/PandaStage_Phase2_Canonical_Section_Map_v1.1_2026-09-16.md',
      commit: 'f5d25ef8adddbe88d42dcab2cc2212b4c0203590',
      sha256: '7a7ba422a451ece5cef1af87acbc8b3be4ff92d33deaf7783db9bd23948cbd3b',
      lineCount: 1462,
      approvedForAutomaticRelocation: false,
    });

    const actual = b03Ids.map((id) => {
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
    expect(actual).toEqual(expectedB03);
  });

  it('declares every untouched gap around the interior asset and shot relocations', () => {
    expect(manifest.remainderParts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'S01-R01', sourceRange: { startLine: 60, endLine: 77 } }),
      expect.objectContaining({ id: 'S01-R02', sourceRange: { startLine: 158, endLine: 949 } }),
      expect.objectContaining({ id: 'S01-R03', sourceRange: { startLine: 1325, endLine: 1391 } }),
      expect.objectContaining({ id: 'S05-R02', sourceRange: { startLine: 9303, endLine: 9331 } }),
      expect.objectContaining({ id: 'S05-R03', sourceRange: { startLine: 9349, endLine: 9349 } }),
      expect.objectContaining({ id: 'S07-R01', sourceRange: { startLine: 11884, endLine: 12000 } }),
      expect.objectContaining({ id: 'S07-R03', sourceRange: { startLine: 12349, endLine: 12576 } }),
      expect.objectContaining({ id: 'S07-R06', sourceRange: { startLine: 12695, endLine: 12853 } }),
      expect.objectContaining({ id: 'S07-R02', sourceRange: { startLine: 12953, endLine: 13226 } }),
      expect.objectContaining({ id: 'S07-R04', sourceRange: { startLine: 13578, endLine: 13578 } }),
      expect.objectContaining({ id: 'S07-R05', sourceRange: { startLine: 13632, endLine: 13801 } }),
      expect.objectContaining({ id: 'S08-R01', sourceRange: { startLine: 13802, endLine: 13982 } }),
      expect.objectContaining({ id: 'S08-R04', sourceRange: { startLine: 14158, endLine: 14502 } }),
      expect.objectContaining({ id: 'S08-R05', sourceRange: { startLine: 14620, endLine: 15158 } }),
      expect.objectContaining({ id: 'S08-R03', sourceRange: { startLine: 15589, endLine: 16456 } }),
      expect.objectContaining({ id: 'S09-R01', sourceRange: { startLine: 17820, endLine: 18217 } }),
      expect.objectContaining({ id: 'S09-R02', sourceRange: { startLine: 18755, endLine: 18827 } }),
    ]));

    const s15 = manifest.slices.find(({ id }) => id === 'S15');
    expect(s15?.sourceParts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'G138',
        kind: 'semantic',
        relocationId: 'G138',
        sourceRange: { startLine: 953, endLine: 961 },
        targetPath: 'src/renderer/styles/features/shots/s15-17--ready-thumbnail-final-508.css',
      }),
      expect.objectContaining({
        id: 'G139',
        kind: 'semantic',
        relocationId: 'G139',
        sourceRange: { startLine: 962, endLine: 1351 },
        targetPath: 'src/renderer/styles/features/subtitles/controls/s15-18--subtitle-style-base-521.css',
      }),
      expect.objectContaining({
        id: 'G140',
        kind: 'semantic',
        relocationId: 'G140',
        sourceRange: { startLine: 1352, endLine: 1798 },
        targetPath: 'src/renderer/styles/features/characters/workspace/s15-19--character-detail-polish-524.css',
      }),
      expect.objectContaining({
        id: 'G141',
        kind: 'semantic',
        relocationId: 'G141',
        sourceRange: { startLine: 1799, endLine: 1828 },
        targetPath: 'src/renderer/styles/features/subtitles/controls/s15-21--subtitle-style-container300.css',
      }),
      expect.objectContaining({
        id: 'G142',
        kind: 'semantic',
        relocationId: 'G142',
        sourceRange: { startLine: 1829, endLine: 2001 },
        targetPath: 'src/renderer/styles/features/characters/workspace/s15-22--character-workspace-consolidated-523.css',
      }),
    ]));
  });

  it('loads every B03 target exactly once in canonical production order', () => {
    const imports = importPaths();
    const relocations = b03Ids.map((id) => manifest.semanticRelocations.find((item) => item.id === id)!);
    const indexes = relocations.map(({ targetPath }) => {
      const path = entryImportPath(targetPath);
      expect(imports.filter((candidate) => candidate === path)).toHaveLength(1);
      return imports.indexOf(path);
    });

    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    expect(relocations.map(({ canonicalOrder }) => canonicalOrder)).toEqual(
      expectedB03.map(({ canonicalOrder }) => canonicalOrder),
    );

    const b04EndPath = entryImportPath(
      manifest.semanticRelocations.find(({ id }) => id === 'G137')!.targetPath,
    );
    const b03StartPath = entryImportPath(
      manifest.semanticRelocations.find(({ id }) => id === 'G138')!.targetPath,
    );
    expect(imports.indexOf(b03StartPath)).toBe(imports.indexOf(b04EndPath) + 1);
  });

  it('keeps each B03 target byte-exact and reconstructs the pinned stylesheet', () => {
    for (const relocation of expectedB03) {
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
