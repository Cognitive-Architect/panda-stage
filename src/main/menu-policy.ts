export interface ApplicationMenuMode {
  isPackaged: boolean;
  gateA: boolean;
}

/**
 * The Panda Stage product surface no longer exposes Electron's native
 * File/Edit/View/Window menu row. Keep this policy seam so Main Process tests
 * and any future explicit debug-menu decision still have one owner.
 */
export function shouldExposeDevelopmentMenu(
  mode: ApplicationMenuMode,
): boolean {
  void mode;
  return false;
}
