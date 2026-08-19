import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import {
  AppPingRequestSchema,
  AppPingResponseSchema,
  HiddenReadyRequestSchema,
  HiddenReadyResponseSchema,
} from '../../src/shared/ipc/contracts';
import {
  ExportCancelRequestSchema,
  ExportJobUpdateSchema,
  FullProbeExportRequestSchema,
} from '../../src/shared/export-types';
import {
  AssetCanvasImageReadRequestSchema,
  AssetCanvasImageReadResponseSchema,
  CANVAS_IMAGE_MAX_BYTES,
} from '../../src/shared/asset-canvas-image-api';
import {
  NativeCloseSyncRequestSchema,
  NativeCloseSyncResponseSchema,
} from '../../src/shared/native-close-sync';

describe('IPC channel registry', () => {
  it('keeps every channel unique and namespaced', () => {
    const channels = Object.values(IPC_CHANNELS);

    expect(new Set(channels).size).toBe(channels.length);
    expect(channels).toEqual([
      'app:ping',
      'hidden:ready',
      'export:load-probe',
      'export:probe-loaded',
      'export:render-frame',
      'export:frame-ready',
      'export:frame-failed',
      'export:cancel-render',
      'export:start-probe',
      'export:cancel-job',
      'export:job-update',
      'project:create',
      'project:create-at',
      'project:choose-directory',
      'project:open-folder',
      'project:confirm-switch',
      'project:open',
      'project:save',
      'asset-import:choose',
      'asset-import:dropped',
      'asset-metadata:refresh',
      'asset-metadata:cancel',
      'asset:delete',
      'asset-thumbnail:read',
      'asset-canvas-image:read',
      'recent-projects:list',
      'recent-projects:open',
      'recent-projects:remove',
      'recent-projects:relocate',
      'autosave:track',
      'autosave:update',
      'autosave:stop',
      'autosave:error',
      'native-close:sync-request',
      'native-close:sync-response',
      'recovery:detect',
      'recovery:restore',
      'recovery:ignore',
      'fla:inspect-choose',
      'fla:cancel',
      'fla:commit-selected',
      'fla:worker-ready',
      'fla:worker-start',
      'fla:worker-cancel',
      'fla:worker-progress',
      'fla:worker-result',
      'fla:worker-error',
    ]);
  });
});

describe('IPC contracts', () => {
  it('validates native-close synchronization request and response payloads', () => {
    expect(
      NativeCloseSyncRequestSchema.parse({ requestId: 'close-1' }),
    ).toEqual({ requestId: 'close-1' });
    expect(
      NativeCloseSyncResponseSchema.parse({
        ok: false,
        requestId: 'close-1',
        error: 'Autosave update failed.',
      }),
    ).toEqual({
      ok: false,
      requestId: 'close-1',
      error: 'Autosave update failed.',
    });
    expect(
      NativeCloseSyncResponseSchema.safeParse({
        ok: true,
        requestId: 'close-1',
        error: 'must not be present',
      }).success,
    ).toBe(false);
  });

  it('validates the strict canvas-image request and response boundary', () => {
    const request = {
      projectRoot: 'C:\\demo.pandastage',
      assetId: '10000000-0000-4000-8000-000000000002',
      sha256: 'a'.repeat(64),
    };
    expect(AssetCanvasImageReadRequestSchema.parse(request)).toEqual(request);
    expect(
      AssetCanvasImageReadRequestSchema.safeParse({
        ...request,
        sourcePath: 'C:\\outside.png',
      }).success,
    ).toBe(false);
    expect(
      AssetCanvasImageReadResponseSchema.safeParse({
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        mimeType: 'image/png',
        width: 2,
        height: 2,
        byteLength: 2,
        bytes: new Uint8Array([1]),
      }).success,
    ).toBe(false);
    expect(CANVAS_IMAGE_MAX_BYTES).toBe(64 * 1024 * 1024);
  });

  it('accepts only the empty app ping request', () => {
    expect(AppPingRequestSchema.parse({})).toEqual({});
    expect(AppPingRequestSchema.safeParse({ command: 'fs.read' }).success).toBe(
      false,
    );
  });

  it('validates the pong response', () => {
    expect(
      AppPingResponseSchema.parse({ message: 'pong', receivedAtMs: 123 }),
    ).toEqual({ message: 'pong', receivedAtMs: 123 });
    expect(
      AppPingResponseSchema.safeParse({ message: 'unexpected', receivedAtMs: 123 })
        .success,
    ).toBe(false);
  });

  it('validates both sides of the hidden ready handshake', () => {
    expect(
      HiddenReadyRequestSchema.parse({
        role: 'hidden-renderer',
        loadedAtMs: 456,
      }),
    ).toEqual({ role: 'hidden-renderer', loadedAtMs: 456 });
    expect(
      HiddenReadyResponseSchema.parse({
        acknowledged: true,
        role: 'hidden-renderer',
      }),
    ).toEqual({ acknowledged: true, role: 'hidden-renderer' });
  });

  it('rejects hidden ready payloads with extra capabilities', () => {
    expect(
      HiddenReadyRequestSchema.safeParse({
        role: 'hidden-renderer',
        loadedAtMs: 456,
        execute: 'child_process',
      }).success,
    ).toBe(false);
  });

  it('validates strict full-export, cancellation, and state payloads', () => {
    const jobId = '00000000-0000-4000-8000-000000000000';
    expect(
      FullProbeExportRequestSchema.parse({
        projectDirectory: 'C:\\熊猫 项目',
        audioPath: 'C:\\熊猫 项目\\音轨.wav',
        outputPath: 'C:\\熊猫 输出\\成片.mp4',
        durationMs: 3_000,
        fps: 24,
        audioStartMs: 400,
        overwrite: true,
      }).projectDirectory,
    ).toContain('熊猫');
    expect(ExportCancelRequestSchema.parse({ jobId })).toEqual({ jobId });
    expect(
      ExportJobUpdateSchema.parse({
        jobId,
        status: 'cancelling',
        phase: 'encoding',
        completedFrames: 72,
        totalFrames: 72,
        error: null,
      }).status,
    ).toBe('cancelling');
    expect(
      ExportCancelRequestSchema.safeParse({ jobId, command: 'taskkill /f' })
        .success,
    ).toBe(false);
  });
});
