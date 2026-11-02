import { describe, expect, it } from 'vitest';
import type { AudioAsset, Character } from '../../src/domain';
import {
  buildDialogueBatchPreview,
  formatDialogueDuration,
  type DialogueBatchAudioSelection,
} from '../../src/renderer/features/dialogue/dialogueBatchPlan';
import {
  parseDialoguePaste,
  resolveDialoguePaste,
} from '../../src/renderer/features/dialogue/parseDialoguePaste';

function character(id: string, name: string): Character {
  return {
    id,
    name,
    mode: 'single-image',
    baseAssetId: '10000000-0000-4000-8000-000000000002',
    defaultVoiceProfileId: '30000000-0000-4000-8000-000000000001',
    expressions: [
      {
        id: '20000000-0000-4000-8000-000000000002',
        name: '正常',
        assetId: '10000000-0000-4000-8000-000000000002',
      },
    ],
    defaultExpressionId: '20000000-0000-4000-8000-000000000002',
    defaultScale: 1,
    defaultFlipX: false,
  };
}

function audio(
  id: string,
  fileName: string,
  durationMs?: number,
  state: 'ready' | 'error' | 'pending' = 'ready',
): AudioAsset {
  const asset: AudioAsset = {
    id,
    kind: 'audio',
    name: fileName.replace(/\.[^.]+$/u, ''),
    relativePath: `assets/${fileName}`,
    mimeType: fileName.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
  };
  if (durationMs !== undefined) asset.durationMs = durationMs;
  if (state === 'ready') asset.metadata = { status: 'ready', warnings: [] };
  if (state === 'error') {
    asset.metadata = {
      status: 'error',
      code: 'ASSET_METADATA_INVALID_AUDIO',
      message: 'Fixture audio is unavailable.',
    };
  }
  return asset;
}

function preview(
  raw: string,
  characters: readonly Character[],
  audioAssets: readonly AudioAsset[],
  mapping: Readonly<Record<number, string>> = {},
  audioSelections: Readonly<Record<number, DialogueBatchAudioSelection>> = {},
) {
  const parsed = parseDialoguePaste(raw, characters);
  const resolution = resolveDialoguePaste(parsed, mapping, characters);
  return buildDialogueBatchPreview({
    parsed,
    resolution,
    characters,
    audioAssets,
    audioSelections,
  });
}

const panda = character('character-panda', '熊猫');
const tiger = character('character-tiger', '老虎');
const characters = [panda, tiger];

