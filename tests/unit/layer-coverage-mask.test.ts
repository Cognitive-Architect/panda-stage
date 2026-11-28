import { describe, expect, it } from 'vitest';
import {
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ShotService,
  assertCoverageMaskChange,
  buildCoverageMaskClips,
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  isDrawableStageLayer,
  resolveCoverageMaskGeometry,
  resolveShotCoverageMasks,
  validCoverageMaskTargets,
  type Project,
} from '../../src/domain';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { shotThumbnailFingerprint } from '../../src/renderer/features/shots/shotThumbnail';
import { buildProject, IDS } from './domain/testProject';

const MASK_LAYER_ID = '60000000-0000-4000-8000-000000000010';
const SECOND_MASK_LAYER_ID = '60000000-0000-4000-8000-000000000020';
const UNKNOWN_LAYER_ID = '60000000-0000-4000-8000-000000000099';
const NOW = new Date('2026-11-28T06:00:00.000Z');

function maskLayer(
  id: string = MASK_LAYER_ID,
  maskTargets: readonly string[] = [IDS.layerChar],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: id === MASK_LAYER_ID ? '门框遮罩' : '画框遮罩',
    source: { kind: 'asset', assetId: IDS.assetChar },
    anchor: 'center',
    x: 960,
    y: 540,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    zIndex: 5,
    locked: false,
    flipX: false,
    maskTargets: [...maskTargets],
    ...overrides,
  };
}

function projectWithMaskLayers(
  maskLayers: readonly Record<string, unknown>[],
): Project {
  const base = buildProject();
  return ProjectSchema.parse({
    ...base,
    shots: base.shots.map((shot) => ({
      ...shot,
      layers: [...shot.layers, ...maskLayers],
    })),
  });
}

function setMaskRelation(
  project: Project,
  maskLayerId: string,
  targetLayerIds: readonly string[] | null,
): Project {
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((shot) => ({
      ...shot,
      layers: shot.layers.map((layer) => {
        if (layer.id !== maskLayerId) return layer;
        const { maskTargets: _previous, ...base } = layer;
        void _previous;
        return targetLayerIds === null
          ? base
          : { ...base, maskTargets: [...targetLayerIds] };
      }),
    })),
  });
}

function shotOf(project: Project) {
  return project.shots[0]!;
}

function evaluatedLayer(project: Project, timeMs: number, layerId: string) {
  const layer = evaluateShotAtTime(shotOf(project), timeMs, project).layers.find(
    (candidate) => candidate.id === layerId,
  );
  if (!layer) throw new Error(`Missing evaluated layer ${layerId}`);
  return layer;
}

function layerClipPaths(project: Project, timeMs: number, layerId: string): string[] {
  const shot = shotOf(project);
  const evaluated = evaluateShotAtTime(shot, timeMs, project);
  const model = buildEditorStageRenderModel(project, shot, evaluated);
  const maskLayerId = evaluated.layers.find((layer) => layer.id === layerId)?.coverageMask;
  if (!maskLayerId || maskLayerId.role !== 'mask-layer') {
    throw new Error(`Layer ${layerId} is not a mask layer`);
  }
  const mask = model.layers.find((entry) => entry.layer.id === layerId);
  if (!mask) throw new Error(`Missing render layer ${layerId}`);
  return (
    resolveCoverageMaskGeometry({
      layer: { evaluated: mask.evaluated, visual: mask.visual, render: mask.render },
      width: model.width,
      height: model.height,
    }).paths.map((path) => path.d)
  );
}

