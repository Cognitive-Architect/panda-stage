import { describe, expect, it } from 'vitest';
import {
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { buildProject, IDS } from './domain/testProject';

const SECOND_LAYER_ID = '60000000-0000-4000-8000-000000000004';
const EXPRESSION_EVENT_ID = '90000000-0000-4000-8000-000000000004';
const HEAD_ID = '10000000-0000-4000-8000-000000000009';

function compositeProject(options: { head?: boolean } = {}): Project {
  const base = buildProject();
  const hasHead = options.head ?? false;
  const character = base.characters[0]!;
  const characterLayer = base.shots[0]!.layers.find(
    (layer) => layer.id === IDS.layerChar,
  )!;
  return ProjectSchema.parse({
    ...base,
    assets: hasHead
      ? [
          ...base.assets,
          {
            id: HEAD_ID,
            kind: 'image' as const,
            name: 'head',
            relativePath: 'assets/head.png',
            mimeType: 'image/png',
            width: 400,
            height: 600,
          },
        ]
      : base.assets,
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
        ...(hasHead
          ? {
              head: {
                assetId: HEAD_ID,
                placement: { offsetX: 18, offsetY: -380, scale: 0.7 },
                pivot: { x: 16, y: -300 },
              },
            }
          : {}),
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
  [HEAD_ID]: 'blob:head',
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

  it('shares the Head Group and requested-time root pose across editor and Stage consumers', () => {
    const base = compositeProject({ head: true });
    const project = ProjectSchema.parse({
      ...base,
      shots: base.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === IDS.layerChar
            ? {
                ...layer,
                scaleX: 1.25,
                scaleY: 0.8,
                flipX: true,
                rotationDeg: 12,
              }
            : layer,
        ),
        timelineEvents: [
          ...shot.timelineEvents,
          {
            id: '90000000-0000-4000-8000-000000000014',
            type: 'move' as const,
            layerId: IDS.layerChar,
            startMs: 0,
            endMs: 1_000,
            from: { x: 500, y: 600 },
            to: { x: 640, y: 720 },
            easing: 'linear' as const,
          },
        ],
      })),
    });
    const editorStore = new EditorProjectStore();
    editorStore.open('D:\\H03.pandastage', project);
    const projectSnapshot = editorStore.getSnapshot()!;
    const historySnapshot = editorStore.history.getSnapshot();
    const renderProject = projectSnapshot.project;
    const shot = renderProject.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 1_000, renderProject);
    const before = JSON.stringify(renderProject);
    const editor = buildEditorStageRenderModel(renderProject, shot, evaluated);
    const stage = buildStageRenderModel(renderProject, evaluated, assetUrls);
    const editorLayer = editor.layers.find(
      (layer) => layer.layer.id === IDS.layerChar,
    )!;
    const stageLayer = stage.layers.find((layer) => layer.id === IDS.layerChar)!;
    const evaluatedLayer = evaluated.layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;

    expect(stage.timeMs).toBe(1_000);
    expect(stage.layers).toHaveLength(shot.layers.length);
    expect(stageLayer.parts.map((part) => [part.id, part.slot])).toEqual([
      [`${IDS.layerChar}:body`, 'body'],
      [`${IDS.layerChar}:head`, 'head'],
      [`${IDS.layerChar}:face`, 'face'],
    ]);
    expect(stageLayer.visual?.headGroup).toEqual(editorLayer.visual.headGroup);
    expect(stageLayer.visual?.headGroup?.partIds).toEqual([
      `${IDS.layerChar}:head`,
      `${IDS.layerChar}:face`,
    ]);
    expect(stageLayer.parts.map((part) => part.render.x)).toEqual(
      editorLayer.visual.parts.map((part) => part.localRect.x),
    );
    expect(stageLayer.parts.map((part) => part.render.y)).toEqual(
      editorLayer.visual.parts.map((part) => part.localRect.y),
    );
    expect(stageLayer.render).toMatchObject({
      x: evaluatedLayer.x,
      y: evaluatedLayer.y,
      scaleX: -evaluatedLayer.scaleX,
      scaleY: evaluatedLayer.scaleY,
      rotationDeg: evaluatedLayer.rotationDeg,
      opacity: evaluatedLayer.opacity,
    });
    expect(stageLayer.parts.every((part) => part.render.opacity === 1)).toBe(
      true,
    );
    expect(stageLayer.visual?.ownerLayerId).toBe(IDS.layerChar);
    expect(stageLayer.parts.every((part) =>
      part.id.startsWith(`${IDS.layerChar}:`),
    )).toBe(true);
    expect(shot.layers.map((layer) => layer.id)).toEqual(
      base.shots[0]!.layers.map((layer) => layer.id),
    );
    expect(JSON.stringify(renderProject)).toBe(before);
    expect(editorStore.getSnapshot()).toBe(projectSnapshot);
    expect(editorStore.history.getSnapshot()).toBe(historySnapshot);
    expect(projectSnapshot).toMatchObject({ dirty: false, revision: 0 });
  });
});
