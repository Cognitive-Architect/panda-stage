import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  evaluateShotAtTime,
  resolveLayerVisualParts,
} from '../../src/domain';
import {
  layerPointToSource,
  sourcePointToLayer,
} from '../../src/renderer/features/canvas/partPoseCanvasGeometry';
import {
  adaptivePartsFixture,
  adaptivePartsSourceRootTransform,
} from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './domain/testProject';

describe('Part pose canvas geometry', () => {
  it('round-trips source pivots through crop, mirror, root, and shear transforms', () => {
    const parts = adaptivePartsFixture(IDS.assetChar).map((part, index) =>
      index === 0
        ? {
            ...part,
            restTransform: { ...part.restTransform, b: 0.1, c: 0.25 },
            imageMapping: {
              ...part.imageMapping,
              sourceHeight: 800,
              crop: { x: 0, y: 80, width: 640, height: 640 },
            },
          }
        : part,
    );
    const project = new CharacterService().createAdaptiveParts(buildProject(), {
      name: 'Canvas pivot mapping Character',
      sourceRootTransform: {
        ...adaptivePartsSourceRootTransform(),
        a: -1,
        b: 0.15,
        c: 0.25,
      },
      parts,
    });
    const character = project.characters.at(-1)!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const placed = new LayerService().createFromAdaptiveCharacter(
      project,
      IDS.shot,
      character.id,
      { x: 960, y: 540 },
    );
    const shot = placed.project.shots.find(
      (candidate) => candidate.id === IDS.shot,
    )!;
    const evaluated = evaluateShotAtTime(shot, 0, placed.project).layers.find(
      (layer) => layer.id === placed.layer.id,
    )!;
    const visual = resolveLayerVisualParts(placed.project, shot, evaluated);
    const partId = character.parts[0]!.partId;
    const visualPart = visual.parts.find(
      (part) =>
        part.source.kind === 'adaptive-part' &&
        part.source.characterPartId === partId,
    )!;
    const characterPart = character.parts.find(
      (part) => part.partId === partId,
    )!;
    const sourcePoint = { x: 320, y: 20 };
    const layerPoint = sourcePointToLayer(
      visualPart,
      characterPart,
      sourcePoint,
    );
    expect(layerPoint).not.toBeNull();
    const mappedSourcePoint = layerPointToSource(
      layerPoint!,
      visualPart,
      characterPart,
    );
    expect(mappedSourcePoint).not.toBeNull();
    expect(mappedSourcePoint!.x).toBeCloseTo(sourcePoint.x, 8);
    expect(mappedSourcePoint!.y).toBeCloseTo(sourcePoint.y, 8);

    const transform = visualPart.imageTransform!;
    const degeneratePart = {
      ...visualPart,
      imageTransform: { ...transform, a: 1, b: 0, c: 0, d: 0 },
    };
    expect(layerPointToSource(
      layerPoint!,
      degeneratePart,
      characterPart,
    )).toBeNull();
    const outsideLayerPoint = sourcePointToLayer(
      visualPart,
      characterPart,
      { x: -1, y: 20 },
    );
    expect(outsideLayerPoint).not.toBeNull();
    expect(layerPointToSource(
      outsideLayerPoint!,
      visualPart,
      characterPart,
    )).toBeNull();
  });
});
