import { describe, expect, it } from 'vitest';
import type { FlaRenderableTargetCatalogEntry } from '../../src/shared/fla-static-snapshot-api';
import {
  getCharacterImportSceneEntries,
  getSelectableCharacterImportCandidateCount,
  getUniqueCharacterImportCandidate,
} from '../../src/renderer/features/fla-import/fla-character-import-model';

function entry(
  suffix: string,
  kind: FlaRenderableTargetCatalogEntry['target']['kind'],
  previewSupported = true,
  isBlank = false,
): FlaRenderableTargetCatalogEntry {
  return {
    target: {
      renderTargetId: `fla-render-target-${suffix}`,
      kind,
      userLabel: `Candidate ${suffix}`,
      frameCount: 1,
      compatibility: [],
    },
    previewSupported,
    isBlank,
    ...(!previewSupported ? { unsupportedReason: 'Unsupported fixture.' } : {}),
  };
}

describe('F1-04 character target selection', () => {
  it('limits import choices to actual Scene targets accepted by F1-02', () => {
    const scene = entry('scene0001', 'scene');
    const graphic = entry('graphic01', 'graphic-symbol');
    const timeline = entry('timeline1', 'timeline');

    expect(getCharacterImportSceneEntries([scene, graphic, timeline])).toEqual([scene]);
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
});
