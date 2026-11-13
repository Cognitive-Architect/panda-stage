import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  FlaGraphicStructureSchema,
  LayerService,
  PROJECT_FPS,
  ProjectSchema,
  composeAffineMatrix,
  evaluateFlaGraphicVisual,
  isAffineMatrixTrsSafe,
  resolveFlaGraphicInternalAuthoringState,
  resolveFlaGraphicTimelineTarget,
  type EvaluatedFlaGraphicVisual,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { evaluateFlaGraphicDefinitionPreviewVisual } from '../../src/renderer/features/assets/AnimationLibraryPanel';
import { evaluateFlaGraphicProjectionVisual } from '../../src/renderer/features/canvas/FlaGraphicStructureProjection';
import { FlaGraphicInternalTimelineBar } from '../../src/renderer/features/timeline/FlaGraphicInternalTimelineBar';
import {
  integerFrameSpanMs,
  snapToFrame,
  TIMELINE_FPS,
} from '../../src/renderer/features/timeline/timeGeometry';
import { buildProjectWithAnimation, IDS } from './domain/testProject';
import { adaptFlaXflDisplaySource } from '../../src/main/services/fla-static-snapshot-display-list-adapter';
import { prepareFlaNestedGraphicFrameSelections } from '../../src/main/services/fla-nested-graphic-frame-selector';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { captureFlaGraphicStructure } from '../../src/main/services/flaGraphicStructureCapture';

const FLA_FRAME_ASSET_ID = '10000000-0000-4000-8000-000000000004';
const NESTED_DEF_ID = 'symdef_e6_fix_arm';

// Source content visibly identifies its selected child frame; the authored
// property track ends much earlier than the 20-frame (1000ms) source timeline.
function nestedSourceClockFixture(
  firstFrame: number,
  playbackMode = 'loop',
  sourceStartFrame = 0,
  propertyEndMs = 200,
  lastFrame?: number,
) {
  const timeline = (frames: string) => `<DOMTimeline name="clock"><layers><DOMLayer name="content"><frames>${frames}</frames></DOMLayer></layers></DOMTimeline>`;
  const graphic = (name: string, frames: string) => ({
    name: `LIBRARY/${name}.xml`,
    xml: `<DOMSymbolItem name="${name}" symbolType="graphic"><timeline>${timeline(frames)}</timeline></DOMSymbolItem>`,
  });
  const adapted = adaptFlaXflDisplaySource('<DOMDocument width="100" height="100"/>', [
    graphic('parent', `<DOMFrame index="${sourceStartFrame}" duration="40"><elements><DOMSymbolInstance libraryItemName="child" symbolType="graphic" loop="${playbackMode}" firstFrame="${firstFrame}"${lastFrame !== undefined ? ` lastFrame="${lastFrame}"` : ''}/></elements></DOMFrame>`),
    graphic('child', Array.from({ length: 20 }, (_, index) =>
      `<DOMFrame index="${index}" duration="1"><elements><DOMBitmapInstance libraryItemName="source-frame-${index}.png"/></elements></DOMFrame>`,
    ).join('')),
  ]);
  if (!adapted.ok) throw new Error(adapted.message);
  const source = adapted.source;
  const parent = source.graphicSymbols.find((item) => item.sourceLibraryItemName === 'parent')!;
  const base = createStructuredGraphicFixture({ sourceFps: 20 }).definition;
  return (parentFrameIndex: number, subFrameMs = 0) => {
    const root = source.buildGraphicFrameContext(parent.timelineXml, parent.frameSpanIndex, sourceStartFrame + parentFrameIndex, 'clock-parent');
    if (!root.ok) throw new Error(root.message);
    const selected = prepareFlaNestedGraphicFrameSelections(source, {
      kind: 'graphic', name: 'parent', frameContext: root.value,
    });
    if (!selected.ok) throw new Error(selected.message);
    const resolved = resolveFlaDisplayList(selected.resolverInput);
    if (!resolved.ok) throw new Error(resolved.message);
    const structure = captureFlaGraphicStructure(resolved.displayList)!;
    const symbol = structure.frames[0]!.layers[0]!.nodes[0]!;
    if (symbol.type !== 'symbol') throw new Error('Expected nested Graphic');
    const nested = structure.symbolDefinitions![symbol.nestedDefinitionId!]!;
    expect(nested.sourceFrameCount).toBe(20);
    expect(symbol.sourceParentFrameSpanStart).toBe(sourceStartFrame);
    const child = nested.children[0]!;
    nested.timeline = {
      tracks: [{
        trackId: `addr:${child.sourceAddress}`,
        keyframes: [0, propertyEndMs].map((timeMs) => ({
          timeMs,
          transform: { tx: timeMs, ty: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 },
          easing: 'linear' as const,
        })),
      }],
    };
    structure.frames[0]!.ordinal = parentFrameIndex;
    const definition: FlaGraphicDefinition = {
      ...base,
      source: { ...base.source, startFrameIndex: sourceStartFrame },
      frames: [{ ...base.frames[0]!, ordinal: parentFrameIndex }],
      structure,
    };
    const visual = evaluateFlaGraphicVisual({
      definition, frameOrdinal: parentFrameIndex, mode: 'definition',
      internalTimeMs: parentFrameIndex * 50 + subFrameMs,
    });
    return {
      selection: selected.selections[0]!,
      child: visual!.layers![0]!.nodes[0]!.children[0]!,
      definition,
    };
  };
}

