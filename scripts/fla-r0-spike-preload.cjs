/*
 * FLA V2-R0 spike (corrective) — sandbox-compatible preload.
 *
 * The R0 renderer is intentionally tiny: a single inline script in
 * scripts/fla-r0-spike-renderer.html installs `window.r0RenderImpl`
 * in the page main world, and the main process invokes it through
 * webContents.executeJavaScript(...). The preload therefore does not
 * need to expose any API.
 *
 * This preload exists to satisfy the Electron isolation pattern
 * (`sandbox:true, contextIsolation:true, nodeIntegration:false` all
 * require a preload context even if it is mostly empty) and to
 * provide a single defence-in-depth hook: a frozen
 * `contextBridge.exposeInMainWorld('r0Boundaries', { ... })` object
 * the renderer's main world can read to prove what is and is not
 * allowed under this build. No IPC channels are exposed here; the
 * main process drives everything via executeJavaScript.
 */

'use strict';

const { contextBridge } = require('electron');

const FROZEN = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  // The main process explicitly blocks will-navigate, will-redirect,
  // window-open, and any subresource that is not a data: URL.
  // See scripts/fla-r0-spike-rasterize.cjs for the actual guards.
  blockedNavigations: true,
  blockedNewWindows: true,
  blockedRemoteResources: true,
  cspInjected: true,
  rendererCanWriteToDisk: false,
  rendererCanExecuteChildProcess: false,
  rendererCanRequireNode: false,
});

contextBridge.exposeInMainWorld('r0Boundaries', FROZEN);
