import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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
  startAnchor: string;
  endAnchor: string;
  placement: string;
  status: string;
};
type Manifest = {
  rootEntry: { path: string };
  phase2CanonicalMap: { approvedForAutomaticRelocation: boolean };
  semanticRelocations: Relocation[];
  remainderParts: Array<{ id: string; sourceSlice: string; sourceRange: Range; targetPath: string }>;
};

const authorizedCanonicalTargetOverrides = new Map([
  [
    'G097',
    'src/renderer/styles/shell/tools/view-mode.css',
  ],
]);

const root = resolve(process.cwd());
const manifest = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'css-split-manifest.json'), 'utf8'),
) as Manifest;
const mapText = readFileSync(
  resolve(root, 'docs/decisions/PandaStage_Phase2_Canonical_Section_Map_v1.1_2026-09-16.md'),
  'utf8',
);

const expectedP227: Relocation[] = [
  {
    "id": "G049",
    "segment": "G049",
    "sectionIds": [
      "S06-06",
      "S06-07"
    ],
    "sourceSlice": "S06",
    "owner": "mixed",
    "migrationMode": "ORDERED_COMPAT",
    "canonicalOrder": 54,
    "predecessor": "S06-05/G048",
    "successor": "S06-08/G050",
    "sourceRange": {
      "startLine": 10328,
      "endLine": 10699
    },
    "sourceLocalRange": {
      "startLine": 489,
      "endLine": 860
    },
    "sourceStartByte": 9398,
    "sourceEndByteExclusive": 16766,
    "sourceSha256": "983670890d12313330070acff610c342a822ff6bafbdf4c0b2fdfa2ce5a36eae",
    "targetPath": "src/renderer/styles/compat/mixed-conditions/s06-06--responsive-1100.css",
    "startAnchor": "@media (max-width: 1100px)",
    "endAnchor": "EOF",
    "placement": "source-order",
    "status": "relocated"
  },
  {
    "id": "G064",
    "segment": "G064",
    "sectionIds": [
      "S07-08"
    ],
    "sourceSlice": "S07",
    "owner": "legacy-task",
    "migrationMode": "ORDERED_COMPAT",
    "canonicalOrder": 72,
    "predecessor": "S07-07/G063",
    "successor": "S07-09/G065",
    "sourceRange": {
      "startLine": 12695,
      "endLine": 12844
    },
    "sourceLocalRange": {
      "startLine": 812,
      "endLine": 961
    },
    "sourceStartByte": 25680,
    "sourceEndByteExclusive": 30565,
    "sourceSha256": "c0edfb9fb49454948730d77328b84544853fc3f8851bf40115f23e9747581c00",
    "targetPath": "src/renderer/styles/compat/retained-task-surfaces/s07-08--portrait-dialogue-original.css",
    "startAnchor": ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .editor-layout[data-active-workspace='timeline'] .dialogue-sheet-timeline",
    "endAnchor": "S07-09 history selector",
    "placement": "source-order",
    "status": "relocated"
  },
  {
    "id": "G076",
    "segment": "G076",
    "sectionIds": [
      "S08-05"
    ],
    "sourceSlice": "S08",
    "owner": "legacy-task",
    "migrationMode": "ORDERED_COMPAT",
    "canonicalOrder": 85,
    "predecessor": "S08-04/G075",
    "successor": "S08-06/G077",
    "sourceRange": {
      "startLine": 14620,
      "endLine": 15063
    },
    "sourceLocalRange": {
      "startLine": 819,
      "endLine": 1262
    },
    "sourceStartByte": 22176,
    "sourceEndByteExclusive": 36989,
    "sourceSha256": "239bb7fe9e7971b75206d58c0c6922e3f4fb3d1466b99e4a773f7e0a31b941cd",
    "targetPath": "src/renderer/styles/compat/retained-task-surfaces/s08-05--portrait-dialogue-flat.css",
    "startAnchor": ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait'] .editor-layout[data-active-workspace='timeline'] .dialogue-sheet-timeline",
    "endAnchor": "Issue #340:",
    "placement": "source-order",
    "status": "relocated"
  },
  {
    "id": "G080",
    "segment": "G080",
    "sectionIds": [
      "S08-09",
      "S08-10",
      "S08-11"
    ],
    "sourceSlice": "S08",
    "owner": "legacy-task",
    "migrationMode": "ORDERED_COMPAT",
    "canonicalOrder": 89,
    "predecessor": "S08-08/G079",
    "successor": "S08-12/G081",
    "sourceRange": {
      "startLine": 15733,
      "endLine": 16456
    },
    "sourceLocalRange": {
      "startLine": 1932,
      "endLine": 2655
    },
    "sourceStartByte": 58701,
    "sourceEndByteExclusive": 83439,
    "sourceSha256": "cdffa29e504947accf0275f937fe1eec8ebd1cccdc261881840714282798d173",
    "targetPath": "src/renderer/styles/compat/retained-task-surfaces/s08-09--portrait-authoring.css",
    "startAnchor": "Issue #357:",
    "endAnchor": "Issue #348:",
    "placement": "source-order",
    "status": "relocated"
  },
  {
    "id": "G082",
    "segment": "G082",
    "sectionIds": [
      "S08-15",
      "S09-01"
    ],
    "sourceSlice": "S08",
    "owner": "legacy-task",
    "migrationMode": "ORDERED_COMPAT",
    "canonicalOrder": 95,
    "predecessor": "S08-14/G081",
    "successor": "S09-02/G083",
    "sourceRange": {
      "startLine": 17497,
      "endLine": 18217
    },
    "sourceLocalRange": {
      "startLine": 3696,
      "endLine": 4018
    },
    "sourceStartByte": 114224,
    "sourceEndByteExclusive": 137081,
    "sourceSha256": "37c26e1eedf656ea5bb7513021f757bcbd682bffb241bc08295faddbde39dfa5",
    "sourceSegments": [
      {
        "sourceSlice": "S08",
        "sourceRange": {
          "startLine": 17497,
          "endLine": 17819
        },
        "sourceLocalRange": {
          "startLine": 3696,
          "endLine": 4018
        },
        "sourceStartByte": 114224,
        "sourceEndByteExclusive": 124867,
        "sourceSha256": "c1ab29dccb329c860e241fdf9e3b9e2bfc671d2b0983103a7cbd636db72546a6"
      },
      {
        "sourceSlice": "S09",
        "sourceRange": {
          "startLine": 17820,
          "endLine": 18217
        },
        "sourceLocalRange": {
          "startLine": 1,
          "endLine": 398
        },
        "sourceStartByte": 0,
        "sourceEndByteExclusive": 12214,
        "sourceSha256": "4dcea49c6c2faf9fb0eac38eae20f4663706c5a11f226be15122ce2c75b7007a"
      }
    ],
    "targetPath": "src/renderer/styles/compat/retained-task-surfaces/s08-15--portrait-pending-base-and-final.css",
    "startAnchor": "Issue #351:",
    "endAnchor": "Issue #358:",
    "placement": "source-order",
    "status": "relocated"
  },
  {
    "id": "G085",
    "segment": "G085",
    "sectionIds": [
      "S09-04"
    ],
    "sourceSlice": "S09",
    "owner": "legacy-task",
    "migrationMode": "ORDERED_COMPAT",
    "canonicalOrder": 99,
    "predecessor": "S09-03/G084",
    "successor": "S09-05/G086",
    "sourceRange": {
      "startLine": 18755,
      "endLine": 18827
    },
    "sourceLocalRange": {
      "startLine": 936,
      "endLine": 1008
    },
    "sourceStartByte": 29759,
    "sourceEndByteExclusive": 32286,
    "sourceSha256": "138c7d966d389c68b5079f832686e61389ddcb9dc05d4a46868c3295b7ae6215",
    "targetPath": "src/renderer/styles/compat/retained-task-surfaces/s09-04--portrait-pending-polish.css",
    "startAnchor": "dialogue-secondary-action/dialogue-authoring-open selector",
    "endAnchor": "Issue #360:",
    "placement": "source-order",
    "status": "relocated"
  },
  {
    "id": "G103",
    "segment": "G103",
    "sectionIds": [
      "S11-10",
      "S12-01",
      "S12-02"
    ],
    "sourceSlice": "S11",
    "owner": "legacy-task",
    "migrationMode": "ORDERED_COMPAT",
    "canonicalOrder": 121,
    "predecessor": "S11-09/G102",
    "successor": "S12-03/G104",
    "sourceRange": {
      "startLine": 23763,
      "endLine": 24447
    },
    "sourceLocalRange": {
      "startLine": 1961,
      "endLine": 1997
    },
    "sourceStartByte": 57857,
    "sourceEndByteExclusive": 77955,
    "sourceSha256": "2ce54b4979aa5bd7ca0ae545c18af3f8eeb30140c1c68825f9e4efe535519ec2",
    "sourceSegments": [
      {
        "sourceSlice": "S11",
        "sourceRange": {
          "startLine": 23763,
          "endLine": 23799
        },
        "sourceLocalRange": {
          "startLine": 1961,
          "endLine": 1997
        },
        "sourceStartByte": 57857,
        "sourceEndByteExclusive": 58838,
        "sourceSha256": "f2580bfd5d6f84e31454274d6ac29c0052e8c32e14c50dc482c6fb0f93bcada4"
      },
      {
        "sourceSlice": "S12",
        "sourceRange": {
          "startLine": 23800,
          "endLine": 24447
        },
        "sourceLocalRange": {
          "startLine": 1,
          "endLine": 648
        },
        "sourceStartByte": 0,
        "sourceEndByteExclusive": 19117,
        "sourceSha256": "a4aac50e6a525139aa167a495cb52623a5eb196d30bb825532fd5a49d220ecdc"
      }
    ],
    "targetPath": "src/renderer/styles/compat/retained-task-surfaces/s11-10--landscape-tray-host-original.css",
    "startAnchor": "landscape timeline-task-tray selector",
    "endAnchor": "Issue #381:",
    "placement": "source-order",
    "status": "relocated"
  },
  {
    "id": "G105",
    "segment": "G105",
    "sectionIds": [
      "S12-05"
    ],
    "sourceSlice": "S12",
    "owner": "legacy-task",
    "migrationMode": "ORDERED_COMPAT",
    "canonicalOrder": 126,
    "predecessor": "S12-04/G104",
    "successor": "S12-06/G106",
    "sourceRange": {
      "startLine": 24599,
      "endLine": 24877
    },
    "sourceLocalRange": {
      "startLine": 800,
      "endLine": 1078
    },
    "sourceStartByte": 24297,
    "sourceEndByteExclusive": 32640,
    "sourceSha256": "68527d26ddafc7d3d7bb645cb6df610c08fc23caa6f5282f4a482035929fa110",
    "targetPath": "src/renderer/styles/compat/retained-task-surfaces/s12-05--landscape-task-body.css",
    "startAnchor": "landscape timeline-task-tray selector",
    "endAnchor": "@media (max-width: 760px)",
    "placement": "source-order",
    "status": "relocated"
  },
  {
    "id": "G107",
    "segment": "G107",
    "sectionIds": [
      "S12-08"
    ],
    "sourceSlice": "S12",
    "owner": "mixed",
    "migrationMode": "ORDERED_COMPAT",
    "canonicalOrder": 129,
    "predecessor": "S12-07/G106",
    "successor": "S12-09/G108",
    "sourceRange": {
      "startLine": 25735,
      "endLine": 25857
    },
    "sourceLocalRange": {
      "startLine": 1936,
      "endLine": 2058
    },
    "sourceStartByte": 59072,
    "sourceEndByteExclusive": 63233,
    "sourceSha256": "a975267d9307ce836a191a514f76730df7b187282f3a1f1dda0407ea589f79fe",
    "targetPath": "src/renderer/styles/compat/mixed-conditions/s12-08--shallow-container-220.css",
    "startAnchor": "At the accepted Stage A shallow heights,",
    "endAnchor": ".timeline-pending-drop-notice",
    "placement": "source-order",
    "status": "relocated"
  },
  {
    "id": "G109",
    "segment": "G109",
    "sectionIds": [
      "S13-01",
      "S13-02"
    ],
    "sourceSlice": "S13",
    "owner": "legacy-task",
    "migrationMode": "ORDERED_COMPAT",
    "canonicalOrder": 131,
    "predecessor": "S12-09/G108",
    "successor": "S13-03/G110",
    "sourceRange": {
      "startLine": 25877,
      "endLine": 27503
    },
    "sourceLocalRange": {
      "startLine": 1,
      "endLine": 1627
    },
    "sourceStartByte": 0,
    "sourceEndByteExclusive": 51140,
    "sourceSha256": "d8ed9649ab130f09fded9fabca3dd770df77551712da47b03741dffb480308fe",
    "targetPath": "src/renderer/styles/compat/retained-task-surfaces/s13-01--landscape-timed-384-385.css",
    "startAnchor": "BOF",
    "endAnchor": "Issue #422 + #432 R3-A:",
    "placement": "source-order",
    "status": "relocated"
  },
  {
    "id": "G112",
    "segment": "G112",
    "sectionIds": [
      "S13-05"
    ],
    "sourceSlice": "S13",
    "owner": "mixed",
    "migrationMode": "ORDERED_COMPAT",
    "canonicalOrder": 135,
    "predecessor": "S13-04/G111",
    "successor": "S14-01/G113",
    "sourceRange": {
      "startLine": 27860,
      "endLine": 27997
    },
    "sourceLocalRange": {
      "startLine": 1984,
      "endLine": 2121
    },
    "sourceStartByte": 61800,
    "sourceEndByteExclusive": 65768,
    "sourceSha256": "166cc15d2731d40bfba39afa68282fce2a55b5205f76087a26d867c896d95e62",
    "targetPath": "src/renderer/styles/compat/mixed-conditions/s13-05--render-dialogue-audio-media900.css",
    "startAnchor": "@media (max-width: 900px)",
    "endAnchor": "EOF",
    "placement": "source-order",
    "status": "relocated"
  }
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
  return './' + relative(dirname(entryPath), resolve(root, targetPath))
    .replaceAll(String.fromCharCode(92), '/')
    .replace(/^\.\//u, '');
}

function readTarget(id: string): string {
  const relocation = manifest.semanticRelocations.find((candidate) => candidate.id === id);
  if (!relocation) throw new Error('missing relocation ' + id);
  return normalize(readFileSync(resolve(root, relocation.targetPath), 'utf8'));
}

function canonicalRows() {
  const tick = String.fromCharCode(96);
  const sectionPattern = new RegExp(
    '^\\|\\s*(\\d+)\\s*\\|\\s*' + tick + '(S\\d{2}-\\d{2})' + tick +
      '\\s*\\|\\s*' + tick + '([^' + tick + ']+)' + tick +
      '\\s*\\|\\s*P2-\\d+\\s*\\|\\s*' + tick + '([^' + tick + ']+)' + tick + '\\s*\\|',
    'gmu',
  );
  const segmentPattern = new RegExp(
    '^\\|\\s*' + tick + '(G\\d{3})' + tick + '\\s*\\|\\s*' +
      tick + '([^' + tick + ']+)' + tick + '\\s*\\|\\s*(P2-\\d+)\\s*\\|\\s*' +
      '([^|]+?)\\s*\\|\\s*' + tick + '([^' + tick + ']+)' + tick + '\\s*\\|',
    'gmu',
  );
  return {
    sections: [...mapText.matchAll(sectionPattern)].map((match) => ({
      order: Number(match[1]!),
      id: match[2]!,
      owner: match[3]!,
      mode: match[4]!,
    })),
    segments: [...mapText.matchAll(segmentPattern)].map((match) => ({
      id: match[1]!,
      owner: match[2]!,
      issue: match[3]!,
      sectionText: match[4]!,
      targetPath: match[5]!,
    })),
  };
}

describe('Issue #553 SER-06 B14/B15 compatibility and closure contract', () => {
  it('registers all B14 P2-27 sections and segments with exact boundaries', () => {
    const actual = manifest.semanticRelocations
      .filter(({ id }) => expectedP227.some((expected) => expected.id === id))
      .sort((left, right) => left.canonicalOrder - right.canonicalOrder);

    expect(actual).toHaveLength(11);
    expect(actual.map(({ id }) => id)).toEqual(expectedP227.map(({ id }) => id));

    for (const expected of expectedP227) {
      const relocation = manifest.semanticRelocations.find(({ id }) => id === expected.id);
      expect(relocation).toBeDefined();
      expect(relocation).toMatchObject(expected);
      if (expected.sourceSegments) {
        expect(relocation?.sourceSegments).toEqual(expected.sourceSegments);
      }
    }

    const p227Sections = new Set(expectedP227.flatMap(({ sectionIds }) => sectionIds));
    expect(p227Sections.size).toBe(18);
    expect(p227Sections).toEqual(new Set([
      'S06-06', 'S06-07', 'S07-08', 'S08-05', 'S08-09', 'S08-10',
      'S08-11', 'S08-15', 'S09-01', 'S09-04', 'S11-10', 'S12-01',
      'S12-02', 'S12-05', 'S12-08', 'S13-01', 'S13-02', 'S13-05',
    ]));
  });

  it('keeps the real entry order, combined targets, and explicit retained remainders', () => {
    const imports = importPaths();
    const expectedImports = expectedP227
      .slice()
      .sort((left, right) => left.canonicalOrder - right.canonicalOrder)
      .map(({ targetPath }) => entryImportPath(targetPath));

    expect(imports.filter((candidate) => expectedImports.includes(candidate))).toEqual(expectedImports);
    for (const expectedImport of expectedImports) {
      expect(imports.filter((candidate) => candidate === expectedImport)).toHaveLength(1);
    }

    const retainedImports = [
      './styles/legacy-slices/05-asset-library-stage-sequence--between-shots-create.css',
      './styles/legacy-slices/05-asset-library-stage-sequence--after-shot-create.css',
      './styles/legacy-slices/07-portrait-assets-inspector-start-after-assets.css',
    ];
    for (const retained of retainedImports) {
      expect(imports.filter((candidate) => candidate === retained)).toHaveLength(1);
    }

    const removedImports = [
      './styles/legacy-slices/06-canvas-portrait-foundation--before-product-preview.css',
      './styles/legacy-slices/07-portrait-assets-inspector-start-after-timeline.css',
      './styles/legacy-slices/08-inspector-portrait-dialogue-after-timeline.css',
      './styles/legacy-slices/08-inspector-portrait-dialogue-after-shot-detail.css',
      './styles/legacy-slices/08-inspector-portrait-dialogue.css',
      './styles/legacy-slices/09-portrait-timed-landscape-assets.css',
      './styles/legacy-slices/09-portrait-timed-landscape-assets-after-dialogue-properties.css',
      './styles/legacy-slices/11-tools-inspector-timeline-start.css',
      './styles/legacy-slices/12-landscape-task-tray.css',
      './styles/legacy-slices/12-landscape-task-tray-after-pending-placement.css',
      './styles/legacy-slices/12-landscape-task-tray-after-dialogue-properties.css',
      './styles/legacy-slices/13-timed-render-media-tail-before-final-render.css',
      './styles/legacy-slices/13-timed-render-media-tail-after-final-render.css',
    ];
    for (const removed of removedImports) expect(imports).not.toContain(removed);
  });

  it('keeps each compat target byte-exact and preserves all condition units', () => {
    const p227 = expectedP227.map((expected) => ({
      expected,
      actual: manifest.semanticRelocations.find(({ id }) => id === expected.id)!,
    }));

    for (const { expected, actual } of p227) {
      const target = normalize(readFileSync(resolve(root, actual.targetPath), 'utf8'));
      expect(sha256(target)).toBe(expected.sourceSha256);
      expect(Buffer.byteLength(target, 'utf8')).toBe(
        expected.sourceEndByteExclusive - expected.sourceStartByte,
      );
      expect(target).not.toMatch(/@import|url\(|@font-face|@keyframes/u);
    }

    expect(readTarget('G049')).toContain('@media (max-width: 1100px)');
    expect(readTarget('G049')).toContain('@media (max-width: 720px)');
    expect(readTarget('G082').match(/@media \(max-width: 480px\)/gu)).toHaveLength(2);
    expect(readTarget('G103')).toContain('@media (max-width: 620px)');
    expect(readTarget('G107')).toContain('@container stage-e-timeline (max-height: 220px)');
    const mixed = readTarget('G112');
    expect(mixed.trimStart().startsWith('@media (max-width: 900px)')).toBe(true);
    expect(mixed.match(/@media \(max-width: 900px\)/gu)).toHaveLength(1);
    expect(mixed).toContain('.fla-review-session');
    expect(mixed).toContain('.dialogue-landscape-properties-audio-summary');
    expect(mixed).toContain('.timeline-audio-clip-error');
  });

  it('keeps the producers, hosts, and current runtime entry points unchanged', () => {
    const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
    const dialogueSheet = read('src/renderer/features/dialogue/DialogueSheet.tsx');
    const dialogueInspector = read('src/renderer/features/dialogue/DialogueInspector.tsx');
    const audioClip = read('src/renderer/features/timeline/AudioClip.tsx');
    const flaSession = read('src/renderer/fla-import/FlaCompatibilityReviewSession.tsx');
    const flaWorkbench = read('src/renderer/fla-import/FlaRenderWorkbench.tsx');
    const flaSnapshot = read('src/renderer/fla-import/FlaStaticSnapshotReview.tsx');
    const bottomWorkspace = read('src/renderer/shell/BottomWorkspace.tsx');
    const editorShell = read('src/renderer/shell/EditorShell.tsx');
    const timelineDock = read('src/renderer/features/timeline/TimelineDock.tsx');

    expect(dialogueSheet).toContain('dialogue-sheet-timeline');
    expect(dialogueInspector).toContain('dialogue-inspector-audio-section');
    expect(audioClip).toContain('timeline-audio-clip-error');
    expect(flaSession).toContain('<FlaRenderWorkbench');
    expect(flaSession).toContain('<FlaStaticSnapshotReview');
    expect(flaWorkbench).toContain('fla-render-workbench');
    expect(flaSnapshot).toContain('fla-snapshot-review');
    expect(bottomWorkspace).toContain('timelineUiStore.setHeightMax');
    expect(editorShell).toContain('data-testid="editor-body"');
    expect(timelineDock).not.toContain('timeline-task-tray');
  });

  it('reconciles 179 Sections and 147 Segments and audits prior evidence before B15 closure', () => {
    const rows = canonicalRows();
    expect(rows.sections).toHaveLength(179);
    expect(rows.segments).toHaveLength(147);

    const semanticSegments = manifest.semanticRelocations.map(({ segment }) => segment);
    expect(manifest.semanticRelocations).toHaveLength(147);
    expect(new Set(semanticSegments).size).toBe(147);
    expect(new Set(semanticSegments)).toEqual(new Set(rows.segments.map(({ id }) => id)));

    const assignedSections = manifest.semanticRelocations.flatMap(({ sectionIds }) => sectionIds);
    const canonicalSections = new Set(rows.sections.map(({ id }) => id));
    expect(assignedSections).toHaveLength(179);
    expect(new Set(assignedSections).size).toBe(179);
    expect(new Set(assignedSections)).toEqual(canonicalSections);

    for (const row of rows.segments) {
      const candidates = manifest.semanticRelocations.filter(({ segment }) => segment === row.id);
      expect(candidates).toHaveLength(1);
      const relocation = candidates[0]!;
      expect(relocation.owner).toBe(row.owner);
      expect(relocation.migrationMode).toBe(
        row.issue === 'P2-27' ? 'ORDERED_COMPAT' : row.issue === 'P2-28' ? 'CLOSURE' : relocation.migrationMode,
      );
      expect(new Set(relocation.sectionIds)).toEqual(
        new Set(row.sectionText.match(/S\d{2}-\d{2}/gu) ?? []),
      );
      expect(relocation.targetPath).toBe(
        authorizedCanonicalTargetOverrides.get(row.id) ?? row.targetPath,
      );
      expect(existsSync(resolve(root, relocation.targetPath))).toBe(true);
    }

    const evidenceDirectories = [
      'docs/evidence/issue-541-p2-01',
      'docs/evidence/issue-545-p2-02',
      'docs/evidence/issue-545-p2-03',
      'docs/evidence/issue-548-p2-04',
      'docs/evidence/issue-548-p2-05',
      'docs/evidence/issue-547-p2-06',
      'docs/evidence/issue-547-p2-07',
      'docs/evidence/issue-547-p2-08',
      'docs/evidence/issue-547-p2-09',
      'docs/evidence/issue-548-p2-10',
      'docs/evidence/issue-548-p2-11',
      'docs/evidence/issue-546-p2-b06',
      'docs/evidence/issue-550-p2-15',
      'docs/evidence/issue-551-p2-16',
      'docs/evidence/issue-551-p2-17',
      'docs/evidence/issue-552-p2-18',
      'docs/evidence/issue-552-p2-19',
      'docs/evidence/issue-552-p2-21',
      'docs/evidence/issue-549-p2-20',
      'docs/evidence/issue-549-p2-22',
      'docs/evidence/issue-549-p2-23',
      'docs/evidence/issue-549-p2-24',
      'docs/evidence/issue-549-p2-25',
      'docs/evidence/issue-549-p2-26',
      'docs/evidence/issue-553-p2-27',
    ];
    for (const evidenceDirectory of evidenceDirectories) {
      expect(existsSync(resolve(root, evidenceDirectory))).toBe(true);
    }

    const closurePath = resolve(root, 'docs/evidence/issue-553-p2-28/closure.json');
    expect(existsSync(closurePath)).toBe(true);
    const closure = JSON.parse(readFileSync(closurePath, 'utf8')) as {
      p2: string;
      migrationMode: string;
      counts: { canonicalSections: number; reconciledSections: number; missingSections: number; duplicateSections: number; canonicalSegments: number; reconciledSegments: number; missingSegments: number; duplicateSegments: number };
      productionEntry: { missing: number; duplicates: number; silentReorders: number };
      phase3Started: boolean;
      phase4Started: boolean;
      historicalReceiptsSelfReferential: boolean;
      canonicalTargetOverrides: Array<{
        segment: string;
        canonicalTarget: string;
        currentTarget: string;
        reason: string;
      }>;
      maintainerAcceptance: { status: string };
      auditEvidencePaths: string[];
    };
    expect(closure.p2).toBe('P2-28');
    expect(closure.migrationMode).toBe('CLOSURE');
    expect(closure.counts).toMatchObject({
      canonicalSections: 179,
      reconciledSections: 179,
      missingSections: 0,
      duplicateSections: 0,
      canonicalSegments: 147,
      reconciledSegments: 147,
      missingSegments: 0,
      duplicateSegments: 0,
    });
    expect(closure.productionEntry).toEqual({ missing: 0, duplicates: 0, silentReorders: 0 });
    expect(closure.phase3Started).toBe(false);
    expect(closure.phase4Started).toBe(false);
    expect(closure.historicalReceiptsSelfReferential).toBe(false);
    expect(closure.canonicalTargetOverrides).toEqual([
      {
        segment: 'G097',
        canonicalTarget: 'src/renderer/styles/shell/tools/s11-01--view-mode-pilot.css',
        currentTarget: 'src/renderer/styles/shell/tools/view-mode.css',
        reason: 'existing Issue #541 authorized alias; CSS bytes, import position, and production reconstruction remain unchanged',
        authority: 'tests/contract/issue541-p2-01.test.ts authorizedCanonicalTargetOverrides',
        contentDisposition: 'historical accepted alias, not a stranded Section or duplicate',
      },
    ]);
    expect(closure.auditEvidencePaths).toEqual(expect.arrayContaining(evidenceDirectories));
    expect(['PENDING', 'PASS']).toContain(closure.maintainerAcceptance.status);
  });

  it('keeps the accepted Phase 2 production snapshot historical after Phase 3 begins', () => {
    const closure = JSON.parse(
      readFileSync(resolve(root, 'docs/evidence/issue-553-p2-28/closure.json'), 'utf8'),
    ) as {
      productionEntryVerification: {
        baselineSha256: string;
        reconstructedSha256: string;
        exact: boolean;
      };
      historicalReceiptRules: { historicalReceiptsWereNotRewritten: boolean };
    };

    expect(closure.productionEntryVerification).toMatchObject({
      baselineSha256: '2404124609c88ee552288a51ffa3f5408cd2193adc754235af234cdd922ba3e7',
      reconstructedSha256: '2404124609c88ee552288a51ffa3f5408cd2193adc754235af234cdd922ba3e7',
      exact: true,
    });
    expect(closure.historicalReceiptRules.historicalReceiptsWereNotRewritten).toBe(true);
    expect(manifest.phase2CanonicalMap.approvedForAutomaticRelocation).toBe(false);
  });
});
