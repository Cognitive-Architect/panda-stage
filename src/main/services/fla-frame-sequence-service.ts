/**
 * FLA V2-R2 Frame Sequence Service.
 *
 * Issue #294 R2-C / R2-B / R2-D / R2-E. This module is the
 * Main-side orchestrator for one bounded contiguous frame range.
 * It reuses the R1 single-frame rasterizer
 * (`FlaStaticSnapshotRasterizer`) to rasterize each frame in
 * deterministic order. The R1 rasterizer is the only place that
 * touches a sandboxed BrowserWindow; R2 does NOT introduce a
 * second renderer.
 *
 * R2 hard invariants enforced here:
 *
 *   R2-B: sequential rendering only. maxActualRasterConcurrency = 1.
 *         One frame is in flight at a time, by design and by
 *         enforcement. The R1 rasterizer also enforces its own
 *         single-job-at-a-time invariant, so a misuse here would
 *         fail at the R1 boundary.
 *   R2-B: per-frame wall timeout inherits from R1 (30_000 ms).
 *   R2-B: cumulative sequence wall timeout
 *         (= MAX_SEQUENCE_FRAMES * perFrameTimeoutMs = 720_000 ms).
 *   R2-B: cumulative pixel cap
 *         (= MAX_SEQUENCE_TOTAL_PIXELS = 402_653_184 pixels).
 *   R2-B: cumulative encoded-bytes cap
 *         (= MAX_SEQUENCE_ENCODED_BYTES = 1.5 GiB).
 *   R2-D: latest-request-wins. Starting a new sequence for the
 *         same session cancels the previous one. The previous
 *         sequence's renderSequence() promise rejects with
 *         SEQUENCE_CANCELLED + completedFrameCount so the UI can
 *         show a clear "5 of 12 done, superseded" state.
 *   R2-D: bounded per-sequence cancel. Cancel stops the currently
 *         executing R1 raster job via rasterizer.cancel() AND
 *         prevents K+1 from starting.
 *   R2-D: late results from a cancelled sequence cannot become
 *         accepted. The R1 rasterizer.cancel() is the only way to
 *         abort an in-flight raster; once it returns, the in-flight
 *         Promise is rejected and the for-loop exits.
 *   R2-E: no Renderer-held PNG buffer retention. The Main service
 *         owns the per-frame Uint8Array; in production these live
 *         briefly in a per-sequence Main-owned array, get handed
 *         to the commit path, and are released by the sequence
 *         finalization (success / cancel / close). The Renderer
 *         never accumulates the per-frame PNGs.
 *   R2-G: R2 commit is a separate contract and path (R2 does NOT
 *         over-load the R1 single-frame commit). This service only
 *         produces the per-frame preview results; commit lives in
 *         R2-G.
 *
 * R2-A / R2-C: the frame source is supplied by the caller. The
 * caller is responsible for:
 *   - validating the range against the target.frameCount
 *   - producing the SVG for each requested frame
 *   - keeping the SVG string bounded (R1 SVG builder already does
 *     this via FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth/Height/
 *     Pixels)
 *
 * R2-C: deterministic ordering. The for-loop iterates frames in
 * strictly ascending order; the cancellation / supersede paths
 * preserve the in-flight ordinal so completedFrameCount is correct.
 *
 * Security boundary unchanged from R1:
 *   - sandbox = true (R1 rasterizer property)
 *   - contextIsolation = true
 *   - nodeIntegration = false
 *   - no arbitrary renderer FS / network
 *   - ActionScript never executed
 *   - rasterizer is the only thing that touches a BrowserWindow;
 *     R2 does NOT add a parallel renderer.
 */

import { randomUUID } from 'node:crypto';
import type {
  FlaFrameSequenceErrorCode,
  FlaFrameSequenceItem,
  FlaFrameSequenceRange,
  FlaFrameSequenceResponse,
  FlaFrameSequenceSuccess,
} from '../../shared/fla-frame-sequence-api';
import { FLA_FRAME_SEQUENCE_LIMITS } from '../../shared/fla-frame-sequence-api';
import type {
  FlaStaticSnapshotRasterizeInput,
  FlaStaticSnapshotRasterizeOutput,
  FlaStaticSnapshotRasterizer,
} from './fla-static-snapshot-render-session';

