import { describe, expect, it } from 'vitest';
import {
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  ProjectSchema,
} from '../../src/domain';
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
  it('feeds evaluated temporal pose into the editor model while retaining the base layer', () => {
    const evaluated = evaluateShotAtTime(PROBE_SHOT, 1_500, PROBE_PROJECT);
    const model = buildEditorStageRenderModel(
      PROBE_PROJECT,
      PROBE_SHOT,
      evaluated,
    );
    const character = model.layers.find(
      (layer) => layer.layer.id === PROBE_CHARACTER_LAYER_ID,
    )!;

    expect(character.layer.x).toBe(430);
    expect(character.evaluated.x).toBe(960);
    expect(character.render.x).toBe(960);
    expect(character.render.y).toBe(690);
    expect(character.evaluated).toEqual(
      evaluated.layers.find((layer) => layer.id === PROBE_CHARACTER_LAYER_ID),
    );
  });

  it('maps every evaluated display field without changing the editable base layer', () => {
    const project = ProjectSchema.parse({
      ...PROBE_PROJECT,
      shots: PROBE_PROJECT.shots.map((shot) => ({
        ...shot,
        timelineEvents: [
          ...shot.timelineEvents,
          {
            id: '40000000-0000-4000-8000-000000000011',
            type: 'scale' as const,
            layerId: PROBE_CHARACTER_LAYER_ID,
            startMs: 0,
            endMs: 3_000,
            from: { x: 0.72, y: 0.72 },
            to: { x: 1.2, y: 0.9 },
            easing: 'linear' as const,
          },
          {
            id: '40000000-0000-4000-8000-000000000012',
            type: 'opacity' as const,
            layerId: PROBE_CHARACTER_LAYER_ID,
            startMs: 0,
            endMs: 3_000,
            from: 1,
            to: 0.25,
            easing: 'linear' as const,
          },
          {
            id: '40000000-0000-4000-8000-000000000013',
            type: 'flip' as const,
            layerId: PROBE_CHARACTER_LAYER_ID,
            startMs: 1_000,
            endMs: 1_000,
            axis: 'horizontal' as const,
            flipped: true,
          },
          {
            id: '40000000-0000-4000-8000-000000000014',
            type: 'visibility' as const,
            layerId: PROBE_CHARACTER_LAYER_ID,
            startMs: 1_000,
            endMs: 1_000,
            visible: false,
          },
          {
            id: '40000000-0000-4000-8000-000000000015',
            type: 'shake' as const,
            layerId: PROBE_CHARACTER_LAYER_ID,
            startMs: 0,
            endMs: 3_000,
            amplitudeX: 8,
            amplitudeY: 4,
            frequencyHz: 1,
          },
        ],
      })),
    });
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 1_500, project);
    const editor = buildEditorStageRenderModel(project, shot, evaluated);
    const character = editor.layers.find(
      (layer) => layer.layer.id === PROBE_CHARACTER_LAYER_ID,
    )!;
    const evaluatedLayer = evaluated.layers.find(
      (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
    )!;

    expect(character.layer.x).toBe(430);
    expect(character.render).toMatchObject({
      x: evaluatedLayer.x,
      y: evaluatedLayer.y,
      scaleX: -evaluatedLayer.scaleX,
      scaleY: evaluatedLayer.scaleY,
      opacity: evaluatedLayer.opacity,
      visible: false,
    });
  });

  it('keeps a fixed 1920x1080 logical coordinate system', () => {
    const model = buildStageRenderModel(
      PROBE_PROJECT,
      evaluateShotAtTime(PROBE_SHOT, 1_500, PROBE_PROJECT),
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
    const evaluated = evaluateShotAtTime(PROBE_SHOT, 750, PROBE_PROJECT);
    const model = buildStageRenderModel(PROBE_PROJECT, evaluated, assetUrls);

    expect(model.layers).toEqual(
      evaluated.layers.map((layer) =>
        expect.objectContaining({ id: layer.id, x: layer.x, y: layer.y }),
      ),
    );
  });

  it('passes the additive display Position from the formal evaluator to the stage consumer', () => {
    const project = ProjectSchema.parse({
      ...PROBE_PROJECT,
      shots: PROBE_PROJECT.shots.map((shot) =>
        shot.id === PROBE_SHOT.id
          ? {
              ...shot,
              timelineEvents: [
                {
                  id: '40000000-0000-4000-8000-000000000021',
                  type: 'move' as const,
                  layerId: PROBE_CHARACTER_LAYER_ID,
                  startMs: 0,
                  endMs: 3_000,
                  from: { x: 430, y: 690 },
                  to: { x: 1_490, y: 690 },
                  easing: 'linear' as const,
                },
                {
                  id: '40000000-0000-4000-8000-000000000022',
                  type: 'shake' as const,
                  layerId: PROBE_CHARACTER_LAYER_ID,
                  startMs: 0,
                  endMs: 1_000,
                  amplitudeX: 20,
                  amplitudeY: 0,
                  frequencyHz: 1,
                },
              ],
            }
          : shot,
      ),
    });
    const shot = project.shots[0]!;
    const evaluated = evaluateShotAtTime(shot, 250, project);
    const evaluatedLayer = evaluated.layers.find(
      (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
    )!;
    const model = buildStageRenderModel(project, evaluated, assetUrls);
    const renderedLayer = model.layers.find(
      (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
    )!;

    expect(evaluatedLayer.x).toBeCloseTo(538.3333333333, 10);
    expect(renderedLayer.x).toBe(evaluatedLayer.x);
    expect(renderedLayer.render.x).toBe(evaluatedLayer.x);
    expect(shot.layers.find((layer) => layer.id === PROBE_CHARACTER_LAYER_ID)?.x).toBe(430);
  });

  it('moves the probe character from left to right over three seconds', () => {
    const start = evaluateShotAtTime(PROBE_SHOT, 0, PROBE_PROJECT).layers.find(
      (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
    );
    const end = evaluateShotAtTime(PROBE_SHOT, 3_000, PROBE_PROJECT).layers.find(
      (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
    );

    expect(start?.x).toBe(430);
    expect(end?.x).toBe(1_490);
    expect(end?.x).toBeGreaterThan(start?.x ?? Number.POSITIVE_INFINITY);
  });

  it('renders a background before the transparent PNG character', () => {
    const model = buildStageRenderModel(
      PROBE_PROJECT,
      evaluateShotAtTime(PROBE_SHOT, 0, PROBE_PROJECT),
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
        evaluateShotAtTime(PROBE_SHOT, 0, PROBE_PROJECT),
        { [PROBE_BACKGROUND_ASSET_ID]: 'probe/stage-background.svg' },
      ),
    ).toThrowError(StageAssetError);
    expect(() =>
      buildStageRenderModel(
        PROBE_PROJECT,
        evaluateShotAtTime(PROBE_SHOT, 0, PROBE_PROJECT),
        { [PROBE_BACKGROUND_ASSET_ID]: 'probe/stage-background.svg' },
      ),
    ).toThrow(/透明熊猫角色.*probe\/panda-character\.png/);
  });
});
