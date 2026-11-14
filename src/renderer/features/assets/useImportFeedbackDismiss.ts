import { useCallback, useEffect, useRef, type FocusEvent } from 'react';

/** Shared lifetime of the existing floating import feedback. */
export function useImportFeedbackDismiss(
  feedbackId: number | null,
  dismissAfterMs: number | null,
  onDismiss: (feedbackId: number) => void,
) {
  const timer = useRef<number | null>(null);
  const deadline = useRef(0);
  const remainingMs = useRef(0);
  const pointerInside = useRef(false);
  const focusInside = useRef(false);

  const clearTimer = useCallback((): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const pause = (): void => {
    if (timer.current === null) return;
    clearTimer();
    remainingMs.current = Math.max(0, deadline.current - Date.now());
  };

  const resume = useCallback((): void => {
    if (pointerInside.current || focusInside.current || feedbackId === null ||
        dismissAfterMs === null || timer.current !== null) return;
    deadline.current = Date.now() + remainingMs.current;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onDismiss(feedbackId);
    }, remainingMs.current);
  }, [dismissAfterMs, feedbackId, onDismiss]);

  useEffect(() => {
    if (feedbackId === null) {
      pointerInside.current = false;
      focusInside.current = false;
    }
    if (dismissAfterMs === null || feedbackId === null) return undefined;
    remainingMs.current = dismissAfterMs;
    resume();
    return clearTimer;
  }, [clearTimer, dismissAfterMs, feedbackId, resume]);

  return {
    onBlurCapture(event: FocusEvent<HTMLElement>): void {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      focusInside.current = false;
      resume();
    },
    onFocusCapture(): void {
      focusInside.current = true;
      pause();
    },
    onPointerEnter(): void {
      pointerInside.current = true;
      pause();
    },
    onPointerLeave(): void {
      pointerInside.current = false;
      resume();
    },
  };
}
