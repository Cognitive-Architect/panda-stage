import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  evaluateShotAtTime, evaluatedLayerWorldMatrix, layerPoseMatrix, LayerService, migrateProject, ProjectSchema, ShotService,
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
    const source = mode === 'bound' ? bound : service.setParent(bound, shot.id, tip.id, null, 500);
    const sourceLayer = source.shots[0]!.layers.find(({ id }) => id === tip.id)!;
    expect(sourceLayer.parentSpaceOffset).toBeDefined();
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
    for (const timeMs of [0, 1000]) {
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
