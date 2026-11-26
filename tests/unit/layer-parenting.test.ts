import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  evaluateShotAtTime, evaluatedLayerWorldMatrix, layerPoseMatrix, LayerMotionService, LayerService, migrateProject, ProjectSchema, ShotService,
  type Layer, type TimelineEvent,
} from '../../src/domain';
import { multiplyAffineMatrices, type AffineMatrix2D } from '../../src/shared/affine-matrix';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { evaluateEditorCanvasShot } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { evaluateExportShotAtTime, selectExportDrawingLayers } from '../../src/export-renderer/evaluateExportShotAtTime';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';

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
});
