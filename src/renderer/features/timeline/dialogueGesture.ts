export type DialogueGestureKind = 'move' | 'start' | 'end';

export interface DialogueGestureIdentity {
  projectRoot: string;
  shotId: string;
  dialogueId: string;
}

export interface DialogueGestureContext {
  projectRoot: string | null;
  shotId: string | null;
  selectedDialogueId: string | null;
  dialogueIds: readonly string[];
}

export type DialogueGestureCompletion =
  | 'pointerup'
  | 'pointercancel'
  | 'escape'
  | 'unmount';

export const DIALOGUE_DRAG_THRESHOLD_PX = 4;

/** Ignore small pointer jitter so a tap is not mistaken for a drag. */
export function hasDialogueGestureMoved(
  originClientX: number,
  clientX: number,
): boolean {
  return Math.abs(clientX - originClientX) >= DIALOGUE_DRAG_THRESHOLD_PX;
}

/** A selected clip may clear only when the pointer interaction stayed a click. */
export function shouldClearDialogueSelectionOnClick(
  wasSelected: boolean,
  moved: boolean,
): boolean {
  return wasSelected && !moved;
}

/** Full stale-target guard required before a pointer gesture may commit. */
export function canCommitDialogueGesture(
  identity: DialogueGestureIdentity,
  context: DialogueGestureContext,
): boolean {
  return (
    context.projectRoot === identity.projectRoot &&
    context.shotId === identity.shotId &&
    context.selectedDialogueId === identity.dialogueId &&
    context.dialogueIds.includes(identity.dialogueId)
  );
}

export function shouldCommitDialogueGesture(
  identity: DialogueGestureIdentity,
  context: DialogueGestureContext,
  completion: DialogueGestureCompletion,
): boolean {
  return (
    completion === 'pointerup' &&
    canCommitDialogueGesture(identity, context)
  );
}

export function commitDialogueGesture(
  identity: DialogueGestureIdentity,
  context: DialogueGestureContext,
  completion: DialogueGestureCompletion,
  commit: () => void,
): boolean {
  if (!shouldCommitDialogueGesture(identity, context, completion)) {
    return false;
  }
  commit();
  return true;
}

/** Shared pointer isolation boundary between clips/handles and ruler seeking. */
export function isolateDialoguePointerEvent(event: {
  preventDefault(): void;
  stopPropagation(): void;
}): void {
  event.preventDefault();
  event.stopPropagation();
}
