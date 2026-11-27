import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateShotAtTime,
  evaluateSpeakerFocusCamera,
  normalizeShotTimeMs,
  prepareSpeakerFocusCamera,
  ProjectSchema,
  resolveExportFrameAuthoringTime,
  LayerService,
  type Project,
  type Shot,
} from '../../src/domain';
import * as evaluateShotModule from '../../src/domain/evaluate-shot-at-time';
import {
  evaluateExportShotAtTime,
  evaluateFormalExportFrame,
  selectExportDrawingLayers,
} from '../../src/export-renderer/evaluateExportShotAtTime';
import { buildDialogueSubtitleCues } from '../../src/shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../../src/shared/preview/subtitle-engine';
import { PROBE_PROJECT, PROBE_SHOT, PROBE_SUBTITLE_CUES } from '../../src/shared/probe/probe-project';
import { characterActionGraphicFixture } from '../helpers/characterActionGraphicFixture';
import { IDS } from './domain/testProject';

const exportRendererSource = readFileSync('src/export-renderer/ExportRendererApp.tsx', 'utf8');

function buildFormalExportFixture(): { project: Project; shot: Shot; dialogueIdA: string; dialogueIdB: string } {
  const base = characterActionGraphicFixture(false);
  const service = new LayerService();
  const placed = service.createFromAnimation(base, IDS.shot, {
    animationId: base.animations[0]!.id,
    startTimeMs: 0,
    position: { x: 960, y: 540 },
  });
  const dialogueIdA = randomUUID();
  const dialogueIdB = randomUUID();
  const character = placed.project.characters[0]!;
  const project = ProjectSchema.parse({
    ...placed.project,
    shots: placed.project.shots.map((shot) =>
      shot.id === IDS.shot
        ? {
            ...shot,
            durationMs: 2_000,
            dialogues: [
              {
                id: dialogueIdA,
                characterId: character.id,
                voiceProfileId: character.defaultVoiceProfileId,
                text: '第一句台词',
                startMs: 100,
                endMs: 900,
                subtitleStyleId: shot.defaultSubtitleStyleId,
              },
              {
                id: dialogueIdB,
                characterId: character.id,
                voiceProfileId: character.defaultVoiceProfileId,
                text: '第二句台词',
                startMs: 1_100,
                endMs: 1_900,
                subtitleStyleId: shot.defaultSubtitleStyleId,
              },
            ],
          }
        : shot,
    ),
  });
  return { project, shot: project.shots[0]!, dialogueIdA, dialogueIdB };
}

