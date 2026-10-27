import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  scanAssetReferences,
  type AnimationDefinition,
} from '../../../src/domain';
import { buildProject, buildProjectWithAnimation, IDS } from './testProject';

const frameSha = 'a'.repeat(64);

function animation(): AnimationDefinition {
  const frameDurationMs = 1_000 / 12;
  return {
    id: '70000000-0000-4000-8000-000000000001',
    name: 'walk',
    source: {
      basename: 'walk.fla',
      sha256: 'b'.repeat(64),
      renderTargetId: 'fla-render-target-test-walk',
      targetKind: 'graphic-symbol',
      targetName: 'Walk',
      startFrameIndex: 4,
      endFrameIndex: 5,
      sourceFps: 12,
      canvas: { width: 1920, height: 1080 },
      documentCanvas: { width: 1920, height: 1080 },
      anchor: { x: 960, y: 540 },
    },
    durationMs: 2 * frameDurationMs,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 4,
        assetId: IDS.assetBg,
        sha256: frameSha,
        sourceViewport: { x: 960, y: 540, width: 1920, height: 1080 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: frameDurationMs,
        createdBySequenceImport: true,
      },
      {
        ordinal: 1,
        sourceFrameIndex: 5,
        assetId: IDS.assetBg,
        sha256: frameSha,
        sourceViewport: { x: 960, y: 540, width: 1920, height: 1080 },
        offset: { x: 0, y: 0 },
        startMs: frameDurationMs,
        durationMs: frameDurationMs,
        createdBySequenceImport: false,
      },
    ],
  };
}

function projectWithAnimation(nextAnimation = animation()) {
  const project = buildProject();
  return {
    ...project,
    assets: project.assets.map((asset) =>
      asset.id === IDS.assetBg ? { ...asset, sha256: frameSha } : asset,
    ),
    animations: [nextAnimation],
  };
}

describe('formal AnimationDefinition', () => {
  it('accepts repeated frame image references and records each source frame timing', () => {
    const project = ProjectSchema.parse(projectWithAnimation());
    const references = scanAssetReferences(project, IDS.assetBg);

    expect(project.animations[0]?.frames.map((frame) => frame.assetId)).toEqual([
      IDS.assetBg,
      IDS.assetBg,
    ]);
    expect(references.filter((reference) => reference.kind === 'animation-frame'))
      .toHaveLength(2);
  });

  it('rejects missing, non-image, or hash-mismatched frame assets', () => {
    const missingAsset = animation();
    missingAsset.frames[0]!.assetId = '70000000-0000-4000-8000-000000000099';
    expect(ProjectSchema.safeParse(projectWithAnimation(missingAsset)).success)
      .toBe(false);

    const wrongHash = animation();
    wrongHash.frames[0]!.sha256 = 'c'.repeat(64);
    expect(ProjectSchema.safeParse(projectWithAnimation(wrongHash)).success)
      .toBe(false);
  });

  it('rejects discontinuous source indices and timing that disagrees with source FPS', () => {
    const discontinuous = animation();
    discontinuous.frames[1]!.sourceFrameIndex = 7;
    expect(ProjectSchema.safeParse(projectWithAnimation(discontinuous)).success)
      .toBe(false);

    const wrongTiming = animation();
    wrongTiming.frames[1]!.durationMs += 1;
    expect(ProjectSchema.safeParse(projectWithAnimation(wrongTiming)).success)
      .toBe(false);
  });

  it('requires each animation layer to reference a valid definition and an in-range start time', () => {
    const project = buildProjectWithAnimation();
    const shot = project.shots[0]!;
    const layer = {
      id: '70000000-0000-4000-8000-000000000002',
      name: 'walk instance',
      source: { kind: 'animation' as const, animationId: IDS.animation as string },
      startTimeMs: 1_000,
      anchor: 'center' as const,
      x: 500,
      y: 500,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      flipX: false,
      zIndex: 3,
    };
    const withLayer = (nextLayer: typeof layer) =>
      ProjectSchema.safeParse({
        ...project,
        shots: [{ ...shot, layers: [...shot.layers, nextLayer] }],
      }).success;

    expect(withLayer(layer)).toBe(true);
    expect(
      withLayer({
        ...layer,
        source: {
          kind: 'animation',
          animationId: '70000000-0000-4000-8000-000000000099',
        },
      }),
    ).toBe(false);
    expect(
      ProjectSchema.safeParse({
        ...project,
        shots: [{
          ...shot,
          layers: [
            ...shot.layers,
            { ...layer, startTimeMs: shot.durationMs + 1 },
          ],
        }],
      }).success,
    ).toBe(false);
    const { startTimeMs: _startTimeMs, ...missingStart } = layer;
    void _startTimeMs;
    expect(withLayer(missingStart as typeof layer)).toBe(false);
  });
});
