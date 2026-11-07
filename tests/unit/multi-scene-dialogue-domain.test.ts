import { describe, expect, it } from 'vitest';
import {
  MULTI_SCENE_SHOT_DURATION_MS,
  MultiSceneDialogueService,
  ProjectSchema,
  parseMultiSceneInput,
  type Project,
} from '../../src/domain';
import {
  AUDIO_IDS,
  AUTO05_IDS,
  THREE_BLOCKS,
  TWO_BLOCKS,
  audioAsset,
  buildDialogueProject,
  defaultAudioAssets,
} from '../helpers/multiSceneDialogueFixture';

function plan(raw: string = TWO_BLOCKS, project: Project = buildDialogueProject()) {
  const service = new MultiSceneDialogueService();
  return service.plan(project, parseMultiSceneInput(raw));
}

describe('AUTO-05 in-memory batch planner', () => {
  it('plans 2 Shots with 4 formal rows and 2 timing records', () => {
    const outcome = plan();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.createdShotIds).toHaveLength(2);
    expect(outcome.plan.dialogue.rows).toHaveLength(4);
    expect(outcome.plan.dialogue.timings).toHaveLength(2);
  });

  it('plans 3 Shots with 6 rows and keeps every Shot independent', () => {
    const outcome = plan(THREE_BLOCKS);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const rows = outcome.plan.dialogue.rows;
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.map((row) => row.startMs)).toEqual([
      0, 1420, 0, 2000, 0, 1100,
    ]);
    expect(rows.map((row) => row.endMs)).toEqual([
      1420, 3290, 2000, 3600, 1100, 2400,
    ]);
  });

  it('uses real audio durationMs and never rounds or stretches', () => {
    const outcome = plan();
    if (!outcome.ok) throw new Error('expected a plan');
    expect(outcome.plan.dialogue.rows.map((row) => row.durationMs)).toEqual([
      1420, 1870, 2000, 1600,
    ]);
    expect(outcome.plan.dialogue.rows[1]!.endMs).toBe(3290);
  });

  it('extends only to the last endMs and never shortens below 3000ms', () => {
    const outcome = plan(THREE_BLOCKS);
    if (!outcome.ok) throw new Error('expected a plan');
    const timings = outcome.plan.dialogue.timings;
    expect(timings.map((timing) => timing.currentDurationMs)).toEqual([
      MULTI_SCENE_SHOT_DURATION_MS,
      MULTI_SCENE_SHOT_DURATION_MS,
      MULTI_SCENE_SHOT_DURATION_MS,
    ]);
    expect(timings.map((timing) => timing.requiredDurationMs)).toEqual([
      3290, 3600, 2400,
    ]);
    expect(timings.map((timing) => timing.nextDurationMs)).toEqual([
      3290, 3600, 3000,
    ]);
    expect(timings.map((timing) => timing.extended)).toEqual([
      true,
      true,
      false,
    ]);
    for (const timing of timings) {
      const shot = outcome.plan.candidateProject.shots.find(
        (candidate) => candidate.id === timing.shotId,
      );
      expect(shot?.durationMs).toBe(timing.nextDurationMs);
    }
  });

  it('binds every Dialogue and AudioClip to the same real asset and window', () => {
    const outcome = plan();
    if (!outcome.ok) throw new Error('expected a plan');
    for (const row of outcome.plan.dialogue.rows) {
      const shot = outcome.plan.candidateProject.shots.find(
        (candidate) => candidate.id === row.shotId,
      )!;
      const clip = shot.audioClips.find(
        (candidate) => candidate.assetId === row.audioAssetId,
      );
      expect(clip).toBeDefined();
      expect(clip!.role).toBe('dialogue');
      expect(clip!.startMs).toBe(row.startMs);
      expect(clip!.endMs).toBe(row.endMs);
      const dialogue = shot.dialogues.find(
        (candidate) => candidate.audioClipId === clip!.id,
      );
      expect(dialogue).toMatchObject({
        characterId: row.characterId,
        text: row.text,
        startMs: row.startMs,
        endMs: row.endMs,
      });
    }
  });

  it('keeps generated Shots ordinary and leaves existing Shots untouched', () => {
    const project = buildDialogueProject();
    const outcome = plan(TWO_BLOCKS, project);
    if (!outcome.ok) throw new Error('expected a plan');
    const next = outcome.plan.candidateProject;
    expect(next.shots).toHaveLength(project.shots.length + 2);
    expect(next.shots.slice(0, project.shots.length).map((shot) => shot.id)).toEqual(
      project.shots.map((shot) => shot.id),
    );
    for (const shotId of outcome.plan.createdShotIds) {
      const shot = next.shots.find((candidate) => candidate.id === shotId)!;
      expect(Object.keys(shot).sort()).toEqual(
        Object.keys(project.shots[0]!).sort(),
      );
    }
  });

  it('refuses the whole batch when a Speaker binding is unresolved', () => {
    const project = buildDialogueProject();
    const withoutElder = ProjectSchema.parse({
      ...project,
      characters: project.characters.filter(
        (character) => character.id !== AUTO05_IDS.charElder,
      ),
      voiceProfiles: project.voiceProfiles.filter(
        (profile) => profile.characterId !== AUTO05_IDS.charElder,
      ),
    });
    const outcome = plan(TWO_BLOCKS, withoutElder);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('SPEAKER_BINDING_UNRESOLVED');
  });

  it('refuses the whole batch when one audio file is missing', () => {
    const audio = defaultAudioAssets().filter(
      (asset) => asset.id !== AUDIO_IDS[2],
    );
    const outcome = plan(TWO_BLOCKS, buildDialogueProject(audio));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('AUDIO_MATCH_FAILED');
  });

  it('refuses the whole batch when one Audio Asset is reused', () => {
    const service = new MultiSceneDialogueService({
      audioSelections: { 3: AUDIO_IDS[0]! },
    });
    const outcome = service.plan(
      buildDialogueProject(),
      parseMultiSceneInput(TWO_BLOCKS),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('AUDIO_MATCH_FAILED');
  });

  it('re-schedules from the real duration when an audio changes', () => {
    const audio = defaultAudioAssets().map((asset) =>
      asset.id === AUDIO_IDS[0]
        ? audioAsset(asset.id, '001_张三.wav', 2500)
        : asset,
    );
    const outcome = plan(THREE_BLOCKS, buildDialogueProject(audio));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.dialogue.rows[0]!.endMs).toBe(2500);
    expect(outcome.plan.dialogue.rows[1]!.startMs).toBe(2500);
    expect(outcome.plan.dialogue.timings[0]!.nextDurationMs).toBe(4370);
  });

  it('produces a Project that still passes the strict schema', () => {
    const outcome = plan(THREE_BLOCKS);
    if (!outcome.ok) throw new Error('expected a plan');
    expect(() =>
      ProjectSchema.parse(outcome.plan.candidateProject),
    ).not.toThrow();
  });
});
