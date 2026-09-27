/** Optional, bounded external probe used only by the Issue #629 diagnostic runner. */
export interface PreviewDiagnosticSink {
  record(event: string, atMs: number, detail: Record<string, number | string | boolean | null>): void;
  /** Diagnostic-only backing resolution; absent in normal product use. */
  scenePixelRatio?: number;
}

function sink(): PreviewDiagnosticSink | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { __pandaPreviewDiagnostics?: PreviewDiagnosticSink })
    .__pandaPreviewDiagnostics;
}

export function previewDiagnosticNow(): number | null {
  return sink() ? performance.now() : null;
}

export function previewDiagnosticScenePixelRatio(): number {
  const requested = sink()?.scenePixelRatio;
  return requested === 0.5 || requested === 0.25 ? requested : 1;
}

export function recordPreviewDiagnostic(
  event: string,
  detail: Record<string, number | string | boolean | null>,
): void {
  const target = sink();
  if (target) target.record(event, performance.now(), detail);
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
