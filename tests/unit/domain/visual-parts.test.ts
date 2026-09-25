import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  listShotRuntimeImageAssets,
  projectShotMouth,
  ProjectSchema,
  resolveLayerVisualParts,
  type Project,
} from '../../../src/domain';
import { buildProject, IDS } from './testProject';

const BODY_ID = '10000000-0000-4000-8000-000000000004';
const FACE_NORMAL_ID = '10000000-0000-4000-8000-000000000005';
const FACE_ANGRY_ID = '10000000-0000-4000-8000-000000000006';
const MOUTH_ID = '10000000-0000-4000-8000-000000000007';
const AUDIO_ID = '10000000-0000-4000-8000-000000000008';
const DIALOGUE_ID = '80000000-0000-4000-8000-000000000004';
const AUDIO_CLIP_ID = '70000000-0000-4000-8000-000000000004';
const EXPRESSION_EVENT_ID = '90000000-0000-4000-8000-000000000004';

function imageAsset(
  id: string,
  name: string,
  width: number,
  height: number,
): Project['assets'][number] {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    width,
    height,
  };
}

function compositeProject(options: { mouth?: boolean } = {}): Project {
  const base = buildProject();
  const mouth = options.mouth ?? true;
  const character = base.characters[0]!;
  const expressionNormal = {
    id: IDS.expressionNormal,
    name: 'normal-face',
    assetId: FACE_NORMAL_ID,
  };
  const expressionAngry = {
    id: IDS.expressionAngry,
    name: 'angry-face',
    assetId: FACE_ANGRY_ID,
  };
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      imageAsset(BODY_ID, 'body', 800, 1_000),
      imageAsset(FACE_NORMAL_ID, 'face-normal', 200, 100),
      imageAsset(FACE_ANGRY_ID, 'face-angry', 300, 200),
      ...(mouth ? [imageAsset(MOUTH_ID, 'mouth-open', 400, 300)] : []),
      ...(mouth
        ? [
            {
              id: AUDIO_ID,
              kind: 'audio' as const,
              name: 'voice',
              relativePath: 'assets/voice.wav',
              mimeType: 'audio/wav',
              durationMs: 1_000,
            },
          ]
        : []),
    ],
    characters: [
      {
        ...character,
        mode: 'composite' as const,
        baseAssetId: FACE_NORMAL_ID,
        expressions: [expressionNormal, expressionAngry],
        defaultExpressionId: IDS.expressionNormal,
        bodyAssetId: BODY_ID,
        facePlacement: { offsetX: 420, offsetY: -8, scale: 0.5 },
        ...(mouth ? { mouthOpenAssetId: MOUTH_ID } : {}),
      },
    ],
    shots: base.shots.map((shot) => ({
      ...shot,
      timelineEvents: [
        {
          id: EXPRESSION_EVENT_ID,
          type: 'expression' as const,
          layerId: IDS.layerChar,
          startMs: 500,
          endMs: 500,
          expressionId: IDS.expressionAngry,
        },
      ],
      ...(mouth
        ? {
            dialogues: [
              {
                id: DIALOGUE_ID,
                characterId: character.id,
                voiceProfileId: character.defaultVoiceProfileId,
                subtitleStyleId: IDS.subtitle,
                audioClipId: AUDIO_CLIP_ID,
                startMs: 0,
                endMs: 1_000,
                text: 'speaking',
              },
            ],
            audioClips: [
              {
                id: AUDIO_CLIP_ID,
                name: 'voice',
                assetId: AUDIO_ID,
                startMs: 0,
                endMs: 1_000,
                offsetMs: 0,
                volume: 1,
              },
            ],
          }
        : {}),
    })),
  });
}

