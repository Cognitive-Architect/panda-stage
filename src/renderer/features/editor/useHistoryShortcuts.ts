import { useEffect } from 'react';
import { isEditableKeyboardTarget } from '../properties/LayerOrderControls';

export type HistoryShortcut = 'undo' | 'redo' | null;

export function resolveHistoryShortcut(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'ctrlKey'
    | 'metaKey'
    | 'shiftKey'
    | 'altKey'
    | 'defaultPrevented'
    | 'target'
  >,
): HistoryShortcut {
  if (
    event.defaultPrevented ||
    event.altKey ||
    (!event.ctrlKey && !event.metaKey) ||
    isEditableKeyboardTarget(event.target)
  ) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}

export function useHistoryShortcuts(
  onUndo: () => void,
  onRedo: () => void,
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const shortcut = resolveHistoryShortcut(event);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === 'undo') onUndo();
      else onRedo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onRedo, onUndo]);
}
