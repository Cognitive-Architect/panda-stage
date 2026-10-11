import { describe, expect, it } from 'vitest';
import type { FlaRenderableTargetCatalogEntry } from '../../src/shared/fla-static-snapshot-api';
import {
  flaStaticSnapshotCandidateKey,
  groupFlaStaticSnapshotCandidates,
} from '../../src/renderer/fla-import/fla-static-snapshot-candidates';

function entry(
  id: string,
  userLabel: string,
  options: { isBlank?: boolean; previewSupported?: boolean } = {},
): FlaRenderableTargetCatalogEntry {
  const previewSupported = options.previewSupported ?? true;
  return {
    target: {
      renderTargetId: `fla-render-target-${id}`,
      kind: 'graphic-symbol',
      userLabel,
      frameCount: 1,
      selectedFrameIndex: 0,
      compatibility: [],
    },
    previewSupported,
    isBlank: options.isBlank ?? false,
    ...(!previewSupported ? { unsupportedReason: 'unsupported test candidate' } : {}),
  };
}

describe('FLA static snapshot candidate grouping', () => {
  it('groups only byte-identical previews and keeps each source candidate identity', () => {
    const first = entry('aaaaaaaa', '手部');
    const duplicate = entry('bbbbbbbb', '袖口');
    const different = entry('cccccccc', '发饰');
    const sameSha256 = 'a'.repeat(64);

    const groups = groupFlaStaticSnapshotCandidates(
      [first, duplicate, different],
      {
        [flaStaticSnapshotCandidateKey(first)]: { status: 'supported', sha256: sameSha256 },
        [flaStaticSnapshotCandidateKey(duplicate)]: { status: 'supported', sha256: sameSha256 },
        [flaStaticSnapshotCandidateKey(different)]: { status: 'supported', sha256: 'b'.repeat(64) },
      },
    );

    const duplicateGroup = groups.find((group) => group.duplicate);
    expect(groups).toHaveLength(2);
    expect(duplicateGroup?.sourceCount).toBe(2);
    expect(duplicateGroup?.entries).toEqual([first, duplicate]);
    expect(groups.some((group) => group.entries.includes(different))).toBe(true);
  });

  it('keeps unsupported and blank candidates visible but out of supported selection groups', () => {
    const supported = entry('aaaaaaaa', '主体');
    const unsupported = entry('bbbbbbbb', '渐变装饰', { previewSupported: false });
    const blank = entry('cccccccc', '内部空帧', { isBlank: true });

    const groups = groupFlaStaticSnapshotCandidates(
      [supported, unsupported, blank],
      {
        [flaStaticSnapshotCandidateKey(supported)]: { status: 'supported', sha256: 'a'.repeat(64) },
      },
    );

    expect(groups.map((group) => group.entries[0])).toEqual([supported, unsupported, blank]);
    expect(groups.map((group) => group.status)).toEqual(['supported', 'unsupported', 'blank']);
  });
});
