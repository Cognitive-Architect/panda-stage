import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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

const expectedB04 = [
  {
    id: 'G021',
    segment: 'G021',
    sectionIds: ['S02-04'],
    sourceSlice: 'S02',
    owner: 'dialogue-workspace',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 23,
    predecessor: 'S02-03/G020',
    successor: 'S02-05/G022',
    sourceRange: { startLine: 2898, endLine: 3903 },
    sourceLocalRange: { startLine: 947, endLine: 1952 },
    sourceStartByte: 20830,
    sourceEndByteExclusive: 47111,
    sourceSha256: '281b0446516336d6538342f52cd9222c858e057c782c341a9d084e065517fc92',
    targetPath: 'src/renderer/styles/features/dialogue/workspace/s02-04--right-workspace-queue-authoring.css',
  },
  {
    id: 'G053',
    segment: 'G053',
    sectionIds: ['S06-11'],
    sourceSlice: 'S06',
    owner: 'dialogue-workspace',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 59,
    predecessor: 'S06-10/G052',
    successor: 'S06-12/G054',
    sourceRange: { startLine: 11054, endLine: 11263 },
    sourceLocalRange: { startLine: 1215, endLine: 1424 },
    sourceStartByte: 22894,
    sourceEndByteExclusive: 26261,
    sourceSha256: 'c0f4d78ea9c7e387b045d2d8d68e5b25c8989a5ef9f3ae9993ee7f22d7de8d67',
    targetPath: 'src/renderer/styles/features/dialogue/workspace/s06-11--dialogue-base.css',
  },
  {
    id: 'G113',
    segment: 'G113',
    sectionIds: ['S14-01'],
    sourceSlice: 'S14',
    owner: 'dialogue-workspace',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 136,
    predecessor: 'S13-05/G112',
    successor: 'S14-02/G114',
    sourceRange: { startLine: 27998, endLine: 28027 },
    sourceLocalRange: { startLine: 1, endLine: 30 },
    sourceStartByte: 0,
    sourceEndByteExclusive: 1025,
    sourceSha256: '3a6fa3640e29e7fd292af82339e51d80b7dc9ae8655033a8514164a8cad3134d',
    targetPath: 'src/renderer/styles/features/dialogue/workspace/s14-01--pending-hints-443.css',
  },
  {
    id: 'G114',
    segment: 'G114',
    sectionIds: ['S14-02'],
    sourceSlice: 'S14',
    owner: 'dialogue-batch',
    migrationMode: 'DIRECT',
    canonicalOrder: 137,
    predecessor: 'S14-01/G113',
    successor: 'S14-03/G115',
    sourceRange: { startLine: 28028, endLine: 28217 },
    sourceLocalRange: { startLine: 31, endLine: 220 },
    sourceStartByte: 1025,
    sourceEndByteExclusive: 5132,
    sourceSha256: '83f0b3053f141f291a6473490f9c2d281dd5ce44dd4a6fe2e0913009fb7335b5',
    targetPath: 'src/renderer/styles/features/dialogue/batch/s14-02--batch-447.css',
  },
  {
    id: 'G118',
    segment: 'G118',
    sectionIds: ['S14-06'],
    sourceSlice: 'S14',
    owner: 'dialogue-batch',
    migrationMode: 'DIRECT',
    canonicalOrder: 141,
    predecessor: 'S14-05/G117',
    successor: 'S14-07/G119',
    sourceRange: { startLine: 28582, endLine: 28593 },
    sourceLocalRange: { startLine: 585, endLine: 596 },
    sourceStartByte: 13997,
    sourceEndByteExclusive: 14255,
    sourceSha256: 'd755fc1d120d4556be21728601f09e170ce8345349c55e24ecf78094a97b7b3c',
    targetPath: 'src/renderer/styles/features/dialogue/batch/s14-06--batch-footer-host.css',
  },
  {
    id: 'G132',
    segment: 'G132',
    sectionIds: ['S15-07', 'S15-08', 'S15-09', 'S15-10', 'S15-11'],
    sourceSlice: 'S15',
    owner: 'dialogue-workspace',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 157,
    predecessor: 'S15-06/G131',
    successor: 'S15-12/G133',
    sourceRange: { startLine: 30427, endLine: 30634 },
    sourceLocalRange: { startLine: 633, endLine: 840 },
    sourceStartByte: 14303,
    sourceEndByteExclusive: 20751,
    sourceSha256: '22d5d9e157ad218784074b0b6abbd41047cd67c0e1062ceb6d3a82b1bf56c09b',
    targetPath: 'src/renderer/styles/features/dialogue/workspace/s15-07--new-dialogue-hierarchy.css',
  },
  {
    id: 'G134',
    segment: 'G134',
    sectionIds: ['S15-13'],
    sourceSlice: 'S15',
    owner: 'dialogue-workspace',
    migrationMode: 'DIRECT+HOST_INTEGRATION',
    canonicalOrder: 163,
    predecessor: 'S15-12/G133',
    successor: 'S15-14/G135',
    sourceRange: { startLine: 30645, endLine: 30660 },
    sourceLocalRange: { startLine: 851, endLine: 866 },
    sourceStartByte: 20975,
    sourceEndByteExclusive: 21516,
    sourceSha256: '03cff3383ad58c1b009acf9d04d30ae10e5a24f999703c96605bb59a01104ea6',
    targetPath: 'src/renderer/styles/features/dialogue/workspace/s15-13--new-dialogue-header-footer-502.css',
  },
  {
    id: 'G137',
    segment: 'G137',
    sectionIds: ['S15-16'],
    sourceSlice: 'S15',
    owner: 'dialogue-batch',
    migrationMode: 'DIRECT',
    canonicalOrder: 166,
    predecessor: 'S15-15/G136',
    successor: 'S15-17/G138',
    sourceRange: { startLine: 30708, endLine: 30746 },
    sourceLocalRange: { startLine: 914, endLine: 952 },
    sourceStartByte: 22664,
    sourceEndByteExclusive: 23612,
    sourceSha256: '5093931553731d510811dbc4a0b3e01ac6d815584a643999ae81702fc0aed280',
    targetPath: 'src/renderer/styles/features/dialogue/batch/s15-16--batch-final-505.css',
  },
] as const;

