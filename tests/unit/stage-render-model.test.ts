import { describe, expect, it } from 'vitest';
import { evaluateShotAtTime } from '../../src/shared/domain';
import {
  PROBE_BACKGROUND_ASSET_ID,
  PROBE_CHARACTER_ASSET_ID,
  PROBE_CHARACTER_LAYER_ID,
  PROBE_PROJECT,
  PROBE_SHOT,
} from '../../src/shared/probe/probe-project';
import {
  buildStageRenderModel,
  StageAssetError,
} from '../../src/shared/stage/render-model';
import { STAGE_CAPTION_SAFE_AREA } from '../../src/shared/stage/layout';

const assetUrls = {
  [PROBE_BACKGROUND_ASSET_ID]: 'probe/stage-background.svg',
  [PROBE_CHARACTER_ASSET_ID]: 'probe/panda-character.png',
};

describe('shared stage render model', () => {
  it('keeps a fixed 1920x1080 logical coordinate system', () => {
    const model = buildStageRenderModel(
      PROBE_PROJECT,
      evaluateShotAtTime(PROBE_SHOT, 1_500),
      assetUrls,
    );
    const character = model.layers.find(
      (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
    );

    expect(model.width).toBe(1_920);
    expect(model.height).toBe(1_080);
    expect(model.timeMs).toBe(1_500);
    expect(character?.x).toBe(960);
    expect(character?.y).toBe(690);
  });

  it('uses evaluated positions without calculating animation itself', () => {
    const evaluated = evaluateShotAtTime(PROBE_SHOT, 750);
    const model = buildStageRenderModel(PROBE_PROJECT, evaluated, assetUrls);

    expect(model.layers).toEqual(
      evaluated.layers.map((layer) =>
        expect.objectContaining({ id: layer.id, x: layer.x, y: layer.y }),
      ),
    );
  });

  it('moves the probe character from left to right over three seconds', () => {
    const start = evaluateShotAtTime(PROBE_SHOT, 0).layers.find(
      (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
    );
    const end = evaluateShotAtTime(PROBE_SHOT, 3_000).layers.find(
      (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
    );

    expect(start?.x).toBe(430);
    expect(end?.x).toBe(1_490);
    expect(end?.x).toBeGreaterThan(start?.x ?? Number.POSITIVE_INFINITY);
  });

  it('renders a background before the transparent PNG character', () => {
    const model = buildStageRenderModel(
      PROBE_PROJECT,
      evaluateShotAtTime(PROBE_SHOT, 0),
      assetUrls,
    );

    expect(model.layers.map((layer) => layer.asset.id)).toEqual([
      PROBE_BACKGROUND_ASSET_ID,
      PROBE_CHARACTER_ASSET_ID,
    ]);
    expect(model.layers[1]?.asset.mimeType).toBe('image/png');
  });

  it('keeps the caption safe area fully inside the logical canvas', () => {
    expect(STAGE_CAPTION_SAFE_AREA.x).toBeGreaterThanOrEqual(0);
    expect(STAGE_CAPTION_SAFE_AREA.y).toBeGreaterThanOrEqual(0);
    expect(
      STAGE_CAPTION_SAFE_AREA.x + STAGE_CAPTION_SAFE_AREA.width,
    ).toBeLessThanOrEqual(PROBE_PROJECT.width);
    expect(
      STAGE_CAPTION_SAFE_AREA.y + STAGE_CAPTION_SAFE_AREA.height,
    ).toBeLessThanOrEqual(PROBE_PROJECT.height);
  });

  it('returns a readable error when an asset URL is missing', () => {
    expect(() =>
      buildStageRenderModel(
        PROBE_PROJECT,
        evaluateShotAtTime(PROBE_SHOT, 0),
        { [PROBE_BACKGROUND_ASSET_ID]: 'probe/stage-background.svg' },
      ),
    ).toThrowError(StageAssetError);
    expect(() =>
      buildStageRenderModel(
        PROBE_PROJECT,
        evaluateShotAtTime(PROBE_SHOT, 0),
        { [PROBE_BACKGROUND_ASSET_ID]: 'probe/stage-background.svg' },
      ),
    ).toThrow(/透明熊猫角色.*probe\/panda-character\.png/);
  });
});
