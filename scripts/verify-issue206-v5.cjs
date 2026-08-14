// Issue #206 Phase A — v5 DEFINITIVE locator.
//
// Uses a diagnostic preload (scripts/diag-preload.cjs) injected via
// session.setPreloads BEFORE the app preload, so it can capture the real
// failing IPC channel + main-world callsite + safe arg types at the source.
//
// This is a PURE OBSERVATION gate faithful to the Issue #204 A/B sequence:
//   Phase 1 — open + wait only (no Timeline interaction)
//   Phase 2 — seek 10/50/90%, drag, zoom 1->2->4, collapse->expand
// It records (a) whether the clone error appears, (b) which IPC channel first
// failed to clone, (c) the main-world callsite that triggered it, (d) the safe
// arg type info. No product code is touched.
const { app, ipcMain, session } = require('electron');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.join(__dirname, '..');
const acceptanceRoot = 'D:\\PandaStage-Acceptance\\issue-206';
const evidenceRoot = path.join(acceptanceRoot, 'evidence');
const repositoryEvidenceRoot = path.join(repositoryRoot, 'docs/evidence/issue-206');
const projectRoot = path.join(
  acceptanceRoot,
  'projects',
  'issue206.pandastage',
);
const exampleProject = require('../demo-project/project-v1.example.json');
const probePng = readFileSync(
  path.join(repositoryRoot, 'public/probe/panda-character.png'),
).toString('base64');

rmSync(evidenceRoot, { recursive: true, force: true });
mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(repositoryEvidenceRoot, { recursive: true });

process.env.VITE_DEV_SERVER_URL = '';

const CLONE_ERR = 'An object could not be cloned';

// ---- capture relayed diagnostics from the preload ----
const ipcCalls = []; // {kind, channel, argCount, types}
const apiCalls = []; // {path, argCount, types, stack}
const cloneEvents = []; // {kind, channel, argCount, types, note}
ipcMain.on('__diag_ipc', (_e, json) => {
  let d;
  try {
    d = JSON.parse(json);
  } catch {
    return;
  }
  if (d.note && d.note.indexOf('CLONE') !== -1) {
    cloneEvents.push(d);
    console.error(
      `[diag-ipc] >>> CLONE on ${d.kind} channel=${d.channel} args=${d.argCount} types=[${d.types.join(',')}] :: ${d.note}`,
    );
  } else {
    ipcCalls.push(d);
    console.error(
      `[diag-ipc] ${d.kind} ${d.channel} args=${d.argCount} types=[${d.types.join(',')}]`,
    );
  }
});
ipcMain.on('__diag_api', (_e, json) => {
  let d;
  try {
    d = JSON.parse(json);
  } catch {
    return;
  }
  apiCalls.push(d);
  console.error(
    `[diag-api] ${d.path} args=${d.argCount} types=[${d.types.join(',')}]`,
  );
});
ipcMain.on('__diag_expose', (_e, json) => {
  let d;
  try {
    d = JSON.parse(json);
  } catch {
    return;
  }
  console.error(`[diag-expose] apiKey=${d.apiKey}`);
});

