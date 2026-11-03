import Konva from 'konva';
import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  listShotRuntimeImageAssets,
  CharacterService,
  LayerService,
  projectShotMouth,
  ProjectSchema,
  resolveLayerVisualParts,
  transformPointByVisualPart,
  transformPointByVisualHeadGroup,
  adaptiveCharacterSourceAnchor,
  visualHeadGroupRenderTransform,
  visualPartRenderTransform,
  withVisualHeadGroupTransform,
  type Project,
  type CharacterPart,
} from '../../../src/domain';
import { adaptivePartsFixture } from '../../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './testProject';
import { characterPartTransformFromStaticAdjustment } from '../../../src/domain/geometry/characterPartLayout';

const BODY_ID = '10000000-0000-4000-8000-000000000004';
const HEAD_ID = '10000000-0000-4000-8000-000000000009';
const FACE_NORMAL_ID = '10000000-0000-4000-8000-000000000005';
const FACE_ANGRY_ID = '10000000-0000-4000-8000-000000000006';
const MOUTH_ID = '10000000-0000-4000-8000-000000000007';
const AUDIO_ID = '10000000-0000-4000-8000-000000000008';
const DIALOGUE_ID = '80000000-0000-4000-8000-000000000004';

function konvaCornerDeviation(
  part: Parameters<typeof visualPartRenderTransform>[0],
  width: number,
  height: number,
): number {
  const source = part.imageTransform;
  if (!source) throw new Error(`Part ${part.partId} has no source affine.`);
  const render = visualPartRenderTransform(part);
  const node = new Konva.Group({
    x: render.x,
    y: render.y,
    offsetX: render.offsetX,
    offsetY: render.offsetY,
    rotation: render.rotation,
    scaleX: render.scaleX,
    scaleY: render.scaleY,
    skewX: render.skewX ?? 0,
    skewY: render.skewY ?? 0,
  });
  const actual = node.getTransform().getMatrix();
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  let maximumDeviation = 0;
  for (const corner of corners) {
    // Independent oracle: apply the original source affine directly, without
    // calling the product's decomposition or Konva transform helper.
    const expectedX = source.a * corner.x + source.c * corner.y + source.tx;
    const expectedY = source.b * corner.x + source.d * corner.y + source.ty;
    const actualX = actual[0]! * corner.x + actual[2]! * corner.y + actual[4]!;
    const actualY = actual[1]! * corner.x + actual[3]! * corner.y + actual[5]!;
    maximumDeviation = Math.max(
      maximumDeviation,
      Math.abs(actualX - expectedX),
      Math.abs(actualY - expectedY),
    );
  }
  node.destroy();
  return maximumDeviation;
}

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
    usage: 'uncategorized',
    keywords: [],
  };
}

