// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterService,
  FlaGraphicDefinitionSchema,
  LayerService,
  ProjectSchema,
  assessFlaGraphicSubtreeCandidate,
  buildAdaptivePartsFromFlaGraphicSubtrees,
  buildEditorStageRenderModel,
  characterPartSourceBounds,
  doFlaGraphicNodePathsOverlap,
  evaluateFlaGraphicVisual,
  evaluateShotAtTime,
  filterFlaGraphicInstanceOverridesForSubtree,
  hasRenderableFlaGraphicSubtree,
  resolveCharacterPartVisualSource,
  resolveLayerVisualParts,
  selectFlaGraphicSubtreeVisual,
  type AdaptivePartsCharacter,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { renderFlaGraphicCanvas } from '../../src/renderer/features/canvas/flaGraphicCanvasRenderer';
import { buildAdaptivePartsAssemblyPreviewVisual } from '../../src/renderer/features/characters/characterAssemblyPreview';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { FlaGraphicStructureTree } from '../../src/renderer/features/properties/FlaGraphicStructureTree';
import { shotThumbnailFingerprint } from '../../src/renderer/features/shots/shotThumbnail';
import { characterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { adaptivePartsFixture, adaptivePartsSourceRootTransform } from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './domain/testProject';

const GRAPHIC_ID = '93000000-0000-4000-8000-000000000001';
const LAYER_ID = '94000000-0000-4000-8000-000000000001';
const SIBLING_LAYER_ID = '94000000-0000-4000-8000-000000000002';
const FRAME_0_ASSET_ID = '95000000-0000-4000-8000-000000000001';
const FRAME_1_ASSET_ID = '95000000-0000-4000-8000-000000000002';
const MASKED_BITMAP_ASSET_ID = '95000000-0000-4000-8000-000000000003';
const OPAQUE_HAIR_ASSET_ID = '95000000-0000-4000-8000-000000000004';
const FRAME1_ONLY_ASSET_ID = '95000000-0000-4000-8000-000000000005';
const OPAQUE_CROP_ASSET_ID = '95000000-0000-4000-8000-000000000006';

const SHA_MASKED = '1'.repeat(64);
const SHA_HAIR = '2'.repeat(64);
const SHA_FRAME_0 = '3'.repeat(64);
const SHA_FRAME_1 = '4'.repeat(64);
const SHA_FRAME1_ONLY = '5'.repeat(64);
const SHA_CROP = '6'.repeat(64);

function matrix(tx = 0, ty = 0, scaleX = 1, scaleY = 1) {
  return { a: scaleX, b: 0, c: 0, d: scaleY, tx, ty };
}

function makeRichSubtreeProject(options?: {
  frameCropBranch?: boolean;
  includeSecondFrame?: boolean;
  stripStructure?: boolean;
}): {
  project: Project;
  definition: FlaGraphicDefinition;
} {
  const base = buildProject();
  const extraAssets = [
    {
      id: FRAME_0_ASSET_ID,
      kind: 'image' as const,
      name: 'frame0-whole.svg',
      relativePath: 'assets/frame0-whole.svg',
      mimeType: 'image/svg+xml',
      sha256: SHA_FRAME_0,
      width: 400,
      height: 400,
      usage: 'uncategorized' as const,
      keywords: [],
      flaGraphicFrame: { definitionId: GRAPHIC_ID, ordinal: 0 },
    },
    {
      id: FRAME_1_ASSET_ID,
      kind: 'image' as const,
      name: 'frame1-whole.svg',
      relativePath: 'assets/frame1-whole.svg',
      mimeType: 'image/svg+xml',
      sha256: SHA_FRAME_1,
      width: 400,
      height: 400,
      usage: 'uncategorized' as const,
      keywords: [],
      flaGraphicFrame: { definitionId: GRAPHIC_ID, ordinal: 1 },
    },
    {
      id: MASKED_BITMAP_ASSET_ID,
      kind: 'image' as const,
      name: 'sleeve.png',
      relativePath: 'assets/sleeve.png',
      mimeType: 'image/png',
      sha256: SHA_MASKED,
      width: 80,
      height: 100,
      usage: 'uncategorized' as const,
      keywords: [],
    },
    {
      id: OPAQUE_HAIR_ASSET_ID,
      kind: 'image' as const,
      name: 'hair-subtree.svg',
      relativePath: 'assets/hair-subtree.svg',
      mimeType: 'image/svg+xml',
      sha256: SHA_HAIR,
      width: 120,
      height: 140,
      usage: 'uncategorized' as const,
      keywords: [],
    },
    {
      id: FRAME1_ONLY_ASSET_ID,
      kind: 'image' as const,
      name: 'frame1-only.png',
      relativePath: 'assets/frame1-only.png',
      mimeType: 'image/png',
      sha256: SHA_FRAME1_ONLY,
      width: 60,
      height: 60,
      usage: 'uncategorized' as const,
      keywords: [],
    },
    {
      id: OPAQUE_CROP_ASSET_ID,
      kind: 'image' as const,
      name: 'crop-ribbon.svg',
      relativePath: 'assets/crop-ribbon.svg',
      mimeType: 'image/svg+xml',
      sha256: SHA_CROP,
      width: 40,
      height: 40,
      usage: 'uncategorized' as const,
      keywords: [],
    },
  ];

  const frameDurationMs = 1_000 / 24;
  const includeSecondFrame = options?.includeSecondFrame ?? true;
  const frames = [
    {
      ordinal: 0,
      sourceFrameIndex: 0,
      assetId: FRAME_0_ASSET_ID,
      sha256: SHA_FRAME_0,
      sourceViewport: { x: 0, y: 0, width: 400, height: 400 },
      offset: { x: 0, y: 0 },
      startMs: 0,
      durationMs: frameDurationMs,
      createdBySequenceImport: false,
    },
    ...(includeSecondFrame
      ? [
          {
            ordinal: 1,
            sourceFrameIndex: 1,
            assetId: FRAME_1_ASSET_ID,
            sha256: SHA_FRAME_1,
            sourceViewport: { x: 0, y: 0, width: 400, height: 400 },
            offset: { x: 0, y: 0 },
            startMs: frameDurationMs,
            durationMs: frameDurationMs,
            createdBySequenceImport: false,
          },
        ]
      : []),
  ];

  const structure = options?.stripStructure
    ? undefined
    : {
        version: 1 as const,
        symbolDefinitions: {
          armDef: {
            symbolRef: 'ArmSymbol',
            children: [
              {
                type: 'bitmap' as const,
                id: 'sleeve-bitmap',
                sourceAddress: 'arm/sleeve',
                drawOrder: 0,
                localTransform: matrix(20, 10),
                bitmapRef: '袖子.png',
                assetId: MASKED_BITMAP_ASSET_ID,
              },
            ],
          },
        },
        frames: [
          {
            ordinal: 0,
            layers: [
              {
                name: '图层_头发',
                nodes: [
                  {
                    type: 'group' as const,
                    id: 'hair-group',
                    groupId: '头发组',
                    drawOrder: 0,
                    localTransform: matrix(100, 30),
                    children: [
                      {
                        type: 'opaque' as const,
                        id: 'hair-shape',
                        drawOrder: 0,
                        localTransform: matrix(0, 0),
                        opaqueKind: 'shape' as const,
                        fallbackAssetId: OPAQUE_HAIR_ASSET_ID,
                        fallbackScope: 'subtree' as const,
                        fallbackViewBox: { x: -10, y: -5, width: 120, height: 140 },
                      },
                    ],
                  },
                ],
              },
              {
                name: '图层_手臂',
                nodes: [
                  {
                    type: 'group' as const,
                    id: 'arm-scale-group',
                    groupId: '左袖组',
                    drawOrder: 0,
                    localTransform: matrix(40, 120, 0.5, 0.5),
                    children: [
                      {
                        type: 'symbol' as const,
                        id: 'arm-symbol',
                        symbolRef: '左臂元件',
                        nestedDefinitionId: 'armDef',
                        drawOrder: 0,
                        localTransform: matrix(10, 20),
                        opacity: 0.6,
                        rgbTransform: { multiplier: 0.8, offset: 12 },
                        clipPaths: [
                          {
                            shapes: [
                              {
                                shapeId: 'sleeve-mask',
                                worldTransform: matrix(45, 130, 0.5, 0.5),
                                parentLocalTransform: matrix(10, 20),
                                pathData: ['M0 0L80 0L80 100L0 100Z'],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    type: 'group' as const,
                    id: 'empty-group',
                    groupId: '空分组',
                    drawOrder: 1,
                    localTransform: matrix(),
                    children: [],
                  },
                  {
                    type: 'opaque' as const,
                    id: 'unsafe-opaque',
                    drawOrder: 2,
                    localTransform: matrix(300, 300),
                    opaqueKind: 'filter' as const,
                  },
                  ...(options?.frameCropBranch
                    ? [
                        {
                          type: 'opaque' as const,
                          id: 'frame-crop-node',
                          drawOrder: 3,
                          localTransform: matrix(210, 220),
                          opaqueKind: 'shape' as const,
                          fallbackAssetId: OPAQUE_CROP_ASSET_ID,
                          fallbackScope: 'frame-crop' as const,
                          fallbackViewBox: { x: 210, y: 220, width: 40, height: 40 },
                        },
                      ]
                    : []),
                ],
              },
            ],
          },
          // Note: frame 1 intentionally omits structureFrame so whole-person leakage is immediately detectable.
        ],
      };

  const definition = FlaGraphicDefinitionSchema.parse({
    id: GRAPHIC_ID,
    kind: 'fla-graphic',
    name: '小师妹元件',
    source: {
      basename: 'xiaoshimei.fla',
      sha256: 'a'.repeat(64),
      renderTargetId: 'xiaoshimei-target',
      targetKind: 'graphic-symbol',
      targetName: '小师妹元件',
      startFrameIndex: 0,
      endFrameIndex: includeSecondFrame ? 1 : 0,
      sourceFps: 24,
      canvas: { width: 400, height: 400 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 400, height: 400 },
    },
    durationMs: frames.length * frameDurationMs,
    frames,
    ...(structure ? { structure } : {}),
  });

  const shot = base.shots[0]!;
  const project = ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...extraAssets],
    animations: [definition],
    shots: [
      {
        ...shot,
        layers: [
          ...shot.layers,
          {
            id: LAYER_ID,
            name: '小师妹实例',
            source: { kind: 'animation' as const, animationId: GRAPHIC_ID },
            startTimeMs: 0,
            animationPlayback: { mode: 'loop' as const, endBehavior: 'hold' as const },
            anchor: 'center' as const,
            x: 960,
            y: 540,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            locked: false,
            flipX: false,
            zIndex: shot.layers.length,
          },
          {
            id: SIBLING_LAYER_ID,
            name: '参照图形实例',
            source: { kind: 'animation' as const, animationId: GRAPHIC_ID },
            startTimeMs: 0,
            animationPlayback: { mode: 'loop' as const, endBehavior: 'hold' as const },
            anchor: 'center' as const,
            x: 500,
            y: 540,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            locked: false,
            flipX: false,
            zIndex: shot.layers.length + 1,
          },
        ],
      },
    ],
  });
  return { project, definition };
}

function installCanvasAndImageStubs() {
  class FakeCtx {
    globalAlpha = 1;
    globalCompositeOperation = 'source-over';
    fillStyle: unknown = '';
    save() {}
    restore() {}
    setTransform() {}
    clearRect() {}
    drawImage() {}
    fill() {}
    getImageData() {
      return { data: new Uint8ClampedArray([100, 100, 100, 255]) };
    }
    putImageData() {}
  }
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    const el = origCreate(tagName, options);
    if (tagName.toLowerCase() === 'canvas') {
      (el as unknown as { getContext: () => FakeCtx }).getContext = () => new FakeCtx();
      (el as unknown as { toDataURL: () => string }).toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    }
    return el;
  }) as typeof document.createElement);
  vi.stubGlobal('Path2D', class {
    constructor(readonly pathData: string) {}
  });
  vi.stubGlobal('Image', class {
    width = 80;
    height = 100;
    naturalWidth = 80;
    naturalHeight = 100;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = '';
    get src() {
      return this._src;
    }
    set src(value: string) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    }
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-subtree-image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  (window as unknown as Record<string, unknown>).pandaStage = {
    assets: {
      readCanvasImage: vi.fn().mockResolvedValue({
        ok: true,
        status: 'ready',
        bytes: new Uint8Array([137, 80, 78, 71]),
        mimeType: 'image/png',
      }),
      readThumbnail: vi.fn().mockResolvedValue({
        ok: true,
        status: 'ready',
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      }),
    },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  characterAssemblySessionStore.getActiveSessionHandle()?.cancel();
  selectionStore.clear();
  selectionStore.setStructuredEditScope(null);
  selectionStore.setSelectedStructuredNodePath(null);
  editorProjectStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FLA Graphic independent Subtree CharacterParts (#1192 V2-C)', () => {
  it('isolates nested symbols with parent scale, clipPaths, opacity, and rgbTransform without mutating cached parent visuals', () => {
    const { project, definition } = makeRichSubtreeProject({ frameCropBranch: true });
    const fullVisual = evaluateFlaGraphicVisual({
      definition,
      frameOrdinal: 0,
      mode: 'instance',
    })!;
    expect([...fullVisual.resourceAssetIds].sort()).toEqual(
      [MASKED_BITMAP_ASSET_ID, OPAQUE_HAIR_ASSET_ID, OPAQUE_CROP_ASSET_ID].sort(),
    );

    const hairPath = ['hair-group'];
    const armPath = ['arm-scale-group'];
    const symbolPath = ['arm-scale-group', 'arm-symbol'];
    const sleeveLeafPath = ['arm-scale-group', 'arm-symbol', 'sleeve-bitmap'];

    const hairVisual = selectFlaGraphicSubtreeVisual(fullVisual, hairPath);
    const armVisual = selectFlaGraphicSubtreeVisual(fullVisual, armPath);
    const sleeveVisual = selectFlaGraphicSubtreeVisual(fullVisual, sleeveLeafPath);

    // Original evaluated visual must stay immutable and keep all sibling assets.
    expect([...fullVisual.resourceAssetIds].sort()).toEqual(
      [MASKED_BITMAP_ASSET_ID, OPAQUE_HAIR_ASSET_ID, OPAQUE_CROP_ASSET_ID].sort(),
    );
    expect(hairVisual).not.toBe(fullVisual);
    expect(hairVisual.resourceAssetIds).toEqual([OPAQUE_HAIR_ASSET_ID]);
    expect(armVisual.resourceAssetIds).toEqual([MASKED_BITMAP_ASSET_ID]);
    expect(sleeveVisual.resourceAssetIds).toEqual([MASKED_BITMAP_ASSET_ID]);

    // Selecting deeper descendant preserves strict ancestor 0.5x scale, clipPaths, opacity, rgbTransform once (no double matrix).
    const retainedGroup = sleeveVisual.layers![0]!.nodes[0]!;
    expect(retainedGroup.path).toEqual(armPath);
    expect(retainedGroup.worldTransform).toEqual(matrix(40, 120, 0.5, 0.5));
    const retainedSymbol = retainedGroup.children[0]!;
    expect(retainedSymbol.path).toEqual(symbolPath);
    expect(retainedSymbol.clipPaths).toHaveLength(1);
    expect(retainedSymbol.source.type).toBe('symbol');
    if (retainedSymbol.source.type === 'symbol') {
      expect(retainedSymbol.source.opacity).toBe(0.6);
      expect(retainedSymbol.source.rgbTransform).toEqual({ multiplier: 0.8, offset: 12 });
    }
    const retainedLeaf = retainedSymbol.children[0]!;
    // Expected worldTransform = parent(40, 120, 0.5) * symbol(10, 20) * leaf(20, 10)
    // tx = 40 + 0.5*(10 + 20) = 55; ty = 120 + 0.5*(20 + 10) = 135; scale = 0.5
    expect(retainedLeaf.worldTransform).toEqual(matrix(55, 135, 0.5, 0.5));

    // Tight part bounds match scaled leaf geometry in Graphic space (80*0.5=40, 100*0.5=50).
    const input = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition,
      frameOrdinal: 0,
      selections: [
        { nodePath: armPath, label: '左袖子' },
        { nodePath: hairPath, label: '头发' },
      ],
      createId: (() => {
        let idx = 0;
        const ids = [
          'a0000000-0000-4000-8000-000000000010',
          'a0000000-0000-4000-8000-000000000020',
        ];
        return () => ids[idx++]!;
      })(),
    });
    // Layer order: hair is in Layer[0] (drawOrder 0), arm is in Layer[1] (drawOrder 1) even though passed second.
    expect(input.parts.map((part) => part.displayName)).toEqual(['头发', '左袖子']);
    expect(input.parts[0]!.drawOrder).toBe(0);
    expect(input.parts[1]!.drawOrder).toBe(1);

    expect(characterPartSourceBounds(input.parts[0]!, project.animations, project.assets)).toEqual({
      x: 90,
      y: 25,
      width: 120,
      height: 140,
    });
    expect(characterPartSourceBounds(input.parts[1]!, project.animations, project.assets)).toEqual({
      x: 55,
      y: 135,
      width: 40,
      height: 50,
    });

    // Candidate assessment rules: overlap blocked, empty group/unsafe opaque blocked, frame-crop warned cleanly.
    expect(doFlaGraphicNodePathsOverlap(armPath, symbolPath)).toBe(true);
    expect(doFlaGraphicNodePathsOverlap(hairPath, armPath)).toBe(false);
    expect(assessFlaGraphicSubtreeCandidate({ definition, frameOrdinal: 0, nodePath: ['empty-group'] })).toMatchObject({
      found: true,
      extractable: false,
    });
    expect(assessFlaGraphicSubtreeCandidate({ definition, frameOrdinal: 0, nodePath: ['unsafe-opaque'] })).toMatchObject({
      found: true,
      extractable: false,
    });
    const cropCandidate = assessFlaGraphicSubtreeCandidate({
      definition,
      frameOrdinal: 0,
      nodePath: ['frame-crop-node'],
    });
    expect(cropCandidate.extractable).toBe(true);
    expect(cropCandidate.warning).toBeTruthy();
  });

  it('pins multi-frame Graphic subtrees to poseFrameOrdinal and never falls back to frame-1 or whole-person artwork', () => {
    const { project, definition } = makeRichSubtreeProject({ includeSecondFrame: true });
    const input = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition,
      frameOrdinal: 0,
      selections: [{ nodePath: ['hair-group'] }, { nodePath: ['arm-scale-group'] }],
    });
    const withChar = new CharacterService().createAdaptiveParts(project, input);
    const charId = withChar.characters.at(-1)!.id;
    const withLayer = new LayerService().createFromAdaptiveCharacter(
      withChar,
      project.shots[0]!.id,
      charId,
      { x: 960, y: 540 },
    ).project;
    // Remove full-animation layers from shot so ONLY adaptive subtree character remains in shot.
    const subtreeOnlyProject = ProjectSchema.parse({
      ...withLayer,
      shots: [
        {
          ...withLayer.shots[0]!,
          layers: withLayer.shots[0]!.layers.filter(
            (layer) => layer.id !== LAYER_ID && layer.id !== SIBLING_LAYER_ID,
          ),
        },
      ],
    });
    const shot = subtreeOnlyProject.shots[0]!;
    // Advance Shot time to 120ms (> 1/24s = 41.67ms frame 0, straight into frame 1 on an animation layer).
    const evaluatedAtFrame1Time = evaluateShotAtTime(shot, 120, subtreeOnlyProject);
    const charEvalLayer = evaluatedAtFrame1Time.layers.find((layer) => layer.id === shot.layers.at(-1)!.id)!;
    const visual = resolveLayerVisualParts(subtreeOnlyProject, shot, charEvalLayer);

    expect(visual.parts).toHaveLength(2);
    expect(visual.parts[0]?.flaGraphic?.frameOrdinal).toBe(0);
    expect(visual.parts[1]?.flaGraphic?.frameOrdinal).toBe(0);
    expect(visual.parts[0]?.assetId).toBeUndefined();
    expect(visual.parts[1]?.assetId).toBeUndefined();
    expect(visual.resources.required.map((r) => r.assetId).sort()).toEqual(
      [OPAQUE_HAIR_ASSET_ID, MASKED_BITMAP_ASSET_ID].sort(),
    );
    expect(visual.resources.candidates).toEqual([]);

    const exportMedia = collectExportPreparationMedia(subtreeOnlyProject);
    const exportIds = new Set(exportMedia.map((entry) => entry.asset.id));
    expect(exportIds.has(OPAQUE_HAIR_ASSET_ID)).toBe(true);
    expect(exportIds.has(MASKED_BITMAP_ASSET_ID)).toBe(true);
    expect(exportIds.has(FRAME_0_ASSET_ID)).toBe(false);
    expect(exportIds.has(FRAME_1_ASSET_ID)).toBe(false);
    expect(exportIds.has(FRAME1_ONLY_ASSET_ID)).toBe(false);
  });

  it('degrades invalid nodePath or missing structure locally empty without whole-person fallback', () => {
    const { project, definition } = makeRichSubtreeProject();
    const validInput = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition,
      frameOrdinal: 0,
      selections: [{ nodePath: ['hair-group'] }, { nodePath: ['arm-scale-group'] }],
    });
    // Corrupt Part 1's nodePath while leaving Part 0's hair nodePath intact.
    const damagedProject = new CharacterService().createAdaptiveParts(project, {
      ...validInput,
      parts: [
        validInput.parts[0]!,
        {
          ...validInput.parts[1]!,
          visualSource: {
            kind: 'fla-graphic',
            animationId: GRAPHIC_ID,
            nodePath: ['non-existent-group', 'missing'],
            poseFrameOrdinal: 0,
          },
        },
      ],
    });
    const char = damagedProject.characters.at(-1) as AdaptivePartsCharacter;
    const placed = new LayerService().createFromAdaptiveCharacter(
      damagedProject,
      damagedProject.shots[0]!.id,
      char.id,
      { x: 960, y: 540 },
    ).project;
    const shot = placed.shots[0]!;
    const evalLayer = evaluateShotAtTime(shot, 0, placed).layers.at(-1)!;
    const visual = resolveLayerVisualParts(placed, shot, evalLayer);

    expect(visual.parts[0]?.flaGraphic?.resourceAssetIds).toEqual([OPAQUE_HAIR_ASSET_ID]);
    expect(hasRenderableFlaGraphicSubtree(visual.parts[0]!.flaGraphic!)).toBe(true);
    // Missing nodePath must degrade locally with empty structured layers and NO whole-person assetId.
    expect(visual.parts[1]?.assetId).toBeUndefined();
    expect(visual.parts[1]?.flaGraphic?.layers).toEqual([]);
    expect(visual.parts[1]?.flaGraphic?.resourceAssetIds).toEqual([]);
    expect(hasRenderableFlaGraphicSubtree(visual.parts[1]!.flaGraphic!)).toBe(false);

    // Strip structure from parent Graphic Definition at runtime -> ProjectSchema parses & both parts degrade locally empty cleanly.
    const parsedNoStruct = ProjectSchema.parse({
      ...placed,
      animations: placed.animations.map((animation) => {
        if (!('kind' in animation) || animation.kind !== 'fla-graphic') {
          return animation;
        }
        const stripped = { ...animation };
        delete stripped.structure;
        return stripped;
      }),
    });
    const evalNoStructShot = parsedNoStruct.shots[0]!;
    const noStructLayer = evaluateShotAtTime(evalNoStructShot, 0, parsedNoStruct).layers.at(-1)!;
    const noStructVisual = resolveLayerVisualParts(parsedNoStruct, evalNoStructShot, noStructLayer);
    expect(noStructVisual.parts[0]?.assetId).toBeUndefined();
    expect(noStructVisual.parts[0]?.flaGraphic?.layers).toEqual([]);
    expect(noStructVisual.parts[0]?.flaGraphic?.resourceAssetIds).toEqual([]);

    const previewVisual = buildAdaptivePartsAssemblyPreviewVisual(parsedNoStruct, {
      kind: 'adaptive-parts',
      characterId: char.id,
      selectedPartId: char.parts[0]!.partId,
      draft: {
        sourceRootTransform: char.sourceRootTransform,
        parts: char.parts,
      },
    } as never);
    expect(previewVisual?.parts[0]?.flaGraphic?.layers).toEqual([]);
  });

  it('clones sparse instanceTransformOverrides per extracted Part without mutating shared Definition or sibling instances', () => {
    const { project, definition } = makeRichSubtreeProject();
    const overrides = {
      '0': {
        [JSON.stringify(['arm-scale-group'])]: matrix(75, 160, 0.5, 0.5),
        [JSON.stringify(['hair-group'])]: matrix(120, 45),
      },
    };
    const filteredArm = filterFlaGraphicInstanceOverridesForSubtree(overrides, 0, ['arm-scale-group'])!;
    expect(Object.keys(filteredArm['0']!)).toEqual([JSON.stringify(['arm-scale-group'])]);

    const input = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition,
      frameOrdinal: 0,
      selections: [{ nodePath: ['hair-group'] }, { nodePath: ['arm-scale-group'] }],
      instanceTransformOverrides: overrides,
    });
    const hairSource = resolveCharacterPartVisualSource(input.parts[0]!);
    const armSource = resolveCharacterPartVisualSource(input.parts[1]!);
    expect(hairSource.kind).toBe('fla-graphic');
    expect(armSource.kind).toBe('fla-graphic');
    if (hairSource.kind === 'fla-graphic' && armSource.kind === 'fla-graphic') {
      expect(Object.keys(hairSource.instanceTransformOverrides!['0']!)).toEqual([JSON.stringify(['hair-group'])]);
      expect(Object.keys(armSource.instanceTransformOverrides!['0']!)).toEqual([JSON.stringify(['arm-scale-group'])]);
      // Mutating one Part's override must never leak to Definition or sibling layer.
      hairSource.instanceTransformOverrides!['0']![JSON.stringify(['hair-group'])]!.tx = 222;
    }

    const withChar = new CharacterService().createAdaptiveParts(project, input);
    const defNode = withChar.animations.find((a) => a.id === GRAPHIC_ID);
    if (defNode && 'structure' in defNode) {
      expect(defNode.structure?.frames[0]?.layers[0]?.nodes[0]?.localTransform.tx).toBe(100);
    }
    const siblingVisual = evaluateFlaGraphicVisual({
      definition: defNode as FlaGraphicDefinition,
      frameOrdinal: 0,
      mode: 'instance',
    })!;
    expect(siblingVisual.layers![0]!.nodes[0]!.worldTransform.tx).toBe(100);
  });

  it('supports UI extraction from FlaGraphicStructureTree, atomic History Undo/Redo, Workbench edits, Shot join, Stage/Export parity, and PNG control', async () => {
    installCanvasAndImageStubs();
    const { project } = makeRichSubtreeProject();
    // Add an existing PNG control adaptive character so we verify non-regression alongside subtree extraction.
    const baseCharService = new CharacterService();
    const controlProject = baseCharService.createAdaptiveParts(project, {
      name: 'PNG 控件角色',
      sourceRootTransform: adaptivePartsSourceRootTransform(),
      parts: adaptivePartsFixture(IDS.assetChar),
    });

    editorProjectStore.open('D:/v2c-ui-e2e.pandastage', controlProject);
    shotStore.select(controlProject.shots[0]!.id);
    selectionStore.select(LAYER_ID);

    // 1. Render FlaGraphicStructureTree and stage 2 distinct subtrees without touching Project revision/history.
    act(() => root.render(createElement(FlaGraphicStructureTree)));
    const beforeSnapshot = editorProjectStore.getSnapshot()!;
    const beforeHistory = editorProjectStore.history.getSnapshot();

    const findTreeItem = (label: string) =>
      container.querySelector<HTMLElement>(`[role="treeitem"][aria-label="${label}"]`)!;
    const hairTreeItem = findTreeItem('头发组');
    const armGroupItem = findTreeItem('左袖组');
    expect(hairTreeItem).toBeTruthy();
    expect(armGroupItem).toBeTruthy();

    act(() => armGroupItem.click());
    const stageBtn = () => container.querySelector<HTMLButtonElement>('[data-testid="fla-subtree-stage-toggle"]')!;
    const createBtn = () => container.querySelector<HTMLButtonElement>('[data-testid="fla-subtree-create-character"]')!;
    expect(stageBtn().disabled).toBe(false);
    act(() => stageBtn().click());
    expect(container.querySelectorAll('[data-testid="fla-subtree-staged-list"] li')).toHaveLength(1);
    expect(createBtn().disabled).toBe(true);

    // Expand 左袖组 to select its nested descendant 左臂元件 -> blocked cleanly for overlap.
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="展开左袖组"]')!.click());
    const nestedSymbolItem = findTreeItem('左臂元件');
    expect(nestedSymbolItem).toBeTruthy();
    act(() => nestedSymbolItem.click());
    expect(stageBtn().disabled).toBe(true);
    expect(container.textContent).toContain('包含关系');

    // Selecting disjoint sibling hair group enables creation.
    act(() => hairTreeItem.click());
    expect(stageBtn().disabled).toBe(false);
    act(() => stageBtn().click());
    expect(container.querySelectorAll('[data-testid="fla-subtree-staged-list"] li')).toHaveLength(2);
    expect(createBtn().disabled).toBe(false);

    // Staging must NEVER create History or dirty state.
    expect(editorProjectStore.getSnapshot()!.revision).toBe(beforeSnapshot.revision);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(beforeHistory.undoCount);

    // Click Create Character -> single atomic History entry + Adaptive Parts Workbench session started.
    act(() => createBtn().click());
    const afterCreate = editorProjectStore.getSnapshot()!;
    expect(afterCreate.revision).toBe(beforeSnapshot.revision + 1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(beforeHistory.undoCount + 1);

    const createdChar = afterCreate.project.characters.at(-1) as AdaptivePartsCharacter;
    expect(createdChar.mode).toBe('adaptive-parts');
    expect(createdChar.parts).toHaveLength(2);
    const createdHairSource = resolveCharacterPartVisualSource(createdChar.parts[0]!);
    const createdSleeveSource = resolveCharacterPartVisualSource(createdChar.parts[1]!);
    expect(createdHairSource).toMatchObject({
      kind: 'fla-graphic',
      animationId: GRAPHIC_ID,
      nodePath: ['hair-group'],
      poseFrameOrdinal: 0,
    });
    expect(createdSleeveSource).toMatchObject({
      kind: 'fla-graphic',
      animationId: GRAPHIC_ID,
      nodePath: ['arm-scale-group'],
      poseFrameOrdinal: 0,
    });
    expect(createdChar.parts[0]!.partId).not.toBe(createdChar.parts[1]!.partId);
    expect(createdChar.parts[0]!.source.sourceId).not.toBe(createdChar.parts[1]!.source.sourceId);

    const activeSession = characterAssemblySessionStore.getSnapshot();
    expect(activeSession?.kind).toBe('adaptive-parts');
    if (!activeSession || activeSession.kind !== 'adaptive-parts') throw new Error('Expected adaptive-parts session');
    expect(activeSession.characterId).toBe(createdChar.id);

    // 2. Mount CharacterAssemblyWorkbench (even with unmounted CharacterManager ref={current:null}).
    const renderWorkbench = () =>
      act(() =>
        root.render(
          createElement(CharacterAssemblyWorkbench, {
            projectSnapshot: editorProjectStore.getSnapshot()!,
            session: characterAssemblySessionStore.getSnapshot()!,
            adaptivePartsActionsRef: { current: null },
          }),
        ),
      );
    renderWorkbench();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    renderWorkbench();

    const canvasParts = container.querySelectorAll<HTMLElement>('[data-testid="adaptive-parts-assembly-canvas-part"]');
    expect(canvasParts).toHaveLength(2);
    // Tight distinct hitboxes match leaf bounds (120x140 hair and 40x50 sleeve, NOT 400x400 whole canvas).
    const partWidths = [...canvasParts].map((el) => el.style.width).sort();
    expect(partWidths).toEqual(['120px', '40px']);
    for (const partDiv of canvasParts) {
      const img = partDiv.querySelector('img');
      if (img) expect(img.style.pointerEvents).toBe('none');
    }

    // Edit Part 0 in draft (move, rotate, scale) & verify selection outline wraps tightly, then apply.
    const rows = container.querySelectorAll<HTMLElement>('[data-testid="adaptive-parts-assembly-row"]');
    expect(rows).toHaveLength(2);
    act(() => rows[1]!.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-edit-button"]')!.click());
    renderWorkbench();
    const outline = container.querySelector<HTMLElement>('[data-testid="adaptive-parts-assembly-selection-outline"]');
    expect(outline).toBeTruthy();
    expect(outline!.style.width).toBe('120px');
    expect(outline!.style.height).toBe('140px');
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-offset-x-step-up"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-rotation-deg-step-up"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-scale-percent-step-up"]')!.click());
    // Hide top sleeve part temporarily, verify only 1 canvas part renders, then show it again before joining shot.
    act(() => rows[0]!.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-visibility-toggle"]')!.click());
    renderWorkbench();
    expect(container.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]')).toHaveLength(1);
    act(() => rows[0]!.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-visibility-toggle"]')!.click());
    renderWorkbench();
    expect(container.querySelectorAll('[data-testid="adaptive-parts-assembly-canvas-part"]')).toHaveLength(2);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-assembly-apply"]')!.click());
    renderWorkbench();

    const editedProject = editorProjectStore.getSnapshot()!.project;
    const editedChar = editedProject.characters.find((c) => c.id === createdChar.id) as AdaptivePartsCharacter;
    expect(editedChar.parts[0]!.restTransform.tx).not.toBe(0);
    expect(editedChar.parts[0]!.restTransform.b).not.toBe(0);
    expect(editedChar.parts[1]!.restTransform).toEqual(createdChar.parts[1]!.restTransform);

    // Join current Shot directly from Workbench fallback even with unmounted CharacterManager!
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-join-current-shot"]')!.click());
    expect(characterAssemblySessionStore.getSnapshot()).toBeNull();
    const shotAfterJoin = editorProjectStore.getSnapshot()!.project.shots[0]!;
    const joinedLayer = shotAfterJoin.layers.at(-1)!;
    expect(joinedLayer.source).toEqual({
      kind: 'character',
      characterId: createdChar.id,
    });

    // Verify Undo & Redo cleanly revert and restore Shot join + creation.
    act(() => {
      editorProjectStore.undo();
    });
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.some((l) => l.id === joinedLayer.id)).toBe(false);
    act(() => {
      editorProjectStore.redo();
    });
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.some((l) => l.id === joinedLayer.id)).toBe(true);

    // Verify Stage vs Export parity + legacy PNG control still intact.
    const latestProject = editorProjectStore.getSnapshot()!.project;
    const latestShot = latestProject.shots[0]!;
    const stageOnlyProject = ProjectSchema.parse({
      ...latestProject,
      shots: [
        {
          ...latestShot,
          layers: latestShot.layers.filter((l) => l.id !== LAYER_ID && l.id !== SIBLING_LAYER_ID),
        },
      ],
    });
    const evalStageShot = evaluateShotAtTime(stageOnlyProject.shots[0]!, 0, stageOnlyProject);
    const assetUrls = Object.fromEntries(
      stageOnlyProject.assets
        .filter((a) => a.kind === 'image')
        .map((a) => [a.id, `asset:///${a.id}`]),
    );
    const editorStage = buildEditorStageRenderModel(stageOnlyProject, stageOnlyProject.shots[0]!);
    const exportStage = buildStageRenderModel(stageOnlyProject, evalStageShot, assetUrls);
    const editorJoinedLayer = editorStage.layers.find((l) => l.layer.id === joinedLayer.id)!;
    const exportJoinedLayer = exportStage.layers.find((l) => l.id === joinedLayer.id)!;
    expect(editorJoinedLayer.visual.parts.map((p) => p.flaGraphic?.resourceAssetIds)).toEqual(
      exportJoinedLayer.parts.map((p) => p.flaGraphic?.resourceAssetIds),
    );
    const renderImgMap = new Map<string, CanvasImageSource>([
      [OPAQUE_HAIR_ASSET_ID, new Image() as unknown as CanvasImageSource],
      [MASKED_BITMAP_ASSET_ID, new Image() as unknown as CanvasImageSource],
    ]);
    expect(renderFlaGraphicCanvas(editorJoinedLayer.visual.parts[0]!.flaGraphic!, renderImgMap)?.visibleRect).toBeTruthy();
    expect(renderFlaGraphicCanvas(editorJoinedLayer.visual.parts[1]!.flaGraphic!, renderImgMap)?.visibleRect).toBeTruthy();
    expect(shotThumbnailFingerprint(stageOnlyProject, stageOnlyProject.shots[0]!).length).toBeGreaterThan(0);

    // Control: PNG Adaptive Character bounds stay untouched.
    const controlChar = latestProject.characters.find((c) => c.name === 'PNG 控件角色') as AdaptivePartsCharacter;
    expect(characterPartSourceBounds(controlChar.parts[0]!, latestProject.animations, latestProject.assets)).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 640,
    });
  });
});
