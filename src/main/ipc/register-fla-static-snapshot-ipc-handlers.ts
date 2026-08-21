/**
 * V2-R1 Static Snapshot — IPC handlers (R1-A/B/C/D/E).
 *
 * Issue #287. All handlers use the same trusted-sender boundary as the
 * V1/V1.5 FLA IPC. The renderer only ever sends serialized R1 contract
 * objects; it never sends FLA source bytes. The sandboxed rasterizer
 * window messages (READY / RESULT / ERROR) are routed to the production
 * rasterizer (FlaStaticSnapshotWindowManager) which owns the window.
 */

import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  FlaRenderableTargetCatalogRequestSchema,
  FlaRenderableTargetCatalogResponseSchema,
  FlaStaticSnapshotCommitResponseSchema,
  FlaStaticSnapshotPreviewResponseSchema,
} from '../../shared/fla-static-snapshot-api';
import type { FlaStaticSnapshotRenderSession } from '../services/fla-static-snapshot-render-session';
import type { FlaStaticSnapshotCommitService } from '../services/FlaStaticSnapshotCommitService';
import type { FlaStaticSnapshotWindowManager } from '../services/fla-static-snapshot-window-manager';

export interface FlaStaticSnapshotIpcDependencies {
  getMainWindow: () => BrowserWindow | null;
  renderSession: FlaStaticSnapshotRenderSession;
  commitService: FlaStaticSnapshotCommitService;
  windowManager: FlaStaticSnapshotWindowManager;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent | IpcMainEvent,
  expectedWindow: BrowserWindow | null,
): void {
  if (!expectedWindow || expectedWindow.isDestroyed() || event.sender.id !== expectedWindow.webContents.id) {
    throw new Error('Untrusted FLA snapshot IPC sender');
  }
}

export function registerFlaStaticSnapshotIpcHandlers(
  dependencies: FlaStaticSnapshotIpcDependencies,
): () => void {
  const { getMainWindow, renderSession, commitService, windowManager } = dependencies;

  const catalog = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, getMainWindow());
    let parsed;
    try {
      parsed = FlaRenderableTargetCatalogRequestSchema.parse(rawRequest);
    } catch {
      return FlaRenderableTargetCatalogResponseSchema.parse({
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid snapshot catalog request' },
      });
    }
    const result = await renderSession.catalog(parsed.sessionId);
    if (!result.ok) {
      return FlaRenderableTargetCatalogResponseSchema.parse({
        ok: false,
        error: { code: result.code === 'SESSION_NOT_FOUND' ? 'SESSION_NOT_FOUND' : 'UNKNOWN_ERROR', message: result.message },
      });
    }
    return FlaRenderableTargetCatalogResponseSchema.parse({
      sessionId: parsed.sessionId,
      entries: result.entries,
      summary: result.summary,
    });
  };

  const preview = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, getMainWindow());
    const response = await renderSession.preview(rawRequest);
    return FlaStaticSnapshotPreviewResponseSchema.parse(response);
  };

  const commit = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, getMainWindow());
    const response = await commitService.commit(rawRequest);
    return FlaStaticSnapshotCommitResponseSchema.parse(response);
  };

  const cancel = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, getMainWindow());
    return renderSession.cancel(rawRequest);
  };

  // Sandboxed rasterizer window -> Main.
  const onRendererReady = (event: IpcMainEvent) => {
    try {
      windowManager.markReady(event.sender.id);
    } catch (error) {
      console.error('FLA snapshot renderer ready rejected.', error);
    }
  };
  const onRendererResult = (event: IpcMainEvent, payload: unknown) => {
    try {
      windowManager.markResult(event.sender.id, payload);
    } catch (error) {
      console.error('FLA snapshot render result rejected.', error);
    }
  };
  const onRendererError = (event: IpcMainEvent, payload: unknown) => {
    try {
      windowManager.markError(event.sender.id, payload);
    } catch (error) {
      console.error('FLA snapshot render error rejected.', error);
    }
  };

  ipcMain.handle(IPC_CHANNELS.FLA_SNAPSHOT_CATALOG, catalog);
  ipcMain.handle(IPC_CHANNELS.FLA_SNAPSHOT_PREVIEW, preview);
  ipcMain.handle(IPC_CHANNELS.FLA_SNAPSHOT_COMMIT, commit);
  ipcMain.handle(IPC_CHANNELS.FLA_SNAPSHOT_CANCEL, cancel);
  ipcMain.on(IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY, onRendererReady);
  ipcMain.on(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, onRendererResult);
  ipcMain.on(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, onRendererError);

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.FLA_SNAPSHOT_CATALOG);
    ipcMain.removeHandler(IPC_CHANNELS.FLA_SNAPSHOT_PREVIEW);
    ipcMain.removeHandler(IPC_CHANNELS.FLA_SNAPSHOT_COMMIT);
    ipcMain.removeHandler(IPC_CHANNELS.FLA_SNAPSHOT_CANCEL);
    ipcMain.removeListener(IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY, onRendererReady);
    ipcMain.removeListener(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, onRendererResult);
    ipcMain.removeListener(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, onRendererError);
  };
}
