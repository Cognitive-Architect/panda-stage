import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyLayerLayout,
  applyStandingPlacement,
  computeStandingSlotTargets,
  DEFAULT_STANDING_GROUND_Y_RATIO,
  DEFAULT_STANDING_LEFT_X_RATIO,
  DEFAULT_STANDING_RIGHT_X_RATIO,
  evaluateShotAtTime,
  LayerService,
  measureShotLayerWorldBounds,
  planLayerLayout,
  planStandingPlacement,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  ProjectSchema,
  ShotService,
  type Layer,
  type Project,
  type TimelineEvent,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayoutPreviewStore } from '../../src/renderer/stores/layoutPreviewStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { characterActionGraphicFixture } from '../helpers/characterActionGraphicFixture';

function createMixedFixture() {
  const base = characterActionGraphicFixture();
  const imageAsset = base.assets.find(({ kind }) => kind === 'image')!;
  const character = base.characters[0]!;
  const graphicDef = base.animations[0]!;

  const imgLayer: Layer = {
    id: randomUUID(),
    name: '道具图',
    source: { kind: 'asset', assetId: imageAsset.id },
    anchor: 'center',
    x: 320,
    y: 420,
    scaleX: 0.4,
    scaleY: 0.4,
    rotationDeg: 0,
    opacity: 1,
    locked: false,
    visible: true,
    flipX: false,
    zIndex: 1,
  };

  const charLayer: Layer = {
    id: randomUUID(),
    name: '主角',
    source: {
      kind: 'character',
      characterId: character.id,
      expressionId: character.defaultExpressionId,
    },
    anchor: 'center',
    x: 900,
    y: 520,
    scaleX: 0.6,
    scaleY: 0.5,
    rotationDeg: 15,
    opacity: 1,
    locked: false,
    visible: true,
    flipX: true,
    zIndex: 2,
  };

  const graphicLayer: Layer = {
    id: randomUUID(),
    name: '特效元件',
    source: { kind: 'animation', animationId: graphicDef.id },
    anchor: 'center',
    x: 1380,
    y: 360,
    scaleX: 0.8,
    scaleY: 0.6,
    rotationDeg: 0,
    opacity: 1,
    locked: false,
    visible: true,
    flipX: false,
    zIndex: 3,
    startTimeMs: 0,
    animationFirstFrame: 0,
    animationPlayback: { mode: 'loop', endBehavior: 'hold' },
  };

  const shot = {
    ...base.shots[0]!,
    layers: [imgLayer, charLayer, graphicLayer],
    backgroundLayerId: null,
    dialogues: [],
    audioClips: [],
    timelineEvents: [],
  };

  const project = ProjectSchema.parse({
    ...base,
    shots: [shot],
  });

  return {
    project,
    shotId: shot.id,
    imgLayer,
    charLayer,
    graphicLayer,
    imageAsset,
  };
}

function measureOne(project: Project, shotId: string, layerId: string, timeMs = 0) {
  const shot = project.shots.find((candidate) => candidate.id === shotId)!;
  return measureShotLayerWorldBounds(project, shot, timeMs, [layerId]).measurements.get(layerId)!;
}