describe('Issue #1090 nested Graphic source clock', () => {
  it.each([0, 3])('keeps 20-frame source playback and 200ms property keys in sync (firstFrame=%i)', (firstFrame) => {
    const sample = nestedSourceClockFixture(firstFrame);
    for (const parentFrame of [0, 1, 4, 5, 16, 17, 19, 20, 21]) {
      const { selection, child } = sample(parentFrame);
      const localFrame = (firstFrame + parentFrame) % 20;
      expect(selection.selectedChildFrameIndex).toBe(localFrame);
      expect(child.source).toMatchObject({ type: 'bitmap', bitmapRef: `source-frame-${localFrame}.png` });
      expect(child.localTransform.tx, `parent=${parentFrame}, source local frame=${localFrame}`).toBeCloseTo(Math.min(localFrame * 50, 200), 6);
    }
  });

  it.each(['play once', 'single frame'])('preserves source %s playback with non-zero firstFrame', (mode) => {
    const sample = nestedSourceClockFixture(3, mode);
    for (const parentFrame of [0, 1, 5, 16, 17, 20, 25]) {
      const { selection, child } = sample(parentFrame);
      const localFrame = mode === 'single frame' ? 3 : Math.min(3 + parentFrame, 19);
      expect(selection.selectedChildFrameIndex).toBe(localFrame);
      expect(child.source).toMatchObject({ bitmapRef: `source-frame-${localFrame}.png` });
      expect(child.localTransform.tx).toBeCloseTo(Math.min(localFrame * 50, 200), 6);
    }
  });

  it('preserves continuous tween interpolation and a non-zero parent source origin', () => {
    const sample = nestedSourceClockFixture(0, 'loop', 3);
    expect(sample(1, 25).child.localTransform.tx).toBeCloseTo(75, 6);
    expect(sample(5).child.localTransform.tx).toBe(200);
    expect(sample(20, 25).child.localTransform.tx).toBeCloseTo(25, 6);
    // Source clock metadata survives the strict persisted structure schema.
    const structure = sample(0).definition.structure!;
    expect(FlaGraphicStructureSchema.parse(JSON.parse(JSON.stringify(structure)))).toEqual(structure);
  });

  it('holds play-once at the source terminal frame while loop keeps its sub-frame phase', () => {
    const once = nestedSourceClockFixture(3, 'play once', 0, 1000);
    const loop = nestedSourceClockFixture(3, 'loop', 0, 1000);
    expect(once(16, 25).child.localTransform.tx).toBeCloseTo(950, 6);
    expect(once(25, 25).child.localTransform.tx).toBeCloseTo(950, 6);
    expect(loop(16, 25).child.localTransform.tx).toBeCloseTo(975, 6);
    expect(loop(17, 25).child.localTransform.tx).toBeCloseTo(25, 6);
  });

  it('does not invent a loop duration from property keys for legacy structures without source span', () => {
    const { definition } = nestedSourceClockFixture(0)(5);
    const legacy = structuredClone(definition);
    for (const nested of Object.values(legacy.structure!.symbolDefinitions!)) {
      delete nested.sourceFrameCount;
    }
    const visual = evaluateFlaGraphicVisual({
      definition: legacy, frameOrdinal: 5, mode: 'definition', internalTimeMs: 250,
    });
    expect(visual!.layers![0]!.nodes[0]!.children[0]!.localTransform.tx).toBe(200);
  });
});

