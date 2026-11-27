// Single in-memory mock store shared by A/B/C. Undo/redo snapshots the mock project only.
import { useSyncExternalStore } from 'react';
import { assetById } from './assets';
import { createSampleProject, sampleTransform, uid, FPS, type Bezier, type Layer, type Project, type Shot, type Transform } from './model';

export type Sel = { kind: 'key'; layerId: string; id: string } | { kind: 'clip'; layerId: string; id: string } | { kind: 'cam'; id: string } | { kind: 'audio'; id: string } | null;
export interface State {
  project: Project; shotId: string; layerId: string | null; sel: Sel;
  time: number; playing: boolean; loop: boolean; pxPerFrame: number; viewZoom: number;
  past: Project[]; future: Project[]; lastKey: string; toast: string;
}
const SS = 'reshell-proto-state';
function initial(): State {
  const project = createSampleProject();
  return { project, shotId: project.shots[0].id, layerId: project.shots[0].layers[0].id, sel: null, time: 0, playing: false, loop: true, pxPerFrame: 6, viewZoom: 1, past: [], future: [], lastKey: '', toast: '' };
}
function load(): State {
  try { const s = sessionStorage.getItem(SS); if (s) return { ...JSON.parse(s), playing: false }; } catch { /* ignore */ }
  return initial();
}
let state: State = load();
const subs = new Set<() => void>();
let saveTimer = 0;
function emit() {
  subs.forEach((f) => f());
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { try { sessionStorage.setItem(SS, JSON.stringify({ ...state, past: state.past.slice(-30), future: [] })); } catch { /* ignore */ } }, 300);
}
export function setState(p: Partial<State>) { state = { ...state, ...p }; emit(); }
export const getState = () => state;
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => sel(state));
}

/** Apply a project edit. Same gestureKey coalesces into one undo entry (pattern from Animora's onChange key). */
function commit(fn: (p: Project) => Project, gestureKey = uid('g')) {
  const next = fn(state.project);
  const coalesce = gestureKey === state.lastKey;
  setState({ project: next, past: coalesce ? state.past : [...state.past.slice(-100), state.project], future: [], lastKey: gestureKey });
}
const mapShot = (p: Project, id: string, f: (s: Shot) => Shot): Project => ({ ...p, shots: p.shots.map((s) => (s.id === id ? f(s) : s)) });
const mapLayer = (p: Project, shotId: string, layerId: string, f: (l: Layer) => Layer) => mapShot(p, shotId, (s) => ({ ...s, layers: s.layers.map((l) => (l.id === layerId ? f(l) : l)) }));

export const currentShot = (s: State = state) => s.project.shots.find((x) => x.id === s.shotId) ?? s.project.shots[0];
export const currentLayer = (s: State = state) => currentShot(s).layers.find((l) => l.id === s.layerId) ?? null;

let raf = 0, lastTs = 0;
function tick(ts: number) {
  if (!state.playing) return;
  const dt = lastTs ? (ts - lastTs) / 1000 : 0; lastTs = ts;
  const dur = currentShot().duration;
  let t = state.time + dt * FPS;
  if (t >= dur) { if (state.loop) t = 0; else { setState({ time: dur, playing: false }); return; } }
  setState({ time: t });
  raf = requestAnimationFrame(tick);
}

