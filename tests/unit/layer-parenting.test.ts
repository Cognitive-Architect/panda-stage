import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  cameraLayerTransform, evaluateShotAtTime, evaluatedLayerWorldMatrix, isFlaGraphicDefinition, layerAttachmentWorldMatrix, layerPoseMatrix, LayerMotionService, LayerService,
  migrateProject, prepareShotCamera, PROJECT_SCHEMA_VERSION, projectShotDialogueVisual, ProjectSchema, ProjectV44Schema,
  resolveLayerAttachmentLocalMatrix, resolveLayerAttachmentTargets, resolveLayerCameraTransform, setLayerDepth, setLayerDepthKey, setShotCameraKey, setShotCameraMode, ShotService, type Layer, type TimelineEvent,
} from '../../src/domain';
import { multiplyAffineMatrices, type AffineMatrix2D } from '../../src/shared/affine-matrix';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { evaluateEditorCanvasShot } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { projectProductPreviewDialogue } from '../../src/renderer/shell/productPreviewModel';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { evaluateExportShotAtTime, selectExportDrawingLayers } from '../../src/export-renderer/evaluateExportShotAtTime';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';

import { addTestAnimation, characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { characterActionGraphicFixture } from '../helpers/characterActionGraphicFixture';
import { IDS } from './domain/testProject';

function fixture() {
  const base = migrateProject(demo);
  const asset = base.assets.find(({ kind }) => kind === 'image')!;
  const layer = (name: string, zIndex: number, x: number, y: number): Layer => ({
    id: randomUUID(), source: { kind: 'asset', assetId: asset.id }, anchor: 'center',
    x, y, zIndex, name, scaleX: 1, scaleY: 1, rotationDeg: 0, opacity: 1,
    locked: false, visible: true, flipX: false,
  });
  const baseLayer = { ...layer('车身', 2, 600, 500), scaleX: 1.8, scaleY: 0.7, rotationDeg: 23, flipX: true };
  const middle = { ...layer('车轮', 0, 680, 520), visible: false, rotationDeg: 35 };
  const tip = { ...layer('特效', 3, 700, 530), opacity: 0.35 };
  const other = layer('另一父级', 1, 1400, 550);
  const endMs = 1_000;
  const timelineEvents: TimelineEvent[] = [
    { id: randomUUID(), layerId: baseLayer.id, type: 'move', startMs: 0, endMs, from: { x: 600, y: 500 }, to: { x: 870, y: 730 }, easing: 'linear' },
    { id: randomUUID(), layerId: baseLayer.id, type: 'scale', startMs: 0, endMs, from: { x: 1.8, y: 0.7 }, to: { x: 2.5, y: 0.4 }, easing: 'linear' },
    { id: randomUUID(), layerId: middle.id, type: 'move', startMs: 0, endMs, from: { x: 680, y: 520 }, to: { x: 730, y: 570 }, easing: 'linear' },
  ];
  const shot = { ...base.shots[0]!, layers: [tip, baseLayer, middle, other], dialogues: [], audioClips: [], timelineEvents, backgroundLayerId: null };
  return { project: ProjectSchema.parse({ ...base, shots: [shot] }), shot, asset, baseLayer, middle, tip, other };
}

function expectMatrix(actual: AffineMatrix2D, expected: AffineMatrix2D) {
  for (const key of Object.keys(expected) as (keyof AffineMatrix2D)[]) {
    expect(actual[key]).toBeCloseTo(expected[key], 8);
  }
}

describe('native Layer parenting', () => {
  it('keys ordinary bound layers locally and copies their tracks with safe parent ownership', () => {
    const { project, shot, baseLayer, middle, tip } = fixture();
    const service = new LayerService();
    const edits = new LayerMotionService();
    const bound = service.setParent(project, shot.id, tip.id, baseLayer.id, 500);
    const time = 750;
    const edited = edits.applyTransform(bound, { shotId: shot.id, layerId: tip.id, timeMs: time, autoKey: true },
      { x: 745, y: 480, scaleX: 1.4, scaleY: 0.8, rotationDeg: 42 });
    const pose = (input: typeof project, shotId: string, layerId: string) => {
      const currentShot = input.shots.find(({ id }) => id === shotId)!;
      return evaluateShotAtTime(currentShot, time, input).layers.find(({ id }) => id === layerId)!;
    };
    const local = pose(edited, shot.id, tip.id);
    expect(local).toMatchObject({ x: 745, y: 480, scaleX: 1.4, scaleY: 0.8, rotationDeg: 42 });
    expectMatrix(evaluatedLayerWorldMatrix(local), multiplyAffineMatrices(local.parentSpace!, layerPoseMatrix(local)));
    const rebound = service.setParent(edited, shot.id, tip.id, middle.id, time);
    expectMatrix(evaluatedLayerWorldMatrix(pose(rebound, shot.id, tip.id)), evaluatedLayerWorldMatrix(local));
    const detached = service.setParent(rebound, shot.id, tip.id, null, time);
    expectMatrix(evaluatedLayerWorldMatrix(pose(detached, shot.id, tip.id)), evaluatedLayerWorldMatrix(local));
    expect(migrateProject(JSON.parse(JSON.stringify(detached))).shots[0]?.layers.find(({ id }) => id === tip.id)?.layerMotionTracks)
      .toEqual(edited.shots[0]?.layers.find(({ id }) => id === tip.id)?.layerMotionTracks);
    const copy = service.duplicateLayer(rebound, shot.id, tip.id);
    expect(copy.layer.parentLayerId).toBe(middle.id);
    expect(copy.layer.layerMotionTracks?.every(({ target }) => target.layerId === copy.layer.id)).toBe(true);
    const shots = new ShotService();
    const withDestination = shots.create(rebound, { name: 'Copy destination', durationMs: shot.durationMs });
    const destination = withDestination.shots.at(-1)!;
    const paste = service.duplicateLayer(withDestination, shot.id, tip.id, destination.id, time);
    expect(paste.layer.parentLayerId).toBeUndefined();
    expectMatrix(evaluatedLayerWorldMatrix(pose(paste.project, destination.id, paste.layer.id)), evaluatedLayerWorldMatrix(local));
    const duplicate = shots.duplicate(rebound, shot.id).shots[1]!;
    const remapped = duplicate.layers.find(({ name }) => name === tip.name)!;
    expect(duplicate.layers.find(({ id }) => id === remapped.parentLayerId)?.name).toBe(middle.name);
    expect(remapped.layerMotionTracks?.every(({ target }) => target.layerId === remapped.id)).toBe(true);
  });

  it('rejects using an unusable affine parent while healthy relationships remain possible', () => {
    const { project, shot, baseLayer, middle, tip } = fixture();
    const singular = ProjectSchema.parse({ ...project, shots: [{ ...shot, layers: shot.layers.map((layer) =>
      layer.id === baseLayer.id ? { ...layer, parentSpaceOffset: { a: 0, b: 0, c: 0, d: 1, tx: 0, ty: 0 } } : layer,
    ) }] });
    const service = new LayerService();
    expect(() => service.setParent(singular, shot.id, tip.id, baseLayer.id, 500)).toThrow();
    expect(service.setParent(singular, shot.id, tip.id, middle.id, 500).shots[0]?.layers.find(({ id }) => id === tip.id)?.parentLayerId).toBe(middle.id);
  });
  it('draws only visible exported layers after inheriting hidden parent motion', () => {
    const { project, shot, asset, baseLayer, middle, tip, other } = fixture();
    const hidden = { ...asset, id: randomUUID(), relativePath: 'assets/hidden.png' };
    const delayed = { ...asset, id: randomUUID(), relativePath: 'assets/delayed.png' };
    const layerIds = [baseLayer.id, middle.id, other.id];
    const prepared = ProjectSchema.parse({
      ...project, assets: [...project.assets, hidden, delayed],
      shots: [{ ...shot, layers: shot.layers.map((layer) => layerIds.includes(layer.id)
        ? { ...layer, visible: false, source: { kind: 'asset', assetId: layer.id === other.id ? delayed.id : hidden.id } } : layer),
      timelineEvents: [...shot.timelineEvents, { id: randomUUID(), layerId: other.id, type: 'visibility', startMs: 1000, endMs: 1000, visible: true }] }],
    });
    const bound = new LayerService().setParent(prepared, shot.id, tip.id, baseLayer.id, 0);
    const input = bound.shots[0]!;
    const urls = Object.fromEntries(collectExportPreparationMedia(bound).map(({ asset: media }) => [media.id, 'asset:' + media.id]));
    expect(urls[hidden.id]).toBeUndefined();
    expect(urls[delayed.id]).toBeDefined();
    const at = (time: number) => selectExportDrawingLayers(evaluateExportShotAtTime(bound, input, time));
    const before = at(500);
    expect(before.layers.map(({ id }) => id)).toEqual([tip.id]);
    expect(evaluatedLayerWorldMatrix(before.layers[0]!).tx).not.toBe(tip.x);
    expect(buildStageRenderModel(bound, before, urls).layers.map(({ id }) => id)).toEqual([tip.id]);
    expect(buildStageRenderModel(bound, at(1000), urls).layers.map(({ id }) => id)).toEqual([other.id, tip.id]);
    expect(() => buildStageRenderModel(bound, at(1000), { ...urls, [delayed.id]: undefined })).toThrow(/no loadable URL/);
  });
  it.each(['bound', 'detached'] as const)('clears a %s layer space when making or refilling the formal background', (mode) => {
    const { project, shot, baseLayer, tip } = fixture();
    const service = new LayerService();
    const bound = service.setParent(project, shot.id, tip.id, baseLayer.id, 0);
    const animated = new LayerMotionService().applyTransform(
      bound,
      { shotId: shot.id, layerId: tip.id, timeMs: 750, autoKey: true },
      { x: 800, y: 415, scaleX: 1.6, scaleY: 0.85, rotationDeg: 30 },
    );
    const source = mode === 'bound' ? animated : service.setParent(animated, shot.id, tip.id, null, 500);
    const sourceLayer = source.shots[0]!.layers.find(({ id }) => id === tip.id)!;
    expect(sourceLayer.parentSpaceOffset).toBeDefined();
    expect(sourceLayer.layerMotionTracks).toHaveLength(5);
    const cover = service.setBackground(source, shot.id, tip.id);
    const store = new EditorProjectStore();
    store.open('D:/background-parenting.pandastage', source);
    store.updateProject(cover, 'Set background');
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()?.project).toEqual(source);
    expect(store.redo()).toBe(true);
    const reopened = migrateProject(JSON.parse(JSON.stringify(store.getSnapshot()?.project)));
    const coverShot = reopened.shots[0]!;
    const covered = coverShot.layers.find(({ id }) => id === tip.id)!;
    expect(covered).toMatchObject({ locked: true, zIndex: 0, x: 960, y: 540, rotationDeg: 0 });
    expect(covered.parentLayerId).toBeUndefined();
    expect(covered.parentSpaceOffset).toBeUndefined();
    expect(covered.layerMotionTracks).toBeUndefined();
    for (const timeMs of [0, 750, 1000]) {
      const formal = evaluateShotAtTime(coverShot, timeMs, reopened).layers.find(({ id }) => id === tip.id)!;
      expectMatrix(evaluatedLayerWorldMatrix(formal), layerPoseMatrix(covered));
    }
    const oldBackground = ProjectSchema.parse({ ...reopened, shots: [{ ...coverShot, layers: coverShot.layers.map((layer) =>
      layer.id === tip.id ? { ...layer, parentLayerId: sourceLayer.parentLayerId, parentSpaceOffset: sourceLayer.parentSpaceOffset } : layer,
    ) }] });
    const filled = service.fillBackground(oldBackground, shot.id);
    const refilled = filled.shots[0]!.layers.find(({ id }) => id === tip.id)!;
    expect(refilled.parentLayerId).toBeUndefined();
    expect(refilled.parentSpaceOffset).toBeUndefined();
    expect(refilled).toMatchObject({ locked: true, zIndex: 0, x: 960, y: 540 });
  });
  it.each(['set', 'fill'] as const)('clears residual root motion with %s when a locked background already covers the shot', (mode) => {
    const { project, shot, tip } = fixture();
    const service = new LayerService();
    const covered = service.setBackground(project, shot.id, tip.id);
    const bound = service.setParent(project, shot.id, tip.id, shot.layers[1]!.id, 0);
    const animated = new LayerMotionService().applyTransform(
      bound,
      { shotId: shot.id, layerId: tip.id, timeMs: 750, autoKey: true },
      { x: 845, rotationDeg: 15 },
    );
    const tracks = animated.shots[0]!.layers.find(({ id }) => id === tip.id)!.layerMotionTracks;
    const stale = ProjectSchema.parse({
      ...covered,
      shots: covered.shots.map((current) => ({
        ...current,
        layers: current.layers.map((layer) => layer.id === tip.id ? { ...layer, layerMotionTracks: tracks } : layer),
      })),
    });
    const repaired = mode === 'fill' ? service.fillBackground(stale, shot.id) : service.setBackground(stale, shot.id, tip.id);
    expect(repaired.shots).toEqual(covered.shots);
  });

  it('binds an adaptive part on its specific instance and preserves the pose when rebinding at a nonzero frame', () => {
    const data = characterPartAnimationFixture();
    const service = new LayerService();
    const other = service.createFromAdaptiveCharacter(data.project, IDS.shot, data.characterId, { x: 250, y: 400 });
    const animated = addTestAnimation(other.project, data.layerId, data.imagePartId, 'transform.offsetX', 100);
    const target = { kind: 'character-part' as const, partId: data.imagePartId };
    const pose = (project: typeof animated, timeMs: number) => evaluateShotAtTime(project.shots[0]!, timeMs, project)
      .layers.find(({ id }) => id === IDS.layerAsset)!;
    const bound = service.setParent(animated, IDS.shot, IDS.layerAsset, data.layerId, 500, target);
    expectMatrix(evaluatedLayerWorldMatrix(pose(bound, 500)), evaluatedLayerWorldMatrix(pose(animated, 500)));
    expect(evaluatedLayerWorldMatrix(pose(bound, 750)).tx - evaluatedLayerWorldMatrix(pose(bound, 500)).tx).toBeCloseTo(25);
    const rebound = service.setParent(bound, IDS.shot, IDS.layerAsset, other.layer.id, 750, target);
    expectMatrix(evaluatedLayerWorldMatrix(pose(rebound, 750)), evaluatedLayerWorldMatrix(pose(bound, 750)));
    expectMatrix(evaluatedLayerWorldMatrix(pose(rebound, 1_000)), evaluatedLayerWorldMatrix(pose(rebound, 750)));
    expect(() => service.setParent(rebound, IDS.shot, other.layer.id, IDS.layerAsset, 750)).toThrow();
  });

  it('tracks nested Graphic motion and deterministically follows the owner when its node goes missing', () => {
    const input = characterActionGraphicFixture();
    const service = new LayerService();
    const placed = service.createFromAnimation(input, IDS.shot, {
      animationId: input.animations[0]!.id, startTimeMs: 0, position: { x: 830, y: 480 },
      transform: { rotationDeg: 45, scaleX: 1.4, scaleY: 0.7, flipX: true },
    });
    const evaluate = (project: typeof input, time: number, layerId: string) =>
      evaluateShotAtTime(project.shots[0]!, time, project).layers.find(({ id }) => id === layerId)!;
    const owner = evaluate(placed.project, 250, placed.layer.id);
    const target = resolveLayerAttachmentTargets(placed.project, placed.layer, owner)
      .find(({ target }) => target.kind === 'graphic-node' && target.identityPath?.at(-1) === 'addr:Arm/hand')!.target;
    const bound = service.setParent(placed.project, IDS.shot, IDS.layerAsset, placed.layer.id, 250, target);
    const at = (project: typeof input, time: number) => evaluate(project, time, IDS.layerAsset);
    expectMatrix(evaluatedLayerWorldMatrix(at(bound, 250)), evaluatedLayerWorldMatrix(at(placed.project, 250)));
    expect(evaluatedLayerWorldMatrix(at(bound, 500)).tx).not.toBeCloseTo(evaluatedLayerWorldMatrix(at(bound, 250)).tx);
    const missing = ProjectSchema.parse({ ...bound, shots: bound.shots.map((shot) => ({
      ...shot,
      layers: shot.layers.map((layer) => layer.id === placed.layer.id ? {
        ...layer, x: layer.x + 30,
        source: { kind: 'asset', assetId: IDS.assetChar },
        startTimeMs: undefined, animationPlayback: undefined, animationFirstFrame: undefined,
      } : layer),
    })) });
    expect(at(missing, 500).parentAttachmentFallback).toBe(true);
    expect(evaluatedLayerWorldMatrix(at(missing, 500)).tx).toBeCloseTo(evaluatedLayerWorldMatrix(at(bound, 250)).tx + 30);
    expectMatrix(evaluatedLayerWorldMatrix(at(missing, 500)),
      evaluatedLayerWorldMatrix(at(migrateProject(JSON.parse(JSON.stringify(missing))), 500)));
    expect(at(bound, 500).parentAttachmentFallback).toBeUndefined();
  });

  it('animates multiple children with a resource-free control and leaves it out of output', () => {
    const { project, shot, tip, other, asset } = fixture();
    const service = new LayerService();
    const control = service.createControl(project, shot.id);
    expect(control.project.assets).toEqual(project.assets);
    expect(control.layer.source).toEqual({ kind: 'control' });
    expect(() => service.setBackground(control.project, shot.id, control.layer.id)).toThrow();
    const first = service.setParent(control.project, shot.id, tip.id, control.layer.id, 0);
    const bound = service.setParent(first, shot.id, other.id, control.layer.id, 0);
    const motion = new LayerMotionService();
    const authored = motion.applyTransform(bound, { shotId: shot.id, layerId: control.layer.id, timeMs: 750, autoKey: true },
      { x: 1200, rotationDeg: 30, scaleX: 1.4, scaleY: 1.4 });
    const keyed = motion.applyTransform(authored, { shotId: shot.id, layerId: tip.id, timeMs: 750, autoKey: true },
      { x: 820, scaleX: 1.2 });
    const current = migrateProject(JSON.parse(JSON.stringify(keyed)));
    const at = (input: typeof project, time: number) => evaluateShotAtTime(input.shots[0]!, time, input);
    const evaluated = at(current, 750);
    const shownChild = evaluated.layers.find(({ id }) => id === tip.id)!;
    expect(shownChild.parentSpace).toBeDefined();
    expect(shownChild.scaleX).toBeCloseTo(1.2);
    expect(evaluatedLayerWorldMatrix(evaluated.layers.find(({ id }) => id === other.id)!).tx).not.toBe(other.x);
    expect(collectExportPreparationMedia(current)).toEqual(collectExportPreparationMedia(project));
    expect(buildStageRenderModel(current, selectExportDrawingLayers(evaluated), { [asset.id]: 'asset:' + asset.id })
      .layers.some(({ id }) => id === control.layer.id)).toBe(false);
    const detached = service.deleteLayer(current, shot.id, control.layer.id, 750);
    const after = at(detached, 750).layers.find(({ id }) => id === tip.id)!;
    expectMatrix(evaluatedLayerWorldMatrix(after), evaluatedLayerWorldMatrix(shownChild));
  });

  it('keeps attached families in screen space and preserves that space on detach', () => {
    const { project, shot, baseLayer, tip } = fixture();
    const service = new LayerService();
    const bound = service.setParent(project, shot.id, tip.id, baseLayer.id, 0);
    const attached = service.setCameraAttachment(bound, shot.id, baseLayer.id, true);
    const at = (input: typeof project) => evaluateShotAtTime(input.shots[0]!, 750, input).layers.find(({ id }) => id === tip.id)!;
    expect(at(attached).effectiveCameraSpace).toBe('screen');
    expect(() => service.setCameraAttachment(attached, shot.id, tip.id, false)).toThrow();
    const detached = service.setParent(attached, shot.id, tip.id, null, 750);
    const restored = migrateProject(JSON.parse(JSON.stringify(detached)));
    expect(at(restored).effectiveCameraSpace).toBe('screen');
    expectMatrix(evaluatedLayerWorldMatrix(at(restored)), evaluatedLayerWorldMatrix(at(attached)));
    expect(at(service.setCameraAttachment(restored, shot.id, tip.id, false)).effectiveCameraSpace).toBeUndefined();
  });

  it('orders camera planes and skips clipped asset resolution after evaluating the parent chain', () => {
    const { project, shot, asset, baseLayer, middle, tip, other } = fixture();
    const bound = new LayerService().setParent(project, shot.id, tip.id, baseLayer.id, 0);
    const missing = { ...asset, id: randomUUID(), relativePath: 'assets/clipped.png' };
    const prepared = ProjectSchema.parse({
      ...bound,
      assets: [...bound.assets, missing],
      shots: bound.shots.map((current) => ({
        ...current,
        layers: current.layers.map((layer) => {
          if (layer.id === baseLayer.id) return {
            ...layer,
            source: { kind: 'asset', assetId: missing.id },
            depthKeys: [
              { timeMs: 0, value: 100, interpolationToNext: 'linear' },
              { timeMs: 1_000, value: -500, interpolationToNext: 'linear' },
            ],
          };
          if (layer.id === middle.id) return { ...layer, depth: 700, visible: true };
          if (layer.id === other.id) return { ...layer, cameraSpace: 'screen' };
          return layer;
        }),
      })),
    });
    const staged = prepared.shots[0]!;
    const at = (time: number) => evaluateShotAtTime(staged, time, prepared);
    expect(at(500).layers.find(({ id }) => id === tip.id)?.effectiveDepth).toBe(-200);
    const near = at(1_000);
    expect(near.layers.find(({ id }) => id === tip.id)?.effectiveDepth).toBe(-500);
    const independent = ProjectSchema.parse({
      ...prepared, shots: [{ ...staged, layers: staged.layers.map((layer) => layer.id === tip.id ? { ...layer, depth: 0 } : layer) }],
    });
    const composed = evaluateShotAtTime(independent.shots[0]!, 1_000, independent);
    expect(evaluatedLayerWorldMatrix(composed.layers.find(({ id }) => id === tip.id)!))
      .toEqual(evaluatedLayerWorldMatrix(near.layers.find(({ id }) => id === tip.id)!));
    const camera = { centerX: 1060, centerY: 540, zoom: 2, rotationDeg: 35 };
    const urls = { [asset.id]: 'asset:' + asset.id };
    expect(buildStageRenderModel(prepared, near, urls, undefined, { camera }).layers.map(({ id }) => id))
      .toEqual([middle.id, other.id]);
    expect(buildStageRenderModel(independent, composed, urls, undefined, { camera }).layers.map(({ id }) => id))
      .toEqual([middle.id, tip.id, other.id]);
  });

  it('persists three-level affine inheritance in draw order and preserves independent local motion', () => {
    const { project, shot, asset, baseLayer, middle, tip, other } = fixture();
    const service = new LayerService();
    const pair = service.setParent(project, shot.id, middle.id, baseLayer.id, 0);
    const chain = service.setParent(pair, shot.id, tip.id, middle.id, 0);
    const reopened = migrateProject(JSON.parse(JSON.stringify(chain)));
    const savedShot = reopened.shots[0]!;
    const atZero = evaluateShotAtTime(savedShot, 0, reopened);
    for (const layer of atZero.layers) {
      expectMatrix(evaluatedLayerWorldMatrix(layer), layerPoseMatrix(layer));
    }
    const atOne = evaluateShotAtTime(savedShot, 1_000, reopened);
    expect(atOne.layers.map(({ id }) => id)).toEqual([middle.id, other.id, baseLayer.id, tip.id]);
    const wheel = atOne.layers[0]!;
    const effect = atOne.layers[3]!;
    expect(wheel).toMatchObject({ x: 730, y: 570, visible: false });
    expect(effect).toMatchObject({ opacity: 0.35, visible: true });
    expectMatrix(evaluatedLayerWorldMatrix(effect), multiplyAffineMatrices(
      multiplyAffineMatrices(evaluatedLayerWorldMatrix(wheel), savedShot.layers[0]!.parentSpaceOffset!),
      layerPoseMatrix(effect),
    ));
    expect(evaluatedLayerWorldMatrix(effect).tx).not.toBe(effect.x);
    const { a, b, c, d } = evaluatedLayerWorldMatrix(wheel);
    expect(Math.abs(a * c + b * d)).toBeGreaterThan(0.1);
    expect(evaluateShotAtTime(savedShot, 1_000, reopened)).toEqual(atOne);
    expect(evaluateEditorCanvasShot(reopened, savedShot, 1_000, null).layers[3]?.parentSpace).toEqual(effect.parentSpace);
    expect(buildStageRenderModel(reopened, atOne, { [asset.id]: 'asset:local' }).layers[3]?.parentSpace).toEqual(effect.parentSpace);

    const store = new EditorProjectStore();
    store.open('D:/parenting.pandastage', pair);
    store.updateProject(chain, 'Bind effect');
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()?.project).toEqual(pair);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()?.project).toEqual(chain);

    const duplicated = new ShotService().duplicate(reopened, shot.id).shots[1]!;
    expect(duplicated.layers[0]?.parentLayerId).toBe(duplicated.layers[2]?.id);
  });

  it('keeps the pose on detach and deletion and handles damaged references locally', () => {
    const { project, shot, baseLayer, middle, tip, other } = fixture();
    const service = new LayerService();
    const bound = service.setParent(project, shot.id, middle.id, baseLayer.id, 500);
    expect(() => service.setParent(bound, shot.id, baseLayer.id, middle.id, 500)).toThrow();
    expect(() => service.setParent(bound, shot.id, middle.id, middle.id, 500)).toThrow();
    expect(() => service.setParent(bound, shot.id, middle.id, randomUUID(), 500)).toThrow();
    const world = (current: typeof project) => {
      const layers = evaluateShotAtTime(current.shots[0]!, 750, current).layers;
      return evaluatedLayerWorldMatrix(layers.find(({ id }) => id === middle.id)!);
    };
    const rebound = service.setParent(bound, shot.id, middle.id, other.id, 750);
    expectMatrix(world(rebound), world(bound));
    const detached = service.setParent(rebound, shot.id, middle.id, null, 750);
    expectMatrix(world(detached), world(bound));
    const afterDelete = service.deleteLayer(bound, shot.id, baseLayer.id, 750);
    expectMatrix(world(afterDelete), world(bound));
    expect(afterDelete.shots[0]?.layers.find(({ id }) => id === middle.id)?.parentLayerId).toBeUndefined();

    const damaged = migrateProject({
      ...project,
      shots: [{ ...shot, layers: [
        { ...baseLayer, parentLayerId: middle.id },
        { ...middle, parentLayerId: baseLayer.id },
        { ...tip, parentLayerId: middle.id },
        { ...other, parentLayerId: randomUUID() },
      ] }],
    });
    const frames = evaluateShotAtTime(damaged.shots[0]!, 750, damaged).layers;
    expect(frames.find(({ id }) => id === middle.id)?.parentSpace).toBeUndefined();
    expect(frames.find(({ id }) => id === other.id)?.parentSpace).toBeUndefined();
    expect(frames.find(({ id }) => id === tip.id)?.parentSpace).toBeDefined();
  });

  it('preserves inherited effective depth across unparent, parent deletion, and cross-shot duplication without overwriting explicit depth', () => {
    const { project, shot, baseLayer, middle, tip } = fixture();
    const service = new LayerService();
    const shots = new ShotService();
    const camera = { centerX: 1060, centerY: 540, zoom: 2, rotationDeg: 0 };
    const poseAt = (input: typeof project, shotId: string, layerId: string, timeMs: number) =>
      evaluateShotAtTime(input.shots.find(({ id }) => id === shotId)!, timeMs, input)
        .layers.find(({ id }) => id === layerId)!;
    const projectionOf = (pose: ReturnType<typeof poseAt>) =>
      cameraLayerTransform(camera, 1920, 1080, pose.effectiveDepth ?? 0, pose.effectiveCameraSpace ?? 'world');

    // Static parent depth -400 at camera zoom=2 => 6x projected scale.
    const deepParent = setLayerDepth(project, shot.id, baseLayer.id, -400);
    const bound = service.setParent(deepParent, shot.id, tip.id, baseLayer.id, 0);
    const beforeDetach = poseAt(bound, shot.id, tip.id, 500);
    expect(beforeDetach.effectiveDepth).toBe(-400);
    expect(projectionOf(beforeDetach)?.scaleX).toBeCloseTo(6, 8);

    // Unparenting freezes inherited effective depth -400 and keeps world matrix & 6x projection.
    const detached = service.setParent(bound, shot.id, tip.id, null, 500);
    const detachedPose = poseAt(detached, shot.id, tip.id, 500);
    expect(detached.shots[0]!.layers.find(({ id }) => id === tip.id)?.depth).toBe(-400);
    expect(detachedPose.effectiveDepth).toBe(-400);
    expectMatrix(evaluatedLayerWorldMatrix(detachedPose), evaluatedLayerWorldMatrix(beforeDetach));
    expect(projectionOf(detachedPose)).toEqual(projectionOf(beforeDetach));

    // Save/reopen and Undo/Redo keep the preserved depth cleanly.
    const store = new EditorProjectStore();
    store.open('D:/detach-depth.pandastage', bound);
    store.updateProject(detached, 'Detach preserving depth');
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()?.project).toEqual(bound);
    expect(store.redo()).toBe(true);
    const reopened = migrateProject(JSON.parse(JSON.stringify(store.getSnapshot()?.project)));
    expect(poseAt(reopened, shot.id, tip.id, 500).effectiveDepth).toBe(-400);
    expect(projectionOf(poseAt(reopened, shot.id, tip.id, 500))?.scaleX).toBeCloseTo(6, 8);

    // Deleting the parent at 500ms also preserves inherited depth & 6x projection.
    const deletedParent = service.deleteLayer(bound, shot.id, baseLayer.id, 500);
    const afterDeletePose = poseAt(deletedParent, shot.id, tip.id, 500);
    expect(deletedParent.shots[0]!.layers.find(({ id }) => id === tip.id)?.depth).toBe(-400);
    expect(afterDeletePose.effectiveDepth).toBe(-400);
    expectMatrix(evaluatedLayerWorldMatrix(afterDeletePose), evaluatedLayerWorldMatrix(beforeDetach));
    expect(projectionOf(afterDeletePose)).toEqual(projectionOf(beforeDetach));

    // Dynamic parent depthKeys: freeze only the detach-moment scalar, never copy/bake the parent's depth track.
    const dynamicBase = setLayerDepthKey(setLayerDepth(project, shot.id, baseLayer.id, 100), shot.id, baseLayer.id, 1_000, -500);
    const dynamicBound = service.setParent(dynamicBase, shot.id, tip.id, baseLayer.id, 0);
    expect(poseAt(dynamicBound, shot.id, tip.id, 500).effectiveDepth).toBe(-200);
    const sameShotCopy = service.duplicateLayer(dynamicBound, shot.id, tip.id, shot.id, 500);
    expect(sameShotCopy.layer.parentLayerId).toBe(baseLayer.id);
    expect(sameShotCopy.layer.depth).toBeUndefined();
    expect(poseAt(sameShotCopy.project, shot.id, sameShotCopy.layer.id, 1_000).effectiveDepth).toBe(-500);

    const withDest = shots.create(dynamicBound, { name: 'Cross-shot target', durationMs: shot.durationMs });
    const destId = withDest.shots.at(-1)!.id;
    const crossShot = service.duplicateLayer(withDest, shot.id, tip.id, destId, 500);
    expect(crossShot.layer.parentLayerId).toBeUndefined();
    expect(crossShot.layer.depth).toBe(-200);
    expect(crossShot.layer.depthKeys).toBeUndefined();
    expect(poseAt(crossShot.project, destId, crossShot.layer.id, 0).effectiveDepth).toBe(-200);
    expect(poseAt(crossShot.project, destId, crossShot.layer.id, 1_000).effectiveDepth).toBe(-200);

    const dynamicDetached = service.setParent(dynamicBound, shot.id, tip.id, null, 500);
    expect(dynamicDetached.shots[0]!.layers.find(({ id }) => id === tip.id)?.depth).toBe(-200);
    expect(dynamicDetached.shots[0]!.layers.find(({ id }) => id === tip.id)?.depthKeys).toBeUndefined();

    // Explicit child depth and depthKeys must never be overwritten on detach, delete, or cross-shot duplicate.
    const explicitScalar = setLayerDepth(bound, shot.id, tip.id, 250);
    expect(service.setParent(explicitScalar, shot.id, tip.id, null, 500).shots[0]!.layers.find(({ id }) => id === tip.id)?.depth).toBe(250);
    expect(service.deleteLayer(explicitScalar, shot.id, baseLayer.id, 500).shots[0]!.layers.find(({ id }) => id === tip.id)?.depth).toBe(250);
    const explicitKeys = setLayerDepthKey(setLayerDepth(bound, shot.id, tip.id, 50), shot.id, tip.id, 1_000, 350);
    const explicitKeysLayer = explicitKeys.shots[0]!.layers.find(({ id }) => id === tip.id)!;
    const detachedExplicitKeys = service.setParent(explicitKeys, shot.id, tip.id, null, 500).shots[0]!.layers.find(({ id }) => id === tip.id)!;
    expect(detachedExplicitKeys.depthKeys).toEqual(explicitKeysLayer.depthKeys);
    expect(detachedExplicitKeys.depth).toBe(explicitKeysLayer.depth);
    const destForKeys = shots.create(explicitKeys, { name: 'Keys dest', durationMs: shot.durationMs });
    const crossExplicitKeys = service.duplicateLayer(destForKeys, shot.id, tip.id, destForKeys.shots.at(-1)!.id, 500);
    expect(crossExplicitKeys.layer.depthKeys).toEqual(explicitKeysLayer.depthKeys);
    expect(crossExplicitKeys.layer.depth).toBe(explicitKeysLayer.depth);

    // Control layer parent with non-zero depth preserves child effective depth on delete and detach.
    const control = service.createControl(project, shot.id);
    const deepControl = setLayerDepth(control.project, shot.id, control.layer.id, -350);
    const controlBound = service.setParent(deepControl, shot.id, middle.id, control.layer.id, 0);
    const afterControlDelete = service.deleteLayer(controlBound, shot.id, control.layer.id, 500);
    expect(afterControlDelete.shots[0]!.layers.find(({ id }) => id === middle.id)?.depth).toBe(-350);

    // Character-part attachment parent with non-zero depth preserves depth on detach and delete.
    const data = characterPartAnimationFixture();
    const deepChar = setLayerDepth(data.project, IDS.shot, data.layerId, -300);
    const partTarget = { kind: 'character-part' as const, partId: data.imagePartId };
    const partBound = service.setParent(deepChar, IDS.shot, IDS.layerAsset, data.layerId, 500, partTarget);
    const partDetached = service.setParent(partBound, IDS.shot, IDS.layerAsset, null, 500);
    expect(partDetached.shots[0]!.layers.find(({ id }) => id === IDS.layerAsset)?.depth).toBe(-300);
    const partDeleted = service.deleteLayer(partBound, IDS.shot, data.layerId, 500);
    expect(partDeleted.shots[0]!.layers.find(({ id }) => id === IDS.layerAsset)?.depth).toBe(-300);
  });

  it('tracks Graphic attachments by stable cross-frame occurrence identity, rejects unreliable nodes, and migrates v44 nodePath safely', () => {
    const base = characterActionGraphicFixture(false);
    const graphic = base.animations[0]!;
    if (!isFlaGraphicDefinition(graphic) || !graphic.structure) throw new Error('Expected structured Graphic.');
    const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const translate = (tx: number, ty: number) => ({ a: 1, b: 0, c: 0, d: 1, tx, ty });
    const baseFrame = graphic.frames[0]!;
    const frameDurationMs = 250;
    graphic.source.sourceFps = 4;
    graphic.source.startFrameIndex = 0;
    graphic.source.endFrameIndex = 3;
    graphic.durationMs = frameDurationMs * 4;
    graphic.frames = [0, 1, 2, 3].map((ordinal) => ({
      ...baseFrame,
      ordinal,
      sourceFrameIndex: ordinal,
      startMs: ordinal * frameDurationMs,
      durationMs: frameDurationMs,
    }));
    graphic.structure.symbolDefinitions = {
      'arm-def': {
        symbolRef: 'Arm',
        sourceFrameCount: 1,
        children: [
          { type: 'bitmap', id: 'hand', sourceAddress: 'Arm/hand', bitmapRef: 'Hand', assetId: IDS.assetChar2, drawOrder: 0, localTransform: identity },
          { type: 'bitmap', id: 'wrist', bitmapRef: 'Wrist', assetId: IDS.assetChar2, drawOrder: 1, localTransform: translate(10, 0) },
        ],
      },
    };
    graphic.structure.frames = [
      {
        ordinal: 0,
        layers: [{
          name: 'Rig',
          nodes: [
            { type: 'symbol', id: 'f0-left', sourceAddress: 'Rig/LeftArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 0, localTransform: translate(100, 100) },
            { type: 'symbol', id: 'f0-right', sourceAddress: 'Rig/RightArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 1, localTransform: translate(400, 100) },
            {
              type: 'opaque', id: 'f0-opaque', sourceAddress: 'Rig/Glow', opaqueKind: 'filter', drawOrder: 2, localTransform: translate(200, 200),
              fallbackScope: 'frame-crop', fallbackAssetId: baseFrame.assetId, fallbackViewBox: { x: 0, y: 0, width: 100, height: 100 },
            },
            { type: 'bitmap', id: 'f0-anon', bitmapRef: 'Temp', assetId: IDS.assetChar2, drawOrder: 3, localTransform: translate(50, 50) },
          ],
        }],
      },
      {
        ordinal: 1,
        layers: [{
          name: 'Rig',
          nodes: [
            { type: 'symbol', id: 'f1-left', sourceAddress: 'Rig/LeftArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 0, localTransform: translate(220, 140) },
            { type: 'symbol', id: 'f1-right', sourceAddress: 'Rig/RightArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 1, localTransform: translate(520, 80) },
          ],
        }],
      },
      {
        ordinal: 2,
        layers: [{
          name: 'Rig',
          nodes: [
            // Same draw order & shared Definition as LeftArm, but a different identity!
            { type: 'symbol', id: 'f2-hat', sourceAddress: 'Rig/Hat', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 0, localTransform: translate(900, 300) },
            { type: 'symbol', id: 'f2-right', sourceAddress: 'Rig/RightArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 1, localTransform: translate(560, 60) },
          ],
        }],
      },
      {
        ordinal: 3,
        layers: [{
          name: 'Rig',
          nodes: [
            { type: 'symbol', id: 'f3-left', sourceAddress: 'Rig/LeftArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 0, localTransform: translate(340, 180) },
            { type: 'symbol', id: 'f3-right', sourceAddress: 'Rig/RightArm', symbolRef: 'Arm', nestedDefinitionId: 'arm-def', drawOrder: 1, localTransform: translate(600, 40) },
          ],
        }],
      },
    ];

    const service = new LayerService();
    const seeded = ProjectSchema.parse(base);
    const ownerLayer = service.createFromAnimation(seeded, IDS.shot, {
      animationId: graphic.id,
      startTimeMs: 0,
      position: { x: 960, y: 540 },
    });
    const propRight = service.duplicateLayer(ownerLayer.project, IDS.shot, IDS.layerAsset);
    const evaluate = (project: typeof seeded, timeMs: number, layerId: string) =>
      evaluateShotAtTime(project.shots[0]!, timeMs, project).layers.find(({ id }) => id === layerId)!;

    const ownerAt0 = evaluate(propRight.project, 0, ownerLayer.layer.id);
    const candidates = resolveLayerAttachmentTargets(propRight.project, ownerLayer.layer, ownerAt0);
    const candidateIdentities = candidates.map(({ target }) =>
      target.kind === 'graphic-node' ? target.identityPath : undefined,
    );
    expect(candidateIdentities).toContainEqual(['addr:Rig/LeftArm', 'addr:Arm/hand']);
    expect(candidateIdentities).toContainEqual(['addr:Rig/LeftArm', 'sym:arm-def:wrist']);
    expect(candidateIdentities).toContainEqual(['addr:Rig/RightArm', 'addr:Arm/hand']);
    // Unreliable opaque filter and unaddressed multi-frame temp nodes are excluded.
    expect(candidateIdentities.some((path) => path?.some((part) => part.includes('Glow') || part.includes('f0-anon')))).toBe(false);

    const leftHand = candidates.find(({ target }) =>
      target.kind === 'graphic-node' && JSON.stringify(target.identityPath) === JSON.stringify(['addr:Rig/LeftArm', 'addr:Arm/hand']))!.target;
    const rightHand = candidates.find(({ target }) =>
      target.kind === 'graphic-node' && JSON.stringify(target.identityPath) === JSON.stringify(['addr:Rig/RightArm', 'addr:Arm/hand']))!.target;

    const boundLeft = service.setParent(propRight.project, IDS.shot, IDS.layerAsset, ownerLayer.layer.id, 0, leftHand);
    const boundBoth = service.setParent(boundLeft, IDS.shot, propRight.layer.id, ownerLayer.layer.id, 0, rightHand);

    const left0 = evaluate(boundBoth, 0, IDS.layerAsset);
    const right0 = evaluate(boundBoth, 0, propRight.layer.id);
    const left1 = evaluate(boundBoth, 250, IDS.layerAsset);
    const right1 = evaluate(boundBoth, 250, propRight.layer.id);
    const left2 = evaluate(boundBoth, 500, IDS.layerAsset);
    const right2 = evaluate(boundBoth, 500, propRight.layer.id);
    const left3 = evaluate(boundBoth, 750, IDS.layerAsset);

    // Frame 1: follows cross-frame node move even though node.id changed (f0-left -> f1-left); occurrences stay distinct.
    expect(left1.parentAttachmentFallback).toBeUndefined();
    expect(evaluatedLayerWorldMatrix(left1).tx - evaluatedLayerWorldMatrix(left0).tx).toBeCloseTo(120, 6);
    expect(evaluatedLayerWorldMatrix(left1).ty - evaluatedLayerWorldMatrix(left0).ty).toBeCloseTo(40, 6);
    expect(evaluatedLayerWorldMatrix(right1).tx - evaluatedLayerWorldMatrix(right0).tx).toBeCloseTo(120, 6);
    expect(evaluatedLayerWorldMatrix(right1).ty - evaluatedLayerWorldMatrix(right0).ty).toBeCloseTo(-20, 6);

    // Frame 2: LeftArm disappeared while Rig/Hat shares arm-def; Left prop falls back deterministically without misbinding.
    expect(left2.parentAttachmentFallback).toBe(true);
    expectMatrix(evaluatedLayerWorldMatrix(left2), evaluatedLayerWorldMatrix(left0));
    expect(right2.parentAttachmentFallback).toBeUndefined();
    expect(evaluatedLayerWorldMatrix(right2).tx - evaluatedLayerWorldMatrix(right0).tx).toBeCloseTo(160, 6);

    // Frame 3: LeftArm reappears and resumes tracking accurately.
    expect(left3.parentAttachmentFallback).toBeUndefined();
    expect(evaluatedLayerWorldMatrix(left3).tx - evaluatedLayerWorldMatrix(left0).tx).toBeCloseTo(240, 6);
    expect(evaluatedLayerWorldMatrix(left3).ty - evaluatedLayerWorldMatrix(left0).ty).toBeCloseTo(80, 6);

    // Random seek order yields identical results to sequential playback.
    const sequential = [0, 250, 500, 750].map((t) => evaluate(boundBoth, t, IDS.layerAsset));
    const randomOrder = [750, 250, 500, 0].map((t) => evaluate(boundBoth, t, IDS.layerAsset));
    expect(randomOrder[3]).toEqual(sequential[0]);
    expect(randomOrder[1]).toEqual(sequential[1]);
    expect(randomOrder[2]).toEqual(sequential[2]);
    expect(randomOrder[0]).toEqual(sequential[3]);

    // Path occupied by a different identity on Frame 0 triggers fallback instead of silent misbind.
    const hijacked = ProjectSchema.parse({
      ...boundBoth,
      animations: boundBoth.animations.map((anim) =>
        isFlaGraphicDefinition(anim) && anim.structure
          ? {
              ...anim,
              structure: {
                ...anim.structure,
                frames: anim.structure.frames.map((frame) =>
                  frame.ordinal === 0
                    ? {
                        ...frame,
                        layers: frame.layers.map((layerEntry) => ({
                          ...layerEntry,
                          nodes: layerEntry.nodes.map((node) =>
                            node.id === 'f0-left' ? { ...node, sourceAddress: 'Rig/Hijacked', localTransform: translate(999, 999) } : node,
                          ),
                        })),
                      }
                    : frame,
                ),
              },
            }
          : anim,
      ),
    });
    const hijackedPose = evaluate(hijacked, 0, IDS.layerAsset);
    expect(hijackedPose.parentAttachmentFallback).toBe(true);
    expectMatrix(evaluatedLayerWorldMatrix(hijackedPose), evaluatedLayerWorldMatrix(left0));

    // Frozen v44 schema rejects v45 identityPath, while migrateProject upgrades provable v44 nodePath and keeps unprovable ones repairable.
    expect(ProjectV44Schema.safeParse({ ...boundBoth, schemaVersion: 44 }).success).toBe(false);
    const propOpaque = service.duplicateLayer(boundBoth, IDS.shot, IDS.layerAsset);
    const fallbackMatrix = boundBoth.shots[0]!.layers.find(({ id }) => id === IDS.layerAsset)!.parentAttachment!.ownerLocalFallback;
    const v44Payload = {
      ...propOpaque.project,
      schemaVersion: 44,
      shots: propOpaque.project.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) => {
          if (layer.id === IDS.layerAsset) {
            return { ...layer, parentAttachment: { target: { kind: 'graphic-node', nodePath: ['f0-left', 'hand'] }, ownerLocalFallback: fallbackMatrix } };
          }
          if (layer.id === propRight.layer.id) {
            return { ...layer, parentAttachment: { target: { kind: 'graphic-node', nodePath: ['f0-opaque'] }, ownerLocalFallback: fallbackMatrix } };
          }
          if (layer.id === propOpaque.layer.id) {
            return {
              ...layer,
              parentLayerId: ownerLayer.layer.id,
              parentAttachment: { target: { kind: 'graphic-node', nodePath: ['f0-anon'] }, ownerLocalFallback: fallbackMatrix },
            };
          }
          return layer;
        }),
      })),
    };
    const migrated = migrateProject(v44Payload);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const upgradedLeft = migrated.shots[0]!.layers.find(({ id }) => id === IDS.layerAsset)!;
    const keptOpaque = migrated.shots[0]!.layers.find(({ id }) => id === propRight.layer.id)!;
    const keptAnon = migrated.shots[0]!.layers.find(({ id }) => id === propOpaque.layer.id)!;
    expect(upgradedLeft.parentAttachment?.target).toEqual({ kind: 'graphic-node', identityPath: ['addr:Rig/LeftArm', 'addr:Arm/hand'] });
    expect(keptOpaque.parentAttachment?.target).toEqual({ kind: 'graphic-node', nodePath: ['f0-opaque'] });
    expect(keptAnon.parentAttachment?.target).toEqual({ kind: 'graphic-node', nodePath: ['f0-anon'] });
    expect(evaluate(migrated, 250, IDS.layerAsset).parentAttachmentFallback).toBeUndefined();
    expect(evaluatedLayerWorldMatrix(evaluate(migrated, 250, IDS.layerAsset)).tx - evaluatedLayerWorldMatrix(left0).tx).toBeCloseTo(120, 6);
    expect(evaluate(migrated, 0, propRight.layer.id).parentAttachmentFallback).toBe(true);
    expect(evaluate(migrated, 0, propOpaque.layer.id).parentAttachmentFallback).toBe(true);
    // Unprovable legacy targets remain cleanly repairable by detaching or rebinding to root.
    const repaired = service.setParent(migrated, IDS.shot, propRight.layer.id, ownerLayer.layer.id, 0);
    expect(repaired.shots[0]!.layers.find(({ id }) => id === propRight.layer.id)?.parentAttachment).toBeUndefined();

    // Two distinct owner Layers sharing the same Graphic Definition never cross-bind.
    const secondOwner = service.duplicateLayer(boundBoth, IDS.shot, ownerLayer.layer.id);
    const movedSecond = service.updatePosition(secondOwner.project, IDS.shot, secondOwner.layer.id, { x: 1_500, y: 800 });
    expectMatrix(
      evaluatedLayerWorldMatrix(evaluate(movedSecond, 250, IDS.layerAsset)),
      evaluatedLayerWorldMatrix(left1),
    );
    const duplicatedShot = new ShotService().duplicate(migrated, IDS.shot).shots[1]!;
    const copiedProp = duplicatedShot.layers.find(({ name }) => name === upgradedLeft.name)!;
    expect(copiedProp.parentAttachment?.target).toEqual({ kind: 'graphic-node', identityPath: ['addr:Rig/LeftArm', 'addr:Arm/hand'] });
  });

  it('keeps depth parallax, adaptive part props, empty control layers, hidden parents, screen HUD, and selected-object export aligned together (JOINT-01)', () => {
    const data = characterPartAnimationFixture();
    const service = new LayerService();
    const motion = new LayerMotionService();
    // 1. Animated adaptive character with a part-bound prop and depth=0.
    let project = addTestAnimation(data.project, data.layerId, data.imagePartId, 'transform.offsetX', 120);
    const control = service.createControl(project, IDS.shot);
    const hiddenCarrier = service.duplicateLayer(control.project, IDS.shot, IDS.layerAsset);
    const fgBadge = service.duplicateLayer(hiddenCarrier.project, IDS.shot, IDS.layerAsset);
    const hud = service.duplicateLayer(fgBadge.project, IDS.shot, IDS.layerAsset);
    project = hud.project;
    const propTarget = { kind: 'character-part' as const, partId: data.imagePartId };
    project = service.setParent(project, IDS.shot, IDS.layerAsset, data.layerId, 0, propTarget);

    // 2. Empty control layer at depth -400 driving a hidden intermediate parent -> visible foreground child.
    project = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((s) => s.id === IDS.shot ? {
        ...s,
        layers: s.layers.map((l) => l.id === hiddenCarrier.layer.id ? { ...l, visible: false } : l),
      } : s),
    });
    project = setLayerDepth(project, IDS.shot, control.layer.id, -400);
    project = service.setParent(project, IDS.shot, hiddenCarrier.layer.id, control.layer.id, 0);
    project = service.setParent(project, IDS.shot, fgBadge.layer.id, hiddenCarrier.layer.id, 0);
    project = motion.applyTransform(
      project,
      { shotId: IDS.shot, layerId: control.layer.id, timeMs: 1_000, autoKey: true },
      { x: 1_160, y: 540 },
    );

    // 3. Screen-space HUD pinned above world layers.
    project = service.setCameraAttachment(project, IDS.shot, hud.layer.id, true);

    // 4. Far background depth + manual 2-key camera pan/zoom.
    const bgId = project.shots[0]!.backgroundLayerId;
    if (bgId) project = setLayerDepth(project, IDS.shot, bgId, 700);
    project = setShotCameraMode(project, IDS.shot, 'manual');
    project = setShotCameraKey(project, IDS.shot, 0, { centerX: 960, centerY: 540, zoom: 1, rotationDeg: 0 });
    project = setShotCameraKey(project, IDS.shot, 1_000, { centerX: 1_060, centerY: 540, zoom: 2, rotationDeg: 0 });

    // 5. Save/reopen round-trip and evaluate formal export at t=500ms.
    const reopened = migrateProject(JSON.parse(JSON.stringify(project)));
    const shot = reopened.shots[0]!;
    const cameraAt = prepareShotCamera(reopened, shot, 'static');
    const camera500 = cameraAt(500)!;
    const formal500 = evaluateExportShotAtTime(reopened, shot, 500);
    const drawn500 = selectExportDrawingLayers(formal500);

    // Control layer & hidden parent must not appear in drawn export layers, while their visible child follows them at depth -400.
    const drawnIds = drawn500.layers.map(({ id }) => id);
    expect(drawnIds).not.toContain(control.layer.id);
    expect(drawnIds).not.toContain(hiddenCarrier.layer.id);
    expect(drawnIds).toContain(fgBadge.layer.id);
    expect(drawnIds).toContain(IDS.layerAsset);
    expect(drawnIds).toContain(hud.layer.id);

    const fgEvaluated = drawn500.layers.find(({ id }) => id === fgBadge.layer.id)!;
    expect(fgEvaluated.effectiveDepth).toBe(-400);
    expect(evaluatedLayerWorldMatrix(fgEvaluated).tx).toBeGreaterThan(fgBadge.layer.x);

    const prop0 = evaluateExportShotAtTime(reopened, shot, 0).layers.find(({ id }) => id === IDS.layerAsset)!;
    const prop500 = drawn500.layers.find(({ id }) => id === IDS.layerAsset)!;
    expect(evaluatedLayerWorldMatrix(prop500).tx - evaluatedLayerWorldMatrix(prop0).tx).toBeCloseTo(60, 5);

    const urls = Object.fromEntries(collectExportPreparationMedia(reopened).map(({ asset }) => [asset.id, 'asset:' + asset.id]));
    const renderModel = buildStageRenderModel(reopened, drawn500, urls, undefined, { camera: camera500 });
    // Screen HUD stays last (above world layers) and unaffected by camera zoom/pan.
    expect(renderModel.layers.at(-1)?.id).toBe(hud.layer.id);
    expect(resolveLayerCameraTransform(renderModel.layers.at(-1)!, camera500, 1920, 1080)).toEqual({
      x: 960, y: 540, offsetX: 960, offsetY: 540, scaleX: 1, scaleY: 1, rotation: -0,
    });
    // Near foreground child (-400) has stronger magnification than mid-plane prop (0).
    const fgRender = renderModel.layers.find(({ id }) => id === fgBadge.layer.id)!;
    const propRender = renderModel.layers.find(({ id }) => id === IDS.layerAsset)!;
    expect(resolveLayerCameraTransform(fgRender, camera500, 1920, 1080)!.scaleX)
      .toBeGreaterThan(resolveLayerCameraTransform(propRender, camera500, 1920, 1080)!.scaleX);

    // Selected-object export isolates only the target layer with null background (camera-independent contract).
    const isolated = evaluateExportShotAtTime(reopened, shot, 500, undefined, undefined, IDS.layerAsset);
    expect(isolated.backgroundLayerId).toBeNull();
    expect(isolated.layers.map(({ id }) => id)).toEqual([IDS.layerAsset]);
  });

  describe('dynamic parent keyframes (PARENT-05 #1379)', () => {
    it('supports pickup -> handoff -> drop with exact affine continuity, independent child motion, mirror/shear, random seek, save/reopen, and Undo/Redo', () => {
      const { project, shot, baseLayer, middle, tip, other } = fixture();
      const service = new LayerService();
      const motion = new LayerMotionService();
      // Give middle a parent (baseLayer) so middle has mirror + non-uniform scale + shear, and animate tip independently.
      const chained = service.setParent(project, shot.id, middle.id, baseLayer.id, 0);
      const poseAt = (input: typeof project, timeMs: number, layerId = tip.id) =>
        evaluateShotAtTime(input.shots[0]!, timeMs, input).layers.find(({ id }) => id === layerId)!;
      const worldAt = (input: typeof project, timeMs: number, layerId = tip.id) =>
        evaluatedLayerWorldMatrix(poseAt(input, timeMs, layerId));

      // Before pickup at t1 = 250ms, tip rests independently on the table.
      const beforePickup0 = worldAt(chained, 0);
      const beforePickup250 = worldAt(chained, 250);
      const pickedUp = service.setParentKey(chained, shot.id, tip.id, 250, middle.id);
      // Earlier segment [0, 250) is untouched; boundary t=250 matches exactly.
      expectMatrix(worldAt(pickedUp, 0), beforePickup0);
      expectMatrix(worldAt(pickedUp, 250), beforePickup250);
      // After t=250, tip follows middle (which inherits baseLayer's flip + non-uniform scale + shear).
      const at500WithA = worldAt(pickedUp, 500);
      expect(at500WithA.tx).not.toBeCloseTo(beforePickup250.tx, 2);
      expect(Math.abs(at500WithA.a * at500WithA.c + at500WithA.b * at500WithA.d)).toBeGreaterThan(0.05);

      // Animate tip's own local rotation independently (canAuthorLayerRootMotion recognizes parentKeys).
      const animatedTip = motion.applyTransform(
        pickedUp,
        { shotId: shot.id, layerId: tip.id, timeMs: 750, autoKey: true },
        { rotationDeg: 45, scaleX: 1.2 },
      );
      const tracksBeforeHandoff = animatedTip.shots[0]!.layers.find(({ id }) => id === tip.id)!.layerMotionTracks;
      const beforeHandoff500 = worldAt(animatedTip, 500);

      // Handoff to `other` at t2 = 500ms without rewriting earlier segments or child local tracks.
      const handedOff = service.setParentKey(animatedTip, shot.id, tip.id, 500, other.id);
      expectMatrix(worldAt(handedOff, 0), worldAt(animatedTip, 0));
      expectMatrix(worldAt(handedOff, 250), worldAt(animatedTip, 250));
      expectMatrix(worldAt(handedOff, 500), beforeHandoff500);
      expect(handedOff.shots[0]!.layers.find(({ id }) => id === tip.id)!.layerMotionTracks).toEqual(tracksBeforeHandoff);

      // Drop (detach) at t3 = 750ms preserving exact world matrix at 750ms.
      const beforeDrop750 = worldAt(handedOff, 750);
      const dropped = service.setParentKey(handedOff, shot.id, tip.id, 750, null);
      expectMatrix(worldAt(dropped, 0), worldAt(handedOff, 0));
      expectMatrix(worldAt(dropped, 500), worldAt(handedOff, 500));
      expectMatrix(worldAt(dropped, 750), beforeDrop750);
      expect(poseAt(dropped, 750).rotationDeg).toBeCloseTo(45, 5);
      expect(poseAt(dropped, 750).scaleX).toBeCloseTo(1.2, 5);

      // Random seek order === sequential playback, and canvas/export match formal evaluation.
      const sampleTimes = [0, 250, 500, 750, 1_000];
      const sequential = sampleTimes.map((t) => worldAt(dropped, t));
      const randomOrder = [750, 0, 1_000, 250, 500].map((t) => worldAt(dropped, t));
      expectMatrix(randomOrder[1]!, sequential[0]!);
      expectMatrix(randomOrder[3]!, sequential[1]!);
      expectMatrix(randomOrder[4]!, sequential[2]!);
      expectMatrix(randomOrder[0]!, sequential[3]!);
      expectMatrix(randomOrder[2]!, sequential[4]!);
      const droppedShot = dropped.shots[0]!;
      expect(evaluateEditorCanvasShot(dropped, droppedShot, 500, null).layers.find(({ id }) => id === tip.id)?.parentSpace)
        .toEqual(poseAt(dropped, 500).parentSpace);
      expect(evaluateExportShotAtTime(dropped, droppedShot, 500).layers.find(({ id }) => id === tip.id)?.parentSpace)
        .toEqual(poseAt(dropped, 500).parentSpace);

      // Save/reopen & Undo/Redo round-trip.
      const store = new EditorProjectStore();
      store.open('D:/dynamic-parent.pandastage', handedOff);
      store.updateProject(dropped, 'Drop prop at 750ms');
      expect(store.undo()).toBe(true);
      expect(store.getSnapshot()?.project).toEqual(handedOff);
      expect(store.redo()).toBe(true);
      const reopened = migrateProject(JSON.parse(JSON.stringify(store.getSnapshot()?.project)));
      for (let i = 0; i < sampleTimes.length; i += 1) {
        expectMatrix(worldAt(reopened, sampleTimes[i]!), sequential[i]!);
      }
    });

    it('supports adaptive character-part, control layer, and Graphic identityPath targets with fallback across dynamic handoffs', () => {
      const data = characterPartAnimationFixture();
      const service = new LayerService();
      const motion = new LayerMotionService();
      const animatedChar = addTestAnimation(data.project, data.layerId, data.imagePartId, 'transform.offsetX', 120);
      const control = service.createControl(animatedChar, IDS.shot);
      const movedControl = motion.applyTransform(
        control.project,
        { shotId: IDS.shot, layerId: control.layer.id, timeMs: 1_000, autoKey: true },
        { x: 1_260, y: 440, rotationDeg: 25 },
      );
      const partTarget = { kind: 'character-part' as const, partId: data.imagePartId };
      const worldAt = (input: typeof movedControl, timeMs: number) =>
        evaluatedLayerWorldMatrix(evaluateShotAtTime(input.shots[0]!, timeMs, input).layers.find(({ id }) => id === IDS.layerAsset)!);

      // Pickup by adaptive character part at 250ms -> handoff to empty control layer at 750ms.
      const boundPart = service.setParentKey(movedControl, IDS.shot, IDS.layerAsset, 250, data.layerId, { target: partTarget });
      expectMatrix(worldAt(boundPart, 250), worldAt(movedControl, 250));
      expect(worldAt(boundPart, 500).tx - worldAt(boundPart, 250).tx).toBeCloseTo(30, 5);
      const boundControl = service.setParentKey(boundPart, IDS.shot, IDS.layerAsset, 750, control.layer.id);
      expectMatrix(worldAt(boundControl, 750), worldAt(boundPart, 750));
      expect(worldAt(boundControl, 1_000).tx).not.toBeCloseTo(worldAt(boundControl, 750).tx, 1);

      // Graphic identityPath dynamic handoff + fallback when target goes missing.
      const graphicInput = characterActionGraphicFixture();
      const placed = service.createFromAnimation(graphicInput, IDS.shot, {
        animationId: graphicInput.animations[0]!.id,
        startTimeMs: 0,
        position: { x: 830, y: 480 },
      });
      const evalGraphic = (input: typeof graphicInput, timeMs: number, layerId: string = IDS.layerAsset) =>
        evaluateShotAtTime(input.shots[0]!, timeMs, input).layers.find(({ id }) => id === layerId)!;
      const owner250 = evalGraphic(placed.project, 250, placed.layer.id);
      const handTarget = resolveLayerAttachmentTargets(placed.project, placed.layer, owner250)
        .find(({ target }) => target.kind === 'graphic-node' && target.identityPath?.at(-1) === 'addr:Arm/hand')!.target;
      const boundGraphic = service.setParentKey(placed.project, IDS.shot, IDS.layerAsset, 250, placed.layer.id, { target: handTarget });
      expectMatrix(
        evaluatedLayerWorldMatrix(evalGraphic(boundGraphic, 250)),
        evaluatedLayerWorldMatrix(evalGraphic(placed.project, 250)),
      );
      expect(evaluatedLayerWorldMatrix(evalGraphic(boundGraphic, 500)).tx)
        .not.toBeCloseTo(evaluatedLayerWorldMatrix(evalGraphic(boundGraphic, 250)).tx, 2);
      const missingNode = ProjectSchema.parse({
        ...boundGraphic,
        shots: boundGraphic.shots.map((s) => ({
          ...s,
          layers: s.layers.map((l) => l.id === placed.layer.id ? {
            ...l,
            source: { kind: 'asset', assetId: IDS.assetChar },
            startTimeMs: undefined, animationPlayback: undefined, animationFirstFrame: undefined,
          } : l),
        })),
      });
      expect(evalGraphic(missingNode, 500).parentAttachmentFallback).toBe(true);
    });

    it('allows legal time-separated parent swaps while rejecting same-timestamp cycles and degrading damaged cycles locally', () => {
      const { project, shot, baseLayer, middle, tip } = fixture();
      const service = new LayerService();
      // Base: middle -> baseLayer. At t=500: middle detaches, then baseLayer binds to middle (legal cross-time swap!).
      const step1 = service.setParent(project, shot.id, middle.id, baseLayer.id, 0);
      const step2 = service.setParentKey(step1, shot.id, middle.id, 500, null);
      // Same-timestamp cycle at t=250 (while middle -> baseLayer is still active) must be rejected.
      expect(() => service.setParentKey(step2, shot.id, baseLayer.id, 250, middle.id)).toThrow(/循环/);
      // Legal cross-time swap at t=500 succeeds cleanly!
      const swapped = service.setParentKey(step2, shot.id, baseLayer.id, 500, middle.id);
      expect(() => service.removeParentKey(swapped, shot.id, middle.id, 500)).toThrow(/循环/);
      expect(() => service.moveParentKey(swapped, shot.id, middle.id, 500, 750)).toThrow(/循环/);
      const earlierDetach = service.moveParentKey(swapped, shot.id, middle.id, 500, 250);
      expect(earlierDetach.shots[0]!.layers.find(({ id }) => id === middle.id)?.parentKeys?.[0]?.timeMs).toBe(250);
      expect(() => service.moveParentKey(swapped, shot.id, baseLayer.id, 500, 250)).toThrow(/循环/);
      const at250 = evaluateShotAtTime(swapped.shots[0]!, 250, swapped).layers;
      const at750 = evaluateShotAtTime(swapped.shots[0]!, 750, swapped).layers;
      expect(at250.find(({ id }) => id === middle.id)?.parentSpace).toBeDefined();
      expect(at750.find(({ id }) => id === baseLayer.id)?.parentSpace).toBeDefined();

      // Damaged same-timestamp dynamic cycle degrades locally without crashing unrelated layers.
      const damaged = ProjectSchema.parse({
        ...project,
        shots: [{
          ...shot,
          layers: [
            { ...baseLayer, parentKeys: [{ timeMs: 500, parentLayerId: middle.id }] },
            { ...middle, parentKeys: [{ timeMs: 500, parentLayerId: baseLayer.id }] },
            { ...tip, parentKeys: [{ timeMs: 500, parentLayerId: middle.id }] },
          ],
        }],
      });
      const frames = evaluateShotAtTime(damaged.shots[0]!, 500, damaged).layers;
      expect(frames.find(({ id }) => id === baseLayer.id)?.parentSpace).toBeUndefined();
      expect(frames.find(({ id }) => id === middle.id)?.parentSpace).toBeUndefined();
      expect(frames.find(({ id }) => id === tip.id)?.parentSpace).toBeDefined();
      const unrelatedEdit = service.moveParentKey(damaged, shot.id, tip.id, 500, 750);
      expect(unrelatedEdit.shots[0]!.layers.find(({ id }) => id === tip.id)?.parentKeys?.[0]?.timeMs).toBe(750);
    });

    it('supports add, move, remove, realign keys, preserves parentKeys on static setParent, and rejects non-invertible targets', () => {
      const { project, shot, baseLayer, middle, tip, other } = fixture();
      const service = new LayerService();
      const worldAt = (input: typeof project, timeMs: number) =>
        evaluatedLayerWorldMatrix(evaluateShotAtTime(input.shots[0]!, timeMs, input).layers.find(({ id }) => id === tip.id)!);

      // Add keys at 250 and 750.
      const k1 = service.setParentKey(project, shot.id, tip.id, 250, baseLayer.id);
      const k2 = service.setParentKey(k1, shot.id, tip.id, 750, other.id);
      // Static setParent edits only base segment while preserving subsequent parentKeys.
      const baseEdited = service.setParent(k2, shot.id, tip.id, middle.id, 0);
      const baseEditedTip = baseEdited.shots[0]!.layers.find(({ id }) => id === tip.id)!;
      expect(baseEditedTip.parentLayerId).toBe(middle.id);
      expect(baseEditedTip.parentKeys?.map((k) => k.timeMs)).toEqual([250, 750]);

      // Move key 250 -> 500 recalculates offset at 500 so boundary 500 is continuous with preceding base segment.
      const moved = service.moveParentKey(baseEdited, shot.id, tip.id, 250, 500);
      expect(moved.shots[0]!.layers.find(({ id }) => id === tip.id)!.parentKeys?.map((k) => k.timeMs)).toEqual([500, 750]);
      // Moving onto an existing key time throws.
      expect(() => service.moveParentKey(moved, shot.id, tip.id, 500, 750)).toThrow(/已存在/);
      for (const invalidTime of [NaN, -1, shot.durationMs + 1]) {
        expect(() => service.moveParentKey(moved, shot.id, tip.id, 500, invalidTime)).toThrow(/时长范围/);
      }

      // Remove key at 500 -> now 750's preceding segment changed from baseLayer to middle, so 750 drifts until realigned.
      const removed = service.removeParentKey(moved, shot.id, tip.id, 500);
      expect(removed.shots[0]!.layers.find(({ id }) => id === tip.id)!.parentKeys?.map((k) => k.timeMs)).toEqual([750]);
      const incomingAt750 = evaluatedLayerWorldMatrix(
        evaluateShotAtTime(
          { ...removed.shots[0]!, layers: removed.shots[0]!.layers.map((l) => l.id === tip.id ? { ...l, parentKeys: undefined } : l) },
          750,
          removed,
        ).layers.find(({ id }) => id === tip.id)!,
      );
      expect(worldAt(removed, 750).tx).not.toBeCloseTo(incomingAt750.tx, 1);

      // Realign key at 750 restores exact boundary continuity with incoming segment!
      const realigned = service.realignParentKey(removed, shot.id, tip.id, 750);
      expectMatrix(worldAt(realigned, 750), incomingAt750);

      // Non-invertible target is rejected cleanly.
      const singular = ProjectSchema.parse({
        ...project,
        shots: [{
          ...shot,
          layers: shot.layers.map((l) => l.id === baseLayer.id ? { ...l, parentSpaceOffset: { a: 0, b: 0, c: 0, d: 1, tx: 0, ty: 0 } } : l),
        }],
      });
      expect(() => service.setParentKey(singular, shot.id, tip.id, 500, baseLayer.id)).toThrow(/无法反算/);
    });

    it('enforces cross-depth preserve/inherit, detach depth & space freeze, explicit depthKeys protection, and world/screen boundary errors', () => {
      const { project, shot, baseLayer, middle, tip, other } = fixture();
      const service = new LayerService();
      const poseAt = (input: typeof project, timeMs: number, layerId = tip.id) =>
        evaluateShotAtTime(input.shots[0]!, timeMs, input).layers.find(({ id }) => id === layerId)!;

      // baseLayer has dynamic depthKeys (100 -> -500), middle has static depth -300.
      let seeded = setLayerDepthKey(setLayerDepth(project, shot.id, baseLayer.id, 100), shot.id, baseLayer.id, 1_000, -500);
      seeded = setLayerDepth(seeded, shot.id, middle.id, -300);
      seeded = setLayerDepth(seeded, shot.id, other.id, 0);

      // Same-depth handoff (tip 0 -> other 0) defaults to 'inherit'.
      const sameDepth = service.setParentKey(seeded, shot.id, tip.id, 250, other.id);
      expect(sameDepth.shots[0]!.layers.find(({ id }) => id === tip.id)!.parentKeys?.[0]?.depthMode).toBe('inherit');

      // Cross-depth handoff (tip 0 -> middle -300): defaults to 'preserve' (keeps 0).
      const crossPreserve = service.setParentKey(seeded, shot.id, tip.id, 250, middle.id);
      expect(crossPreserve.shots[0]!.layers.find(({ id }) => id === tip.id)!.parentKeys?.[0]?.depthMode).toBe('preserve');
      expect(poseAt(crossPreserve, 500).effectiveDepth).toBe(0);

      // Explicit depthMode: 'inherit' adopts new parent depth (including animated depthKeys!).
      const crossInherit = service.setParentKey(seeded, shot.id, tip.id, 250, baseLayer.id, { depthMode: 'inherit' });
      expect(poseAt(crossInherit, 500).effectiveDepth).toBe(-200);
      expect(poseAt(crossInherit, 1_000).effectiveDepth).toBe(-500);

      // Detach at 500ms freezes inherited effectiveDepth (-200) on that segment without changing earlier segment.
      const detached = service.setParentKey(crossInherit, shot.id, tip.id, 500, null);
      expect(poseAt(detached, 250).effectiveDepth).toBe(-50);
      expect(poseAt(detached, 500).effectiveDepth).toBe(-200);
      expect(poseAt(detached, 1_000).effectiveDepth).toBe(-200);

      // Explicit child depthKeys are never overwritten by dynamic parent keys.
      const withExplicitKeys = setLayerDepthKey(setLayerDepth(crossInherit, shot.id, tip.id, 50), shot.id, tip.id, 1_000, 350);
      const detachedExplicit = service.setParentKey(withExplicitKeys, shot.id, tip.id, 500, null);
      expect(poseAt(detachedExplicit, 500).effectiveDepth).toBe(200);
      expect(poseAt(detachedExplicit, 1_000).effectiveDepth).toBe(350);

      // Direct cross-space (world <-> screen) handoff is rejected cleanly.
      const screenParent = service.setCameraAttachment(seeded, shot.id, other.id, true);
      expect(() => service.setParentKey(screenParent, shot.id, tip.id, 250, other.id)).toThrow(/世界空间与屏幕空间/);
      // Same-space (screen -> screen) handoff and detach preserve screen space.
      const screenBoth = service.setCameraAttachment(screenParent, shot.id, tip.id, true);
      const screenBound = service.setParentKey(screenBoth, shot.id, tip.id, 250, other.id);
      const screenDetached = service.setParentKey(screenBound, shot.id, tip.id, 500, null);
      expect(poseAt(screenDetached, 500).effectiveCameraSpace).toBe('screen');
    });

    it('handles deleteLayer, duplicateLayer (same-shot & cross-shot), ShotService duplicate/setDuration, and background clearing', () => {
      const { project, shot, baseLayer, middle, tip } = fixture();
      const service = new LayerService();
      const shots = new ShotService();
      const poseAt = (input: typeof project, shotId: string, layerId: string, timeMs: number) =>
        evaluateShotAtTime(input.shots.find(({ id }) => id === shotId)!, timeMs, input)
          .layers.find(({ id }) => id === layerId)!;

      // Setup: baseLayer has depth -300. tip binds to baseLayer at 250 (inherit), hands off to middle at 500, back to baseLayer at 750.
      const deepBase = setLayerDepth(setLayerDepth(project, shot.id, tip.id, 0), shot.id, baseLayer.id, -300);
      const k1 = service.setParentKey(deepBase, shot.id, tip.id, 250, baseLayer.id, { depthMode: 'inherit' });
      const k2 = service.setParentKey(k1, shot.id, tip.id, 500, middle.id, { depthMode: 'inherit' });
      const k3 = service.setParentKey(k2, shot.id, tip.id, 750, baseLayer.id, { depthMode: 'inherit' });

      // 1. deleteLayer(baseLayer) at timeMs = 375 (inside [250, 500) segment):
      //    - [250, 500) freezes pose/depth at 375ms
      //    - [500, 750) still points to middle
      //    - [750, inf) freezes pose/depth at its boundary 750ms with parentLayerId: null
      const before375 = poseAt(k3, shot.id, tip.id, 375);
      const before750 = poseAt(k3, shot.id, tip.id, 750);
      const afterDelete = service.deleteLayer(k3, shot.id, baseLayer.id, 375);
      const survivingTip = afterDelete.shots[0]!.layers.find(({ id }) => id === tip.id)!;
      expect(survivingTip.parentKeys?.map((k) => k.parentLayerId)).toEqual([null, middle.id, null]);
      expectMatrix(evaluatedLayerWorldMatrix(poseAt(afterDelete, shot.id, tip.id, 375)), evaluatedLayerWorldMatrix(before375));
      expect(poseAt(afterDelete, shot.id, tip.id, 375).effectiveDepth).toBe(-300);
      expectMatrix(evaluatedLayerWorldMatrix(poseAt(afterDelete, shot.id, tip.id, 750)), evaluatedLayerWorldMatrix(before750));
      expect(poseAt(afterDelete, shot.id, tip.id, 750).effectiveDepth).toBe(-300);

      // 2. Same-shot duplicateLayer preserves valid parentKeys; cross-shot freezes timeMs pose/depth & clears parentKeys.
      const sameCopy = service.duplicateLayer(k3, shot.id, tip.id, shot.id, 375);
      expect(sameCopy.layer.parentKeys).toEqual(k3.shots[0]!.layers.find(({ id }) => id === tip.id)!.parentKeys);
      const withDest = shots.create(k3, { name: 'Dest Shot', durationMs: shot.durationMs });
      const destId = withDest.shots.at(-1)!.id;
      const crossCopy = service.duplicateLayer(withDest, shot.id, tip.id, destId, 375);
      expect(crossCopy.layer.parentKeys).toBeUndefined();
      expect(crossCopy.layer.parentLayerId).toBeUndefined();
      expect(crossCopy.layer.depth).toBe(-300);
      expectMatrix(evaluatedLayerWorldMatrix(poseAt(crossCopy.project, destId, crossCopy.layer.id, 0)), evaluatedLayerWorldMatrix(before375));
      const camera = { centerX: 1000, centerY: 500, zoom: 1.2 };
      expect(resolveLayerCameraTransform(poseAt(crossCopy.project, destId, crossCopy.layer.id, 0), camera, 1920, 1080))
        .toEqual(resolveLayerCameraTransform(before375, camera, 1920, 1080));

      const preserved = service.setParentKey(k1, shot.id, tip.id, 500, middle.id, { depthMode: 'preserve' });
      expect(service.duplicateLayer(withDest, shot.id, tip.id, destId, 600, preserved).layer.depth).toBe(-300);
      const detached = service.setParentKey(k1, shot.id, tip.id, 500, null);
      expect(service.duplicateLayer(withDest, shot.id, tip.id, destId, 600, detached).layer.depth).toBe(-300);
      const inheritedZero = setLayerDepth(setLayerDepth(k2, shot.id, tip.id, 50), shot.id, middle.id, 0);
      expect(service.duplicateLayer(withDest, shot.id, tip.id, destId, 600, inheritedZero).layer.depth).toBe(0);
      const independent = setLayerDepthKey(k1, shot.id, tip.id, 1_000, 350);
      const independentCopy = service.duplicateLayer(withDest, shot.id, tip.id, destId, 600, independent);
      expect(independentCopy.layer.depthKeys).toEqual(independent.shots[0]!.layers.find(({ id }) => id === tip.id)?.depthKeys);

      // 3. ShotService.duplicate remaps all parentKeys[].parentLayerId; ShotService.setDuration rejects shrinking below parentKey.timeMs.
      const duplicatedShot = shots.duplicate(k3, shot.id).shots[1]!;
      const dupTip = duplicatedShot.layers.find(({ name }) => name === tip.name)!;
      const dupBase = duplicatedShot.layers.find(({ name }) => name === baseLayer.name)!;
      const dupMiddle = duplicatedShot.layers.find(({ name }) => name === middle.name)!;
      expect(dupTip.parentKeys?.map((k) => k.parentLayerId)).toEqual([dupBase.id, dupMiddle.id, dupBase.id]);
      expect(() => shots.setDuration(k3, shot.id, 500)).toThrow();

      // 4. setBackground / fillBackground clears parentKeys (protecting #1371).
      const asBg = service.setBackground(k3, shot.id, tip.id);
      const bgLayer = asBg.shots[0]!.layers.find(({ id }) => id === tip.id)!;
      expect(bgLayer.parentKeys).toBeUndefined();
      const staleBg = ProjectSchema.parse({
        ...asBg,
        shots: asBg.shots.map((s) => ({
          ...s,
          layers: s.layers.map((l) => l.id === tip.id ? { ...l, parentKeys: [{ timeMs: 250, parentLayerId: null }] } : l),
        })),
      });
      const refilled = service.fillBackground(staleBg, shot.id);
      expect(refilled.shots[0]!.layers.find(({ id }) => id === tip.id)?.parentKeys).toBeUndefined();
    });

    it('follows talking headGroupTransform for dynamic head attachments across dialogue projection, editor stage, product preview, and formal export (#1387)', () => {
      const data = characterPartAnimationFixture();
      const service = new LayerService();
      const dialogueId = randomUUID();
      const positioned = service.updatePosition(data.project, IDS.shot, IDS.layerAsset, { x: 500, y: 600 });
      const grandchild = service.duplicateLayer(positioned, IDS.shot, IDS.layerAsset);
      const positionedGrandchild = service.updatePosition(grandchild.project, IDS.shot, grandchild.layer.id, { x: 520, y: 610 });
      const withChain = service.setParent(positionedGrandchild, IDS.shot, grandchild.layer.id, IDS.layerAsset, 0);
      const characterVoiceId = withChain.characters.find(({ id }) => id === data.characterId)!.defaultVoiceProfileId;
      const baseProject = ProjectSchema.parse({
        ...withChain,
        characters: withChain.characters.map((character) =>
          character.id === data.characterId && character.mode === 'adaptive-parts'
            ? {
                ...character,
                headMotionBinding: { partIds: [data.imagePartId] },
                talkingHeadMotionIntensityPercent: 100,
              }
            : character,
        ),
        shots: withChain.shots.map((shot) =>
          shot.id === IDS.shot
            ? {
                ...shot,
                durationMs: 1_500,
                dialogues: [{
                  id: dialogueId,
                  characterId: data.characterId,
                  voiceProfileId: characterVoiceId,
                  text: '说话测试',
                  startMs: 0,
                  endMs: 1_000,
                  subtitleStyleId: shot.defaultSubtitleStyleId,
                }],
              }
            : shot,
        ),
      });

      const headTarget = { kind: 'character-part' as const, partId: data.imagePartId };
      // Dynamic head attachment at 250ms; NO layer in the shot has any static parentAttachment.
      const dynamicOnly = service.setParentKey(baseProject, IDS.shot, IDS.layerAsset, 250, data.layerId, { target: headTarget });
      expect(dynamicOnly.shots[0]!.layers.every((layer) => layer.parentAttachment === undefined)).toBe(true);

      // Equivalent static attachment created at the same 250ms boundary for reference.
      const staticRef = service.setParent(baseProject, IDS.shot, IDS.layerAsset, data.layerId, 250, headTarget);

      const projectedAt = (project: typeof baseProject, timeMs: number, activeId?: string | null) => {
        const shot = project.shots[0]!;
        return projectShotDialogueVisual(project, shot, evaluateShotAtTime(shot, timeMs, project), activeId);
      };
      const layerOf = (shot: ReturnType<typeof projectedAt>, id: string) => shot.layers.find((entry) => entry.id === id)!;

      // At 625ms: headGroupTransform is (-4, -4); dynamic attachment must move prop to (496, 596) matching static attachment & part matrix once.
      const dynamic625 = projectedAt(dynamicOnly, 625);
      const static625 = projectedAt(staticRef, 625);
      const char625 = layerOf(dynamic625, data.layerId);
      expect(char625.headGroupTransform?.translateX).toBeCloseTo(-4, 6);
      expect(char625.headGroupTransform?.translateY).toBeCloseTo(-4, 6);

      const dynamicPropWorld625 = evaluatedLayerWorldMatrix(layerOf(dynamic625, IDS.layerAsset));
      const staticPropWorld625 = evaluatedLayerWorldMatrix(layerOf(static625, IDS.layerAsset));
      expect(dynamicPropWorld625.tx).toBeCloseTo(496, 6);
      expect(dynamicPropWorld625.ty).toBeCloseTo(596, 6);
      expectMatrix(dynamicPropWorld625, staticPropWorld625);

      // Verify exact agreement with final part local matrix (proving head offset is applied exactly once, never doubled).
      const ownerLayer = dynamicOnly.shots[0]!.layers.find(({ id }) => id === data.layerId)!;
      const childLayer = dynamicOnly.shots[0]!.layers.find(({ id }) => id === IDS.layerAsset)!;
      const targetLocal625 = resolveLayerAttachmentLocalMatrix(dynamicOnly, ownerLayer, char625, headTarget)!;
      const expectedSpace625 = multiplyAffineMatrices(
        layerAttachmentWorldMatrix(char625, targetLocal625, char625.parentSpace),
        childLayer.parentKeys![0]!.parentSpaceOffset!,
      );
      expectMatrix(layerOf(dynamic625, IDS.layerAsset).parentSpace!, expectedSpace625);

      // Multi-level child chain (head -> prop -> grandchild) consumes the final head-shifted pose too.
      const dynamicGrandchildWorld625 = evaluatedLayerWorldMatrix(layerOf(dynamic625, grandchild.layer.id));
      expect(dynamicGrandchildWorld625.tx).toBeCloseTo(516, 6);
      expect(dynamicGrandchildWorld625.ty).toBeCloseTo(606, 6);
      expectMatrix(dynamicGrandchildWorld625, evaluatedLayerWorldMatrix(layerOf(static625, grandchild.layer.id)));

      // Editor stage, Product Preview, and formal export all produce the identical head-shifted pose at 625ms.
      const dynamicShot = dynamicOnly.shots[0]!;
      const editor625 = evaluateEditorCanvasShot(dynamicOnly, dynamicShot, 625, dialogueId);
      const preview625 = projectProductPreviewDialogue(dynamicOnly, dynamicShot, evaluateShotAtTime(dynamicShot, 625, dynamicOnly), dialogueId);
      const export625 = evaluateExportShotAtTime(dynamicOnly, dynamicShot, 625, dialogueId);
      for (const surface of [editor625, preview625, export625]) {
        expectMatrix(evaluatedLayerWorldMatrix(layerOf(surface, IDS.layerAsset)), dynamicPropWorld625);
        expectMatrix(evaluatedLayerWorldMatrix(layerOf(surface, grandchild.layer.id)), dynamicGrandchildWorld625);
      }

      // Before dynamic attachment (125ms, head is bobbing -4,-4): prop stays at (500, 600).
      const beforeAttach125 = projectedAt(dynamicOnly, 125);
      expect(layerOf(beforeAttach125, data.layerId).headGroupTransform?.translateX).toBeCloseTo(-4, 6);
      expect(evaluatedLayerWorldMatrix(layerOf(beforeAttach125, IDS.layerAsset)).tx).toBeCloseTo(500, 6);
      expect(evaluatedLayerWorldMatrix(layerOf(beforeAttach125, IDS.layerAsset)).ty).toBeCloseTo(600, 6);

      // After detaching at 750ms (head offset 0 at 750ms, +4,+4 at 875ms): detached prop does NOT continue following head bob.
      const withDetach = service.setParentKey(dynamicOnly, IDS.shot, IDS.layerAsset, 750, null);
      const afterDetach875 = projectedAt(withDetach, 875);
      expect(layerOf(afterDetach875, data.layerId).headGroupTransform?.translateX).toBeCloseTo(4, 6);
      expect(evaluatedLayerWorldMatrix(layerOf(afterDetach875, IDS.layerAsset)).tx).toBeCloseTo(500, 6);
      expect(evaluatedLayerWorldMatrix(layerOf(afterDetach875, IDS.layerAsset)).ty).toBeCloseTo(600, 6);

      // After switching at 750ms to non-head part: prop follows the new non-head part, not the speaking head bob.
      const withSwitch = service.setParentKey(dynamicOnly, IDS.shot, IDS.layerAsset, 750, data.layerId, {
        target: { kind: 'character-part', partId: data.graphicPartId },
      });
      const afterSwitch875 = projectedAt(withSwitch, 875);
      expect(evaluatedLayerWorldMatrix(layerOf(afterSwitch875, IDS.layerAsset)).tx).toBeCloseTo(500, 6);
      expect(evaluatedLayerWorldMatrix(layerOf(afterSwitch875, IDS.layerAsset)).ty).toBeCloseTo(600, 6);

      // Outside dialogue / no head motion: neutral (500, 600).
      const noHead1200 = projectedAt(dynamicOnly, 1_200);
      expect(layerOf(noHead1200, data.layerId).headGroupTransform).toBeUndefined();
      expect(evaluatedLayerWorldMatrix(layerOf(noHead1200, IDS.layerAsset)).tx).toBeCloseTo(500, 6);
      expect(evaluatedLayerWorldMatrix(layerOf(noHead1200, IDS.layerAsset)).ty).toBeCloseTo(600, 6);

      // Random seek order yields identical results to sequential evaluation.
      const seq = [125, 250, 625, 875].map((t) => evaluatedLayerWorldMatrix(layerOf(projectedAt(withDetach, t), IDS.layerAsset)));
      const rnd = [875, 125, 625, 250].map((t) => evaluatedLayerWorldMatrix(layerOf(projectedAt(withDetach, t), IDS.layerAsset)));
      expectMatrix(rnd[1]!, seq[0]!);
      expectMatrix(rnd[3]!, seq[1]!);
      expectMatrix(rnd[2]!, seq[2]!);
      expectMatrix(rnd[0]!, seq[3]!);
    });
  });
});
