import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  addShotCameraOverride, cameraLayerTransform, cameraWorldTransform, compareCameraDrawingLayers,
  evaluateManualCamera, evaluateShotCameraOverrideWeight, evaluateSpeakerFocusCamera,
  migrateProject, moveShotCameraKey, moveShotCameraOverride, prepareShotCamera, prepareSpeakerFocusCamera,
  PROJECT_SCHEMA_VERSION, removeShotCameraKey, removeShotCameraOverride, resolveLayerCameraTransform,
  evaluateShotAtTime, setLayerDepth, setLayerDepthKey, moveLayerDepthKey, removeLayerDepthKey,
  setShotCameraKey, setShotCameraMode, ShotService, updateShotCameraOverride,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';

describe('Shot camera', () => {
  it('projects depth relative to the rest camera and clips only near world planes', () => {
    const rest = { centerX: 960, centerY: 540, zoom: 1, rotationDeg: 0 };
    const view = { centerX: 1060, centerY: 540, zoom: 2, rotationDeg: 35 };
    for (const depth of [-400, 0, 1000]) {
      expect(cameraLayerTransform(rest, 1920, 1080, depth, 'world')).toEqual(cameraWorldTransform(rest, 1920, 1080));
    }
    expect(cameraLayerTransform(view, 1920, 1080, 0, 'world')).toEqual(cameraWorldTransform(view, 1920, 1080));
    expect(cameraLayerTransform(view, 1920, 1080, -400, 'world')).toMatchObject({ scaleX: 6, rotation: -35 });
    expect(cameraLayerTransform(view, 1920, 1080, 1000, 'world')).toMatchObject({ scaleX: 4 / 3, offsetX: 1010, rotation: -35 });
    expect(cameraLayerTransform(view, 1920, 1080, -500, 'world')).toBeNull();
    expect(cameraLayerTransform(view, 1920, 1080, -500, 'screen')).toEqual(cameraWorldTransform(rest, 1920, 1080));
  });

  it('migrates v43 camera and parenting without inventing depths or camera spaces', () => {
    const project = migrateProject(demo);
    const shot = project.shots[0]!;
    const staged = setShotCameraKey(project, shot.id, 0, { zoom: 2 });
    const migrated = migrateProject({ ...staged, schemaVersion: 43 });
    expect(migrated.shots).toEqual(staged.shots);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('authors depth on a locked background, holds the initial depth and retains the last key value', () => {
    const base = migrateProject(demo);
    const shotId = base.shots[0]!.id;
    const layerId = base.shots[0]!.backgroundLayerId!;
    const depthAt = (project: typeof base, time: number) => evaluateShotAtTime(project.shots[0]!, time, project)
      .layers.find(({ id }) => id === layerId)?.effectiveDepth;
    const still = setLayerDepth(base, shotId, layerId, 700);
    const keyed = setLayerDepthKey(still, shotId, layerId, 1_000, -100);
    expect(depthAt(keyed, 0)).toBe(700);
    expect(depthAt(keyed, 500)).toBe(300);
    const moved = moveLayerDepthKey(keyed, shotId, layerId, 1_000, 1_500);
    expect(depthAt(moved, 750)).toBe(300);
    const single = removeLayerDepthKey(moved, shotId, layerId, 0);
    const removed = removeLayerDepthKey(single, shotId, layerId, 1_500);
    expect(depthAt(migrateProject(JSON.parse(JSON.stringify(removed))), 0)).toBe(-100);
  });

  it('uses the formal 0 ms pose in camera view while retaining the world editing pose', () => {
    const project = migrateProject(demo);
    const shot = project.shots[0]!;
    const layer = shot.layers.find(({ id }) => id !== shot.backgroundLayerId)!;
    shot.timelineEvents = [
      { id: randomUUID(), layerId: layer.id, type: 'opacity', startMs: 0, endMs: 1000, from: 0, to: 1, easing: 'linear' },
      { id: randomUUID(), layerId: layer.id, type: 'move', startMs: 0, endMs: 1000, from: { x: 25, y: 80 }, to: { x: 500, y: 80 }, easing: 'linear' },
    ];
    const input = { project, shot, currentTimeMs: 0, readyAssetIds: new Set(project.assets.map(({ id }) => id)), previousVisuals: new Map() };
    const world = buildEditorTemporalCanvasModel(input);
    const camera = buildEditorTemporalCanvasModel({ ...input, cameraViewActive: true });
    const formal = evaluateExportShotAtTime(project, shot, 0);
    expect(camera.evaluatedShot).toEqual(formal);
    expect(camera.stageModel.layers.find(({ layer: item }) => item.id === layer.id)?.render).toMatchObject({ x: 25, opacity: 0 });
    expect(camera.directEditingEnabled).toBe(false);
    expect(world.evaluatedShot.layers.find(({ id }) => id === layer.id)).toMatchObject({ x: layer.x, opacity: layer.opacity });
    expect(world.directEditingEnabled).toBe(true);
  });
  it('keeps old fallback modes and round-trips a three-key move with actor data intact', () => {
    const original = migrateProject(demo);
    const old = migrateProject({ ...original, schemaVersion: 42 });
    const shot = old.shots[0]!;
    expect(shot.camera).toBeUndefined();
    expect(prepareShotCamera(old, shot, 'static')(0)).toBeUndefined();
    expect(prepareShotCamera(old, shot, 'speaker-focus')(0)).toMatchObject({ zoom: 1 });

    const enabled = setShotCameraMode(old, shot.id, 'manual');
    expect(evaluateManualCamera(enabled.shots[0]!, 80)).toEqual({
      centerX: 960, centerY: 540, zoom: 1, rotationDeg: 0,
    });
    let project = setShotCameraKey(enabled, shot.id, 0, {
      zoom: 0.75, rotationDeg: 350, interpolationToNext: 'ease-in',
    });
    project = setShotCameraKey(project, shot.id, 1_000, {
      centerX: 400, centerY: 450, zoom: 2, rotationDeg: 370,
    });
    project = setShotCameraKey(project, shot.id, 2_000, {
      centerX: 2_100, centerY: 600, zoom: 1.25, rotationDeg: 1090,
    });
    const saved = migrateProject(JSON.parse(JSON.stringify(project)));
    const reopened = saved.shots[0]!;
    const camera = prepareShotCamera(saved, reopened, 'speaker-focus');
    expect(camera(-10)).toEqual({ centerX: 960, centerY: 540, zoom: 0.75, rotationDeg: 350 });
    expect(camera(500)).toEqual({ centerX: 820, centerY: 517.5, zoom: 1.0625, rotationDeg: 355 });
    expect(camera(1_500)).toMatchObject({ centerX: 1250, rotationDeg: 730 });
    expect(camera(3_000)).toEqual(camera(2_000));
    expect(camera(500)).toEqual(evaluateManualCamera(reopened, 500));
    expect(cameraWorldTransform(camera(1_500), 1920, 1080)).toMatchObject({
      x: 960, y: 540, offsetX: 1250, scaleX: 1.625, rotation: -10,
    });
    expect(reopened.layers).toEqual(shot.layers);
    expect(() => setShotCameraKey(project, shot.id, 1_000, { zoom: 0 })).toThrow();
    expect(() => new ShotService().setDuration(project, shot.id, 1_800)).toThrow();
  });

  it('splits a nonlinear segment at the playhead and replays edits with project history', () => {
    const original = migrateProject(demo);
    const id = original.shots[0]!.id;
    const from = setShotCameraKey(original, id, 0, {
      zoom: 1,
      curveToNext: { bezier: { x1: 0.2, y1: 0, x2: 0.7, y2: 1 } },
    });
    const full = setShotCameraKey(from, id, 2_000, { zoom: 3, rotationDeg: 720 });
    const split = setShotCameraKey(full, id, 750);
    const moved = moveShotCameraKey(split, id, 750, 1000);
    const originalKey = split.shots[0]!.camera!.keys[1]!;
    expect(moved.shots[0]!.camera!.keys[1]).toEqual({ ...originalKey, timeMs: 1000 });
    expect(moved.shots[0]!.camera!.keys[0]).toEqual(split.shots[0]!.camera!.keys[0]);
    expect(moveShotCameraKey(moved, id, 1000, 2000)).toBe(moved);
    for (const time of [0, 250, 749, 750, 751, 1_500, 2_000]) {
      const before = evaluateManualCamera(full.shots[0]!, time);
      const after = evaluateManualCamera(split.shots[0]!, time);
      expect(after.zoom).toBeCloseTo(before.zoom, 7);
      expect(after.rotationDeg).toBeCloseTo(before.rotationDeg, 7);
    }
    const store = new EditorProjectStore();
    store.open('D:/shot-camera.pandastage', full);
    store.updateProject(split, 'Insert camera key');
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()?.project.shots[0]?.camera).toEqual(full.shots[0]!.camera);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()?.project.shots[0]?.camera).toEqual(split.shots[0]!.camera);
    expect(removeShotCameraKey(split, id, 750).shots[0]?.camera?.keys.map(({ timeMs }) => timeMs)).toEqual([0, 2_000]);
  });

  function buildTwoSpeakerProject(): { project: Project; shotId: string; actorAId: string; actorBId: string; hudId: string } {
    const base = migrateProject(demo);
    const shot = base.shots[0]!;
    const styleId = base.subtitleStyles[0]!.id;
    const baseCharacter = base.characters[0]!;
    const baseVoice = base.voiceProfiles[0]!;
    const charAId = randomUUID();
    const charBId = randomUUID();
    const voiceAId = randomUUID();
    const voiceBId = randomUUID();
    const charA = { ...baseCharacter, id: charAId, name: 'Actor A', defaultVoiceProfileId: voiceAId };
    const charB = { ...baseCharacter, id: charBId, name: 'Actor B', defaultVoiceProfileId: voiceBId };
    const voiceA = { ...baseVoice, id: voiceAId, characterId: charAId, name: 'Voice A' };
    const voiceB = { ...baseVoice, id: voiceBId, characterId: charBId, name: 'Voice B' };
    const actorAId = randomUUID();
    const actorBId = randomUUID();
    const hudId = randomUUID();
    const templateLayer = shot.layers.find((layer) => layer.id !== shot.backgroundLayerId)!;
    const project: Project = migrateProject({
      ...base,
      characters: [...base.characters, charA, charB],
      voiceProfiles: [...base.voiceProfiles, voiceA, voiceB],
      shots: [{
        ...shot,
        durationMs: 4_000,
        layers: [
          ...shot.layers.filter((layer) => layer.id === shot.backgroundLayerId),
          {
            ...templateLayer,
            id: actorAId,
            name: 'Speaker A',
            source: { kind: 'character', characterId: charA.id, expressionId: charA.defaultExpressionId },
            x: 400,
            y: 500,
            visible: true,
            zIndex: 10,
          },
          {
            ...templateLayer,
            id: actorBId,
            name: 'Speaker B',
            source: { kind: 'character', characterId: charB.id, expressionId: charB.defaultExpressionId },
            x: 1_500,
            y: 500,
            visible: true,
            zIndex: 11,
          },
          {
            ...templateLayer,
            id: hudId,
            name: 'HUD Badge',
            cameraSpace: 'screen',
            x: 120,
            y: 80,
            visible: true,
            zIndex: 2,
          },
        ],
        dialogues: [
          { id: randomUUID(), characterId: charA.id, voiceProfileId: voiceAId, startMs: 0, endMs: 1_500, text: 'A speaks', subtitleStyleId: styleId },
          { id: randomUUID(), characterId: charB.id, voiceProfileId: voiceBId, startMs: 2_500, endMs: 4_000, text: 'B speaks', subtitleStyleId: styleId },
        ],
        timelineEvents: [],
      }],
    });
    return { project, shotId: shot.id, actorAId, actorBId, hudId };
  }

  it('blends auto speaker A -> manual pan/zoom/rotate -> auto speaker B continuously and supports 0ms hard cuts', () => {
    const { project: base, shotId } = buildTwoSpeakerProject();
    let project = setShotCameraMode(base, shotId, 'hybrid');

    // Add manual override [1000, 3000) with 250ms blend in/out.
    const overrideId = randomUUID();
    project = addShotCameraOverride(project, shotId, {
      id: overrideId,
      startMs: 1_000,
      endMs: 3_000,
      blendInMs: 250,
      blendOutMs: 250,
    });
    // Boundary keys were sampled from auto camera so creation does not snap.
    const autoPlan = prepareSpeakerFocusCamera(base, base.shots[0]!);
    const createdKeys = project.shots[0]!.camera!.keys;
    expect(createdKeys.map((key) => key.timeMs)).toEqual([1_000, 3_000]);
    expect(createdKeys[0]!.centerX).toBeCloseTo(evaluateSpeakerFocusCamera(autoPlan, 1_000).centerX, 6);
    expect(createdKeys[1]!.centerX).toBeCloseTo(evaluateSpeakerFocusCamera(autoPlan, 3_000).centerX, 6);

    // Author manual wide pan/zoom<1/rotation in the middle of the override.
    project = setShotCameraKey(project, shotId, 2_000, {
      centerX: 960,
      centerY: 540,
      zoom: 0.75,
      rotationDeg: 20,
    });
    expect(project.shots[0]!.camera?.mode).toBe('hybrid');

    const camera = prepareShotCamera(project, project.shots[0]!, 'static');
    // Before override: pure auto following A.
    expect(camera(500)).toEqual(evaluateSpeakerFocusCamera(autoPlan, 500));
    // At exact startMs with 250ms blendIn: weight === 0 -> continuous with auto.
    expect(camera(1_000)).toEqual(evaluateSpeakerFocusCamera(autoPlan, 1_000));
    // Mid blend-in (1125ms): weight === 0.5 -> strictly between auto and manual.
    const blendInMid = camera(1_125)!;
    expect(blendInMid.zoom).toBeGreaterThan(0);
    expect(blendInMid.zoom).not.toEqual(evaluateSpeakerFocusCamera(autoPlan, 1_125).zoom);
    // Inside full manual control (2000ms): exact manual pose including zoom < 1 (no auto clamp!).
    expect(camera(2_000)).toEqual({ centerX: 960, centerY: 540, zoom: 0.75, rotationDeg: 20 });
    // After override (3000ms, 3500ms): pure auto following B.
    expect(camera(3_000)).toEqual(evaluateSpeakerFocusCamera(autoPlan, 3_000));
    expect(camera(3_500)).toEqual(evaluateSpeakerFocusCamera(autoPlan, 3_500));
    // Continuity at blend-out boundary (2999ms close to 3000ms).
    expect(Math.abs(camera(2_999)!.centerX - camera(3_000)!.centerX)).toBeLessThan(1);

    // Explicit 0ms hard cut at both ends.
    const hardCut = updateShotCameraOverride(project, shotId, overrideId, { blendInMs: 0, blendOutMs: 0 });
    const hardCamera = prepareShotCamera(hardCut, hardCut.shots[0]!, 'static');
    expect(hardCamera(999)).toEqual(evaluateSpeakerFocusCamera(autoPlan, 999));
    expect(hardCamera(1_000)).toEqual(evaluateManualCamera(hardCut.shots[0]!, 1_000));
    expect(hardCamera(2_999)).toEqual(evaluateManualCamera(hardCut.shots[0]!, 2_999));
    expect(hardCamera(3_000)).toEqual(evaluateSpeakerFocusCamera(autoPlan, 3_000));
  });

  it('compresses blends on short intervals, supports adjacent & multiple intervals, and rejects invalid edits', () => {
    const { project: base, shotId } = buildTwoSpeakerProject();
    // Short interval [500, 700) with 250ms in + 250ms out -> compressed to 100ms in + 100ms out.
    const shortOv = [{ id: randomUUID(), startMs: 500, endMs: 700, blendInMs: 250, blendOutMs: 250 }];
    expect(evaluateShotCameraOverrideWeight(shortOv, 499)).toBe(0);
    expect(evaluateShotCameraOverrideWeight(shortOv, 500)).toBe(0);
    expect(evaluateShotCameraOverrideWeight(shortOv, 550)).toBeCloseTo(0.5, 6);
    expect(evaluateShotCameraOverrideWeight(shortOv, 600)).toBe(1);
    expect(evaluateShotCameraOverrideWeight(shortOv, 650)).toBeCloseTo(0.5, 6);
    expect(evaluateShotCameraOverrideWeight(shortOv, 700)).toBe(0);

    // Multiple non-overlapping & adjacent intervals with clear half-open boundary ownership.
    const firstId = randomUUID();
    const secondId = randomUUID();
    const thirdId = randomUUID();
    let project = addShotCameraOverride(base, shotId, {
      id: firstId, startMs: 500, endMs: 1_500, blendInMs: 0, blendOutMs: 0,
    });
    project = addShotCameraOverride(project, shotId, {
      id: secondId, startMs: 1_500, endMs: 2_500, blendInMs: 250, blendOutMs: 250,
    });
    project = addShotCameraOverride(project, shotId, {
      id: thirdId, startMs: 3_000, endMs: 3_500, blendInMs: 0, blendOutMs: 0,
    });
    const overrides = project.shots[0]!.camera!.overrides!;
    // At 1499ms: owned by first (blendOut=0 -> w=1). At 1500ms: owned by second (blendIn=250 -> w=0).
    expect(evaluateShotCameraOverrideWeight(overrides, 1_499)).toBe(1);
    expect(evaluateShotCameraOverrideWeight(overrides, 1_500)).toBe(0);
    expect(evaluateShotCameraOverrideWeight(overrides, 1_625)).toBeCloseTo(0.5, 6);
    expect(evaluateShotCameraOverrideWeight(overrides, 2_750)).toBe(0);
    expect(evaluateShotCameraOverrideWeight(overrides, 3_250)).toBe(1);

    // Reject overlapping and out-of-range intervals cleanly.
    expect(() => addShotCameraOverride(project, shotId, { startMs: 1_250, endMs: 2_000 })).toThrow();
    expect(() => addShotCameraOverride(project, shotId, { startMs: -100, endMs: 250 })).toThrow();
    expect(() => addShotCameraOverride(project, shotId, { startMs: 3_500, endMs: 4_500 })).toThrow();
    expect(() => addShotCameraOverride(project, shotId, { startMs: 2_500, endMs: 2_500 })).toThrow();

    // Move & remove override.
    const moved = moveShotCameraOverride(project, shotId, thirdId, 3_250);
    expect(moved.shots[0]!.camera!.overrides!.find((ov) => ov.id === thirdId)).toMatchObject({
      startMs: 3_250, endMs: 3_750,
    });
    expect(() => moveShotCameraOverride(moved, shotId, thirdId, 3_750)).toThrow();
    // ShotService.setDuration rejects shrinking below override endMs (3750).
    expect(() => new ShotService().setDuration(moved, shotId, 3_500)).toThrow();
    const removed = removeShotCameraOverride(moved, shotId, thirdId);
    expect(removed.shots[0]!.camera!.overrides!.map((ov) => ov.id)).toEqual([firstId, secondId]);
    expect(removed.shots[0]!.camera!.mode).toBe('hybrid');
  });

  it('uses shortest-angle handover at blend boundaries while preserving explicit multi-turn rotation inside manual control', () => {
    const { project: base, shotId } = buildTwoSpeakerProject();
    let project = setShotCameraMode(base, shotId, 'hybrid');
    // Pre-existing manual key at 1000ms should NOT be overwritten when creating an override at [1000, 3000).
    project = setShotCameraKey(project, shotId, 1_000, { centerX: 960, centerY: 540, zoom: 1, rotationDeg: 350 });
    project = setShotCameraKey(project, shotId, 1_500, { centerX: 960, centerY: 540, zoom: 0.8, rotationDeg: 350 });
    project = setShotCameraKey(project, shotId, 2_500, { centerX: 960, centerY: 540, zoom: 1.2, rotationDeg: 1_070 });
    project = setShotCameraKey(project, shotId, 3_000, { centerX: 960, centerY: 540, zoom: 1, rotationDeg: 1_070 });
    project = addShotCameraOverride(project, shotId, { startMs: 1_000, endMs: 3_000, blendInMs: 500, blendOutMs: 500 });

    // Existing boundary key at 1000ms was preserved (not overwritten).
    expect(project.shots[0]!.camera!.keys.find((key) => key.timeMs === 1_000)?.rotationDeg).toBe(350);

    const camera = prepareShotCamera(project, project.shots[0]!, 'static');
    // During blend-in (1250ms, w=0.5): shortest angle from 0° to 350° is -10°, so midpoint is -5° (NOT +175°!).
    expect(camera(1_250)!.rotationDeg).toBeCloseTo(-5, 6);
    // Inside full manual control (1500..2500ms, w=1): multi-turn 350° -> 1070° passes through 710° at 2000ms!
    expect(camera(2_000)!.rotationDeg).toBeCloseTo(710, 6);
    expect(camera(2_000)!.zoom).toBeCloseTo(1, 6);
    // During blend-out (2750ms, w=0.5): 1070° ≡ -10° (mod 360), so shortest handover back to 0° is -5° (NOT +535°!).
    expect(camera(2_750)!.rotationDeg).toBeCloseTo(-5, 6);

    // Key move & remove preserve hybrid mode and overrides.
    const movedKey = moveShotCameraKey(project, shotId, 2_500, 2_250);
    expect(movedKey.shots[0]!.camera?.mode).toBe('hybrid');
    expect(movedKey.shots[0]!.camera?.overrides?.length).toBe(1);
    const removedKey = removeShotCameraKey(movedKey, shotId, 2_250);
    expect(removedKey.shots[0]!.camera?.mode).toBe('hybrid');
    expect(removedKey.shots[0]!.camera?.overrides?.length).toBe(1);
  });

  it.each([1, -1])('keeps compressed blend rotation continuous across equivalent angle seams (direction %s)', (direction) => {
    const { project: base, shotId } = buildTwoSpeakerProject();
    let project = setShotCameraMode(base, shotId, 'hybrid');
    project = setShotCameraKey(project, shotId, 1_000, { rotationDeg: direction * -180 });
    project = setShotCameraKey(project, shotId, 2_000, { rotationDeg: direction * 1_260 });
    project = addShotCameraOverride(project, shotId, {
      startMs: 1_000, endMs: 2_000, blendInMs: 750, blendOutMs: 750,
    });
    project = addShotCameraOverride(project, shotId, {
      startMs: 2_000, endMs: 2_500, blendInMs: 0, blendOutMs: 0,
    });
    const camera = prepareShotCamera(project, project.shots[0]!, 'static');
    const rotationVector = (timeMs: number) => {
      const radians = cameraWorldTransform(camera(timeMs), project.width, project.height).rotation * Math.PI / 180;
      return [Math.cos(radians), Math.sin(radians)] as const;
    };
    const samples = [1_250, 1_500, 1_750];
    const ordered = samples.map(rotationVector);
    for (const [index, time] of samples.entries()) {
      const before = rotationVector(time - 1);
      const after = rotationVector(time + 1);
      const expected = ordered[index]!;
      for (const sample of [before, after]) {
        expect(Math.hypot(sample[0] - expected[0], sample[1] - expected[1])).toBeLessThan(0.08);
      }
      expect(rotationVector(time)).toEqual(ordered[index]);
    }
    expect(camera(1_500)?.rotationDeg).toBe(direction * 540);
    expect(camera(2_000)?.rotationDeg).toBe(direction * 1_260);
  });

  it('handles inherited non-zero depth moving speaker, screen HUD, auto fallback, random seek, save/reopen, and Undo/Redo in hybrid mode', () => {
    const { project: base, shotId, actorAId, hudId } = buildTwoSpeakerProject();
    const shot = base.shots[0]!;
    const carrierId = randomUUID();
    const actorA = shot.layers.find((layer) => layer.id === actorAId)!;
    const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    let project: Project = migrateProject({
      ...base,
      shots: [{
        ...shot,
        layers: [
          ...shot.layers.map((layer) => layer.id === actorAId
            ? { ...layer, x: 960, y: 540, parentLayerId: carrierId, parentSpaceOffset: { ...identity, tx: -960, ty: -540 } }
            : layer),
          {
            ...actorA,
            id: carrierId,
            name: 'Carrier',
            source: { kind: 'control' },
            x: 800,
            y: 500,
            depth: -400,
            zIndex: 9,
          },
        ],
        timelineEvents: [
          {
            id: randomUUID(),
            layerId: carrierId,
            type: 'move',
            startMs: 0,
            endMs: 1_500,
            from: { x: 800, y: 500 },
            to: { x: 1_100, y: 500 },
            easing: 'linear',
          },
        ],
      }],
    });

    const overrideId = randomUUID();
    project = addShotCameraOverride(project, shotId, {
      id: overrideId,
      startMs: 1_500,
      endMs: 2_500,
      blendInMs: 250,
      blendOutMs: 250,
    });
    const edited = setShotCameraKey(project, shotId, 2_000, { centerX: 960, centerY: 540, zoom: 0.85, rotationDeg: 15 });

    // Save/reopen round-trip preserves v46 hybrid camera and overrides.
    const reopened = migrateProject(JSON.parse(JSON.stringify(edited)));
    expect(reopened.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(reopened.shots[0]!.camera).toEqual(edited.shots[0]!.camera);

    // Random seek === sequential playback.
    const plan = prepareShotCamera(reopened, reopened.shots[0]!, 'static');
    const sampleTimes = [0, 250, 750, 1_500, 1_625, 2_000, 2_375, 2_500, 3_250, 3_999];
    const sequential = sampleTimes.map((t) => plan(t));
    const randomOrder = [3_999, 2_000, 0, 2_375, 750, 1_625, 3_250, 1_500, 2_500, 250];
    const randomResults = new Map(randomOrder.map((t) => [t, plan(t)]));
    for (const [index, timeMs] of sampleTimes.entries()) {
      expect(randomResults.get(timeMs)).toEqual(sequential[index]);
    }

    // Screen HUD remains identity projection and sorts above world layers at all times.
    const evalAtManual = evaluateShotAtTime(reopened.shots[0]!, 2_000, reopened);
    const hudLayer = evalAtManual.layers.find((layer) => layer.id === hudId)!;
    const actorLayer = evalAtManual.layers.find((layer) => layer.id === actorAId)!;
    expect(actorLayer.effectiveDepth).toBe(-400);
    expect(resolveLayerCameraTransform(hudLayer, plan(2_000), 1920, 1080)).toEqual(
      cameraWorldTransform(undefined, 1920, 1080),
    );
    expect(compareCameraDrawingLayers(hudLayer, actorLayer)).toBeGreaterThan(0);

    // Auto fallback outside override when no speaker is active (1500..2500 gap -> check after removing override).
    const noOverride = removeShotCameraOverride(reopened, shotId, overrideId);
    expect(prepareShotCamera(noOverride, noOverride.shots[0]!, 'static')(2_000)).toEqual({
      centerX: 960, centerY: 540, zoom: 1,
    });

    // Undo/Redo through EditorProjectStore.
    const store = new EditorProjectStore();
    store.open('D:/hybrid-camera.pandastage', base);
    store.updateProject(project, 'Add hybrid override');
    store.updateProject(edited, 'Edit hybrid manual key');
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()?.project.shots[0]?.camera).toEqual(project.shots[0]!.camera);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()?.project.shots[0]?.camera).toEqual(base.shots[0]!.camera);
    expect(store.redo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()?.project.shots[0]?.camera).toEqual(edited.shots[0]!.camera);
  });
});
