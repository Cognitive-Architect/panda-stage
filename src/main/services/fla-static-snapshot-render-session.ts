/**
 * V2-R1 Static Snapshot — Main-side render session orchestrator.
 *
 * Issue #287 R1-B (productize the render path) + R1-D (read-only /
 * ephemeral preview) + R1-E (commit guard plumbing).
 *
 * This class owns the *lifecycle and correctness* of one-frame snapshot
 * preview. It does NOT own a BrowserWindow directly; rasterization is
 * delegated to an injected {@link FlaStaticSnapshotRasterizer} so the
 * orchestration logic (stale-preview tracking, latest-request-wins
 * cancellation, first/subsequent timing, wall-clock budget) is unit
 * testable without spawning Electron. The production rasterizer
 * (src/main/services/fla-static-snapshot-window-manager.ts) wraps a
 * sandboxed, isolated BrowserWindow and is the only place the SVG
 * reaches the renderer.
 *
 * Security boundary (per R1-B and inherited R0 invariants):
 *  - the FLA source bytes never leave this process;
 *  - the rasterizer only ever receives a Main-built, bounded SVG string;
 *  - the rasterizer only ever returns bounded PNG bytes;
 *  - ActionScript is never executed (the SVG builder rejects archives
 *    that carry <Script>/<DOMScript> and the window is sandboxed).
 *
 * The session also acts as the confirmed-preview store consumed by the R1
 * commit path (R1-E): a successful preview is recorded under its
 * requestId and later pinned by the commit via confirmedPreviewRequestId
 * (the STALE_PREVIEW guard).
 */

import crypto from 'node:crypto';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  type BuildCatalogResult,
} from './fla-static-snapshot-svg-builder';
import {
  FLA_STATIC_SNAPSHOT_LIMITS,
  FlaStaticSnapshotCancelRequestSchema,
  FlaStaticSnapshotCancelResponseSchema,
  FlaStaticSnapshotPreviewRequestSchema,
  FlaStaticSnapshotPreviewResponseSchema,
  type FlaRenderTarget,
  type FlaStaticSnapshotCancelRequest,
  type FlaStaticSnapshotCancelResponse,
  type FlaStaticSnapshotPreviewErrorCode,
  type FlaStaticSnapshotPreviewRequest,
  type FlaStaticSnapshotPreviewResponse,
} from '../../shared/fla-static-snapshot-api';

export interface FlaStaticSnapshotRasterizeInput {
  /** End-to-end request identity: RenderSession preview requestId. */
  requestId: string;
  svg: string;
  width: number;
  height: number;
  pixelCount: number;
}

export interface FlaStaticSnapshotRasterizeOutput {
  pngBytes: Uint8Array;
  width: number;
  height: number;
  pixelCount: number;
}

export interface FlaStaticSnapshotRasterizer {
  rasterize(input: FlaStaticSnapshotRasterizeInput): Promise<FlaStaticSnapshotRasterizeOutput>;
  /** Bounded per-request cancellation: terminate/reject pending raster work. */
  cancel(requestId: string): boolean;
  close(): void;
}

export interface FlaStaticSnapshotSource {
  bytes: Uint8Array;
  basename: string;
  sha256: string;
}

export interface FlaStaticSnapshotSourceLookup {
  getSource(sessionId: string): FlaStaticSnapshotSource | null;
}

export interface FlaConfirmedSnapshotPreview {
  requestId: string;
  sessionId: string;
  pngBytes: Uint8Array;
  sha256: string;
  width: number;
  height: number;
  byteLength: number;
  target: FlaRenderTarget;
  source: { basename: string; sha256: string };
}

export interface FlaStaticSnapshotRenderSessionOptions {
  rasterizer?: FlaStaticSnapshotRasterizer;
  sourceLookup?: FlaStaticSnapshotSourceLookup;
  now?: () => Date;
  wallTimeMs?: number;
}

