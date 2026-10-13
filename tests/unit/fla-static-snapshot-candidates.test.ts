import { describe, expect, it } from 'vitest';
import type {
  FlaRenderableTargetCatalogEntry,
  FlaRenderableTargetCatalogRole,
} from '../../src/shared/fla-static-snapshot-api';
import {
  flaStaticSnapshotCandidateKey,
  groupFlaStaticSnapshotCandidates,
} from '../../src/renderer/fla-import/fla-static-snapshot-candidates';

function entry(
  id: string,
  userLabel: string,
  options: {
    catalogRole?: FlaRenderableTargetCatalogRole;
    frameIndex?: number;
    isBlank?: boolean;
    previewSupported?: boolean;
  } = {},
): FlaRenderableTargetCatalogEntry {
  const previewSupported = options.previewSupported ?? true;
  return {
    target: {
      renderTargetId: `fla-render-target-${id}`,
      kind: 'graphic-symbol',
      userLabel,
      sourceLibraryItemName: userLabel,
      frameCount: 3,
      selectedFrameIndex: options.frameIndex ?? 0,
      compatibility: [],
    },
    ...(options.catalogRole ? { catalogRole: options.catalogRole } : {}),
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

  it('shows supported Scene-referenced compositions first without changing order as previews settle', () => {
    const graphicState = entry('aaaaaaaa', '路人件', { catalogRole: 'graphic-state' });
    const scene = entry('bbbbbbbb', '主场景', { catalogRole: 'scene' });
    const unsupportedRoot = entry('cccccccc', '不支持的引用', {
      catalogRole: 'scene-referenced-graphic',
      previewSupported: false,
    });
    const supportedRoot = entry('dddddddd', '可用的引用', { catalogRole: 'scene-referenced-graphic' });
    const sameSha256 = 'a'.repeat(64);

    const groups = groupFlaStaticSnapshotCandidates(
      [graphicState, scene, unsupportedRoot, supportedRoot],
      {
        [flaStaticSnapshotCandidateKey(scene)]: { status: 'supported', sha256: sameSha256 },
        [flaStaticSnapshotCandidateKey(supportedRoot)]: { status: 'supported', sha256: sameSha256 },
      },
    );

    expect(groups.map((group) => group.catalogRole)).toEqual([
      'scene-referenced-graphic',
      'scene-referenced-graphic',
      'scene',
      'graphic-state',
    ]);
    expect(groups[0]?.entries[0]).toBe(supportedRoot);
    expect(groups.map((group) => group.entries[0])).toEqual([
      supportedRoot,
      unsupportedRoot,
      scene,
      graphicState,
    ]);
  });

  it('keeps identical previews in separate roles and keeps each authored frame identity filterable', () => {
    const scene = entry('shared', '主场景', { catalogRole: 'scene' });
    const frameZero = entry('shared', '袖口', {
      catalogRole: 'graphic-state',
      frameIndex: 0,
    });
    const frameTwo = entry('shared', '袖口', {
      catalogRole: 'graphic-state',
      frameIndex: 2,
    });
    const sameSha256 = 'b'.repeat(64);
    const previews = {
      [flaStaticSnapshotCandidateKey(scene)]: { status: 'supported' as const, sha256: sameSha256 },
      [flaStaticSnapshotCandidateKey(frameZero)]: { status: 'supported' as const, sha256: sameSha256 },
      [flaStaticSnapshotCandidateKey(frameTwo)]: { status: 'supported' as const, sha256: sameSha256 },
    };

    const all = groupFlaStaticSnapshotCandidates([scene, frameZero, frameTwo], previews);
    const stateGroups = groupFlaStaticSnapshotCandidates([scene, frameZero, frameTwo], previews, '', 'graphic-states');
    const compositionGroups = groupFlaStaticSnapshotCandidates([scene, frameZero, frameTwo], previews, '', 'compositions');

    expect(all).toHaveLength(2);
    expect(all.find((group) => group.catalogRole === 'scene')?.duplicate).toBe(false);
    const authoredGroup = all.find((group) => group.catalogRole === 'graphic-state');
    expect(authoredGroup?.entries).toEqual([frameZero, frameTwo]);
    expect(authoredGroup?.duplicate).toBe(true);
    expect(new Set(authoredGroup?.entries.map(flaStaticSnapshotCandidateKey)).size).toBe(2);
    expect(stateGroups).toHaveLength(1);
    expect(stateGroups[0]?.entries).toEqual([frameZero, frameTwo]);
    expect(compositionGroups.map((group) => group.entries[0])).toEqual([scene]);
  });
});