describe('BFM-S03 unified visual-parts resolver', () => {
  it('resolves an ordinary image layer to one owner part without changing the Project', () => {
    const project = buildProject();
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, project);
    const layer = evaluated.layers.find(
      (candidate) => candidate.id === IDS.layerAsset,
    )!;
    const before = JSON.stringify(project);
    const visual = resolveLayerVisualParts(project, shot, layer);

    expect(visual.kind).toBe('ordinary-image');
    expect(visual.ownerLayerId).toBe(IDS.layerAsset);
    expect(visual.parts).toHaveLength(1);
    expect(visual.parts[0]).toMatchObject({
      partId: `${IDS.layerAsset}:single`,
      ownerLayerId: IDS.layerAsset,
      slot: 'single',
      assetId: IDS.assetBg,
      drawOrder: 0,
    });
    expect(visual.resources).toEqual({
      required: [{ assetId: IDS.assetBg, reason: 'current-layer' }],
      candidates: [],
      fallback: [],
    });
    expect(JSON.stringify(project)).toBe(before);
  });

  it('keeps single-image Characters as one whole-image part while Expression identity changes', () => {
    const project = buildProject();
    const shot = {
      ...project.shots[0]!,
      timelineEvents: [
        {
          id: EXPRESSION_EVENT_ID,
          type: 'expression' as const,
          layerId: IDS.layerChar,
          startMs: 500,
          endMs: 500,
          expressionId: IDS.expressionAngry,
        },
      ],
    };
    const atStart = resolveLayerVisualParts(
      project,
      shot,
      evaluateShotAtTime(shot, 0, project).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )!,
    );
    const atExpression = resolveLayerVisualParts(
      project,
      shot,
      evaluateShotAtTime(shot, 500, project).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )!,
    );

    expect(atStart.kind).toBe('single-image-character');
    expect(atStart.parts).toHaveLength(1);
    expect(atStart.parts[0]?.slot).toBe('single');
    expect(atStart.parts[0]?.partId).toBe(`${IDS.layerChar}:single`);
    expect(atStart.activeFace?.currentExpressionId).toBe(
      IDS.expressionNormal,
    );
    expect(atExpression.parts[0]?.partId).toBe(`${IDS.layerChar}:single`);
    expect(atExpression.parts[0]?.assetId).toBe(IDS.assetChar2);
    expect(atExpression.activeFace?.currentExpressionId).toBe(
      IDS.expressionAngry,
    );
  });

  it('resolves composite Body plus one placed Face and keeps root transform out of local geometry', () => {
    const project = compositeProject();
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, project);
    const layer = evaluated.layers.find(
      (candidate) => candidate.id === IDS.layerChar,
    )!;
    const visual = resolveLayerVisualParts(project, shot, layer);

    expect(visual.kind).toBe('composite-character');
    expect(visual.ownerLayerId).toBe(IDS.layerChar);
    expect(visual.ownerTransform).toMatchObject({
      x: 500,
      y: 600,
      scaleX: 0.5,
      scaleY: 0.5,
      rotationDeg: 0,
      zIndex: 2,
    });
    expect(visual.facePlacement).toEqual({
      offsetX: 420,
      offsetY: -8,
      scale: 0.5,
    });
    expect(visual.parts.map((part) => part.slot)).toEqual(['body', 'face']);
    expect(visual.parts.map((part) => part.partId)).toEqual([
      `${IDS.layerChar}:body`,
      `${IDS.layerChar}:face`,
    ]);
    expect(visual.parts[0]?.localRect).toEqual({
      x: -400,
      y: -500,
      width: 800,
      height: 1_000,
    });
    expect(visual.parts[1]?.localRect).toEqual({
      x: 370,
      y: -33,
      width: 100,
      height: 50,
    });
    expect(
      (visual.parts[1]?.localRect.x ?? 0) +
        (visual.parts[1]?.localRect.width ?? 0) / 2,
    ).toBe(420);
    expect(
      (visual.parts[1]?.localRect.y ?? 0) +
        (visual.parts[1]?.localRect.height ?? 0) / 2,
    ).toBe(-8);
    expect(visual.combinedLocalBounds).toEqual({
      x: -400,
      y: -500,
      width: 870,
      height: 1_000,
    });
    expect(visual.resources.required.map((resource) => resource.assetId)).toEqual([
      BODY_ID,
      FACE_NORMAL_ID,
    ]);
    expect(visual.resources.candidates.map((resource) => resource.assetId)).toEqual([
      FACE_ANGRY_ID,
      MOUTH_ID,
    ]);
    expect(visual.resources.fallback).toEqual([]);
  });

  it('projects Mouth onto the single Face slot and retains the current Expression fallback', () => {
    const project = compositeProject();
    const shot = project.shots[0]!;
    const formal = evaluateShotAtTime(shot, 750, project);
    const before = JSON.stringify(project);
    const projected = projectShotMouth(project, shot, formal, DIALOGUE_ID);
    const visual = resolveLayerVisualParts(
      project,
      shot,
      projected.layers.find((layer) => layer.id === IDS.layerChar)!,
    );

    expect(visual.parts).toHaveLength(2);
    expect(visual.parts.map((part) => part.slot)).toEqual(['body', 'face']);
    expect(visual.parts[0]?.assetId).toBe(BODY_ID);
    expect(visual.parts[1]?.assetId).toBe(MOUTH_ID);
    expect(visual.parts[1]?.source).toEqual({
      kind: 'character-mouth',
      assetId: MOUTH_ID,
    });
    expect(
      (visual.parts[1]?.localRect.x ?? 0) +
        (visual.parts[1]?.localRect.width ?? 0) / 2,
    ).toBe(420);
    expect(
      (visual.parts[1]?.localRect.y ?? 0) +
        (visual.parts[1]?.localRect.height ?? 0) / 2,
    ).toBe(-8);
    expect(visual.activeFace).toMatchObject({
      currentExpressionId: IDS.expressionAngry,
      currentExpressionAssetId: FACE_ANGRY_ID,
      source: 'mouth',
      assetId: MOUTH_ID,
      configuredMouthAssetId: MOUTH_ID,
      fallbackAssetId: FACE_ANGRY_ID,
    });
    expect(visual.resources.required.map((resource) => resource.assetId)).toEqual([
      BODY_ID,
      MOUTH_ID,
    ]);
    expect(visual.resources.fallback).toEqual([
      { assetId: FACE_ANGRY_ID, reason: 'current-expression-fallback' },
    ]);
    expect(visual.resources.candidates).toEqual([
      { assetId: FACE_NORMAL_ID, reason: 'alternate-expression' },
    ]);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('restores the Expression that is current when speech ends and remains deterministic at boundaries', () => {
    const project = compositeProject();
    const shot = project.shots[0]!;
    const atStart = projectShotMouth(
      project,
      shot,
      evaluateShotAtTime(shot, 0, project),
      DIALOGUE_ID,
    );
    const atEnd = projectShotMouth(
      project,
      shot,
      evaluateShotAtTime(shot, 1_000, project),
      DIALOGUE_ID,
    );
    const atDuringSpeech = projectShotMouth(
      project,
      shot,
      evaluateShotAtTime(shot, 750, project),
      DIALOGUE_ID,
    );
    const duringAgain = projectShotMouth(
      project,
      shot,
      evaluateShotAtTime(shot, 750, project),
      DIALOGUE_ID,
    );

    expect(
      resolveLayerVisualParts(
        project,
        shot,
        atStart.layers.find((layer) => layer.id === IDS.layerChar)!,
      ).parts[1]?.assetId,
    ).toBe(MOUTH_ID);
    expect(
      resolveLayerVisualParts(
        project,
        shot,
        atDuringSpeech.layers.find((layer) => layer.id === IDS.layerChar)!,
      ).activeFace?.currentExpressionId,
    ).toBe(IDS.expressionAngry);
    expect(
      resolveLayerVisualParts(
        project,
        shot,
        atEnd.layers.find((layer) => layer.id === IDS.layerChar)!,
      ).activeFace,
    ).toMatchObject({
      source: 'expression',
      assetId: FACE_ANGRY_ID,
      currentExpressionId: IDS.expressionAngry,
    });
    expect(atDuringSpeech).toEqual(duringAgain);
    expect(atEnd.layers.find((layer) => layer.id === IDS.layerChar)?.assetId).toBe(
      FACE_ANGRY_ID,
    );
  });

  it('keeps a composite without Mouth on the current Expression and enumerates Body once', () => {
    const project = compositeProject({ mouth: false });
    const shot = project.shots[0]!;
    const visual = resolveLayerVisualParts(
      project,
      shot,
      evaluateShotAtTime(shot, 750, project).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )!,
    );
    const assetIds = listShotRuntimeImageAssets(project, shot).map(
      (asset) => asset.id,
    );

    expect(visual.parts[0]?.assetId).toBe(BODY_ID);
    expect(visual.parts[1]?.assetId).toBe(FACE_ANGRY_ID);
    expect(visual.activeFace?.source).toBe('expression');
    expect(visual.resources.fallback).toEqual([]);
    expect(assetIds).toEqual(
      expect.arrayContaining([BODY_ID, FACE_NORMAL_ID, FACE_ANGRY_ID]),
    );
    expect(new Set(assetIds).size).toBe(assetIds.length);
    expect(assetIds.filter((assetId) => assetId === BODY_ID)).toHaveLength(1);
  });

  it('keeps the existing whole-image Mouth projection compatible and ignores invalid optional Mouth references in enumeration', () => {
    const base = buildProject();
    const project = ProjectSchema.parse({
      ...base,
      assets: [
        ...base.assets,
        imageAsset(MOUTH_ID, 'mouth-open', 400, 300),
        {
          id: AUDIO_ID,
          kind: 'audio' as const,
          name: 'voice',
          relativePath: 'assets/voice.wav',
          mimeType: 'audio/wav',
          durationMs: 1_000,
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
            startMs: 0,
            endMs: 1_000,
            text: 'speaking',
          },
        ],
        audioClips: [
          {
            id: AUDIO_CLIP_ID,
            name: 'voice',
            assetId: AUDIO_ID,
            startMs: 0,
            endMs: 1_000,
            offsetMs: 0,
            volume: 1,
          },
        ],
      })),
    });
    const shot = project.shots[0]!;
    const projected = projectShotMouth(
      project,
      shot,
      evaluateShotAtTime(shot, 100, project),
      DIALOGUE_ID,
    );
    const visual = resolveLayerVisualParts(
      project,
      shot,
      projected.layers.find((layer) => layer.id === IDS.layerChar)!,
    );
    const invalid = {
      ...project,
      characters: project.characters.map((character) => ({
        ...character,
        mouthOpenAssetId: AUDIO_ID,
      })),
    } as Project;

    expect(visual.kind).toBe('single-image-character');
    expect(visual.parts).toHaveLength(1);
    expect(visual.parts[0]?.assetId).toBe(MOUTH_ID);
    expect(visual.resources.fallback).toEqual([
      { assetId: IDS.assetChar, reason: 'current-expression-fallback' },
    ]);
    expect(listShotRuntimeImageAssets(invalid, shot)).not.toContain(
      project.assets.find((asset) => asset.id === AUDIO_ID),
    );
  });
});