interface ActivePreview {
  sessionId: string;
  requestId: string;
  targetRenderTargetId: string;
  targetSelectedFrameIndex: number;
  startedAt: string;
  wallTimer: NodeJS.Timeout;
  settled: boolean;
  resolve: (response: FlaStaticSnapshotPreviewResponse) => void;
  settledPromise: Promise<FlaStaticSnapshotPreviewResponse>;
}

interface AcceptedPreview {
  requestId: string;
  target: FlaRenderTarget;
  sha256: string;
  width: number;
  height: number;
  byteLength: number;
}

export class FlaStaticSnapshotRenderSession {
  private readonly rasterizer: FlaStaticSnapshotRasterizer | null;
  private readonly sourceLookup: FlaStaticSnapshotSourceLookup | null;
  private readonly now: () => Date;
  private readonly wallTimeMs: number;

  private readonly active = new Map<string, ActivePreview>();
  private readonly sessionsWithPreview = new Set<string>();
  // sessionId -> latest accepted preview identity (STALE_PREVIEW guard).
  private readonly latestAccepted = new Map<string, AcceptedPreview>();
  // requestId -> confirmed preview bytes (R1-E consumption).
  private readonly confirmed = new Map<string, FlaConfirmedSnapshotPreview>();

  constructor(options: FlaStaticSnapshotRenderSessionOptions = {}) {
    this.rasterizer = options.rasterizer ?? null;
    this.sourceLookup = options.sourceLookup ?? null;
    this.now = options.now ?? (() => new Date());
    this.wallTimeMs = options.wallTimeMs ?? FLA_STATIC_SNAPSHOT_LIMITS.previewWallTimeMs;
  }

  /** R1-A catalog: discover renderable targets for an inspection session. */
  async catalog(sessionId: string): Promise<BuildCatalogResult> {
    const source = this.sourceLookup?.getSource(sessionId) ?? null;
    if (!source) {
      return {
        ok: false,
        code: 'SESSION_NOT_FOUND',
        message: 'The FLA inspection session has expired. Inspect the source again.',
      };
    }
    return buildRenderableTargetCatalog(source.bytes);
  }

