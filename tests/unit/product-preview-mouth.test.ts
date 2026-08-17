import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  evaluateShotAtTime,
  type Project,
} from '../../src/domain';
import { evaluateSubtitleAtTime } from '../../src/shared/preview/subtitle-engine';
import {
  buildProductPreviewCues,
  listProductPreviewAssetIds,
  projectProductPreviewMouth,
} from '../../src/renderer/shell/productPreviewModel';
import { buildProject, IDS } from './domain/testProject';

const MOUTH_ID = '10000000-0000-4000-8000-000000000301';
const AUDIO_ID = '10000000-0000-4000-8000-000000000302';
const AUDIO_CLIP_ID = '70000000-0000-4000-8000-000000000301';
const SECOND_CLIP_ID = '70000000-0000-4000-8000-000000000302';
const DIALOGUE_ID = '80000000-0000-4000-8000-000000000301';
const SECOND_DIALOGUE_ID = '80000000-0000-4000-8000-000000000302';

function imageAsset(id: string, name: string): Project['assets'][number] {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    sha256: 'a'.repeat(64),
    width: 640,
    height: 640,
  };
}

function buildMouthProject(): Project {
  const base = buildProject();
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      imageAsset(MOUTH_ID, '嘴巴张开'),
      {
        id: AUDIO_ID,
        kind: 'audio',
        name: '对白音频',
        relativePath: 'assets/dialogue.wav',
        mimeType: 'audio/wav',
        sha256: 'b'.repeat(64),
        durationMs: 2_000,
      },
    ],
    characters: base.characters.map((character) => ({
      ...character,
      mouthOpenAssetId: MOUTH_ID,
    })),
    shots: base.shots.map((shot) => ({
      ...shot,
      dialogues: [
        {
          id: DIALOGUE_ID,
          characterId: IDS.character,
          voiceProfileId: IDS.voiceProfile,
          subtitleStyleId: IDS.subtitle,
          audioClipId: AUDIO_CLIP_ID,
          startMs: 500,
          endMs: 1_500,
          text: '说话',
        },
      ],
      audioClips: [
        {
          id: AUDIO_CLIP_ID,
          name: '对白音频',
          assetId: AUDIO_ID,
          startMs: 500,
          endMs: 1_500,
          offsetMs: 0,
          volume: 1,
        },
      ],
    })),
  });
}

describe('Product Preview mouth projection', () => {
  it('uses the shared half-open subtitle interval: start speaks, end restores', () => {
    const project = buildMouthProject();
    const shot = project.shots[0]!;
    const before = evaluateShotAtTime(shot, 499, project);
    const inside = evaluateShotAtTime(shot, 500, project);
    const atEnd = evaluateShotAtTime(shot, 1_500, project);

    expect(
      projectProductPreviewMouth(project, shot, before, null).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )?.assetId,
    ).toBe(IDS.assetChar);
    expect(
      projectProductPreviewMouth(
        project,
        shot,
        inside,
        DIALOGUE_ID,
      ).layers.find((layer) => layer.id === IDS.layerChar)?.assetId,
    ).toBe(MOUTH_ID);
    expect(
      projectProductPreviewMouth(project, shot, atEnd, null).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )?.assetId,
    ).toBe(IDS.assetChar);
  });

  it('changes only speaking character image ids and leaves evaluated transforms untouched', () => {
    const project = buildMouthProject();
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 800, project);
    const before = JSON.parse(JSON.stringify(evaluated));
    const projected = projectProductPreviewMouth(
      project,
      shot,
      evaluated,
      DIALOGUE_ID,
    );
    const characterLayer = projected.layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
    const backgroundLayer = projected.layers.find(
      (layer) => layer.id === IDS.layerBg,
    )!;
    expect(characterLayer.assetId).toBe(MOUTH_ID);
    expect(backgroundLayer).toEqual(
      evaluated.layers.find((layer) => layer.id === IDS.layerBg),
    );
    expect(
      projected.layers.map(({ id, assetId }) => ({ id, assetId })),
    ).toEqual(
      evaluated.layers.map(({ id, assetId }) => ({
        id,
        assetId: id === IDS.layerChar ? MOUTH_ID : assetId,
      })),
    );
    expect(evaluated).toEqual(before);
    expect(project.characters[0]!.mouthOpenAssetId).toBe(MOUTH_ID);
  });

  it('falls back without audio, mouth asset, or a valid character mouth image', () => {
    const project = buildMouthProject();
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 800, project);
    const noAudioDialogue = { ...shot.dialogues[0]! };
    delete noAudioDialogue.audioClipId;
    expect(
      projectProductPreviewMouth(
        project,
        { ...shot, dialogues: [noAudioDialogue] },
        evaluated,
        DIALOGUE_ID,
      ),
    ).toBe(evaluated);

    const noMouthCharacters = project.characters.map((character) => {
      const next = { ...character };
      delete next.mouthOpenAssetId;
      return next;
    });
    const noMouth = ProjectSchema.parse({
      ...project,
      characters: noMouthCharacters,
    });
    expect(
      projectProductPreviewMouth(noMouth, noMouth.shots[0]!, evaluated, DIALOGUE_ID),
    ).toBe(evaluated);

    const noAudioDialogues = project.shots[0]!.dialogues.map((dialogue) => {
      const next = { ...dialogue };
      delete next.audioClipId;
      return next;
    });
    const noAudio = ProjectSchema.parse({
      ...project,
      assets: project.assets.filter((asset) => asset.id !== AUDIO_ID),
      shots: project.shots.map((candidate) => ({
        ...candidate,
        dialogues: noAudioDialogues,
        audioClips: [],
      })),
    });
    expect(
      projectProductPreviewMouth(noAudio, noAudio.shots[0]!, evaluated, DIALOGUE_ID),
    ).toBe(evaluated);
  });

  it('preloads the mouth image and follows the shared subtitle winner for overlap', () => {
    const project = buildMouthProject();
    const shot = project.shots[0]!;
    const second = {
      ...shot.dialogues[0]!,
      id: SECOND_DIALOGUE_ID,
      audioClipId: SECOND_CLIP_ID,
      startMs: 700,
      endMs: 1_200,
      text: '第二句',
    };
    const overlap = ProjectSchema.parse({
      ...project,
      shots: [
        {
          ...shot,
          dialogues: [...shot.dialogues, second],
          audioClips: [
            ...shot.audioClips,
            {
              ...shot.audioClips[0]!,
              id: SECOND_CLIP_ID,
              startMs: 700,
              endMs: 1_200,
            },
          ],
        },
      ],
    });
    const overlapShot = overlap.shots[0]!;
    const winner = evaluateSubtitleAtTime(
      buildProductPreviewCues(overlapShot),
      800,
    );
    expect(winner?.id).toBe(SECOND_DIALOGUE_ID);
    const evaluated = evaluateShotAtTime(overlapShot, 800, overlap);
    expect(
      projectProductPreviewMouth(
        overlap,
        overlapShot,
        evaluated,
        winner?.id ?? null,
      ).layers.find((layer) => layer.id === IDS.layerChar)?.assetId,
    ).toBe(MOUTH_ID);
    expect(listProductPreviewAssetIds(overlap, overlapShot)).toContain(
      MOUTH_ID,
    );
  });
});
