import { describe, expect, it } from 'vitest';
import {
  assetFileName,
  formatDurationMs,
  parseNumberedAudioAsset,
  resolveAudioMatches,
  resolveSpeakerBindings,
  collectSpeakerLabels,
  parseMultiSceneInput,
  type Project,
} from '../../src/domain';
import {
  AUDIO_IDS,
  AUDIO_NAMES,
  AUTO05_IDS,
  THREE_BLOCKS,
  TWO_BLOCKS,
  audioAsset,
  buildDialogueProject,
  defaultAudioAssets,
} from '../helpers/multiSceneDialogueFixture';

const REQUESTS = [
  { ordinal: 1, characterName: '张三' },
  { ordinal: 2, characterName: '李四' },
  { ordinal: 3, characterName: '大长老' },
  { ordinal: 4, characterName: '张三' },
];

function withAudio(...assets: ReturnType<typeof audioAsset>[]): Project {
  return buildDialogueProject(assets);
}

describe('AUTO-05 speaker bindings', () => {
  it('binds an exact unique name automatically and only once per label', () => {
    const project = buildDialogueProject();
    const labels = collectSpeakerLabels(parseMultiSceneInput(THREE_BLOCKS));
    const report = resolveSpeakerBindings(project, labels, {});
    expect(report.ready).toBe(true);
    expect(report.unresolved).toEqual([]);
    expect(report.bindings['张三']).toBe(AUTO05_IDS.charZhang);
    expect(report.bindings['李四']).toBe(AUTO05_IDS.charLi);
    expect(Object.keys(report.bindings)).toHaveLength(3);
  });

  it('leaves unknown and stale manual bindings unresolved', () => {
    const project = buildDialogueProject();
    const unknown = resolveSpeakerBindings(project, ['路人甲'], {});
    expect(unknown.ready).toBe(false);
    expect(unknown.unresolved).toEqual(['路人甲']);

    const stale = resolveSpeakerBindings(project, ['张三'], {
      张三: '20000000-0000-4000-8000-000000000099',
    });
    expect(stale.ready).toBe(false);
    expect(stale.unresolved).toEqual(['张三']);
  });

  it('refuses an ambiguous exact-name match', () => {
    const project = buildDialogueProject();
    const duplicated = {
      ...project,
      characters: [
        ...project.characters,
        {
          ...project.characters.find(
            (character) => character.id === AUTO05_IDS.charZhang,
          )!,
          id: '20000000-0000-4000-8000-000000000091',
        },
      ],
    } as unknown as Project;
    const report = resolveSpeakerBindings(duplicated, ['张三'], {});
    expect(report.unresolved).toEqual(['张三']);
  });
});

