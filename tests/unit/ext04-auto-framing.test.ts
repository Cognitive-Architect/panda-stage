import { describe, expect, it } from 'vitest';
import {
  AUTO_FRAMING_PRESETS,
  cameraLayerTransform,
  evaluateSpeakerFocusCamera,
  evaluateShotAtTime,
  evaluatedLayerWorldMatrix,
  prepareShotCamera,
  prepareSpeakerFocusCamera,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  ProjectV45Schema,
  resolveShotAutoFraming,
  resolveSpeakerFocusCamera,
  setShotCameraAutoFraming,
  setShotCameraMode,
  ShotCameraV45Schema,
  ShotService,
  solveCameraCenterForWorldPoint,
  type Project,
  type Shot,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

function fixture(width = 1920, height = 1080): { project: Project; shot: Shot } {
  const shot = {
    id: 'shot',
    durationMs: 2_000,
    backgroundLayerId: null,
    dialogues: [],
    audioClips: [],
    timelineEvents: [],
    layers: [
      { id: 'a', source: { kind: 'character', characterId: 'A' }, x: 960, y: 540, visible: true },
      { id: 'b', source: { kind: 'character', characterId: 'B' }, x: 1400, y: 540, visible: true },
    ],
  } as unknown as Shot;
  const project = { width, height, characters: [], shots: [shot] } as unknown as Project;
  return { project, shot };
}

function dialogue(id: string, characterId: string, startMs: number, endMs: number) {
  return { id, characterId, startMs, endMs, text: id, subtitleStyleId: 'style' } as Shot['dialogues'][number];
}

function projectPoint(
  camera: ReturnType<typeof resolveSpeakerFocusCamera>,
  worldX: number,
  worldY: number,
  width: number,
  height: number,
  depth = 0,
  space: 'world' | 'screen' = 'world',
) {
  const layerTransform = cameraLayerTransform(camera, width, height, depth, space)!;
  return {
    x: layerTransform.x + (worldX - layerTransform.offsetX) * layerTransform.scaleX,
    y: layerTransform.y + (worldY - layerTransform.offsetY) * layerTransform.scaleY,
  };
}

describe('EXT-04 Auto-framing follow zoom & normalized screen target (u, v) (#1402)', () => {
  it('generalizes inverse projection for zero, near, and far depth across arbitrary (u, v) targets', () => {
    const cases = [
      { width: 1920, height: 1080, worldX: 960, worldY: 540, zoom: 1.5, depth: 0, u: 1 / 3, v: 0.5 },
      { width: 1920, height: 1080, worldX: 1100, worldY: 480, zoom: 2.0, depth: -300, u: 2 / 3, v: 0.4 },
      { width: 1920, height: 1080, worldX: 900, worldY: 600, zoom: 1.8, depth: 800, u: 0.35, v: 0.6 },
      { width: 1280, height: 720, worldX: 640, worldY: 360, zoom: 1.75, depth: -200, u: 1 / 3, v: 0.5 },
    ];
    for (const c of cases) {
      const solved = solveCameraCenterForWorldPoint(
        c.worldX,
        c.worldY,
        c.width,
        c.height,
        c.zoom,
        c.depth,
        'world',
        c.u,
        c.v,
      );
      expect(solved).not.toBeNull();
      const projected = projectPoint(
        { centerX: solved!.centerX, centerY: solved!.centerY, zoom: c.zoom },
        c.worldX,
        c.worldY,
        c.width,
        c.height,
        c.depth,
      );
      expect(projected.x).toBeCloseTo(c.u * c.width, 6);
      expect(projected.y).toBeCloseTo(c.v * c.height, 6);
    }

    // Screen-space and near-clipped planes return null.
    expect(solveCameraCenterForWorldPoint(960, 540, 1920, 1080, 1.5, 0, 'screen', 1 / 3, 0.5)).toBeNull();
    expect(solveCameraCenterForWorldPoint(960, 540, 1920, 1080, 2.0, -500, 'world', 1 / 3, 0.5)).toBeNull();
    expect(solveCameraCenterForWorldPoint(960, 540, 1920, 1080, 0, 0, 'world', 0.5, 0.5)).toBeNull();
  });

  it('maintains exact parity with legacy speaker-focus when using default autoFraming', () => {
    const legacy = fixture();
    legacy.shot.layers[0]!.x = 400;
    legacy.shot.layers[0]!.y = 500;
    legacy.shot.dialogues.push(dialogue('d1', 'A', 0, 800), dialogue('d2', 'B', 800, 1_600));

    const explicitDefault = fixture();
    explicitDefault.shot.layers[0]!.x = 400;
    explicitDefault.shot.layers[0]!.y = 500;
    explicitDefault.shot.dialogues.push(dialogue('d1', 'A', 0, 800), dialogue('d2', 'B', 800, 1_600));
    explicitDefault.shot.camera = {
      mode: 'speaker-focus',
      keys: [],
      autoFraming: { zoom: 1.5, targetU: 0.5, targetV: 0.5 },
    };

    const sampleTimes = [0, 125, 250, 500, 800, 925, 1_050, 1_700, 1_950];
    for (const t of sampleTimes) {
      expect(resolveSpeakerFocusCamera(explicitDefault.project, explicitDefault.shot, t)).toEqual(
        resolveSpeakerFocusCamera(legacy.project, legacy.shot, t),
      );
    }
  });

  it('places actors at left-third, right-third, and custom (u,v) with custom zoom across depths and parents', () => {
    // 1) Left-third preset at zoom 2.0 on depth=0
    const { project, shot } = fixture();
    shot.camera = {
      mode: 'speaker-focus',
      keys: [],
      autoFraming: { zoom: 2.0, ...AUTO_FRAMING_PRESETS['left-third'] },
    };
    shot.dialogues.push(dialogue('d1', 'A', 0, 1_000));
    const camLeft = resolveSpeakerFocusCamera(project, shot, 500);
    expect(camLeft.zoom).toBe(2.0);
    const projectedLeft = projectPoint(camLeft, 960, 540, 1920, 1080, 0);
    expect(projectedLeft.x).toBeCloseTo(1920 / 3, 6);
    expect(projectedLeft.y).toBeCloseTo(540, 6);

    // 2) Right-third preset with non-zero depth and parented actor without chasing Shake
    const parented = fixture();
    const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const pose = { scaleX: 1, scaleY: 1, rotationDeg: 0, flipX: false };
    Object.assign(parented.shot.layers[0]!, pose, {
      x: 960,
      y: 540,
      parentLayerId: 'carrier',
      parentSpaceOffset: { ...identity, tx: -960, ty: -540 },
    });
    parented.shot.layers.push({
      ...parented.shot.layers[0]!,
      id: 'carrier',
      source: { kind: 'control' },
      parentLayerId: undefined,
      parentSpaceOffset: undefined,
      depth: -250,
    });
    parented.shot.camera = {
      mode: 'speaker-focus',
      keys: [],
      autoFraming: { zoom: 1.6, ...AUTO_FRAMING_PRESETS['right-third'] },
    };
    parented.shot.dialogues.push(dialogue('d1', 'A', 0, 1_500));
    parented.shot.timelineEvents.push({
      id: 'move',
      layerId: 'carrier',
      type: 'move',
      startMs: 0,
      endMs: 1_000,
      from: { x: 900, y: 520 },
      to: { x: 1060, y: 560 },
      easing: 'linear',
    });
    const planNoShake = prepareSpeakerFocusCamera(parented.project, parented.shot);
    const camAt500 = evaluateSpeakerFocusCamera(planNoShake, 500);
    const evaluated = evaluateShotAtTime(parented.shot, 500, parented.project, { includeShake: false }).layers[0]!;
    const world = evaluatedLayerWorldMatrix(evaluated);
    const proj = projectPoint(camAt500, world.tx, world.ty, 1920, 1080, evaluated.effectiveDepth ?? 0);
    expect(proj.x).toBeCloseTo((2 / 3) * 1920, 6);
    expect(proj.y).toBeCloseTo(540, 6);

    // Adding Shake does not alter camera solve; random seek is deterministic.
    parented.shot.timelineEvents.push({
      id: 'shake',
      layerId: 'a',
      type: 'shake',
      startMs: 0,
      endMs: 1_000,
      amplitudeX: 60,
      amplitudeY: 40,
      frequencyHz: 1,
    });
    const planWithShake = prepareSpeakerFocusCamera(parented.project, parented.shot);
    expect(evaluateSpeakerFocusCamera(planWithShake, 500)).toEqual(camAt500);
    expect(evaluateSpeakerFocusCamera(planWithShake, 900)).toEqual(evaluateSpeakerFocusCamera(planNoShake, 900));
  });

  it('preserves stage clamp, near-clip fallback, HUD screen-space fallback, and output-resolution independence', () => {
    // Stage clamp when desired framing pushes camera outside stage bounds.
    const clamped = fixture();
    clamped.shot.layers[0]!.x = 100;
    clamped.shot.layers[0]!.y = 100;
    clamped.shot.camera = {
      mode: 'speaker-focus',
      keys: [],
      autoFraming: { zoom: 2.0, targetU: 0.8, targetV: 0.8 },
    };
    clamped.shot.dialogues.push(dialogue('d1', 'A', 0, 1_000));
    const clampedCam = resolveSpeakerFocusCamera(clamped.project, clamped.shot, 500);
    // At zoom=2.0 on 1920x1080, halfWidth=480, halfHeight=270.
    expect(clampedCam.centerX).toBe(480);
    expect(clampedCam.centerY).toBe(270);
    expect(clampedCam.zoom).toBe(2.0);

    // Near-clip fallback at higher zoom (F/z + d = 1000/2.5 - 400 = 0 < 10 -> full stage).
    const nearClipped = fixture();
    Object.assign(nearClipped.shot.layers[0]!, { depth: -400 });
    nearClipped.shot.camera = {
      mode: 'speaker-focus',
      keys: [],
      autoFraming: { zoom: 2.5, targetU: 1 / 3, targetV: 0.5 },
    };
    nearClipped.shot.dialogues.push(dialogue('d1', 'A', 0, 1_000));
    expect(resolveSpeakerFocusCamera(nearClipped.project, nearClipped.shot, 500)).toEqual({
      centerX: 960,
      centerY: 540,
      zoom: 1,
    });

    // Screen-space HUD actor still falls back to full stage.
    const hud = fixture();
    Object.assign(hud.shot.layers[0]!, { cameraSpace: 'screen' });
    hud.shot.camera = {
      mode: 'speaker-focus',
      keys: [],
      autoFraming: { zoom: 2.0, targetU: 1 / 3, targetV: 0.5 },
    };
    hud.shot.dialogues.push(dialogue('d1', 'A', 0, 1_000));
    expect(resolveSpeakerFocusCamera(hud.project, hud.shot, 500)).toEqual({
      centerX: 960,
      centerY: 540,
      zoom: 1,
    });

    // Output-resolution independence: normalized (u, v) lands identically on 1920x1080 and 1280x720.
    for (const [w, h] of [[1920, 1080], [1280, 720]] as const) {
      const res = fixture(w, h);
      res.shot.layers[0]!.x = w * 0.5;
      res.shot.layers[0]!.y = h * 0.5;
      res.shot.camera = {
        mode: 'speaker-focus',
        keys: [],
        autoFraming: { zoom: 1.8, targetU: 1 / 3, targetV: 0.4 },
      };
      res.shot.dialogues.push(dialogue('d1', 'A', 0, 1_000));
      const cam = resolveSpeakerFocusCamera(res.project, res.shot, 500);
      const p = projectPoint(cam, w * 0.5, h * 0.5, w, h, 0);
      expect(p.x / w).toBeCloseTo(1 / 3, 6);
      expect(p.y / h).toBeCloseTo(0.4, 6);
    }
  });

  it('isolates manual and hybrid override segments from autoFraming settings', () => {
    const { project, shot } = fixture();
    shot.dialogues.push(dialogue('d1', 'A', 0, 2_000));
    shot.camera = {
      mode: 'hybrid',
      keys: [
        { timeMs: 500, centerX: 960, centerY: 540, zoom: 1.2, rotationDeg: 15, interpolationToNext: 'linear' },
        { timeMs: 1_500, centerX: 960, centerY: 540, zoom: 1.2, rotationDeg: 15, interpolationToNext: 'linear' },
      ],
      overrides: [
        { id: 'ov-1', startMs: 500, endMs: 1_500, blendInMs: 0, blendOutMs: 0 },
      ],
      autoFraming: { zoom: 2.0, targetU: 1 / 3, targetV: 0.5 },
    };
    const sample = prepareShotCamera(project, shot, 'speaker-focus');
    // Outside override: follows autoFraming zoom=2.0
    expect(sample(300)?.zoom).toBe(2.0);
    // Inside override: purely manual pose, unaffected by autoFraming
    expect(sample(1_000)).toEqual({ centerX: 960, centerY: 540, zoom: 1.2, rotationDeg: 15 });

    // Pure manual mode is also unaffected by autoFraming
    shot.camera.mode = 'manual';
    const sampleManual = prepareShotCamera(project, shot, 'speaker-focus');
    expect(sampleManual(300)).toEqual({ centerX: 960, centerY: 540, zoom: 1.2, rotationDeg: 15 });
  });

  it('persists on schema v46 cleanly, preserves across mode switches, supports ShotService/reset/Undo-Redo, and is rejected by frozen v45', () => {
    const base = buildProjectWithAnimation();
    const shotService = new ShotService();

    const updated = shotService.setCameraAutoFraming(base, IDS.shot, {
      zoom: 2.2,
      targetU: 1 / 3,
      targetV: 0.45,
    });
    expect(updated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(resolveShotAutoFraming(updated.shots[0]!)).toEqual({
      zoom: 2.2,
      targetU: 1 / 3,
      targetV: 0.45,
    });

    // Mode switch preserves autoFraming
    const switched = setShotCameraMode(updated, IDS.shot, 'hybrid');
    expect(switched.shots[0]!.camera?.autoFraming).toEqual({
      zoom: 2.2,
      targetU: 1 / 3,
      targetV: 0.45,
    });

    // Save/reopen round-trip
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(switched)));
    expect(reopened.shots[0]!.camera?.autoFraming).toEqual({
      zoom: 2.2,
      targetU: 1 / 3,
      targetV: 0.45,
    });

    // Reset to default clears autoFraming cleanly
    const reset = setShotCameraAutoFraming(reopened, IDS.shot, undefined);
    expect(reset.shots[0]!.camera?.autoFraming).toBeUndefined();
    expect(resolveShotAutoFraming(reset.shots[0]!)).toEqual({
      zoom: 1.5,
      targetU: 0.5,
      targetV: 0.5,
    });

    // Frozen v45 reader rejects autoFraming
    expect(
      ShotCameraV45Schema.safeParse({
        mode: 'speaker-focus',
        keys: [],
        autoFraming: { zoom: 2.0 },
      }).success,
    ).toBe(false);
    expect(
      ProjectV45Schema.safeParse({
        ...updated,
        schemaVersion: 45,
      }).success,
    ).toBe(false);

    // Undo / Redo through EditorProjectStore
    const store = new EditorProjectStore();
    store.open('D:/PandaStage-Acceptance/ext04-test', base);
    store.updateProject(updated, '调整自动构图');
    expect(store.getSnapshot()!.project.shots[0]!.camera?.autoFraming?.zoom).toBe(2.2);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()!.project.shots[0]!.camera?.autoFraming).toBeUndefined();
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()!.project.shots[0]!.camera?.autoFraming?.zoom).toBe(2.2);
  });
});
