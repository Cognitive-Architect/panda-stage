import { describe, expect, it } from 'vitest';
import {
  FlaFrameSequenceService,
  type SequenceFrameInput,
} from '../../src/main/services/fla-frame-sequence-service';
import {
  FLA_FRAME_SEQUENCE_LIMITS,
  type FlaFrameSequenceRange,
} from '../../src/shared/fla-frame-sequence-api';
import type {
  FlaStaticSnapshotRasterizeInput,
  FlaStaticSnapshotRasterizeOutput,
  FlaStaticSnapshotRasterizer,
} from '../../src/main/services/fla-static-snapshot-render-session';

// ---- Test fakes ----

interface RasterCallRecord {
  input: FlaStaticSnapshotRasterizeInput;
  resolve: (output: FlaStaticSnapshotRasterizeOutput) => void;
  reject: (error: Error) => void;
}

class FakeRasterizer implements FlaStaticSnapshotRasterizer {
  public calls: RasterCallRecord[] = [];
  public activeCount = 0;
  public peakActive = 0;
  /** If set, the matching call is rejected with the given error before resolving. */
  public rejectWith: { inputRequestId: string; message: string } | null = null;
  /** Auto-resolve each call as soon as it arrives (default). When
   * false, tests must call `release()` manually. */
  public autoResolve: boolean = true;
  /** Optional per-call output overrides (keyed by requestId). */
  public outputOverrides: Map<string, Partial<FlaStaticSnapshotRasterizeOutput>> = new Map();
  /** Default per-frame output. */
  public defaultOutput: Partial<FlaStaticSnapshotRasterizeOutput> = {};

  rasterize(input: FlaStaticSnapshotRasterizeInput): Promise<FlaStaticSnapshotRasterizeOutput> {
    this.activeCount += 1;
    this.peakActive = Math.max(this.peakActive, this.activeCount);
    return new Promise<FlaStaticSnapshotRasterizeOutput>((resolve, reject) => {
      const record: RasterCallRecord = { input, resolve, reject };
      this.calls.push(record);
      if (this.rejectWith && this.rejectWith.inputRequestId === input.requestId) {
        queueMicrotask(() => {
          this.activeCount -= 1;
          this.calls = this.calls.filter((c) => c !== record);
          reject(new Error(this.rejectWith?.message ?? 'rasterizer failure'));
        });
        return;
      }
      if (this.autoResolve) {
        // Resolve on the next microtask so the orchestrator's
        // for-await has a chance to register the in-flight call
        // before the promise resolves.
        queueMicrotask(() => {
          this.activeCount -= 1;
          this.calls = this.calls.filter((c) => c !== record);
          const override = this.outputOverrides.get(input.requestId) ?? this.defaultOutput;
          const final: FlaStaticSnapshotRasterizeOutput = {
            pngBytes: override.pngBytes ?? new Uint8Array(8),
            width: override.width ?? 1920,
            height: override.height ?? 1080,
            pixelCount: override.pixelCount ?? 1920 * 1080,
          };
          resolve(final);
        });
      }
    });
  }

  cancel(requestId: string): boolean {
    const idx = this.calls.findIndex((c) => c.input.requestId === requestId);
    if (idx < 0) return false;
    const [record] = this.calls.splice(idx, 1);
    if (!record) return false;
    this.activeCount -= 1;
    record.reject(new Error('Snapshot rasterization cancelled'));
    return true;
  }

  release(requestId: string, output: Partial<FlaStaticSnapshotRasterizeOutput> = {}): void {
    const idx = this.calls.findIndex((c) => c.input.requestId === requestId);
    if (idx < 0) return;
    const [record] = this.calls.splice(idx, 1);
    if (!record) return;
    this.activeCount -= 1;
    const final: FlaStaticSnapshotRasterizeOutput = {
      pngBytes: output.pngBytes ?? new Uint8Array(8),
      width: output.width ?? 1920,
      height: output.height ?? 1080,
      pixelCount: output.pixelCount ?? 1920 * 1080,
    };
    record.resolve(final);
  }

  hasPending(requestId: string): boolean {
    return this.calls.some((c) => c.input.requestId === requestId);
  }

  close(): void {
    // no-op for tests; the production rasterizer tears down the
    // sandboxed BrowserWindow, which is irrelevant here.
  }
}