describe('coverage mask schema (#1454)', () => {
  it('persists additive maskTargets without a schema version bump', () => {
    const project = projectWithMaskLayers([maskLayer()]);
    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(reopened.shots[0]!.layers.find((layer) => layer.id === MASK_LAYER_ID)?.maskTargets)
      .toEqual([IDS.layerChar]);
    expect(reopened.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('rejects self references, duplicate ids, and oversized target lists', () => {
    expect(() => projectWithMaskLayers([maskLayer(MASK_LAYER_ID, [MASK_LAYER_ID])]))
      .toThrow(/不能遮罩自身/u);
    expect(() => projectWithMaskLayers([maskLayer(MASK_LAYER_ID, [IDS.layerChar, IDS.layerChar])]))
      .toThrow(/不能重复/u);
    const tooMany = Array.from({ length: 65 }, () => UNKNOWN_LAYER_ID);
    expect(() => projectWithMaskLayers([maskLayer(MASK_LAYER_ID, tooMany)]))
      .toThrow(/Too big|too_big|最大/u);
  });

  it('allows a declared mask layer with no targets yet', () => {
    const project = projectWithMaskLayers([maskLayer(MASK_LAYER_ID, [])]);
    expect(project.shots[0]!.layers.find((layer) => layer.id === MASK_LAYER_ID)?.maskTargets)
      .toEqual([]);
    expect(resolveShotCoverageMasks(shotOf(project)).maskTargetLayerIds.get(MASK_LAYER_ID))
      .toEqual([]);
  });
});

describe('resolveShotCoverageMasks (#1454)', () => {
  it('resolves multiple targets and keeps the authored target order', () => {
    const project = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, [IDS.layerChar, IDS.layerAsset]),
    ]);
    const resolution = resolveShotCoverageMasks(shotOf(project));
    expect(resolution.maskLayerIds.has(MASK_LAYER_ID)).toBe(true);
    expect(resolution.maskTargetLayerIds.get(MASK_LAYER_ID))
      .toEqual([IDS.layerChar, IDS.layerAsset]);
    expect([...resolution.maskLayerIdByTarget.entries()]).toEqual([
      [IDS.layerChar, MASK_LAYER_ID],
      [IDS.layerAsset, MASK_LAYER_ID],
    ]);
    expect(resolution.issues).toEqual([]);
  });

  it('degrades a dangling target locally and still clips the other targets', () => {
    const project = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, [UNKNOWN_LAYER_ID, IDS.layerChar]),
    ]);
    const resolution = resolveShotCoverageMasks(shotOf(project));
    expect(resolution.maskTargetLayerIds.get(MASK_LAYER_ID)).toEqual([IDS.layerChar]);
    expect(resolution.maskLayerIdByTarget.get(IDS.layerChar)).toBe(MASK_LAYER_ID);
    expect(resolution.issues).toContainEqual(
      expect.objectContaining({ code: 'dangling-target', targetLayerId: UNKNOWN_LAYER_ID }),
    );
    expect(resolution.issues[0]?.message).toMatch(/已不存在/u);
  });

  it('ignores nested masks and rejects a declared cycle locally', () => {
    const nested = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, [SECOND_MASK_LAYER_ID]),
      maskLayer(SECOND_MASK_LAYER_ID, [IDS.layerChar]),
    ]);
    const nestedResolution = resolveShotCoverageMasks(shotOf(nested));
    expect(nestedResolution.maskTargetLayerIds.get(MASK_LAYER_ID)).toEqual([]);
    expect(nestedResolution.issues).toContainEqual(
      expect.objectContaining({ code: 'mask-targets-mask' }),
    );

    const cyclic = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, [SECOND_MASK_LAYER_ID]),
      maskLayer(SECOND_MASK_LAYER_ID, [MASK_LAYER_ID]),
    ]);
    const cyclicResolution = resolveShotCoverageMasks(shotOf(cyclic));
    expect(cyclicResolution.issues.map((issue) => issue.code)).toContain('cycle');
    expect(cyclicResolution.maskLayerIdByTarget.size).toBe(0);
  });

  it('keeps the first mask when two masks claim the same target', () => {
    const project = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, [IDS.layerChar], { zIndex: 3 }),
      maskLayer(SECOND_MASK_LAYER_ID, [IDS.layerChar], { zIndex: 4 }),
    ]);
    const resolution = resolveShotCoverageMasks(shotOf(project));
    expect(resolution.maskLayerIdByTarget.get(IDS.layerChar)).toBe(MASK_LAYER_ID);
    expect(resolution.issues).toContainEqual(
      expect.objectContaining({ code: 'multiple-masks', layerId: SECOND_MASK_LAYER_ID }),
    );
  });

  it('lists only valid Inspector targets', () => {
    const project = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, []),
      maskLayer(SECOND_MASK_LAYER_ID, [IDS.layerAsset]),
    ]);
    const candidates = validCoverageMaskTargets(shotOf(project), MASK_LAYER_ID)
      .map(({ layer }) => layer.id);
    expect(candidates).toContain(IDS.layerChar);
    // Self, other masks, the background and already-masked layers are excluded.
    expect(candidates).not.toContain(MASK_LAYER_ID);
    expect(candidates).not.toContain(SECOND_MASK_LAYER_ID);
    expect(candidates).not.toContain(IDS.layerBg);
    expect(candidates).not.toContain(IDS.layerAsset);
  });
});

