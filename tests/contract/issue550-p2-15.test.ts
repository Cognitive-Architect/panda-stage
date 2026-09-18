import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const manifest = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'css-split-manifest.json'), 'utf8'),
) as {
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
  }>;
  remainderParts: Array<{
    id: string;
    sourceRange: { startLine: number; endLine: number };
    targetPath: string;
  }>;
};

type ExpectedSegment = {
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
};

const expectedB10: ExpectedSegment[] = [
  {
    id: 'G012', sectionIds: ['S01-12'], sourceSlice: 'S01', owner: 'timeline', migrationMode: 'DIRECT', canonicalOrder: 12,
    predecessor: 'S01-11/G011', successor: 'S01-13/G013', sourceRange: { startLine: 950, endLine: 1324 }, sourceLocalRange: { startLine: 948, endLine: 1322 },
    sourceStartByte: 18358, sourceEndByteExclusive: 25874, sourceSha256: '278f4fe731012f8059f91c8ef1b07c02354c6c33ab5da029033191b9e1e9c7f8',
    targetPath: 'src/renderer/styles/features/timeline/s01-12--bottom-and-track-base.css',
  },
  {
    id: 'G063', sectionIds: ['S07-07'], sourceSlice: 'S07', owner: 'timeline', migrationMode: 'DIRECT', canonicalOrder: 71,
    predecessor: 'S07-06/G062', successor: 'S07-08/G064', sourceRange: { startLine: 12577, endLine: 12694 }, sourceLocalRange: { startLine: 694, endLine: 811 },
    sourceStartByte: 22168, sourceEndByteExclusive: 25680, sourceSha256: 'b5c423fd1c8fffa09a958c0bf0f3d82b015c415311663f70de7e62ca1b549c9b',
    targetPath: 'src/renderer/styles/features/timeline/s07-07--portrait-track-internals.css',
  },
  {
    id: 'G075', sectionIds: ['S08-04'], sourceSlice: 'S08', owner: 'timeline', migrationMode: 'DIRECT', canonicalOrder: 84,
    predecessor: 'S08-03/G074', successor: 'S08-05/G076', sourceRange: { startLine: 14503, endLine: 14619 }, sourceLocalRange: { startLine: 702, endLine: 818 },
    sourceStartByte: 18427, sourceEndByteExclusive: 22176, sourceSha256: '764d90441ccaa3cfebf605a9ee6182bfb1d33e09f00d00b6695597248f43ebe8',
    targetPath: 'src/renderer/styles/features/timeline/s08-04--portrait-track-polish.css',
  },
  {
    id: 'G084', sectionIds: ['S09-03'], sourceSlice: 'S09', owner: 'timeline', migrationMode: 'DIRECT', canonicalOrder: 98,
    predecessor: 'S09-02/G083', successor: 'S09-04/G085', sourceRange: { startLine: 18687, endLine: 18754 }, sourceLocalRange: { startLine: 868, endLine: 935 },
    sourceStartByte: 27355, sourceEndByteExclusive: 29759, sourceSha256: '50b85aac9a36eab4b8f720a36e46e57976f95f75ae67fb538b68384ca2b4197e',
    targetPath: 'src/renderer/styles/features/timeline/s09-03--portrait-track-icons.css',
  },
  {
    id: 'G101', sectionIds: ['S11-08'], sourceSlice: 'S11', owner: 'shell-timeline', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 119,
    predecessor: 'S11-07/G100', successor: 'S11-09/G102', sourceRange: { startLine: 23437, endLine: 23520 }, sourceLocalRange: { startLine: 1635, endLine: 1718 },
    sourceStartByte: 47761, sourceEndByteExclusive: 50691, sourceSha256: 'de16fcdb177b0a31a8dee6106fbe8bae733bb0a4e013c7daa12a43c80a27d98b',
    targetPath: 'src/renderer/styles/shell/timeline-boundary/s11-08--resize-boundary.css',
  },
  {
    id: 'G102', sectionIds: ['S11-09'], sourceSlice: 'S11', owner: 'timeline', migrationMode: 'DIRECT', canonicalOrder: 120,
    predecessor: 'S11-08/G101', successor: 'S11-10/G103', sourceRange: { startLine: 23521, endLine: 23762 }, sourceLocalRange: { startLine: 1719, endLine: 1960 },
    sourceStartByte: 50691, sourceEndByteExclusive: 57857, sourceSha256: 'a170c1a6437151280c5138428114e6e4d85979c2021531c71f5bc873824866a7',
    targetPath: 'src/renderer/styles/features/timeline/s11-09--landscape-track-foundation.css',
  },
  {
    id: 'G104', sectionIds: ['S12-03', 'S12-04'], sourceSlice: 'S12', owner: 'timeline', migrationMode: 'DIRECT', canonicalOrder: 124,
    predecessor: 'S12-02/G103', successor: 'S12-05/G105', sourceRange: { startLine: 24448, endLine: 24598 }, sourceLocalRange: { startLine: 649, endLine: 799 },
    sourceStartByte: 19117, sourceEndByteExclusive: 24297, sourceSha256: '53073eeb9efdebe2b60da11508cc82aa78933ff2822130a078101c0207581731',
    targetPath: 'src/renderer/styles/features/timeline/s12-03--pending-placement-and-overlays.css',
  },
  {
    id: 'G108', sectionIds: ['S12-09'], sourceSlice: 'S12', owner: 'timeline', migrationMode: 'DIRECT', canonicalOrder: 130,
    predecessor: 'S12-08/G107', successor: 'S13-01/G109', sourceRange: { startLine: 25858, endLine: 25876 }, sourceLocalRange: { startLine: 2059, endLine: 2077 },
    sourceStartByte: 63233, sourceEndByteExclusive: 63782, sourceSha256: '036d3497ecfecd40cbdc6781bf3cb5567803971072e1bdde4f8a5ee68c7b8f35',
    targetPath: 'src/renderer/styles/features/timeline/s12-09--pending-drop-notice.css',
  },
  {
    id: 'G110', sectionIds: ['S13-03'], sourceSlice: 'S13', owner: 'timeline', migrationMode: 'DIRECT', canonicalOrder: 133,
    predecessor: 'S13-02/G109', successor: 'S13-04/G111', sourceRange: { startLine: 27504, endLine: 27611 }, sourceLocalRange: { startLine: 1628, endLine: 1735 },
    sourceStartByte: 51140, sourceEndByteExclusive: 55154, sourceSha256: '6d6f140baf86a0b908beb6b175366beb5a60490ab0f71a013e4e11965b1f8513',
    targetPath: 'src/renderer/styles/features/timeline/s13-03--final-resize-flex-422-432.css',
  },
  {
    id: 'G116', sectionIds: ['S14-04'], sourceSlice: 'S14', owner: 'timeline', migrationMode: 'DIRECT', canonicalOrder: 139,
    predecessor: 'S14-03/G115', successor: 'S14-05/G117', sourceRange: { startLine: 28410, endLine: 28480 }, sourceLocalRange: { startLine: 413, endLine: 483 },
    sourceStartByte: 9711, sourceEndByteExclusive: 11166, sourceSha256: 'ecf205b2d6bed97cbeb4b6611f07fdf6770ecbadf211dd3ead87205f4adb174c',
    targetPath: 'src/renderer/styles/features/timeline/s14-04--audio-trim-447.css',
  },
  {
    id: 'G120', sectionIds: ['S14-09'], sourceSlice: 'S14', owner: 'timeline', migrationMode: 'DIRECT', canonicalOrder: 144,
    predecessor: 'S14-08/G119', successor: 'S14-10/G121', sourceRange: { startLine: 28885, endLine: 28920 }, sourceLocalRange: { startLine: 888, endLine: 923 },
    sourceStartByte: 22408, sourceEndByteExclusive: 23020, sourceSha256: '933134b284d50bf17ad48a68126ac5257f36674c8ca48e75fa468eb2dfac860c',
    targetPath: 'src/renderer/styles/features/timeline/s14-09--audio-trim-448b.css',
  },
];

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

