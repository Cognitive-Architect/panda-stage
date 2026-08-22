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

import { createHash, randomUUID } from 'node:crypto';
import type {
  FlaFrameSequenceErrorCode,
  FlaFrameSequenceItem,
  FlaFrameSequenceProgress,
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
  /** Total frame count for this request (range end - start + 1). */
  readonly totalFrames: number;
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

// ---- R2-D acceptance store ----
//
// Mirrors the R1 AcceptedPreview / FlaConfirmedSnapshotPreview split:
//   - latestAcceptedSequence: per-session pointer for the
//     STALE_SEQUENCE guard consumed by the R2-G commit service.
//   - confirmedSequences: per-requestId byte store for the R2-G
//     commit service to read each frame's PNG without re-rasterizing.
//
// On a new accepted sequence we drop any previously confirmed
// frames for the same session (releaseConfirmedForSessionExcept
// in the R1 equivalent) so Main-owned temporary PNG state stays
// bounded to the most recent sequence. The release is invoked
// either by a fresh successful sequence for the same session, or
// by invalidateSequenceSession (called by the UI on close /
// cancel / range change).

export interface ConfirmedSequenceFrame {
  frameIndex: number;
  sequenceOrdinal: number;
  pngBytes: Uint8Array;
  sha256: string;
  width: number;
  height: number;
  pixelCount: number;
  byteLength: number;
  frameWallClockMs: number;
  receivedAt: number;
}

export interface AcceptedSequence {
  requestId: string;
  sessionId: string;
  range: FlaFrameSequenceRange;
  items: ConfirmedSequenceFrame[];
  totalPixelCount: number;
  sequenceTotalMs: number;
  acceptedAt: number;
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
  // R2-D: per-session latest accepted sequence (STALE_SEQUENCE
  // guard consumed by R2-G commit service).
  private readonly latestAccepted = new Map<string, AcceptedSequence>();
  // R2-D: per-requestId confirmed frame store (R2-G commit
  // service reads PNG bytes from here).
  private readonly confirmedSequences = new Map<string, ConfirmedSequenceFrame[]>();
  private closed = false;
  // R2-B (Corrective B): typed progress subscribers. Mirrors the
  // ExportService subscribe model. Subscribers receive progress only
  // for the requestId they are actively watching (the Renderer filters
  // by requestId); the service emits after each frame completes.
  private readonly progressSubscribers = new Set<(progress: FlaFrameSequenceProgress) => void>();

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
      totalFrames,
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
        // R2-B (Corrective B): emit monotonic progress for the current
        // request. completedFrameCount = number of frames done so far.
        this.emitProgress({
          format: 'fla-frame-sequence-progress',
          version: 1,
          sessionId: sequence.sessionId,
          requestId: sequence.sequenceRequestId,
          completedFrameCount: sequence.items.length,
          totalFrameCount: sequence.totalFrames,
          currentFrameIndex: frame.frameIndex,
        });
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
    this.latestAccepted.clear();
    this.confirmedSequences.clear();
    for (const [sequence, message] of errors) {
      this.settleInFlightAsFailed(sequence, 'RENDER_FAILED', message);
    }
  }

  // ---- R2-B real progress (Corrective B) ----
  //
  // Subscribe to typed per-frame progress. Returns an unsubscribe
  // function. The service emits one progress event per completed frame
  // (monotonic completedFrameCount) so the Renderer can show live
  // "k / N" without polling. Stale-request discrimination is the
  // Renderer's job (it only listens while its active requestId matches).

  subscribe(
    callback: (progress: FlaFrameSequenceProgress) => void,
  ): () => void {
    this.progressSubscribers.add(callback);
    return () => {
      this.progressSubscribers.delete(callback);
    };
  }

  private emitProgress(progress: FlaFrameSequenceProgress): void {
    for (const subscriber of this.progressSubscribers) {
      try {
        subscriber(progress);
      } catch {
        /* a misbehaving subscriber must not break the sequence */
      }
    }
  }

  // ---- Diagnostics (read-only) ----
  get isClosed(): boolean { return this.closed; }
  inFlightFor(sessionId: string): { sequenceRequestId: string; currentOrdinal: number; itemCount: number } | null {
    const s = this.inFlight.get(sessionId);
    if (!s) return null;
    return { sequenceRequestId: s.sequenceRequestId, currentOrdinal: s.currentOrdinal, itemCount: s.items.length };
  }
  latestAcceptedFor(sessionId: string): { requestId: string; itemCount: number } | null {
    const a = this.latestAccepted.get(sessionId);
    if (!a) return null;
    return { requestId: a.requestId, itemCount: a.items.length };
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
    // R2-D: at the same time, build the ConfirmedSequenceFrame list
    // (with sha256EachFrame) and pin it under
    // latestAccepted[sessionId] / confirmedSequences[requestId] so
    // the R2-G commit service can (a) verify confirmedSequenceRequestId
    // is still the latest accepted sequence and (b) read the PNG
    // bytes for atomic commit.
    const confirmedItems: ConfirmedSequenceFrame[] = sequence.items.map((it) => {
      const sha256 = createHash('sha256')
        .update(Buffer.from(it.rasterOutput.pngBytes))
        .digest('hex');
      return {
        frameIndex: it.frameIndex,
        sequenceOrdinal: it.sequenceOrdinal,
        pngBytes: it.rasterOutput.pngBytes,
        sha256,
        width: it.rasterOutput.width,
        height: it.rasterOutput.height,
        pixelCount: it.rasterOutput.pixelCount,
        byteLength: it.rasterOutput.pngBytes.byteLength,
        frameWallClockMs: it.frameWallClockMs,
        receivedAt: it.receivedAt,
      };
    });
    const items: FlaFrameSequenceItem[] = sequence.items.map((it, idx) => {
      const confirmed = confirmedItems[idx];
      if (!confirmed) {
        throw new Error('Settled sequence items and confirmed frames out of sync');
      }
      const preview = {
        ok: true as const,
        requestId: `${sequence.sequenceRequestId}/frame-${it.sequenceOrdinal}`,
        targetRenderTargetId: '', // Filled by the R2 commit path
        targetSelectedFrameIndex: it.frameIndex,
        sha256: confirmed.sha256,
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
    // R2-D: drop any previously confirmed sequence for the same
    // session before pinning the new one. Mirrors the R1
    // releaseConfirmedForSessionExcept behavior; the Main-owned
    // PNG buffers are kept bounded to the most recent sequence.
    this.releaseConfirmedForSessionExcept(sequence.sessionId, sequence.sequenceRequestId);
    this.confirmedSequences.set(sequence.sequenceRequestId, confirmedItems);
    this.latestAccepted.set(sequence.sessionId, {
      requestId: sequence.sequenceRequestId,
      sessionId: sequence.sessionId,
      // range is intentionally a copy of the in-flight range so
      // commit can verify the request range matches without
      // re-parsing the in-flight state.
      range: {
        renderTargetId: sequence.items[0]
          ? success.items[0]?.preview.targetRenderTargetId ?? ''
          : '',
        startFrameIndex: sequence.items[0]?.frameIndex ?? 0,
        endFrameIndex: sequence.items[sequence.items.length - 1]?.frameIndex ?? 0,
      },
      items: confirmedItems,
      totalPixelCount: sequence.cumulativePixelCount,
      sequenceTotalMs: success.sequenceTotalMs,
      acceptedAt: this.now(),
    });
    this.inFlight.delete(sequence.sessionId);
    sequence.resolve(success);
  }

  // ---- R2-D acceptance store (R2-G commit service consumes) ----

  /**
   * R2-D STALE_SEQUENCE guard. True only when requestId is the
   * latest accepted sequence for its session. Used by the R2-G
   * commit service to reject commits that pin a superseded
   * sequence.
   */
  isLatestAcceptedSequence(sessionId: string, requestId: string): boolean {
    const latest = this.latestAccepted.get(sessionId);
    return Boolean(latest && latest.requestId === requestId);
  }

  /**
   * R2-D: returns the confirmed frame list for a sequence
   * requestId, or null if the sequence has been released or
   * superseded. R2-G reads the PNG bytes from here to do the
   * atomic file commit without re-rasterizing.
   */
  getConfirmedSequence(requestId: string): ConfirmedSequenceFrame[] | null {
    return this.confirmedSequences.get(requestId) ?? null;
  }

  /** R2-D: drop the per-requestId confirmed frame list. Called by
   * R2-G after a successful commit (mirrors R1 releasePreview). */
  releaseSequence(requestId: string): void {
    this.confirmedSequences.delete(requestId);
  }

  /**
   * R2-D: invalidate every confirmed sequence for a session. The
   * UI calls this on close / cancel / target / range change so no
   * stale previews are commit-eligible.
   */
  invalidateSequenceSession(sessionId: string): void {
    const previous = this.latestAccepted.get(sessionId);
    if (previous) {
      this.confirmedSequences.delete(previous.requestId);
    }
    this.latestAccepted.delete(sessionId);
  }

  private releaseConfirmedForSessionExcept(sessionId: string, exceptRequestId: string): void {
    // If a previous sequence was pinned for this session, drop
    // its frame bytes now so the Main-owned PNG buffers stay
    // bounded to the most recent sequence. The new sequence is
    // pinned by the caller immediately after this returns.
    const previous = this.latestAccepted.get(sessionId);
    if (previous && previous.requestId !== exceptRequestId) {
      this.confirmedSequences.delete(previous.requestId);
    }
  }
}