  async preview(
    rawRequest: unknown,
  ): Promise<FlaStaticSnapshotPreviewResponse> {
    let request: FlaStaticSnapshotPreviewRequest;
    try {
      request = FlaStaticSnapshotPreviewRequestSchema.parse(rawRequest);
    } catch (error) {
      return this.previewError(
        'INVALID_REQUEST',
        `Invalid R1 snapshot preview request: ${String(error)}`,
      );
    }
    const { sessionId, requestId, target } = request;
    const source = this.sourceLookup?.getSource(sessionId) ?? null;
    if (!source) {
      return this.previewError('SESSION_NOT_FOUND', 'Inspection session not found', requestId);
    }
    const bytes = source.bytes;

    // Latest-request-wins: cancel any in-flight preview for the same session.
    for (const other of [...this.active.values()]) {
      if (other.sessionId === sessionId && other.requestId !== requestId) {
        this.settleActive(
          other,
          this.previewError('RENDER_CANCELLED', 'Superseded by a newer preview request', other.requestId),
        );
      }
    }

    const isFirst = !this.sessionsWithPreview.has(sessionId);
    const startedAt = this.now().toISOString();
    let resolvePreview!: (response: FlaStaticSnapshotPreviewResponse) => void;
    const settledPromise = new Promise<FlaStaticSnapshotPreviewResponse>((resolve) => {
      resolvePreview = resolve;
    });
    const active: ActivePreview = {
      sessionId,
      requestId,
      targetRenderTargetId: target.renderTargetId,
      targetSelectedFrameIndex: target.selectedFrameIndex ?? 0,
      startedAt,
      settled: false,
      resolve: resolvePreview,
      settledPromise,
      wallTimer: undefined as unknown as NodeJS.Timeout,
    };
    active.wallTimer = setTimeout(() => {
      if (active.settled) return;
      // C: stop the underlying rasterizer work when the wall clock fires.
      this.rasterizer?.cancel(requestId);
      this.settleActive(
        active,
        this.previewError('RENDER_TIMEOUT', 'Snapshot preview exceeded the wall-clock budget', requestId),
      );
    }, this.wallTimeMs);
    // Register BEFORE any `await` so an explicit cancel / latest-request-wins
    // supersede can interrupt the SVG build or rasterization below.
    this.active.set(requestId, active);

    const svgResult = await buildSvgForRenderTarget(bytes, target);
    if (active.settled) return active.settledPromise;
    if (!svgResult.ok) {
      this.settleActive(
        active,
        this.previewError(svgResult.code, svgResult.message, requestId),
      );
      return active.settledPromise;
    }

    if (!this.rasterizer) {
      this.settleActive(
        active,
        this.previewError('RENDER_FAILED', 'No rasterizer is available', requestId),
      );
      return active.settledPromise;
    }

    // Rasterization is delegated to the injected rasterizer and observed via
    // `settledPromise` (NOT a direct await). This way a wall-clock timeout or
    // an explicit cancel can settle the caller even while the rasterizer is
    // still pending (a stalling rasterizer must not hang the session).
    void this.rasterizer
      .rasterize({
        requestId,
        svg: svgResult.svg,
        width: svgResult.width,
        height: svgResult.height,
        pixelCount: svgResult.pixelCount,
      })
      .then(
        (raster) => {
          if (active.settled) return;
          const sha256 = crypto
            .createHash('sha256')
            .update(Buffer.from(raster.pngBytes))
            .digest('hex');
          const byteLength = raster.pngBytes.byteLength;
          if (byteLength <= 0 || byteLength > FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes) {
            this.settleActive(
              active,
              this.previewError('BUDGET_EXCEEDED', 'Rasterized snapshot exceeds the byte budget', requestId),
            );
            return;
          }
          const response = FlaStaticSnapshotPreviewResponseSchema.parse({
            ok: true,
            requestId,
            targetRenderTargetId: target.renderTargetId,
            targetSelectedFrameIndex: target.selectedFrameIndex ?? 0,
            width: raster.width,
            height: raster.height,
            pixelCount: raster.pixelCount,
            bytes: raster.pngBytes,
            sha256,
            wallClockMs: active.startedAt
              ? Math.max(0, Date.now() - new Date(active.startedAt).getTime())
              : 0,
            isFirstPreviewForSession: isFirst,
            startedAt,
          } satisfies FlaStaticSnapshotPreviewResponse);
          this.sessionsWithPreview.add(sessionId);
          // D: retain only the minimum ephemeral data for a safe commit.
          // Drop any previously accepted preview for this session before
          // pinning the new one, so retained PNG buffers stay bounded.
          this.releaseConfirmedForSessionExcept(sessionId, requestId);
          this.latestAccepted.set(sessionId, {
            requestId,
            target,
            sha256,
            width: raster.width,
            height: raster.height,
            byteLength,
          });
          this.confirmed.set(requestId, {
            requestId,
            sessionId,
            pngBytes: raster.pngBytes,
            sha256,
            width: raster.width,
            height: raster.height,
            byteLength,
            target,
            source: { basename: source.basename, sha256: source.sha256 },
          });
          this.settleActive(active, response);
        },
        (error) => {
          if (active.settled) return;
          this.settleActive(
            active,
            this.previewError(
              'RENDERER_CRASH',
              `Snapshot rasterization failed: ${error instanceof Error ? error.message : String(error)}`,
              requestId,
            ),
          );
        },
      );

    return active.settledPromise;
  }

