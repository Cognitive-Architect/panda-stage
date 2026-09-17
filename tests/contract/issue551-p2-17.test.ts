import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

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

const expectedP217: Relocation[] = [
  {
    id: 'G007', segment: 'G007', sectionIds: ['S01-07'], sourceSlice: 'S01', owner: 'shell-right',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 7, predecessor: 'S01-06/G006', successor: 'S01-08/G008',
    sourceRange: { startLine: 432, endLine: 554 }, sourceLocalRange: { startLine: 430, endLine: 552 },
    sourceStartByte: 8060, sourceEndByteExclusive: 10740,
    sourceSha256: '87e487eee048bce5abff96d31b3c5f480dd70c522b78c13d926474b059c150be',
    targetPath: 'src/renderer/styles/shell/right-workspace/s01-07--inspector-and-layer-host.css',
  },
  {
    id: 'G020', segment: 'G020', sectionIds: ['S02-03'], sourceSlice: 'S02', owner: 'shell-right',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 22, predecessor: 'S02-02/G019', successor: 'S02-04/G021',
    sourceRange: { startLine: 2706, endLine: 2897 }, sourceLocalRange: { startLine: 755, endLine: 946 },
    sourceStartByte: 16381, sourceEndByteExclusive: 20830,
    sourceSha256: '7eda92470b42a5f7a0a21293956ee0524a56b3c7f40238e977d42811fb74184b',
    targetPath: 'src/renderer/styles/shell/right-workspace/s02-03--right-workspace.css',
  },
  {
    id: 'G022', segment: 'G022', sectionIds: ['S02-05'], sourceSlice: 'S02', owner: 'shell-right',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 24, predecessor: 'S02-04/G021', successor: 'S03-01/G023',
    sourceRange: { startLine: 3904, endLine: 3916 }, sourceLocalRange: { startLine: 1953, endLine: 1965 },
    sourceStartByte: 47111, sourceEndByteExclusive: 47496,
    sourceSha256: '2466d64cffb000d48b1f87069bd67dabadf7a86f7f63b6999c01770038e864ae',
    targetPath: 'src/renderer/styles/shell/right-workspace/s02-05--right-workspace-width-1050.css',
  },
  {
    id: 'G055', segment: 'G055', sectionIds: ['S06-13'], sourceSlice: 'S06', owner: 'shell-right',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 61, predecessor: 'S06-12/G054', successor: 'S06-14/G056',
    sourceRange: { startLine: 11441, endLine: 11515 }, sourceLocalRange: { startLine: 1602, endLine: 1676 },
    sourceStartByte: 30487, sourceEndByteExclusive: 32709,
    sourceSha256: '4df21587801b77dab6b7f195e9d26a3323259fff7d4f2573093a98ea4f4d21b7',
    targetPath: 'src/renderer/styles/shell/right-workspace/s06-13--legacy-landscape-inspector-handle.css',
  },
  {
    id: 'G059', segment: 'G059', sectionIds: ['S07-03'], sourceSlice: 'S07', owner: 'shell-right',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 67, predecessor: 'S07-02/G058', successor: 'S07-04/G060',
    sourceRange: { startLine: 12349, endLine: 12361 }, sourceLocalRange: { startLine: 466, endLine: 478 },
    sourceStartByte: 14851, sourceEndByteExclusive: 15226,
    sourceSha256: '613b075a60b879e1eca11b0d376e170e17caa66b63eea8b90b49996cc94fc9b9',
    targetPath: 'src/renderer/styles/shell/right-workspace/s07-03--portrait-inspector-host.css',
  },
  {
    id: 'G061', segment: 'G061', sectionIds: ['S07-05'], sourceSlice: 'S07', owner: 'shell-right',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 69, predecessor: 'S07-04/G060', successor: 'S07-06/G062',
    sourceRange: { startLine: 12377, endLine: 12548 }, sourceLocalRange: { startLine: 494, endLine: 665 },
    sourceStartByte: 15572, sourceEndByteExclusive: 21081,
    sourceSha256: 'c0a8cfd91d323a6f48d112b963ba27c9fa554f7408fe60e98143be31556f09c6',
    targetPath: 'src/renderer/styles/shell/right-workspace/s07-05--portrait-inspector-drawer.css',
  },
  {
    id: 'G072', segment: 'G072', sectionIds: ['S07-16', 'S08-01'], sourceSlice: 'S07', owner: 'shell-right',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 80, predecessor: 'S07-15/G071', successor: 'S08-02/G073',
    sourceRange: { startLine: 13632, endLine: 13982 }, sourceLocalRange: { startLine: 1749, endLine: 1918 },
    sourceSegments: [
      {
        sourceSlice: 'S07', sourceRange: { startLine: 13632, endLine: 13801 }, sourceLocalRange: { startLine: 1749, endLine: 1918 },
        sourceStartByte: 50165, sourceEndByteExclusive: 54194,
        sourceSha256: 'b6f649bd99c3e1d7c4df3fffe72766e17e706947905d176884893a1f89d9aea8',
      },
      {
        sourceSlice: 'S08', sourceRange: { startLine: 13802, endLine: 13982 }, sourceLocalRange: { startLine: 1, endLine: 181 },
        sourceStartByte: 0, sourceEndByteExclusive: 3964,
        sourceSha256: '42d9792e6f7fb413c51dcaa85c56f9da4a2be746918d9872a9232a73d60d186c',
      },
    ],
    sourceStartByte: 50165, sourceEndByteExclusive: 58158,
    sourceSha256: '1ecbc9d0c8ab7a2cd428f732261b8c0d5ecd51faf46bf2e0ccfa9e1e809ef69b',
    targetPath: 'src/renderer/styles/shell/right-workspace/s07-16--landscape-inspector-host.css',
  },
  {
    id: 'G074', segment: 'G074', sectionIds: ['S08-03'], sourceSlice: 'S08', owner: 'shell-right',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 83, predecessor: 'S08-02/G073', successor: 'S08-04/G075',
    sourceRange: { startLine: 14158, endLine: 14502 }, sourceLocalRange: { startLine: 357, endLine: 701 },
    sourceStartByte: 7885, sourceEndByteExclusive: 18427,
    sourceSha256: 'b5994f4969036d97f5faee33dcecc073f87d405244e18991bd1bea6318192fbf',
    targetPath: 'src/renderer/styles/shell/right-workspace/s08-03--portrait-properties-flatten.css',
  },
  {
    id: 'G079', segment: 'G079', sectionIds: ['S08-08'], sourceSlice: 'S08', owner: 'shell-right',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 88, predecessor: 'S08-07/G078', successor: 'S08-09/G080',
    sourceRange: { startLine: 15589, endLine: 15732 }, sourceLocalRange: { startLine: 1788, endLine: 1931 },
    sourceStartByte: 54463, sourceEndByteExclusive: 58701,
    sourceSha256: 'e93bea7dfe2e92902a1888591960c5bbf7ed6374c3503aff313901bbc9232642',
    targetPath: 'src/renderer/styles/shell/right-workspace/s08-08--portrait-empty-properties.css',
  },
  {
    id: 'G099', segment: 'G099', sectionIds: ['S11-03', 'S11-04'], sourceSlice: 'S11', owner: 'shell-right',
    migrationMode: 'HOST_INTEGRATION', canonicalOrder: 114, predecessor: 'S11-02/G098', successor: 'S11-05/G100',
    sourceRange: { startLine: 21879, endLine: 22049 }, sourceLocalRange: { startLine: 77, endLine: 160 },
    sourceSegments: [
      {
        sourceSlice: 'S11', sourceRange: { startLine: 21879, endLine: 21962 }, sourceLocalRange: { startLine: 77, endLine: 160 },
        sourceStartByte: 1610, sourceEndByteExclusive: 4063,
        sourceSha256: 'fb64d65eb9309d85f6d3404381eb67d25ad657f8c42113e3c5b1f954e62fc5ed',
      },
      {
        sourceSlice: 'S11', sourceRange: { startLine: 21963, endLine: 22049 }, sourceLocalRange: { startLine: 161, endLine: 247 },
        sourceStartByte: 4063, sourceEndByteExclusive: 6631,
        sourceSha256: '1bdcad94f96ac51b1e581ae8da903201afd589ea0ab52fd15b051f4f3182c25e',
      },
    ],
    sourceStartByte: 1610, sourceEndByteExclusive: 6631,
    sourceSha256: '172b744639a9d59be5bc20a51aeadfdf44cccb01e1610a723b102b09f4b60f98',
    targetPath: 'src/renderer/styles/shell/right-workspace/s11-03--landscape-empty-properties.css',
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

describe('Issue #551 P2-17 right Workspace/Inspector Host contract', () => {
  it('registers the ten approved host segments and all twelve unique Sections', () => {
    const ids = expectedP217.map(({ id }) => id);
    const actual = manifest.semanticRelocations
      .filter(({ id }) => ids.includes(id))
      .sort((left, right) => left.canonicalOrder - right.canonicalOrder);

    expect(actual.map(({ id }) => id)).toEqual(ids);
    expect(actual.map(project)).toEqual(expectedP217.map(project));
    expect(new Set(actual.flatMap(({ sectionIds }) => sectionIds))).toEqual(new Set([
      'S01-07', 'S02-03', 'S02-05', 'S06-13', 'S07-03', 'S07-05', 'S07-16', 'S08-01',
      'S08-03', 'S08-08', 'S11-03', 'S11-04',
    ]));

    for (const expected of expectedP217) {
      const actualSegment = manifest.semanticRelocations.find(({ id }) => id === expected.id);
      if (expected.sourceSegments) expect(actualSegment?.sourceSegments).toEqual(expected.sourceSegments);
    }
  });

  it('loads each host target exactly once at canonical source order', () => {
    const imports = importPaths();
    const expectedImports = expectedP217.map(({ targetPath }) => entryImportPath(targetPath));

    for (const expectedImport of expectedImports) {
      expect(imports.filter((candidate) => candidate === expectedImport)).toHaveLength(1);
    }
    expect(imports.filter((candidate) => expectedImports.includes(candidate))).toEqual(expectedImports);
    expect(imports).not.toContain('./styles/legacy-slices/02-review-workbench-dialogue-after-raster.css');
    expect(imports).not.toContain('./styles/legacy-slices/02-review-workbench-dialogue-after-queue.css');
    expect(imports).not.toContain('./styles/legacy-slices/07-portrait-assets-inspector-start--before-layer-forms.css');
    expect(imports).not.toContain('./styles/legacy-slices/08-inspector-portrait-dialogue--before-appearance.css');
  });

  it('keeps host targets byte-exact and preserves the pinned stylesheet', () => {
    for (const expected of expectedP217) {
      const target = normalize(readFileSync(resolve(root, expected.targetPath), 'utf8'));
      expect(sha256(target)).toBe(expected.sourceSha256);
      expect(Buffer.byteLength(target, 'utf8')).toBe(
        expected.sourceEndByteExclusive - expected.sourceStartByte,
      );
    }

    expect(sha256(readOrderedStylesheetSource())).toBe(
      '2404124609c88ee552288a51ffa3f5408cd2193adc754235af234cdd922ba3e7',
    );
  });

  it('preserves the Inspector rail geometry owners and the Timeline boundary', () => {
    expect(manifest.phase2CanonicalMap.approvedForAutomaticRelocation).toBe(false);
    expect(manifest.semanticRelocations.find(({ id }) => id === 'G112')).toMatchObject({
      sourceRange: { startLine: 27860, endLine: 27997 },
      migrationMode: 'ORDERED_COMPAT',
    });
    expect(manifest.remainderParts.find(({ id }) => id === 'S13-R02')).toBeUndefined();

    const rightWorkspace = readFileSync(
      resolve(root, 'src/renderer/styles/shell/right-workspace/s02-03--right-workspace.css'),
      'utf8',
    );
    const inspectorHandle = readFileSync(
      resolve(root, 'src/renderer/styles/shell/right-workspace/s06-13--legacy-landscape-inspector-handle.css'),
      'utf8',
    );
    const bottomWorkspace = readFileSync(resolve(root, 'src/renderer/shell/BottomWorkspace.tsx'), 'utf8');

    expect(rightWorkspace).toContain('.right-workspace');
    expect(inspectorHandle).toContain('.inspector-rail-handle');
    expect(inspectorHandle).toContain('min-height: 132px;');
    expect(inspectorHandle).toContain('max-height: 168px;');
    expect(bottomWorkspace).toContain('LANDSCAPE_RAIL_BUTTON_MIN_HEIGHT = 72');
    expect(bottomWorkspace).toContain('LANDSCAPE_RAIL_GAP = 8');
    expect(bottomWorkspace).toContain('[data-testid="inspector-rail-handle"]');
    expect(bottomWorkspace).toContain('readLiveTimelineHeightBounds');
    expect(bottomWorkspace).toContain('timelineUiStore.setHeightMax(bounds.maxHeight)');
  });
});