describe('Issue #1091 bounded Graphic sub-frame wrap', () => {
  it.each([
    { mode: 'loop', lastFrame: 5, frames: [3, 4, 5], adjacentPoses: [175, 225] },
    { mode: 'loop reverse', lastFrame: 1, frames: [3, 2, 1], adjacentPoses: [125, 75] },
  ])('holds the bounded $mode wrap while preserving natural adjacent tween', ({ mode, lastFrame, frames, adjacentPoses }) => {
    const sample = nestedSourceClockFixture(3, mode, 0, 1000, lastFrame);
    for (const parentFrame of [0, 1]) {
      const { selection, child } = sample(parentFrame, 25);
      expect(selection.selectedChildFrameIndex).toBe(frames[parentFrame]);
      expect(child.source).toMatchObject({ bitmapRef: `source-frame-${frames[parentFrame]}.png` });
      expect(child.localTransform.tx).toBeCloseTo(adjacentPoses[parentFrame]!, 6);
    }
    for (const parentFrame of [2, 5]) {
      for (const phaseMs of [0, 25, 49]) {
        const { selection, child } = sample(parentFrame, phaseMs);
        expect(selection.selectedChildFrameIndex).toBe(lastFrame);
        expect(child.source).toMatchObject({ bitmapRef: `source-frame-${lastFrame}.png` });
        expect(child.localTransform.tx, `${mode}: terminal frame at phase ${phaseMs}ms`).toBeCloseTo(lastFrame * 50, 6);
      }
      // Only the actual source-frame boundary switches to the first pose.
      const { selection, child } = sample(parentFrame + 1);
      expect(selection.selectedChildFrameIndex).toBe(3);
      expect(child.source).toMatchObject({ bitmapRef: 'source-frame-3.png' });
      expect(child.localTransform.tx).toBeCloseTo(150, 6);
    }
  });

  it('preserves unbounded reverse sub-frame tween across the source boundary', () => {
    const sample = nestedSourceClockFixture(3, 'loop reverse', 0, 1000);
    expect(sample(0, 25).child.localTransform.tx).toBeCloseTo(125, 6);
    const { selection, child } = sample(3, 25);
    expect(selection.selectedChildFrameIndex).toBe(0);
    expect(child.source).toMatchObject({ bitmapRef: 'source-frame-0.png' });
    expect(child.localTransform.tx).toBeCloseTo(975, 6);
    expect(sample(4, 25).child.localTransform.tx).toBeCloseTo(925, 6);
  });
});

