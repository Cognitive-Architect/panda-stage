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
const SECOND_MOUTH_ID = '10000000-0000-4000-8000-000000000303';
const AUDIO_ID = '10000000-0000-4000-8000-000000000302';
const AUDIO_CLIP_ID = '70000000-0000-4000-8000-000000000301';
const SECOND_CLIP_ID = '70000000-0000-4000-8000-000000000302';
const DIALOGUE_ID = '80000000-0000-4000-8000-000000000301';
const SECOND_DIALOGUE_ID = '80000000-0000-4000-8000-000000000302';
const SECOND_CHARACTER_ID = '20000000-0000-4000-8000-000000000004';
const SECOND_EXPRESSION_ID = '20000000-0000-4000-8000-000000000005';
const SECOND_VOICE_PROFILE_ID = '30000000-0000-4000-8000-000000000002';
const SECOND_LAYER_ID = '60000000-0000-4000-8000-000000000004';

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

function buildTwoCharacterMouthProject(): Project {
  const project = buildMouthProject();
  return ProjectSchema.parse({
    ...project,
    assets: [...project.assets, imageAsset(SECOND_MOUTH_ID, 'mouth-b')],
    characters: [
      ...project.characters,
      {
        id: SECOND_CHARACTER_ID,
        name: 'character-b',
        baseAssetId: IDS.assetChar2,
        defaultVoiceProfileId: SECOND_VOICE_PROFILE_ID,
        expressions: [
          {
            id: SECOND_EXPRESSION_ID,
            name: 'normal-b',
            assetId: IDS.assetChar2,
          },
        ],
        defaultExpressionId: SECOND_EXPRESSION_ID,
        defaultScale: 1,
        defaultFlipX: false,
        mouthOpenAssetId: SECOND_MOUTH_ID,
      },
    ],
    voiceProfiles: [
      ...project.voiceProfiles,
      {
        id: SECOND_VOICE_PROFILE_ID,
        name: 'voice-b',
        characterId: SECOND_CHARACTER_ID,
        locale: 'en-US',
        rate: 1,
        pitch: 0,
      },
    ],
    shots: project.shots.map((shot) => ({
      ...shot,
      dialogues: [
        ...shot.dialogues,
        {
          id: SECOND_DIALOGUE_ID,
          characterId: SECOND_CHARACTER_ID,
          voiceProfileId: SECOND_VOICE_PROFILE_ID,
          subtitleStyleId: IDS.subtitle,
          audioClipId: SECOND_CLIP_ID,
          startMs: 700,
          endMs: 1_200,
          text: 'dialogue-b',
        },
      ],
      audioClips: [
        ...shot.audioClips,
        {
          id: SECOND_CLIP_ID,
          name: 'audio-b',
          assetId: AUDIO_ID,
          startMs: 700,
          endMs: 1_200,
          offsetMs: 0,
          volume: 1,
        },
      ],
      layers: [
        ...shot.layers,
        {
          id: SECOND_LAYER_ID,
          name: 'character-b-layer',
          source: {
            kind: 'character',
            characterId: SECOND_CHARACTER_ID,
            expressionId: SECOND_EXPRESSION_ID,
          },
          anchor: 'center',
          x: 1_000,
          y: 600,
          scaleX: 0.5,
          scaleY: 0.5,
          rotationDeg: 0,
          opacity: 1,
          visible: true,
          zIndex: 3,
          locked: false,
          flipX: false,
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

  it('closes the mouth when audio ends before the subtitle interval', () => {
    const project = buildMouthProject();
    const shot = project.shots[0]!;
    const independentShot = {
      ...shot,
      audioClips: shot.audioClips.map((clip) => ({ ...clip, endMs: 1_000 })),
    };
    const evaluated = evaluateShotAtTime(independentShot, 1_200, project);

    expect(
      projectProductPreviewMouth(
        project,
        independentShot,
        evaluated,
        DIALOGUE_ID,
      ).layers.find((layer) => layer.id === IDS.layerChar)?.assetId,
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

  it('opens only the active dialogue character when two characters have mouth assets', () => {
    const project = buildTwoCharacterMouthProject();
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 800, project);
    const evaluatedA = evaluated.layers.find((layer) => layer.id === IDS.layerChar)!;
    const evaluatedB = evaluated.layers.find((layer) => layer.id === SECOND_LAYER_ID)!;

    const projectedA = projectProductPreviewMouth(
      project,
      shot,
      evaluated,
      DIALOGUE_ID,
    );
    expect(
      projectedA.layers.find((layer) => layer.id === IDS.layerChar)?.assetId,
    ).toBe(MOUTH_ID);
    expect(
      projectedA.layers.find((layer) => layer.id === SECOND_LAYER_ID),
    ).toEqual(evaluatedB);

    const projectedB = projectProductPreviewMouth(
      project,
      shot,
      evaluated,
      SECOND_DIALOGUE_ID,
    );
    expect(
      projectedB.layers.find((layer) => layer.id === SECOND_LAYER_ID)?.assetId,
    ).toBe(SECOND_MOUTH_ID);
    expect(
      projectedB.layers.find((layer) => layer.id === IDS.layerChar),
    ).toEqual(evaluatedA);
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

    // Deliberately bypass the cross-reference validator to exercise the
    // renderer's defensive fallback for malformed runtime input.
    const nonImageMouth = {
      ...project,
      characters: project.characters.map((character) => ({
        ...character,
        mouthOpenAssetId: AUDIO_ID,
      })),
    } as Project;
    expect(
      projectProductPreviewMouth(
        nonImageMouth,
        nonImageMouth.shots[0]!,
        evaluated,
        DIALOGUE_ID,
      ),
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
    const project = buildTwoCharacterMouthProject();
    const overlapShot = project.shots[0]!;
    const winnerA = evaluateSubtitleAtTime(
      buildProductPreviewCues(overlapShot),
      600,
    );
    const winnerB = evaluateSubtitleAtTime(
      buildProductPreviewCues(overlapShot),
      800,
    );
    expect(winnerA?.id).toBe(DIALOGUE_ID);
    expect(winnerB?.id).toBe(SECOND_DIALOGUE_ID);

    const evaluatedA = evaluateShotAtTime(overlapShot, 600, project);
    const projectedA = projectProductPreviewMouth(
      project,
      overlapShot,
      evaluatedA,
      winnerA?.id ?? null,
    );
    expect(
      projectedA.layers.find((layer) => layer.id === IDS.layerChar)?.assetId,
    ).toBe(MOUTH_ID);
    expect(
      projectedA.layers.find((layer) => layer.id === SECOND_LAYER_ID)?.assetId,
    ).toBe(IDS.assetChar2);

    const evaluatedB = evaluateShotAtTime(overlapShot, 800, project);
    const projectedB = projectProductPreviewMouth(
      project,
      overlapShot,
      evaluatedB,
      winnerB?.id ?? null,
    );
    expect(
      projectedB.layers.find((layer) => layer.id === IDS.layerChar)?.assetId,
    ).toBe(IDS.assetChar);
    expect(
      projectedB.layers.find((layer) => layer.id === SECOND_LAYER_ID)?.assetId,
    ).toBe(SECOND_MOUTH_ID);
    expect(listProductPreviewAssetIds(project, overlapShot)).toEqual(
      expect.arrayContaining([MOUTH_ID, SECOND_MOUTH_ID]),
    );
  });
});
