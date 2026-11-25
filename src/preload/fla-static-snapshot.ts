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
import {
  FLA_STATIC_TEXT_LIMITS,
  isValidFlaStaticTextGraphicFraming,
  isValidFlaStaticTextRenderItem,
  type FlaStaticTextGraphicFraming,
  type FlaStaticTextRenderItem,
} from '../shared/fla-static-text';

export interface FlaSnapshotRenderRequest {
  requestId: string;
  svg: string;
  staticTexts?: readonly FlaStaticTextRenderItem[];
  graphicFraming?: FlaStaticTextGraphicFraming;
  returnResolvedSvg?: boolean;
}

export interface FlaSnapshotRenderResult {
  requestId: string;
  png: number[];
  width: number;
  height: number;
  pixelCount: number;
  sourceViewport?: { x: number; y: number; width: number; height: number };
  resolvedSvg?: string;
  profile?: {
    imageLoadMs: number;
    canvasDrawMs: number;
    pngEncodeMs: number;
    pngArrayBufferMs: number;
    pngArraySerializeMs: number;
    totalMs: number;
  };
}

export interface FlaSnapshotRenderError {
  requestId: string;
  message: string;
}

function isRenderRequest(value: unknown): value is FlaSnapshotRenderRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.requestId !== 'string' || typeof candidate.svg !== 'string') {
    return false;
  }
  if (candidate.staticTexts !== undefined) {
    if (
      !Array.isArray(candidate.staticTexts) ||
      candidate.staticTexts.length > FLA_STATIC_TEXT_LIMITS.maxTextNodesPerComposition ||
      !candidate.staticTexts.every(isValidFlaStaticTextRenderItem)
    ) {
      return false;
    }
  }
  if (candidate.graphicFraming !== undefined && !isValidFlaStaticTextGraphicFraming(candidate.graphicFraming)) {
    return false;
  }
  if (candidate.returnResolvedSvg !== undefined && typeof candidate.returnResolvedSvg !== 'boolean') {
    return false;
  }
  return true;
}

function isViewport(value: unknown): value is NonNullable<FlaSnapshotRenderResult['sourceViewport']> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x === 'number' && Number.isFinite(v.x) &&
    typeof v.y === 'number' && Number.isFinite(v.y) &&
    typeof v.width === 'number' && Number.isFinite(v.width) && v.width > 0 &&
    typeof v.height === 'number' && Number.isFinite(v.height) && v.height > 0
  );
}

function isRenderResult(value: unknown): value is FlaSnapshotRenderResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.requestId === 'string' &&
    Array.isArray(candidate.png) &&
    candidate.png.every((item) => typeof item === 'number') &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    (candidate.sourceViewport === undefined || isViewport(candidate.sourceViewport)) &&
    (candidate.resolvedSvg === undefined || typeof candidate.resolvedSvg === 'string') &&
    (candidate.profile === undefined || isProfile(candidate.profile))
  );
}

function isProfile(value: unknown): value is NonNullable<FlaSnapshotRenderResult['profile']> {
  if (typeof value !== 'object' || value === null) return false;
  const profile = value as Record<string, unknown>;
  return [
    profile.imageLoadMs,
    profile.canvasDrawMs,
    profile.pngEncodeMs,
    profile.pngArrayBufferMs,
    profile.pngArraySerializeMs,
    profile.totalMs,
  ].every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0);
}

function isRenderError(value: unknown): value is FlaSnapshotRenderError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.requestId === 'string' && typeof candidate.message === 'string';
}

const api = {
  issue762ProfileEnabled: process.env.PANDA_STAGE_ISSUE762_PROFILE === '1',
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
