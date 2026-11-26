import { describe, expect, it } from 'vitest';
import {
  cameraLayerTransform,
  evaluateSpeakerFocusCamera,
  evaluateShotAtTime,
  evaluatedLayerWorldMatrix,
  prepareSpeakerFocusCamera,
  resolveSpeakerFocusCamera,
  type Project,
  type Shot,
} from '../../src/domain';

function fixture(): { project: Project; shot: Shot } {
  const shot = {
    id: 'shot', durationMs: 2000, backgroundLayerId: null,
    dialogues: [], audioClips: [], timelineEvents: [],
    layers: [
      { id: 'a', source: { kind: 'character', characterId: 'A' }, x: 400, y: 500, visible: true },
      { id: 'b', source: { kind: 'character', characterId: 'B' }, x: 1500, y: 500, visible: true },
    ],
  } as unknown as Shot;
  const project = { width: 1920, height: 1080, characters: [], shots: [shot] } as unknown as Project;
  return { project, shot };
}

function dialogue(id: string, characterId: string, startMs: number, endMs: number) {
  return { id, characterId, startMs, endMs, text: id, subtitleStyleId: 'style' } as Shot['dialogues'][number];
}

describe('Speaker Focus Camera', () => {
  it('defaults to full stage and focuses a text-only Dialogue at 1.5x after 250ms', () => {
    const { project, shot } = fixture();
    expect(resolveSpeakerFocusCamera(project, shot, 500)).toEqual({ centerX: 960, centerY: 540, zoom: 1 });
    shot.dialogues.push(dialogue('a-dialogue', 'A', 0, 600));
    expect(resolveSpeakerFocusCamera(project, shot, 0)).toEqual({ centerX: 960, centerY: 540, zoom: 1 });
    expect(resolveSpeakerFocusCamera(project, shot, 125)).toEqual({ centerX: 800, centerY: 520, zoom: 1.25 });
    expect(resolveSpeakerFocusCamera(project, shot, 250)).toEqual({ centerX: 640, centerY: 500, zoom: 1.5 });
    expect(resolveSpeakerFocusCamera(project, shot, 850)).toEqual({ centerX: 960, centerY: 540, zoom: 1 });
  });

  it('falls back for missing, hidden, or duplicate occurrences', () => {
    const { project, shot } = fixture();
    shot.dialogues.push(dialogue('a-dialogue', 'A', 0, 1000));
    shot.layers[0]!.visible = false;
    expect(resolveSpeakerFocusCamera(project, shot, 500).zoom).toBe(1);
    shot.layers[0]!.visible = true;
    shot.layers.push({ ...shot.layers[0]!, id: 'a-copy' });
    expect(resolveSpeakerFocusCamera(project, shot, 500).zoom).toBe(1);
    shot.layers.pop();
    shot.dialogues[0]!.characterId = 'missing';
    expect(resolveSpeakerFocusCamera(project, shot, 500).zoom).toBe(1);
  });

  it('follows main Position but not temporary Shake and clamps near edges', () => {
    const { project, shot } = fixture();
    shot.dialogues.push(dialogue('a-dialogue', 'A', 0, 1000));
    shot.timelineEvents.push({ id: 'move', layerId: 'a', type: 'move', startMs: 0, endMs: 500, from: { x: 400, y: 500 }, to: { x: 0, y: 0 }, easing: 'linear' });
    const beforeShake = resolveSpeakerFocusCamera(project, shot, 500);
    expect(beforeShake).toEqual({ centerX: 640, centerY: 360, zoom: 1.5 });
    shot.timelineEvents.push({ id: 'shake', layerId: 'a', type: 'shake', startMs: 0, endMs: 1000, amplitudeX: 50, amplitudeY: 80, frequencyHz: 1 });
    expect(resolveSpeakerFocusCamera(project, shot, 500)).toEqual(beforeShake);
  });

  it('follows the formal inherited speaker position without cancelling its own or its ancestors’ Shake', () => {
    const { project, shot } = fixture();
    const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const pose = { scaleX: 1, scaleY: 1, rotationDeg: 0, flipX: false };
    Object.assign(shot.layers[0]!, pose, { x: 600, parentLayerId: 'middle', parentSpaceOffset: { ...identity, tx: -600, ty: -500 } });
    shot.layers.push(
      { ...shot.layers[0]!, id: 'middle', source: { kind: 'asset', assetId: 'middle' }, parentLayerId: 'root' },
      { ...shot.layers[0]!, id: 'root', source: { kind: 'asset', assetId: 'root' }, parentLayerId: undefined, parentSpaceOffset: undefined },
    );
    shot.dialogues.push(dialogue('A', 'A', 0, 1_800));
    shot.timelineEvents.push({
      id: 'move-root', layerId: 'root', type: 'move', startMs: 0, endMs: 1_000,
      from: { x: 600, y: 500 }, to: { x: 1_600, y: 500 }, easing: 'linear',
    });
    const beforeShake = prepareSpeakerFocusCamera(project, shot);
    const times = [0, 125, 250, 500, 900, 1_500, 1_850];
    const expected = times.map((time) => evaluateSpeakerFocusCamera(beforeShake, time));
    expect(expected[3]).toEqual({ centerX: 1100, centerY: 500, zoom: 1.5 });
    expect(expected[5]?.centerX).toBe(1280);
    const baseX = evaluatedLayerWorldMatrix(evaluateShotAtTime(shot, 500, project).layers[0]!).tx;
    for (const layerId of ['a', 'root']) shot.timelineEvents.push({
      id: 'shake-' + layerId, layerId, type: 'shake', startMs: 0, endMs: 1_000, amplitudeX: 80, amplitudeY: 0, frequencyHz: 0.5,
    });
    const shakePlan = prepareSpeakerFocusCamera(project, shot);
    expect(evaluatedLayerWorldMatrix(evaluateShotAtTime(shot, 500, project).layers[0]!).tx).not.toBe(baseX);
    expect([...times].reverse().map((time) => evaluateSpeakerFocusCamera(shakePlan, time)).reverse()).toEqual(expected);
  });

  it('folds rapid speaker changes and short gaps without a snap; seeking is stateless', () => {
    const { project, shot } = fixture();
    shot.dialogues.push(dialogue('A1', 'A', 0, 100), dialogue('B1', 'B', 100, 200), dialogue('A2', 'A', 230, 500));
    const first = resolveSpeakerFocusCamera(project, shot, 100);
    const next = resolveSpeakerFocusCamera(project, shot, 101);
    expect(Math.abs(next.centerX - first.centerX)).toBeLessThan(1);
    const sought = resolveSpeakerFocusCamera(project, shot, 400);
    for (let at = 0; at <= 400; at += 10) resolveSpeakerFocusCamera(project, shot, at);
    expect(resolveSpeakerFocusCamera(project, shot, 400)).toEqual(sought);
    const gapEnd = resolveSpeakerFocusCamera(project, shot, 230);
    const afterGap = resolveSpeakerFocusCamera(project, shot, 231);
    expect(Math.abs(afterGap.centerX - gapEnd.centerX)).toBeLessThan(1);
    expect(resolveSpeakerFocusCamera(project, shot, 0).zoom).toBe(1);
    const other = fixture();
    other.shot.dialogues.push(dialogue('B2', 'B', 0, 1000));
    expect(resolveSpeakerFocusCamera(other.project, other.shot, 0).zoom).toBe(1);
  });

  it('uses the shared latest-start subtitle winner, including overlap', () => {
    const { project, shot } = fixture();
    shot.dialogues.push(dialogue('A1', 'A', 0, 1000), dialogue('B1', 'B', 300, 900));
    const before = resolveSpeakerFocusCamera(project, shot, 300);
    expect(before.centerX).toBe(640);
    expect(resolveSpeakerFocusCamera(project, shot, 550).centerX).toBe(1280);
  });

  it('reacts to authored visibility changes without following a hidden speaker', () => {
    const { project, shot } = fixture();
    shot.dialogues.push(dialogue('A1', 'A', 0, 1000));
    shot.timelineEvents.push({ id: 'hide', layerId: 'a', type: 'visibility', startMs: 500, endMs: 500, visible: false });
    expect(resolveSpeakerFocusCamera(project, shot, 499).zoom).toBe(1.5);
    expect(resolveSpeakerFocusCamera(project, shot, 750).zoom).toBe(1);
  });

  it('reuses a many-boundary plan without rereading static Shot history per frame', () => {
    const { project, shot } = fixture();
    for (let index = 0; index < 80; index += 1) {
      shot.dialogues.push(dialogue(`D${index}`, index % 2 ? 'B' : 'A', index * 20, index * 20 + 16));
    }
    shot.timelineEvents.push({ id: 'move', layerId: 'a', type: 'move', startMs: 100, endMs: 1000, from: { x: 400, y: 500 }, to: { x: 800, y: 600 }, easing: 'linear' });
    shot.timelineEvents.push({ id: 'shake', layerId: 'a', type: 'shake', startMs: 100, endMs: 1000, amplitudeX: 30, amplitudeY: 20, frequencyHz: 1 });
    const times = [0, 10, 20, 125, 250, 501, 999, 1200, 1599, 1750];
    const expected = times.map((time) => resolveSpeakerFocusCamera(project, shot, time));
    const dialogues = shot.dialogues;
    const events = shot.timelineEvents;
    let dialogueReads = 0;
    let eventReads = 0;
    Object.defineProperty(shot, 'dialogues', { get: () => { dialogueReads += 1; return dialogues; } });
    Object.defineProperty(shot, 'timelineEvents', { get: () => { eventReads += 1; return events; } });
    const plan = prepareSpeakerFocusCamera(project, shot);
    const readsAfterPreparation = { dialogueReads, eventReads };
    expect(times.map((time) => evaluateSpeakerFocusCamera(plan, time))).toEqual(expected);
    expect({ dialogueReads, eventReads }).toEqual(readsAfterPreparation);
    expect(plan.transitions.length).toBeGreaterThan(100);
    const sought = evaluateSpeakerFocusCamera(plan, 999);
    for (let time = 0; time <= 999; time += 7) evaluateSpeakerFocusCamera(plan, time);
    expect(evaluateSpeakerFocusCamera(plan, 999)).toEqual(sought);
  });

  it('compensates effective depth (near, far, zero, and parent-inherited moving speakers) while keeping clamp, Shake, and screen-space fallbacks', () => {
    const projectPoint = (
      camera: ReturnType<typeof resolveSpeakerFocusCamera>,
      worldX: number,
      worldY: number,
      depth: number,
      space: 'world' | 'screen' = 'world',
    ) => {
      const layerTransform = cameraLayerTransform(camera, 1920, 1080, depth, space)!;
      return {
        x: layerTransform.x + (worldX - layerTransform.offsetX) * layerTransform.scaleX,
        y: layerTransform.y + (worldY - layerTransform.offsetY) * layerTransform.scaleY,
      };
    };

    // Issue #1377 numerical example: 1920x1080, F=1000, actor X=1280, d=-500, zoom=1.5 => centerX=1120 => projected X=960.
    const near = fixture();
    Object.assign(near.shot.layers[0]!, { x: 1280, y: 540, depth: -500 });
    near.shot.dialogues.push(dialogue('near', 'A', 0, 1_000));
    const nearCamera = resolveSpeakerFocusCamera(near.project, near.shot, 500);
    expect(nearCamera).toEqual({ centerX: 1120, centerY: 540, zoom: 1.5 });
    expect(projectPoint(nearCamera, 1280, 540, -500).x).toBeCloseTo(960, 8);
    expect(projectPoint(nearCamera, 1280, 540, -500).y).toBeCloseTo(540, 8);

    // Far depth within reachable clamp range centers accurately; beyond range respects existing stage clamp.
    const far = fixture();
    Object.assign(far.shot.layers[0]!, { x: 1100, y: 540, depth: 1_000 });
    far.shot.dialogues.push(dialogue('far', 'A', 0, 1_000));
    const farCamera = resolveSpeakerFocusCamera(far.project, far.shot, 500);
    expect(farCamera).toEqual({ centerX: 1240, centerY: 540, zoom: 1.5 });
    expect(projectPoint(farCamera, 1100, 540, 1_000).x).toBeCloseTo(960, 8);
    far.shot.layers[0]!.x = 1280;
    expect(resolveSpeakerFocusCamera(far.project, far.shot, 500)).toEqual({ centerX: 1280, centerY: 540, zoom: 1.5 });

    // Explicit depth=0 preserves original behavior identically.
    const zero = fixture();
    Object.assign(zero.shot.layers[0]!, { x: 1120, y: 500, depth: 0 });
    zero.shot.dialogues.push(dialogue('zero', 'A', 0, 1_000));
    expect(resolveSpeakerFocusCamera(zero.project, zero.shot, 500)).toEqual({ centerX: 1120, centerY: 500, zoom: 1.5 });

    // Moving character inheriting dynamic depth from a parent layer stays centered without chasing Shake.
    const inherited = fixture();
    const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const pose = { scaleX: 1, scaleY: 1, rotationDeg: 0, flipX: false };
    Object.assign(inherited.shot.layers[0]!, pose, {
      x: 960, y: 540, parentLayerId: 'carrier', parentSpaceOffset: { ...identity, tx: -960, ty: -540 },
    });
    inherited.shot.layers.push({
      ...inherited.shot.layers[0]!,
      id: 'carrier',
      source: { kind: 'control' },
      parentLayerId: undefined,
      parentSpaceOffset: undefined,
      depthKeys: [
        { timeMs: 0, value: -400, interpolationToNext: 'linear' },
        { timeMs: 1_000, value: 400, interpolationToNext: 'linear' },
      ],
    });
    inherited.shot.dialogues.push(dialogue('move-deep', 'A', 0, 1_500));
    inherited.shot.timelineEvents.push({
      id: 'move-carrier', layerId: 'carrier', type: 'move', startMs: 0, endMs: 1_000,
      from: { x: 800, y: 480 }, to: { x: 1120, y: 600 }, easing: 'linear',
    });
    const planWithoutShake = prepareSpeakerFocusCamera(inherited.project, inherited.shot);
    const checkTimes = [300, 500, 750, 1_000];
    const withoutShake = checkTimes.map((t) => evaluateSpeakerFocusCamera(planWithoutShake, t));
    for (const [index, timeMs] of checkTimes.entries()) {
      const evaluated = evaluateShotAtTime(inherited.shot, timeMs, inherited.project, { includeShake: false }).layers[0]!;
      const world = evaluatedLayerWorldMatrix(evaluated);
      const projected = projectPoint(withoutShake[index]!, world.tx, world.ty, evaluated.effectiveDepth ?? 0);
      expect(projected.x).toBeCloseTo(960, 6);
      expect(projected.y).toBeCloseTo(540, 6);
    }
    inherited.shot.timelineEvents.push(
      { id: 'shake-actor', layerId: 'a', type: 'shake', startMs: 0, endMs: 1_000, amplitudeX: 60, amplitudeY: 40, frequencyHz: 1 },
      { id: 'shake-carrier', layerId: 'carrier', type: 'shake', startMs: 0, endMs: 1_000, amplitudeX: 40, amplitudeY: 50, frequencyHz: 1 },
    );
    const planWithShake = prepareSpeakerFocusCamera(inherited.project, inherited.shot);
    expect([...checkTimes].reverse().map((t) => evaluateSpeakerFocusCamera(planWithShake, t)).reverse()).toEqual(withoutShake);

    // Screen-space speaking actor (direct or inherited) falls back cleanly to full stage without double projection.
    const screen = fixture();
    Object.assign(screen.shot.layers[0]!, { x: 1280, y: 540, depth: -400, cameraSpace: 'screen' });
    screen.shot.dialogues.push(dialogue('hud', 'A', 0, 1_000));
    expect(resolveSpeakerFocusCamera(screen.project, screen.shot, 500)).toEqual({ centerX: 960, centerY: 540, zoom: 1 });
    const inheritedScreen = fixture();
    Object.assign(inheritedScreen.shot.layers[0]!, pose, {
      x: 1280, y: 540, parentLayerId: 'hud-root', parentSpaceOffset: { ...identity, tx: -1280, ty: -540 },
    });
    inheritedScreen.shot.layers.push({
      ...inheritedScreen.shot.layers[0]!, id: 'hud-root', source: { kind: 'control' },
      parentLayerId: undefined, parentSpaceOffset: undefined, cameraSpace: 'screen',
    });
    inheritedScreen.shot.dialogues.push(dialogue('hud-child', 'A', 0, 1_000));
    expect(resolveSpeakerFocusCamera(inheritedScreen.project, inheritedScreen.shot, 500)).toEqual({ centerX: 960, centerY: 540, zoom: 1 });

    // Near-clipped extreme depth falls back cleanly to full stage rather than producing NaN/clipped target.
    const clipped = fixture();
    Object.assign(clipped.shot.layers[0]!, { x: 1280, y: 540, depth: -700 });
    clipped.shot.dialogues.push(dialogue('clipped', 'A', 0, 1_000));
    expect(resolveSpeakerFocusCamera(clipped.project, clipped.shot, 500)).toEqual({ centerX: 960, centerY: 540, zoom: 1 });
  });
});