let currentPhase = 'launch';
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function browserWait(expression, message, timeout = 20_000) {
  return `(async () => {
    const deadline = Date.now() + ${timeout};
    while (Date.now() < deadline) {
      try { if (${expression}) return true; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}
async function waitForDom(window, expression, message, timeout) {
  await window.webContents.executeJavaScript(
    browserWait(expression, message, timeout),
  );
}
async function click(window, selector) {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    if (element instanceof HTMLButtonElement && element.disabled) throw new Error('Element is disabled: ' + ${JSON.stringify(selector)});
    element.click();
  })()`);
  await delay(180);
}
async function measure(window) {
  return window.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    const tc = q('[data-testid="timeline-timecode"]');
    const track = q('[data-testid="timeline-ruler-track"]');
    const dock = q('[data-testid="timeline-dock"]');
    return {
      page: q('.editor-shell')?.dataset.editorPage ?? null,
      expanded: dock?.dataset.expanded ?? null,
      currentTimeMs: tc ? Number(tc.dataset.currentTime) : null,
      durationMs: tc ? Number(tc.dataset.duration) : null,
      ticksCount: document.querySelectorAll('[data-testid="timeline-tick"]').length,
      trackWidth: track ? Math.round(track.getBoundingClientRect().width) : null,
    };
  })()`);
}
async function seek(window, fraction) {
  const code = `(() => new Promise((resolve) => {
    const patch = () => {
      if (!Element.prototype.__issue206Patch) {
        Element.prototype.setPointerCapture = function () {};
        Element.prototype.releasePointerCapture = function () {};
        Element.prototype.hasPointerCapture = function () { return false; };
        Element.prototype.__issue206Patch = true;
      }
    };
    const diag = () => (window.__diag_clone ? { stack: window.__diag_clone.stack, msg: window.__diag_clone.msg, entry: window.__diag_clone.entry, argTypes: window.__diag_clone.argTypes, hits: window.__diag_clone.hits.slice(0, 4) } : null);
    try {
      patch();
      const track = document.querySelector('[data-testid="timeline-ruler-track"]');
      if (!(track instanceof HTMLElement)) { resolve({ error: 'timeline-ruler-track missing' }); return; }
      const rect = track.getBoundingClientRect();
      const x = rect.left + rect.width * ${fraction};
      const y = rect.top + rect.height / 2;
      const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 });
      const up = new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 });
      track.dispatchEvent(down);
      track.dispatchEvent(up);
    } catch (e) {
      resolve({ dispatchError: (e && e.message) || String(e), errName: (e && e.name) || '', stack: (e && e.stack) || '', diagClone: diag() });
      return;
    }
    const read = () => {
      try {
        const tc = document.querySelector('[data-testid="timeline-timecode"]');
        resolve({ currentTimeMs: tc ? Number(tc.dataset.currentTime) : null, diagClone: diag() });
      } catch (e2) {
        resolve({ readError: (e2 && e2.message) || String(e2), stack: (e2 && e2.stack) || '', diagClone: diag() });
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(read, 60)));
  }))()`;
  return window.webContents.executeJavaScript(code);
}
async function seekDrag(window, fromFraction, toFraction) {
  const code = `(() => new Promise((resolve) => {
    const patch = () => {
      if (!Element.prototype.__issue206Patch) {
        Element.prototype.setPointerCapture = function () {};
        Element.prototype.releasePointerCapture = function () {};
        Element.prototype.hasPointerCapture = function () { return false; };
        Element.prototype.__issue206Patch = true;
      }
    };
    const diag = () => (window.__diag_clone ? { stack: window.__diag_clone.stack, msg: window.__diag_clone.msg, entry: window.__diag_clone.entry, argTypes: window.__diag_clone.argTypes, hits: window.__diag_clone.hits.slice(0, 4) } : null);
    try {
      patch();
      const track = document.querySelector('[data-testid="timeline-ruler-track"]');
      if (!(track instanceof HTMLElement)) { resolve({ error: 'drag missing' }); return; }
      const rect = track.getBoundingClientRect();
      const at = (f) => ({ x: rect.left + rect.width * f, y: rect.top + rect.height / 2 });
      const a = at(${fromFraction}); const b = at(${toFraction});
      const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: a.x, clientY: a.y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 });
      const move = new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: b.x, clientY: b.y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 });
      const up = new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: b.x, clientY: b.y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 });
      track.dispatchEvent(down); track.dispatchEvent(move); track.dispatchEvent(up);
    } catch (e) {
      resolve({ dispatchError: (e && e.message) || String(e), errName: (e && e.name) || '', stack: (e && e.stack) || '', diagClone: diag() });
      return;
    }
    const read = () => {
      try {
        const tc = document.querySelector('[data-testid="timeline-timecode"]');
        resolve({ currentTimeMs: tc ? Number(tc.dataset.currentTime) : null, diagClone: diag() });
      } catch (e2) {
        resolve({ readError: (e2 && e2.message) || String(e2), stack: (e2 && e2.stack) || '', diagClone: diag() });
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(read, 60)));
  }))()`;
  return window.webContents.executeJavaScript(code);
}
async function interactStep(window, label, fn) {
  const step = { label, cloneError: false, error: null, sample: null };
  try {
    const res = await fn();
    step.sample = res ?? null;
    // Print every sample: a seek that silently no-ops would otherwise look
    // identical to a passing seek. currentTimeMs must track the fraction.
    console.error(`[issue206] step ${label} -> ${JSON.stringify(res ?? null)}`);
    // The renderer now catches the clone error itself, so executeJavaScript no
    // longer rejects. Detect it from the returned payload instead, otherwise
    // this step would be silently reported as passing.
    const dispatchErr = res && typeof res.dispatchError === 'string' ? res.dispatchError : '';
    const readErr = res && typeof res.readError === 'string' ? res.readError : '';
    const dc = res && res.diagClone ? res.diagClone : null;
    const dcMsg = dc && typeof dc.msg === 'string' ? dc.msg : '';
    if (dispatchErr.includes(CLONE_ERR) || readErr.includes(CLONE_ERR) || dcMsg.includes(CLONE_ERR)) {
      step.cloneError = true;
      step.clonePhase = currentPhase;
      console.error(`[issue206] CLONE (renderer-caught) at ${label}: ${dispatchErr || readErr || dcMsg}`);
      console.error(`[issue206]   errName=${(res && res.errName) || ''}`);
      console.error(`[issue206]   throwStack=${(res && res.stack) || '(empty)'}`);
      if (dc) {
        console.error(`[issue206]   cloneEntry=${dc.entry ?? 'none'}`);
        console.error(`[issue206]   cloneArgTypes=${JSON.stringify(dc.argTypes ?? null)}`);
        console.error(`[issue206]   cloneCallsite=${dc.stack || '(empty)'}`);
        console.error(`[issue206]   hits=${JSON.stringify(dc.hits ?? [], null, 2)}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    step.error = msg;
    step.stack = err instanceof Error ? err.stack || '' : '';
    if (msg.includes(CLONE_ERR)) {
      step.cloneError = true;
      step.clonePhase = currentPhase;
      console.error(`[issue206] CLONE at ${label}: ${msg}`);
      console.error(`[issue206] STACK: ${step.stack}`);
    }
  }
  return step;
}
function documentFor(root, project) {
  return {
    projectRoot: root,
    projectFilePath: `${root}\\project.json`,
    project,
    migrated: false,
    sourceVersion: 5,
  };
}
function projectFixture() {
  const project = JSON.parse(JSON.stringify(exampleProject));
  project.id = 'c2060000-0000-4000-8000-000000000002';
  project.name = 'Issue 206 v5 Locator Project';
  project.assets = project.assets.map((asset) =>
    asset.kind === 'image' ? { ...asset, sha256: 'a'.repeat(64) } : asset,
  );
  if (project.shots && project.shots[0]) project.shots[0].durationMs = 4321;
  else if (project.project && project.project.shots && project.project.shots[0])
    project.project.shots[0].durationMs = 4321;
  return project;
}
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');

