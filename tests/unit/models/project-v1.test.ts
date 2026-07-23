import { describe, expect, it } from 'vitest';
import exampleProject from '../../../demo-project/project-v1.example.json';
import {
  AssetSchema,
  AudioClipSchema,
  CharacterSchema,
  DialogueSchema,
  LayerSchema,
  ProjectSchema,
  ShotSchema,
  SubtitleStyleSchema,
  VoiceProfileSchema,
} from '../../../src/domain';

function cloneExample(): typeof exampleProject {
  return structuredClone(exampleProject);
}

function issuePaths(input: unknown): string[] {
  const result = ProjectSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('ProjectSchema v1', () => {
  it('parses the human-readable example with every MVP entity', () => {
    const project = ProjectSchema.parse(exampleProject);
    const shot = project.shots[0]!;

    expect(project).toMatchObject({
      schemaVersion: 1,
      width: 1920,
      height: 1080,
      fps: 24,
    });
    expect(project.assets).toHaveLength(4);
    expect(project.characters).toHaveLength(1);
    expect(project.voiceProfiles).toHaveLength(1);
    expect(project.subtitleStyles).toHaveLength(1);
    expect(shot.layers).toHaveLength(2);
    expect(shot.dialogues).toHaveLength(1);
    expect(shot.audioClips).toHaveLength(1);
  });

  it('exports executable schemas for every MVP entity', () => {
    expect(AssetSchema.parse(exampleProject.assets[0])).toBeTruthy();
    expect(CharacterSchema.parse(exampleProject.characters[0])).toBeTruthy();
    expect(VoiceProfileSchema.parse(exampleProject.voiceProfiles[0])).toBeTruthy();
    expect(SubtitleStyleSchema.parse(exampleProject.subtitleStyles[0])).toBeTruthy();
    expect(ShotSchema.parse(exampleProject.shots[0])).toBeTruthy();
    expect(LayerSchema.parse(exampleProject.shots[0]!.layers[0])).toBeTruthy();
    expect(DialogueSchema.parse(exampleProject.shots[0]!.dialogues[0])).toBeTruthy();
    expect(AudioClipSchema.parse(exampleProject.shots[0]!.audioClips[0])).toBeTruthy();
  });

  it('is semantically stable across parse → serialize → parse', () => {
    const first = ProjectSchema.parse(exampleProject);
    const second = ProjectSchema.parse(JSON.parse(JSON.stringify(first)));

    expect(second).toEqual(first);
  });

  it.each([
    ['width', 1280],
    ['height', 720],
    ['fps', 30],
  ])('rejects non-MVP project %s', (field, value) => {
    const input = cloneExample();
    Object.assign(input, { [field]: value });

    expect(ProjectSchema.safeParse(input).success).toBe(false);
  });

  it('rejects negative and fractional integer-millisecond fields', () => {
    const negative = cloneExample();
    negative.shots[0]!.dialogues[0]!.startMs = -1;
    expect(ProjectSchema.safeParse(negative).success).toBe(false);

    const fractional = cloneExample();
    fractional.shots[0]!.audioClips[0]!.offsetMs = 2.5;
    expect(ProjectSchema.safeParse(fractional).success).toBe(false);
  });

  it('rejects endMs before startMs with a precise path', () => {
    const input = cloneExample();
    input.shots[0]!.dialogues[0]!.startMs = 1000;
    input.shots[0]!.dialogues[0]!.endMs = 999;

    expect(issuePaths(input)).toContain('shots.0.dialogues.0.endMs');
  });

  it.each([
    {
      name: 'missing layer asset',
      mutate: (input: typeof exampleProject) => {
        input.shots[0]!.layers[0]!.source.assetId =
          'ffffffff-ffff-4fff-8fff-fffffffffff1';
      },
      path: 'shots.0.layers.0.source.assetId',
    },
    {
      name: 'missing character',
      mutate: (input: typeof exampleProject) => {
        input.shots[0]!.layers[1]!.source.characterId =
          'ffffffff-ffff-4fff-8fff-fffffffffff2';
      },
      path: 'shots.0.layers.1.source.characterId',
    },
    {
      name: 'missing audio asset',
      mutate: (input: typeof exampleProject) => {
        input.shots[0]!.audioClips[0]!.assetId =
          'ffffffff-ffff-4fff-8fff-fffffffffff3';
      },
      path: 'shots.0.audioClips.0.assetId',
    },
  ])('rejects $name and reports $path', ({ mutate, path }) => {
    const input = cloneExample();
    mutate(input);

    expect(issuePaths(input)).toContain(path);
  });

  it('rejects a character expression that belongs to no character', () => {
    const input = cloneExample();
    input.shots[0]!.layers[1]!.source.expressionId =
      'ffffffff-ffff-4fff-8fff-fffffffffff4';

    expect(issuePaths(input)).toContain(
      'shots.0.layers.1.source.expressionId',
    );
  });

  it('rejects unknown strict fields instead of silently deleting them', () => {
    const input = { ...cloneExample(), unexpectedFutureField: true };

    expect(ProjectSchema.safeParse(input).success).toBe(false);
  });
});
