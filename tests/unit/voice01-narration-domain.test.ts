import { describe, expect, it } from 'vitest';
import {
  DialogueSchema,
  DialogueService,
  DialogueServiceError,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  isNarratorDialogue,
  type Dialogue,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const NARRATION_AUDIO = '10000000-0000-4000-8000-000000000201';

function narrationAudioAsset(): Project['assets'][number] {
  return {
    id: NARRATION_AUDIO,
    kind: 'audio',
    name: '001_旁白',
    relativePath: 'assets/001_旁白.wav',
    mimeType: 'audio/wav',
    sha256: 'c'.repeat(64),
    durationMs: 2_000,
  };
}

function withNarrationAudio(project = buildProject()): Project {
  return ProjectSchema.parse({
    ...project,
    assets: [...project.assets, narrationAudioAsset()],
  });
}

function service(): DialogueService {
  let counter = 0;
  return new DialogueService({
    createId: () =>
      `d3000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-11-08T04:00:00.000Z'),
  });
}

function expectDialogueError(
  action: () => unknown,
  code: DialogueServiceError['code'],
): void {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(DialogueServiceError);
    expect((error as DialogueServiceError).code).toBe(code);
  }
}

function narratorProject(dialogueService = service()): {
  project: Project;
  dialogueId: string;
  service: DialogueService;
} {
  const project = dialogueService.create(withNarrationAudio(), {
    shotId: IDS.shot,
    speakerType: 'narrator',
    text: '十年前，少年张三踏上修仙之路……',
    pointTimeMs: 0,
  });
  return {
    project,
    dialogueId: project.shots[0]!.dialogues[0]!.id,
    service: dialogueService,
  };
}

describe('VOICE-01 narration domain contract', () => {
  it('persists an explicit narrator dialogue without character or voice profile', () => {
    const { project } = narratorProject();
    const dialogue = project.shots[0]!.dialogues[0]!;

    expect(isNarratorDialogue(dialogue)).toBe(true);
    expect(dialogue.speakerType).toBe('narrator');
    expect(dialogue.characterId).toBeUndefined();
    expect(dialogue.voiceProfileId).toBeUndefined();
    expect(dialogue.audioClipId).toBeUndefined();
    expect(dialogue.text).toBe('十年前，少年张三踏上修仙之路……');
    // The persisted project itself still validates with the formal schema.
    expect(ProjectSchema.parse(project).shots[0]!.dialogues[0]).toMatchObject({
      speakerType: 'narrator',
    });
  });

  it('keeps every legacy character dialogue valid without a speakerType', () => {
    const project = service().create(buildProject(), {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: '你好',
      pointTimeMs: 0,
    });
    const dialogue = project.shots[0]!.dialogues[0]!;

    expect('speakerType' in dialogue).toBe(false);
    expect(isNarratorDialogue(dialogue)).toBe(false);
    expect(dialogue.characterId).toBe(IDS.character);
    expect(dialogue.voiceProfileId).toBe(IDS.voiceProfile);
  });

  it('rejects a narrator dialogue that still carries a character binding', () => {
    const invalid = {
      id: 'd3000000-0000-4000-8000-000000000099',
      speakerType: 'narrator',
      characterId: IDS.character,
      subtitleStyleId: IDS.subtitle,
      startMs: 0,
      endMs: 100,
      text: '旁白',
    };
    expect(DialogueSchema.safeParse(invalid).success).toBe(false);

    const narrationOnly: Dialogue = {
      id: 'd3000000-0000-4000-8000-000000000098',
      speakerType: 'narrator',
      subtitleStyleId: IDS.subtitle,
      startMs: 0,
      endMs: 100,
      text: '旁白',
    };
    expect(DialogueSchema.safeParse(narrationOnly).success).toBe(true);
  });

  it('never relaxes the character speaker contract', () => {
    const missingCharacter = DialogueSchema.safeParse({
      id: 'd3000000-0000-4000-8000-000000000097',
      subtitleStyleId: IDS.subtitle,
      startMs: 0,
      endMs: 100,
      text: '角色对白',
    });
    expect(missingCharacter.success).toBe(false);

    const missingVoiceProfile = DialogueSchema.safeParse({
      id: 'd3000000-0000-4000-8000-000000000096',
      characterId: IDS.character,
      subtitleStyleId: IDS.subtitle,
      startMs: 0,
      endMs: 100,
      text: '角色对白',
    });
    expect(missingVoiceProfile.success).toBe(false);

    expectDialogueError(
      () =>
        service().create(buildProject(), {
          shotId: IDS.shot,
          text: '没有说话人',
          pointTimeMs: 0,
        }),
      'DIALOGUE_SPEAKER_INVALID',
    );
  });

  it('validates a background-only shot whose only subtitle is narration', () => {
    const { project } = narratorProject();
    const shot = project.shots[0]!;
    const backgroundOnly = ProjectSchema.parse({
      ...project,
      characters: [],
      voiceProfiles: [],
      shots: [
        {
          ...shot,
          layers: shot.layers.filter(
            (layer) => layer.id === IDS.layerBg || layer.id === IDS.layerAsset,
          ),
        },
      ],
    });

    expect(backgroundOnly.characters).toHaveLength(0);
    expect(backgroundOnly.shots[0]!.dialogues[0]!.speakerType).toBe('narrator');
  });

  it('switches one dialogue between narration and a real character', () => {
    const mutationService = service();
    let project = mutationService.create(withNarrationAudio(), {
      shotId: IDS.shot,
      speakerType: 'narrator',
      text: '旁白',
      pointTimeMs: 0,
    });
    const dialogueId = project.shots[0]!.dialogues[0]!.id;

    project = mutationService.update(project, {
      shotId: IDS.shot,
      dialogueId,
      speakerType: 'character',
      characterId: IDS.character,
    });
    expect(project.shots[0]!.dialogues[0]).toMatchObject({
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
    });
    expect(project.shots[0]!.dialogues[0]!.speakerType).toBeUndefined();

    project = mutationService.update(project, {
      shotId: IDS.shot,
      dialogueId,
      speakerType: 'narrator',
    });
    const backToNarration = project.shots[0]!.dialogues[0]!;
    expect(backToNarration.speakerType).toBe('narrator');
    expect(backToNarration.characterId).toBeUndefined();
    expect(backToNarration.voiceProfileId).toBeUndefined();
  });

  it('mixes narration and character lines in one batch commit', () => {
    const project = service().createMany(withNarrationAudio(), {
      shotId: IDS.shot,
      pointTimeMs: 400,
      lines: [
        { speakerType: 'narrator', text: '旁白第一句' },
        { characterId: IDS.character, text: '张三第一句' },
        { speakerType: 'narrator', text: '旁白第二句' },
      ],
    });
    const dialogues = project.shots[0]!.dialogues;

    expect(dialogues).toHaveLength(3);
    expect(dialogues.map((dialogue) => isNarratorDialogue(dialogue))).toEqual([
      true,
      false,
      true,
    ]);
    expect(dialogues.map((dialogue) => dialogue.startMs)).toEqual([
      400, 400, 400,
    ]);
  });

  it('binds a real audio asset to narration through the existing dialogue clip', () => {
    const { project, dialogueId, service: mutationService } = narratorProject();
    let next = mutationService.setTiming(project, {
      shotId: IDS.shot,
      dialogueId,
      startMs: 0,
      endMs: 1_800,
    });
    next = mutationService.bindAudio(next, {
      shotId: IDS.shot,
      dialogueId,
      assetId: NARRATION_AUDIO,
    });

    const shot = next.shots[0]!;
    const dialogue = shot.dialogues[0]!;
    expect(dialogue.audioClipId).toBeDefined();
    const clip = shot.audioClips.find(
      (candidate) => candidate.id === dialogue.audioClipId,
    );
    expect(clip).toMatchObject({
      role: 'dialogue',
      assetId: NARRATION_AUDIO,
      startMs: 0,
      endMs: 1_800,
    });
    expect(ProjectSchema.parse(next).shots[0]!.audioClips).toHaveLength(1);
  });

  it('keeps the current persisted schema version', () => {
    const { project } = narratorProject();
    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });
});

const SECOND_CHARACTER = '10000000-0000-4000-8000-000000000031';
const SECOND_VOICE_PROFILE = '10000000-0000-4000-8000-000000000032';
const ALT_VOICE_PROFILE = '10000000-0000-4000-8000-000000000033';

/** Two characters plus an alternate legal voice profile for the first one. */
function multiVoiceProject(): Project {
  const base = buildProject();
  const character = base.characters[0]!;
  const voiceProfile = base.voiceProfiles[0]!;
  return ProjectSchema.parse({
    ...base,
    characters: [
      character,
      {
        ...character,
        id: SECOND_CHARACTER,
        name: '李四',
        defaultVoiceProfileId: SECOND_VOICE_PROFILE,
      },
    ],
    voiceProfiles: [
      voiceProfile,
      { ...voiceProfile, id: ALT_VOICE_PROFILE, name: '低沉声线' },
      {
        ...voiceProfile,
        id: SECOND_VOICE_PROFILE,
        name: '李四配音',
        characterId: SECOND_CHARACTER,
      },
    ],
  });
}

function characterDialogueProject(
  dialogueService: DialogueService,
  voiceProfileId?: string,
): { project: Project; dialogueId: string } {
  const created = dialogueService.create(multiVoiceProject(), {
    shotId: IDS.shot,
    characterId: IDS.character,
    text: '第一句',
    pointTimeMs: 0,
  });
  const dialogueId = created.shots[0]!.dialogues[0]!.id;
  if (voiceProfileId === undefined) return { project: created, dialogueId };
  const project = ProjectSchema.parse({
    ...created,
    shots: created.shots.map((shot) =>
      shot.id === IDS.shot
        ? {
            ...shot,
            dialogues: shot.dialogues.map((dialogue) =>
              dialogue.id === dialogueId ? { ...dialogue, voiceProfileId } : dialogue,
            ),
          }
        : shot,
    ),
  });
  return { project, dialogueId };
}

describe('VOICE-01 speaker re-selection keeps a legal non-default voice profile', () => {
  it('preserves the existing voice profile when the same character is re-selected', () => {
    const mutationService = service();
    const { project, dialogueId } = characterDialogueProject(
      mutationService,
      ALT_VOICE_PROFILE,
    );

    const next = mutationService.update(project, {
      shotId: IDS.shot,
      dialogueId,
      characterId: IDS.character,
    });

    expect(next.shots[0]!.dialogues[0]).toMatchObject({
      characterId: IDS.character,
      voiceProfileId: ALT_VOICE_PROFILE,
    });
  });

  it('binds the target character default profile when the character really changes', () => {
    const mutationService = service();
    const { project, dialogueId } = characterDialogueProject(
      mutationService,
      ALT_VOICE_PROFILE,
    );

    const next = mutationService.update(project, {
      shotId: IDS.shot,
      dialogueId,
      characterId: SECOND_CHARACTER,
    });

    expect(next.shots[0]!.dialogues[0]).toMatchObject({
      characterId: SECOND_CHARACTER,
      voiceProfileId: SECOND_VOICE_PROFILE,
    });
  });

  it('binds the default profile when narration becomes a character dialogue', () => {
    const mutationService = service();
    const { project, dialogueId } = narratorProject(mutationService);

    const next = mutationService.update(project, {
      shotId: IDS.shot,
      dialogueId,
      speakerType: 'character',
      characterId: IDS.character,
    });

    expect(next.shots[0]!.dialogues[0]).toMatchObject({
      characterId: IDS.character,
      voiceProfileId: IDS.voiceProfile,
    });
  });
});
