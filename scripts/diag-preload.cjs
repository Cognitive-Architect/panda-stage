// Diagnostic-only Electron preload for Issue #206 Phase A.
//
// Runs via `session.setPreloads([...])` BEFORE the app's own preload, so it can
// instrument the IPC boundary at the source instead of fighting the frozen
// contextBridge proxy from the main world (which is why the earlier locator
// never saw a single CALL).
//
// It does TWO things, neither of which alters payloads or app behavior:
//   1. Wraps `contextBridge.exposeInMainWorld` so every exposed API method is
//      wrapped -> captures the MAIN-WORLD callsite + arg types on each call.
//   2. Wraps `ipcRenderer.invoke` / `ipcRenderer.send` -> captures the channel,
//      arg count, safe arg types, and the exact clone error (if any).
//
// All relayed data is SAFE TYPE INFO ONLY (typeof / constructor name / Array
// length / structure tag / stringified channel). No payload is stringified and
// no DOM / Event / Error / Electron object is ever printed.
//
// This file must never be referenced by product code.
const { contextBridge, ipcRenderer } = require('electron');

function safeType(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  const t = typeof v;
  if (t !== 'object' && t !== 'function') return t;
  try {
    if (v instanceof Error) return 'Error:' + (v.constructor && v.constructor.name);
    if (Array.isArray(v)) return 'Array(' + v.length + ')';
    if (v instanceof Date) return 'Date';
    if (v instanceof RegExp) return 'RegExp';
    if (typeof Node !== 'undefined' && v instanceof Node) {
      return (v.constructor && v.constructor.name) || 'Node';
    }
    const c = v && v.constructor && v.constructor.name;
    return c || t;
  } catch (_e) {
    return t;
  }
}

// Capture the raw send first so relay never recurses through our own wrapper.
let rawSend;
try {
  rawSend = ipcRenderer.send.bind(ipcRenderer);
} catch (_e) {
  rawSend = function () {};
}

function relay(channel, obj) {
  try {
    rawSend(channel, JSON.stringify(obj));
  } catch (_e) {
    /* relay failure must never break the app */
  }
}

// ---- 2. wrap ipcRenderer.invoke / send (isolated-world IPC boundary) ----
function installIpcWrapper(name) {
  let orig;
  try {
    orig = ipcRenderer[name].bind(ipcRenderer);
  } catch (_e) {
    return;
  }
  const wrapper = function (ch, ...args) {
    relay('__diag_ipc', {
      kind: name,
      channel: ch,
      argCount: args.length,
      types: args.map(safeType),
      note: '',
    });
    try {
      return orig(ch, ...args);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      relay('__diag_ipc', {
        kind: name,
        channel: ch,
        argCount: args.length,
        types: args.map(safeType),
        note: 'CLONE: ' + msg,
      });
      throw e;
    }
  };
  try {
    ipcRenderer[name] = wrapper;
  } catch (_e) {
    try {
      Object.defineProperty(ipcRenderer, name, {
        value: wrapper,
        configurable: true,
        writable: true,
        enumerable: true,
      });
    } catch (_e2) {
      /* ipcRenderer frozen: cannot instrument this boundary */
    }
  }
}
installIpcWrapper('invoke');
installIpcWrapper('send');

// ---- 1. wrap contextBridge.exposeInMainWorld (main-world callsites) ----
function wrapApiDeep(api, path) {
  if (!api || typeof api !== 'object') return api;
  const out = {};
  for (const key of Object.keys(api)) {
    const val = api[key];
    if (typeof val === 'function') {
      out[key] = function (...args) {
        let stack = '';
        try {
          stack = new Error().stack || '';
        } catch (_e) {
          /* ignore */
        }
        relay('__diag_api', {
          path: path + '.' + key,
          argCount: args.length,
          types: args.map(safeType),
          stack: stack,
        });
        return val.apply(this, args);
      };
    } else if (val && typeof val === 'object') {
      out[key] = wrapApiDeep(val, path + '.' + key);
    } else {
      out[key] = val;
    }
  }
  return out;
}

let rawExpose;
try {
  rawExpose = contextBridge.exposeInMainWorld.bind(contextBridge);
} catch (_e) {
  rawExpose = contextBridge.exposeInMainWorld;
}
try {
  contextBridge.exposeInMainWorld = function (apiKey, apiObject) {
    relay('__diag_expose', { apiKey: apiKey });
    const wrapped = wrapApiDeep(apiObject, apiKey);
    return rawExpose(apiKey, wrapped);
  };
} catch (_e) {
  try {
    Object.defineProperty(contextBridge, 'exposeInMainWorld', {
      value: function (apiKey, apiObject) {
        relay('__diag_expose', { apiKey: apiKey });
        const wrapped = wrapApiDeep(apiObject, apiKey);
        return rawExpose(apiKey, wrapped);
      },
      configurable: true,
      writable: true,
      enumerable: true,
    });
  } catch (_e2) {
    /* contextBridge frozen: cannot instrument main-world callsites */
  }
}