function entryImportPath(targetPath: string): string {
  const entryPath = resolve(root, manifest.rootEntry.path);
  const importPath = relative(dirname(entryPath), resolve(root, targetPath))
    .replaceAll(String.fromCharCode(92), '/');
  return './' + importPath.replace(/^\.\//u, '');
}

function projection(segment: typeof manifest.semanticRelocations[number]): ExpectedSegment {
  return {
    id: segment.id,
    sectionIds: segment.sectionIds,
    sourceSlice: segment.sourceSlice,
    owner: segment.owner,
    migrationMode: segment.migrationMode,
    canonicalOrder: segment.canonicalOrder,
    predecessor: segment.predecessor,
    successor: segment.successor,
    sourceRange: segment.sourceRange,
    sourceLocalRange: segment.sourceLocalRange,
    sourceStartByte: segment.sourceStartByte,
    sourceEndByteExclusive: segment.sourceEndByteExclusive,
    sourceSha256: segment.sourceSha256,
    targetPath: segment.targetPath,
  };
}

describe('Issue #550 SER-03 / P2-15 Timeline Geometry stylesheet contract', () => {
  it('registers exactly the 11 B10 segments covering all 12 approved Sections', () => {
    const ids = expectedB10.map(({ id }) => id);
    const actual = manifest.semanticRelocations
      .filter(({ id }) => ids.includes(id))
      .sort((left, right) => left.canonicalOrder - right.canonicalOrder)
      .map(projection);

    expect(actual).toEqual(expectedB10);
    expect(new Set(actual.map(({ id }) => id)).size).toBe(11);
    expect(new Set(actual.flatMap(({ sectionIds }) => sectionIds))).toEqual(new Set([
      'S01-12', 'S07-07', 'S08-04', 'S09-03', 'S11-08', 'S11-09',
      'S12-03', 'S12-04', 'S12-09', 'S13-03', 'S14-04', 'S14-09',
    ]));
  });

  it('loads every B10 target exactly once in canonical production order', () => {
    const imports = importPaths();
    const expectedImports = expectedB10.map(({ targetPath }) => entryImportPath(targetPath));

    for (const expectedImport of expectedImports) {
      expect(imports.filter((candidate) => candidate === expectedImport)).toHaveLength(1);
    }
    expect(imports.filter((candidate) => expectedImports.includes(candidate))).toEqual(expectedImports);
  });

  it('keeps all B10 targets byte-exact after Phase 3 begins', () => {
    for (const expected of expectedB10) {
      const actual = manifest.semanticRelocations.find(({ id }) => id === expected.id);
      expect(actual).toBeDefined();
      const target = normalize(readFileSync(resolve(root, expected.targetPath), 'utf8'));

      expect(sha256(target)).toBe(expected.sourceSha256);
      expect(sha256(target)).toBe(actual!.sourceSha256);
      expect(Buffer.byteLength(target, 'utf8')).toBe(
        expected.sourceEndByteExclusive - expected.sourceStartByte,
      );
    }

  });

  it('preserves the G112 compatibility boundary and the live geometry owners', () => {
    expect(manifest.semanticRelocations.find(({ id }) => id === 'G112')).toMatchObject({
      sourceRange: { startLine: 27860, endLine: 27997 },
      migrationMode: 'ORDERED_COMPAT',
    });
    expect(manifest.remainderParts.find(({ id }) => id === 'S13-R02')).toBeUndefined();

    const timelineStore = readFileSync(resolve(root, 'src/renderer/features/timeline/timelineUiStore.ts'), 'utf8');
    const bottomWorkspace = readFileSync(resolve(root, 'src/renderer/shell/BottomWorkspace.tsx'), 'utf8');
    const boundaryCss = readFileSync(resolve(root, 'src/renderer/styles/shell/timeline-boundary/s11-08--resize-boundary.css'), 'utf8');
    const flexCss = readFileSync(resolve(root, 'src/renderer/styles/features/timeline/s13-03--final-resize-flex-422-432.css'), 'utf8');
    const pendingCss = readFileSync(resolve(root, 'src/renderer/styles/features/timeline/s12-03--pending-placement-and-overlays.css'), 'utf8');
    const audioCss = readFileSync(resolve(root, 'src/renderer/styles/features/timeline/s14-04--audio-trim-447.css'), 'utf8');
    const audioPolishCss = readFileSync(resolve(root, 'src/renderer/styles/features/timeline/s14-09--audio-trim-448b.css'), 'utf8');

    expect(timelineStore).toMatch(/TIMELINE_TOOLBAR_HEIGHT = 48/u);
    expect(timelineStore).toMatch(/TIMELINE_RULER_SCROLL_HEIGHT = 112/u);
    expect(timelineStore).toMatch(/TIMELINE_EXPANDED_MAX_HEIGHT = TIMELINE_EXPANDED_MIN_HEIGHT \* 2/u);
    expect(bottomWorkspace).toContain('timelineUiStore.setHeightMax(bounds.maxHeight)');
    expect(bottomWorkspace).toContain("'--timeline-expanded-height'");
    expect(bottomWorkspace).toContain("'--timeline-expanded-min-height'");
    expect(bottomWorkspace).toContain("'--timeline-expanded-max-height'");
    expect(boundaryCss).toMatch(/height: 50px;\s+min-height: 50px;\s+max-height: 50px;/u);
    expect(boundaryCss).toMatch(/min-height: var\(--timeline-expanded-min-height, 162px\)/u);
    expect(boundaryCss).toMatch(/max-height: var\(--timeline-expanded-max-height, 324px\)/u);
    expect(flexCss).toMatch(/\.timeline-toolbar \{[\s\S]*?flex: 0 0 48px;/u);
    expect(flexCss).toMatch(/\.timeline-lane \{[\s\S]*?flex: 1 1 0;/u);
    expect(pendingCss).toMatch(/\.timeline-pending-drag-layer \{[\s\S]*?position: fixed;[\s\S]*?pointer-events: none;/u);
    expect(audioCss).toContain('.timeline-audio-clip.selected');
    expect(audioPolishCss).toMatch(/\.timeline-audio-clip\.selected \{[\s\S]*?overflow: visible;/u);
    expect(audioPolishCss).toContain('touch-action: none;');
  });
});
