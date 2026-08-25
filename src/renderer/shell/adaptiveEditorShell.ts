import { useSyncExternalStore } from 'react';

export type EditorShellLayoutMode = 'desktop' | 'landscape' | 'portrait';

export type EditorDeviceMode = 'auto' | 'desktop' | 'cloud-touch';

export const EDITOR_DEVICE_MODE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'cloud-touch', label: 'Cloud Touch' },
] as const satisfies ReadonlyArray<{
  value: EditorDeviceMode;
  label: string;
}>;

export type EditorWorkspace =
  | 'canvas'
  | 'assets'
  | 'properties'
  | 'timeline';

export interface EditorViewportSize {
  width: number;
  height: number;
}

export const EDITOR_WORKSPACES: readonly EditorWorkspace[] = [
  'canvas',
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
 * The Auto mode follows the available content space without persisting a
 * device/orientation preference. Portrait takes precedence over width. The
 * existing 1100px seam remains only an Auto heuristic; it is not consulted
 * for an explicit Cloud Touch selection.
 */
export function getEditorShellLayoutMode(
  viewport: EditorViewportSize,
  deviceMode: EditorDeviceMode = 'auto',
): EditorShellLayoutMode {
  const width = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0;
  const height = Number.isFinite(viewport.height)
    ? Math.max(0, viewport.height)
    : 0;

  if (deviceMode === 'desktop') return 'desktop';
  if (deviceMode === 'cloud-touch') {
    return height > width ? 'portrait' : 'landscape';
  }

  if (height > width) return 'portrait';
  return width <= CLOUD_MOBILE_MAX_WIDTH ? 'landscape' : 'desktop';
}

export function reconcileEditorWorkspace(
  _layoutMode: EditorShellLayoutMode,
  workspace: EditorWorkspace,
): EditorWorkspace {
  // The four canonical portrait workspaces are legal in both compositions.
  // Keeping the selected value across an orientation round-trip preserves
  // session context without creating a second project/session owner. Shot
  // management is a Canvas-context surface, not a fifth workspace.
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

function getLayoutModeSnapshot(
  deviceMode: EditorDeviceMode,
): EditorShellLayoutMode {
  return getEditorShellLayoutMode(getViewportSize(), deviceMode);
}

function getServerLayoutMode(deviceMode: EditorDeviceMode): EditorShellLayoutMode {
  return getEditorShellLayoutMode({ width: 0, height: 0 }, deviceMode);
}

/**
 * Session-only responsive shell mode; the selected device mode and resulting
 * layout are never written to project data.
 */
export function useEditorShellLayoutMode(
  deviceMode: EditorDeviceMode = 'auto',
): EditorShellLayoutMode {
  return useSyncExternalStore(
    subscribeToViewport,
    () => getLayoutModeSnapshot(deviceMode),
    () => getServerLayoutMode(deviceMode),
  );
}
