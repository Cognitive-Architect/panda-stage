import { describe, expect, it } from 'vitest';
import { evaluateShotAtTime } from '../../src/domain';
import { resolveEditorTemporalAssetResolution } from '../../src/renderer/features/canvas/temporalVisualContinuity';
import { buildProject, IDS } from './domain/testProject';

describe('Editor Live Scrub visual continuity', () => {
  it('keeps the last drawable asset while a new evaluated asset is pending', () => {
    const project = buildProject();
    const shot = project.shots[0]!;
    const base = evaluateShotAtTime(shot, 0, project);
    const pending = {
      ...base,
      timeMs: 1_000,
      layers: base.layers.map((layer) =>
        layer.id === IDS.layerChar
          ? { ...layer, assetId: IDS.assetChar2 }
          : layer,
      ),
    };

    const first = resolveEditorTemporalAssetResolution(
      project,
      shot,
      base,
      new Set([IDS.assetBg, IDS.assetChar]),
      new Map(),
    );
    const held = resolveEditorTemporalAssetResolution(
      project,
      shot,
      pending,
      new Set([IDS.assetBg, IDS.assetChar]),
      first.lastValidVisuals,
    );

    expect(
      held.evaluatedShot.layers.find((layer) => layer.id === IDS.layerChar)
        ?.assetId,
    ).toBe(IDS.assetChar);
    expect(held.lastValidVisuals.get(IDS.layerChar)?.assetId).toBe(IDS.assetChar);
  });

  it('commits the target when ready and cannot resurrect it after rapid reversal', () => {
    const project = buildProject();
    const shot = project.shots[0]!;
    const base = evaluateShotAtTime(shot, 0, project);
    const target = {
      ...base,
      timeMs: 1_000,
      layers: base.layers.map((layer) =>
        layer.id === IDS.layerChar
          ? {
              ...layer,
              assetId: IDS.assetChar2,
              x: 1200,
              scaleX: 1.25,
              scaleY: 0.9,
              rotationDeg: 18,
              opacity: 0.7,
              flipX: true,
              visible: false,
            }
          : layer,
      ),
    };
    const committed = resolveEditorTemporalAssetResolution(
      project,
      shot,
      target,
      new Set([IDS.assetBg, IDS.assetChar, IDS.assetChar2]),
      new Map([
        [
          IDS.layerChar,
          base.layers.find((layer) => layer.id === IDS.layerChar)!,
        ],
      ]),
    );
    const reversed = resolveEditorTemporalAssetResolution(
      project,
      shot,
      base,
      new Set([IDS.assetBg, IDS.assetChar]),
      committed.lastValidVisuals,
    );

    expect(
      committed.evaluatedShot.layers.find((layer) => layer.id === IDS.layerChar)
        ?.assetId,
    ).toBe(IDS.assetChar2);
    expect(
      committed.evaluatedShot.layers.find((layer) => layer.id === IDS.layerChar),
    ).toEqual(target.layers.find((layer) => layer.id === IDS.layerChar));
    expect(
      reversed.evaluatedShot.layers.find((layer) => layer.id === IDS.layerChar)
        ?.assetId,
    ).toBe(IDS.assetChar);
  });

  it('lets an unaffected sibling follow the current evaluated time', () => {
    const project = buildProject();
    const shot = project.shots[0]!;
    const base = evaluateShotAtTime(shot, 0, project);
    const pending = {
      ...base,
      timeMs: 1_000,
      layers: base.layers.map((layer) =>
        layer.id === IDS.layerChar
          ? { ...layer, assetId: IDS.assetChar2, x: 1400 }
          : layer.id === IDS.layerAsset
            ? { ...layer, x: 780 }
            : layer,
      ),
    };
    const resolved = resolveEditorTemporalAssetResolution(
      project,
      shot,
      pending,
      new Set([IDS.assetBg, IDS.assetChar]),
      new Map([
        [IDS.layerChar, base.layers.find((layer) => layer.id === IDS.layerChar)!],
      ]),
    );

    expect(
      resolved.evaluatedShot.layers.find((layer) => layer.id === IDS.layerChar),
    ).toEqual(base.layers.find((layer) => layer.id === IDS.layerChar));
    expect(
      resolved.evaluatedShot.layers.find((layer) => layer.id === IDS.layerAsset)
        ?.x,
    ).toBe(780);
  });

  it('holds the complete previous visual instead of mixing an old asset with a new pose', () => {
    const project = buildProject();
    const shot = project.shots[0]!;
    const base = evaluateShotAtTime(shot, 0, project);
    const previous = base.layers.find((layer) => layer.id === IDS.layerChar)!;
    const pending = {
      ...base,
      timeMs: 1_000,
      layers: base.layers.map((layer) =>
        layer.id === IDS.layerChar
          ? {
              ...layer,
              assetId: IDS.assetChar2,
              x: layer.x + 900,
              y: layer.y + 120,
              scaleX: 1.5,
              scaleY: 1.25,
              rotationDeg: 42,
              opacity: 0.4,
              flipX: true,
              visible: false,
              zIndex: layer.zIndex + 1,
            }
          : layer,
      ),
    };

    const held = resolveEditorTemporalAssetResolution(
      project,
      shot,
      pending,
      new Set([IDS.assetBg, IDS.assetChar]),
      new Map([[IDS.layerChar, previous]]),
    );
    const heldLayer = held.evaluatedShot.layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;

    expect(heldLayer).toEqual(previous);
    expect(held.lastValidVisuals.get(IDS.layerChar)).toEqual(previous);
  });

  it('uses a ready base visual when a target asset is missing before first paint', () => {
    const project = buildProject();
    const shot = project.shots[0]!;
    const base = evaluateShotAtTime(shot, 0, project);
    const pending = {
      ...base,
      timeMs: 1_000,
      layers: base.layers.map((layer) =>
        layer.id === IDS.layerChar
          ? { ...layer, assetId: IDS.assetChar2, x: 1490 }
          : layer,
      ),
    };

    const held = resolveEditorTemporalAssetResolution(
      project,
      shot,
      pending,
      new Set([IDS.assetBg, IDS.assetChar]),
      new Map(),
    );
    const heldLayer = held.evaluatedShot.layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;

    expect(heldLayer).toEqual(
      base.layers.find((layer) => layer.id === IDS.layerChar),
    );
    expect(held.lastValidVisuals.size).toBe(3);
  });
});