describe('AUTO-05 numbered audio exact match', () => {
  it('matches 001_张三.wav to the real asset id and durationMs', () => {
    const project = buildDialogueProject();
    const report = resolveAudioMatches(project, REQUESTS);
    expect(report.ready).toBe(true);
    expect(report.rows[0]!.asset?.id).toBe(AUTO05_IDS.audio1);
    expect(report.rows[0]!.durationMs).toBe(1420);
    expect(report.rows[0]!.fileName).toBe('001_张三.wav');
    expect(report.rows[2]!.asset?.id).toBe(AUTO05_IDS.audio3);
  });

  it('accepts leading zeros and falls back to the numbered relative path', () => {
    const project = withAudio(
      audioAsset(AUDIO_IDS[0]!, '1_张三.wav', 1420),
      {
        ...audioAsset(AUDIO_IDS[1]!, 'uploaded.mp3', 1870),
        relativePath: 'audio/002_李四.wav',
      } as ReturnType<typeof audioAsset>,
      ...defaultAudioAssets().slice(2),
    );
    const report = resolveAudioMatches(project, REQUESTS.slice(0, 2));
    expect(report.ready).toBe(true);
    expect(report.rows[0]!.asset?.id).toBe(AUDIO_IDS[0]);
    expect(report.rows[1]!.asset?.id).toBe(AUDIO_IDS[1]);
  });

  it('refuses several candidates with the same sequence', () => {
    const project = withAudio(
      ...defaultAudioAssets(),
      audioAsset('80000000-0000-4000-8000-000000000011', '001_张三.mp3', 900),
    );
    const report = resolveAudioMatches(project, REQUESTS);
    expect(report.rows[0]!.issue).toBe('AUDIO_AMBIGUOUS');
    expect(report.ready).toBe(false);
  });

  it('refuses a correct number with a wrong role name', () => {
    const project = withAudio(
      audioAsset(AUDIO_IDS[0]!, '001_李四.wav', 1420),
      ...defaultAudioAssets().slice(1),
    );
    const report = resolveAudioMatches(project, REQUESTS);
    expect(report.rows[0]!.issue).toBe('AUDIO_ROLE_MISMATCH');
  });

  it('refuses error metadata, pending duration and invalid duration', () => {
    const error = withAudio(
      audioAsset(AUDIO_IDS[0]!, AUDIO_NAMES[0]!, 1420, {
        metadata: {
          status: 'error',
          code: 'ASSET_METADATA_INVALID_AUDIO',
          message: 'broken',
        },
      }),
      ...defaultAudioAssets().slice(1),
    );
    expect(resolveAudioMatches(error, REQUESTS).rows[0]!.issue).toBe('AUDIO_ERROR');

    const pending = withAudio(
      audioAsset(AUDIO_IDS[0]!, AUDIO_NAMES[0]!, undefined),
      ...defaultAudioAssets().slice(1),
    );
    expect(resolveAudioMatches(pending, REQUESTS).rows[0]!.issue).toBe(
      'AUDIO_PENDING',
    );

    // durationMs: 0 cannot survive ProjectSchema; inject it after validation
    // to prove the matcher still refuses it rather than trusting the schema.
    const invalid = {
      ...buildDialogueProject(),
      assets: buildDialogueProject().assets.map((asset) =>
        asset.id === AUDIO_IDS[0] ? { ...asset, durationMs: 0 } : asset,
      ),
    } as unknown as Project;
    expect(resolveAudioMatches(invalid, REQUESTS).rows[0]!.issue).toBe(
      'AUDIO_DURATION_INVALID',
    );
  });

  it('refuses one Audio Asset reused by two dialogue lines', () => {
    const report = resolveAudioMatches(buildDialogueProject(), REQUESTS, {
      2: AUDIO_IDS[0]!,
    });
    expect(report.rows[0]!.issue).toBe('AUDIO_REUSED');
    expect(report.rows[1]!.issue).toBe('AUDIO_REUSED');
    expect(report.ready).toBe(false);
  });

  it('lets a manual pick resolve a missing match but keeps the real asset id', () => {
    const extra = audioAsset(
      '80000000-0000-4000-8000-000000000007',
      '007_张三.wav',
      1500,
    );
    const project = withAudio(extra, ...defaultAudioAssets().slice(1));
    const missing = resolveAudioMatches(project, REQUESTS);
    expect(missing.rows[0]!.issue).toBe('AUDIO_NOT_FOUND');

    const picked = resolveAudioMatches(project, REQUESTS, { 1: extra.id });
    expect(picked.rows[0]!.asset?.id).toBe(extra.id);
    expect(picked.rows[0]!.automatic).toBe(false);
    expect(picked.rows[0]!.issue).toBeNull();
  });

  it('refuses a stale manual selection', () => {
    const report = resolveAudioMatches(buildDialogueProject(), REQUESTS, {
      1: '80000000-0000-4000-8000-000000000099',
    });
    expect(report.rows[0]!.issue).toBe('AUDIO_SELECTION_MISSING');
  });

  it('parses the numbered identity and formats preview copy', () => {
    const asset = defaultAudioAssets()[0]!;
    expect(parseNumberedAudioAsset(asset)).toMatchObject({
      sequence: 1,
      roleName: '张三',
    });
    expect(assetFileName(asset)).toBe('001_张三.wav');
    expect(formatDurationMs(1420)).toBe('1.42s');
    expect(formatDurationMs(3000)).toBe('3.00s');
  });

  it('keeps global ordinals 1..N across Shot boundaries', () => {
    const blocks = parseMultiSceneInput(TWO_BLOCKS);
    expect(blocks.flatMap((block) => block.dialogues.map((line) => line.ordinal))).toEqual([
      1, 2, 3, 4,
    ]);
  });
});
