import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Range = { startLine: number; endLine: number };
type SourceSegment = {
  sourceSlice: string;
  sourceRange: Range;
  sourceLocalRange: Range;
  sourceStartByte: number;
  sourceEndByteExclusive: number;
  sourceSha256: string;
};
type Relocation = {
  id: string;
  segment: string;
  sectionIds: string[];
  sourceSlice: string;
  owner: string;
  migrationMode: string;
  canonicalOrder: number;
  predecessor: string;
  successor: string;
  sourceRange: Range;
  sourceLocalRange: Range;
  sourceSegments?: SourceSegment[];
  sourceStartByte: number;
  sourceEndByteExclusive: number;
  sourceSha256: string;
  targetPath: string;
};
type Manifest = {
  phase2CanonicalMap: {
    path: string;
    sha256: string;
    approvedForAutomaticRelocation: boolean;
  };
  rootEntry: { path: string };
  semanticRelocations: Relocation[];
  remainderParts: Array<{ id: string; sourceRange: Range; targetPath: string }>;
};

const root = resolve(process.cwd());
const manifest = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'css-split-manifest.json'), 'utf8'),
) as Manifest;

const expectedP216: Relocation[] = [
  {
    id: 'G008', segment: 'G008', sectionIds: ['S01-08'], sourceSlice: 'S01', owner: 'shell-resources',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 8, predecessor: 'S01-07/G007', successor: 'S01-09/G009',
    sourceRange: { startLine: 555, endLine: 851 }, sourceLocalRange: { startLine: 553, endLine: 849 },
    sourceStartByte: 10740, sourceEndByteExclusive: 16288,
    sourceSha256: '9b2363f27301f9128a14c3c2ec0d737a990b03b663187aafa158a9f151589ee0',
    targetPath: 'src/renderer/styles/shell/resources/s01-08--resource-host-base.css',
  },
  {
    id: 'G036', segment: 'G036', sectionIds: ['S05-04'], sourceSlice: 'S05', owner: 'shell-resources',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 39, predecessor: 'S05-03/G035', successor: 'S05-05/G037',
    sourceRange: { startLine: 9304, endLine: 9331 }, sourceLocalRange: { startLine: 1266, endLine: 1293 },
    sourceStartByte: 22381, sourceEndByteExclusive: 23048,
    sourceSha256: 'fc8ca543b63c31cbb224d4c52f74c20d8e43b486f87b44323e36c4d59f03e947',
    targetPath: 'src/renderer/styles/shell/resources/s05-04--shot-character-shared-host.css',
  },
  {
    id: 'G057', segment: 'G057', sectionIds: ['S06-16', 'S07-01'], sourceSlice: 'S06', owner: 'shell-resources',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 64, predecessor: 'S06-15/G056', successor: 'S07-02/G058',
    sourceRange: { startLine: 11801, endLine: 12000 }, sourceLocalRange: { startLine: 1962, endLine: 2044 },
    sourceSegments: [
      {
        sourceSlice: 'S06', sourceRange: { startLine: 11801, endLine: 11883 }, sourceLocalRange: { startLine: 1962, endLine: 2044 },
        sourceStartByte: 40314, sourceEndByteExclusive: 42901,
        sourceSha256: 'e4057c165ef3686b537a282e3a01220844954bb33ba188f5deb468c79020c8ae',
      },
      {
        sourceSlice: 'S07', sourceRange: { startLine: 11884, endLine: 12000 }, sourceLocalRange: { startLine: 1, endLine: 117 },
        sourceStartByte: 0, sourceEndByteExclusive: 3668,
        sourceSha256: '32ad95f171334f8f36f8a106788f049ab728e3d4f80cf0b9914153815c28f3ba',
      },
    ],
    sourceStartByte: 40314, sourceEndByteExclusive: 46569,
    sourceSha256: 'd2750f283543215787107be4434cf5007846bb10c98f147785d9dce61f23a9e3',
    targetPath: 'src/renderer/styles/shell/resources/s06-16--portrait-shot-header.css',
  },
  {
    id: 'G060', segment: 'G060', sectionIds: ['S07-04'], sourceSlice: 'S07', owner: 'shell-resources',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 68, predecessor: 'S07-03/G059', successor: 'S07-05/G061',
    sourceRange: { startLine: 12362, endLine: 12376 }, sourceLocalRange: { startLine: 479, endLine: 493 },
    sourceStartByte: 15226, sourceEndByteExclusive: 15572,
    sourceSha256: 'f6ce6220019fb0fb966f8c1ab2290433a0c7ed443e9d069137ad1f92c6f9d0df',
    targetPath: 'src/renderer/styles/shell/resources/s07-04--portrait-assets-hidden-title.css',
  },
  {
    id: 'G068', segment: 'G068', sectionIds: ['S07-12'], sourceSlice: 'S07', owner: 'shell-resources',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 76, predecessor: 'S07-11/G067', successor: 'S07-13/G069',
    sourceRange: { startLine: 12953, endLine: 13226 }, sourceLocalRange: { startLine: 1070, endLine: 1343 },
    sourceStartByte: 33774, sourceEndByteExclusive: 41183,
    sourceSha256: 'be986aa41e61255632994beb2458e8ee1c81dcecc7c9b68b401bc86afe3eddf8',
    targetPath: 'src/renderer/styles/shell/resources/s07-12--landscape-resource-rail.css',
  },
  {
    id: 'G087', segment: 'G087', sectionIds: ['S09-07'], sourceSlice: 'S09', owner: 'shell-resources',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 102, predecessor: 'S09-06/G086', successor: 'S09-08/G088',
    sourceRange: { startLine: 19326, endLine: 19387 }, sourceLocalRange: { startLine: 1507, endLine: 1568 },
    sourceStartByte: 44982, sourceEndByteExclusive: 47548,
    sourceSha256: '3841bc1c8ad7407a41586803da08ef9dd7d97f1a211f1fef14d4511b28cec89a',
    targetPath: 'src/renderer/styles/shell/resources/s09-07--landscape-asset-header.css',
  },
  {
    id: 'G089', segment: 'G089', sectionIds: ['S10-01'], sourceSlice: 'S10', owner: 'shell-resources',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 104, predecessor: 'S09-08/G088', successor: 'S10-02/G090',
    sourceRange: { startLine: 19784, endLine: 19794 }, sourceLocalRange: { startLine: 1, endLine: 11 },
    sourceStartByte: 0, sourceEndByteExclusive: 504,
    sourceSha256: 'd500e41b0840c6490203e9c52162496809198848d018bf82601b9f5feec3dde8',
    targetPath: 'src/renderer/styles/shell/resources/s10-01--character-detail-header.css',
  },
  {
    id: 'G093', segment: 'G093', sectionIds: ['S10-05'], sourceSlice: 'S10', owner: 'shell-resources',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 108, predecessor: 'S10-04/G092', successor: 'S10-06/G094',
    sourceRange: { startLine: 21609, endLine: 21671 }, sourceLocalRange: { startLine: 1826, endLine: 1888 },
    sourceStartByte: 51497, sourceEndByteExclusive: 53229,
    sourceSha256: 'a20863c25f147ab3744ed99cc439377bfe04625b6b8674e44c8b5abb3642ed64',
    targetPath: 'src/renderer/styles/shell/resources/s10-05--landscape-rail-polish.css',
  },
];

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