function findEvaluatedTransform(
  visual: EvaluatedFlaGraphicVisual | null,
  targetPath: readonly string[],
): AffineMatrix2D | null {
  if (!visual?.layers) return null;
  const visit = (
    nodes: typeof visual.layers[number]['nodes'],
  ): AffineMatrix2D | null => {
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
  for (const layer of visual.layers) {
    const found = visit(layer.nodes);
    if (found) return found;
  }
  return null;
}

function createStructuredGraphicFixture(options?: {
  readonly sourceFps?: number;
  readonly childMatrix?: AffineMatrix2D;
  readonly nestedPlaybackMode?: 'loop' | 'play-once' | 'single-frame';
  readonly nestedFirstFrame?: string;
}): {
  project: Project;
  shotId: string;
  layerId: string;
  definition: FlaGraphicDefinition;
  service: LayerService;
} {
  const sourceFps = options?.sourceFps ?? 24;
  const childMatrix = options?.childMatrix ?? {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: 20,
    ty: 30,
  };
  const nestedMode = options?.nestedPlaybackMode ?? 'loop';
  const nestedFirstFrame = options?.nestedFirstFrame ?? '0';

  const base = buildProjectWithAnimation();
  const baseAnim = base.animations[0]!;
  const structure = FlaGraphicStructureSchema.parse({
    version: 1,
    symbolDefinitions: {
      [NESTED_DEF_ID]: {
        symbolRef: 'Library/Arm',
        children: [
          {
            type: 'bitmap',
            id: 'arm-bmp',
            sourceAddress: 'Library/Arm/arm-bmp',
            drawOrder: 0,
            localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 10 },
            bitmapRef: 'Library/arm.png',
            assetId: IDS.assetChar,
          },
        ],
        timeline: {
          tracks: [
            {
              trackId: 'addr:Library/Arm/arm-bmp',
              keyframes: [
                {
                  timeMs: 0,
                  transform: { tx: 5, ty: 10, rotationDeg: 0, scaleX: 1, scaleY: 1 },
                  easing: 'linear',
                },
                {
                  timeMs: 125,
                  transform: { tx: 125, ty: 10, rotationDeg: 0, scaleX: 1, scaleY: 1 },
                  easing: 'linear',
                },
              ],
            },
          ],
        },
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
                id: 'torso',
                sourceAddress: 'Hero/Body/torso',
                drawOrder: 0,
                localTransform: childMatrix,
                bitmapRef: 'Library/torso.png',
                assetId: IDS.assetChar,
              },
              {
                type: 'symbol',
                id: 'arm-inst',
                sourceAddress: 'Hero/Body/arm-inst',
                drawOrder: 1,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 40, ty: 20 },
                symbolRef: 'Library/Arm',
                nestedDefinitionId: NESTED_DEF_ID,
                playbackMode: nestedMode,
                firstFrame: nestedFirstFrame,
              },
            ],
          },
        ],
      },
    ],
  });

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
    flaGraphicFrame: { definitionId: baseAnim.id, ordinal: 0 },
  };

  const frameDurationMs = 1000 / sourceFps;
  const definition: FlaGraphicDefinition = {
    ...baseAnim,
    kind: 'fla-graphic',
    durationMs: frameDurationMs,
    source: {
      ...baseAnim.source,
      sourceFps,
      endFrameIndex: baseAnim.source.startFrameIndex,
    },
    frames: [
      {
        ...baseAnim.frames[0]!,
        ordinal: 0,
        durationMs: frameDurationMs,
        assetId: frameAsset.id,
        sha256: frameAsset.sha256,
        createdBySequenceImport: false,
      },
    ],
    structure,
  };

  let project = ProjectSchema.parse({
    ...base,
    assets: [...base.assets, frameAsset],
    animations: [definition],
  });
  const service = new LayerService();
  const shotId = project.shots[0]!.id;
  const created = service.createFromAsset(project, shotId, {
    version: 3,
    type: 'animation',
    animationId: definition.id,
    position: { x: 400, y: 300 },
    startTimeMs: 0,
  });
  project = created.project;

  return {
    project,
    shotId,
    layerId: created.layer.id,
    definition,
    service,
  };
}