/**
 * Wait for `times` full task ticks. Each `setImmediate` resolves on
 * the next event-loop turn, which guarantees every pending
 * microtask in the orchestrator's for-await chain has drained
 * (resolve → continuation → push → next iter → next rasterize call).
 * `await Promise.resolve()` chains are not reliable here because
 * vitest's own hooks may insert an extra microtask between ours.
 */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function makeRange(start: number, end: number): FlaFrameSequenceRange {
  return { renderTargetId: 'fla-render-target-1a2b3c4d5e6f7a8b', startFrameIndex: start, endFrameIndex: end };
}

function frames(N: number): SequenceFrameInput[] {
  return Array.from({ length: N }, (_, i) => ({ frameIndex: i, svg: `<svg data-i="${i}"/>` }));
}

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const SEQ_REQ = '00000000-0000-4000-8000-0000000000aa';

// ---- Tests ----

describe('R2-C sequence service: deterministic sequential rendering', () => {
  it('renders frames in ascending frameIndex order', async () => {
    const rasterizer = new FakeRasterizer();
    const order: string[] = [];
    const original = rasterizer.rasterize.bind(rasterizer);
    rasterizer.rasterize = (input) => {
      order.push(input.requestId);
      return original(input);
    };
    const service = new FlaFrameSequenceService({ rasterizer });
    const N = 6;
    const r = await service.renderSequence(
      SESSION_ID,
      makeRange(0, N - 1),
      frames(N),
      { sequenceRequestId: SEQ_REQ },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(order).toEqual([
        `${SEQ_REQ}/frame-0`,
        `${SEQ_REQ}/frame-1`,
        `${SEQ_REQ}/frame-2`,
        `${SEQ_REQ}/frame-3`,
        `${SEQ_REQ}/frame-4`,
        `${SEQ_REQ}/frame-5`,
      ]);
      expect(r.items).toHaveLength(N);
      for (let i = 0; i < N; i++) {
        expect(r.items[i]?.frameIndex).toBe(i);
        expect(r.items[i]?.sequenceOrdinal).toBe(i);
      }
    }
  });

  it('actual raster concurrency never exceeds 1 (R2-B)', async () => {
    const rasterizer = new FakeRasterizer();
    const service = new FlaFrameSequenceService({ rasterizer });
    const N = 4;
    const r = await service.renderSequence(SESSION_ID, makeRange(0, N - 1), frames(N));
    expect(r.ok).toBe(true);
    expect(rasterizer.peakActive).toBe(1);
  });
});