describe('OPT-01B (#1394): eliminate duplicate Shot eval in formal export', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes requested Shot times identically to evaluateShotAtTime across boundary and high-fps fractional timestamps', () => {
    const { project, shot } = buildFormalExportFixture();
    const sampleTimes = [
      -250,
      -0.6,
      -0.4,
      0,
      16.6667, // 60fps frame 1
      33.3333, // 60fps frame 2
      41.6667, // 24fps frame 1
      99.5,
      100,
      899.6,
      900,
      1_999.4,
      2_000,
      2_500,
    ];
    for (const requestedTimeMs of sampleTimes) {
      const normalized = normalizeShotTimeMs(requestedTimeMs, shot.durationMs);
      const evaluated = evaluateShotAtTime(shot, requestedTimeMs, project);
      expect(normalized).toBe(evaluated.timeMs);
    }
  });

  it('evaluates the Shot once per formal export frame (down from 2) while preserving author-frame clock, subtitles, and object export', () => {
    const { project, shot, dialogueIdA, dialogueIdB } = buildFormalExportFixture();
    const subtitleCues = buildDialogueSubtitleCues(shot.dialogues);
    const evalSpy = vi.spyOn(evaluateShotModule, 'evaluateShotAtTime');

    // Test boundary, 24fps, and 60fps fractional timestamps.
    const testCases: Array<{ timeMs: number; expectedDialogueId: string | null }> = [
      { timeMs: -10, expectedDialogueId: null },
      { timeMs: 0, expectedDialogueId: null },
      { timeMs: 100, expectedDialogueId: dialogueIdA },
      { timeMs: 116.6667, expectedDialogueId: dialogueIdA }, // 60fps
      { timeMs: 141.6667, expectedDialogueId: dialogueIdA }, // 24fps
      { timeMs: 900, expectedDialogueId: null }, // exclusive end
      { timeMs: 1_100, expectedDialogueId: dialogueIdB },
      { timeMs: 2_500, expectedDialogueId: null }, // clamped to durationMs
    ];

    for (const { timeMs, expectedDialogueId } of testCases) {
      evalSpy.mockClear();
      const result = evaluateFormalExportFrame(project, shot, timeMs, subtitleCues);

      // Exactly 1 evaluateShotAtTime call per formal export frame (eliminated the redundant pre-eval for subtitle timeMs).
      expect(evalSpy).toHaveBeenCalledTimes(1);
      expect(evalSpy).toHaveBeenCalledWith(shot, timeMs, project, {
        graphicFrameTimeMs: resolveExportFrameAuthoringTime(timeMs, shot.durationMs),
      });

      expect(result.subtitle?.id ?? null).toBe(expectedDialogueId);

      // Exact parity with the previous two-step reference computation.
      evalSpy.mockClear();
      const refSubtitle = evaluateSubtitleAtTime(subtitleCues, evaluateShotAtTime(shot, timeMs, project).timeMs);
      const refShot = selectExportDrawingLayers(
        evaluateExportShotAtTime(project, shot, timeMs, refSubtitle?.id ?? null),
      );
      expect(result.subtitle).toEqual(refSubtitle);
      expect(result.evaluatedShot).toEqual(refShot);
    }

    // Object export (`outputLayerId`) also performs exactly 1 Shot eval and filters to the requested layer.
    evalSpy.mockClear();
    const objectResult = evaluateFormalExportFrame(
      project,
      shot,
      141.6667,
      subtitleCues,
      undefined,
      IDS.layerAsset,
    );
    expect(evalSpy).toHaveBeenCalledTimes(1);
    expect(objectResult.evaluatedShot.backgroundLayerId).toBeNull();
    expect(objectResult.evaluatedShot.layers.map(({ id }) => id)).toEqual([IDS.layerAsset]);
  });

  it('keeps ExportRendererApp wired to single-pass formal evaluation and preserves legacy probe semantics', () => {
    // ExportRendererApp must route formalRequest through evaluateFormalExportFrame
    // and must NOT unconditionally run evaluateShotAtTime before checking formalRequest.
    expect(exportRendererSource).toContain('evaluateFormalExportFrame(');
    expect(exportRendererSource).not.toMatch(/const evaluatedBaseShot = useMemo\(/u);

    // Legacy probe path still evaluates PROBE_SHOT directly and selects PROBE_SUBTITLE_CUES via evaluatedBaseShot.timeMs.
    const probeEvaluated = evaluateShotAtTime(PROBE_SHOT, 500, PROBE_PROJECT);
    const probeSubtitle = evaluateSubtitleAtTime(PROBE_SUBTITLE_CUES, probeEvaluated.timeMs);
    expect(probeEvaluated.timeMs).toBe(500);
    expect(probeSubtitle).toEqual(
      evaluateSubtitleAtTime(PROBE_SUBTITLE_CUES, normalizeShotTimeMs(500, PROBE_SHOT.durationMs)),
    );
  });

  it('measures speaker-focus evaluateShotAtTime calls and verifies zero identical-arg redundancy (secondary candidate deferred)', () => {
    const shot = {
      id: 'shot',
      durationMs: 2_000,
      backgroundLayerId: null,
      dialogues: [
        { id: 'd1', characterId: 'A', startMs: 0, endMs: 600, text: 'A1', subtitleStyleId: 'style' },
        { id: 'd2', characterId: 'B', startMs: 600, endMs: 1_200, text: 'B1', subtitleStyleId: 'style' },
        { id: 'd3', characterId: 'A', startMs: 1_300, endMs: 1_900, text: 'A2', subtitleStyleId: 'style' },
      ],
      audioClips: [],
      timelineEvents: [
        { id: 'vis', layerId: 'a', type: 'visibility', startMs: 400, endMs: 400, visible: false },
        { id: 'vis2', layerId: 'a', type: 'visibility', startMs: 1_250, endMs: 1_250, visible: true },
        { id: 'shake-a', layerId: 'a', type: 'shake', startMs: 0, endMs: 2_000, amplitudeX: 30, amplitudeY: 10, frequencyHz: 1 },
      ],
      layers: [
        {
          id: 'a',
          source: { kind: 'character', characterId: 'A' },
          x: 400,
          y: 500,
          visible: true,
          depth: -200,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
          flipX: false,
        },
        {
          id: 'b',
          source: { kind: 'character', characterId: 'B' },
          x: 1_500,
          y: 500,
          visible: true,
          depth: 300,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
          flipX: false,
        },
      ],
    } as unknown as Shot;
    const project = { width: 1920, height: 1080, characters: [], shots: [shot] } as unknown as Project;

    const evalSpy = vi.spyOn(evaluateShotModule, 'evaluateShotAtTime');
    const plan = prepareSpeakerFocusCamera(project, shot);

    // Every call inside prepareSpeakerFocusCamera has a unique (timeMs, includeShake, graphicFrameTimeMs) signature:
    // boundaries are deduplicated, intentAt uses default options (includeShake: undefined),
    // and targetAt uses { includeShake: false } which MUST NOT share results with Shake-inclusive evals.
    const prepareSignatures = evalSpy.mock.calls.map(([, timeMs, , options]) =>
      JSON.stringify({
        timeMs,
        includeShake: options?.includeShake ?? true,
        graphicFrameTimeMs: options?.graphicFrameTimeMs ?? null,
      }),
    );
    expect(prepareSignatures.length).toBeGreaterThan(0);
    expect(new Set(prepareSignatures).size).toBe(prepareSignatures.length);

    // Per-frame evaluation calls evaluateShotAtTime at most once with includeShake: false.
    for (const frameTimeMs of [0, 250, 500, 750, 1_500]) {
      evalSpy.mockClear();
      evaluateSpeakerFocusCamera(plan, frameTimeMs);
      expect(evalSpy.mock.calls.length).toBeLessThanOrEqual(1);
      for (const [, , , options] of evalSpy.mock.calls) {
        expect(options?.includeShake).toBe(false);
        expect(options?.graphicFrameTimeMs).toBeUndefined();
      }
    }
  });
});