// ---- Frame source contract ----
//
// The caller supplies a function that returns the SVG for a given
// frame ordinal. The SVG must already be bounded (per R1 SVG
// builder limits). The service does NOT inspect the SVG content;
// it only forwards the string to the R1 rasterizer. The
// rasterizer is responsible for any per-frame budget enforcement
// it already does; R2 adds cumulative-sequence enforcement on top.

export interface SequenceFrameInput {
  /** Absolute frame index in the underlying target timeline (0-based). */
  frameIndex: number;
  /** SVG string for this frame. R1 SVG builder output. */
  svg: string;
}

export type SequenceFrameSource = AsyncIterable<SequenceFrameInput> | Iterable<SequenceFrameInput>;

// ---- Service options ----

export interface FlaFrameSequenceServiceOptions {
  /** R1 rasterizer. The only thing that touches a sandboxed BrowserWindow. */
  rasterizer: FlaStaticSnapshotRasterizer;
  /** Hard budget constants. Overridable for tests. */
  limits?: typeof FLA_FRAME_SEQUENCE_LIMITS;
  /** Wall clock; injectable for tests. */
  now?: () => number;
}

// ---- Per-sequence state ----

interface SequenceInFlight {
  readonly sequenceRequestId: string;
  readonly sessionId: string;
  /** Current frame ordinal (0-based). -1 means no frame has started yet. */
  currentOrdinal: number;
  /** Set true when a cancel or supersede has been issued. */
  cancelled: boolean;
  /** The per-frame requestId currently in the rasterizer, if any. */
  currentFrameRequestId: string | null;
  /** Resolved when the sequence settles (success / cancel / close). */
  resolve: (response: FlaFrameSequenceResponse) => void;
  /** Reject is unused; settle goes through `resolve` with ok:false. */
  items: SequenceInFlightItem[];
  /** Cumulative byte count of completed frames. */
  cumulativeEncodedBytes: number;
  /** Cumulative pixel count of completed frames. */
  cumulativePixelCount: number;
  /** Sequence start time (Date.now()). */
  startedAt: number;
}

interface SequenceInFlightItem {
  frameIndex: number;
  sequenceOrdinal: number;
  rasterOutput: FlaStaticSnapshotRasterizeOutput;
  frameWallClockMs: number;
  receivedAt: number;
}

// ---- Failure helpers ----

function makeError(
  code: FlaFrameSequenceErrorCode,
  message: string,
  requestId: string,
  completedFrameCount: number,
): FlaFrameSequenceResponse {
  return { ok: false, error: { code, message, requestId, completedFrameCount } };
}

// ---- Service class ----

export class FlaFrameSequenceService {
  private readonly rasterizer: FlaStaticSnapshotRasterizer;
  private readonly limits: typeof FLA_FRAME_SEQUENCE_LIMITS;
  private readonly now: () => number;
  // Per-session latest-request-wins: at most one in-flight sequence
  // per sessionId. Starting a new one supersedes the previous.
  private readonly inFlight = new Map<string, SequenceInFlight>();
  private closed = false;