const b04Ids = expectedB04.map(({ id }) => id);

describe('Issue #547 P2-B04 dialogue workspace and batch relocation', () => {
  it('pins the non-automatic Phase 2 map and all eight B04 identities', () => {
    expect(manifest.phase2CanonicalMap).toMatchObject({
      path: 'docs/decisions/PandaStage_Phase2_Canonical_Section_Map_v1.1_2026-09-16.md',
      commit: 'f5d25ef8adddbe88d42dcab2cc2212b4c0203590',
      sha256: '7a7ba422a451ece5cef1af87acbc8b3be4ff92d33deaf7783db9bd23948cbd3b',
      lineCount: 1462,
      approvedForAutomaticRelocation: false,
    });

    const actual = b04Ids.map((id) => {
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
    expect(actual).toEqual(expectedB04);
  });

  it('keeps dialogue workspace and batch source parts contiguous at the B04 seams', () => {
    const expectedParts = {
      S14: [
        ['G113', 'semantic', 1, 30],
        ['G114', 'semantic', 31, 220],
        ['G116', 'semantic', 413, 483],
        ['G118', 'semantic', 585, 596],
        ['G120', 'semantic', 888, 923],
        ['G121', 'semantic', 924, 1226],
        ['G122', 'semantic', 1227, 1286],
        ['S14-14', 'semantic', 1432, 1765],
        ['G125', 'semantic', 1766, 1797],
      ],
      S15: [
        ['G132', 'semantic', 633, 840],
        ['G134', 'semantic', 851, 866],
        ['G137', 'semantic', 914, 952],
      ],
    } as const;

    for (const [sliceId, selectedParts] of Object.entries(expectedParts)) {
      const slice = manifest.slices.find(({ id }) => id === sliceId);
      expect(slice?.sourceParts).toBeDefined();
      for (const [id, kind, startLine, endLine] of selectedParts) {
        expect(slice!.sourceParts).toContainEqual(expect.objectContaining({
          id,
          kind,
          sourceRange: { startLine, endLine },
        }));
      }
    }

    expect(manifest.semanticRelocations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'G054',
        sourceRange: { startLine: 11264, endLine: 11440 },
      }),
      expect.objectContaining({
        id: 'G056',
        sourceRange: { startLine: 11516, endLine: 11800 },
      }),
    ]));
  });

  it('loads every B04 target exactly once in canonical production order', () => {
    const imports = importPaths();
    const relocations = b04Ids.map((id) => manifest.semanticRelocations.find((item) => item.id === id)!);
    const indexes = relocations.map(({ targetPath }) => {
      const path = entryImportPath(targetPath);
      expect(imports.filter((candidate) => candidate === path)).toHaveLength(1);
      return imports.indexOf(path);
    });

    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    expect(relocations.map(({ canonicalOrder }) => canonicalOrder)).toEqual(
      expectedB04.map(({ canonicalOrder }) => canonicalOrder),
    );

    const s14 = manifest.slices.find(({ id }) => id === 'S14')!;
    const s14Paths = s14.sourceParts!.map(({ targetPath }) => entryImportPath(targetPath));
    const s14Start = imports.indexOf(s14Paths[0]!);
    expect(imports.slice(s14Start, s14Start + s14Paths.length)).toEqual(s14Paths);

    const s15 = manifest.slices.find(({ id }) => id === 'S15')!;
    const s15Paths = s15.sourceParts!.map(({ targetPath }) => entryImportPath(targetPath));
    const s15Start = imports.indexOf(s15Paths[0]!);
    expect(imports.slice(s15Start, s15Start + s15Paths.length)).toEqual(s15Paths);
  });

  it('keeps each B04 target byte-exact after Phase 3 begins', () => {
    for (const relocation of expectedB04) {
      const target = normalize(readFileSync(resolve(root, relocation.targetPath), 'utf8'));
      expect(sha256(target)).toBe(relocation.sourceSha256);
      expect(Buffer.byteLength(target, 'utf8')).toBe(
        relocation.sourceEndByteExclusive - relocation.sourceStartByte,
      );
    }

  });
});
