import type { EditorTemporalVisual } from './temporalVisualContinuity';

/**
 * Runtime-only visual modes owned by the editor Canvas. Base and non-zero
 * temporal inspection may retain a previous complete visual, but never from
 * the other mode.
 */
export type EditorTemporalContinuityMode = 'base' | 'temporal';

type EditorTemporalContinuityBucket = ReadonlyMap<
  string,
  EditorTemporalVisual
>;

export interface EditorTemporalContinuityState {
  /** Project identity + open-instance identity + Shot identity. */
  readonly contextKey: string | null;
  /** Exactly two bounded mode buckets for the active context. */
  readonly buckets: Readonly<{
    base: EditorTemporalContinuityBucket;
    temporal: EditorTemporalContinuityBucket;
  }>;
}

const EMPTY_VISUALS: EditorTemporalContinuityBucket = new Map();

export function editorTemporalContinuityMode(
  currentTimeMs: number,
): EditorTemporalContinuityMode {
  return currentTimeMs === 0 ? 'base' : 'temporal';
}

export function createEditorTemporalContinuityState(
  contextKey: string | null = null,
): EditorTemporalContinuityState {
  return {
    contextKey,
    buckets: {
      base: EMPTY_VISUALS,
      temporal: EMPTY_VISUALS,
    },
  };
}

/**
 * Read only the bucket matching the current Project/instance/Shot and visual
 * mode. A context mismatch deliberately cannot borrow either old bucket.
 */
export function readEditorTemporalContinuityBucket(
  state: EditorTemporalContinuityState,
  contextKey: string | null,
  mode: EditorTemporalContinuityMode,
): EditorTemporalContinuityBucket {
  if (state.contextKey !== contextKey) return EMPTY_VISUALS;
  return state.buckets[mode];
}

/**
 * Commit the model's complete visual snapshot into its matching mode bucket.
 * A context change starts a fresh two-bucket envelope, so stale contexts
 * cannot accumulate in memory or remain addressable after reopen/switch.
 */
export function commitEditorTemporalContinuityBucket(
  state: EditorTemporalContinuityState,
  contextKey: string | null,
  mode: EditorTemporalContinuityMode,
  visuals: ReadonlyMap<string, EditorTemporalVisual>,
): EditorTemporalContinuityState {
  if (state.contextKey !== contextKey) {
    return {
      contextKey,
      buckets: {
        base: mode === 'base' ? visuals : EMPTY_VISUALS,
        temporal: mode === 'temporal' ? visuals : EMPTY_VISUALS,
      },
    };
  }

  return {
    contextKey,
    buckets: {
      ...state.buckets,
      [mode]: visuals,
    },
  };
}
