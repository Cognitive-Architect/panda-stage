import { useSyncExternalStore } from 'react';
import { editorActionPreviewStore } from './editorActionPreviewStore';

/** Subscribe to the transient editor action-preview clock + session. */
export function useEditorActionPreview() {
  return useSyncExternalStore(
    editorActionPreviewStore.subscribe,
    editorActionPreviewStore.getSnapshot,
    editorActionPreviewStore.getSnapshot,
  );
}
