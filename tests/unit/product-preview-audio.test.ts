import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import {
  listProductPreviewAssetIds,
  listProductPreviewAudioClips,
  selectProductPreviewAudioClipAtTime,
} from '../../src/renderer/shell/productPreviewModel';
import { buildProject, IDS } from './domain/testProject';

const MOUTH_ASSET_ID = '10000000-0000-4000-8000-000000000097';
const AUDIO_ASSET_ID = '10000000-0000-4000-8000-000000000096';
const AUDIO_CLIP_ID = '80000000-0000-4000-8000-000000000001';
const DIALOGUE_ID = '70000000-0000-4000-8000-000000000001';

describe('Day28 product preview projections', () => {
  it('preloads mouth assets and selects dialogue audio on the same integer range', () => {
    const base = buildProject();
    const project = ProjectSchema.parse({
      ...base,
      assets: [
        ...base.assets,
        {
          id: MOUTH_ASSET_ID,
          kind: 'image',
          name: 'mouth-open',
          relativePath: 'mouth.png',
          mimeType: 'image/png',
          width: 640,
          height: 640,
        },
        {
          id: AUDIO_ASSET_ID,
          kind: 'audio',
          name: 'voice.wav',
          relativePath: 'voice.wav',
          mimeType: 'audio/wav',
          sha256: 'a'.repeat(64),
          durationMs: 800,
        },
      ],
      characters: base.characters.map((character) => ({
        ...character,
        mouthOpenAssetId: MOUTH_ASSET_ID,
      })),
      shots: base.shots.map((shot) => ({
        ...shot,
        dialogues: [
          {
            id: DIALOGUE_ID,
            characterId: IDS.character,
            voiceProfileId: IDS.voiceProfile,
            subtitleStyleId: IDS.subtitle,
            startMs: 500,
            endMs: 1_500,
            text: 'voice',
            audioClipId: AUDIO_CLIP_ID,
          },
        ],
        audioClips: [
          {
            id: AUDIO_CLIP_ID,
            name: 'voice',
            assetId: AUDIO_ASSET_ID,
            startMs: 500,
            endMs: 1_300,
            offsetMs: 0,
            volume: 1,
          },
        ],
      })),
    });
    const shot = project.shots[0]!;
    expect(listProductPreviewAssetIds(project, shot)).toContain(MOUTH_ASSET_ID);
    const entries = listProductPreviewAudioClips(project, shot);
    expect(entries).toHaveLength(1);
    expect(selectProductPreviewAudioClipAtTime(entries, 500)?.clip.id).toBe(
      AUDIO_CLIP_ID,
    );
    expect(selectProductPreviewAudioClipAtTime(entries, 1_300)).toBeNull();
  });
});
