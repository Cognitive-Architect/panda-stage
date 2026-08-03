/**
 * Phase 0A baseline — preload stub (NON-PRODUCTION, screenshot-only).
 *
 * The standalone capture window has no real main process / IPC, so the real
 * `window.pandaStage` (normally exposed by the app's production preload via
 * contextBridge) is undefined. The renderer reads `window.pandaStage.*` during
 * render (e.g. ProjectRecoveryPanel), and without it React throws and the whole
 * App tree fails to mount — yielding a blank screenshot.
 *
 * This stub exposes a harmless `window.pandaStage` whose every method resolves
 * to an empty array (the most permissive shape: iterable, indexable, has
 * `.map`/`.forEach`). It lets the real renderer paint its genuine UI/layout
 * (header, action-shell, editor-shell, recovery panel, export probe) without a
 * main process. It is ONLY used by scripts/capture-baseline-1366x768.cjs.
 */
const { contextBridge } = require('electron');

function makeNode() {
  const node = {};
  // Common IPC method names. Every method is a no-op returning an empty array
  // so callers that `.then(r => r.map(...))` or read `r.length` don't crash.
  const methods = [
    'ping',
    'startProbe',
    'cancel',
    'refreshMetadata',
    'delete',
    'choose',
    'importDropped',
    'open',
    'remove',
    'relocate',
    'track',
    'stop',
    'detect',
    'restore',
    'ignore',
    'onUpdate',
    'onError',
    'list',
  ];
  for (const m of methods) {
    node[m] = () => Promise.resolve([]);
  }
  return node;
}

const pandaStage = {
  app: makeNode(),
  export: makeNode(),
  assets: makeNode(),
  project: makeNode(),
  recentProjects: makeNode(),
  autosave: makeNode(),
  recovery: makeNode(),
};

contextBridge.exposeInMainWorld('pandaStage', pandaStage);
