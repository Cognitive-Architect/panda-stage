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
    expect(isShotBackgroundLayer(background!)).toBe(true);
    expect(isShotBackgroundLayer(character!)).toBe(false);
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
