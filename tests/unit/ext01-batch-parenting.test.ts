import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  evaluateShotAtTime,
  evaluatedLayerWorldMatrix,
  LayerMotionService,
  LayerService,
  migrateProject,
  ProjectSchema,
  ShotService,
  validBatchLayerParentTargets,
  type Layer,
  type TimelineEvent,
} from '../../src/domain';
import type { AffineMatrix2D } from '../../src/shared/affine-matrix';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';

function expectMatrix(actual: AffineMatrix2D, expected: AffineMatrix2D) {
  for (const key of Object.keys(expected) as (keyof AffineMatrix2D)[]) {
    expect(actual[key]).toBeCloseTo(expected[key], 7);
  }
}

function createBatchFixture() {
  const base = migrateProject(demo);
  const asset = base.assets.find(({ kind }) => kind === 'image')!;
  const makeLayer = (name: string, zIndex: number, x: number, y: number, overrides: Partial<Layer> = {}): Layer => ({
    id: randomUUID(),
    source: { kind: 'asset', assetId: asset.id },
    anchor: 'center',
    x,
    y,
    zIndex,
    name,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    locked: false,
    visible: true,
    flipX: false,
    ...overrides,
  });

  const bg = makeLayer('正式背景', 0, 960, 540, { locked: true });
  const chassis = makeLayer('车身', 1, 600, 500, { scaleX: 1.5, scaleY: 0.8, rotationDeg: 18 });
  const wheel = makeLayer('车轮', 2, 680, 540, { rotationDeg: 30, depth: 120 });
  const prop = makeLayer('道具', 3, 760, 480, { scaleX: 0.9, scaleY: 1.1 });
  const fx = makeLayer('特效', 4, 820, 460, { opacity: 0.6 });
  const other = makeLayer('外部父层', 5, 1320, 520, { scaleX: 1.25, rotationDeg: -15 });
  const lockedLayer = makeLayer('锁定图层', 6, 400, 300, { locked: true });

  const timelineEvents: TimelineEvent[] = [
    { id: randomUUID(), layerId: chassis.id, type: 'move', startMs: 0, endMs: 1000, from: { x: 600, y: 500 }, to: { x: 860, y: 620 }, easing: 'linear' },
    { id: randomUUID(), layerId: wheel.id, type: 'move', startMs: 0, endMs: 1000, from: { x: 680, y: 540 }, to: { x: 740, y: 580 }, easing: 'linear' },
  ];

  const shot = {
    ...base.shots[0]!,
    layers: [bg, chassis, wheel, prop, fx, other, lockedLayer],
    backgroundLayerId: bg.id,
    dialogues: [],
    audioClips: [],
    timelineEvents,
  };
  return {
    project: ProjectSchema.parse({ ...base, shots: [shot] }),
    shotId: shot.id,
    bg,
    chassis,
    wheel,
    prop,
    fx,
    other,
    lockedLayer,
  };
}

