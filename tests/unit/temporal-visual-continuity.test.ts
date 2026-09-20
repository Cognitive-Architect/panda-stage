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
      first.lastValidAssetIds,
    );

    expect(
      held.evaluatedShot.layers.find((layer) => layer.id === IDS.layerChar)
        ?.assetId,
    ).toBe(IDS.assetChar);
    expect(held.lastValidAssetIds.get(IDS.layerChar)).toBe(IDS.assetChar);
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
          ? { ...layer, assetId: IDS.assetChar2 }
          : layer,
      ),
    };
    const committed = resolveEditorTemporalAssetResolution(
      project,
      shot,
      target,
      new Set([IDS.assetBg, IDS.assetChar, IDS.assetChar2]),
      new Map([[IDS.layerChar, IDS.assetChar]]),
    );
    const reversed = resolveEditorTemporalAssetResolution(
      project,
      shot,
      base,
      new Set([IDS.assetBg, IDS.assetChar]),
      committed.lastValidAssetIds,
    );

    expect(
      committed.evaluatedShot.layers.find((layer) => layer.id === IDS.layerChar)
        ?.assetId,
    ).toBe(IDS.assetChar2);
    expect(
      reversed.evaluatedShot.layers.find((layer) => layer.id === IDS.layerChar)
        ?.assetId,
    ).toBe(IDS.assetChar);
  });
});
