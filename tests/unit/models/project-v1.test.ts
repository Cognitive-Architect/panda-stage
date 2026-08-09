import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

function wavDurationMs(bytes: Buffer): number {
  if (
    bytes.length < 12 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('Expected a RIFF/WAVE fixture.');
  }
  let byteRate: number | null = null;
  let dataLength: number | null = null;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + length > bytes.length) {
      throw new Error(`Truncated WAV ${type} chunk.`);
    }
    if (type === 'fmt ' && length >= 16) {
      byteRate = bytes.readUInt32LE(offset + 16);
    } else if (type === 'data') {
      dataLength = length;
    }
    offset += 8 + length + (length % 2);
  }
  if (!byteRate || dataLength === null) {
    throw new Error('WAV fixture lacks fmt or data chunks.');
  }
  return Math.round((dataLength / byteRate) * 1_000);
}

describe('ProjectSchema v5', () => {
  it('migrates the human-readable v1 example with every MVP entity', () => {
    const project = ProjectSchema.parse(exampleProject);
    const shot = project.shots[0]!;

    expect(project).toMatchObject({
      schemaVersion: 5,
      width: 1920,
      height: 1080,
      fps: 24,
    });
    expect(project.assets).toHaveLength(4);
    expect(project.characters).toHaveLength(1);
    expect(project.characters[0]).toMatchObject({
      defaultExpressionId: project.characters[0]!.expressions[0]!.id,
      defaultScale: 1,
      defaultFlipX: false,
    });
    expect(project.voiceProfiles).toHaveLength(1);
    expect(project.subtitleStyles).toHaveLength(1);
    expect(shot.layers).toHaveLength(2);
    expect(shot.dialogues).toHaveLength(1);
    expect(shot.audioClips).toHaveLength(1);
  });

  it('backs every example asset record with a matching source file', async () => {
    const project = ProjectSchema.parse(exampleProject);
    const exampleRoot = resolve(process.cwd(), 'demo-project');
    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    for (const asset of project.assets) {
      const bytes = await readFile(resolve(exampleRoot, asset.relativePath));
      if (asset.kind === 'image') {
        expect(bytes.subarray(0, 8)).toEqual(pngSignature);
        expect(bytes.readUInt32BE(16)).toBe(asset.width);
        expect(bytes.readUInt32BE(20)).toBe(asset.height);
      } else {
        expect(wavDurationMs(bytes)).toBe(asset.durationMs);
      }
    }
  });

  it('exports executable schemas for every MVP entity', () => {
    expect(AssetSchema.parse(exampleProject.assets[0])).toBeTruthy();
    const migrated = ProjectSchema.parse(exampleProject);
    expect(CharacterSchema.parse(migrated.characters[0])).toBeTruthy();
    expect(VoiceProfileSchema.parse(exampleProject.voiceProfiles[0])).toBeTruthy();
    expect(SubtitleStyleSchema.parse(exampleProject.subtitleStyles[0])).toBeTruthy();
    expect(ShotSchema.parse(migrated.shots[0])).toBeTruthy();
    expect(LayerSchema.parse(migrated.shots[0]!.layers[0])).toBeTruthy();
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

  it('rejects dangling or character-backed background references', () => {
    const dangling = structuredClone(ProjectSchema.parse(exampleProject));
    dangling.shots[0]!.backgroundLayerId =
      'ffffffff-ffff-4fff-8fff-fffffffffff6';
    expect(issuePaths(dangling)).toContain(
      'shots.0.backgroundLayerId',
    );

    const characterBackground = structuredClone(
      ProjectSchema.parse(exampleProject),
    );
    characterBackground.shots[0]!.backgroundLayerId =
      characterBackground.shots[0]!.layers[1]!.id;
    expect(issuePaths(characterBackground)).toContain(
      'shots.0.backgroundLayerId',
    );
  });

  it('rejects dangling defaults, duplicate expression names, non-image mouths, and invalid transforms', () => {
    const dangling = structuredClone(ProjectSchema.parse(exampleProject));
    dangling.characters[0]!.defaultExpressionId =
      'ffffffff-ffff-4fff-8fff-fffffffffff5';
    expect(issuePaths(dangling)).toContain(
      'characters.0.defaultExpressionId',
    );

    const duplicate = structuredClone(ProjectSchema.parse(exampleProject));
    duplicate.characters[0]!.expressions[1]!.name =
      duplicate.characters[0]!.expressions[0]!.name.toUpperCase();
    expect(issuePaths(duplicate)).toContain(
      'characters.0.expressions.1.name',
    );

    const audioMouth = structuredClone(ProjectSchema.parse(exampleProject));
    audioMouth.characters[0]!.mouthOpenAssetId =
      audioMouth.assets.find((asset) => asset.kind === 'audio')!.id;
    expect(issuePaths(audioMouth)).toContain(
      'characters.0.mouthOpenAssetId',
    );

    const invalidScale = structuredClone(ProjectSchema.parse(exampleProject));
    invalidScale.characters[0]!.defaultScale = 0;
    expect(issuePaths(invalidScale)).toContain(
      'characters.0.defaultScale',
    );
  });

  it('rejects unknown strict fields instead of silently deleting them', () => {
    const input = { ...cloneExample(), unexpectedFutureField: true };

    expect(ProjectSchema.safeParse(input).success).toBe(false);
  });
});