describe('R2-C sequence service: budget enforcement (R2-B)', () => {
  it('rejects a range that exceeds MAX_SEQUENCE_FRAMES at the service layer', async () => {
    const rasterizer = new FakeRasterizer();
    const service = new FlaFrameSequenceService({ rasterizer });
    const span = FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES + 1;
    const r = await service.renderSequence(
      SESSION_ID,
      makeRange(0, span - 1),
      frames(span),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('RANGE_TOO_LARGE');
      expect(r.error.completedFrameCount).toBe(0);
    }
  });

  it('returns BUDGET_EXCEEDED when cumulative pixel count exceeds MAX_SEQUENCE_TOTAL_PIXELS', async () => {
    const rasterizer = new FakeRasterizer();
    rasterizer.autoResolve = false;
    // Drive two frames whose combined pixel count trips the cumulative
    // cap. We override the per-sequence cumulative cap via
    // `limits` so the test can exercise the cumulative-trip branch
    // without exceeding the production MAX_FRAME_PIXELS
    // (= 16,777,216). In production R1 rasterizer output is already
    // capped at MAX_FRAME_PIXELS, so cumulative trips in the field
    // only when the rasterizer itself lies; the per-frame check is
    // the primary guard, and the cumulative check is the belt-and-
    // suspenders safety net.
    const perFramePixels = 100_001;
    const limitsOverride = {
      ...FLA_FRAME_SEQUENCE_LIMITS,
      MAX_SEQUENCE_TOTAL_PIXELS: 2 * perFramePixels - 1,
    } as typeof FLA_FRAME_SEQUENCE_LIMITS;
    const service = new FlaFrameSequenceService({ rasterizer, limits: limitsOverride });
    const N = 4;
    const renderP = service.renderSequence(
      SESSION_ID,
      makeRange(0, N - 1),
      frames(N),
      { sequenceRequestId: SEQ_REQ },
    );
    await flush(4);
    rasterizer.release(`${SEQ_REQ}/frame-0`, { pixelCount: perFramePixels });
    await flush(4);
    rasterizer.release(`${SEQ_REQ}/frame-1`, { pixelCount: perFramePixels });
    const r = await renderP;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('BUDGET_EXCEEDED');
      expect(r.error.completedFrameCount).toBe(1);
    }
  });

  it('returns BUDGET_EXCEEDED when cumulative encoded bytes exceed MAX_SEQUENCE_ENCODED_BYTES', async () => {
    const rasterizer = new FakeRasterizer();
    rasterizer.autoResolve = false;
    // Each per-frame pngBytes is just over MAX_SEQUENCE_ENCODED_BYTES
    // / 2 so the second frame's cumulative push trips the cap. The
    // per-frame check is intentionally NOT triggered (a single
    // per-frame output well under the R1 maxSnapshotBytes cap is
    // what a real R1 rasterizer would produce here).
    const perFrameBytes = Math.floor(FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_ENCODED_BYTES / 2) + 1;
    const service = new FlaFrameSequenceService({ rasterizer });
    const N = 4;
    const renderP = service.renderSequence(
      SESSION_ID,
      makeRange(0, N - 1),
      frames(N),
      { sequenceRequestId: SEQ_REQ },
    );
    await flush(4);
    rasterizer.release(`${SEQ_REQ}/frame-0`, { pngBytes: new Uint8Array(perFrameBytes) });
    await flush(4);
    rasterizer.release(`${SEQ_REQ}/frame-1`, { pngBytes: new Uint8Array(perFrameBytes) });
    const r = await renderP;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('BUDGET_EXCEEDED');
      expect(r.error.completedFrameCount).toBe(1);
    }
  });

  it('returns SEQUENCE_TIMEOUT when cumulative wall time exceeds sequenceTimeoutMs', async () => {
    const rasterizer = new FakeRasterizer();
    rasterizer.autoResolve = false;
    let nowValue = 0;
    const service = new FlaFrameSequenceService({ rasterizer, now: () => nowValue });
    const N = 6;
    const renderP = service.renderSequence(
      SESSION_ID,
      makeRange(0, N - 1),
      frames(N),
      { sequenceRequestId: SEQ_REQ },
    );
    await flush(4);
    // Frame 0 is in flight. Release it; the orchestrator resumes,
    // pushes the item, and re-enters the next iter top to start
    // frame 1. We jump the clock BEFORE that next-pre check runs.
    rasterizer.release(`${SEQ_REQ}/frame-0`);
    nowValue = FLA_FRAME_SEQUENCE_LIMITS.sequenceTimeoutMs + 1;
    await flush(4);
    const r = await renderP;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('SEQUENCE_TIMEOUT');
      expect(r.error.completedFrameCount).toBe(1);
    }
  });
});

describe('R2-D sequence service: cancellation', () => {
  it('cancel() stops the in-flight raster and prevents K+1 from starting', async () => {
    const rasterizer = new FakeRasterizer();
    rasterizer.autoResolve = false;
    const service = new FlaFrameSequenceService({ rasterizer });
    const N = 5;
    const renderP = service.renderSequence(SESSION_ID, makeRange(0, N - 1), frames(N));
    await flush(4);
    expect(rasterizer.activeCount).toBe(1);
    const cancelled = service.cancel(SESSION_ID);
    expect(cancelled).toBe(true);
    const r = await renderP;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('SEQUENCE_CANCELLED');
      expect(r.error.completedFrameCount).toBe(0);
    }
    expect(rasterizer.calls.filter((c) => c.input.requestId.endsWith('/frame-1')).length).toBe(0);
  });

  it('cancel() with requestId of a different sequence is a no-op', async () => {
    const rasterizer = new FakeRasterizer();
    const service = new FlaFrameSequenceService({ rasterizer });
    const renderP = service.renderSequence(SESSION_ID, makeRange(0, 0), frames(1));
    await flush(2);
    const cancelled = service.cancel(SESSION_ID, '00000000-0000-4000-8000-000000000099');
    expect(cancelled).toBe(false);
    const r = await renderP;
    expect(r.ok).toBe(true);
  });
});

