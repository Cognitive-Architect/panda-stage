/**
 * V2-R1 Static Snapshot — sandboxed snapshot renderer preload.
 *
 * Issue #287 R1-B. This preload is the ONLY bridge between the sandboxed
 * snapshot rasterizer and the Main process. It never touches Node, fs, or
 * the FLA source bytes; it only forwards a bounded SVG string in and a
 * bounded PNG byte array back out. It mirrors the isolation posture of
 * src/preload/fla-parser.ts.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc/channels';

export interface FlaSnapshotRenderRequest {
  requestId: string;
  svg: string;
}

export interface FlaSnapshotRenderResult {
  requestId: string;
  png: number[];
  width: number;
  height: number;
  pixelCount: number;
}

export interface FlaSnapshotRenderError {
  requestId: string;
  message: string;
}

function isRenderRequest(value: unknown): value is FlaSnapshotRenderRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.requestId === 'string' && typeof candidate.svg === 'string';
}

function isRenderResult(value: unknown): value is FlaSnapshotRenderResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.requestId === 'string' &&
    Array.isArray(candidate.png) &&
    candidate.png.every((item) => typeof item === 'number') &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number'
  );
}

function isRenderError(value: unknown): value is FlaSnapshotRenderError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.requestId === 'string' && typeof candidate.message === 'string';
}

const api = {
  ready(): void {
    ipcRenderer.send(IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY);
  },
  onRender(callback: (request: FlaSnapshotRenderRequest) => void): () => void {
    const listener = (_event: IpcRendererEvent, value: unknown): void => {
      if (isRenderRequest(value)) callback(value);
    };
    ipcRenderer.on(IPC_CHANNELS.FLA_SNAPSHOT_RENDER, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FLA_SNAPSHOT_RENDER, listener);
  },
  renderResult(payload: FlaSnapshotRenderResult): void {
    if (isRenderResult(payload)) {
      ipcRenderer.send(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, payload);
    }
  },
  renderError(payload: FlaSnapshotRenderError): void {
    if (isRenderError(payload)) {
      ipcRenderer.send(IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, payload);
    }
  },
};

contextBridge.exposeInMainWorld('pandaStageFlaSnapshotRenderer', Object.freeze(api));
