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
      'project:open',
      'project:save',
      'asset-import:choose',
      'asset-import:dropped',
      'asset-metadata:refresh',
      'recent-projects:list',
      'recent-projects:open',
      'recent-projects:remove',
      'recent-projects:relocate',
      'autosave:track',
      'autosave:update',
      'autosave:stop',
      'autosave:error',
      'recovery:detect',
      'recovery:restore',
      'recovery:ignore',
    ]);
  });
});

describe('IPC contracts', () => {
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