function project(relocation: Relocation) {
  return {
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
}

describe('Issue #551 P2-16 left Resource Host contract', () => {
  it('registers the eight approved host segments and all nine Sections', () => {
    const ids = expectedP216.map(({ id }) => id);
    const actual = manifest.semanticRelocations
      .filter(({ id }) => ids.includes(id))
      .sort((left, right) => left.canonicalOrder - right.canonicalOrder);

    expect(actual.map(({ id }) => id)).toEqual(ids);
    expect(actual.map(project)).toEqual(expectedP216.map(project));
    expect(new Set(actual.flatMap(({ sectionIds }) => sectionIds))).toEqual(new Set([
      'S01-08', 'S05-04', 'S06-16', 'S07-01', 'S07-04', 'S07-12', 'S09-07', 'S10-01', 'S10-05',
    ]));

    for (const expected of expectedP216) {
      const actualSegment = manifest.semanticRelocations.find(({ id }) => id === expected.id);
      if (expected.sourceSegments) expect(actualSegment?.sourceSegments).toEqual(expected.sourceSegments);
    }
  });

  it('loads each host target exactly once at canonical source order', () => {
    const imports = importPaths();
    const expectedImports = expectedP216.map(({ targetPath }) => entryImportPath(targetPath));

    for (const expectedImport of expectedImports) {
      expect(imports.filter((candidate) => candidate === expectedImport)).toHaveLength(1);
    }
    expect(imports.filter((candidate) => expectedImports.includes(candidate))).toEqual(expectedImports);
  });

  it('keeps host targets byte-exact after Phase 3 begins', () => {
    for (const expected of expectedP216) {
      const target = normalize(readFileSync(resolve(root, expected.targetPath), 'utf8'));
      expect(sha256(target)).toBe(expected.sourceSha256);
      expect(Buffer.byteLength(target, 'utf8')).toBe(
        expected.sourceEndByteExclusive - expected.sourceStartByte,
      );
    }

  });

  it('preserves the Resource rail geometry owners and the G112 boundary', () => {
    expect(manifest.phase2CanonicalMap.approvedForAutomaticRelocation).toBe(false);
    expect(manifest.semanticRelocations.find(({ id }) => id === 'G112')).toMatchObject({
      sourceRange: { startLine: 27860, endLine: 27997 },
      migrationMode: 'ORDERED_COMPAT',
    });
    expect(manifest.remainderParts.find(({ id }) => id === 'S13-R02')).toBeUndefined();

    const rail = readFileSync(
      resolve(root, 'src/renderer/styles/shell/resources/s07-12--landscape-resource-rail.css'),
      'utf8',
    );
    const railPolish = readFileSync(
      resolve(root, 'src/renderer/styles/shell/resources/s10-05--landscape-rail-polish.css'),
      'utf8',
    );
    const bottomWorkspace = readFileSync(resolve(root, 'src/renderer/shell/BottomWorkspace.tsx'), 'utf8');

    expect(rail).toContain('.resource-activity-rail');
    expect(rail).toContain('min-height: 72px;');
    expect(rail).toContain('gap: 8px;');
    expect(railPolish).toContain('.resource-activity-rail');
    expect(railPolish).toContain('min-height: 72px;');
    expect(bottomWorkspace).toContain('LANDSCAPE_RAIL_BUTTON_MIN_HEIGHT = 72');
    expect(bottomWorkspace).toContain('LANDSCAPE_RAIL_GAP = 8');
    expect(bottomWorkspace).toContain('[data-testid="resource-activity-rail"]');
    expect(bottomWorkspace).toContain('timelineUiStore.setHeightMax(bounds.maxHeight)');
  });
});
