// Test-only IPC diagnostic preload for Issue #199 — FINAL diagnostic round.
//
// This file is NOT a product or preload change. It is added to the session
// preloads ONLY by the verify-issue199 real-Electron gate (one round), so the
// next CI run can name the exact failing renderer -> main IPC channel, the
// safe argument types, and the FIRST app-owned (Panda Stage) caller/callsite
// behind the "An object could not be cloned" crash.
//
// It never alters behavior, project state, the Timeline, seek, or zoom. It
// only wraps ipcRenderer.invoke/send/sendSync/postMessage to log the channel,
// the method, the argument count, and a SAFE type name per argument (never the
// value). On a synchronous clone failure it logs the full stack and the first
// app-owned callsite. A global error / unhandledRejection / window.error
// listener catches the SAME clone error when it is thrown asynchronously
// (e.g. invoke-response deserialization) and records the full stack + first
// app-owned callsite, since those paths bypass the synchronous wrapper catch.
//
// Allowed log fields only: channel / method / arg count / constructor & type /
// first app-owned caller. No payload value is ever printed or stringified.

const { ipcRenderer } = require('electron');

// --- safe, value-free type description -------------------------------------
function safeType(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t !== 'object') return t;
  if (Array.isArray(value)) return 'Array';
  try {
    const name = value.constructor && value.constructor.name;
    return typeof name === 'string' && name.length > 0 ? name : 'Object';
  } catch {
    return 'Object';
  }
}

// --- first app-owned (Panda Stage) callsite extraction ---------------------
// A stack line is "internal" if it belongs to Electron, Node, node_modules, or
// this diagnostic preload itself. Otherwise a line pointing into the app's own
// renderer / preload source is "app-owned".
const INTERNAL_MARKERS = [
  /electron[\\/]js2c/,
  /node:internal/,
  /node:electron/,
  /node_modules/,
  /internal:/,
  /electron\.asar/,
  /verify-issue199-ipc-diag-preload/,
  /^\s*at (async )?(processTicksAndRejections|Promise|Object\.<anonymous>|Module\._compile|Module\.|Module\.load|_dispatch)/,
];
const RENDERER_MARKERS = [
  /\/src\/renderer\//,
  /\/renderer\//,
  /webpack:\/\/\/\.?\/src\/renderer\//,
  /webpack:\/\/\/\.?\/src\//,
];
const PRELOAD_MARKERS = [/\/src\/preload\//, /\/preload\//];
const BROAD_APP_MARKERS = [
  /resources[\\/]app[\\/]/,
  /app\.asar[\\/]/,
];

function isInternal(line) {
  return INTERNAL_MARKERS.some((r) => r.test(line));
}
function isAppOwned(line) {
  if (isInternal(line)) return false;
  return (
    RENDERER_MARKERS.some((r) => r.test(line)) ||
    PRELOAD_MARKERS.some((r) => r.test(line)) ||
    BROAD_APP_MARKERS.some((r) => r.test(line))
  );
}

// Prefer the renderer feature caller; fall back to the preload wrapper; then
// any app-owned frame; else null (all electron/internal/preload-injected).
function findAppOwnedFrame(stack) {
  const lines = String(stack || '').split('\n');
  const renderer = lines.find((l) => RENDERER_MARKERS.some((r) => r.test(l)));
  if (renderer) return { kind: 'renderer', frame: renderer.trim() };
  const preload = lines.find((l) => PRELOAD_MARKERS.some((r) => r.test(l)));
  if (preload) return { kind: 'preload', frame: preload.trim() };
  const any = lines.find((l) => isAppOwned(l));
  if (any) return { kind: 'app', frame: any.trim() };
  return null;
}

// --- method wrapper: log call + capture synchronous clone failure ----------
function wrap(method) {
  const original = ipcRenderer[method];
  if (typeof original !== 'function') return;
  ipcRenderer[method] = function (channel, ...rest) {
    let types = '';
    try {
      types = rest.map(safeType).join(',');
      console.log(
        `[ipc-diag] ${method} ${channel} args=${rest.length} types=${types}`,
      );
    } catch {
      // Logging must never mask or alter the real IPC behavior.
    }
    try {
      return original.apply(ipcRenderer, [channel, ...rest]);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      const stack = error && error.stack ? error.stack : '';
      const appFrame = findAppOwnedFrame(stack);
      console.error(
        `[ipc-diag] FAIL ${method} ${channel} :: ${message}\n` +
          `[ipc-diag]   args=${rest.length} argTypes=${types}\n` +
          `[ipc-diag]   appCaller=${appFrame ? appFrame.frame : '(none in stack — all electron/internal/preload-injected)'}\n` +
          `[ipc-diag]   appCallerKind=${appFrame ? appFrame.kind : 'none'}\n` +
          `[ipc-diag] STACK:\n${stack}`,
      );
      throw error;
    }
  };
}

wrap('invoke');
wrap('send');
wrap('sendSync');
wrap('postMessage');

// --- global capture for ASYNCHRONOUS clone failures ------------------------
// Round 1 wrapped invoke/send/sendSync and emitted no FAIL line, so the clone
// error is thrown outside the synchronous wrapper (invoke-response
// deserialization or an unhandled rejection). Capture it here with the full
// stack + first app-owned callsite. Log-only; never suppresses or alters flow.
const CLONE_HINT = /could not be cloned|DataCloneError|structured clone/i;

function reportGlobalStack(stack, where) {
  try {
    const text = String(stack || '');
    if (!CLONE_HINT.test(text) && !CLONE_HINT.test(where)) return;
    const appFrame = findAppOwnedFrame(text);
    console.error(
      `[ipc-diag][${where}] clone/serialization stack:\n${text}\n` +
        `[ipc-diag][${where}] firstAppOwnedCaller=${appFrame ? appFrame.frame : '(none in stack — all electron/internal/preload-injected)'}\n` +
        `[ipc-diag][${where}] appCallerKind=${appFrame ? appFrame.kind : 'none'}`,
    );
  } catch {
    // Never let diagnostics affect the run.
  }
}

try {
  const proc = require('process');
  proc.on('uncaughtException', (err) =>
    reportGlobalStack(err && err.stack, 'uncaughtException'),
  );
  proc.on('unhandledRejection', (reason) =>
    reportGlobalStack(
      (reason && reason.stack) || String(reason),
      'unhandledRejection',
    ),
  );
} catch {
  // process may be unavailable in some contexts; diagnostics are best-effort.
}

try {
  // globalThis is the renderer global object in a preload; referencing the bare
  // `window` identifier breaks ESLint (no-undef). Using globalThis only keeps
  // the diagnostic lint-clean while still attaching the renderer error listener.
  const g = typeof globalThis !== 'undefined' ? globalThis : undefined;
  if (g && typeof g.addEventListener === 'function') {
    g.addEventListener('error', (e) => {
      const stack =
        e && e.error && e.error.stack
          ? e.error.stack
          : e
            ? `${e.message || ''} @ ${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`
            : String(e);
      reportGlobalStack(stack, 'window.error');
    });
  }
} catch {
  // Listener attachment is best-effort.
}