describe('STRUCT-04-E6-FIX-01 internal timeline fixes & regressions', () => {
  it('enforces no-key read-only in internal timeline authoring, unlocks on Add Keyframe, and preserves plain E5 Shared Edit', () => {
    const { project, shotId, layerId, definition, service } =
      createStructuredGraphicFixture();

    let nextProject = service.addFlaGraphicTimelineKeyframe(
      project,
      shotId,
      layerId,
      0,
      ['torso'],
      0,
      'linear',
    );
    nextProject = service.addFlaGraphicTimelineKeyframe(
      nextProject,
      shotId,
      layerId,
      0,
      ['torso'],
      1000,
      'linear',
    );
    nextProject = service.updateFlaGraphicTimelineKeyframeTransform(
      nextProject,
      shotId,
      layerId,
      0,
      ['torso'],
      1000,
      { a: 1, b: 0, c: 0, d: 1, tx: 120, ty: 30 },
    );

    const animWithTimeline = nextProject.animations[0] as FlaGraphicDefinition;

    // 1. No-key read-only at 500ms when timelineAuthoringActive = true
    const noKeyState = resolveFlaGraphicInternalAuthoringState({
      structure: animWithTimeline.structure,
      frameOrdinal: 0,
      nodePath: ['torso'],
      internalTimeMs: 500,
      timelineAuthoringActive: true,
    });
    expect(noKeyState.canEditTransform).toBe(false);
    expect(noKeyState.canAddKeyframe).toBe(true);
    expect(noKeyState.reason).toBe('no-key-readonly');

    // Projection draft at unkeyed 500ms must NOT fall back to base Definition
    const projectionAtNoKey = evaluateFlaGraphicProjectionVisual({
      definition: animWithTimeline,
      frameOrdinal: 0,
      editMode: 'definition',
      timelineAuthoringActive: true,
      internalTimeMs: 500,
      draftMatrices: {
        [JSON.stringify(['torso'])]: { a: 1, b: 0, c: 0, d: 1, tx: 999, ty: 999 },
      },
    });
    expect(findEvaluatedTransform(projectionAtNoKey, ['torso'])?.tx).toBeCloseTo(70, 5);

    // 2. Add-key unlock at 500ms -> now editable, updates ONLY 500ms keyframe, base pose untouched
    nextProject = service.addFlaGraphicTimelineKeyframe(
      nextProject,
      shotId,
      layerId,
      0,
      ['torso'],
      500,
      'linear',
    );
    const keyedState = resolveFlaGraphicInternalAuthoringState({
      structure: (nextProject.animations[0] as FlaGraphicDefinition).structure,
      frameOrdinal: 0,
      nodePath: ['torso'],
      internalTimeMs: 500,
      timelineAuthoringActive: true,
    });
    expect(keyedState.canEditTransform).toBe(true);
    expect(keyedState.reason).toBe('ok');

    nextProject = service.updateFlaGraphicTimelineKeyframeTransform(
      nextProject,
      shotId,
      layerId,
      0,
      ['torso'],
      500,
      { a: 1, b: 0, c: 0, d: 1, tx: 88, ty: 44 },
    );
    const updatedAnim = nextProject.animations[0] as FlaGraphicDefinition;
    const baseTorso = updatedAnim.structure!.frames[0]!.layers[0]!.nodes[0]!;
    expect(baseTorso.localTransform.tx).toBe(20);

    // 3. Plain Shared Definition Edit (timelineAuthoringActive = false) still edits base pose
    const plainBaseState = resolveFlaGraphicInternalAuthoringState({
      structure: definition.structure,
      frameOrdinal: 0,
      nodePath: ['torso'],
      timelineAuthoringActive: false,
    });
    expect(plainBaseState.canEditTransform).toBe(true);
    const baseEdited = service.updateFlaGraphicSharedDefinitionTransform(
      project,
      shotId,
      layerId,
      0,
      ['torso'],
      { a: 1, b: 0, c: 0, d: 1, tx: 55, ty: 66 },
    );
    const editedAnim = baseEdited.animations[0] as FlaGraphicDefinition;
    expect(editedAnim.structure!.frames[0]!.layers[0]!.nodes[0]!.localTransform.tx).toBe(55);
  });

  it('gates TRS-safe vs shear/skew matrices cleanly without visual jump or Project/History mutation', () => {
    // 1. TRS-safe complex translation + rotation + non-uniform scale
    const trsMatrix = composeAffineMatrix({
      tx: 42.5,
      ty: -18.25,
      rotationDeg: 35,
      scaleX: 1.4,
      scaleY: 0.75,
    });
    expect(isAffineMatrixTrsSafe(trsMatrix)).toBe(true);
    const trsFixture = createStructuredGraphicFixture({ childMatrix: trsMatrix });
    const addedProject = trsFixture.service.addFlaGraphicTimelineKeyframe(
      trsFixture.project,
      trsFixture.shotId,
      trsFixture.layerId,
      0,
      ['torso'],
      0,
      'linear',
    );
    const addedEval = evaluateFlaGraphicVisual({
      definition: addedProject.animations[0] as FlaGraphicDefinition,
      frameOrdinal: 0,
      mode: 'definition',
      internalTimeMs: 0,
    });
    const addedTorso = findEvaluatedTransform(addedEval, ['torso'])!;
    expect(addedTorso.a).toBeCloseTo(trsMatrix.a, 4);
    expect(addedTorso.b).toBeCloseTo(trsMatrix.b, 4);
    expect(addedTorso.c).toBeCloseTo(trsMatrix.c, 4);
    expect(addedTorso.d).toBeCloseTo(trsMatrix.d, 4);
    expect(addedTorso.tx).toBeCloseTo(trsMatrix.tx, 4);
    expect(addedTorso.ty).toBeCloseTo(trsMatrix.ty, 4);

    // 2. Shear / skew matrix -> locally read-only for E6, Add Keyframe rejected, playback intact
    const shearMatrix = { a: 1, b: 0, c: 0.45, d: 1, tx: 12, ty: -8 };
    expect(isAffineMatrixTrsSafe(shearMatrix)).toBe(false);
    const shearFixture = createStructuredGraphicFixture({ childMatrix: shearMatrix });
    const targetInfo = resolveFlaGraphicTimelineTarget(
      shearFixture.definition.structure!,
      0,
      ['torso'],
    );
    expect(targetInfo?.trsSafe).toBe(false);
    expect(targetInfo?.authoringCapability).toBe('readonly-trs-unsafe');

    const editor = new EditorProjectStore();
    editor.open('D:\\PandaStage-Acceptance\\e6-shear.pandastage', shearFixture.project);
    const localLayerStore = new LayerStore(
      editor,
      { getCurrentShotId: () => shearFixture.shotId },
      shearFixture.service,
    );
    expect(() =>
      localLayerStore.addFlaGraphicTimelineKeyframe(
        shearFixture.layerId,
        0,
        ['torso'],
        0,
        'linear',
      ),
    ).toThrow();
    expect(editor.history.getSnapshot().undoCount).toBe(0);

    // Existing runtime playback still renders the exact shear matrix
    const playbackEval = evaluateFlaGraphicVisual({
      definition: shearFixture.definition,
      frameOrdinal: 0,
      mode: 'instance',
      internalTimeMs: 0,
    });
    expect(findEvaluatedTransform(playbackEval, ['torso'])).toEqual(shearMatrix);
  });

  it('drives Definition Preview with E6 internal time matching Stage evaluator for single-frame Graphics', () => {
    const { project, shotId, layerId, service } = createStructuredGraphicFixture({
      sourceFps: 24,
    });
    let nextProject = service.addFlaGraphicTimelineKeyframe(
      project,
      shotId,
      layerId,
      0,
      ['torso'],
      0,
      'linear',
    );
    nextProject = service.addFlaGraphicTimelineKeyframe(
      nextProject,
      shotId,
      layerId,
      0,
      ['torso'],
      1000,
      'linear',
    );
    nextProject = service.updateFlaGraphicTimelineKeyframeTransform(
      nextProject,
      shotId,
      layerId,
      0,
      ['torso'],
      1000,
      { a: 1, b: 0, c: 0, d: 1, tx: 220, ty: 30 },
    );

    const anim = nextProject.animations[0] as FlaGraphicDefinition;
    expect(anim.frames.length).toBe(1);

    const preview0 = evaluateFlaGraphicDefinitionPreviewVisual(anim, 0);
    const preview500 = evaluateFlaGraphicDefinitionPreviewVisual(anim, 12);
    const preview1000 = evaluateFlaGraphicDefinitionPreviewVisual(anim, 24);

    const stage0 = evaluateFlaGraphicVisual({
      definition: anim,
      frameOrdinal: 0,
      mode: 'definition',
      internalTimeMs: 0,
    });
    const stage500 = evaluateFlaGraphicVisual({
      definition: anim,
      frameOrdinal: 0,
      mode: 'definition',
      internalTimeMs: 500,
    });
    const stage1000 = evaluateFlaGraphicVisual({
      definition: anim,
      frameOrdinal: 0,
      mode: 'definition',
      internalTimeMs: 1000,
    });

    expect(findEvaluatedTransform(preview0, ['torso'])?.tx).toBeCloseTo(
      findEvaluatedTransform(stage0, ['torso'])?.tx ?? -1,
      5,
    );
    expect(findEvaluatedTransform(preview500, ['torso'])?.tx).toBeCloseTo(
      findEvaluatedTransform(stage500, ['torso'])?.tx ?? -1,
      5,
    );
    expect(findEvaluatedTransform(preview1000, ['torso'])?.tx).toBeCloseTo(
      findEvaluatedTransform(stage1000, ['torso'])?.tx ?? -1,
      5,
    );
  });

  it('renders Move / Duplicate UI on unified PROJECT_FPS grid and rejects collisions cleanly', () => {
    // sourceFps = 12 != PROJECT_FPS (24) to test unified authoring frame grid
    const { project, shotId, layerId, service } = createStructuredGraphicFixture({
      sourceFps: 12,
    });
    let seeded = service.addFlaGraphicTimelineKeyframe(
      project,
      shotId,
      layerId,
      0,
      ['torso'],
      0,
      'linear',
    );
    seeded = service.addFlaGraphicTimelineKeyframe(
      seeded,
      shotId,
      layerId,
      0,
      ['torso'],
      1000,
      'linear',
    );
    seeded = service.updateFlaGraphicTimelineKeyframeTransform(
      seeded,
      shotId,
      layerId,
      0,
      ['torso'],
      1000,
      { a: 1, b: 0, c: 0, d: 1, tx: 140, ty: 30 },
    );

    const animBefore = seeded.animations[0] as FlaGraphicDefinition;
    const html = renderToStaticMarkup(
      createElement(FlaGraphicInternalTimelineBar, {
        context: {
          layerId,
          animationId: animBefore.id,
          frameOrdinal: 0,
          selectedNodePath: ['torso'],
          internalTimeMs: 0,
          fps: 12,
          timelineAuthoringActive: true,
        },
        project: seeded,
      }),
    );

    const expectedStepMs = integerFrameSpanMs(PROJECT_FPS);
    expect(html).toContain('data-testid="fla-internal-authoring-toggle"');
    expect(html).toContain('data-testid="fla-internal-target-time-input"');
    expect(html).toContain('data-testid="fla-internal-move-key"');
    expect(html).toContain('data-testid="fla-internal-duplicate-key"');
    expect(html).toContain(`step="${expectedStepMs}"`);

    const editor = new EditorProjectStore();
    editor.open('D:\\PandaStage-Acceptance\\e6-ui-grid.pandastage', seeded);
    const localLayerStore = new LayerStore(
      editor,
      { getCurrentShotId: () => shotId },
      service,
    );

    const snapped500 = snapToFrame(505, TIMELINE_FPS);
    expect(snapped500).toBe(500);
    localLayerStore.duplicateFlaGraphicTimelineKeyframe(
      layerId,
      0,
      ['torso'],
      0,
      snapped500,
    );
    let anim = editor.getSnapshot()!.project.animations[0] as FlaGraphicDefinition;
    let track = anim.structure!.timeline!.tracks.find((t) => t.trackId === 'addr:Hero/Body/torso')!;
    expect(track.keyframes.map((k) => k.timeMs)).toEqual([0, 500, 1000]);
    expect(editor.history.getSnapshot().undoCount).toBe(1);

    const snapped250 = snapToFrame(255, TIMELINE_FPS);
    expect(snapped250).toBe(250);
    localLayerStore.moveFlaGraphicTimelineKeyframe(
      layerId,
      0,
      ['torso'],
      0,
      snapped250,
    );
    anim = editor.getSnapshot()!.project.animations[0] as FlaGraphicDefinition;
    track = anim.structure!.timeline!.tracks.find((t) => t.trackId === 'addr:Hero/Body/torso')!;
    expect(track.keyframes.map((k) => k.timeMs)).toEqual([250, 500, 1000]);
    expect(editor.history.getSnapshot().undoCount).toBe(2);

    // Collision rejection
    expect(() =>
      localLayerStore.moveFlaGraphicTimelineKeyframe(layerId, 0, ['torso'], 250, 500),
    ).toThrow(/500ms/);
    expect(() =>
      localLayerStore.duplicateFlaGraphicTimelineKeyframe(layerId, 0, ['torso'], 250, 500),
    ).toThrow(/500ms/);
  });

  it('verifies nested playback with non-zero firstFrame across loop, single-frame, and play-once modes plus instance override priority', () => {
    const loopFixture = createStructuredGraphicFixture({
      nestedPlaybackMode: 'loop',
      nestedFirstFrame: '1',
    });
    const loopAt0 = evaluateFlaGraphicVisual({
      definition: loopFixture.definition,
      frameOrdinal: 0,
      mode: 'instance',
      internalTimeMs: 0,
    });
    const loopTx0 = findEvaluatedTransform(loopAt0, ['arm-inst', 'arm-bmp'])?.tx ?? 0;
    expect(loopTx0).toBeGreaterThan(40);
    expect(loopTx0).toBeLessThan(50);

    const singleFixture = createStructuredGraphicFixture({
      nestedPlaybackMode: 'single-frame',
      nestedFirstFrame: '2',
    });
    const singleAt0 = evaluateFlaGraphicVisual({
      definition: singleFixture.definition,
      frameOrdinal: 0,
      mode: 'instance',
      internalTimeMs: 0,
    });
    const singleAt500 = evaluateFlaGraphicVisual({
      definition: singleFixture.definition,
      frameOrdinal: 0,
      mode: 'instance',
      internalTimeMs: 500,
    });
    const singleTx0 = findEvaluatedTransform(singleAt0, ['arm-inst', 'arm-bmp'])?.tx ?? 0;
    const singleTx500 = findEvaluatedTransform(singleAt500, ['arm-inst', 'arm-bmp'])?.tx ?? 0;
    expect(singleTx0).toBeCloseTo(singleTx500, 5);
    expect(singleTx0).toBeGreaterThan(80);

    const playOnceFixture = createStructuredGraphicFixture({
      nestedPlaybackMode: 'play-once',
      nestedFirstFrame: '1',
    });
    const playOncePostEnd = evaluateFlaGraphicVisual({
      definition: playOnceFixture.definition,
      frameOrdinal: 0,
      mode: 'instance',
      internalTimeMs: 500,
    });
    const playOnceTx = findEvaluatedTransform(playOncePostEnd, ['arm-inst', 'arm-bmp'])?.tx;
    expect(playOnceTx).toBeCloseTo(125, 5);

    // Instance Override priority remains higher than Shared Timeline result
    const overrideEval = evaluateFlaGraphicVisual({
      definition: loopFixture.definition,
      frameOrdinal: 0,
      mode: 'instance',
      internalTimeMs: 0,
      instanceTransformOverrides: {
        '0': {
          [JSON.stringify(['arm-inst', 'arm-bmp'])]: {
            a: 1,
            b: 0,
            c: 0,
            d: 1,
            tx: 333,
            ty: 10,
          },
        },
      },
    });
    expect(findEvaluatedTransform(overrideEval, ['arm-inst', 'arm-bmp'])?.tx).toBe(333);
  });
});
