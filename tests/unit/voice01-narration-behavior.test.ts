import { describe, expect, it } from 'vitest';
import {
  DialogueService,
  ProjectSchema,
  evaluateShotAtTime,
  projectShotDialogueVisual,
  resolveSpeakerFocusCamera,
  type Project,
} from '../../src/domain';
import { buildDialogueSubtitleCues } from '../../src/shared/preview/dialogue-subtitle';
import { buildProject, IDS } from './domain/testProject';

const AUDIO = '10000000-0000-4000-8000-000000000301';

function audioAsset(durationMs = 4_000): Project['assets'][number] {
  return {
    id: AUDIO,
    kind: 'audio',
    name: '001_旁白.wav',
    relativePath: 'assets/001_旁白.wav',
    mimeType: 'audio/wav',
    sha256: 'd'.repeat(64),
    durationMs,
  };
}

function service(): DialogueService {
  let counter = 0;
  return new DialogueService({
    createId: () =>
      `d4000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-11-08T05:00:00.000Z'),
  });
}

function narrationOnlyShot(): { project: Project; dialogueId: string } {
  const mutationService = service();
  let project = ProjectSchema.parse({
    ...buildProject(),
    assets: [...buildProject().assets, audioAsset()],
  });
  project = mutationService.create(project, {
    shotId: IDS.shot,
    speakerType: 'narrator',
    text: '十年前，少年张三踏上修仙之路……',
    pointTimeMs: 0,
  });
  const dialogueId = project.shots[0]!.dialogues[0]!.id;
  project = mutationService.setTiming(project, {
    shotId: IDS.shot,
    dialogueId,
    startMs: 0,
    endMs: 1_800,
  });
  project = mutationService.bindAudio(project, {
    shotId: IDS.shot,
    dialogueId,
    assetId: AUDIO,
  });
  return { project, dialogueId };
}

describe('VOICE-01 narration presentation behaviour', () => {
  it('shows the narration subtitle from the shared cue projection', () => {
    const { project } = narrationOnlyShot();
    const cues = buildDialogueSubtitleCues(project.shots[0]!.dialogues);

    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      startMs: 0,
      endMs: 1_800,
      text: '十年前，少年张三踏上修仙之路……',
    });
  });

  it('never applies a mouth or head-motion projection to narration', () => {
    const { project, dialogueId } = narrationOnlyShot();
    const shot = project.shots[0]!;
    const base = evaluateShotAtTime(shot, 100, project);
    const projected = projectShotDialogueVisual(project, shot, base, dialogueId);

    expect(projected.layers).toEqual(base.layers);
    expect(
      projected.layers.every(
        (layer) =>
          layer.mouthOverrideAssetId === null &&
          layer.headGroupTransform === undefined,
      ),
    ).toBe(true);
  });

  it('keeps the full stage camera during a narration cue', () => {
    const { project } = narrationOnlyShot();
    const camera = resolveSpeakerFocusCamera(project, project.shots[0]!, 500);

    expect(camera).toEqual({
      centerX: project.width / 2,
      centerY: project.height / 2,
      zoom: 1,
    });
  });

  it('still focuses a real speaker around mixed narration → character lines', () => {
    const mutationService = service();
    let project = narrationOnlyShot().project;
    project = mutationService.create(project, {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '张三：我来了',
      pointTimeMs: 0,
    });
    const timedId = project.shots[0]!.dialogues[1]!.id;
    project = mutationService.setTiming(project, {
      shotId: IDS.shot,
      dialogueId: timedId,
      startMs: 1_800,
      endMs: 3_000,
    });
    const shot = project.shots[0]!;

    expect(resolveSpeakerFocusCamera(project, shot, 500).zoom).toBe(1);
    expect(resolveSpeakerFocusCamera(project, shot, 2_400).zoom).toBe(1.5);
  });
});
