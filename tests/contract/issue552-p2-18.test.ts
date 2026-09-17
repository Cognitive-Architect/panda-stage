import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

type Range = { startLine: number; endLine: number };
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
  sourceStartByte: number;
  sourceEndByteExclusive: number;
  sourceSha256: string;
  targetPath: string;
};
type Manifest = {
  phase2CanonicalMap: { approvedForAutomaticRelocation: boolean };
  rootEntry: { path: string };
  semanticRelocations: Relocation[];
  remainderParts: Array<{ id: string; sourceSlice: string; sourceRange: Range; targetPath: string }>;
  slices: Array<{
    id: string;
    sourceParts?: Array<{
      id: string;
      kind: string;
      sourceRange: Range;
      targetPath: string;
    }>;
  }>;
};

const root = resolve(process.cwd());
const manifest = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'css-split-manifest.json'), 'utf8'),
) as Manifest;

const expectedP218: Relocation[] = [
  {
    id: 'G002', segment: 'G002', sectionIds: ['S01-02'], sourceSlice: 'S01', owner: 'shell-layout', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 2, predecessor: 'S01-01/G001', successor: 'S01-03/G003', sourceRange: { startLine: 60, endLine: 77 }, sourceLocalRange: { startLine: 58, endLine: 75 }, sourceStartByte: 954, sourceEndByteExclusive: 1288, sourceSha256: '8a8b430ffd4551cecbed2fb777f21f30511d53dbaf08dbfdf714043161a8b3e7', targetPath: 'src/renderer/styles/shell/layout/s01-02--root-frame.css',
  },
  {
    id: 'G004', segment: 'G004', sectionIds: ['S01-04'], sourceSlice: 'S01', owner: 'shell-layout', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 4, predecessor: 'S01-03/G003', successor: 'S01-05/G005', sourceRange: { startLine: 158, endLine: 176 }, sourceLocalRange: { startLine: 156, endLine: 174 }, sourceStartByte: 2736, sourceEndByteExclusive: 3043, sourceSha256: 'a469fa76907d9436429749b40094888a2ecac30b40eccf3a6903831d270533b8', targetPath: 'src/renderer/styles/shell/layout/s01-04--editor-grid.css',
  },
  {
    id: 'G006', segment: 'G006', sectionIds: ['S01-06'], sourceSlice: 'S01', owner: 'shell-layout', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 6, predecessor: 'S01-05/G005', successor: 'S01-07/G007', sourceRange: { startLine: 409, endLine: 431 }, sourceLocalRange: { startLine: 407, endLine: 429 }, sourceStartByte: 7661, sourceEndByteExclusive: 8060, sourceSha256: 'd9ea315b76f9ca103296a1016f681f45372dea720973490350e8a2748c2e980d', targetPath: 'src/renderer/styles/shell/layout/s01-06--recovery-host-and-body.css',
  },
  {
    id: 'G010', segment: 'G010', sectionIds: ['S01-10'], sourceSlice: 'S01', owner: 'shell-layout', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 10, predecessor: 'S01-09/G009', successor: 'S01-11/G011', sourceRange: { startLine: 886, endLine: 910 }, sourceLocalRange: { startLine: 884, endLine: 908 }, sourceStartByte: 16880, sourceEndByteExclusive: 17652, sourceSha256: '53da50909869b46cece966d117adb56e64c9242ca50450e01399407c7ae48bee', targetPath: 'src/renderer/styles/shell/layout/s01-10--canvas-host.css',
  },
  {
    id: 'G054', segment: 'G054', sectionIds: ['S06-12'], sourceSlice: 'S06', owner: 'shell-layout', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 60, predecessor: 'S06-11/G053', successor: 'S06-13/G055', sourceRange: { startLine: 11264, endLine: 11440 }, sourceLocalRange: { startLine: 1425, endLine: 1601 }, sourceStartByte: 26261, sourceEndByteExclusive: 30487, sourceSha256: '730ec3f5d101d1c46d4fc34ba4f79b054a1dcdac0ccb9edd9e7d3412c854b26e', targetPath: 'src/renderer/styles/shell/layout/s06-12--adaptive-shell.css',
  },
  {
    id: 'G056', segment: 'G056', sectionIds: ['S06-14', 'S06-15'], sourceSlice: 'S06', owner: 'shell-layout', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 62, predecessor: 'S06-13/G055', successor: 'S06-16/G057', sourceRange: { startLine: 11516, endLine: 11800 }, sourceLocalRange: { startLine: 1677, endLine: 1961 }, sourceStartByte: 32709, sourceEndByteExclusive: 40314, sourceSha256: 'd3a9aa9b318a3b2f83ae5369e6cce39e7506010ba3cb8778cacffe00e12782ce', targetPath: 'src/renderer/styles/shell/layout/s06-14--portrait-layout.css',
  },
  {
    id: 'G062', segment: 'G062', sectionIds: ['S07-06'], sourceSlice: 'S07', owner: 'shell-layout', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 70, predecessor: 'S07-05/G061', successor: 'S07-07/G063', sourceRange: { startLine: 12549, endLine: 12576 }, sourceLocalRange: { startLine: 666, endLine: 693 }, sourceStartByte: 21081, sourceEndByteExclusive: 22168, sourceSha256: '69bd9b8aa3644c563ac2eb876214c45368c7e2c0b2f26261cb407f0a880bdb63', targetPath: 'src/renderer/styles/shell/layout/s07-06--portrait-timeline-host.css',
  },
  {
    id: 'G122', segment: 'G122', sectionIds: ['S14-11'], sourceSlice: 'S14', owner: 'shell-layout', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 146, predecessor: 'S14-10/G121', successor: 'S14-12/G123', sourceRange: { startLine: 29224, endLine: 29283 }, sourceLocalRange: { startLine: 1227, endLine: 1286 }, sourceStartByte: 30324, sourceEndByteExclusive: 31789, sourceSha256: 'b03a4754bf1d93761ef8e1e5648838e8042773d299418bf99baf7fcb1aa8cf3f', targetPath: 'src/renderer/styles/shell/layout/s14-11--top-overlay-456-486.css',
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

describe('Issue #552 B12 P2-18 editor shell layout contract', () => {
  it('registers the eight approved host segments and all nine Sections', () => {
    const ids = expectedP218.map(({ id }) => id);
    const actual = manifest.semanticRelocations
      .filter(({ id }) => ids.includes(id))
      .sort((left, right) => left.canonicalOrder - right.canonicalOrder);

    expect(actual.map(({ id }) => id)).toEqual(ids);
    expect(actual.map(project)).toEqual(expectedP218.map(project));
    expect(new Set(actual.flatMap(({ sectionIds }) => sectionIds))).toEqual(new Set([
      'S01-02', 'S01-04', 'S01-06', 'S01-10', 'S06-12', 'S06-14', 'S06-15', 'S07-06', 'S14-11',
    ]));
  });

  it('loads each layout target exactly once in canonical source order', () => {
    const imports = importPaths();
    const expectedImports = expectedP218.map(({ targetPath }) => entryImportPath(targetPath));

    for (const expectedImport of expectedImports) {
      expect(imports.filter((candidate) => candidate === expectedImport)).toHaveLength(1);
    }
    expect(imports.filter((candidate) => expectedImports.includes(candidate))).toEqual(expectedImports);
    expect(imports).not.toContain('./styles/legacy-slices/01-shell-import-review-base.css');
    expect(imports).not.toContain('./styles/legacy-slices/06-canvas-portrait-foundation-after-dialogue.css');
    expect(imports).not.toContain('./styles/legacy-slices/06-canvas-portrait-foundation-after-inspector-handle.css');
    expect(imports).not.toContain('./styles/legacy-slices/07-portrait-assets-inspector-start--after-assets.css');
  });

  it('keeps every moved host block byte-exact and reconstructs the pinned stylesheet', () => {
    for (const expected of expectedP218) {
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

  it('preserves shell geometry owners and leaves the next quick/history/tools blocks pending', () => {
    expect(manifest.phase2CanonicalMap.approvedForAutomaticRelocation).toBe(false);
    expect(manifest.semanticRelocations.some(({ id }) => id === 'G112')).toBe(false);

    expect(manifest.remainderParts.find(({ id }) => id === 'S01-R02')).toMatchObject({
      sourceRange: { startLine: 177, endLine: 408 },
    });
    expect(manifest.remainderParts.find(({ id }) => id === 'S01-R04')).toMatchObject({
      sourceRange: { startLine: 852, endLine: 885 },
    });
    expect(manifest.remainderParts.find(({ id }) => id === 'S01-R05')).toMatchObject({
      sourceRange: { startLine: 911, endLine: 949 },
    });
    expect(manifest.slices.find(({ id }) => id === 'S14')?.sourceParts).toEqual(expect.arrayContaining([
      { id: 'S14-R02', kind: 'remainder', sourceRange: { startLine: 924, endLine: 1226 }, targetPath: 'src/renderer/styles/legacy-slices/14-dialogue-polish-image-picker-after-batch-footer.css' },
      { id: 'G122', kind: 'semantic', relocationId: 'G122', sourceRange: { startLine: 1227, endLine: 1286 }, targetPath: 'src/renderer/styles/shell/layout/s14-11--top-overlay-456-486.css' },
    ]));

    const bottomWorkspace = readFileSync(resolve(root, 'src/renderer/shell/BottomWorkspace.tsx'), 'utf8');
    const timelineUiStore = readFileSync(resolve(root, 'src/renderer/features/timeline/timelineUiStore.ts'), 'utf8');
    expect(bottomWorkspace).toContain('LANDSCAPE_RAIL_BUTTON_MIN_HEIGHT = 72');
    expect(bottomWorkspace).toContain('LANDSCAPE_RAIL_GAP = 8');
    expect(bottomWorkspace).toContain('[data-testid="resource-activity-rail"]');
    expect(bottomWorkspace).toContain('[data-testid="inspector-rail-handle"]');
    expect(bottomWorkspace).toContain('readLiveTimelineHeightBounds');
    expect(bottomWorkspace).toContain('timelineUiStore.setHeightMax(bounds.maxHeight)');
    expect(timelineUiStore).toContain('setHeightMax');
  });
});
