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
      relocationId?: string;
      sourceRange: Range;
      targetPath: string;
    }>;
  }>;
};

const root = resolve(process.cwd());
const manifest = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'css-split-manifest.json'), 'utf8'),
) as Manifest;

const expectedP219: Relocation[] = [
  {
    id: 'G005', segment: 'G005', sectionIds: ['S01-05'], sourceSlice: 'S01', owner: 'shell-quick-actions', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 5, predecessor: 'S01-03/G003', successor: 'S01-06/G006', sourceRange: { startLine: 177, endLine: 408 }, sourceLocalRange: { startLine: 175, endLine: 406 }, sourceStartByte: 3043, sourceEndByteExclusive: 7661, sourceSha256: '08ddc045b068780bef84ab6daebb7baff3813e07cbeb764409ce45d6cb3de6df', targetPath: 'src/renderer/styles/shell/quick-actions/s01-05--legacy-compact-bar.css',
  },
  {
    id: 'G013', segment: 'G013', sectionIds: ['S01-13'], sourceSlice: 'S01', owner: 'history', migrationMode: 'DIRECT+HOST_INTEGRATION', canonicalOrder: 13, predecessor: 'S01-12/G012', successor: 'S01-14/G014', sourceRange: { startLine: 1325, endLine: 1391 }, sourceLocalRange: { startLine: 1323, endLine: 1389 }, sourceStartByte: 25874, sourceEndByteExclusive: 27234, sourceSha256: '6270eb62acdf6e19d72ab8a203cb10221ca692cdad835d1026367fbd85ba9bea', targetPath: 'src/renderer/styles/features/editor/history/s01-13--bottom-history-host.css',
  },
  {
    id: 'G046', segment: 'G046', sectionIds: ['S06-03'], sourceSlice: 'S06', owner: 'history', migrationMode: 'DIRECT+HOST_INTEGRATION', canonicalOrder: 51, predecessor: 'S06-02/G045', successor: 'S06-04/G047', sourceRange: { startLine: 10190, endLine: 10211 }, sourceLocalRange: { startLine: 351, endLine: 372 }, sourceStartByte: 7035, sourceEndByteExclusive: 7394, sourceSha256: '49a30347d9e9a19a144cc56e807b9506a367c4522cc4d680f13809cd7dd6c687', targetPath: 'src/renderer/styles/features/editor/history/s06-03--history-base.css',
  },
  {
    id: 'G065', segment: 'G065', sectionIds: ['S07-09'], sourceSlice: 'S07', owner: 'history', migrationMode: 'DIRECT+HOST_INTEGRATION', canonicalOrder: 73, predecessor: 'S07-08/G064', successor: 'S07-10/G066', sourceRange: { startLine: 12845, endLine: 12853 }, sourceLocalRange: { startLine: 962, endLine: 970 }, sourceStartByte: 30565, sourceEndByteExclusive: 30877, sourceSha256: 'd8800b546888f90674b0acfb0912ca69a34f955ee2bd851c98bd19dd2f28280e', targetPath: 'src/renderer/styles/features/editor/history/s07-09--portrait-bottom-history.css',
  },
  {
    id: 'G077', segment: 'G077', sectionIds: ['S08-06'], sourceSlice: 'S08', owner: 'shell-quick-actions', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 86, predecessor: 'S08-05/G076', successor: 'S08-07/G078', sourceRange: { startLine: 15064, endLine: 15158 }, sourceLocalRange: { startLine: 1263, endLine: 1357 }, sourceStartByte: 36989, sourceEndByteExclusive: 40003, sourceSha256: 'd84fe76fc03465763e1fa34b7be511e2623c827407676ba9a200f58115d1d21e', targetPath: 'src/renderer/styles/shell/quick-actions/s08-06--portrait-compact-history.css',
  },
  {
    id: 'G092', segment: 'G092', sectionIds: ['S10-04'], sourceSlice: 'S10', owner: 'shell-quick-actions', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 107, predecessor: 'S10-03/G091', successor: 'S10-05/G093', sourceRange: { startLine: 21525, endLine: 21608 }, sourceLocalRange: { startLine: 1742, endLine: 1825 }, sourceStartByte: 49345, sourceEndByteExclusive: 51497, sourceSha256: '5a4725b76995181f0db54b040b6e74bcd13054ed7f93b978134a8fd462cbf5fd', targetPath: 'src/renderer/styles/shell/quick-actions/s10-04--landscape-compact-history.css',
  },
  {
    id: 'G121', segment: 'G121', sectionIds: ['S14-10'], sourceSlice: 'S14', owner: 'shell-quick-actions', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 145, predecessor: 'S14-09/G120', successor: 'S14-11/G122', sourceRange: { startLine: 28921, endLine: 29223 }, sourceLocalRange: { startLine: 924, endLine: 1226 }, sourceStartByte: 23020, sourceEndByteExclusive: 30324, sourceSha256: '70c936ace689db10cc0628fe5f6e5475a079dbfbe5cc9e4a72d14cc567d53302', targetPath: 'src/renderer/styles/shell/quick-actions/s14-10--quick-drawer-454.css',
  },
];

