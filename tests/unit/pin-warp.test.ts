import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  LayerSchema,
  LayerService,
  PinWarpAuthoringSchema,
  ProjectSchema,
  addPinWarpPoseAtTime,
  buildPinWarpGrid,
  createPinWarp,
  evaluatePinWarpMesh,
  evaluateShotAtTime,
  migrateProject,
  pinWarpRectForImage,
  removePinWarpPoseAtTime,
  reseedPinWarpPins,
  resolvePinWarpPoseAtTime,
  seedPinWarpPoints,
  setPinWarpMeshDensity,
  setPinWarpPinAtTime,
  validatePinWarpForShot,
  type PinWarp,
  type PinWarpPoint,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';

const IMAGE_RECT = pinWarpRectForImage(400, 300)!;
const MESH = { columns: 3, rows: 2 };

/** Real editor store + LayerStore/LayerService, mirroring the layer-store suite. */
function harness(initialProject: Project = migrateProject(exampleProject)) {
  const editor = new EditorProjectStore();
  editor.open('D:\\pin-warp.pandastage', initialProject);
  const listeners = new Set<() => void>();
  let shotId = initialProject.shots[0]!.id;
  const shots = {
    getCurrentShotId: () => shotId,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select: (nextShotId: string) => {
      shotId = nextShotId;
      listeners.forEach((listener) => listener());
    },
  };
  let id = 0;
  const service = new LayerService({
    createId: () => `f1460000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => new Date('2026-11-28T00:00:00.000Z'),
  });
  const selection = new LayerSelectionStore(editor, shots);
  return {
    project: initialProject,
    editor,
    shots,
    service,
    selection,
    layers: new LayerStore(editor, shots, service, selection),
  };
}

/** Adds one ordinary bitmap Layer from the demo background asset and returns its id. */
function addBitmapLayer(input: ReturnType<typeof harness>): string {
  const layer = input.layers.createFromAsset({
    version: 2,
    assetId: input.project.assets[0]!.id,
    type: 'asset-image',
    position: { x: 960, y: 540 },
  });
  return layer.id;
}

function snapshotProject(input: ReturnType<typeof harness>): Project {
  const snapshot = input.editor.getSnapshot();
  if (!snapshot) throw new Error('missing snapshot');
  return snapshot.project;
}

function findLayer(project: Project, layerId: string) {
  const layer = project.shots[0]!.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`missing layer ${layerId}`);
  return layer;
}

function displacement(from: PinWarpPoint, to: PinWarpPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

describe('pin-warp deterministic triangulated mesh', () => {
  it('builds a stable row-major grid with alternating cell diagonals', () => {
    const grid = buildPinWarpGrid(IMAGE_RECT, MESH)!;
    expect(grid.restVertices).toHaveLength((MESH.columns + 1) * (MESH.rows + 1));
    expect(grid.uvPerVertex).toHaveLength(grid.restVertices.length);
    expect(grid.triangles).toHaveLength(MESH.columns * MESH.rows * 2);
    // Same input -> identical output (stable order, no hidden state).
    expect(buildPinWarpGrid(IMAGE_RECT, MESH)).toEqual(grid);
    expect(grid.restVertices[0]).toEqual({ x: -200, y: -150 });
    // Row-major: vertices 0..3 are the first row.
    expect(grid.restVertices[3]).toEqual({ x: 200, y: -150 });
    expect(grid.restVertices[4]).toEqual({ x: -200, y: 0 });
    // Cell (0,0) falls top-left -> bottom-right; cell (1,0) rises.
    expect(grid.triangles[0]).toEqual([0, 1, 5]);
    expect(grid.triangles[1]).toEqual([0, 5, 4]);
    expect(grid.triangles[2]).toEqual([1, 2, 5]);
    expect(grid.triangles[3]).toEqual([2, 6, 5]);
    // UVs are image pixels, the rect's top-left is the origin.
    expect(grid.uvPerVertex[0]).toEqual({ x: 0, y: 0 });
    expect(grid.uvPerVertex[grid.uvPerVertex.length - 1]).toEqual({
      x: 400,
      y: 300,
    });
  });

  it('evaluates the same pins to byte-identical vertices/triangles every call', () => {
    const restPins = seedPinWarpPoints(IMAGE_RECT);
    const pins = restPins.map((pin, index) =>
      index === 1 ? { x: pin.x, y: pin.y + 60 } : pin,
    );
    const first = evaluatePinWarpMesh({ restPins, pins, mesh: MESH, rect: IMAGE_RECT });
    const second = evaluatePinWarpMesh({ restPins, pins, mesh: MESH, rect: IMAGE_RECT });
    expect(first.status).toBe('valid');
    expect(second).toEqual(first);
    if (first.status !== 'valid') return;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('rigid MLS is the identity when every pin is at rest', () => {
    const restPins = seedPinWarpPoints(IMAGE_RECT);
    const result = evaluatePinWarpMesh({
      restPins,
      pins: restPins.map((pin) => ({ ...pin })),
      mesh: MESH,
      rect: IMAGE_RECT,
    });
    expect(result.status).toBe('valid');
    if (result.status !== 'valid') return;
    expect(result.mesh.vertices).toEqual(result.mesh.restVertices);
    expect(result.mesh.flippedTriangleCount).toBe(0);
  });

  it('moves nearby vertices for one dragged pin and leaves far ones ~fixed', () => {
    const restPins = seedPinWarpPoints(IMAGE_RECT);
    const drag = { dx: 0, dy: 60 };
    const pins = restPins.map((pin, index) =>
      index === 1 ? { x: pin.x + drag.dx, y: pin.y + drag.dy } : pin,
    );
    const result = evaluatePinWarpMesh({ restPins, pins, mesh: MESH, rect: IMAGE_RECT });
    expect(result.status).toBe('valid');
    if (result.status !== 'valid') return;
    const { restVertices, vertices } = result.mesh;
    // Vertex (1) is near the dragged center-top pin: it must visibly move.
    expect(displacement(restVertices[1]!, vertices[1]!)).toBeGreaterThan(10);
    // Vertex (8) sits exactly on the far bottom-left pin: the deformation
    // interpolates that pin, so it must not move at all.
    expect(vertices[8]).toEqual(restVertices[8]);
    // A far, non-pin vertex only picks up a small rigid share of the drag.
    expect(displacement(restVertices[6]!, vertices[6]!)).toBeLessThan(15);
  });

  it('reports invalid meshes instead of NaN for degenerate input', () => {
    const restPins = seedPinWarpPoints(IMAGE_RECT);
    expect(
      evaluatePinWarpMesh({
        restPins,
        pins: restPins.slice(0, 3),
        mesh: MESH,
        rect: IMAGE_RECT,
      }),
    ).toEqual({ status: 'invalid', reason: 'pin-count-mismatch' });
    expect(
      evaluatePinWarpMesh({
        restPins: [restPins[0]!, { ...restPins[0]! }, restPins[2]!],
        pins: [restPins[0]!, { ...restPins[0]! }, restPins[2]!],
        mesh: MESH,
        rect: IMAGE_RECT,
      }),
    ).toEqual({ status: 'invalid', reason: 'duplicate-pins' });
    expect(
      evaluatePinWarpMesh({
        restPins,
        pins: restPins.map(() => ({ x: 0, y: 0 })),
        mesh: MESH,
        rect: IMAGE_RECT,
      }),
    ).toEqual({ status: 'invalid', reason: 'degenerate-triangle' });
    expect(
      evaluatePinWarpMesh({
        restPins,
        pins: restPins.map((pin) => ({ x: pin.x, y: pin.y })),
        mesh: MESH,
        rect: { ...IMAGE_RECT, width: 0 },
      }),
    ).toEqual({ status: 'invalid', reason: 'invalid-local-rect' });
    expect(
      evaluatePinWarpMesh({
        restPins,
        pins: restPins.map((pin, index) =>
          index === 1 ? { x: Number.NaN, y: pin.y } : pin,
        ),
        mesh: MESH,
        rect: IMAGE_RECT,
      }),
    ).toEqual({ status: 'invalid', reason: 'non-finite' });
  });
});

describe('pin-warp pose interpolation', () => {
  const restPins = seedPinWarpPoints(IMAGE_RECT);
  const draggedPins = restPins.map((pin, index) =>
    index === 1 ? { x: pin.x + 40, y: pin.y + 80 } : pin,
  );

  it('is exact at authored times, linear between, and holds outside', () => {
    const pinWarp: PinWarp = {
      mesh: MESH,
      restPins,
      poses: [
        { timeMs: 125, pins: restPins.map((pin) => ({ ...pin })) },
        { timeMs: 500, pins: draggedPins.map((pin) => ({ ...pin })) },
      ],
    };
    const atFirst = resolvePinWarpPoseAtTime(pinWarp, 125);
    expect(atFirst).toMatchObject({ status: 'valid', mode: 'exact' });
    if (atFirst.status === 'valid') expect(atFirst.pins).toEqual(restPins);

    const atLast = resolvePinWarpPoseAtTime(pinWarp, 500);
    expect(atLast).toMatchObject({ status: 'valid', mode: 'exact' });
    if (atLast.status === 'valid') expect(atLast.pins).toEqual(draggedPins);

    const between = resolvePinWarpPoseAtTime(pinWarp, 312);
    expect(between).toMatchObject({ status: 'valid', mode: 'between' });
    if (between.status === 'valid') {
      const progress = (312 - 125) / (500 - 125);
      between.pins.forEach((pin, index) => {
        expect(pin.x).toBeCloseTo(
          restPins[index]!.x + (draggedPins[index]!.x - restPins[index]!.x) * progress,
          12,
        );
        expect(pin.y).toBeCloseTo(
          restPins[index]!.y + (draggedPins[index]!.y - restPins[index]!.y) * progress,
          12,
        );
      });
    }

    const before = resolvePinWarpPoseAtTime(pinWarp, 0);
    expect(before).toMatchObject({ status: 'valid', mode: 'hold-before' });
    if (before.status === 'valid') expect(before.pins).toEqual(restPins);

    const after = resolvePinWarpPoseAtTime(pinWarp, 2_900);
    expect(after).toMatchObject({ status: 'valid', mode: 'hold-after' });
    if (after.status === 'valid') expect(after.pins).toEqual(draggedPins);

    // Deterministic: the same query always resolves the same pose.
    expect(resolvePinWarpPoseAtTime(pinWarp, 312)).toEqual(between);
  });

  it('reports unordered poses and pin-count mismatches as invalid', () => {
    expect(
      resolvePinWarpPoseAtTime(
        {
          mesh: MESH,
          restPins,
          poses: [
            { timeMs: 500, pins: restPins },
            { timeMs: 125, pins: restPins },
          ],
        },
        0,
      ),
    ).toEqual({ status: 'invalid', reason: 'pose-times-not-ascending' });
    expect(
      resolvePinWarpPoseAtTime(
        {
          mesh: MESH,
          restPins,
          poses: [{ timeMs: 0, pins: restPins.slice(0, 2) }],
        },
        0,
      ),
    ).toEqual({ status: 'invalid', reason: 'pin-count-mismatch' });
  });

  it('auto-keys a pose when a pin is written at a new time', () => {
    const pinWarp: PinWarp = {
      mesh: MESH,
      restPins,
      poses: [{ timeMs: 0, pins: restPins }],
    };
    const next = setPinWarpPinAtTime({
      pinWarp,
      timeMs: 500,
      pinIndex: 1,
      point: { x: 0, y: 60 },
    });
    expect(next.poses).toHaveLength(2);
    expect(next.poses.map((pose) => pose.timeMs)).toEqual([0, 500]);
    expect(next.poses[1]!.pins[1]).toEqual({ x: 0, y: 60 });
    // An unchanged write at the same time is idempotent.
    expect(
      setPinWarpPinAtTime({
        pinWarp: next,
        timeMs: 500,
        pinIndex: 1,
        point: { x: 0, y: 60 },
      }),
    ).toEqual(next);
    // Pose editing helpers are pure and keep ascending order.
    const added = addPinWarpPoseAtTime(next, 250);
    expect(added.poses.map((pose) => pose.timeMs)).toEqual([0, 250, 500]);
    const removed = removePinWarpPoseAtTime(added, 250);
    expect(removed.poses.map((pose) => pose.timeMs)).toEqual([0, 500]);
    expect(() => removePinWarpPoseAtTime({ ...pinWarp, poses: [pinWarp.poses[0]!] }, 0)).toThrow();
    expect(setPinWarpMeshDensity(next, { columns: 6, rows: 5 }).mesh).toEqual({
      columns: 6,
      rows: 5,
    });
    expect(reseedPinWarpPins(next, IMAGE_RECT).poses[1]!.pins).toEqual(
      seedPinWarpPoints(IMAGE_RECT),
    );
  });

  it('accepts the authoring contract only for on-grid, in-shot, matching poses', () => {
    const valid = createPinWarp(IMAGE_RECT, 0);
    expect(PinWarpAuthoringSchema.safeParse(valid).success).toBe(true);
    expect(validatePinWarpForShot(valid, 3_000)).toEqual([]);
    expect(
      PinWarpAuthoringSchema.safeParse({
        ...valid,
        poses: [{ timeMs: 0, pins: valid.restPins.slice(1) }],
      }).success,
    ).toBe(false);
    const offGrid = createPinWarp(IMAGE_RECT, 0);
    offGrid.poses.push({ timeMs: 1, pins: valid.restPins });
    expect(
      validatePinWarpForShot(offGrid, 3_000).map((issue) => issue.message),
    ).toContain('姿态时间必须落在项目帧网格上。');
    const outOfShot = createPinWarp(IMAGE_RECT, 0);
    outOfShot.poses.push({ timeMs: 3_500, pins: valid.restPins });
    expect(
      validatePinWarpForShot(outOfShot, 3_000).map((issue) => issue.message),
    ).toContain('姿态时间超出镜头时长。');
  });
});

describe('pin-warp evaluation and authoring on the formal project', () => {
  it('flows one evaluated mesh per Layer frame through evaluateShotAtTime', () => {
    const input = harness();
    const layerId = addBitmapLayer(input);
    input.layers.bindPinWarp(layerId, 0);
    const project = snapshotProject(input);
    const shot = project.shots[0]!;

    const atRest = evaluateShotAtTime(shot, 0, project).layers.find(
      (layer) => layer.id === layerId,
    );
    expect(atRest?.pinWarp?.status).toBe('valid');
    if (atRest?.pinWarp?.status !== 'valid') return;
    expect(atRest.pinWarp.mode).toBe('exact');
    expect(atRest.pinWarp.mesh.vertices).toEqual(
      atRest.pinWarp.mesh.restVertices,
    );

    const layer = findLayer(project, layerId);
    expect(layer.pinWarp?.restPins).toHaveLength(6);
    expect(layer.pinWarp?.poses).toHaveLength(1);
  });

  it('keeps Layers without pinWarp byte-identical (no new evaluated field)', () => {
    const project = migrateProject(exampleProject);
    const evaluated = evaluateShotAtTime(project.shots[0]!, 0, project);
    for (const layer of evaluated.layers) {
      expect(Object.hasOwn(layer, 'pinWarp')).toBe(false);
    }
    expect(JSON.stringify(evaluated)).not.toContain('pinWarp');
  });

  it('degrades locally to the un-warped image for invalid or unsupported warp data', () => {
    const input = harness();
    const layerId = addBitmapLayer(input);
    input.layers.bindPinWarp(layerId, 0);
    const project = snapshotProject(input);
    const shot = project.shots[0]!;
    const layer = findLayer(project, layerId);
    expect(layer.pinWarp).toBeDefined();

    // The load-tolerant reader accepts semantically broken data; the formal
    // evaluation reports `invalid` so renderers keep the plain image path.
    const brokenProject = ProjectSchema.parse({
      ...project,
      shots: [
        {
          ...shot,
          layers: shot.layers.map((entry) =>
            entry.id === layerId
              ? {
                  ...entry,
                  pinWarp: {
                    ...layer.pinWarp!,
                    poses: [
                      {
                        timeMs: 0,
                        pins: layer.pinWarp!.restPins.slice(0, 3),
                      },
                    ],
                  },
                }
              : entry,
          ),
        },
      ],
    });
    const brokenShot = brokenProject.shots[0]!;
    const evaluated = evaluateShotAtTime(brokenShot, 0, brokenProject);
    const broken = evaluated.layers.find((entry) => entry.id === layerId);
    expect(broken?.pinWarp).toEqual({
      status: 'invalid',
      reason: 'pin-count-mismatch',
    });
    // Other Layers keep their exact pre-change evaluation.
    const control = evaluateShotAtTime(shot, 0, project);
    for (const entry of evaluated.layers.filter((candidate) => candidate.id !== layerId)) {
      expect(entry).toEqual(control.layers.find((candidate) => candidate.id === entry.id));
    }

    // Non-bitmap Layers also degrade instead of throwing.
    const characterLayer = shot.layers.find((entry) => entry.source.kind === 'character')!;
    const unsupported = ProjectSchema.parse({
      ...project,
      shots: [
        {
          ...shot,
          layers: shot.layers.map((entry) =>
            entry.id === characterLayer.id
              ? { ...entry, pinWarp: layer.pinWarp }
              : entry,
          ),
        },
      ],
    });
    const unsupportedEvaluated = evaluateShotAtTime(
      unsupported.shots[0]!,
      0,
      unsupported,
    ).layers.find((entry) => entry.id === characterLayer.id);
    expect(unsupportedEvaluated?.pinWarp).toEqual({
      status: 'invalid',
      reason: 'unsupported-layer',
    });

    // LayerSchema itself accepts the additive field on a normal Layer.
    expect(LayerSchema.safeParse(findLayer(project, layerId)).success).toBe(true);
  });
});

describe('pin-warp editor store: independence, seek, persistence, undo', () => {
  it('keeps two instances with different pins independent', () => {
    const input = harness();
    const firstId = addBitmapLayer(input);
    const secondId = addBitmapLayer(input);
    input.layers.bindPinWarp(firstId, 0);
    input.layers.bindPinWarp(secondId, 0);
    const project = snapshotProject(input);

    input.layers.setPinWarpPin(firstId, 500, 1, { x: 0, y: 120 });
    const nextProject = snapshotProject(input);
    const evaluated = evaluateShotAtTime(nextProject.shots[0]!, 500, nextProject);
    const first = evaluated.layers.find((layer) => layer.id === firstId)!;
    const second = evaluated.layers.find((layer) => layer.id === secondId)!;
    expect(first.pinWarp?.status).toBe('valid');
    expect(second.pinWarp?.status).toBe('valid');
    if (first.pinWarp?.status !== 'valid' || second.pinWarp?.status !== 'valid') return;
    expect(first.pinWarp.pins[1]).toEqual({ x: 0, y: 120 });
    // The other instance keeps its authored rest pose.
    const control = evaluateShotAtTime(project.shots[0]!, 500, project).layers.find(
      (layer) => layer.id === secondId,
    )!;
    if (control.pinWarp?.status !== 'valid') return;
    expect(second.pinWarp).toEqual(control.pinWarp);
  });

  it('is stable across random seeks and never accumulates deformation', () => {
    const input = harness();
    const layerId = addBitmapLayer(input);
    input.layers.bindPinWarp(layerId, 0);
    input.layers.setPinWarpPin(layerId, 500, 1, { x: 0, y: 120 });
    input.layers.setPinWarpPin(layerId, 1_000, 1, { x: 0, y: -120 });
    const project = snapshotProject(input);
    const shot = project.shots[0]!;
    const times = [0, 125, 250, 417, 500, 750, 958, 1_000, 1_500, 2_500, 3_000];
    const direct = new Map(
      times.map((timeMs) => [
        timeMs,
        evaluateShotAtTime(shot, timeMs, project).layers.find(
          (layer) => layer.id === layerId,
        )?.pinWarp,
      ]),
    );
    // Evaluate in a different (random) order; every result must be identical.
    for (const timeMs of [...times].reverse()) {
      const again = evaluateShotAtTime(shot, timeMs, project).layers.find(
        (layer) => layer.id === layerId,
      )?.pinWarp;
      expect(again).toEqual(direct.get(timeMs));
    }
    // Resting frame keeps the identity mesh; only the authored pose moves.
    const atZero = direct.get(0);
    if (atZero?.status !== 'valid') throw new Error('expected valid warp');
    expect(atZero.mesh.vertices).toEqual(atZero.mesh.restVertices);
  });

  it('reproduces the evaluated mesh after save/reopen', () => {
    const input = harness();
    const layerId = addBitmapLayer(input);
    input.layers.bindPinWarp(layerId, 0);
    input.layers.setPinWarpPin(layerId, 500, 1, { x: 0, y: 120 });
    const saved = snapshotProject(input);
    const reopened = migrateProject(JSON.parse(JSON.stringify(saved)));
    const before = evaluateShotAtTime(saved.shots[0]!, 500, saved).layers.find(
      (layer) => layer.id === layerId,
    )?.pinWarp;
    const after = evaluateShotAtTime(
      reopened.shots[0]!,
      500,
      reopened,
    ).layers.find((layer) => layer.id === layerId)?.pinWarp;
    expect(after).toEqual(before);
    expect(findLayer(reopened, layerId).pinWarp).toEqual(
      findLayer(saved, layerId).pinWarp,
    );
  });

  it('commits one pin drag as exactly one undo entry, and no-op drags write nothing', () => {
    const input = harness();
    const layerId = addBitmapLayer(input);
    input.layers.bindPinWarp(layerId, 0);
    const binding = input.editor.getSnapshot()!;
    let notifications = 0;
    const unsubscribe = input.editor.subscribe(() => {
      notifications += 1;
    });

    input.layers.setPinWarpPin(layerId, 500, 1, { x: 0, y: 120 });
    expect(notifications).toBe(1);
    expect(input.editor.getSnapshot()!.revision).toBe(binding.revision + 1);
    const draggedProject = snapshotProject(input);

    // Writing the same pin value again is a no-op: no history entry.
    input.layers.setPinWarpPin(layerId, 500, 1, { x: 0, y: 120 });
    expect(notifications).toBe(1);
    expect(input.editor.getSnapshot()!.revision).toBe(binding.revision + 1);

    expect(input.editor.undo()).toBe(true);
    // Undo replays the previous Project snapshot and advances the live revision.
    expect(input.editor.getSnapshot()!.project).toEqual(binding.project);
    expect(notifications).toBe(2);
    expect(input.editor.redo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(draggedProject);
    expect(notifications).toBe(3);
    unsubscribe();
  });

  it('rejects authoring on unsupported Layers and out-of-range density', () => {
    const input = harness();
    const shot = input.project.shots[0]!;
    const characterLayer = shot.layers.find((layer) => layer.source.kind === 'character')!;
    expect(() => input.layers.bindPinWarp(characterLayer.id, 0)).toThrow(
      '只有普通位图图层支持控制点变形。',
    );
    const layerId = addBitmapLayer(input);
    input.layers.bindPinWarp(layerId, 0);
    expect(() =>
      input.layers.setPinWarpMeshDensity(layerId, { columns: 0, rows: 3 }),
    ).toThrow();
    expect(() =>
      input.layers.setPinWarpMeshDensity(layerId, { columns: 25, rows: 3 }),
    ).toThrow();
  });
});
