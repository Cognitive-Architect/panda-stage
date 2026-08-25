import { useSyncExternalStore } from 'react';

export type EditorShellLayoutMode = 'desktop' | 'landscape' | 'portrait';

export type EditorWorkspace =
  | 'canvas'
  | 'shots'
  | 'assets'
  | 'properties'
  | 'timeline';

export interface EditorViewportSize {
  width: number;
  height: number;
}

export const EDITOR_WORKSPACES: readonly EditorWorkspace[] = [
  'canvas',
  'shots',
  'assets',
  'properties',
  'timeline',
];

/**
 * The existing ResourceActivityDock/RightInspector responsive seam. Viewports
 * above this boundary remain on the established desktop composition; the
 * cloud-mobile landscape shell owns the narrow side-rail composition below it.
 */
export const CLOUD_MOBILE_MAX_WIDTH = 1100;

/**
 * The shell follows the available content space rather than persisting a
 * device/orientation preference. Portrait takes precedence over width. The
 * existing 1100px seam identifies the cloud-mobile landscape path; wider
 * landscape viewports retain the established desktop composition so the M2
 * shell does not change legacy wide-editor behavior.
 */
export function getEditorShellLayoutMode(
  viewport: EditorViewportSize,
): EditorShellLayoutMode {
  const width = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0;
  const height = Number.isFinite(viewport.height)
    ? Math.max(0, viewport.height)
    : 0;
  if (height > width) return 'portrait';
  return width <= CLOUD_MOBILE_MAX_WIDTH ? 'landscape' : 'desktop';
}

export function reconcileEditorWorkspace(
  _layoutMode: EditorShellLayoutMode,
  workspace: EditorWorkspace,
): EditorWorkspace {
  // All five workspaces are legal in both compositions. Keeping the selected
  // value across an orientation round-trip preserves session context without
  // creating a second project/session owner.
  return workspace;
}

function getViewportSize(): EditorViewportSize {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }

  const documentWidth =
    typeof document === 'undefined' ? 0 : document.documentElement.clientWidth;
  const documentHeight =
    typeof document === 'undefined' ? 0 : document.documentElement.clientHeight;
  const width = window.innerWidth || documentWidth;
  const height = window.innerHeight || documentHeight;
  return { width, height };
}

function subscribeToViewport(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  window.addEventListener('resize', onStoreChange);
  window.addEventListener('orientationchange', onStoreChange);
  window.visualViewport?.addEventListener('resize', onStoreChange);

  return () => {
    window.removeEventListener('resize', onStoreChange);
    window.removeEventListener('orientationchange', onStoreChange);
    window.visualViewport?.removeEventListener('resize', onStoreChange);
  };
}

function getLayoutModeSnapshot(): EditorShellLayoutMode {
  return getEditorShellLayoutMode(getViewportSize());
}

const SERVER_LAYOUT_MODE: EditorShellLayoutMode = 'landscape';

/** Session-only responsive shell mode; never written to project data. */
export function useEditorShellLayoutMode(): EditorShellLayoutMode {
  return useSyncExternalStore(
    subscribeToViewport,
    getLayoutModeSnapshot,
    () => SERVER_LAYOUT_MODE,
  );
}
