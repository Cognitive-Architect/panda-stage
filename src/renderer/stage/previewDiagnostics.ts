/** Optional, bounded external probe used only by the Issue #629 diagnostic runner. */
export interface PreviewDiagnosticSink {
  record(event: string, atMs: number, detail: Record<string, number | string | boolean | null>): void;
  /** Enables the #964 frame trace in addition to existing preview diagnostics. */
  frameTraceEnabled?: boolean;
  /** Diagnostic-only backing resolution; absent in normal product use. */
  scenePixelRatio?: number;
  /** Diagnostic-only switch to compare the previous rebuild-on-render path. */
  forceCompositeCacheRebuild?: boolean;
}

export interface PreviewFrameTraceContext {
  traceId: string;
  instanceId: string;
  playbackGeneration: number;
  seekGeneration: number;
  targetEpoch: number;
  shotId: string;
  shotTimeMs: number;
  cycleIndex: number;
  frameIndex: number;
  targetFrameId: string;
  targetAssetId: string;
  requestedAt: number;
}

export type PreviewFrameTraceStatus =
  | 'COMMITTED'
  | 'SUPERSEDED'
  | 'PENDING'
  | 'FAILED'
  | 'CANCELLED';

function sink(): PreviewDiagnosticSink | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { __pandaPreviewDiagnostics?: PreviewDiagnosticSink })
    .__pandaPreviewDiagnostics;
}

const MAX_TRACKED_FRAME_TRACES = 256;
const MAX_ACTIVE_FRAME_TRACES = 16;
const MAX_DEDUPED_FRAME_EVENTS = 1_024;
const MAX_FRAME_TRACE_EVENTS = 4_096;
const frameTraceStatuses = new Map<string, PreviewFrameTraceStatus>();
const latestFrameTraceByInstance = new Map<string, PreviewFrameTraceContext>();
const dedupedFrameEvents = new Set<string>();
let frameTraceEventCount = 0;

export function previewFrameDiagnosticsEnabled(): boolean {
  return sink()?.frameTraceEnabled === true;
}

export function getPreviewFrameTraceStatus(
  traceId: string,
): PreviewFrameTraceStatus | undefined {
  return frameTraceStatuses.get(traceId);
}

export function resetPreviewFrameTraceRecorderForTests(): void {
  frameTraceStatuses.clear();
  latestFrameTraceByInstance.clear();
  dedupedFrameEvents.clear();
  frameTraceEventCount = 0;
}

export function previewDiagnosticNow(): number | null {
  return sink() ? performance.now() : null;
}

export function previewDiagnosticScenePixelRatio(): number {
  const requested = sink()?.scenePixelRatio;
  return requested === 0.5 || requested === 0.25 ? requested : 1;
}

export function shouldForceCompositeCacheRebuild(): boolean {
  return sink()?.forceCompositeCacheRebuild === true;
}

export function recordPreviewDiagnostic(
  event: string,
  detail: Record<string, number | string | boolean | null>,
): void {
  const target = sink();
  if (target) target.record(event, performance.now(), detail);
}

