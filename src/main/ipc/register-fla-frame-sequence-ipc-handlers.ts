/**
 * V2-R2 Frame Sequence — IPC handlers (R2-C / R2-D / R2-G end-to-end +
 * R2-F frame source assembly).
 *
 * Issue #294. The handlers forward a single typed request to the
 * dedicated R2 Main-side services:
 *
 *   - FLA_FRAME_SEQUENCE_RENDER → FlaFrameSequenceService.renderSequence
 *   - FLA_FRAME_SEQUENCE_CANCEL → FlaFrameSequenceService.cancel
 *   - FLA_FRAME_SEQUENCE_COMMIT → FlaFrameSequenceCommitService.commit
 *
 * R2-F (the per-frame SVG source assembly) lives inside the render
 * handler. The renderer sends only the FLA sessionId and the bounded
 * range (R2-A FlaFrameSequenceRequest contract); the Main process
 * looks up the FLA source bytes via the R1 sourceLookup, runs the R1
 * catalog + R1 SVG builder per frame, and yields the per-frame SVG
 * inputs to the R2-C sequence service. The Renderer never sees the
 * FLA source bytes and never sees the per-frame SVG strings; the
 * only thing that crosses the IPC boundary is the R2 contract
 * objects (R1-A boundary rule + R2-E no Renderer PNG accumulation).
 *
 * Trusted-sender boundary: every invoke handler calls
 * assertTrustedSender against the main window's webContents, mirroring
 * the V2-R1 handler pattern.
 *
 * The Main-side services are constructed and owned by the main bootstrap
 * (see src/main/index.ts); this module wires them onto IPC channels and
 * returns an unregister callback so tests can tear down cleanly.
 */

import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  FlaFrameSequenceCancelResponseSchema,
  FlaFrameSequenceCommitRequestSchema,
  FlaFrameSequenceCommitResponseSchema,
  FlaFrameSequenceRequestSchema,
  FlaFrameSequenceResponseSchema,
  type FlaFrameSequenceError,
  type FlaFrameSequenceRange,
  type FlaFrameSequenceResponse,
} from '../../shared/fla-frame-sequence-api';
import type { FlaFrameSequenceService, SequenceFrameInput } from '../services/fla-frame-sequence-service';
import type { FlaFrameSequenceCommitService } from '../services/FlaFrameSequenceCommitService';
import type { FlaStaticSnapshotSource } from '../services/fla-static-snapshot-render-session';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} from '../services/fla-static-snapshot-svg-builder';
import type { FlaRenderTarget } from '../../shared/fla-static-snapshot-api';

export interface FlaFrameSequenceIpcDependencies {
  getMainWindow: () => BrowserWindow | null;
  sequenceService: FlaFrameSequenceService;
  commitService: FlaFrameSequenceCommitService;
  sourceLookup: { getSource(sessionId: string): FlaStaticSnapshotSource | null };
  /** Optional override for tests; defaults to the R1 catalog + SVG builder. */
  buildFrameSource?: (
    source: FlaStaticSnapshotSource,
    range: FlaFrameSequenceRange,
  ) => AsyncIterable<SequenceFrameInput>;
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | null,
): void {
  if (
    !expectedWindow ||
    expectedWindow.isDestroyed() ||
    event.sender.id !== expectedWindow.webContents.id
  ) {
    throw new Error('Untrusted FLA frame sequence IPC sender');
  }
}

function makeErrorResponse(
  code: FlaFrameSequenceError['code'],
  message: string,
  requestId: string,
  completedFrameCount: number,
): FlaFrameSequenceResponse {
  // The shared error contract caps message at 1000 chars. A raw ZodError
  // string can exceed that and would make THIS error response itself
  // invalid (escaping the Panda-owned response contract). Truncate safely.
  const safe = message.length > 1000 ? `${message.slice(0, 997)}...` : message;
  return {
    ok: false,
    error: { code, message: safe, requestId, completedFrameCount },
  };
}

const defaultBuildFrameSource = async function* buildFrameSource(
  source: FlaStaticSnapshotSource,
  range: FlaFrameSequenceRange,
): AsyncIterable<SequenceFrameInput> {
  const catalog = await buildRenderableTargetCatalog(source.bytes);
  if (!catalog.ok) {
    // R2-F: a catalog failure aborts the whole sequence (we cannot
    // build any per-frame SVG without a target). The R2-C service
    // surfaces this as a RENDER_FAILED with completedFrameCount=0.
    throw new Error(`R2 catalog failed: ${catalog.message}`);
  }
  const baseTarget = catalog.entries.find(
    (entry) => entry.target.renderTargetId === range.renderTargetId,
  )?.target as FlaRenderTarget | undefined;
  if (!baseTarget) {
    throw new Error(
      `R2 target ${range.renderTargetId} not found in session; pick a target from the catalog`,
    );
  }
  for (let i = range.startFrameIndex; i <= range.endFrameIndex; i += 1) {
    const frameTarget: FlaRenderTarget = { ...baseTarget, selectedFrameIndex: i };
    const svg = await buildSvgForRenderTarget(source.bytes, frameTarget);
    if (!svg.ok) {
      throw new Error(`R2 SVG build failed for frame ${i}: ${svg.message}`);
    }
    yield { frameIndex: i, svg: svg.svg };
  }
};