describe('EXT-01 batch parenting and atomic controller creation', () => {
  it('binds multiple selected layers to one parent/controller in ONE Undo transaction while preserving world poses & zIndex', () => {
    const { project, shotId, wheel, prop, fx } = createBatchFixture();
    const editorStore = new EditorProjectStore();
    editorStore.open('D:/ext01-batch.pandastage', project);
    const localShotStore = new ShotStore(editorStore, new ShotService());
    localShotStore.select(shotId);
    const localSelection = new LayerSelectionStore(editorStore, localShotStore);
    const service = new LayerService();
    const localLayerStore = new LayerStore(editorStore, localShotStore, service, localSelection);

    const timeMs = 500;
    const worldBefore = (layerId: string) =>
      evaluatedLayerWorldMatrix(
        evaluateShotAtTime(editorStore.getSnapshot()!.project.shots[0]!, timeMs, editorStore.getSnapshot()!.project)
          .layers.find((l) => l.id === layerId)!,
      );
    const preWheel = worldBefore(wheel.id);
    const preProp = worldBefore(prop.id);
    const preFx = worldBefore(fx.id);

    // Create empty controller AND bind 3 layers in ONE atomic transaction
    const revBefore = editorStore.getSnapshot()!.revision;
    const controller = localLayerStore.createControllerAndBindLayers([wheel.id, prop.id, fx.id], timeMs);
    expect(editorStore.getSnapshot()!.revision).toBe(revBefore + 1);
    expect(controller.source).toEqual({ kind: 'control' });

    const boundProject = editorStore.getSnapshot()!.project;
    for (const [id, preWorld, expectedZ] of [
      [wheel.id, preWheel, wheel.zIndex],
      [prop.id, preProp, prop.zIndex],
      [fx.id, preFx, fx.zIndex],
    ] as const) {
      const layer = boundProject.shots[0]!.layers.find((l) => l.id === id)!;
      expect(layer.parentLayerId).toBe(controller.id);
      expect(layer.zIndex).toBe(expectedZ);
      expectMatrix(worldBefore(id), preWorld);
    }

    // Moving the controller moves all bound children while preserving local motion
    const moved = new LayerMotionService().applyTransform(
      boundProject,
      { shotId, layerId: controller.id, timeMs: 750, autoKey: true },
      { x: 1160, y: 640, rotationDeg: 25 },
    );
    const movedShot = moved.shots[0]!;
    expect(
      evaluatedLayerWorldMatrix(evaluateShotAtTime(movedShot, 750, moved).layers.find((l) => l.id === prop.id)!).tx,
    ).not.toBeCloseTo(preProp.tx);

    // Batch detach in ONE Undo step preserves poses & depth
    const revBeforeDetach = editorStore.getSnapshot()!.revision;
    localLayerStore.batchDetachParent([wheel.id, prop.id, fx.id], timeMs);
    expect(editorStore.getSnapshot()!.revision).toBe(revBeforeDetach + 1);
    expectMatrix(worldBefore(wheel.id), preWheel);
    expectMatrix(worldBefore(prop.id), preProp);
    expectMatrix(worldBefore(fx.id), preFx);
    expect(editorStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === wheel.id)?.depth).toBe(120);

    // Undo detach -> bound again; Undo create+bind -> original project (controller gone)
    expect(editorStore.undo()).toBe(true);
    expect(editorStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === wheel.id)?.parentLayerId).toBe(controller.id);
    expect(editorStore.undo()).toBe(true);
    expect(editorStore.getSnapshot()!.project.shots[0]!.layers.some((l) => l.id === controller.id)).toBe(false);
    expect(editorStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === wheel.id)?.parentLayerId).toBeUndefined();

    // Redo create+bind -> restored in one step
    expect(editorStore.redo()).toBe(true);
    expect(editorStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === fx.id)?.parentLayerId).toBe(controller.id);

    // Save/reopen roundtrip
    const reopened = migrateProject(JSON.parse(JSON.stringify(editorStore.getSnapshot()!.project)));
    expect(reopened.shots[0]!.layers.find((l) => l.id === prop.id)?.parentLayerId).toBe(controller.id);

    localSelection.dispose();
    localShotStore.dispose();
  });

  it('captures ALL pre-edit world poses from the SAME snapshot when a parent-child pair is selected together', () => {
    const { project, shotId, chassis, wheel, other } = createBatchFixture();
    const service = new LayerService();
    const timeMs = 500;

    // First bind wheel -> chassis so { chassis, wheel } is an active parent-child pair
    const paired = service.setParent(project, shotId, wheel.id, chassis.id, 0);
    const worldAt = (proj: typeof paired, layerId: string) =>
      evaluatedLayerWorldMatrix(
        evaluateShotAtTime(proj.shots[0]!, timeMs, proj).layers.find((l) => l.id === layerId)!,
      );
    const preChassis = worldAt(paired, chassis.id);
    const preWheel = worldAt(paired, wheel.id);

    // Batch-bind BOTH chassis and wheel to `other`
    const rebound = service.batchSetParent(paired, shotId, [chassis.id, wheel.id], other.id, timeMs);
    expect(rebound.shots[0]!.layers.find((l) => l.id === chassis.id)?.parentLayerId).toBe(other.id);
    expect(rebound.shots[0]!.layers.find((l) => l.id === wheel.id)?.parentLayerId).toBe(other.id);
    expectMatrix(worldAt(rebound, chassis.id), preChassis);
    expectMatrix(worldAt(rebound, wheel.id), preWheel);

    // Also test batch-detaching the parent-child pair directly from `paired`
    const detached = service.batchDetachParent(paired, shotId, [chassis.id, wheel.id], timeMs);
    expect(detached.shots[0]!.layers.find((l) => l.id === chassis.id)?.parentLayerId).toBeUndefined();
    expect(detached.shots[0]!.layers.find((l) => l.id === wheel.id)?.parentLayerId).toBeUndefined();
    expectMatrix(worldAt(detached, chassis.id), preChassis);
    expectMatrix(worldAt(detached, wheel.id), preWheel);
  });

  it('atomically rejects invalid batches (self-bind, cycle, locked, background, singular) with zero partial commits', () => {
    const { project, shotId, bg, chassis, wheel, prop, other, lockedLayer } = createBatchFixture();
    const service = new LayerService();

    // Self-binding forbidden
    expect(() => service.batchSetParent(project, shotId, [wheel.id, prop.id], wheel.id, 0)).toThrow();
    expect(validBatchLayerParentTargets(project.shots[0]!, [wheel.id, prop.id]).some((l) => l.id === wheel.id)).toBe(false);

    // Cycle in final graph forbidden: other -> wheel, then try batch-binding [wheel, prop] to other
    const withChild = service.setParent(project, shotId, other.id, wheel.id, 0);
    expect(() => service.batchSetParent(withChild, shotId, [wheel.id, prop.id], other.id, 0)).toThrow();
    expect(validBatchLayerParentTargets(withChild.shots[0]!, [wheel.id, prop.id]).some((l) => l.id === other.id)).toBe(false);

    // Locked layer in batch rejects entire transaction
    expect(() => service.batchSetParent(project, shotId, [wheel.id, lockedLayer.id], other.id, 0)).toThrow();
    expect(() => service.createControllerAndBindLayers(project, shotId, [wheel.id, lockedLayer.id], 0)).toThrow();

    // Background layer in batch rejects entire transaction
    expect(() => service.batchSetParent(project, shotId, [wheel.id, bg.id], other.id, 0)).toThrow();

    // Non-invertible parent matrix rejects entire transaction
    const singular = ProjectSchema.parse({
      ...project,
      shots: [{
        ...project.shots[0]!,
        layers: project.shots[0]!.layers.map((l) =>
          l.id === chassis.id ? { ...l, parentSpaceOffset: { a: 0, b: 0, c: 0, d: 1, tx: 0, ty: 0 } } : l,
        ),
      }],
    });
    expect(() => service.batchSetParent(singular, shotId, [wheel.id, prop.id], chassis.id, 0)).toThrow();
  });

  it('preserves future dynamic parentKeys handoff segments when batch-updating static base binding', () => {
    const { project, shotId, chassis, wheel, prop, other } = createBatchFixture();
    const service = new LayerService();
    const withDynamic = service.setParentKey(project, shotId, wheel.id, 600, chassis.id);
    const originalKeys = withDynamic.shots[0]!.layers.find((l) => l.id === wheel.id)!.parentKeys!;
    expect(originalKeys).toHaveLength(1);

    const batchBound = service.batchSetParent(withDynamic, shotId, [wheel.id, prop.id], other.id, 200);
    const updatedWheel = batchBound.shots[0]!.layers.find((l) => l.id === wheel.id)!;
    expect(updatedWheel.parentLayerId).toBe(other.id);
    expect(updatedWheel.parentKeys).toEqual(originalKeys);
  });
});