describe('Issue #926 audio-backed subtitle draft plan', () => {
  it('keeps source order, repeated speakers, blank-line numbering, asset IDs, and exact audio durations', () => {
    const result = preview(
      '熊猫：第一句\n\n老虎: 第二句\n熊猫：第三句',
      characters,
      [
        audio('voice-1', '001_熊猫.wav', 1_234),
        audio('voice-3', '003_老虎.mp3', 2_001),
        audio('voice-4', '004_熊猫.wav', 987),
      ],
    );

    expect(result.allReady).toBe(true);
    expect(result.rows.map((row) => row.sourceLineNumber)).toEqual([1, 3, 4]);
    expect(result.rows.map((row) => row.characterId)).toEqual([
      panda.id,
      tiger.id,
      panda.id,
    ]);
    expect(result.rows.map((row) => row.audioAsset?.id)).toEqual([
      'voice-1',
      'voice-3',
      'voice-4',
    ]);
    expect(result.rows.map((row) => row.audioAssetId)).toEqual([
      'voice-1',
      'voice-3',
      'voice-4',
    ]);
    expect(result.rows.map((row) => row.durationMs)).toEqual([1_234, 2_001, 987]);
    expect(result.rows.map((row) => row.automaticMatch)).toEqual([true, true, true]);
    expect(result.totalDurationMs).toBe(4_222);
    expect(formatDialogueDuration(1_234)).toBe('1.234 秒');
  });

  it.each([
    {
      name: 'does not guess a mismatched role',
      assets: [audio('wrong-role', '001_老虎.wav', 1_000)],
      issue: 'audio-role-mismatch',
    },
    {
      name: 'does not choose between duplicate sequence candidates',
      assets: [
        audio('duplicate-a', '001_熊猫.wav', 1_000),
        audio('duplicate-b', '0001_熊猫.mp3', 1_100),
      ],
      issue: 'audio-ambiguous',
    },
    {
      name: 'does not guess a mismatched sequence number',
      assets: [audio('wrong-number', '002_熊猫.wav', 1_000)],
      issue: 'audio-number-mismatch',
    },
    {
      name: 'reports missing audio',
      assets: [],
      issue: 'audio-not-found',
    },
    {
      name: 'does not select audio without duration metadata',
      assets: [audio('pending', '001_熊猫.wav', undefined, 'pending')],
      issue: 'audio-pending',
    },
    {
      name: 'does not select audio with metadata errors',
      assets: [audio('error', '001_熊猫.wav', 1_000, 'error')],
      issue: 'audio-error',
    },
    {
      name: 'does not select an invalid non-positive duration',
      assets: [audio('zero', '001_熊猫.wav', 0)],
      issue: 'audio-duration-invalid',
    },
  ])('$name', ({ assets, issue }) => {
    const result = preview('熊猫：你好', characters, assets);

    expect(result.allReady).toBe(false);
    expect(result.rows[0]).toMatchObject({ issue, ready: false });
    expect(result.rows[0]?.audioAsset).toBeNull();
  });

  it('requires explicit role mapping and permits a manual asset choice by ID', () => {
    const selectedAudio = audio('manual-voice', 'panda-take-2.wav', 1_500);
    const unresolved = preview('旁白：欢迎', characters, [selectedAudio]);
    expect(unresolved.rows[0]).toMatchObject({
      issue: 'character-unresolved',
      audioAsset: null,
    });

    const mapped = preview(
      '旁白：欢迎',
      characters,
      [selectedAudio],
      { 1: panda.id },
      {
        1: {
          assetId: selectedAudio.id,
          characterId: panda.id,
          durationSeconds: '1.5',
        },
      },
    );
    expect(mapped.rows[0]).toMatchObject({
      characterId: panda.id,
      audioAsset: { id: selectedAudio.id },
      automaticMatch: false,
      durationMs: 1_500,
      ready: true,
    });
  });

  it('accepts a user-shortened clip and rejects zero, negative, sub-millisecond, or over-source lengths', () => {
    const source = audio('voice', '001_熊猫.wav', 1_250);
    const selectDuration = (durationSeconds: string) =>
      preview(
        '熊猫：你好',
        characters,
        [source],
        {},
        {
          1: {
            assetId: source.id,
            characterId: panda.id,
            durationSeconds,
          },
        },
      ).rows[0]!;

    expect(selectDuration('0.75')).toMatchObject({ ready: true, durationMs: 750 });
    expect(selectDuration('0')).toMatchObject({ issue: 'duration-invalid' });
    expect(selectDuration('-0.1')).toMatchObject({ issue: 'duration-invalid' });
    expect(selectDuration('0.0001')).toMatchObject({ issue: 'duration-invalid' });
    expect(selectDuration('1.251')).toMatchObject({ issue: 'duration-out-of-range' });
  });

  it('blocks accidental reuse of one audio asset across repeated-speaker rows', () => {
    const first = audio('voice-1', '001_熊猫.wav', 1_000);
    const second = audio('voice-2', '002_熊猫.wav', 1_100);
    const result = preview(
      '熊猫：第一句\n熊猫：第二句',
      characters,
      [first, second],
      {},
      {
        2: {
          assetId: first.id,
          characterId: panda.id,
          durationSeconds: '1',
        },
      },
    );

    expect(result.allReady).toBe(false);
    expect(result.rows.map((row) => row.issue)).toEqual([
      'audio-reused',
      'audio-reused',
    ]);
    expect(result.rows.every((row) => row.issueMessage?.includes('请更换配音'))).toBe(true);
  });

  it('blocks stale audio selections after a line role changes', () => {
    const source = audio('voice', '001_熊猫.wav', 1_000);
    const result = preview(
      '老虎：改成另一个角色',
      characters,
      [source],
      {},
      {
        1: {
          assetId: source.id,
          characterId: panda.id,
          durationSeconds: '1',
        },
      },
    );

    expect(result.rows[0]).toMatchObject({
      issue: 'audio-role-changed',
      ready: false,
      audioAsset: null,
    });
  });
});
