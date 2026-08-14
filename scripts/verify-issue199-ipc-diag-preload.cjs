// Test-only IPC diagnostic preload for Issue #199.
//
// This file is NOT a product or preload change. It is added to the session
// preloads ONLY by the verify-issue199 real-Electron gate (one round), so the
// next CI run can name the exact failing renderer -> main IPC channel and the
// safe argument types behind the "An object could not be cloned" crash.
//
// It never alters behavior, project state, the Timeline, seek, or zoom. It
// only wraps ipcRenderer.invoke/send/sendSync to log the channel, the argument
// count, and a SAFE type name per argument (never the value). The failing call
// is the last log emitted before the clone error.

const { ipcRenderer } = require('electron');

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

function wrap(method) {
  const original = ipcRenderer[method];
  if (typeof original !== 'function') return;
  ipcRenderer[method] = function (channel, ...rest) {
    try {
      const types = rest.map(safeType).join(',');
      console.log(
        `[ipc-diag] ${method} ${channel} args=${rest.length} types=${types}`,
      );
    } catch {
      // Logging must never mask or alter the real IPC behavior.
    }
    try {
      return original.apply(ipcRenderer, [channel, ...rest]);
    } catch (error) {
      console.error(
        `[ipc-diag] FAIL ${method} ${channel} :: ${
          error && error.message ? error.message : String(error)
        }`,
      );
      throw error;
    }
  };
}

wrap('invoke');
wrap('send');
wrap('sendSync');
