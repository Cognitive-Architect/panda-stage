export type Issue762ProfileValue = string | number | boolean | null;

export interface Issue762ProfileEvent {
  readonly stage: string;
  readonly durationMs: number;
  readonly details?: Readonly<Record<string, Issue762ProfileValue>>;
}

type Issue762ProfileSink = (event: Issue762ProfileEvent) => void;

function getIssue762ProfileSink(): Issue762ProfileSink | undefined {
  return (
    globalThis as typeof globalThis & {
      __pandaStageIssue762ProfileSink?: Issue762ProfileSink;
    }
  ).__pandaStageIssue762ProfileSink;
}

/** Starts an opt-in profiling interval; returns null when profiling is disabled. */
export function startIssue762Profile(): number | null {
  return getIssue762ProfileSink() ? performance.now() : null;
}

/** Emits a bounded timing record without letting diagnostics affect production work. */
export function finishIssue762Profile(
  stage: string,
  startedAt: number | null,
  details?: Readonly<Record<string, Issue762ProfileValue>>,
): void {
  if (startedAt === null) return;
  recordIssue762ProfileDuration(stage, performance.now() - startedAt, details);
}

export function recordIssue762ProfileDuration(
  stage: string,
  durationMs: number,
  details?: Readonly<Record<string, Issue762ProfileValue>>,
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const sink = getIssue762ProfileSink();
  if (!sink) return;
  try {
    sink({
      stage,
      durationMs,
      ...(details ? { details } : {}),
    });
  } catch {
    // Profiling is best-effort and must not change FLA processing behavior.
  }
}