  constructor(options: FlaFrameSequenceServiceOptions) {
    this.rasterizer = options.rasterizer;
    this.limits = options.limits ?? FLA_FRAME_SEQUENCE_LIMITS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Render one bounded contiguous frame range in deterministic
   * order. Concurrency is 1: one frame is rasterized at a time
   * via the R1 rasterizer, the next frame starts only after the
   * previous one resolves.
   *
   * Latest-request-wins per session: calling renderSequence for a
   * sessionId that already has an in-flight sequence cancels the
   * previous one. The previous Promise resolves with
   * `ok: false, error.code: SEQUENCE_CANCELLED,
   * error.completedFrameCount: <frames already done>`.
   */
  async renderSequence(
    sessionId: string,
    range: FlaFrameSequenceRange,
    source: SequenceFrameSource,
    overrides?: { sequenceRequestId?: string },
  ): Promise<FlaFrameSequenceResponse> {
    if (this.closed) {
      return makeError(
        'RENDER_FAILED',
        'Sequence service is closed',
        overrides?.sequenceRequestId ?? randomUUID(),
        0,
      );
    }
    const requestId = overrides?.sequenceRequestId ?? randomUUID();
    const totalFrames = range.endFrameIndex - range.startFrameIndex + 1;
    if (totalFrames > this.limits.MAX_SEQUENCE_FRAMES) {
      return makeError(
        'RANGE_TOO_LARGE',
        `frame count ${totalFrames} exceeds MAX_SEQUENCE_FRAMES=${this.limits.MAX_SEQUENCE_FRAMES}`,
        requestId,
        0,
      );
    }

    // Latest-request-wins: supersede the previous in-flight for this
    // session. The previous sequence's promise is settled as
    // SEQUENCE_CANCELLED with its current completedFrameCount.
    const previous = this.inFlight.get(sessionId);
    if (previous && previous.sequenceRequestId !== requestId) {
      this.settleInFlightAsCancelled(previous, 'Sequence superseded by a newer request for the same session');
    }

    const sequence: SequenceInFlight = {
      sequenceRequestId: requestId,
      sessionId,
      currentOrdinal: -1,
      cancelled: false,
      currentFrameRequestId: null,
      items: [],
      cumulativeEncodedBytes: 0,
      cumulativePixelCount: 0,
      startedAt: this.now(),
      resolve: () => { /* set below */ },
    };
    const responsePromise = new Promise<FlaFrameSequenceResponse>((resolve) => {
      sequence.resolve = resolve;
    });
    this.inFlight.set(sessionId, sequence);

    // Iterate frames sequentially. The for-of loop is the only
    // place frames are started. R2-C: deterministic order.
    try {
      for await (const frame of source) {
        // Defensive: if cancel / close settled this sequence while
        // we were awaiting the next iterator value, exit.
        if (sequence.cancelled) {
          break;
        }
        if (this.closed) {
          break;
        }
        if (this.inFlight.get(sessionId) !== sequence) {
          // Supersede detected (e.g. the inFlight map was replaced).
          break;
        }

        // R2-B: cumulative sequence wall-time cap. The check is
        // BEFORE the raster call so a sequence that has been
        // running for sequenceTimeoutMs is rejected on the next
        // frame rather than after the frame completes.
        const elapsedMs = this.now() - sequence.startedAt;
        if (elapsedMs > this.limits.sequenceTimeoutMs) {
          this.settleInFlightAsFailed(sequence, 'SEQUENCE_TIMEOUT', `Sequence exceeded sequenceTimeoutMs=${this.limits.sequenceTimeoutMs}ms after ${elapsedMs}ms`);
          break;
        }

        // R2-B: cumulative pixel cap. Check BEFORE raster so we do
        // not allocate another frame once the limit is reached.
        if (sequence.cumulativePixelCount > this.limits.MAX_SEQUENCE_TOTAL_PIXELS) {
          this.settleInFlightAsFailed(sequence, 'BUDGET_EXCEEDED', `Cumulative pixel count ${sequence.cumulativePixelCount} exceeds MAX_SEQUENCE_TOTAL_PIXELS=${this.limits.MAX_SEQUENCE_TOTAL_PIXELS}`);
          break;
        }

        sequence.currentOrdinal += 1;
        const ordinal = sequence.currentOrdinal;
        const frameRequestId = `${requestId}/frame-${ordinal}`;
        sequence.currentFrameRequestId = frameRequestId;
        const frameStartAt = this.now();
        let rasterOutput: FlaStaticSnapshotRasterizeOutput;
        try {
          rasterOutput = await this.rasterizer.rasterize({
            requestId: frameRequestId,
            svg: frame.svg,
          } as FlaStaticSnapshotRasterizeInput);
        } catch (error) {
          // R2-D: cancellation / close / supersede. The R1
          // rasterizer's Promise rejects when its cancel() returns.
          if (sequence.cancelled) {
            // The sequence was cancelled while this frame was in
            // flight. Exit silently; the resolve below has already
            // been called by settleInFlightAsCancelled.
            break;
          }
          this.settleInFlightAsFailed(sequence, 'RENDERER_CRASH', `Rasterizer error: ${String(error)}`);
          break;
        }
        if (sequence.cancelled) {
          // Race: a cancel landed between resolve and the next
          // loop iteration check. Drop the result; the cancellation
          // has already settled the sequence.
          break;
        }

        const frameWallClockMs = this.now() - frameStartAt;

        // R2-B: per-frame output validation. The R1 rasterizer
        // already validates width/height/byteLength, but the
        // sequence service also accumulates the encoded-bytes cap
        // and the cumulative pixel cap after the fact so a
        // hard-to-detect per-frame overshoot is caught here.
        if (rasterOutput.width > this.limits.MAX_FRAME_WIDTH
          || rasterOutput.height > this.limits.MAX_FRAME_HEIGHT
          || rasterOutput.pixelCount > this.limits.MAX_FRAME_PIXELS) {
          this.settleInFlightAsFailed(sequence, 'BUDGET_EXCEEDED', `Frame ${ordinal} exceeds per-frame budget`);
          break;
        }
        sequence.cumulativeEncodedBytes += rasterOutput.pngBytes.byteLength;
        if (sequence.cumulativeEncodedBytes > this.limits.MAX_SEQUENCE_ENCODED_BYTES) {
          this.settleInFlightAsFailed(sequence, 'BUDGET_EXCEEDED', `Cumulative encoded bytes ${sequence.cumulativeEncodedBytes} exceeds MAX_SEQUENCE_ENCODED_BYTES=${this.limits.MAX_SEQUENCE_ENCODED_BYTES}`);
          break;
        }
        sequence.cumulativePixelCount += rasterOutput.pixelCount;
        if (sequence.cumulativePixelCount > this.limits.MAX_SEQUENCE_TOTAL_PIXELS) {
          this.settleInFlightAsFailed(sequence, 'BUDGET_EXCEEDED', `Cumulative pixel count ${sequence.cumulativePixelCount} exceeds MAX_SEQUENCE_TOTAL_PIXELS=${this.limits.MAX_SEQUENCE_TOTAL_PIXELS}`);
          break;
        }

        const item: SequenceInFlightItem = {
          frameIndex: frame.frameIndex,
          sequenceOrdinal: ordinal,
          rasterOutput,
          frameWallClockMs,
          receivedAt: this.now(),
        };
        sequence.items.push(item);
        sequence.currentFrameRequestId = null;
      }
    } catch (error) {
      this.settleInFlightAsFailed(sequence, 'RENDER_FAILED', `Frame source iteration error: ${String(error)}`);
      // R2-E: the result is settled; the caller observes the
      // error response. We do NOT throw.
    }

    // If the loop exited without settling (e.g. normal completion),
    // settle as success.
    if (this.inFlight.get(sessionId) === sequence) {
      this.settleInFlightAsSuccess(sequence);
    }
    return responsePromise;
  }

  /**
   * Cancel an in-flight sequence. If requestId is given, only that
   * sequence is cancelled. If omitted, the latest in-flight
   * sequence for the session is cancelled. R2-D: bounded
   * per-sequence cancel.
   */
  cancel(sessionId: string, requestId?: string): boolean {
    const sequence = this.inFlight.get(sessionId);
    if (!sequence) return false;
    if (requestId && sequence.sequenceRequestId !== requestId) return false;
    this.settleInFlightAsCancelled(sequence, 'Sequence cancelled by caller');
    return true;
  }

  /**
   * Close the service. Settles every in-flight sequence as
   * RENDER_FAILED and releases any per-sequence state. After
   * close(), renderSequence returns immediately with RENDER_FAILED.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: Array<[SequenceInFlight, string]> = [];
    for (const sequence of this.inFlight.values()) {
      errors.push([sequence, 'Sequence service closed']);
    }
    this.inFlight.clear();
    for (const [sequence, message] of errors) {
      this.settleInFlightAsFailed(sequence, 'RENDER_FAILED', message);
    }
  }

  // ---- Diagnostics (read-only) ----
  get isClosed(): boolean { return this.closed; }
  inFlightFor(sessionId: string): { sequenceRequestId: string; currentOrdinal: number; itemCount: number } | null {
    const s = this.inFlight.get(sessionId);
    if (!s) return null;
    return { sequenceRequestId: s.sequenceRequestId, currentOrdinal: s.currentOrdinal, itemCount: s.items.length };
  }

  // ---- Internal settlement helpers ----

  private settleInFlightAsCancelled(sequence: SequenceInFlight, message: string): void {
    if (sequence.cancelled) return; // Idempotent.
    sequence.cancelled = true;
    // Cancel the in-flight R1 raster job (if any). The R1 rasterizer's
    // Promise will reject; the for-await loop above will exit at the
    // next iteration check or mid-frame check.
    if (sequence.currentFrameRequestId) {
      try { this.rasterizer.cancel(sequence.currentFrameRequestId); } catch { /* ignore */ }
    }
    this.inFlight.delete(sequence.sessionId);
    sequence.resolve(makeError('SEQUENCE_CANCELLED', message, sequence.sequenceRequestId, sequence.items.length));
  }

  private settleInFlightAsFailed(sequence: SequenceInFlight, code: FlaFrameSequenceErrorCode, message: string): void {
    if (sequence.cancelled) return;
    sequence.cancelled = true;
    if (sequence.currentFrameRequestId) {
      try { this.rasterizer.cancel(sequence.currentFrameRequestId); } catch { /* ignore */ }
    }
    this.inFlight.delete(sequence.sessionId);
    sequence.resolve(makeError(code, message, sequence.sequenceRequestId, sequence.items.length));
  }

  private settleInFlightAsSuccess(sequence: SequenceInFlight): void {
    // R2-C: every completed item is wrapped with stable per-frame
    // identity. The R1 preview success shape is preserved
    // verbatim (R2 does not invent a new preview shape).
    const items: FlaFrameSequenceItem[] = sequence.items.map((it) => {
      const preview = {
        ok: true as const,
        // R2-C: the R1 preview response carries bytes, width, height,
        // pixelCount. The R2 contract's FlaStaticSnapshotPreviewSuccess
        // requires more fields (requestId, targetRenderTargetId,
        // targetSelectedFrameIndex, sha256, wallClockMs,
        // isFirstPreviewForSession, startedAt). The R1 rasterizer
        // owns those; here we only fill the per-frame subset we have
        // a proof of. sha256 is left empty for now; the sequence
        // commit path (R2-G) computes it from the encoded bytes.
        requestId: `${sequence.sequenceRequestId}/frame-${it.sequenceOrdinal}`,
        targetRenderTargetId: '', // Filled by the R2 commit path
        targetSelectedFrameIndex: it.frameIndex,
        sha256: '',
        wallClockMs: it.frameWallClockMs,
        isFirstPreviewForSession: it.sequenceOrdinal === 0,
        startedAt: new Date(it.receivedAt).toISOString(),
        bytes: it.rasterOutput.pngBytes,
        width: it.rasterOutput.width,
        height: it.rasterOutput.height,
        pixelCount: it.rasterOutput.pixelCount,
      };
      return {
        frameIndex: it.frameIndex,
        sequenceOrdinal: it.sequenceOrdinal,
        preview,
      };
    });
    const success: FlaFrameSequenceSuccess = {
      ok: true,
      requestId: sequence.sequenceRequestId,
      renderTargetId: '', // Set by the caller / commit path
      items,
      sequenceTotalMs: this.now() - sequence.startedAt,
      cancelledFrames: 0,
      totalPixelCount: sequence.cumulativePixelCount,
    };
    this.inFlight.delete(sequence.sessionId);
    sequence.resolve(success);
  }
}
