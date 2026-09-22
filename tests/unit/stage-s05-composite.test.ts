import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { buildProject, IDS } from './domain/testProject';

const SECOND_LAYER_ID = '60000000-0000-4000-8000-000000000004';
const EXPRESSION_EVENT_ID = '90000000-0000-4000-8000-000000000004';

function compositeProject(): Project {
  const base = buildProject();
  const character = base.characters[0]!;
  const characterLayer = base.shots[0]!.layers.find(
    (layer) => layer.id === IDS.layerChar,
  )!;
  return ProjectSchema.parse({
    ...base,
    characters: [
      {
        ...character,
        mode: 'composite' as const,
        baseAssetId: IDS.assetChar2,
        expressions: [
          {
            id: IDS.expressionNormal,
            name: 'normal-face',
            assetId: IDS.assetChar2,
          },
          {
            id: IDS.expressionAngry,
            name: 'angry-face',
            assetId: IDS.assetChar,
          },
        ],
        defaultExpressionId: IDS.expressionNormal,
        bodyAssetId: IDS.assetChar,
        facePlacement: { offsetX: 120, offsetY: -40, scale: 0.5 },
      },
    ],
    shots: base.shots.map((shot) => ({
      ...shot,
      layers: [
        ...shot.layers.map((layer) =>
          layer.id === IDS.layerChar
            ? {
                ...layer,
                opacity: 0.5,
                source: {
                  kind: 'character' as const,
                  characterId: IDS.character,
                  expressionId: IDS.expressionNormal,
                },
              }
            : layer,
        ),
        {
          ...characterLayer,
          id: SECOND_LAYER_ID,
          name: 'second composite character',
          x: 900,
          zIndex: 3,
          opacity: 0.75,
          source: {
            kind: 'character' as const,
            characterId: IDS.character,
            expressionId: IDS.expressionNormal,
          },
        },
      ],
      timelineEvents: [
        {
          id: EXPRESSION_EVENT_ID,
          type: 'expression' as const,
          layerId: IDS.layerChar,
          startMs: 1_000,
          endMs: 1_000,
          expressionId: IDS.expressionAngry,
        },
      ],
    })),
  });
}

const assetUrls = {
  [IDS.assetBg]: 'blob:bg',
  [IDS.assetChar]: 'blob:body-or-angry-face',
  [IDS.assetChar2]: 'blob:normal-face',
};

describe('BFM-S05 shared Stage composite Character model', () => {
  it('keeps Body and Face under one logical Layer with stable part ids', () => {
    const project = compositeProject();
    const shot = project.shots[0]!;
    const atStart = buildStageRenderModel(
      project,
      evaluateShotAtTime(shot, 0, project),
      assetUrls,
    );
    const atExpression = buildStageRenderModel(
      project,
      evaluateShotAtTime(shot, 1_000, project),
      assetUrls,
    );
    const firstStart = atStart.layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
    const firstExpression = atExpression.layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
    const second = atStart.layers.find(
      (layer) => layer.id === SECOND_LAYER_ID,
    )!;

    expect(firstStart.visual?.kind).toBe('composite-character');
    expect(firstStart.parts.map((part) => [part.id, part.slot])).toEqual([
      [`${IDS.layerChar}:body`, 'body'],
      [`${IDS.layerChar}:face`, 'face'],
    ]);
    expect(firstExpression.parts[1]?.id).toBe(`${IDS.layerChar}:face`);
    expect(firstExpression.parts[1]?.asset.id).toBe(IDS.assetChar);
    expect(firstStart.parts[1]?.asset.id).toBe(IDS.assetChar2);
    expect(firstStart.render.opacity).toBe(0.5);
    expect(firstStart.parts.every((part) => part.render.opacity === 1)).toBe(
      true,
    );
    expect(second.parts.map((part) => part.id)).toEqual([
      `${SECOND_LAYER_ID}:body`,
      `${SECOND_LAYER_ID}:face`,
    ]);
    expect(second.parts[0]?.id).not.toBe(firstStart.parts[0]?.id);
  });
});
