export type FlaFrameSequencePreviewPhase =
  | 'loading'
  | 'selecting'
  | 'rendering'
  | 'preview-ready'
  | 'committing'
  | 'committed'
  | 'cancelled'
  | 'error';

export function phaseForFocusedSequencePreview(
  phase: FlaFrameSequencePreviewPhase,
  presentation: 'standard' | 'unified-preview',
  focusedTargetId: string | null,
  operationTargetId: string | null,
): FlaFrameSequencePreviewPhase {
  if (presentation !== 'unified-preview' || !operationTargetId) return phase;
  if (
    phase !== 'rendering' &&
    phase !== 'committing' &&
    phase !== 'committed' &&
    phase !== 'cancelled' &&
    phase !== 'error'
  ) return phase;
  return focusedTargetId === operationTargetId ? phase : 'selecting';
}
