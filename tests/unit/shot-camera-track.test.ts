import { describe, expect, it } from 'vitest';
import {
  createShotCameraPreset,
  evaluateShotCamera,
  evaluateShotAtTime,
  isFullStageCamera,
  prepareShotCamera,
  ProjectSchema,
  removeShotCameraKeyframe,
  resolveShotCamera,
  resolveSpeakerFocusCamera,
  upsertShotCameraKeyframe,
  withShotCameraMode,
  withShotCamera,
  type Project,
} from '../../src/domain';
import { buildProject, IDS, legacyShot } from './domain/testProject';

const WIDTH = 1_920;
const HEIGHT = 1_080;

function projectWithCamera(
  camera: Project['shots'][number]['camera'],
  options: { durationMs?: number } = {},
): Project {
  const base = buildProject();
  return ProjectSchema.parse({
    ...base,
    shots: base.shots.map((shot) => ({
      ...shot,
      durationMs: options.durationMs ?? shot.durationMs,
      camera,
    })),
  });
}

function speakingProject(): Project {
  const base = buildProject();
  const character = base.characters[0]!;
  return ProjectSchema.parse({
    ...base,
    shots: base.shots.map((shot) => ({
      ...shot,
      dialogues: [
        {
          id: '80000000-0000-4000-8000-0000000000c1',
          characterId: character.id,
          voiceProfileId: character.defaultVoiceProfileId,
          subtitleStyleId: IDS.subtitle,
          startMs: 0,
          endMs: 2_000,
          text: 'speaking',
        },
      ],
      camera: { mode: 'speaker-focus', keyframes: [] },
    })),
  });
}

