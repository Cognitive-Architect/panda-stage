import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/domain';
import type {
  AssetImportResponse,
  AssetImportResult,
} from '../../src/shared/asset-import-api';
import {
  ASSET_IMPORT_FEEDBACK_DISMISS_MS,
  createAssetImportFeedback,
  createAssetImportProgressFeedback,
  importedAudioFeedbackDetails,
} from '../../src/renderer/features/assets/assetImportFeedback';
import exampleProject from '../../demo-project/project-v1.example.json';

const importPanelSource = readFileSync(
  new URL('../../src/renderer/features/assets/AssetImportPanel.tsx', import.meta.url),
  'utf8',
);

const project = migrateProject(exampleProject);
const image = project.assets.find((asset) => asset.kind === 'image');
if (!image || image.kind !== 'image') {
  throw new Error('The demo project must include an image asset.');
}
const importedAsset = image as NonNullable<AssetImportResult['asset']>;

function result(
  status: AssetImportResult['status'],
  sourceName: string,
): AssetImportResult {
  return {
    sourceName,
    status,
    sha256: null,
    asset: status === 'imported' ? importedAsset : null,
    duplicateOfAssetId: status === 'duplicate' ? importedAsset.id : null,
    code: status === 'rejected' ? 'ASSET_IMPORT_UNSUPPORTED_TYPE' : null,
    message:
      status === 'rejected' ? '不支持此文件类型。' : '已完成。',
  };
}

function completed(results: AssetImportResult[]): AssetImportResponse {
  return {
    ok: true,
    status: 'completed',
    project,
    baseRevision: 0,
    savedRevision: 0,
    projectChanged: false,
    results,
  };
}

describe('asset import floating feedback', () => {
  it('shows one auto-dismissing success for a completed batch', () => {
    expect(createAssetImportFeedback(completed([
      result('imported', 'scene.png'),
    ]), 'ignored')).toEqual({
      kind: 'success',
      summary: '已导入：scene.png',
      details: [],
      dismissAfterMs: ASSET_IMPORT_FEEDBACK_DISMISS_MS,
    });
    expect(ASSET_IMPORT_FEEDBACK_DISMISS_MS).toBe(4_000);
    const batch = createAssetImportFeedback(completed([
      result('imported', 'one.png'),
      result('imported', 'two.png'),
      result('imported', 'three.png'),
      result('imported', 'four.png'),
    ]), 'ignored');
    expect(batch).toMatchObject({
      kind: 'success',
      summary: '已导入 4 个素材',
      dismissAfterMs: 4_000,
    });
  });

  it('shows duplicate-only batches as brief neutral feedback', () => {
    expect(createAssetImportFeedback(completed([
      result('duplicate', 'scene.png'),
      result('duplicate', 'scene-copy.png'),
    ]), 'ignored')).toMatchObject({
      kind: 'info',
      summary: '2 个素材已存在，无需重复导入',
      dismissAfterMs: 4_000,
    });
  });

  it('keeps partial and complete failures visible with file-level details', () => {
    const partial = createAssetImportFeedback(
      completed([
        result('imported', 'scene.png'),
        result('rejected', 'broken.gif'),
      ]),
      'ignored',
    );
    expect(partial).toMatchObject({
      kind: 'warning',
      summary: '已导入 1 个，1 个未能导入 · 查看详情',
      dismissAfterMs: null,
      details: [{ sourceName: 'broken.gif', message: '不支持此文件类型。' }],
    });

    const allFailed = createAssetImportFeedback(
      completed([result('failed', 'unreadable.png')]),
      'ignored',
    );
    expect(allFailed).toMatchObject({
      kind: 'error',
      dismissAfterMs: null,
      details: [{ sourceName: 'unreadable.png' }],
    });
  });

  it('preserves rollback and audio-analysis errors, and suppresses cancellation', () => {
    const operationError: AssetImportResponse = {
      ok: false,
      error: {
        code: 'ASSET_IMPORT_ROLLBACK_FAILED',
        message: '回滚未完成。',
        projectRoot: 'D:\\project.pandastage',
        residualPaths: ['D:\\project.pandastage\\assets\\residual.png'],
      },
    };
    const rollback = createAssetImportFeedback(
      operationError,
      '导入清理未完成，请手动清理残留文件：D:\\project.pandastage\\assets\\residual.png',
    );
    expect(rollback).toMatchObject({
      kind: 'error',
      dismissAfterMs: null,
      details: [{
        sourceName: '导入操作',
        message: expect.stringContaining('residual.png'),
      }],
    });

    const audioDetails = importedAudioFeedbackDetails(
      [result('imported', 'voice.wav')],
      [{ assetId: importedAsset.id, message: '音频时长读取失败，可重试。' }],
    );
    expect(audioDetails).toEqual([
      { sourceName: 'voice.wav', message: '音频时长读取失败，可重试。' },
    ]);
    expect(createAssetImportFeedback(
      { ok: true, status: 'cancelled' },
      'ignored',
    )).toBeNull();
  });

  it('creates progress feedback without auto-dismiss', () => {
    expect(createAssetImportProgressFeedback()).toEqual({
      kind: 'progress',
      summary: '正在导入素材…',
      details: [],
      dismissAfterMs: null,
    });
  });

  it('routes picker and dropped imports through the same response feedback handler', () => {
    const chooseStart = importPanelSource.indexOf('const chooseFiles =');
    const droppedStart = importPanelSource.indexOf('const importDroppedFiles =');
    const dropHandlersStart = importPanelSource.indexOf(
      'const dropHandlers = useAssetDrop(',
      droppedStart,
    );

    expect(chooseStart).toBeGreaterThan(-1);
    expect(droppedStart).toBeGreaterThan(chooseStart);
    expect(dropHandlersStart).toBeGreaterThan(droppedStart);
    expect(importPanelSource.slice(chooseStart, droppedStart)).toContain(
      'await applyResponse(',
    );
    expect(importPanelSource.slice(droppedStart, dropHandlersStart)).toContain(
      'await applyResponse(',
    );
  });
});
