import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FlaGraphicStructureSchema,
  LayerService,
  ProjectSchema,
  composeAffineMatrix,
  decomposeAffineMatrix,
  evaluateFlaGraphicTrackAtTime,
  evaluateFlaGraphicVisual,
  evaluateShotAtTime,
  resolveFlaGraphicStableNodeIdentity,
  resolveLayerVisualParts,
  type FlaGraphicDefinition,
  type FlaGraphicStructure,
  type Project,
} from '../../src/domain';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { evaluateFlaGraphicProjectionVisual } from '../../src/renderer/features/canvas/FlaGraphicStructureProjection';
import { FlaGraphicInternalTimelineBar } from '../../src/renderer/features/timeline/FlaGraphicInternalTimelineBar';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

const FLA_FRAME_ASSET_ID = '10000000-0000-4000-8000-000000000004';
const NESTED_DEF_ID = 'symdef_e6_hand_01';
const BASE_MATRIX: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 };
const OVERRIDE_MATRIX: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 333, ty: 444 };

function e6Structure(): FlaGraphicStructure {
  return FlaGraphicStructureSchema.parse({
    version: 1,
    symbolDefinitions: {
      [NESTED_DEF_ID]: {
        symbolRef: 'Library/Hand',
        children: [
          {
            type: 'bitmap',
            id: 'hand-bmp',
            sourceAddress: 'Library/Hand/hand-bmp',
            drawOrder: 0,
            localTransform: BASE_MATRIX,
            bitmapRef: 'Library/hand.png',
            assetId: IDS.assetChar,
          },
        ],
      },
    },
    frames: [
      {
        ordinal: 0,
        layers: [
          {
            name: 'Body',
            nodes: [
              {
                type: 'bitmap',
                id: 'arm-bmp',
                sourceAddress: 'Hero/Layer1/arm',
                drawOrder: 0,
                localTransform: BASE_MATRIX,
                bitmapRef: 'Library/arm.png',
                assetId: IDS.assetChar,
              },
              {
                type: 'opaque',
                id: 'opaque-txt',
                sourceAddress: 'Hero/Layer1/text',
                drawOrder: 1,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                opaqueKind: 'text',
              },
              {
                type: 'symbol',
                id: 'sym-loop',
                sourceAddress: 'Hero/Layer1/sym-loop',
                drawOrder: 2,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: -40, ty: 0 },
                symbolRef: 'Library/Hand',
                nestedDefinitionId: NESTED_DEF_ID,
                playbackMode: 'loop',
              },
              {
                type: 'symbol',
                id: 'sym-single',
                sourceAddress: 'Hero/Layer1/sym-single',
                drawOrder: 3,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 40, ty: 0 },
                symbolRef: 'Library/Hand',
                nestedDefinitionId: NESTED_DEF_ID,
                playbackMode: 'single-frame',
                firstFrame: '0',
              },
            ],
          },
        ],
      },
    ],
  });
}

function e6Project(): {
  project: Project;
  shotId: string;
  layerAId: string;
  layerBId: string;
  service: LayerService;
} {
  const base = buildProjectWithAnimation();
  const animation = base.animations[0]!;
  const frameAsset = {
    id: FLA_FRAME_ASSET_ID,
    kind: 'image' as const,
    name: 'Graphic frame',
    relativePath: 'assets/graphic-frame.svg',
    mimeType: 'image/svg+xml',
    sha256: 'e'.repeat(64),
    width: 640,
    height: 640,
    usage: 'uncategorized' as const,
    keywords: [],
    flaGraphicFrame: { definitionId: animation.id, ordinal: 0 },
  };
  const flaGraphic: FlaGraphicDefinition = {
    ...animation,
    kind: 'fla-graphic',
    durationMs: 40,
    source: {
      ...animation.source,
      endFrameIndex: animation.source.startFrameIndex,
    },
    frames: [
      {
        ...animation.frames[0]!,
        ordinal: 0,
        assetId: frameAsset.id,
        sha256: frameAsset.sha256,
        createdBySequenceImport: false,
      },
    ],
    structure: e6Structure(),
  };

  let project = ProjectSchema.parse({
    ...base,
    assets: [...base.assets, frameAsset],
    animations: [flaGraphic],
  });
  const service = new LayerService();
  const shotId = project.shots[0]!.id;
  const createdA = service.createFromAsset(project, shotId, {
    version: 3,
    type: 'animation',
    animationId: flaGraphic.id,
    position: { x: 400, y: 300 },
    startTimeMs: 0,
  });
  project = createdA.project;
  const createdB = service.createFromAsset(project, shotId, {
    version: 3,
    type: 'animation',
    animationId: flaGraphic.id,
    position: { x: 900, y: 300 },
    startTimeMs: 0,
  });
  project = createdB.project;
  return {
    project,
    shotId,
    layerAId: createdA.layer.id,
    layerBId: createdB.layer.id,
    service,
  };
}

