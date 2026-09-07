export interface AudioTrimGestureIdentity {
  projectRoot: string;
  shotId: string;
  dialogueId: string;
  clipId: string;
}

export interface AudioTrimGestureContext {
  projectRoot: string | null;
  shotId: string | null;
  selectedDialogueId: string | null;
  dialogueAudioClipId: string | null;
}

export function getAudioTrimPreviewEnd(
  originEndMs: number,
  deltaPx: number,
  pixelsPerMs: number,
  minimumEndMs: number,
  maximumEndMs: number,
): number {
  const deltaMs = Math.round(deltaPx / Math.max(pixelsPerMs, 0.0001));
  return Math.min(
    maximumEndMs,
    Math.max(minimumEndMs, originEndMs + deltaMs),
  );
}

export function canCommitAudioTrimGesture(
  identity: AudioTrimGestureIdentity,
  context: AudioTrimGestureContext,
): boolean {
  return (
    context.projectRoot === identity.projectRoot &&
    context.shotId === identity.shotId &&
    context.selectedDialogueId === identity.dialogueId &&
    context.dialogueAudioClipId === identity.clipId
  );
}

export function commitAudioTrimGesture(
  identity: AudioTrimGestureIdentity,
  context: AudioTrimGestureContext,
  completion: 'pointerup' | 'pointercancel' | 'escape' | 'unmount',
  commit: () => void,
): boolean {
  if (
    completion !== 'pointerup' ||
    !canCommitAudioTrimGesture(identity, context)
  ) {
    return false;
  }
  commit();
  return true;
}