export function recordPreviewFrameTrace(
  event: string,
  context: PreviewFrameTraceContext,
  detail: Record<string, number | string | boolean | null> = {},
): void {
  const target = sink();
  if (!target || target.frameTraceEnabled !== true ||
      frameTraceEventCount >= MAX_FRAME_TRACE_EVENTS) return;

  const atMs = performance.now();
  if (event === 'target-changed') {
    const previous = latestFrameTraceByInstance.get(context.instanceId);
    if (previous?.traceId === context.traceId) return;
    if (previous && previous.traceId !== context.traceId) {
      const previousStatus = frameTraceStatuses.get(previous.traceId) ?? 'PENDING';
      if (
        previousStatus === 'PENDING' &&
        frameTraceEventCount < MAX_FRAME_TRACE_EVENTS - 1
      ) {
        target.record('frame-trace:outcome', atMs, {
          ...frameTraceDetails(previous),
          status: 'SUPERSEDED',
          cause: 'target-changed',
        });
        frameTraceEventCount += 1;
        frameTraceStatuses.set(previous.traceId, 'SUPERSEDED');
      }
    }
    if (latestFrameTraceByInstance.size >= MAX_ACTIVE_FRAME_TRACES &&
        !latestFrameTraceByInstance.has(context.instanceId)) {
      const oldestInstanceId = latestFrameTraceByInstance.keys().next().value;
      if (oldestInstanceId) latestFrameTraceByInstance.delete(oldestInstanceId);
    }
    latestFrameTraceByInstance.set(context.instanceId, context);
    if (!frameTraceStatuses.has(context.traceId)) {
      rememberFrameTrace(context.traceId, 'PENDING');
    }
  }

  const status = detail.status;
  if (
    status === 'COMMITTED' ||
    status === 'SUPERSEDED' ||
    status === 'FAILED' ||
    status === 'CANCELLED'
  ) {
    const previousStatus = frameTraceStatuses.get(context.traceId);
    if (
      previousStatus === undefined ||
      previousStatus === 'PENDING' ||
      previousStatus === status
    ) {
      rememberFrameTrace(context.traceId, status);
    }
  }
  if (
    event === 'stage-paint' ||
    event === 'stage-react-commit' ||
    event === 'exact-ready-commit' ||
    event === 'trace-mismatch'
  ) {
    const dedupeKey = `${event}:${context.traceId}:${String(detail.displayedFrameId ?? '')}`;
    if (dedupedFrameEvents.has(dedupeKey)) return;
    dedupedFrameEvents.add(dedupeKey);
    while (dedupedFrameEvents.size > MAX_DEDUPED_FRAME_EVENTS) {
      const oldestKey = dedupedFrameEvents.values().next().value;
      if (!oldestKey) break;
      dedupedFrameEvents.delete(oldestKey);
    }
  }
  target.record(`frame-trace:${event}`, atMs, {
    ...frameTraceDetails(context),
    ...detail,
  });
  frameTraceEventCount += 1;
}

export function recordPreviewFrameTraceAt(
  event: string,
  context: PreviewFrameTraceContext,
  atMs: number,
  detail: Record<string, number | string | boolean | null> = {},
): void {
  const target = sink();
  if (!target || target.frameTraceEnabled !== true ||
      frameTraceEventCount >= MAX_FRAME_TRACE_EVENTS) return;
  target.record(`frame-trace:${event}`, atMs, {
    ...frameTraceDetails(context),
    ...detail,
  });
  frameTraceEventCount += 1;
}

function frameTraceDetails(
  context: PreviewFrameTraceContext,
): Record<string, number | string | boolean | null> {
  return {
    traceId: context.traceId,
    instanceId: context.instanceId,
    playbackGeneration: context.playbackGeneration,
    seekGeneration: context.seekGeneration,
    targetEpoch: context.targetEpoch,
    shotId: context.shotId,
    shotTimeMs: context.shotTimeMs,
    cycleIndex: context.cycleIndex,
    frameIndex: context.frameIndex,
    targetFrameId: context.targetFrameId,
    targetAssetId: context.targetAssetId,
    requestedAt: context.requestedAt,
  };
}

function rememberFrameTrace(
  traceId: string,
  status: PreviewFrameTraceStatus,
): void {
  frameTraceStatuses.delete(traceId);
  frameTraceStatuses.set(traceId, status);
  while (frameTraceStatuses.size > MAX_TRACKED_FRAME_TRACES) {
    const oldestTraceId = frameTraceStatuses.keys().next().value;
    if (!oldestTraceId) return;
    frameTraceStatuses.delete(oldestTraceId);
  }
}

export function recordPreviewDuration(
  event: string,
  startedAt: number | null,
  detail: Record<string, number | string | boolean | null>,
): void {
  if (startedAt !== null) {
    recordPreviewDiagnostic(event, { ...detail, durationMs: performance.now() - startedAt });
  }
}