export function registerFlaFrameSequenceIpcHandlers(
  dependencies: FlaFrameSequenceIpcDependencies,
): () => void {
  const {
    getMainWindow,
    sequenceService,
    commitService,
    sourceLookup,
    buildFrameSource = defaultBuildFrameSource,
  } = dependencies;

  const render = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, getMainWindow());
    let parsed: ReturnType<typeof FlaFrameSequenceRequestSchema.parse>;
    try {
      parsed = FlaFrameSequenceRequestSchema.parse(rawRequest);
    } catch (error) {
      return FlaFrameSequenceResponseSchema.parse(
        makeErrorResponse(
          'RENDER_FAILED',
          `Invalid R2 frame sequence request: ${String(error)}`,
          '00000000-0000-4000-8000-000000000000',
          0,
        ),
      );
    }
    const source = sourceLookup.getSource(parsed.sessionId);
    if (!source) {
      return FlaFrameSequenceResponseSchema.parse(
        makeErrorResponse(
          'RENDER_FAILED',
          'FLA inspection session not found or no source bytes retained',
          parsed.requestId,
          0,
        ),
      );
    }
    try {
      const sourceIterable = buildFrameSource(source, parsed.range);
      const response = await sequenceService.renderSequence(
        parsed.sessionId,
        parsed.range,
        sourceIterable,
        { sequenceRequestId: parsed.requestId },
      );
      return FlaFrameSequenceResponseSchema.parse(response);
    } catch (error) {
      return FlaFrameSequenceResponseSchema.parse(
        makeErrorResponse(
          'RENDER_FAILED',
          `R2 frame source assembly failed: ${String(error)}`,
          parsed.requestId,
          0,
        ),
      );
    }
  };

  const cancel = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, getMainWindow());
    // The R2-A cancel contract (FlaFrameSequenceCancelRequestSchema)
    // takes only { format, version, sessionId?, requestId? }. We
    // accept either the typed cancel shape or any { sessionId,
    // requestId } forward-compat shape the renderer might have in
    // hand. A malformed request is treated as "no sessionId /
    // requestId", which the service maps to a no-op.
    const candidate = (rawRequest ?? {}) as { sessionId?: string; requestId?: string };
    const sessionId = typeof candidate.sessionId === 'string' ? candidate.sessionId : '';
    const requestId = typeof candidate.requestId === 'string' ? candidate.requestId : undefined;
    const accepted = sequenceService.cancel(sessionId, requestId);
    return FlaFrameSequenceCancelResponseSchema.parse({
      accepted,
    });
  };

  const commit = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, getMainWindow());
    let parsed: ReturnType<typeof FlaFrameSequenceCommitRequestSchema.parse>;
    try {
      parsed = FlaFrameSequenceCommitRequestSchema.parse(rawRequest);
    } catch (error) {
      // R2-G: an invalid request is the renderer's fault; return a
      // well-formed R2 commit error response rather than letting Zod
      // throw across the IPC boundary. The shared commit error contract
      // caps message at 1000 chars, so truncate a long ZodError string.
      const raw = `Invalid R2 frame sequence commit request: ${String(error)}`;
      const message = raw.length > 1000 ? `${raw.slice(0, 997)}...` : raw;
      return FlaFrameSequenceCommitResponseSchema.parse({
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message,
          projectRoot: '(unknown project)',
        },
      });
    }
    const response = await commitService.commit(parsed);
    return FlaFrameSequenceCommitResponseSchema.parse(response);
  };

  ipcMain.handle(IPC_CHANNELS.FLA_FRAME_SEQUENCE_RENDER, render);
  ipcMain.handle(IPC_CHANNELS.FLA_FRAME_SEQUENCE_CANCEL, cancel);
  ipcMain.handle(IPC_CHANNELS.FLA_FRAME_SEQUENCE_COMMIT, commit);

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_RENDER);
    ipcMain.removeHandler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_CANCEL);
    ipcMain.removeHandler(IPC_CHANNELS.FLA_FRAME_SEQUENCE_COMMIT);
  };
}