  cancel(rawRequest: unknown): FlaStaticSnapshotCancelResponse {
    let request: FlaStaticSnapshotCancelRequest;
    try {
      request = FlaStaticSnapshotCancelRequestSchema.parse(rawRequest);
    } catch {
      return FlaStaticSnapshotCancelResponseSchema.parse({ accepted: false });
    }
    let cancelledRequestId: string | undefined;
    for (const other of [...this.active.values()]) {
      if (
        (request.requestId && other.requestId === request.requestId) ||
        (request.sessionId && other.sessionId === request.sessionId)
      ) {
        cancelledRequestId = other.requestId;
        // C: actually terminate the underlying rasterizer work for this
        // request so a cancelled job does not keep cooking in the hidden
        // BrowserWindow until its own wall timer fires.
        this.rasterizer?.cancel(other.requestId);
        this.settleActive(
          other,
          this.previewError('RENDER_CANCELLED', 'Snapshot preview was cancelled', other.requestId),
        );
      }
    }
    // B/D: a selection change or review close must invalidate any already
    // completed preview in Main, not only clear React state. Without this,
    // a settled preview would remain commit-eligible until a newer one
    // replaced it.
    if (request.sessionId) {
      this.invalidateSession(request.sessionId);
    }
    return FlaStaticSnapshotCancelResponseSchema.parse({
      accepted: cancelledRequestId !== undefined || Boolean(request.sessionId),
      ...(cancelledRequestId ? { cancelledRequestId } : {}),
    });
  }

  /**
   * B/D: drop the latest-accepted identity and every retained confirmed
   * preview for a session. After this, no preview for the session is
   * commit-eligible until a new successful preview pins one. Safe to call
   * on selection change, explicit cancel, or review close.
   */
  invalidateSession(sessionId: string): void {
    this.latestAccepted.delete(sessionId);
    for (const [requestId, preview] of [...this.confirmed.entries()]) {
      if (preview.sessionId === sessionId) {
        this.confirmed.delete(requestId);
      }
    }
  }

  /** R1-E store: returns the confirmed preview bytes for a commit requestId. */
  getConfirmedPreview(requestId: string): FlaConfirmedSnapshotPreview | null {
    return this.confirmed.get(requestId) ?? null;
  }

  /** Test/observability helper: count retained confirmed previews per session. */
  getConfirmedPreviewCount(sessionId: string): number {
    let count = 0;
    for (const preview of this.confirmed.values()) {
      if (preview.sessionId === sessionId) count += 1;
    }
    return count;
  }

  /** Test/observability helper: active (in-flight) request ids, optional session filter. */
  getActiveRequestIds(sessionId?: string): string[] {
    const ids: string[] = [];
    for (const active of this.active.values()) {
      if (!sessionId || active.sessionId === sessionId) ids.push(active.requestId);
    }
    return ids;
  }

  releasePreview(requestId: string): void {
    this.confirmed.delete(requestId);
  }

  /** True only when requestId is the latest accepted preview for its session. */
  isLatestAcceptedPreview(sessionId: string, requestId: string): boolean {
    const latest = this.latestAccepted.get(sessionId);
    return Boolean(latest && latest.requestId === requestId);
  }

  /** D: release every confirmed preview for a session except one requestId. */
  private releaseConfirmedForSessionExcept(sessionId: string, exceptRequestId: string): void {
    for (const [requestId, preview] of [...this.confirmed.entries()]) {
      if (preview.sessionId === sessionId && requestId !== exceptRequestId) {
        this.confirmed.delete(requestId);
      }
    }
  }

  close(): void {
    for (const other of [...this.active.values()]) {
      this.settleActive(
        other,
        this.previewError('RENDER_CANCELLED', 'Snapshot session closed', other.requestId),
      );
    }
    this.sessionsWithPreview.clear();
    this.latestAccepted.clear();
    this.confirmed.clear();
    this.rasterizer?.close();
  }

  private previewError(
    code: FlaStaticSnapshotPreviewErrorCode,
    message: string,
    requestId?: string,
  ): FlaStaticSnapshotPreviewResponse {
    return FlaStaticSnapshotPreviewResponseSchema.parse({
      ok: false,
      error: { code, message: message.slice(0, 1_000), ...(requestId ? { requestId } : {}) },
    });
  }

  private settleActive(
    active: ActivePreview,
    response: FlaStaticSnapshotPreviewResponse,
  ): void {
    if (active.settled) return;
    active.settled = true;
    clearTimeout(active.wallTimer);
    this.active.delete(active.requestId);
    // `preview()` always awaits `settledPromise`, so resolving (never
    // rejecting) keeps the caller's promise settled with a typed
    // response object rather than an uncaught rejection.
    active.resolve(response);
  }
}