describe('AUTO-07B Shot camera evaluation', () => {
  it('keeps static mode at the full stage', () => {
    const project = projectWithCamera({ mode: 'static', keyframes: [] });
    const camera = resolveShotCamera(project, project.shots[0]!, 1_234);
    expect(camera).toEqual({ centerX: WIDTH / 2, centerY: HEIGHT / 2, zoom: 1 });
    expect(isFullStageCamera(camera, WIDTH, HEIGHT)).toBe(true);
  });

  it('reuses the existing speaker-focus plan without a second scheduler', () => {
    const project = speakingProject();
    const shot = project.shots[0]!;
    const plan = prepareShotCamera(project, shot);
    expect(plan.speakerPlan).not.toBeNull();
    for (const timeMs of [0, 500, 1_000, 1_999]) {
      expect(evaluateShotCamera(plan, timeMs)).toEqual(
        resolveSpeakerFocusCamera(project, shot, timeMs),
      );
    }
  });

  it('holds one keyframe, interpolates two, and holds the last', () => {
    const project = projectWithCamera(
      {
        mode: 'manual',
        keyframes: [{ timeMs: 400, centerX: 800, centerY: 400, zoom: 2 }],
      },
      { durationMs: 4_000 },
    );
    const shot = project.shots[0]!;
    for (const timeMs of [0, 400, 2_000, 4_000]) {
      expect(resolveShotCamera(project, shot, timeMs)).toEqual({
        centerX: 800,
        centerY: 400,
        zoom: 2,
      });
    }

    const two = projectWithCamera(
      {
        mode: 'manual',
        keyframes: [
          { timeMs: 0, centerX: 960, centerY: 540, zoom: 1 },
          { timeMs: 2_000, centerX: 960, centerY: 540, zoom: 2 },
        ],
      },
      { durationMs: 4_000 },
    );
    const track = two.shots[0]!;
    expect(resolveShotCamera(two, track, 0).zoom).toBe(1);
    expect(resolveShotCamera(two, track, 2_000).zoom).toBe(2);
    const mid = resolveShotCamera(two, track, 1_000).zoom;
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(2);
    // Deterministic for the same requested time.
    expect(resolveShotCamera(two, track, 1_000)).toEqual(
      resolveShotCamera(two, track, 1_000),
    );
    // Holds after the last keyframe instead of drifting.
    expect(resolveShotCamera(two, track, 3_500).zoom).toBe(2);
  });

  it('clamps manual framing inside the stage', () => {
    const project = projectWithCamera(
      {
        mode: 'manual',
        keyframes: [{ timeMs: 0, centerX: 0, centerY: 0, zoom: 2 }],
      },
      { durationMs: 2_000 },
    );
    const camera = resolveShotCamera(project, project.shots[0]!, 0);
    expect(camera.centerX).toBe(WIDTH / 4);
    expect(camera.centerY).toBe(HEIGHT / 4);
  });

  it('moves the camera, never the layers', () => {
    const project = projectWithCamera(
      {
        mode: 'manual',
        keyframes: [
          { timeMs: 0, centerX: 960, centerY: 540, zoom: 1 },
          { timeMs: 2_000, centerX: 1_200, centerY: 600, zoom: 1.7 },
        ],
      },
      { durationMs: 3_000 },
    );
    const shot = project.shots[0]!;
    const atStart = evaluateShotAtTime(shot, 0, project);
    const atEnd = evaluateShotAtTime(shot, 2_500, project);
    expect(atEnd.layers.map(({ x, y, scaleX }) => ({ x, y, scaleX }))).toEqual(
      atStart.layers.map(({ x, y, scaleX }) => ({ x, y, scaleX })),
    );
    expect(resolveShotCamera(project, shot, 2_500)).not.toEqual(
      resolveShotCamera(project, shot, 0),
    );
  });

  it('seeds editable presets and keeps keyframes across mode switches', () => {
    const project = projectWithCamera({ mode: 'manual', keyframes: [] }, {
      durationMs: 5_000,
    });
    const shot = project.shots[0]!;
    for (const preset of ['push-in', 'pull-out', 'pan'] as const) {
      const keyframes = createShotCameraPreset(preset, {
        width: WIDTH,
        height: HEIGHT,
        durationMs: shot.durationMs,
      });
      expect(keyframes).toHaveLength(2);
      expect(keyframes[0]!.timeMs).toBe(0);
      expect(keyframes[1]!.timeMs).toBe(shot.durationMs);
      expect(keyframes[0]!.zoom).toBeGreaterThanOrEqual(1);
      expect(keyframes[1]!.zoom).toBeGreaterThanOrEqual(1);
    }

    const manual = withShotCameraMode(shot.camera, 'manual');
    const recorded = upsertShotCameraKeyframe(
      manual,
      { timeMs: 1_500, centerX: 900, centerY: 500, zoom: 1.4 },
      WIDTH,
      HEIGHT,
      shot.durationMs,
    );
    expect(recorded.keyframes).toHaveLength(1);
    const replaced = upsertShotCameraKeyframe(
      recorded,
      { timeMs: 1_500, centerX: 1_000, centerY: 520, zoom: 1.6 },
      WIDTH,
      HEIGHT,
      shot.durationMs,
    );
    expect(replaced.keyframes).toEqual([
      { timeMs: 1_500, centerX: 1_000, centerY: 520, zoom: 1.6 },
    ]);
    const switched = withShotCameraMode(replaced, 'static');
    expect(switched.mode).toBe('static');
    expect(switched.keyframes).toEqual(replaced.keyframes);
    expect(removeShotCameraKeyframe(replaced, 1_500).keyframes).toEqual([]);
  });

  it('replaces exactly one Shot immutably', () => {
    const project = projectWithCamera({ mode: 'static', keyframes: [] });
    const shot = project.shots[0]!;
    const next = withShotCamera(project, shot.id, {
      mode: 'manual',
      keyframes: [{ timeMs: 0, centerX: 960, centerY: 540, zoom: 1.5 }],
    });
    expect(next.shots[0]!.camera.mode).toBe('manual');
    expect(project.shots[0]!.camera.mode).toBe('static');
    expect(next.shots[0]!.layers).toBe(shot.layers);
    expect(legacyShot(next.shots[0]!)).toEqual(legacyShot(shot));
  });
});
