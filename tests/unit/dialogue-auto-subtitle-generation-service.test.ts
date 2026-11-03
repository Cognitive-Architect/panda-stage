import { describe, expect, it } from 'vitest';
import {
  AutoSubtitleGenerationError,
  AutoSubtitleGenerationService,
  DialogueService,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

function audioAssetId(index: number): string {
  return `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function withAudioAssets(
  project: Project,
  count: number,
  durationMs = 400,
): Project {
  return ProjectSchema.parse({
    ...project,
    assets: [
      ...project.assets,
      ...Array.from({ length: count }, (_, index) => ({
        id: audioAssetId(index + 1),
        kind: 'audio' as const,
        name: `对白 ${index + 1}`,
        relativePath: `assets/dialogue-${index + 1}.wav`,
        mimeType: 'audio/wav',
        sha256: String(index + 1).padStart(64, '0'),
        durationMs,
        metadata: { status: 'ready' as const, warnings: [] },
      })),
    ],
  });
}

function rows(count: number, durationMs = 400) {
  return Array.from({ length: count }, (_, index) => ({
    sourceLineNumber: index + 1,
    characterId: IDS.character,
    selectedCharacterId: IDS.character,
    text: `第 ${index + 1} 句对白`,
    audioAssetId: audioAssetId(index + 1),
    durationMs,
  }));
}

describe('AutoSubtitleGenerationService', () => {
  it('plans ten unique audio rows from the playhead and requires the exact extension', () => {
    const project = withAudioAssets(buildProject(), 10);
    const service = new AutoSubtitleGenerationService();
    const input = { shotId: IDS.shot, startMs: 2_750, rows: rows(10) };

    const plan = service.plan(project, input);

    expect(plan).toMatchObject({
      ready: true,
      startMs: 2_750,
      endMs: 6_750,
      totalDurationMs: 4_000,
      shotDurationMs: 3_000,
      remainingDurationMs: 250,
      needsShotExtension: true,
      extensionToMs: 6_750,
    });
    expect(plan.rows.map(({ startMs, endMs }) => [startMs, endMs])).toEqual(
      Array.from({ length: 10 }, (_, index) => [
        2_750 + index * 400,
        2_750 + (index + 1) * 400,
      ]),
    );

    let missingConfirmation: unknown;
    try {
      service.generate(project, input);
    } catch (error) {
      missingConfirmation = error;
    }
    expect(missingConfirmation).toBeInstanceOf(AutoSubtitleGenerationError);
    expect((missingConfirmation as AutoSubtitleGenerationError).code).toBe(
      'EXTENSION_REQUIRED',
    );

    let staleConfirmation: unknown;
    try {
      service.generate(project, { ...input, extendShotToMs: 6_749 });
    } catch (error) {
      staleConfirmation = error;
    }
    expect(staleConfirmation).toBeInstanceOf(AutoSubtitleGenerationError);
    expect((staleConfirmation as AutoSubtitleGenerationError).code).toBe(
      'STALE_EXTENSION_CONFIRMATION',
    );
    expect(project.shots[0]).toMatchObject({
      durationMs: 3_000,
      dialogues: [],
      audioClips: [],
    });
  });

  it('generates ten exact Dialogue and dialogue AudioClip pairs atomically in the returned snapshot', () => {
    const project = withAudioAssets(buildProject(), 10);
    const before = structuredClone(project);
    const service = new AutoSubtitleGenerationService();

    const result = service.generate(project, {
      shotId: IDS.shot,
      startMs: 2_750,
      rows: rows(10),
      extendShotToMs: 6_750,
    });

    const shot = result.project.shots[0]!;
    expect(shot.durationMs).toBe(6_750);
    expect(shot.dialogues).toHaveLength(10);
    expect(shot.audioClips).toHaveLength(10);
    expect(new Set(result.dialogueIds).size).toBe(10);
    expect(new Set(shot.audioClips.map(({ assetId }) => assetId)).size).toBe(10);
    expect(shot.dialogues.map(({ text }) => text)).toEqual(
      rows(10).map(({ text }) => text),
    );
    for (const [index, dialogue] of shot.dialogues.entries()) {
      const row = rows(10)[index]!;
      const clip = shot.audioClips.find(
        (candidate) => candidate.id === dialogue.audioClipId,
      );
      expect(dialogue).toMatchObject({
        characterId: IDS.character,
        voiceProfileId: IDS.voiceProfile,
        startMs: 2_750 + index * 400,
        endMs: 2_750 + (index + 1) * 400,
      });
      expect(clip).toMatchObject({
        role: 'dialogue',
        assetId: row.audioAssetId,
        startMs: dialogue.startMs,
        endMs: dialogue.endMs,
      });
    }
    expect(project).toEqual(before);
    expect(project.shots[0]).toMatchObject({
      durationMs: 3_000,
      dialogues: [],
      audioClips: [],
    });
  });

  it('blocks duplicate audio and a timed Dialogue overlap before construction', () => {
    const service = new AutoSubtitleGenerationService();
    let project = withAudioAssets(buildProject(), 3, 500);
    const dialogueService = new DialogueService();
    project = dialogueService.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '已有对白',
      pointTimeMs: 1_000,
    });
    project = dialogueService.setTiming(project, {
      shotId: IDS.shot,
      dialogueId: project.shots[0]!.dialogues[0]!.id,
      startMs: 1_000,
      endMs: 1_500,
    });

    const duplicatePlan = service.plan(project, {
      shotId: IDS.shot,
      startMs: 0,
      rows: [
        { ...rows(1, 250)[0]!, audioAssetId: audioAssetId(1) },
        { ...rows(1, 250)[0]!, sourceLineNumber: 2, audioAssetId: audioAssetId(1) },
      ],
    });
    expect(duplicatePlan.ready).toBe(false);
    expect(duplicatePlan.blockers.map(({ code }) => code)).toContain('AUDIO_REUSED');

    const overlapPlan = service.plan(project, {
      shotId: IDS.shot,
      startMs: 500,
      rows: rows(3, 250),
    });
    expect(overlapPlan.ready).toBe(false);
    expect(overlapPlan.blockers).toContainEqual(
      expect.objectContaining({
        code: 'DIALOGUE_OVERLAP',
        sourceLineNumber: 3,
      }),
    );
    expect(project.shots[0]!.dialogues).toHaveLength(1);
    expect(project.shots[0]!.audioClips).toHaveLength(0);
  });

  it('rejects an invalid role capture or a row longer than its source asset', () => {
    const project = withAudioAssets(buildProject(), 2, 300);
    const service = new AutoSubtitleGenerationService();

    const changedRole = service.plan(project, {
      shotId: IDS.shot,
      startMs: 0,
      rows: [{ ...rows(1, 300)[0]!, selectedCharacterId: audioAssetId(2) }],
    });
    expect(changedRole.ready).toBe(false);
    expect(changedRole.blockers.map(({ code }) => code)).toContain('ROLE_CHANGED');

    const overlongClip = service.plan(project, {
      shotId: IDS.shot,
      startMs: 0,
      rows: rows(1, 301),
    });
    expect(overlongClip.ready).toBe(false);
    expect(overlongClip.blockers.map(({ code }) => code)).toContain('INVALID_DURATION');
  });
});