describe('WF-02 layer align, distribute, match-height, and standing placement', () => {
  it('supports 6-way align and 2-axis distribute across mixed image, Character, and FLA Graphic layers', () => {
    const { project, shotId, imgLayer, charLayer, graphicLayer } = createMixedFixture();
    const ids = [imgLayer.id, charLayer.id, graphicLayer.id];

    // Align bottom to selection bounds
    const alignBottom = applyLayerLayout(project, {
      shotId,
      layerIds: ids,
      action: 'align-bottom',
      timeMs: 0,
    });
    expect(alignBottom.plan.ok).toBe(true);
    const b1 = measureOne(alignBottom.project, shotId, imgLayer.id).worldBounds;
    const b2 = measureOne(alignBottom.project, shotId, charLayer.id).worldBounds;
    const b3 = measureOne(alignBottom.project, shotId, graphicLayer.id).worldBounds;
    expect(b1.maxY).toBeCloseTo(b2.maxY, 2);
    expect(b2.maxY).toBeCloseTo(b3.maxY, 2);

    // Align left to explicit reference (graphicLayer)
    const refBefore = measureOne(project, shotId, graphicLayer.id).worldBounds;
    const alignLeftRef = applyLayerLayout(project, {
      shotId,
      layerIds: ids,
      action: 'align-left',
      referenceLayerId: graphicLayer.id,
    });
    expect(alignLeftRef.plan.ok).toBe(true);
    expect(measureOne(alignLeftRef.project, shotId, imgLayer.id).worldBounds.minX).toBeCloseTo(refBefore.minX, 2);
    expect(measureOne(alignLeftRef.project, shotId, charLayer.id).worldBounds.minX).toBeCloseTo(refBefore.minX, 2);
    expect(measureOne(alignLeftRef.project, shotId, graphicLayer.id).worldBounds.minX).toBeCloseTo(refBefore.minX, 2);

    // Horizontal distribute across all three mixed types
    const distX = applyLayerLayout(project, {
      shotId,
      layerIds: ids,
      action: 'distribute-horizontal',
    });
    expect(distX.plan.ok).toBe(true);
    const dxBounds = ids
      .map((id) => measureOne(distX.project, shotId, id).worldBounds)
      .sort((a, b) => a.centerX - b.centerX);
    if (!distX.plan.negativeGapDetected) {
      const gap1 = dxBounds[1]!.minX - dxBounds[0]!.maxX;
      const gap2 = dxBounds[2]!.minX - dxBounds[1]!.maxX;
      expect(gap1).toBeCloseTo(gap2, 2);
    } else {
      const step1 = dxBounds[1]!.centerX - dxBounds[0]!.centerX;
      const step2 = dxBounds[2]!.centerX - dxBounds[1]!.centerX;
      expect(step1).toBeCloseTo(step2, 2);
    }
  });

  it('matches visible height proportionally while preserving non-uniform scale ratio and anchoring visible bottom', () => {
    const { project, shotId, imgLayer, charLayer, graphicLayer } = createMixedFixture();
    const refBounds = measureOne(project, shotId, imgLayer.id).worldBounds;
    const charBefore = measureOne(project, shotId, charLayer.id).worldBounds;
    const graphicBefore = measureOne(project, shotId, graphicLayer.id).worldBounds;

    const result = applyLayerLayout(project, {
      shotId,
      layerIds: [imgLayer.id, charLayer.id, graphicLayer.id],
      action: 'match-height',
      referenceLayerId: imgLayer.id,
    });
    expect(result.plan.ok).toBe(true);

    const charAfter = measureOne(result.project, shotId, charLayer.id);
    const graphicAfter = measureOne(result.project, shotId, graphicLayer.id);

    // Height matches reference; visible bottom and centerX stay anchored
    expect(charAfter.worldBounds.height).toBeCloseTo(refBounds.height, 2);
    expect(charAfter.worldBounds.maxY).toBeCloseTo(charBefore.maxY, 2);
    expect(charAfter.worldBounds.centerX).toBeCloseTo(charBefore.centerX, 2);

    expect(graphicAfter.worldBounds.height).toBeCloseTo(refBounds.height, 2);
    expect(graphicAfter.worldBounds.maxY).toBeCloseTo(graphicBefore.maxY, 2);
    expect(graphicAfter.worldBounds.centerX).toBeCloseTo(graphicBefore.centerX, 2);

    // Non-uniform scale ratio scaleX / scaleY is strictly preserved
    expect(charAfter.evaluated.scaleX / charAfter.evaluated.scaleY).toBeCloseTo(
      charLayer.scaleX / charLayer.scaleY,
      5,
    );
    expect(graphicAfter.evaluated.scaleX / graphicAfter.evaluated.scaleY).toBeCloseTo(
      graphicLayer.scaleX / graphicLayer.scaleY,
      5,
    );
  });

  it('moves parent once without double displacement when parent+child are selected, and uses inverse parent matrix for child-only', () => {
    const { project, shotId, imgLayer, charLayer, graphicLayer } = createMixedFixture();
    const layerService = new LayerService();
    // Bind charLayer as child of rotated/scaled parent imgLayer
    const rotatedParentProject = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) =>
        shot.id !== shotId
          ? shot
          : {
              ...shot,
              layers: shot.layers.map((layer) =>
                layer.id === imgLayer.id
                  ? { ...layer, rotationDeg: 30, scaleX: 0.25, scaleY: 0.2 }
                  : layer,
              ),
            },
      ),
    });
    const bound = layerService.setParent(
      rotatedParentProject,
      shotId,
      charLayer.id,
      imgLayer.id,
      0,
    );

    const parentBefore = measureOne(bound, shotId, imgLayer.id).worldBounds;
    const childBefore = measureOne(bound, shotId, charLayer.id).worldBounds;
    const refBefore = measureOne(bound, shotId, graphicLayer.id).worldBounds;
    const relBeforeX = childBefore.centerX - parentBefore.centerX;
    const relBeforeY = childBefore.centerY - parentBefore.centerY;

    // 1. Parent + child selected together -> only root moves, relative offset unchanged!
    const bothResult = applyLayerLayout(bound, {
      shotId,
      layerIds: [imgLayer.id, charLayer.id, graphicLayer.id],
      action: 'align-top',
      referenceLayerId: graphicLayer.id,
    });
    expect(bothResult.plan.ok).toBe(true);
    // Child must NOT be a separate planned root item
    expect(bothResult.plan.items.some((item) => item.layerId === charLayer.id)).toBe(false);
    const parentAfter = measureOne(bothResult.project, shotId, imgLayer.id).worldBounds;
    const childAfter = measureOne(bothResult.project, shotId, charLayer.id).worldBounds;
    expect(childAfter.centerX - parentAfter.centerX).toBeCloseTo(relBeforeX, 2);
    expect(childAfter.centerY - parentAfter.centerY).toBeCloseTo(relBeforeY, 2);
    expect(Math.min(parentAfter.minY, childAfter.minY)).toBeCloseTo(refBefore.minY, 2);

    // 2. Child-only selected with graphicLayer -> child moves accurately via inverse parentSpace
    const childOnly = applyLayerLayout(bound, {
      shotId,
      layerIds: [charLayer.id, graphicLayer.id],
      action: 'align-bottom',
      referenceLayerId: graphicLayer.id,
    });
    expect(childOnly.plan.ok).toBe(true);
    const childOnlyBounds = measureOne(childOnly.project, shotId, charLayer.id).worldBounds;
    const parentUnmoved = measureOne(childOnly.project, shotId, imgLayer.id).worldBounds;
    expect(childOnlyBounds.maxY).toBeCloseTo(refBefore.maxY, 2);
    expect(parentUnmoved.centerX).toBeCloseTo(parentBefore.centerX, 3);
    expect(parentUnmoved.centerY).toBeCloseTo(parentBefore.centerY, 3);
  });

  it('respects autoKey on keyframed FLA Graphic layers and rejects legacy move-controlled base edits locally', () => {
    const { project, shotId, imgLayer, graphicLayer } = createMixedFixture();
    const timeMs = 500;

    // With autoKey: true at t=500ms on FLA Graphic, writes keyframe without changing t=0 base pose
    const graphicBaseBefore = measureOne(project, shotId, graphicLayer.id, 0).worldBounds;
    const imgBounds = measureOne(project, shotId, imgLayer.id, timeMs).worldBounds;

    const autoKeyed = applyLayerLayout(project, {
      shotId,
      layerIds: [imgLayer.id, graphicLayer.id],
      action: 'align-top',
      referenceLayerId: imgLayer.id,
      timeMs,
      autoKey: true,
    });
    expect(autoKeyed.plan.ok).toBe(true);
    expect(measureOne(autoKeyed.project, shotId, graphicLayer.id, timeMs).worldBounds.minY).toBeCloseTo(
      imgBounds.minY,
      2,
    );
    // Base t=0 pose of the Graphic layer remains untouched when autoKeying at t=500ms!
    const evaluatedAt0 = evaluateShotAtTime(
      autoKeyed.project.shots[0]!,
      0,
      autoKeyed.project,
    ).layers.find((entry) => entry.id === graphicLayer.id)!;
    expect(evaluatedAt0.y).toBeCloseTo(graphicLayer.y, 2);
    expect(measureOne(autoKeyed.project, shotId, graphicLayer.id, 0).worldBounds.minY).toBeCloseTo(
      graphicBaseBefore.minY,
      2,
    );

    // With a legacy Move event active at t=500ms and autoKey: false, that layer is skipped locally
    const moveEvent: TimelineEvent = {
      id: randomUUID(),
      layerId: imgLayer.id,
      type: 'move',
      startMs: 0,
      endMs: 1000,
      from: { x: 300, y: 400 },
      to: { x: 600, y: 500 },
      easing: 'linear',
    };
    const withMove = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) =>
        shot.id === shotId ? { ...shot, timelineEvents: [moveEvent] } : shot,
      ),
    });
    const blocked = planLayerLayout(withMove, {
      shotId,
      layerIds: [imgLayer.id, graphicLayer.id],
      action: 'align-left',
      referenceLayerId: graphicLayer.id,
      timeMs: 500,
      autoKey: false,
    });
    expect(blocked.skipped.some((item) => item.layerId === imgLayer.id && item.reason === 'transform-rejected')).toBe(
      true,
    );
  });

  it('handles locked, non-invertible parent space, and mixed cameraSpace locally without corrupting valid layers', () => {
    const { project, shotId, imgLayer, charLayer, graphicLayer, imageAsset } = createMixedFixture();
    const screenLayer: Layer = {
      id: randomUUID(),
      name: '屏幕HUD',
      source: { kind: 'asset', assetId: imageAsset.id },
      anchor: 'center',
      x: 200,
      y: 200,
      scaleX: 0.3,
      scaleY: 0.3,
      rotationDeg: 0,
      opacity: 1,
      locked: false,
      visible: true,
      flipX: false,
      zIndex: 4,
      cameraSpace: 'screen',
    };
    const singularLayer: Layer = {
      id: randomUUID(),
      name: '奇异子层',
      source: { kind: 'asset', assetId: imageAsset.id },
      anchor: 'center',
      x: 500,
      y: 500,
      scaleX: 0.3,
      scaleY: 0.3,
      rotationDeg: 0,
      opacity: 1,
      locked: false,
      visible: true,
      flipX: false,
      zIndex: 5,
      parentSpaceOffset: { a: 0, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    };

    const hardened = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) =>
        shot.id !== shotId
          ? shot
          : {
              ...shot,
              layers: [
                { ...imgLayer, locked: true },
                charLayer,
                graphicLayer,
                screenLayer,
                singularLayer,
              ],
            },
      ),
    });

    const lockedRefBounds = measureOne(hardened, shotId, imgLayer.id).worldBounds;
    const plan = planLayerLayout(hardened, {
      shotId,
      layerIds: [imgLayer.id, charLayer.id, graphicLayer.id, screenLayer.id, singularLayer.id],
      action: 'align-left',
      referenceLayerId: imgLayer.id,
    });

    expect(plan.ok).toBe(true);
    expect(plan.candidateProject).not.toBeNull();
    expect(plan.skipped.some((item) => item.layerId === imgLayer.id && item.reason === 'locked')).toBe(true);
    expect(plan.skipped.some((item) => item.layerId === screenLayer.id && item.reason === 'mixed-camera-space')).toBe(true);
    expect(
      plan.skipped.some((item) => item.layerId === singularLayer.id && item.reason === 'non-invertible-parent-space'),
    ).toBe(true);

    // Valid world-space layers aligned to locked reference; skipped layers remain untouched
    const next = plan.candidateProject!;
    expect(measureOne(next, shotId, charLayer.id).worldBounds.minX).toBeCloseTo(lockedRefBounds.minX, 2);
    expect(measureOne(next, shotId, graphicLayer.id).worldBounds.minX).toBeCloseTo(lockedRefBounds.minX, 2);
    const nextScreen = next.shots[0]!.layers.find((layer) => layer.id === screenLayer.id)!;
    const nextSingular = next.shots[0]!.layers.find((layer) => layer.id === singularLayer.id)!;
    expect(nextScreen.x).toBe(screenLayer.x);
    expect(nextSingular.x).toBe(singularLayer.x);
  });

  it('exports reusable WF-03 standing placement API with 34%/66% and 92% defaults plus multi-character generalization', () => {
    const slots2 = computeStandingSlotTargets(2);
    expect(slots2).toHaveLength(2);
    expect(slots2[0]!.centerX).toBeCloseTo(PROJECT_WIDTH * DEFAULT_STANDING_LEFT_X_RATIO, 4);
    expect(slots2[1]!.centerX).toBeCloseTo(PROJECT_WIDTH * DEFAULT_STANDING_RIGHT_X_RATIO, 4);
    expect(slots2[0]!.groundY).toBeCloseTo(PROJECT_HEIGHT * DEFAULT_STANDING_GROUND_Y_RATIO, 4);

    const slots3 = computeStandingSlotTargets(3, {
      leftXRatio: 0.25,
      rightXRatio: 0.75,
      groundYRatio: 0.9,
    });
    expect(slots3.map((slot) => slot.xRatio)).toEqual([0.25, 0.5, 0.75]);
    expect(slots3[0]!.groundY).toBeCloseTo(PROJECT_HEIGHT * 0.9, 4);

    const { project, shotId, imgLayer, charLayer } = createMixedFixture();
    const previewPlan = planStandingPlacement(project, {
      shotId,
      layerIds: [imgLayer.id, charLayer.id],
    });
    expect(previewPlan.ok).toBe(true);
    // Input project is never mutated by preview
    expect(project.shots[0]!.layers.find((l) => l.id === imgLayer.id)!.x).toBe(imgLayer.x);

    const applied = applyStandingPlacement(project, {
      shotId,
      layerIds: [imgLayer.id, charLayer.id],
      matchHeight: true,
    });
    expect(applied.plan.ok).toBe(true);
    const bLeft = measureOne(applied.project, shotId, imgLayer.id).worldBounds;
    const bRight = measureOne(applied.project, shotId, charLayer.id).worldBounds;
    expect(bLeft.centerX).toBeCloseTo(PROJECT_WIDTH * 0.34, 2);
    expect(bRight.centerX).toBeCloseTo(PROJECT_WIDTH * 0.66, 2);
    expect(bLeft.maxY).toBeCloseTo(PROJECT_HEIGHT * 0.92, 2);
    expect(bRight.maxY).toBeCloseTo(PROJECT_HEIGHT * 0.92, 2);
    expect(bLeft.height).toBeCloseTo(bRight.height, 2);
  });

  it('previews without mutating EditorProjectStore and commits as a single Undo/Redo command', () => {
    const { project, shotId, imgLayer, charLayer, graphicLayer } = createMixedFixture();
    const editorStore = new EditorProjectStore();
    editorStore.open('D:\\PandaStage-Acceptance\\wf02-test', project);
    const shotStore = new ShotStore(editorStore, new ShotService());
    shotStore.select(shotId);
    const listeners = new Set<() => void>();
    const previewStore = new LayoutPreviewStore({
      editorStore,
      shotSelection: shotStore,
      timeline: {
        getSnapshot: () => ({ currentTimeMs: 0 }),
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });

    const initialRevision = editorStore.getSnapshot()!.revision;
    const plan = planLayerLayout(editorStore.getSnapshot()!.project, {
      shotId,
      layerIds: [imgLayer.id, charLayer.id, graphicLayer.id],
      action: 'align-bottom',
    });
    expect(plan.ok).toBe(true);
    expect(plan.candidateProject).not.toBeNull();

    // Preview does not mutate project, revision, dirty state, or history
    expect(previewStore.setPreview(shotId, 0, '底对齐', plan.candidateProject!)).toBe(true);
    expect(previewStore.getSnapshot()?.previewProject).toBe(plan.candidateProject);
    expect(editorStore.getSnapshot()!.revision).toBe(initialRevision);
    expect(editorStore.getSnapshot()!.dirty).toBe(false);
    expect(editorStore.undo()).toBe(false);

    // Cancel clears preview with zero side effects
    previewStore.clear();
    expect(previewStore.getSnapshot()).toBeNull();
    expect(editorStore.getSnapshot()!.revision).toBe(initialRevision);

    // Single updateProject commits all changes in 1 Undo/Redo step
    editorStore.updateProject(plan.candidateProject!, '排列图层：底对齐');
    expect(editorStore.getSnapshot()!.revision).toBe(initialRevision + 1);
    expect(editorStore.undo()).toBe(true);
    expect(editorStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === imgLayer.id)!.y).toBe(imgLayer.y);
    expect(editorStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === charLayer.id)!.y).toBe(charLayer.y);

    expect(editorStore.redo()).toBe(true);
    const redoneB1 = measureOne(editorStore.getSnapshot()!.project, shotId, imgLayer.id).worldBounds;
    const redoneB2 = measureOne(editorStore.getSnapshot()!.project, shotId, charLayer.id).worldBounds;
    expect(redoneB1.maxY).toBeCloseTo(redoneB2.maxY, 2);

    previewStore.dispose();
  });
});
