import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  ProjectSchema,
  buildEditorStageRenderModel,
  resolveLayerImageAsset,
  type Project,
} from '../../src/domain';
import {
  ProjectSchema as SharedProjectSchema,
  evaluateShotAtTime,
} from '../../src/shared/domain';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';

function models(project: Project) {
  const shot = project.shots[0]!;
  const editor = buildEditorStageRenderModel(project, shot);
  const assets = editor.layers.map(({ asset }) => ({
    id: asset.id,
    kind: 'image' as const,
    name: asset.name,
    relativePath: asset.relativePath,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
  }));
  const shared = SharedProjectSchema.parse({
    schemaVersion: 1,
    id: project.id,
    name: project.name,
    width: project.width,
    height: project.height,
    fps: project.fps,
    assets,
    shots: [
      {
        id: shot.id,
        name: shot.name,
        durationMs: shot.durationMs,
        backgroundLayerId: shot.backgroundLayerId,
        layers: shot.layers.map((layer) => {
          const asset = resolveLayerImageAsset(project, layer)!;
          return {
            id: layer.id,
            assetId: asset.id,
            name: layer.name,
            anchor: layer.anchor,
            x: layer.x,
            y: layer.y,
            scaleX: layer.scaleX,
            scaleY: layer.scaleY,
            flipX: layer.flipX,
            rotationDeg: layer.rotationDeg,
            opacity: layer.opacity,
            visible: layer.visible,
            zIndex: layer.zIndex,
          };
        }),
        timelineEvents: [],
      },
    ],
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
  const urls = Object.fromEntries(
    assets.map((asset) => [asset.id, asset.relativePath]),
  );
  const renderer = buildStageRenderModel(
    shared,
    evaluateShotAtTime(shared.shots[0]!, 0),
    urls,
  );
  return { editor, renderer };
}

function renderContracts(project: Project) {
  const { editor, renderer } = models(project);
  return {
    editor: editor.layers.map((layer) => layer.render),
    renderer: renderer.layers.map((layer) => layer.render),
  };
}

describe('shared stage layer render contract', () => {
  it('uses identical centered cover parameters for a non-16:9 background', () => {
    const project = ProjectSchema.parse(exampleProject);
    const backgroundAssetId =
      project.shots[0]!.layers[0]!.source.kind === 'asset'
        ? project.shots[0]!.layers[0]!.source.assetId
        : '';
    const square = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === backgroundAssetId && asset.kind === 'image'
          ? { ...asset, width: 1000, height: 1000 }
          : asset,
      ),
      shots: project.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === shot.backgroundLayerId
            ? { ...layer, flipX: true }
            : layer,
        ),
      })),
    });
    const contracts = renderContracts(square);

    expect(contracts.editor).toEqual(contracts.renderer);
    expect(contracts.editor[0]).toMatchObject({
      isBackground: true,
      x: 0,
      y: -420,
      width: 1920,
      height: 1920,
      coverScale: 1.92,
    });
  });

  it.each([
    { visible: false, opacity: 1 },
    { visible: true, opacity: 0.5 },
  ])(
    'preserves background visible=$visible and opacity=$opacity in both paths',
    ({ visible, opacity }) => {
      const project = ProjectSchema.parse(exampleProject);
      const configured = ProjectSchema.parse({
        ...project,
        shots: [
          {
            ...project.shots[0]!,
            layers: project.shots[0]!.layers.map((layer) =>
              layer.id === project.shots[0]!.backgroundLayerId
                ? { ...layer, visible, opacity }
                : layer,
            ),
          },
        ],
      });
      const contracts = renderContracts(configured);

      expect(contracts.editor).toEqual(contracts.renderer);
      expect(contracts.editor[0]).toMatchObject({ visible, opacity });
    },
  );

  it('preserves every ordinary layer transform and visibility field', () => {
    const project = ProjectSchema.parse(exampleProject);
    const configured = ProjectSchema.parse({
      ...project,
      shots: [
        {
          ...project.shots[0]!,
          layers: project.shots[0]!.layers.map((layer) =>
            layer.id === project.shots[0]!.backgroundLayerId
              ? layer
              : {
                  ...layer,
                  x: 777,
                  y: 333,
                  scaleX: 1.25,
                  scaleY: 0.8,
                  flipX: true,
                  rotationDeg: 17,
                  opacity: 0.4,
                  visible: false,
                },
          ),
        },
      ],
    });
    const contracts = renderContracts(configured);

    expect(contracts.editor).toEqual(contracts.renderer);
    expect(contracts.editor[1]).toMatchObject({
      isBackground: false,
      x: 777,
      y: 333,
      scaleX: -1.25,
      scaleY: 0.8,
      rotationDeg: 17,
      opacity: 0.4,
      visible: false,
    });
  });

  it('keeps ordinary-layer center and geometry stable across a flip', () => {
    const project = ProjectSchema.parse(exampleProject);
    const ordinaryId = project.shots[0]!.layers.find(
      (layer) => layer.id !== project.shots[0]!.backgroundLayerId,
    )!.id;
    const unflipped = renderContracts(project);
    const flippedProject = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === ordinaryId ? { ...layer, flipX: true } : layer,
        ),
      })),
    });
    const flipped = renderContracts(flippedProject);
    const before = unflipped.renderer.find(
      (layer) => layer.id === ordinaryId,
    )!;
    const after = flipped.renderer.find(
      (layer) => layer.id === ordinaryId,
    )!;

    expect(after).toMatchObject({
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
      offsetX: before.offsetX,
      offsetY: before.offsetY,
      scaleX: -before.scaleX,
      scaleY: before.scaleY,
    });
    expect(flipped.editor).toEqual(flipped.renderer);
  });
});