export const actions = {
  reset() { cancelAnimationFrame(raf); state = initial(); emit(); },
  undo() { const p = state.past.at(-1); if (!p) return; setState({ project: p, past: state.past.slice(0, -1), future: [state.project, ...state.future], lastKey: '' }); actions.reconcile(); },
  redo() { const f = state.future[0]; if (!f) return; setState({ project: f, future: state.future.slice(1), past: [...state.past, state.project], lastKey: '' }); actions.reconcile(); },
  reconcile() { const s = currentShot(); if (state.layerId && !s.layers.some((l) => l.id === state.layerId)) setState({ layerId: null, sel: null }); },
  play(on = !state.playing) { setState({ playing: on }); if (on) { lastTs = 0; if (state.time >= currentShot().duration - 1) setState({ time: 0 }); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf); },
  seek(t: number) { setState({ time: Math.max(0, Math.min(currentShot().duration, t)) }); },
  step(d: number) { actions.play(false); actions.seek(Math.round(state.time) + d); },
  setShot(id: string) { actions.play(false); const sh = state.project.shots.find((s) => s.id === id)!; setState({ shotId: id, time: 0, layerId: sh.layers[0]?.id ?? null, sel: null }); },
  selectLayer(id: string | null) { setState({ layerId: id, sel: state.sel && 'layerId' in state.sel && state.sel.layerId !== id ? null : state.sel }); },
  select(sel: Sel) { setState({ sel, ...(sel && 'layerId' in sel ? { layerId: sel.layerId } : {}) }); },
  setTimelineZoom(px: number) { setState({ pxPerFrame: Math.max(1.5, Math.min(30, px)) }); },
  setViewZoom(z: number) { setState({ viewZoom: Math.max(0.2, Math.min(4, z)) }); },
  toast(msg: string) { setState({ toast: msg }); setTimeout(() => state.toast === msg && setState({ toast: '' }), 1800); },

  toggleVisible(id: string) { commit((p) => mapLayer(p, state.shotId, id, (l) => ({ ...l, visible: !l.visible }))); },
  toggleLocked(id: string) { commit((p) => mapLayer(p, state.shotId, id, (l) => ({ ...l, locked: !l.locked }))); },
  rename(id: string, name: string) { commit((p) => mapLayer(p, state.shotId, id, (l) => ({ ...l, name }))); },
  /** Move layer in z-order. dir -1 = toward front (top of list). */
  reorder(id: string, dir: number) {
    commit((p) => mapShot(p, state.shotId, (s) => {
      const ls = [...s.layers]; const i = ls.findIndex((l) => l.id === id); const j = i + dir;
      if (i < 0 || j < 0 || j >= ls.length) return s; [ls[i], ls[j]] = [ls[j], ls[i]]; return { ...s, layers: ls };
    }));
  },
  moveLayerTo(id: string, toIndex: number) {
    commit((p) => mapShot(p, state.shotId, (s) => { const ls = s.layers.filter((l) => l.id !== id); ls.splice(toIndex, 0, s.layers.find((l) => l.id === id)!); return { ...s, layers: ls }; }));
  },
  removeLayer(id: string) { commit((p) => mapShot(p, state.shotId, (s) => ({ ...s, layers: s.layers.filter((l) => l.id !== id) }))); setState({ layerId: null, sel: null }); },
  setParent(id: string, parentId: string | null) { commit((p) => mapLayer(p, state.shotId, id, (l) => ({ ...l, parentId }))); },
  setDepth(id: string, depth: number, g?: string) { commit((p) => mapLayer(p, state.shotId, id, (l) => ({ ...l, depth })), g); },

  /** Edit a transform channel; with keyframes it auto-keys at the playhead, otherwise edits the base pose. */
  setProps(id: string, patch: Partial<Transform>, g?: string) {
    const t = Math.round(state.time);
    commit((p) => mapLayer(p, state.shotId, id, (l) => {
      if (!l.keys.length) return { ...l, base: { ...l.base, ...patch } };
      const at = l.keys.find((k) => k.t === t);
      if (at) return { ...l, keys: l.keys.map((k) => (k === at ? { ...k, v: { ...k.v, ...patch } } : k)) };
      const cur = sampleTransform({ ...l, clips: [] }, t);
      return { ...l, keys: [...l.keys, { id: uid('k'), t, v: { ...cur, ...patch }, easing: [0.42, 0, 0.58, 1] }] };
    }), g);
  },
  addKey(id: string) {
    const t = Math.round(state.time);
    const l = currentShot().layers.find((x) => x.id === id); if (!l) return;
    if (l.keys.some((k) => k.t === t)) return actions.toast('该帧已有关键帧');
    const k = { id: uid('k'), t, v: sampleTransform({ ...l, clips: [] }, t), easing: [0.42, 0, 0.58, 1] as Bezier };
    commit((p) => mapLayer(p, state.shotId, id, (x) => ({ ...x, keys: [...x.keys, k] })));
    actions.select({ kind: 'key', layerId: id, id: k.id });
  },
  deleteSelection() {
    const s = state.sel; if (!s) return;
    if (s.kind === 'key') commit((p) => mapLayer(p, state.shotId, s.layerId, (l) => ({ ...l, keys: l.keys.filter((k) => k.id !== s.id) })));
    if (s.kind === 'clip') commit((p) => mapLayer(p, state.shotId, s.layerId, (l) => ({ ...l, clips: l.clips.filter((k) => k.id !== s.id) })));
    if (s.kind === 'cam') commit((p) => mapShot(p, state.shotId, (sh) => ({ ...sh, camera: sh.camera.filter((k) => k.id !== s.id) })));
    if (s.kind === 'audio') commit((p) => mapShot(p, state.shotId, (sh) => ({ ...sh, audio: sh.audio.filter((k) => k.id !== s.id) })));
    setState({ sel: null });
  },
  setEasing(sel: Sel, easing: Bezier, g?: string) {
    if (!sel) return;
    if (sel.kind === 'key') commit((p) => mapLayer(p, state.shotId, sel.layerId, (l) => ({ ...l, keys: l.keys.map((k) => (k.id === sel.id ? { ...k, easing } : k)) })), g);
    if (sel.kind === 'cam') commit((p) => mapShot(p, state.shotId, (sh) => ({ ...sh, camera: sh.camera.map((k) => (k.id === sel.id ? { ...k, easing } : k)) })), g);
  },
  /** Move a timeline item to a new start frame (keys, clips, camera keys, audio clips). */
  moveItem(sel: Sel, start: number, g?: string) {
    if (!sel) return;
    const dur = currentShot().duration; const t = Math.max(0, Math.min(dur, Math.round(start)));
    if (sel.kind === 'key') commit((p) => mapLayer(p, state.shotId, sel.layerId, (l) => (l.keys.some((k) => k.t === t && k.id !== sel.id) ? l : { ...l, keys: l.keys.map((k) => (k.id === sel.id ? { ...k, t } : k)) })), g);
    if (sel.kind === 'clip') commit((p) => mapLayer(p, state.shotId, sel.layerId, (l) => ({ ...l, clips: l.clips.map((c) => (c.id === sel.id ? { ...c, start: Math.min(t, dur - c.len) } : c)) })), g);
    if (sel.kind === 'cam') commit((p) => mapShot(p, state.shotId, (sh) => ({ ...sh, camera: sh.camera.map((k) => (k.id === sel.id ? { ...k, t } : k)) })), g);
    if (sel.kind === 'audio') commit((p) => mapShot(p, state.shotId, (sh) => ({ ...sh, audio: sh.audio.map((c) => (c.id === sel.id ? { ...c, start: Math.min(t, dur - 1) } : c)) })), g);
  },
  resizeClip(sel: Sel, len: number, g?: string) {
    if (!sel || sel.kind !== 'clip') return;
    commit((p) => mapLayer(p, state.shotId, sel.layerId, (l) => ({ ...l, clips: l.clips.map((c) => (c.id === sel.id ? { ...c, len: Math.max(4, Math.round(len)) } : c)) })), g);
  },
  addCameraKey() {
    const sh = currentShot(); const t = Math.round(state.time);
    if (sh.camera.some((k) => k.t === t)) return actions.toast('该帧已有相机关键帧');
    const last = [...sh.camera].sort((a, b) => a.t - b.t).filter((k) => k.t < t).at(-1);
    const k = { id: uid('cam'), t, zoom: last?.zoom ?? 1, x: last?.x ?? 0, y: last?.y ?? 0, easing: [0.42, 0, 0.58, 1] as Bezier };
    commit((p) => mapShot(p, state.shotId, (s) => ({ ...s, camera: [...s.camera, k] })));
    actions.select({ kind: 'cam', id: k.id });
  },
  setCamKey(id: string, patch: { zoom?: number; x?: number; y?: number }, g?: string) {
    commit((p) => mapShot(p, state.shotId, (s) => ({ ...s, camera: s.camera.map((k) => (k.id === id ? { ...k, ...patch } : k)) })), g);
  },
  addAction(layerId: string, motion: Layer['clips'][number]['motion']) {
    const names = { walk: '走路', wave: '挥手', bounce: '弹跳', sway: '摇摆' };
    const c = { id: uid('c'), name: names[motion], start: Math.round(state.time), len: 36, motion };
    commit((p) => mapLayer(p, state.shotId, layerId, (l) => ({ ...l, clips: [...l.clips, c] })));
    actions.select({ kind: 'clip', layerId, id: c.id });
  },
  /** Put a library asset into the current shot. */
  placeAsset(assetId: string, at?: { x: number; y: number }) {
    const a = assetById(assetId);
    if (a.category === '音频') {
      const c = { id: uid('a'), assetId, name: a.name, start: Math.round(state.time), len: Math.min(a.duration ?? 48, currentShot().duration - Math.round(state.time)) };
      commit((p) => mapShot(p, state.shotId, (s) => ({ ...s, audio: [...s.audio, c] })));
      actions.select({ kind: 'audio', id: c.id }); actions.toast(`已添加音频：${a.name}`); return;
    }
    const kind = a.category === '角色' ? 'character' : a.category === '背景' ? 'background' : 'prop';
    const l: Layer = { id: uid('l'), name: a.name, kind, assetId, visible: true, locked: false, parentId: null, depth: kind === 'background' ? 10 : 0, base: { x: at?.x ?? 640, y: at?.y ?? (kind === 'background' ? 360 : 420), scale: 1, rotation: 0, opacity: 1 }, keys: [], clips: [] };
    commit((p) => mapShot(p, state.shotId, (s) => ({ ...s, layers: kind === 'background' ? [...s.layers, l] : [l, ...s.layers] })));
    setState({ layerId: l.id, sel: null }); actions.toast(`已放入：${a.name}`);
  },
};

export function useHotkeys() {
  // registered once per variant root
}
let bound = false;
export function bindHotkeys() {
  if (bound) return; bound = true;
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) actions.redo(); else actions.undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); actions.redo(); }
    else if (e.key === ' ') { e.preventDefault(); actions.play(); }
    else if (e.key === 'ArrowLeft') actions.step(-1);
    else if (e.key === 'ArrowRight') actions.step(1);
    else if (e.key === 'Delete' || e.key === 'Backspace') actions.deleteSelection();
    else if (e.key.toLowerCase() === 'k' && state.layerId) actions.addKey(state.layerId);
  });
}
