import { describe, expect, it } from 'vitest';
import type { FlaRenderableTargetCatalogEntry } from '../../src/shared/fla-static-snapshot-api';
import { isR05SafeGraphicCandidateId } from '../../src/shared/fla-character-import-safe-graphic-targets';
import {
  getCharacterImportEntries,
  getSelectableCharacterImportCandidateCount,
  getUniqueCharacterImportCandidate,
} from '../../src/renderer/features/fla-import/fla-character-import-model';

function entry(
  suffix: string,
  kind: FlaRenderableTargetCatalogEntry['target']['kind'],
  previewSupported = true,
  isBlank = false,
  renderTargetId = `fla-render-target-${suffix}`,
  catalogRole?: FlaRenderableTargetCatalogEntry['catalogRole'],
): FlaRenderableTargetCatalogEntry {
  return {
    target: {
      renderTargetId,
      kind,
      userLabel: `Candidate ${suffix}`,
      frameCount: 1,
      compatibility: [],
    },
    previewSupported,
    isBlank,
    ...(catalogRole ? { catalogRole } : {}),
    ...(!previewSupported ? { unsupportedReason: 'Unsupported fixture.' } : {}),
  };
}

describe('F1-04 character target selection', () => {
  it('keeps Scene targets and only the two source-bound R05 Graphic roots', () => {
    const scene = entry('scene0001', 'scene');
    const graphic = entry('graphic01', 'graphic-symbol');
    const com2 = entry(
      'com2', 'graphic-symbol', true, false,
      'fla-render-target-e5db7116dc714b4d5dd6d71a8a711899bfd1d9d28efb9a3974978657b2d885fe',
      'scene-referenced-graphic',
    );
    const com12 = entry(
      'com12', 'graphic-symbol', true, false,
      'fla-render-target-43c0a17a5afe9d43579b7e14d0b40cc6b788defbb79afa6a2704c235c8c6324e',
      'scene-referenced-graphic',
    );
    const unsupportedCom20 = entry(
      'com20', 'graphic-symbol', false, false,
      'fla-render-target-c9dd05a67121cb1500b7ff28946b1aaefe374a04e242655ad818103dacaaabea',
      'scene-referenced-graphic',
    );
    const unrelatedRoot = entry(
      'other-root', 'graphic-symbol', true, false,
      'fla-render-target-other-root0000',
      'scene-referenced-graphic',
    );
    const timeline = entry('timeline1', 'timeline');

    expect(getCharacterImportEntries([
      scene, graphic, com2, com12, unsupportedCom20, unrelatedRoot, timeline,
    ])).toEqual([scene, com2, com12]);
  });

  it('auto-prepares the only supported, nonblank Scene candidate', () => {
    const supported = entry('scene0001', 'scene');
    const unsupported = entry('scene0002', 'scene', false);
    const blank = entry('scene0003', 'scene', true, true);
    const nonScene = entry('graphic01', 'graphic-symbol');
    const entries = [supported, unsupported, blank, nonScene];

    expect(getUniqueCharacterImportCandidate(entries)).toBe(supported);
    expect(getSelectableCharacterImportCandidateCount(entries)).toBe(1);
  });

  it('requires user choice when more than one supported Scene is present', () => {
    const first = entry('scene0001', 'scene');
    const second = entry('scene0002', 'scene');

    expect(getUniqueCharacterImportCandidate([first, second])).toBeNull();
    expect(getSelectableCharacterImportCandidateCount([first, second])).toBe(2);
  });

  it('does not treat an allowed source ID as safe when it is not a scene-referenced Graphic', () => {
    const graphic = entry(
      'com2', 'graphic-symbol', true, false,
      'fla-render-target-e5db7116dc714b4d5dd6d71a8a711899bfd1d9d28efb9a3974978657b2d885fe',
    );
    expect(isR05SafeGraphicCandidateId(graphic.target.renderTargetId)).toBe(true);
    expect(getCharacterImportEntries([graphic])).toEqual([]);
  });
});
