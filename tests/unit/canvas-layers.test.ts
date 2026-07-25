import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  calculateCoverTransform,
  isShotBackgroundLayer,
  listShotImageAssets,
  resolveLayerImageAsset,
} from '../../src/domain';
import exampleProject from '../../demo-project/project-v1.example.json';

const project = ProjectSchema.parse(exampleProject);

describe('canvas layer selectors', () => {
  it('identifies only asset-backed background layers', () => {
    const [background, character] = project.shots[0]!.layers;
    expect(isShotBackgroundLayer(project.shots[0]!, background!)).toBe(
      true,
    );
    expect(isShotBackgroundLayer(project.shots[0]!, character!)).toBe(
      false,
    );
  });

  it('never infers background identity from zIndex or a layer name', () => {
    const shot = project.shots[0]!;
    const [assetLayer, contentLayer] = shot.layers;
    const noBackground = {
      ...shot,
      backgroundLayerId: null,
      layers: [
        { ...assetLayer!, name: 'background decoration', zIndex: 0 },
        { ...contentLayer!, name: '背景 foreground', zIndex: 0 },
      ],
    };

    expect(isShotBackgroundLayer(noBackground, noBackground.layers[0]!)).toBe(
      false,
    );
    expect(isShotBackgroundLayer(noBackground, noBackground.layers[1]!)).toBe(
      false,
    );
    const explicit = {
      ...noBackground,
      backgroundLayerId: noBackground.layers[0]!.id,
    };
    expect(isShotBackgroundLayer(explicit, explicit.layers[0]!)).toBe(true);
    expect(isShotBackgroundLayer(explicit, explicit.layers[1]!)).toBe(false);
  });

  it('resolves both direct assets and character expressions', () => {
    const [background, character] = project.shots[0]!.layers;
    expect(resolveLayerImageAsset(project, background!)?.name).toBe(
      'Bamboo background',
    );
    expect(resolveLayerImageAsset(project, character!)?.name).toBe(
      'Panda neutral',
    );
    expect(listShotImageAssets(project, [background!, character!])).toHaveLength(
      2,
    );
  });

  it('covers the stage with an equal-axis scale and centered crop', () => {
    expect(
      calculateCoverTransform(
        { width: 1000, height: 1000 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({
      scale: 1.92,
      width: 1920,
      height: 1920,
      x: 0,
      y: -420,
    });
    expect(
      calculateCoverTransform(
        { width: 0, height: 1000 },
        { width: 1920, height: 1080 },
      ),
    ).toBeNull();
  });
});