describe('R2-D sequence service: latest-request-wins (supersede)', () => {
  it('starting a new sequence for the same session cancels the previous', async () => {
    const rasterizer = new FakeRasterizer();
    rasterizer.autoResolve = false;
    const service = new FlaFrameSequenceService({ rasterizer });
    const firstP = service.renderSequence(SESSION_ID, makeRange(0, 4), frames(5), {
      sequenceRequestId: '00000000-0000-4000-8000-000000000aaa',
    });
    await flush(4);
    const secondP = service.renderSequence(SESSION_ID, makeRange(0, 1), frames(2), {
      sequenceRequestId: '00000000-0000-4000-8000-000000000bbb',
    });
    const r1 = await firstP;
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.code).toBe('SEQUENCE_CANCELLED');
      expect(r1.error.completedFrameCount).toBe(0);
    }
    // Drive second sequence.
    await flush(4);
    rasterizer.release('00000000-0000-4000-8000-000000000bbb/frame-0');
    await flush(2);
    rasterizer.release('00000000-0000-4000-8000-000000000bbb/frame-1');
    const r2 = await secondP;
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.items).toHaveLength(2);
  });
});

describe('R2-D sequence service: close()', () => {
  it('close() settles all in-flight sequences as RENDER_FAILED', async () => {
    const rasterizer = new FakeRasterizer();
    rasterizer.autoResolve = false;
    const service = new FlaFrameSequenceService({ rasterizer });
    const p = service.renderSequence(SESSION_ID, makeRange(0, 0), frames(1));
    await flush(4);
    service.close();
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('RENDER_FAILED');
  });

  it('renderSequence after close() returns RENDER_FAILED', async () => {
    const rasterizer = new FakeRasterizer();
    const service = new FlaFrameSequenceService({ rasterizer });
    service.close();
    const r = await service.renderSequence(SESSION_ID, makeRange(0, 0), frames(1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('RENDER_FAILED');
  });
});

describe('R2-D sequence service: error mapping', () => {
  it('maps a RENDERER_CRASH to RENDERER_CRASH', async () => {
    const rasterizer = new FakeRasterizer();
    rasterizer.rejectWith = { inputRequestId: `${SEQ_REQ}/frame-0`, message: 'browser died' };
    const service = new FlaFrameSequenceService({ rasterizer });
    const r = await service.renderSequence(
      SESSION_ID,
      makeRange(0, 0),
      frames(1),
      { sequenceRequestId: SEQ_REQ },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('RENDERER_CRASH');
      expect(r.error.message).toContain('browser died');
    }
  });
});

describe('R2-C sequence service: diagnostics', () => {
  it('inFlightFor() returns null when no sequence is running', () => {
    const rasterizer = new FakeRasterizer();
    const service = new FlaFrameSequenceService({ rasterizer });
    expect(service.inFlightFor(SESSION_ID)).toBeNull();
  });

  it('inFlightFor() returns current ordinal and item count', async () => {
    const rasterizer = new FakeRasterizer();
    rasterizer.autoResolve = false;
    const service = new FlaFrameSequenceService({ rasterizer });
    const p = service.renderSequence(
      SESSION_ID,
      makeRange(0, 2),
      frames(3),
      { sequenceRequestId: SEQ_REQ },
    );
    await flush(4);
    const info = service.inFlightFor(SESSION_ID);
    expect(info).not.toBeNull();
    expect(info?.currentOrdinal).toBe(0);
    expect(info?.itemCount).toBe(0);
    rasterizer.release(`${SEQ_REQ}/frame-0`);
    await flush(4);
    const info2 = service.inFlightFor(SESSION_ID);
    expect(info2?.currentOrdinal).toBe(1);
    expect(info2?.itemCount).toBe(1);
    rasterizer.release(`${SEQ_REQ}/frame-1`);
    await flush(4);
    rasterizer.release(`${SEQ_REQ}/frame-2`);
    const r = await p;
    expect(r.ok).toBe(true);
  });
});

describe('R2-D sequence service: acceptance store (R2-G commit input)', () => {
  it('pins the latest accepted sequence on success and exposes sha256 per frame', async () => {
    const rasterizer = new FakeRasterizer();
    const service = new FlaFrameSequenceService({ rasterizer });
    const r = await service.renderSequence(
      SESSION_ID,
      makeRange(0, 1),
      frames(2),
      { sequenceRequestId: SEQ_REQ },
    );
    expect(r.ok).toBe(true);
    expect(service.isLatestAcceptedSequence(SESSION_ID, SEQ_REQ)).toBe(true);
    const confirmed = service.getConfirmedSequence(SEQ_REQ);
    expect(confirmed).not.toBeNull();
    expect(confirmed).toHaveLength(2);
    // sha256 is a 64-char hex string per confirmed frame.
    expect(confirmed?.[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(confirmed?.[1]?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(confirmed?.[0]?.byteLength).toBe(8);
  });

  it('STALE_SEQUENCE: a new accepted sequence supersedes the previous and drops its confirmed bytes', async () => {
    const rasterizer = new FakeRasterizer();
    const service = new FlaFrameSequenceService({ rasterizer });
    const SEQ_REQ_1 = '00000000-0000-4000-8000-0000000000a1';
    const SEQ_REQ_2 = '00000000-0000-4000-8000-0000000000a2';
    const r1 = await service.renderSequence(
      SESSION_ID,
      makeRange(0, 0),
      frames(1),
      { sequenceRequestId: SEQ_REQ_1 },
    );
    expect(r1.ok).toBe(true);
    expect(service.isLatestAcceptedSequence(SESSION_ID, SEQ_REQ_1)).toBe(true);
    // Same session, second sequence wins.
    const r2 = await service.renderSequence(
      SESSION_ID,
      makeRange(0, 1),
      frames(2),
      { sequenceRequestId: SEQ_REQ_2 },
    );
    expect(r2.ok).toBe(true);
    expect(service.isLatestAcceptedSequence(SESSION_ID, SEQ_REQ_2)).toBe(true);
    expect(service.isLatestAcceptedSequence(SESSION_ID, SEQ_REQ_1)).toBe(false);
    // The previous sequence's confirmed bytes are dropped so Main-owned
    // PNG buffers stay bounded to the most recent sequence.
    expect(service.getConfirmedSequence(SEQ_REQ_1)).toBeNull();
    expect(service.getConfirmedSequence(SEQ_REQ_2)).toHaveLength(2);
  });

  it('releaseSequence() drops the confirmed frame list while leaving latestAccepted intact', async () => {
    const rasterizer = new FakeRasterizer();
    const service = new FlaFrameSequenceService({ rasterizer });
    const r = await service.renderSequence(
      SESSION_ID,
      makeRange(0, 0),
      frames(1),
      { sequenceRequestId: SEQ_REQ },
    );
    expect(r.ok).toBe(true);
    expect(service.getConfirmedSequence(SEQ_REQ)).toHaveLength(1);
    service.releaseSequence(SEQ_REQ);
    expect(service.getConfirmedSequence(SEQ_REQ)).toBeNull();
    // latestAccepted is the STALE_SEQUENCE guard; releaseSequence
    // does not touch it (mirror of R1 releasePreview).
    expect(service.isLatestAcceptedSequence(SESSION_ID, SEQ_REQ)).toBe(true);
  });

  it('invalidateSequenceSession() drops both latestAccepted and confirmed bytes for the session', async () => {
    const rasterizer = new FakeRasterizer();
    const service = new FlaFrameSequenceService({ rasterizer });
    const r = await service.renderSequence(
      SESSION_ID,
      makeRange(0, 0),
      frames(1),
      { sequenceRequestId: SEQ_REQ },
    );
    expect(r.ok).toBe(true);
    service.invalidateSequenceSession(SESSION_ID);
    expect(service.isLatestAcceptedSequence(SESSION_ID, SEQ_REQ)).toBe(false);
    expect(service.getConfirmedSequence(SEQ_REQ)).toBeNull();
  });

  it('close() clears acceptance and releases any leftover confirmed bytes', async () => {
    const rasterizer = new FakeRasterizer();
    const service = new FlaFrameSequenceService({ rasterizer });
    const r = await service.renderSequence(
      SESSION_ID,
      makeRange(0, 0),
      frames(1),
      { sequenceRequestId: SEQ_REQ },
    );
    expect(r.ok).toBe(true);
    service.close();
    expect(service.isClosed).toBe(true);
    expect(service.isLatestAcceptedSequence(SESSION_ID, SEQ_REQ)).toBe(false);
    expect(service.getConfirmedSequence(SEQ_REQ)).toBeNull();
  });
});