async function waitForMainWindow() {
  await app.whenReady();
  // Inject the diagnostic preload BEFORE the app's BrowserWindow is created,
  // so it runs ahead of the app preload and can wrap the IPC boundary.
  session.defaultSession.setPreloads([
    path.join(__dirname, 'diag-preload.cjs'),
  ]);
  const window = await createMainWindow({ show: false });
  const wc = window.webContents;
  wc.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error(`[issue206] renderer console[${level}]: ${message}`);
  });
  wc.on('render-process-gone', (_event, details) => {
    console.error(
      `[issue206] renderer gone: reason=${details.reason} exitCode=${details.exitCode} phase=${currentPhase}`,
    );
  });
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"]')`,
    'The real Electron Project Center did not render.',
  );
  console.error('[issue206] project center rendered');
  return window;
}

async function run() {
  const project = projectFixture();
  const recentEntries = [
    {
      projectId: project.id,
      projectName: project.name,
      projectRoot,
      lastOpenedAt: '2026-08-14T00:00:00.000Z',
      status: 'available',
    },
  ];
  const channels = [];
  const register = (channel, handler) => {
    ipcMain.handle(channel, handler);
    channels.push(channel);
  };
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({ ok: true, status: 'cancelled' }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_e, request) =>
    request.projectRoot === projectRoot
      ? { ok: true, value: documentFor(projectRoot, project) }
      : { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: 'v5 gate project not found.', projectRoot: request.projectRoot } },
  );
  register(IPC_CHANNELS.PROJECT_SAVE, (_e, request) => ({ ok: true, value: documentFor(request.projectRoot, request.project) }));
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: recentEntries }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_e, request) =>
    request.projectRoot === projectRoot
      ? { ok: true, document: documentFor(projectRoot, project) }
      : { ok: false, error: { code: 'RECENT_PROJECT_RELOCATE_FAILED', message: 'v5 gate recent project not found.', projectRoot: request.projectRoot } },
  );
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_e, request) => ({ ok: true, status: 'ready', assetId: request.assetId, dataUrl: 'data:image/png;base64,' + 'a' }));
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_e, request) => {
    const asset = project.assets.find((c) => c.id === request.assetId);
    if (!asset || asset.kind !== 'image') return { ok: false, error: { code: 'ASSET_NOT_FOUND', message: 'not found', assetId: request.assetId } };
    const bytes = Buffer.from(probePng, 'base64');
    return { ok: true, status: 'ready', assetId: request.assetId, mimeType: 'image/png', width: asset.width, height: asset.height, byteLength: bytes.byteLength, bytes: new Uint8Array(bytes) };
  });

  const window = await waitForMainWindow();
  const report = {
    issue: 206,
    electron: process.versions.electron,
    node: process.versions.node,
    openWaitCloneError: null,
    interactionCloneError: null,
    firstFailingStep: null,
    firstCloneChannel: null,
    firstCloneApiCallsite: null,
    openWait: null,
    interaction: [],
    rendererGone: null,
  };
  try {
    window.setContentSize(1280, 800);
    await waitForDom(window, `document.querySelector('[data-testid="recent-projects-list"]')`, 'recent list missing');
    await click(window, '[data-project-status="available"] [data-task4-core="recent-open"]');
    await waitForDom(window, `document.querySelector('[data-editor-page="editor"]')`, 'editor did not open');
    console.error('[issue206] editor opened');

    // Install a PASSIVE renderer-side error capture. It only records the
    // renderer stack of any uncaught error / unhandledrejection into
    // window.__diag_clone; it must not alter app behavior. The seek code
    // returns this alongside its result so we get the real app-owned callsite
    // for the clone error (executeJavaScript's own rejection stack is empty).
    const probe = await window.webContents.executeJavaScript(`(function(){
      window.__diag_clone = { stack: null, msg: null, entry: null, argTypes: null, hits: [] };

      // Structural type label only: typeof / constructor / key->type map.
      // Never stringifies payload values, never touches DOM/Event internals.
      var safeType = function(v, depth){
        try {
          if (v === undefined) return 'undefined';
          if (v === null) return 'null';
          var ty = typeof v;
          if (ty === 'function') return 'FUNCTION';
          if (ty === 'symbol') return 'SYMBOL';
          if (ty !== 'object') return ty;
          var ctor = 'Object';
          try { ctor = (v.constructor && v.constructor.name) || 'Object'; } catch (_c) {}
          if (Array.isArray(v)) return 'Array(' + v.length + ')<' + (v.length ? safeType(v[0], (depth||0)+1) : '') + '>';
          if (typeof Node !== 'undefined' && v instanceof Node) return 'DOMNode:' + (v.nodeName || '?');
          if (typeof Event !== 'undefined' && v instanceof Event) return 'Event:' + (v.type || '?');
          if (typeof Window !== 'undefined' && v === window) return 'WINDOW';
          if (v instanceof Error) return 'Error:' + ctor;
          if (typeof Map !== 'undefined' && v instanceof Map) return 'Map(' + v.size + ')';
          if (typeof Set !== 'undefined' && v instanceof Set) return 'Set(' + v.size + ')';
          if (typeof Promise !== 'undefined' && v instanceof Promise) return 'PROMISE';
          if ((depth||0) >= 3) return ctor;
          var keys = [];
          try { keys = Object.keys(v).slice(0, 20); } catch (_k) {}
          var parts = keys.map(function(k){
            var t; try { t = safeType(v[k], (depth||0)+1); } catch (_e) { t = 'THROWS'; }
            return k + ':' + t;
          });
          return ctor + '{' + parts.join(',') + '}';
        } catch (_e) { return 'UNKNOWN'; }
      };

      var rec = function(entry, args, err){
        try {
          var types;
          try { types = (args || []).map(function(a){ return safeType(a, 0); }); } catch (_t) { types = ['UNREADABLE']; }
          var hit = {
            entry: entry,
            argTypes: types,
            msg: (err && err.message) || String(err),
            name: (err && err.name) || '',
            errStack: (err && err.stack) || '',
            callsite: (new Error('__diag_callsite').stack) || '',
          };
          window.__diag_clone.hits.push(hit);
          if (!window.__diag_clone.entry) {
            window.__diag_clone.entry = entry;
            window.__diag_clone.argTypes = types;
            window.__diag_clone.msg = hit.msg;
            window.__diag_clone.stack = hit.callsite;
          }
        } catch (_e) {}
      };

      // Passive capture of anything that escapes to the global handlers.
      window.addEventListener('error', function(e){ try { if (!window.__diag_clone.stack) { window.__diag_clone.stack = (e.error && e.error.stack) || e.message; window.__diag_clone.msg = e.message; window.__diag_clone.entry = window.__diag_clone.entry || 'window.onerror'; } } catch(_e){} });
      window.addEventListener('unhandledrejection', function(e){ try { var r = e.reason; if (!window.__diag_clone.stack) { window.__diag_clone.stack = (r && r.stack) || String(r); window.__diag_clone.msg = (r && r.message) || String(r); window.__diag_clone.entry = window.__diag_clone.entry || 'unhandledrejection'; } } catch(_e){} });

      // Wrap every structured-clone entry point reachable from the main world.
      // Each wrapper records then RETHROWS, so app behaviour is unchanged.
      var guard = function(label, host, key){
        try {
          var orig = host[key];
          if (typeof orig !== 'function') return;
          host[key] = function(){
            var args = Array.prototype.slice.call(arguments);
            try { return orig.apply(this, args); }
            catch (err) { rec(label, args, err); throw err; }
          };
        } catch (_e) {}
      };
      if (typeof History !== 'undefined') { guard('history.pushState', History.prototype, 'pushState'); guard('history.replaceState', History.prototype, 'replaceState'); }
      guard('structuredClone', window, 'structuredClone');
      guard('window.postMessage', window, 'postMessage');
      if (typeof MessagePort !== 'undefined') guard('MessagePort.postMessage', MessagePort.prototype, 'postMessage');
      if (typeof BroadcastChannel !== 'undefined') guard('BroadcastChannel.postMessage', BroadcastChannel.prototype, 'postMessage');
      if (typeof Worker !== 'undefined') guard('Worker.postMessage', Worker.prototype, 'postMessage');
      if (typeof IDBObjectStore !== 'undefined') { guard('IDBObjectStore.put', IDBObjectStore.prototype, 'put'); guard('IDBObjectStore.add', IDBObjectStore.prototype, 'add'); }

      // MAIN-WORLD wrap of the contextBridge API. The preload-side wrapper can
      // never see this: contextBridge clones arguments at the main->isolated
      // world boundary, so a bad argument throws BEFORE the preload function
      // body runs. Wrapping here is the only place the callsite is visible.
      var probe = { apiKeys: [], winDesc: null, frozen: null, wrapped: false, wrapError: null, wrappedPaths: 0 };
      try {
        var keys = Object.keys(window).filter(function(k){ return /^panda/i.test(k); });
        probe.apiKeys = keys;
        var apiKey = keys.indexOf('pandaStage') >= 0 ? 'pandaStage' : keys[0];
        if (apiKey) {
          var d = Object.getOwnPropertyDescriptor(window, apiKey);
          if (d) probe.winDesc = { configurable: !!d.configurable, writable: !!d.writable, hasGet: !!d.get, valueType: typeof d.value };
          var api = window[apiKey];
          probe.frozen = !!(api && Object.isFrozen(api));
          var count = 0;
          var wrapDeep = function(obj, path, depth){
            if (depth > 4 || obj === null || typeof obj !== 'object') return obj;
            var out = {};
            Object.keys(obj).forEach(function(k){
              var v; try { v = obj[k]; } catch (_e) { return; }
              var p = path + '.' + k;
              if (typeof v === 'function') {
                count += 1;
                out[k] = function(){
                  var args = Array.prototype.slice.call(arguments);
                  try { return v.apply(obj, args); }
                  catch (err) { rec('bridge:' + p, args, err); throw err; }
                };
              } else if (v && typeof v === 'object') { out[k] = wrapDeep(v, p, depth + 1); }
              else { out[k] = v; }
            });
            return out;
          };
          if (api && typeof api === 'object') {
            var wrapped = wrapDeep(api, apiKey, 0);
            Object.defineProperty(window, apiKey, { value: wrapped, configurable: true, writable: false, enumerable: true });
            probe.wrapped = window[apiKey] !== api;
            probe.wrappedPaths = count;
          }
        }
      } catch (err) { probe.wrapError = (err && err.message) || String(err); }
      return probe;
    })()`);
    console.error(`[issue206] renderer clone-instrumentation installed: ${JSON.stringify(probe)}`);

    // ---- PHASE 1: open + wait only (no Timeline interaction) ----
    currentPhase = 'open-wait';
    console.error('[issue206] PHASE 1 open+wait (3s)');
    await delay(3000);
    report.openWait = await measure(window);
    console.error(`[issue206] PHASE 1 done: ${JSON.stringify(report.openWait)}`);

    // ---- PHASE 2: Timeline interaction (faithful #204 sequence) ----
    currentPhase = 'interaction';
    console.error('[issue206] PHASE 2 interaction starting');
    report.interaction.push(await interactStep(window, 'seek 10%', () => seek(window, 0.1)));
    report.interaction.push(await interactStep(window, 'seek 50%', () => seek(window, 0.5)));
    report.interaction.push(await interactStep(window, 'seek 90%', () => seek(window, 0.9)));
    report.interaction.push(await interactStep(window, 'drag 5%->95%', () => seekDrag(window, 0.05, 0.95)));
    for (let level = 1; level < 4; level *= 2) {
      report.interaction.push(await interactStep(window, `zoom ${level}x->${level * 2}x`, async () => {
        await click(window, '[data-testid="timeline-zoom-in"]');
        await delay(120);
        return seek(window, 0.5);
      }));
    }
    report.interaction.push(await interactStep(window, 'collapse', async () => {
      await click(window, '[data-testid="timeline-collapse"]');
      await delay(200);
      return measure(window);
    }));
    report.interaction.push(await interactStep(window, 'expand', async () => {
      await click(window, '[data-testid="timeline-collapse"]');
      await delay(200);
      return measure(window);
    }));
    currentPhase = 'interaction-wait';
    await delay(1000);
    console.error('[issue206] PHASE 2 done');

    const interactionClone = report.interaction.find((s) => s.cloneError);
    if (interactionClone) {
      report.interactionCloneError = { step: interactionClone.label, phase: interactionClone.clonePhase };
      report.firstFailingStep = interactionClone.label;
    }

    // correlate the first clone IPC event with the most recent main-world API call
    if (cloneEvents.length > 0) {
      const ce = cloneEvents[0];
      report.firstCloneChannel = `${ce.kind}:${ce.channel}`;
      report.firstCloneArgTypes = ce.types;
      // last api call before the clone (by insertion order — good enough signal)
      report.firstCloneApiCallsite = apiCalls.length ? apiCalls[apiCalls.length - 1].path : null;
      report.firstCloneApiArgTypes = apiCalls.length ? apiCalls[apiCalls.length - 1].types : null;
    }
  } catch (fatal) {
    const msg = fatal instanceof Error ? fatal.message : String(fatal);
    const stack = fatal instanceof Error ? fatal.stack || msg : msg;
    if (msg.includes(CLONE_ERR)) {
      console.error(`[issue206] FATAL clone error during phase=${currentPhase}: ${stack}`);
      if (currentPhase === 'open-wait') report.openWaitCloneError = { phase: currentPhase, stack };
      else report.interactionCloneError = { phase: currentPhase, stack };
      if (!report.firstFailingStep) report.firstFailingStep = currentPhase;
    } else {
      console.error(`[issue206] FATAL (non-clone) during phase=${currentPhase}: ${stack}`);
      if (!report.firstFailingStep) report.firstFailingStep = `non-clone:${currentPhase}`;
    }
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    for (const c of channels) ipcMain.removeHandler(c);
  }

  const cloneAtAll = !!report.openWaitCloneError || !!report.interactionCloneError;
  console.error(
    `[issue206-result] cloneError=${cloneAtAll} ` +
      `openWaitClone=${!!report.openWaitCloneError} ` +
      `interactionClone=${!!report.interactionCloneError} ` +
      `firstFailingStep=${report.firstFailingStep ?? 'none'} ` +
      `firstCloneChannel=${report.firstCloneChannel ?? 'none'} ` +
      `firstCloneApiCallsite=${report.firstCloneApiCallsite ?? 'none'} ` +
      `ipcCallCount=${ipcCalls.length} apiCallCount=${apiCalls.length} cloneEventCount=${cloneEvents.length}`,
  );
  writeFileSync(
    path.join(repositoryEvidenceRoot, 'v5-locate.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  setTimeout(() => app.exit(cloneAtAll ? 1 : 0), 1_000);
}

app.on('window-all-closed', () => {});
run().catch((e) => {
  console.error('[issue206] run failed:', e);
  setTimeout(() => app.exit(1), 500);
});
