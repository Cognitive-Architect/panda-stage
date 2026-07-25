import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  scanAssetReferences,
  scanCharacterReferences,
  scanExpressionReferences,
} from '../../src/domain';
import exampleProject from '../../demo-project/project-v1.example.json';

const project = ProjectSchema.parse(exampleProject);

describe('scanAssetReferences', () => {
  it('reports background, character, audio clip, and dialogue locations', () => {
    const background = scanAssetReferences(
      project,
      project.assets[0]!.id,
    );
    const character = scanAssetReferences(
      project,
      project.assets[1]!.id,
    );
    const audio = scanAssetReferences(
      project,
      project.assets[3]!.id,
    );

    expect(background).toEqual([
      expect.objectContaining({
        kind: 'shot-background',
        path: 'shots[0].layers[0].source.assetId',
        label: expect.stringContaining('Opening'),
      }),
    ]);
    expect(character.map((reference) => reference.kind)).toEqual([
      'character-base',
      'character-expression',
    ]);
    expect(character.map((reference) => reference.label).join(' ')).toContain(
      'Panda',
    );
    expect(audio.map((reference) => reference.kind)).toEqual([
      'audio-clip',
      'dialogue-audio',
    ]);
    expect(audio[1]?.label).toContain('每一个故事');
  });

  it('is deterministic, pure, and returns no reference for an unused asset ID', () => {
    const before = JSON.stringify(project);
    expect(
      scanAssetReferences(
        project,
        'f0000000-0000-4000-8000-000000000001',
      ),
    ).toEqual([]);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('bounds human-readable dialogue labels for strict IPC responses', () => {
    const audioAssetId =
      '10000000-0000-4000-8000-000000000005';
    const longDialogue = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        dialogues: shot.dialogues.map((dialogue) => ({
          ...dialogue,
          text: '很长的对白 '.repeat(1_000),
        })),
      })),
    });

    const dialogueReference = scanAssetReferences(
      longDialogue,
      audioAssetId,
    ).find((reference) => reference.kind === 'dialogue-audio');

    expect(dialogueReference?.label).toContain('…');
    expect(dialogueReference!.label.length).toBeLessThanOrEqual(500);
  });
});

describe('character reference scans', () => {
  it('uses the shared scanner for character and expression deletion protection', () => {
    const character = project.characters[0]!;
    const expression = character.expressions[0]!;

    expect(
      scanCharacterReferences(project, character.id).map(
        (reference) => reference.kind,
      ),
    ).toEqual(['shot-layer-character', 'dialogue-character']);
    expect(
      scanExpressionReferences(
        project,
        character.id,
        expression.id,
      ).map((reference) => reference.kind),
    ).toEqual(['shot-layer-expression']);
  });

  it('reports a character mouth asset through the asset scanner', () => {
    const character = project.characters[0]!;
    const withMouth = ProjectSchema.parse({
      ...project,
      characters: project.characters.map((candidate) =>
        candidate.id === character.id
          ? {
              ...candidate,
              mouthOpenAssetId: project.assets[2]!.id,
            }
          : candidate,
      ),
    });

    expect(
      scanAssetReferences(withMouth, project.assets[2]!.id).map(
        (reference) => reference.kind,
      ),
    ).toContain('character-mouth');
  });
});