function findEvalTransform(
  visual: ReturnType<typeof evaluateFlaGraphicVisual>,
  targetPath: readonly string[],
): AffineMatrix2D | null {
  if (!visual?.layers) return null;
  const visit = (nodes: typeof visual.layers[number]['nodes']): AffineMatrix2D | null => {
    for (const node of nodes) {
      if (
        node.path.length === targetPath.length &&
        node.path.every((part, idx) => part === targetPath[idx])
      ) {
        return node.localTransform;
      }
      const nested = visit(node.children);
      if (nested) return nested;
    }
    return null;
  };
  return visit(visual.layers.flatMap((l) => l.nodes));
}

describe('FLA Graphic Internal Timeline Editing (E6)', () => {
  it('resolves stable cross-frame node identity across drawOrder/index changes and marks uncertain/opaque nodes read-only', () => {
    const multiFrame = FlaGraphicStructureSchema.parse({
      version: 1,
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: 'L1',
              nodes: [
                {
                  type: 'bitmap',
                  id: 'f0-arm',
                  sourceAddress: 'Layer1/arm',
                  drawOrder: 0,
                  localTransform: BASE_MATRIX,
                  bitmapRef: 'arm.png',
                },
                {
                  type: 'bitmap',
                  id: 'f0-no-addr',
                  drawOrder: 1,
                  localTransform: BASE_MATRIX,
                  bitmapRef: 'extra.png',
                },
              ],
            },
          ],
        },
        {
          ordinal: 1,
          layers: [
            {
              name: 'L1',
              nodes: [
                {
                  type: 'bitmap',
                  id: 'f1-other',
                  sourceAddress: 'Layer1/other',
                  drawOrder: 0,
                  localTransform: BASE_MATRIX,
                  bitmapRef: 'other.png',
                },
                {
                  type: 'bitmap',
                  id: 'f1-arm',
                  sourceAddress: 'Layer1/arm',
                  drawOrder: 1,
                  localTransform: BASE_MATRIX,
                  bitmapRef: 'arm.png',
                },
              ],
            },
          ],
        },
        {
          ordinal: 2,
          layers: [
            {
              name: 'L1',
              nodes: [
                {
                  type: 'bitmap',
                  id: 'f2-arm',
                  sourceAddress: 'Layer1/arm',
                  drawOrder: 0,
                  localTransform: BASE_MATRIX,
                  bitmapRef: 'arm.png',
                },
              ],
            },
          ],
        },
      ],
    });

    const id0 = resolveFlaGraphicStableNodeIdentity(
      multiFrame.frames[0]!.layers[0]!.nodes[0]!,
      multiFrame,
      'frame',
      null,
      multiFrame.frames[0]!.layers[0]!.nodes,
    );
    const id1 = resolveFlaGraphicStableNodeIdentity(
      multiFrame.frames[1]!.layers[0]!.nodes[1]!,
      multiFrame,
      'frame',
      null,
      multiFrame.frames[1]!.layers[0]!.nodes,
    );
    const id2 = resolveFlaGraphicStableNodeIdentity(
      multiFrame.frames[2]!.layers[0]!.nodes[0]!,
      multiFrame,
      'frame',
      null,
      multiFrame.frames[2]!.layers[0]!.nodes,
    );
    expect(id0).toBe('addr:Layer1/arm');
    expect(id1).toBe(id0);
    expect(id2).toBe(id0);

    // Multi-frame node without sourceAddress has uncertain identity -> locally read-only (null).
    const uncertainId = resolveFlaGraphicStableNodeIdentity(
      multiFrame.frames[0]!.layers[0]!.nodes[1]!,
      multiFrame,
      'frame',
      null,
      multiFrame.frames[0]!.layers[0]!.nodes,
    );
    expect(uncertainId).toBeNull();
  });

  it('adds keyframes without visual jump, interpolates decomposed translation/rotation/scale (no raw affine mixing), and seeks deterministically', () => {
    const { project: initial, shotId, layerAId, service } = e6Project();
    const def0 = initial.animations[0] as FlaGraphicDefinition;
    const beforeAdd = findEvalTransform(
      evaluateFlaGraphicVisual({ definition: def0, frameOrdinal: 0, mode: 'definition', internalTimeMs: 0 }),
      ['arm-bmp'],
    );

    // Add first keyframe at 0ms -> zero visual jump.
    let project = service.addFlaGraphicTimelineKeyframe(
      initial,
      shotId,
      layerAId,
      0,
      ['arm-bmp'],
      0,
      'linear',
    );
    const afterFirstAdd = findEvalTransform(
      evaluateFlaGraphicVisual({
        definition: project.animations[0] as FlaGraphicDefinition,
        frameOrdinal: 0,
        mode: 'definition',
        internalTimeMs: 0,
      }),
      ['arm-bmp'],
    );
    expect(afterFirstAdd?.tx).toBeCloseTo(beforeAdd!.tx, 6);
    expect(afterFirstAdd?.ty).toBeCloseTo(beforeAdd!.ty, 6);

    // Add second keyframe at 1000ms and set 90-degree rotation + translation + scale.
    project = service.addFlaGraphicTimelineKeyframe(
      project,
      shotId,
      layerAId,
      0,
      ['arm-bmp'],
      1_000,
      'linear',
    );
    const rotated90 = composeAffineMatrix({
      tx: 110,
      ty: 220,
      rotationDeg: 90,
      scaleX: 1,
      scaleY: 1,
    });
    project = service.updateFlaGraphicTimelineKeyframeTransform(
      project,
      shotId,
      layerAId,
      0,
      ['arm-bmp'],
      1_000,
      rotated90,
    );

    const def = project.animations[0] as FlaGraphicDefinition;
    const midLinear = findEvalTransform(
      evaluateFlaGraphicVisual({ definition: def, frameOrdinal: 0, mode: 'definition', internalTimeMs: 500 }),
      ['arm-bmp'],
    )!;
    const decomposedMid = decomposeAffineMatrix(midLinear);
    expect(decomposedMid.tx).toBeCloseTo(60, 5);
    expect(decomposedMid.ty).toBeCloseTo(120, 5);
    expect(decomposedMid.rotationDeg).toBeCloseTo(45, 5);
    // Crucial: decomposed rotation preserves scale=1.0 instead of shrinking to ~0.707!
    expect(decomposedMid.scaleX).toBeCloseTo(1, 5);
    expect(decomposedMid.scaleY).toBeCloseTo(1, 5);

    // Ease vs Hold + deterministic backward/random seek.
    const withEase = service.setFlaGraphicTimelineKeyframeEasing(
      project,
      shotId,
      layerAId,
      0,
      ['arm-bmp'],
      0,
      'ease',
    );
    const defEase = withEase.animations[0] as FlaGraphicDefinition;
    const q1Forward = decomposeAffineMatrix(
      findEvalTransform(
        evaluateFlaGraphicVisual({ definition: defEase, frameOrdinal: 0, mode: 'definition', internalTimeMs: 250 }),
        ['arm-bmp'],
      )!,
    );
    expect(q1Forward.tx).toBeCloseTo(10 + 100 * (2 * 0.25 * 0.25), 5);
    // Seek 1000 -> 250 -> exact same result.
    evaluateFlaGraphicVisual({ definition: defEase, frameOrdinal: 0, mode: 'definition', internalTimeMs: 1_000 });
    const q1Backward = decomposeAffineMatrix(
      findEvalTransform(
        evaluateFlaGraphicVisual({ definition: defEase, frameOrdinal: 0, mode: 'definition', internalTimeMs: 250 }),
        ['arm-bmp'],
      )!,
    );
    expect(q1Backward).toEqual(q1Forward);

    const withHold = service.setFlaGraphicTimelineKeyframeEasing(
      withEase,
      shotId,
      layerAId,
      0,
      ['arm-bmp'],
      0,
      'hold',
    );
    const defHold = withHold.animations[0] as FlaGraphicDefinition;
    const heldAt999 = decomposeAffineMatrix(
      findEvalTransform(
        evaluateFlaGraphicVisual({ definition: defHold, frameOrdinal: 0, mode: 'definition', internalTimeMs: 999 }),
        ['arm-bmp'],
      )!,
    );
    expect(heldAt999.tx).toBeCloseTo(10, 5);
    const switchedAt1000 = decomposeAffineMatrix(
      findEvalTransform(
        evaluateFlaGraphicVisual({ definition: defHold, frameOrdinal: 0, mode: 'definition', internalTimeMs: 1_000 }),
        ['arm-bmp'],
      )!,
    );
    expect(switchedAt1000.tx).toBeCloseTo(110, 5);
  });

  it('enforces History, Undo/Redo, Save/Reload, collision rejection, opaque guard, and Instance Override priority', () => {
    const { project: initial, shotId, layerAId, layerBId, service } = e6Project();
    const withOverride = service.updateFlaGraphicInstanceTransform(
      initial,
      shotId,
      layerBId,
      0,
      ['arm-bmp'],
      OVERRIDE_MATRIX,
    );
    const editor = new EditorProjectStore();
    editor.open('D:\\PandaStage-Acceptance\\e6-timeline.pandastage', withOverride);
    const layerStore = new LayerStore(
      editor,
      { getCurrentShotId: () => shotId },
      service,
    );

    // Seek does not create History.
    timelineUiStore.setFlaGraphicInternalContext({
      layerId: layerAId,
      animationId: withOverride.animations[0]!.id,
      frameOrdinal: 0,
      selectedNodePath: ['arm-bmp'],
      fps: 24,
    });
    timelineUiStore.seekFlaGraphicInternalTime(500);
    expect(editor.history.getSnapshot().undoCount).toBe(0);

    // Opaque node refuses timeline keyframe authoring (0 History).
    layerStore.addFlaGraphicTimelineKeyframe(layerAId, 0, ['opaque-txt'], 0, 'linear');
    expect(editor.history.getSnapshot().undoCount).toBe(0);

    // Formal add -> 1 History entry; duplicate time collision throws explicitly.
    layerStore.addFlaGraphicTimelineKeyframe(layerAId, 0, ['arm-bmp'], 0, 'linear');
    expect(editor.history.getSnapshot().undoCount).toBe(1);
    expect(() =>
      layerStore.addFlaGraphicTimelineKeyframe(layerAId, 0, ['arm-bmp'], 0, 'linear'),
    ).toThrow();

    layerStore.addFlaGraphicTimelineKeyframe(layerAId, 0, ['arm-bmp'], 1_000, 'linear');
    layerStore.updateFlaGraphicTimelineKeyframeTransform(
      layerAId,
      0,
      ['arm-bmp'],
      1_000,
      composeAffineMatrix({ tx: 210, ty: 20, rotationDeg: 0, scaleX: 1, scaleY: 1 }),
    );
    expect(editor.history.getSnapshot().undoCount).toBe(3);

    // Instance Override > Shared Timeline Result on layerB, while layerA follows timeline.
    const saved = editor.getSnapshot()!.project;
    const reloaded = ProjectSchema.parse(JSON.parse(JSON.stringify(saved)));
    const reloadedDef = reloaded.animations[0] as FlaGraphicDefinition;
    const layerBOverrides = reloaded.shots[0]!.layers.find((l) => l.id === layerBId)!
      .flaGraphicInstanceTransformOverrides;
    expect(
      findEvalTransform(
        evaluateFlaGraphicVisual({
          definition: reloadedDef,
          frameOrdinal: 0,
          mode: 'instance',
          internalTimeMs: 500,
        }),
        ['arm-bmp'],
      )!.tx,
    ).toBeCloseTo(110, 5);
    expect(
      findEvalTransform(
        evaluateFlaGraphicVisual({
          definition: reloadedDef,
          frameOrdinal: 0,
          mode: 'instance',
          instanceTransformOverrides: layerBOverrides,
          internalTimeMs: 500,
        }),
        ['arm-bmp'],
      ),
    ).toEqual(OVERRIDE_MATRIX);

    // Undo / Redo restores/re-applies.
    expect(editor.undo()).toBe(true);
    expect(
      findEvalTransform(
        evaluateFlaGraphicVisual({
          definition: editor.getSnapshot()!.project.animations[0] as FlaGraphicDefinition,
          frameOrdinal: 0,
          mode: 'definition',
          internalTimeMs: 1_000,
        }),
        ['arm-bmp'],
      )!.tx,
    ).toBeCloseTo(10, 5);
    expect(editor.redo()).toBe(true);
    expect(
      findEvalTransform(
        evaluateFlaGraphicVisual({
          definition: editor.getSnapshot()!.project.animations[0] as FlaGraphicDefinition,
          frameOrdinal: 0,
          mode: 'definition',
          internalTimeMs: 1_000,
        }),
        ['arm-bmp'],
      )!.tx,
    ).toBeCloseTo(210, 5);

    // Invalid unsorted/duplicate keyframe data is explicitly rejected by schema.
    expect(() =>
      FlaGraphicStructureSchema.parse({
        ...reloadedDef.structure,
        timeline: {
          tracks: [
            {
              trackId: 'addr:Hero/Layer1/arm',
              keyframes: [
                { timeMs: 500, transform: decomposeAffineMatrix(BASE_MATRIX), easing: 'linear' },
                { timeMs: 500, transform: decomposeAffineMatrix(BASE_MATRIX), easing: 'linear' },
              ],
            },
          ],
        },
      }),
    ).toThrow();
    timelineUiStore.setFlaGraphicInternalContext(null);
  });

  it('stores nested Symbol timeline once, respects loop vs single-frame playback, and keeps Stage/Export/SharedEdit runtime parity', () => {
    const { project: initial, shotId, layerAId, service } = e6Project();
    let project = service.addFlaGraphicTimelineKeyframe(
      initial,
      shotId,
      layerAId,
      0,
      ['sym-loop', 'hand-bmp'],
      0,
      'linear',
    );
    project = service.addFlaGraphicTimelineKeyframe(
      project,
      shotId,
      layerAId,
      0,
      ['sym-loop', 'hand-bmp'],
      1_000,
      'linear',
    );
    project = service.updateFlaGraphicTimelineKeyframeTransform(
      project,
      shotId,
      layerAId,
      0,
      ['sym-loop', 'hand-bmp'],
      1_000,
      composeAffineMatrix({ tx: 110, ty: 20, rotationDeg: 0, scaleX: 1, scaleY: 1 }),
    );

    const def = project.animations[0] as FlaGraphicDefinition;
    // Stored once in symbolDefinitions[NESTED_DEF_ID].timeline.
    expect(def.structure?.symbolDefinitions?.[NESTED_DEF_ID]?.timeline?.tracks).toHaveLength(1);

    // At 1500ms: sym-loop (loop over 1000ms -> 500ms -> tx=60), sym-single (single-frame 0 -> tx=10).
    const eval1500 = evaluateFlaGraphicVisual({
      definition: def,
      frameOrdinal: 0,
      mode: 'definition',
      internalTimeMs: 1_500,
    });
    expect(findEvalTransform(eval1500, ['sym-loop', 'hand-bmp'])!.tx).toBeCloseTo(60, 5);
    expect(findEvalTransform(eval1500, ['sym-single', 'hand-bmp'])!.tx).toBeCloseTo(10, 5);

    // Runtime parity: evaluateShotAtTime -> resolveLayerVisualParts uses the exact same internalTimeMs.
    const shot = project.shots[0]!;
    const evalShot500 = evaluateShotAtTime(shot, 500, project);
    const layerAEval = evalShot500.layers.find((l) => l.id === layerAId)!;
    expect(layerAEval.animationFrame?.internalTimeMs).toBe(500);
    const parts500 = resolveLayerVisualParts(project, shot, layerAEval);
    expect(parts500.parts.length).toBeGreaterThan(0);

    const sharedProj500 = evaluateFlaGraphicProjectionVisual({
      definition: def,
      frameOrdinal: 0,
      editMode: 'definition',
      internalTimeMs: 500,
      draftMatrices: {},
    });
    expect(findEvalTransform(sharedProj500, ['sym-loop', 'hand-bmp'])!.tx).toBeCloseTo(60, 5);

    // Timeline UI renders incremental 元件内部 controls and read-only indicator for opaque node.
    const editableMarkup = renderToStaticMarkup(
      createElement(FlaGraphicInternalTimelineBar, {
        context: {
          layerId: layerAId,
          animationId: def.id,
          frameOrdinal: 0,
          selectedNodePath: ['sym-loop', 'hand-bmp'],
          internalTimeMs: 500,
          fps: 24,
        },
        project,
      }),
    );
    expect(editableMarkup).toContain('data-testid="fla-internal-timeline-bar"');
    expect(editableMarkup).toContain('data-testid="fla-internal-add-key"');
    expect(editableMarkup).toContain('data-testid="fla-internal-easing-select"');

    const opaqueMarkup = renderToStaticMarkup(
      createElement(FlaGraphicInternalTimelineBar, {
        context: {
          layerId: layerAId,
          animationId: def.id,
          frameOrdinal: 0,
          selectedNodePath: ['opaque-txt'],
          internalTimeMs: 500,
          fps: 24,
        },
        project,
      }),
    );
    expect(opaqueMarkup).toContain('data-testid="fla-internal-readonly-node"');
    expect(evaluateFlaGraphicTrackAtTime(
      def.structure!.symbolDefinitions![NESTED_DEF_ID]!.timeline!.tracks[0]!,
      500,
    )!.tx).toBeCloseTo(60, 5);
  });
});
