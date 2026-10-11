import { describe, expect, it, vi } from 'vitest';
import type {
  FlaRenderableTargetCatalogEntry,
  FlaStaticSnapshotCommitResponse,
  FlaStaticSnapshotPreviewRequest,
  FlaStaticSnapshotPreviewSuccess,
} from '../../src/shared/fla-static-snapshot-api';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import {
  flaStaticSnapshotCandidateKey,
  type FlaStaticSnapshotCandidatePreviews,
} from '../../src/renderer/fla-import/fla-static-snapshot-candidates';
import { FlaStaticSnapshotPreviewQueue } from '../../src/renderer/fla-import/fla-static-snapshot-preview-transaction';
import { runFlaStaticSnapshotBatchImport } from '../../src/renderer/fla-import/FlaStaticSnapshotReview';
import type { FlaStaticSnapshotCatalogClient } from '../../src/renderer/fla-import/fla-static-snapshot-render';

const TARGET_ID_A = `fla-render-target-${'a'.repeat(64)}`;
const TARGET_ID_B = `fla-render-target-${'b'.repeat(64)}`;

function entry(targetId: string, userLabel: string): FlaRenderableTargetCatalogEntry {
  return {
    target: {
      renderTargetId: targetId,
      kind: 'graphic-symbol',
      userLabel,
      frameCount: 1,
      selectedFrameIndex: 0,
      compatibility: ['exact'],
    },
    previewSupported: true,
    isBlank: false,
  };
}

function responseForPreview(request: FlaStaticSnapshotPreviewRequest): FlaStaticSnapshotPreviewSuccess {
  return {
    ok: true,
    requestId: request.requestId,
    targetRenderTargetId: request.target.renderTargetId,
    targetSelectedFrameIndex: request.target.selectedFrameIndex ?? 0,
    width: 332,
    height: 673,
    pixelCount: 332 * 673,
    bytes: new Uint8Array([1, 2, 3]),
    sha256: 'c'.repeat(64),
    wallClockMs: 1,
    isFirstPreviewForSession: false,
    startedAt: '2026-10-11T00:00:00.000Z',
  };
}

function commitResponse(status: 'imported' | 'duplicate' = 'imported'): FlaStaticSnapshotCommitResponse {
  return {
    ok: true,
    status: 'completed',
    project: {} as never,
    baseRevision: 0,
    savedRevision: 1,
    projectChanged: status === 'imported',
    result: {
      assetId: '7f1e0000-0000-4000-8000-000000000111',
      sourceName: 'real-character.fla',
      width: 332,
      height: 673,
      status,
      sha256: 'c'.repeat(64),
      asset: {} as never,
      duplicateOfAssetId: status === 'duplicate' ? '7f1e0000-0000-4000-8000-000000000112' : null,
      targetFileName: 'candidate.png',
      renamed: false,
      message: status === 'imported' ? '素材已导入。' : '已复用已有素材。',
    },
  } as FlaStaticSnapshotCommitResponse;
}

function createContext() {
  const first = entry(TARGET_ID_A, 'candidate A');
  const second = entry(TARGET_ID_B, 'candidate B');
  const previews: FlaStaticSnapshotCandidatePreviews = {
    [flaStaticSnapshotCandidateKey(first)]: { status: 'supported', sha256: 'c'.repeat(64) },
    [flaStaticSnapshotCandidateKey(second)]: { status: 'supported', sha256: 'c'.repeat(64) },
  };
  const client = {
    catalog: vi.fn(),
    preview: vi.fn(async (request: FlaStaticSnapshotPreviewRequest) => responseForPreview(request)),
    commit: vi.fn(async () => commitResponse()),
    cancel: vi.fn(async () => ({ accepted: true })),
  } as unknown as FlaStaticSnapshotCatalogClient;
  const onImported = vi.fn();
  const onProgress = vi.fn();
  const options = {
    client,
    queue: new FlaStaticSnapshotPreviewQueue(),
    selectedEntries: [first, second],
    previews,
    sessionId: '7f1e0000-0000-4000-8000-000000000099',
    source: { basename: 'real-character.fla', sha256: 'd'.repeat(64) },
    snapshot: {
      projectRoot: 'D:\\Acceptance\\project.pandastage',
      project: {} as EditorProjectSnapshot['project'],
      revision: 0,
      dirty: false,
    } as EditorProjectSnapshot,
    onImported,
    onProgress,
  };
  return { first, second, client, onImported, onProgress, options };
}

describe('FLA static snapshot batch import settlement', () => {
  it('keeps a committed item imported when request cleanup rejects and stops later commits', async () => {
    const { client, onImported, options } = createContext();
    vi.mocked(client.cancel).mockRejectedValueOnce(new Error('cancel IPC rejected'));

    const receipt = await runFlaStaticSnapshotBatchImport(options);

    expect(receipt.items.map((item) => item.status)).toEqual(['imported', 'not-attempted']);
    expect(receipt.items[0]?.message).toContain('预览资源清理未完成');
    expect(receipt.partial).toBe(true);
    expect(receipt.warnings.join(' ')).toContain('已经显示为“已新建”');
    expect(vi.mocked(client.commit)).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('does not turn a successful Main commit into a failed item when renderer synchronization throws', async () => {
    const { client, onImported, options } = createContext();
    onImported.mockImplementation(() => {
      throw new Error('store callback failed');
    });

    const receipt = await runFlaStaticSnapshotBatchImport(options);

    expect(receipt.items.map((item) => item.status)).toEqual(['imported', 'not-attempted']);
    expect(receipt.items[0]?.message).toContain('请勿重复导入');
    expect(receipt.partial).toBe(true);
    expect(vi.mocked(client.commit)).toHaveBeenCalledTimes(1);
  });

  it('records uncertain commit outcomes and never retries the same item', async () => {
    const { client, options } = createContext();
    vi.mocked(client.commit).mockRejectedValueOnce(new Error('IPC connection lost'));

    const receipt = await runFlaStaticSnapshotBatchImport(options);

    expect(receipt.items.map((item) => item.status)).toEqual(['failed', 'not-attempted']);
    expect(receipt.items[0]?.message).toContain('提交结果无法确认');
    expect(vi.mocked(client.commit)).toHaveBeenCalledTimes(1);
  });

  it('settles preview and cleanup failures without calling Main commit', async () => {
    const { client, options } = createContext();
    vi.mocked(client.preview).mockRejectedValueOnce(new Error('preview IPC rejected'));
    vi.mocked(client.cancel).mockRejectedValueOnce(new Error('cleanup IPC rejected'));

    const receipt = await runFlaStaticSnapshotBatchImport(options);

    expect(receipt.items.map((item) => item.status)).toEqual(['failed', 'not-attempted']);
    expect(receipt.partial).toBe(true);
    expect(receipt.warnings.length).toBeGreaterThan(0);
    expect(vi.mocked(client.commit)).not.toHaveBeenCalled();
  });
});