function compositeProject(
  options: { mouth?: boolean; head?: boolean } = {},
): Project {
  const base = buildProject();
  const mouth = options.mouth ?? true;
  const hasHead = options.head ?? false;
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
      ...(hasHead ? [imageAsset(HEAD_ID, 'head', 500, 650)] : []),
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
        ...(hasHead
          ? {
              head: {
                assetId: HEAD_ID,
                placement: { offsetX: 20, offsetY: -360, scale: 0.8 },
                pivot: { x: 15, y: -320 },
              },
            }
          : {}),
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
                role: 'dialogue',
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
      rotationDeg: 0,
      flipX: false,
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

  it('resolves Head + Face/Mouth inside one Character-local group while Body stays outside', () => {
    const project = compositeProject({ head: true });
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, project);
    const layer = evaluated.layers.find(
      (candidate) => candidate.id === IDS.layerChar,
    )!;
    const before = JSON.stringify(project);
    const visual = resolveLayerVisualParts(project, shot, layer);
    const moved = withVisualHeadGroupTransform(visual, {
      translateX: 30,
      translateY: -12,
      scaleX: 1.25,
      scaleY: 0.75,
      rotationDeg: 20,
    });
    const body = visual.parts.find((part) => part.slot === 'body')!;
    const head = visual.parts.find((part) => part.slot === 'head')!;
    const face = visual.parts.find((part) => part.slot === 'face')!;
    const headCenter = {
      x: head.localRect.x + head.localRect.width / 2,
      y: head.localRect.y + head.localRect.height / 2,
    };
    const faceCenter = {
      x: face.localRect.x + face.localRect.width / 2,
      y: face.localRect.y + face.localRect.height / 2,
    };

    expect(visual.parts.map((part) => part.slot)).toEqual([
      'body',
      'head',
      'face',
    ]);
    expect(visual.parts.map((part) => part.partId)).toEqual([
      `${IDS.layerChar}:body`,
      `${IDS.layerChar}:head`,
      `${IDS.layerChar}:face`,
    ]);
    expect(head.localRect).toEqual({
      x: -180,
      y: -620,
      width: 400,
      height: 520,
    });
    expect(visual.headGroup).toEqual({
      id: `${IDS.layerChar}:head-group`,
      pivot: { x: 15, y: -320 },
      partIds: [`${IDS.layerChar}:head`, `${IDS.layerChar}:face`],
      transform: {
        translateX: 0,
        translateY: 0,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
      },
    });
    expect(visual.resources.required).toEqual([
      { assetId: BODY_ID, reason: 'body' },
      { assetId: HEAD_ID, reason: 'head' },
      { assetId: FACE_NORMAL_ID, reason: 'active-expression' },
    ]);
    expect(
      listShotRuntimeImageAssets(project, shot).map((asset) => asset.id),
    ).toContain(HEAD_ID);
    expect(moved.parts.find((part) => part.slot === 'body')?.localRect).toEqual(
      body.localRect,
    );
    expect(moved.headGroup?.partIds).toEqual([
      head.partId,
      face.partId,
    ]);
    expect(
      transformPointByVisualHeadGroup(headCenter, moved.headGroup!),
    ).not.toEqual(headCenter);
    expect(
      transformPointByVisualHeadGroup(faceCenter, moved.headGroup!),
    ).not.toEqual(faceCenter);
    expect(visualHeadGroupRenderTransform(moved.headGroup!)).toEqual({
      x: 45,
      y: -332,
      offsetX: 15,
      offsetY: -320,
      scaleX: 1.25,
      scaleY: 0.75,
      rotation: 20,
    });
    expect(moved.combinedLocalBounds).not.toEqual(visual.combinedLocalBounds);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('applies Body placement independently in shared local geometry and bounds', () => {
    const base = compositeProject({ head: true });
    const original = base.characters[0]!;
    const project = ProjectSchema.parse({
      ...base,
      characters: [
        {
          ...original,
          bodyPlacement: { offsetX: 120, offsetY: -210, scale: 0.5 },
        },
      ],
    });
    const shot = project.shots[0]!;
    const visual = resolveLayerVisualParts(
      project,
      shot,
      evaluateShotAtTime(shot, 0, project).layers.find(
        (candidate) => candidate.id === IDS.layerChar,
      )!,
    );
    const body = visual.parts.find((part) => part.slot === 'body')!;
    const head = visual.parts.find((part) => part.slot === 'head')!;
    const face = visual.parts.find((part) => part.slot === 'face')!;

    expect(body.localRect).toEqual({
      x: -80,
      y: -460,
      width: 400,
      height: 500,
    });
    expect(visualPartRenderTransform(body)).toMatchObject({
      x: -80,
      y: -460,
      scaleX: 1,
      scaleY: 1,
    });
    expect(head.localRect).toEqual({
      x: -180,
      y: -620,
      width: 400,
      height: 520,
    });
    expect(face.localRect).toEqual({
      x: 370,
      y: -33,
      width: 100,
      height: 50,
    });
    expect(visual.headGroup?.pivot).toEqual({ x: 15, y: -320 });
    expect(visual.combinedLocalBounds).toEqual({
      x: -180,
      y: -620,
      width: 650,
      height: 660,
    });
  });

  it('applies static Head and shared Face transforms around each part center before H04', () => {
    const base = compositeProject({ head: true });
    const original = base.characters[0]!;
    if (original.mode !== 'composite' || !original.head) {
      throw new Error('Expected a headed composite Character.');
    }
    const project = ProjectSchema.parse({
      ...base,
      characters: [
        {
          ...original,
          facePlacement: {
            ...original.facePlacement,
            rotationDeg: -10,
            flipX: true,
          },
          head: {
            ...original.head,
            placement: {
              ...original.head.placement,
              rotationDeg: 90,
              flipX: true,
            },
          },
        },
      ],
    });
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 750, project);
    const layer = evaluated.layers.find(
      (candidate) => candidate.id === IDS.layerChar,
    )!;
    const visual = resolveLayerVisualParts(project, shot, layer);
    const body = visual.parts.find((part) => part.slot === 'body')!;
    const head = visual.parts.find((part) => part.slot === 'head')!;
    const face = visual.parts.find((part) => part.slot === 'face')!;
    const faceCenter = {
      x: face.localRect.x + face.localRect.width / 2,
      y: face.localRect.y + face.localRect.height / 2,
    };
    const transformedFaceEdge = transformPointByVisualPart(
      { x: faceCenter.x + face.localRect.width / 2, y: faceCenter.y },
      face,
    );

    expect(body).toMatchObject({ rotationDeg: 0, flipX: false });
    expect(head).toMatchObject({ rotationDeg: 90, flipX: true });
    expect(face).toMatchObject({ rotationDeg: -10, flipX: true });
    expect(transformPointByVisualPart(faceCenter, face)).toEqual(faceCenter);
    expect(transformedFaceEdge.x).toBeLessThan(faceCenter.x);
    expect(transformedFaceEdge.y).toBeGreaterThan(faceCenter.y);
    expect(visualPartRenderTransform(face)).toMatchObject({
      x: faceCenter.x,
      y: faceCenter.y,
      offsetX: face.localRect.width / 2,
      offsetY: face.localRect.height / 2,
      scaleX: -1,
      rotation: -10,
    });
    expect(visual.headGroup?.transform.rotationDeg).toBe(0);
    expect(visual.combinedLocalBounds.x + visual.combinedLocalBounds.width)
      .toBeGreaterThan(470);

    const mouthShot = projectShotMouth(project, shot, evaluated, DIALOGUE_ID);
    const mouthVisual = resolveLayerVisualParts(
      project,
      shot,
      mouthShot.layers.find((candidate) => candidate.id === IDS.layerChar)!,
    );
    expect(mouthVisual.parts.find((part) => part.slot === 'face')).toMatchObject({
      rotationDeg: -10,
      flipX: true,
    });
    expect(mouthVisual.headGroup?.transform.rotationDeg).toBe(0);
  });

  it('keeps static Face adjustment available without a Head or Head Group', () => {
    const base = compositeProject({ head: false, mouth: false });
    const original = base.characters[0]!;
    if (original.mode !== 'composite') {
      throw new Error('Expected a composite Character.');
    }
    const project = ProjectSchema.parse({
      ...base,
      characters: [
        {
          ...original,
          facePlacement: {
            ...original.facePlacement,
            rotationDeg: 90,
            flipX: true,
          },
        },
      ],
    });
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, project);
    const visual = resolveLayerVisualParts(
      project,
      shot,
      evaluated.layers.find((candidate) => candidate.id === IDS.layerChar)!,
    );
    const face = visual.parts.find((part) => part.slot === 'face')!;

    expect(visual.headGroup).toBeNull();
    expect(face).toMatchObject({ rotationDeg: 90, flipX: true });
    expect(visualPartRenderTransform(face).rotation).toBe(90);
  });

  it('keeps Expression and Mouth swaps under the same Head Group', () => {
    const project = compositeProject({ head: true });
    const shot = project.shots[0]!;
    const atExpression = resolveLayerVisualParts(
      project,
      shot,
      evaluateShotAtTime(shot, 500, project).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )!,
    );
    const mouthShot = projectShotMouth(
      project,
      shot,
      evaluateShotAtTime(shot, 750, project),
      DIALOGUE_ID,
    );
    const atMouth = resolveLayerVisualParts(
      project,
      shot,
      mouthShot.layers.find((layer) => layer.id === IDS.layerChar)!,
    );

    expect(atExpression.headGroup?.partIds).toEqual([
      `${IDS.layerChar}:head`,
      `${IDS.layerChar}:face`,
    ]);
    expect(atExpression.parts.find((part) => part.slot === 'face')?.assetId).toBe(
      FACE_ANGRY_ID,
    );
    expect(atMouth.headGroup).toEqual(atExpression.headGroup);
    expect(atMouth.parts.find((part) => part.slot === 'face')?.assetId).toBe(
      MOUTH_ID,
    );
    expect(atMouth.resources.required).toContainEqual({
      assetId: HEAD_ID,
      reason: 'head',
    });
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
            role: 'dialogue',
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

  it('keeps the Adaptive Character pivot fixed to source pose while a Part receives a static adjustment', () => {
    const project = buildProject();
    const created = new CharacterService().createAdaptiveParts(project, {
      name: 'Source-pivot Adaptive Character',
      sourceRootTransform: {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        tx: 790,
        ty: 47.6,
      },
      parts: adaptivePartsFixture(IDS.assetChar),
    });
    const initialCharacter = created.characters.at(-1)!;
    if (initialCharacter.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const sourcePoseParts = initialCharacter.parts.map((part) => ({
      ...part,
      sourceRestTransform: { ...part.restTransform },
      staticAdjustment: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 },
    }));
    const replaceParts = (candidate: Project, parts: CharacterPart[]): Project =>
      ProjectSchema.parse({
        ...candidate,
        characters: candidate.characters.map((character) =>
          character.id === initialCharacter.id && character.mode === 'adaptive-parts'
            ? { ...character, parts }
            : character,
        ),
      });
    const baseline = replaceParts(created, sourcePoseParts);
    const placed = new LayerService().createFromAdaptiveCharacter(
      baseline,
      IDS.shot,
      initialCharacter.id,
      { x: 960, y: 540 },
    );
    const sourcePartId = sourcePoseParts[0]!.partId;
    const adjustment = {
      offsetX: 48,
      offsetY: -24,
      scale: 1,
      rotationDeg: 0,
    };
    const editedParts = sourcePoseParts.map((part) =>
      part.partId === sourcePartId
        ? {
            ...part,
            staticAdjustment: adjustment,
            restTransform: characterPartTransformFromStaticAdjustment(
              initialCharacter.sourceRootTransform,
              part.sourceRestTransform!,
              part.imageMapping,
              adjustment,
            ),
          }
        : part,
    );
    const edited = replaceParts(placed.project, editedParts);
    const resolve = (candidate: Project) => {
      const shot = candidate.shots.find((item) => item.id === IDS.shot)!;
      const evaluated = evaluateShotAtTime(shot, 0, candidate);
      const layer = evaluated.layers.find((item) => item.id === placed.layer.id)!;
      return resolveLayerVisualParts(candidate, shot, layer);
    };
    const before = resolve(placed.project);
    const after = resolve(edited);
    const visualFor = (visual: ReturnType<typeof resolve>, partId: string) =>
      visual.parts.find((part) =>
        part.source.kind === 'adaptive-part' &&
        part.source.characterPartId === partId,
      )!;
    const beforeSelected = visualFor(before, sourcePartId);
    const afterSelected = visualFor(after, sourcePartId);

    expect(afterSelected.imageTransform!.tx - beforeSelected.imageTransform!.tx).toBeCloseTo(48, 8);
    expect(afterSelected.imageTransform!.ty - beforeSelected.imageTransform!.ty).toBeCloseTo(-24, 8);
    for (const part of sourcePoseParts.filter((candidate) => candidate.partId !== sourcePartId)) {
      expect(visualFor(after, part.partId).imageTransform).toEqual(
        visualFor(before, part.partId).imageTransform,
      );
    }
  });

  it('composes Adaptive Part crop, local affine, and source root once while retaining repeated asset identities', () => {
    const base = buildProject();
    const cropAssetId = '10000000-0000-4000-8000-000000000099';
    const cropAsset = imageAsset(cropAssetId, 'shared-cropped-part', 80, 60);
    const sourceRootTransform = {
      a: 0.9,
      b: 0.1,
      c: -0.15,
      d: 1.1,
      tx: 55,
      ty: -24,
    };
    const mapping = {
      sourceWidth: 100,
      sourceHeight: 80,
      crop: { x: 10, y: 20, width: 40, height: 30 },
      exportScale: 2,
    };
    const parts: CharacterPart[] = [
      {
        ...adaptivePartsFixture(IDS.assetChar)[0]!,
        partId: '71000000-0000-4000-8000-000000000101',
        assetId: cropAssetId,
        source: { kind: 'manual', sourceId: 'manual:shared:part-a' },
        restTransform: {
          a: 1.2,
          b: 0.2,
          c: 0.3,
          d: 0.8,
          tx: 20,
          ty: 30,
        },
        imageMapping: mapping,
        drawOrder: 0,
        visible: true,
      },
      {
        ...adaptivePartsFixture(IDS.assetChar)[1]!,
        partId: '71000000-0000-4000-8000-000000000102',
        assetId: cropAssetId,
        source: { kind: 'manual', sourceId: 'manual:shared:part-b' },
        restTransform: {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          tx: 140,
          ty: 50,
        },
        imageMapping: mapping,
        drawOrder: 1,
        visible: true,
      },
      {
        ...adaptivePartsFixture(IDS.assetChar)[2]!,
        partId: '71000000-0000-4000-8000-000000000103',
        assetId: IDS.assetChar,
        source: { kind: 'manual', sourceId: 'manual:body-arm-composite' },
        restTransform: {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          tx: 2_000,
          ty: 1_000,
        },
        drawOrder: 2,
        visible: false,
      },
    ];
    const withAsset = ProjectSchema.parse({
      ...base,
      assets: [...base.assets, cropAsset],
    });
    const characterProject = new CharacterService().createAdaptiveParts(
      withAsset,
      {
        name: 'Affine Synthetic Character',
        sourceRootTransform,
        parts,
      },
    );
    const character = characterProject.characters.at(-1)!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const placed = new LayerService().createFromAdaptiveCharacter(
      characterProject,
      IDS.shot,
      character.id,
      { x: 960, y: 540 },
    );
    const shot = placed.project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 0, placed.project);
    const layer = evaluated.layers.find((item) => item.id === placed.layer.id)!;
    const visual = resolveLayerVisualParts(placed.project, shot, layer);
    const first = visual.parts[0]!;
    const second = visual.parts[1]!;
    const hiddenComposite = visual.parts[2]!;

    expect(visual.parts.map((part) => part.drawOrder)).toEqual([0, 1, 2]);
    const sourceAnchor = adaptiveCharacterSourceAnchor(placed.project, character);
    expect(sourceAnchor.x).toBeCloseTo(1181.5, 10);
    expect(sourceAnchor.y).toBeCloseTo(1038.3, 10);
    expect(visual.parts.map((part) => part.source.kind)).toEqual([
      'adaptive-part',
      'adaptive-part',
      'adaptive-part',
    ]);
    expect(visual.parts.map((part) => part.assetId)).toEqual([
      cropAssetId,
      cropAssetId,
      IDS.assetChar,
    ]);
    expect(first.partId).not.toBe(second.partId);
    expect(first.imageTransform?.a).toBeCloseTo(0.525, 10);
    expect(first.imageTransform?.b).toBeCloseTo(0.17, 10);
    expect(first.imageTransform?.c).toBeCloseTo(0.075, 10);
    expect(first.imageTransform?.d).toBeCloseTo(0.455, 10);
    expect(first.imageTransform?.tx).toBeCloseTo(-1099.5, 10);
    expect(first.imageTransform?.ty).toBeCloseTo(-1005.7, 10);
    expect(second.imageTransform?.a).toBeCloseTo(0.45, 10);
    expect(second.imageTransform?.b).toBeCloseTo(0.05, 10);
    expect(second.imageTransform?.c).toBeCloseTo(-0.075, 10);
    expect(second.imageTransform?.d).toBeCloseTo(0.55, 10);
    expect(second.imageTransform?.tx).toBeCloseTo(-1002, 10);
    expect(second.imageTransform?.ty).toBeCloseTo(-970.3, 10);
    expect(hiddenComposite.visible).toBe(false);
    expect(visual.combinedLocalBounds.x).toBeCloseTo(-1099.5, 10);
    expect(visual.combinedLocalBounds.y).toBeCloseTo(-1005.7, 10);
    expect(visual.combinedLocalBounds.width).toBeCloseTo(133.5, 10);
    expect(visual.combinedLocalBounds.height).toBeCloseTo(72.4, 10);
    const firstOrigin = transformPointByVisualPart({ x: 0, y: 0 }, first);
    expect(firstOrigin.x).toBeCloseTo(-1099.5, 10);
    expect(firstOrigin.y).toBeCloseTo(-1005.7, 10);
    const firstRenderTransform = visualPartRenderTransform(first);
    const firstMatrix = first.imageTransform!;
    const firstDeterminant =
      firstMatrix.a * firstMatrix.d - firstMatrix.b * firstMatrix.c;
    expect(firstRenderTransform.skewX).toBeCloseTo(
      (firstMatrix.a * firstMatrix.c + firstMatrix.b * firstMatrix.d) /
        firstDeterminant,
      12,
    );
    expect(firstRenderTransform.skewX).toBeCloseTo(0.51619679, 7);
    expect(konvaCornerDeviation(
      first,
      mapping.crop.width * mapping.exportScale,
      mapping.crop.height * mapping.exportScale,
    )).toBeLessThan(1e-9);

    const mirroredPart = {
      ...first,
      partId: '71000000-0000-4000-8000-000000000104',
      imageTransform: {
        a: 0.8,
        b: 0.35,
        c: 0.9,
        d: -0.45,
        tx: -23.4,
        ty: 18.1,
      },
    };
    const mirroredMatrix = mirroredPart.imageTransform;
    const mirroredDeterminant =
      mirroredMatrix.a * mirroredMatrix.d -
      mirroredMatrix.b * mirroredMatrix.c;
    const mirroredRenderTransform = visualPartRenderTransform(mirroredPart);
    expect(mirroredDeterminant).toBeLessThan(0);
    expect(mirroredRenderTransform.scaleY).toBeLessThan(0);
    expect(mirroredRenderTransform.skewX).toBeCloseTo(
      (mirroredMatrix.a * mirroredMatrix.c +
        mirroredMatrix.b * mirroredMatrix.d) /
        mirroredDeterminant,
      12,
    );
    expect(konvaCornerDeviation(
      mirroredPart,
      mapping.crop.width * mapping.exportScale,
      mapping.crop.height * mapping.exportScale,
    )).toBeLessThan(1e-9);
    expect(visual.resources.required.map((resource) => resource.assetId)).toEqual([
      cropAssetId,
      IDS.assetChar,
    ]);

    expect(() => ProjectSchema.parse({
      ...placed.project,
      assets: placed.project.assets.map((asset) =>
        asset.id === cropAssetId ? { ...asset, width: 81 } : asset,
      ),
    })).toThrow(/Part crop mapping resolves to 80×60/u);
  });
});