describe('LayerService coverage mask authoring (#1454)', () => {
  const service = () => new LayerService({ now: () => NOW });

  it('creates, edits and clears a mask relation without dangling ids', () => {
    const project = projectWithMaskLayers([maskLayer(MASK_LAYER_ID, [])]);
    const withTarget = service().setMaskTargets(
      project,
      IDS.shot,
      MASK_LAYER_ID,
      [IDS.layerChar, IDS.layerAsset],
    );
    expect(shotOf(withTarget).layers.find((layer) => layer.id === MASK_LAYER_ID)?.maskTargets)
      .toEqual([IDS.layerChar, IDS.layerAsset]);

    const cleared = service().setMaskTargets(withTarget, IDS.shot, MASK_LAYER_ID, null);
    const clearedMask = shotOf(cleared).layers.find((layer) => layer.id === MASK_LAYER_ID)!;
    expect(clearedMask.maskTargets).toBeUndefined();
    expect(evaluatedLayer(cleared, 0, IDS.layerChar).coverageMask).toBeUndefined();
    expect(isDrawableStageLayer(evaluatedLayer(cleared, 0, MASK_LAYER_ID))).toBe(true);
  });

  it('rejects self targets, unknown targets, nested masks and masked targets with Chinese copy', () => {
    const project = projectWithMaskLayers([maskLayer(MASK_LAYER_ID, [])]);
    expect(() => service().setMaskTargets(project, IDS.shot, MASK_LAYER_ID, [MASK_LAYER_ID]))
      .toThrow(/不能遮罩自身/u);
    expect(() => service().setMaskTargets(project, IDS.shot, MASK_LAYER_ID, [UNKNOWN_LAYER_ID]))
      .toThrow(/找不到被遮罩图层/u);

    const withNestedMask = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, []),
      maskLayer(SECOND_MASK_LAYER_ID, []),
    ]);
    expect(() => service().setMaskTargets(
      withNestedMask,
      IDS.shot,
      MASK_LAYER_ID,
      [SECOND_MASK_LAYER_ID],
    )).toThrow(/嵌套遮罩/u);

    const alreadyMasked = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, [IDS.layerChar]),
      maskLayer(SECOND_MASK_LAYER_ID, []),
    ]);
    expect(() => service().setMaskTargets(
      alreadyMasked,
      IDS.shot,
      SECOND_MASK_LAYER_ID,
      [IDS.layerChar],
    )).toThrow(/只能被一个遮罩覆盖/u);
    // A clipped Layer cannot also become a mask without clearing its clip.
    expect(() => service().setMaskTargets(
      alreadyMasked,
      IDS.shot,
      IDS.layerChar,
      [],
    )).toThrow(/不能同时作为遮罩/u);
  });

  it('rejects cycles on the save validation path', () => {
    // Only pre-existing/corrupted data can declare a cycle: ordinary authoring
    // blocks it earlier (a mask Layer cannot also be a target). The save-time
    // validator still rejects it explicitly.
    const cyclic = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, [SECOND_MASK_LAYER_ID]),
      maskLayer(SECOND_MASK_LAYER_ID, [MASK_LAYER_ID]),
    ]);
    expect(() => assertCoverageMaskChange(
      shotOf(cyclic),
      MASK_LAYER_ID,
      [SECOND_MASK_LAYER_ID],
    )).toThrow(/循环/u);
  });

  it('removes deleted targets from existing mask relations', () => {
    const project = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, [IDS.layerChar, IDS.layerAsset]),
    ]);
    const next = service().deleteLayer(project, IDS.shot, IDS.layerChar);
    const nextMask = shotOf(next).layers.find((layer) => layer.id === MASK_LAYER_ID)!;
    expect(nextMask.maskTargets).toEqual([IDS.layerAsset]);
    expect(() => ProjectSchema.parse(JSON.parse(JSON.stringify(next)))).not.toThrow();
  });

  it('does not duplicate a mask relation when copying its Layer', () => {
    const project = projectWithMaskLayers([maskLayer(MASK_LAYER_ID, [IDS.layerChar])]);
    const result = service().duplicateLayer(project, IDS.shot, MASK_LAYER_ID);
    expect(result.layer.maskTargets).toBeUndefined();
    expect(shotOf(result.project).layers.find((layer) => layer.id === MASK_LAYER_ID)?.maskTargets)
      .toEqual([IDS.layerChar]);
  });

  it('remaps mask targets when duplicating a Shot', () => {
    const project = projectWithMaskLayers([maskLayer(MASK_LAYER_ID, [IDS.layerChar])]);
    const duplicated = new ShotService({ now: () => NOW }).duplicate(project, IDS.shot);
    const copy = duplicated.shots[1]!;
    const copyMask = copy.layers.find((layer) => layer.name.includes('门框遮罩'))!;
    expect(copyMask.maskTargets?.length).toBe(1);
    expect(copyMask.maskTargets?.[0]).not.toBe(IDS.layerChar);
    expect(copy.layers.some((layer) => layer.id === copyMask.maskTargets?.[0])).toBe(true);
  });
});