const expectedP221: Relocation[] = [
  {
    id: 'G009', segment: 'G009', sectionIds: ['S01-09'], sourceSlice: 'S01', owner: 'shell-tools', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 9, predecessor: 'S01-08/G008', successor: 'S01-10/G010', sourceRange: { startLine: 852, endLine: 885 }, sourceLocalRange: { startLine: 850, endLine: 883 }, sourceStartByte: 16288, sourceEndByteExclusive: 16880, sourceSha256: 'f7142037492b2ee11d66d6f5985a21dbf820afbdca317579d52f5fe6868e5730', targetPath: 'src/renderer/styles/shell/tools/s01-09--legacy-compatibility.css',
  },
  {
    id: 'G011', segment: 'G011', sectionIds: ['S01-11'], sourceSlice: 'S01', owner: 'shell-tools', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 11, predecessor: 'S01-10/G010', successor: 'S01-12/G012', sourceRange: { startLine: 911, endLine: 949 }, sourceLocalRange: { startLine: 909, endLine: 947 }, sourceStartByte: 17652, sourceEndByteExclusive: 18358, sourceSha256: '4af1bf0e8469c0fed1131bd60981bdf3be52f59b73aa116f130fce27f73d7490', targetPath: 'src/renderer/styles/shell/tools/s01-11--legacy-workspace-placeholder.css',
  },
  {
    id: 'G094', segment: 'G094', sectionIds: ['S10-06'], sourceSlice: 'S10', owner: 'shell-tools', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 109, predecessor: 'S10-05/G093', successor: 'S10-07/G095', sourceRange: { startLine: 21672, endLine: 21745 }, sourceLocalRange: { startLine: 1889, endLine: 1962 }, sourceStartByte: 53229, sourceEndByteExclusive: 54503, sourceSha256: '473c0db00cfc21896db2ac72b5e0ead7b7822037eb0d6f3d1c11aa176ef00218', targetPath: 'src/renderer/styles/shell/tools/s10-06--tools-drawer.css',
  },
  {
    id: 'G096', segment: 'G096', sectionIds: ['S10-08'], sourceSlice: 'S10', owner: 'shell-tools', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 111, predecessor: 'S10-07/G095', successor: 'S11-01/G097', sourceRange: { startLine: 21767, endLine: 21802 }, sourceLocalRange: { startLine: 1984, endLine: 2019 }, sourceStartByte: 54898, sourceEndByteExclusive: 55559, sourceSha256: 'f14369b4dfed72211a32c400b4e4f58166217ac6077e1424458e531d1098ab9b', targetPath: 'src/renderer/styles/shell/tools/s10-08--tools-action-launcher.css',
  },
  {
    id: 'G098', segment: 'G098', sectionIds: ['S11-02'], sourceSlice: 'S11', owner: 'shell-tools', migrationMode: 'HOST_INTEGRATION', canonicalOrder: 113, predecessor: 'S11-01/G097', successor: 'S11-03/G099', sourceRange: { startLine: 21857, endLine: 21878 }, sourceLocalRange: { startLine: 55, endLine: 76 }, sourceStartByte: 1182, sourceEndByteExclusive: 1610, sourceSha256: '1768d5122e980e8b7591a72a81f03ba9c29f9f9bfa258ba95600594d2d377596', targetPath: 'src/renderer/styles/shell/tools/s11-02--action-preset-host.css',
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

describe('Issue #552 B13 P2-19 quick/history and P2-21 tools contract', () => {
  it('registers the seven P2-19 and five P2-21 segments with exact ownership', () => {
    for (const expectedBatch of [expectedP219, expectedP221]) {
      const ids = expectedBatch.map(({ id }) => id);
      const actual = manifest.semanticRelocations
        .filter(({ id }) => ids.includes(id))
        .sort((left, right) => left.canonicalOrder - right.canonicalOrder);
      expect(actual.map(({ id }) => id)).toEqual(ids);
      expect(actual.map(project)).toEqual(expectedBatch.map(project));
    }

    expect(new Set(expectedP219.flatMap(({ sectionIds }) => sectionIds))).toEqual(new Set([
      'S01-05', 'S01-13', 'S06-03', 'S07-09', 'S08-06', 'S10-04', 'S14-10',
    ]));
    expect(new Set(expectedP221.flatMap(({ sectionIds }) => sectionIds))).toEqual(new Set([
      'S01-09', 'S01-11', 'S10-06', 'S10-08', 'S11-02',
    ]));
  });

  it('loads the twelve moved blocks exactly once at the combined canonical positions', () => {
    const imports = importPaths();
    const expected = [...expectedP219, ...expectedP221]
      .sort((left, right) => left.canonicalOrder - right.canonicalOrder);
    const expectedImports = expected.map(({ targetPath }) => entryImportPath(targetPath));

    for (const expectedImport of expectedImports) {
      expect(imports.filter((candidate) => candidate === expectedImport)).toHaveLength(1);
    }
    expect(imports.filter((candidate) => expectedImports.includes(candidate))).toEqual(expectedImports);
    for (const removed of [
      './styles/legacy-slices/01-shell-import-review-after-project-center.css',
      './styles/legacy-slices/01-shell-import-review-after-resources.css',
      './styles/legacy-slices/01-shell-import-review-after-canvas-host.css',
      './styles/legacy-slices/01-shell-import-review-after-timeline.css',
      './styles/legacy-slices/06-canvas-portrait-foundation--between-properties.css',
      './styles/legacy-slices/10-landscape-characters-tools-after-expression-workbench.css',
      './styles/legacy-slices/10-landscape-characters-tools-after-resource-rail.css',
      './styles/legacy-slices/10-landscape-characters-tools-after-maintenance.css',
      './styles/legacy-slices/11-tools-inspector-timeline-start--before-landscape-layer-controls.css',
      './styles/legacy-slices/14-dialogue-polish-image-picker-after-batch-footer.css',
    ]) expect(imports).not.toContain(removed);
  });

  it('keeps all twelve targets byte-exact and reconstructs the pinned stylesheet', () => {
    for (const expected of [...expectedP219, ...expectedP221]) {
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

  it('preserves Quick/History and Tools producers, hosts, states, and geometry owners', () => {
    const compact = readFileSync(resolve(root, 'src/renderer/shell/CompactProjectBar.tsx'), 'utf8');
    const history = readFileSync(resolve(root, 'src/renderer/features/editor/HistoryControls.tsx'), 'utf8');
    const shortcuts = readFileSync(resolve(root, 'src/renderer/features/editor/useHistoryShortcuts.ts'), 'utf8');
    const tools = readFileSync(resolve(root, 'src/renderer/shell/ProjectToolsDrawer.tsx'), 'utf8');
    const right = readFileSync(resolve(root, 'src/renderer/shell/RightWorkspace.tsx'), 'utf8');
    const legacy = readFileSync(resolve(root, 'src/renderer/shell/LegacyWorkspace.tsx'), 'utf8');
    const action = readFileSync(resolve(root, 'src/renderer/features/actions/ActionPresetPanel.tsx'), 'utf8');
    const bottom = readFileSync(resolve(root, 'src/renderer/shell/BottomWorkspace.tsx'), 'utf8');
    const editorShell = readFileSync(resolve(root, 'src/renderer/shell/EditorShell.tsx'), 'utf8');

    expect(compact).toContain('<HistoryControls presentation="compact" />');
    expect(compact).toContain('data-save-state={saveState}');
    expect(compact).toContain('data-testid="quick-action-drawer-handle"');
    expect(history).toContain('useHistoryShortcuts(undo, redo)');
    expect(history).toContain('data-history-presentation={presentation}');
    expect(shortcuts).toContain("key === 'z'");
    expect(shortcuts).toContain("key === 'y'");

    expect(right).toContain('<ProjectToolsDrawer');
    expect(tools).toContain('data-testid="project-tools-drawer"');
    expect(tools).toContain('data-testid="project-tools-action-presets"');
    expect(tools).toContain('data-testid="project-tools-back"');
    expect(tools.match(/data-testid="project-tools-view-mode-card"/gu)).toHaveLength(1);
    expect(tools).not.toContain('HistoryControls');
    expect(tools).not.toContain('updateProject');
    expect(legacy).toContain('<ActionPresetPanel');
    expect(action).toContain('actionPresetStore.apply');

    expect(bottom).toContain('timelineUiStore.setHeightMax(bounds.maxHeight)');
    expect(editorShell).toContain('data-testid="editor-body"');
    expect(sha256(bottom)).toBe('d890a631c9344b7b33468ba784badd47a761434e9606971f1e831587976d41eb');
    expect(sha256(editorShell)).toBe('888e03e7f96965ae48a44f3593a3864e8fea9fa3eb7592f20bac4ff0ff88a4f0');
    expect(manifest.phase2CanonicalMap.approvedForAutomaticRelocation).toBe(false);
    expect(manifest.semanticRelocations.some(({ id }) => id === 'G112')).toBe(true);
  });

  it('records the split remainders without reviving old entry points', () => {
    expect(manifest.semanticRelocations.find(({ id }) => id === 'G064')).toMatchObject({
      sourceRange: { startLine: 12695, endLine: 12844 },
    });
    expect(manifest.semanticRelocations.find(({ id }) => id === 'G076')).toMatchObject({
      sourceRange: { startLine: 14620, endLine: 15063 },
    });
    for (const removed of ['S01-R02', 'S01-R04', 'S01-R05', 'S01-R03', 'S06-R01', 'S10-R01', 'S10-R03', 'S10-R02', 'S11-R01']) {
      expect(manifest.remainderParts.some(({ id }) => id === removed)).toBe(false);
    }
    expect(manifest.slices.find(({ id }) => id === 'S14')?.sourceParts).toEqual(expect.arrayContaining([
      { id: 'G121', kind: 'semantic', relocationId: 'G121', sourceRange: { startLine: 924, endLine: 1226 }, targetPath: 'src/renderer/styles/shell/quick-actions/s14-10--quick-drawer-454.css' },
      { id: 'G122', kind: 'semantic', relocationId: 'G122', sourceRange: { startLine: 1227, endLine: 1286 }, targetPath: 'src/renderer/styles/shell/layout/s14-11--top-overlay-456-486.css' },
    ]));
  });
});