describe('coverage mask evaluation and geometry (#1454)', () => {
  it('marks the mask layer non-drawing and every target as clipped', () => {
    const project = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, [IDS.layerChar, IDS.layerAsset]),
    ]);
    const evaluated = evaluateShotAtTime(shotOf(project), 0, project);
    const mask = evaluated.layers.find((layer) => layer.id === MASK_LAYER_ID)!;
    expect(mask.coverageMask).toEqual({
      role: 'mask-layer',
      targetLayerIds: [IDS.layerChar, IDS.layerAsset],
    });
    expect(isDrawableStageLayer(mask)).toBe(false);
    for (const targetId of [IDS.layerChar, IDS.layerAsset]) {
      expect(evaluated.layers.find((layer) => layer.id === targetId)?.coverageMask).toEqual({
        role: 'masked-target',
        maskLayerId: MASK_LAYER_ID,
      });
    }
    // Draw order is untouched: the mask layer keeps its authored zIndex slot.
    expect(evaluated.layers.map((layer) => layer.id)).toEqual([
      IDS.layerBg,
      IDS.layerAsset,
      IDS.layerChar,
      MASK_LAYER_ID,
    ]);
  });

  it('builds one deterministic stage-space coverage rectangle for an image mask', () => {
    const project = projectWithMaskLayers([maskLayer(MASK_LAYER_ID, [IDS.layerChar])]);
    expect(layerClipPaths(project, 0, MASK_LAYER_ID)).toEqual([
      'M 640 220 L 1280 220 L 1280 860 L 640 860 Z',
    ]);
    // Random seeks are deterministic.
    expect(layerClipPaths(project, 0, MASK_LAYER_ID))
      .toEqual(layerClipPaths(project, 0, MASK_LAYER_ID));
  });

  it('clips every target with the identical shared mask geometry', () => {
    const project = projectWithMaskLayers([
      maskLayer(MASK_LAYER_ID, [IDS.layerChar, IDS.layerAsset]),
      { ...maskLayer(SECOND_MASK_LAYER_ID, [IDS.layerBg]), zIndex: 6 },
    ]);
    const shot = shotOf(project);
    const evaluated = evaluateShotAtTime(shot, 0, project);
    const model = buildEditorStageRenderModel(project, shot, evaluated);
    const clips = buildCoverageMaskClips(model, undefined);
    const characterClip = clips.clips.get(IDS.layerChar);
    const assetClip = clips.clips.get(IDS.layerAsset);
    expect(characterClip).toBe(assetClip);
    expect(characterClip?.maskLayerId).toBe(MASK_LAYER_ID);
    expect(clips.clips.get(IDS.layerBg)?.maskLayerId).toBe(SECOND_MASK_LAYER_ID);
    expect(clips.unresolvedMaskLayerIds.size).toBe(0);
  });

  it('follows the animated mask transform so the real coverage region moves', () => {
    const animatedMask = maskLayer(MASK_LAYER_ID, [IDS.layerChar], {
      layerMotionTracks: [{
        target: { kind: 'layer', layerId: MASK_LAYER_ID },
        property: 'transform.offsetX',
        keys: [
          { timeMs: 0, value: 0, interpolationToNext: 'linear' },
          { timeMs: 1_000, value: 400, interpolationToNext: 'linear' },
        ],
      }],
    });
    const project = projectWithMaskLayers([animatedMask]);
    expect(evaluatedLayer(project, 0, MASK_LAYER_ID).x).toBeCloseTo(960);
    expect(evaluatedLayer(project, 500, MASK_LAYER_ID).x).toBeCloseTo(1_160);
    expect(layerClipPaths(project, 0, MASK_LAYER_ID)).toEqual([
      'M 640 220 L 1280 220 L 1280 860 L 640 860 Z',
    ]);
    expect(layerClipPaths(project, 500, MASK_LAYER_ID)).toEqual([
      'M 840 220 L 1480 220 L 1480 860 L 840 860 Z',
    ]);
  });

  it('clearing the mask restores the original target output', () => {
    const baseline = buildProject();
    const masked = projectWithMaskLayers([maskLayer(MASK_LAYER_ID, [IDS.layerChar])]);
    const restored = setMaskRelation(masked, MASK_LAYER_ID, null);
    const baselineCharacter = evaluatedLayer(baseline, 0, IDS.layerChar);
    const restoredCharacter = evaluatedLayer(restored, 0, IDS.layerChar);
    expect(restoredCharacter.coverageMask).toBeUndefined();
    expect({ ...restoredCharacter, coverageMask: undefined })
      .toEqual({ ...baselineCharacter, coverageMask: undefined });
    // The former mask Layer is ordinary drawable content again.
    expect(isDrawableStageLayer(evaluatedLayer(restored, 0, MASK_LAYER_ID))).toBe(true);
  });

  it('invalidates the Shot thumbnail fingerprint when the mask relation changes', () => {
    const baseline = projectWithMaskLayers([maskLayer(MASK_LAYER_ID, [])]);
    const masked = setMaskRelation(baseline, MASK_LAYER_ID, [IDS.layerChar]);
    expect(shotThumbnailFingerprint(masked, shotOf(masked)))
      .not.toBe(shotThumbnailFingerprint(baseline, shotOf(baseline)));
  });

  it('derives the same clips for the shared Stage/Preview/Export render model', () => {
    const project = projectWithMaskLayers([maskLayer(MASK_LAYER_ID, [IDS.layerChar])]);
    const shot = shotOf(project);
    const evaluated = evaluateShotAtTime(shot, 0, project);
    const editorModel = buildEditorStageRenderModel(project, shot, evaluated);
    const stageModel = buildStageRenderModel(
      project,
      evaluated,
      Object.fromEntries(project.assets.map((asset) => [asset.id, `file:///${asset.relativePath}`])),
    );
    const editorClips = buildCoverageMaskClips(editorModel, undefined);
    const stageClips = buildCoverageMaskClips(
      {
        width: stageModel.width,
        height: stageModel.height,
        layers: stageModel.layers.map((layer) => ({
          evaluated: layer,
          visual: layer.visual,
          render: layer.render,
        })),
      },
      undefined,
    );
    const pathsOf = (clips: ReturnType<typeof buildCoverageMaskClips>) =>
      [...clips.clips.entries()].map(([targetLayerId, clip]) => [
        targetLayerId,
        clip.maskLayerId,
        clip.paths.map((path) => path.d),
      ]);
    expect(pathsOf(stageClips)).toEqual(pathsOf(editorClips));
    expect(stageModel.layers.some((layer) => !isDrawableStageLayer(layer))).toBe(true);
  });
});
