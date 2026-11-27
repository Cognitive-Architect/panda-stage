// Shared mock model for the three ReShell prototypes. Not the production Panda domain model.
export type Bezier = [number, number, number, number];
export interface Transform { x: number; y: number; scale: number; rotation: number; opacity: number }
export type TransformKey = keyof Transform;
export interface Keyframe { id: string; t: number; v: Transform; easing: Bezier }
export interface Clip { id: string; name: string; start: number; len: number; motion: 'walk' | 'wave' | 'bounce' | 'sway' }
export type LayerKind = 'character' | 'prop' | 'background';
export interface Layer {
  id: string; name: string; kind: LayerKind; assetId: string;
  visible: boolean; locked: boolean; parentId: string | null; depth: number;
  base: Transform; keys: Keyframe[]; clips: Clip[];
}
export interface CamKey { id: string; t: number; zoom: number; x: number; y: number; easing: Bezier }
export interface AudioClip { id: string; assetId: string; name: string; start: number; len: number }
export interface Shot { id: string; name: string; duration: number; layers: Layer[]; camera: CamKey[]; audio: AudioClip[] }
export interface Project { name: string; fps: number; width: number; height: number; shots: Shot[] }

export const FPS = 24;
export const STAGE_W = 1280;
export const STAGE_H = 720;

let n = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${(n++).toString(36)}`;

export const EASE_PRESETS: { id: string; label: string; v: Bezier }[] = [
  { id: 'linear', label: '线性', v: [0, 0, 1, 1] },
  { id: 'ease', label: '平滑', v: [0.25, 0.1, 0.25, 1] },
  { id: 'in', label: '缓入', v: [0.42, 0, 1, 1] },
  { id: 'out', label: '缓出', v: [0, 0, 0.58, 1] },
  { id: 'inout', label: '缓入缓出', v: [0.42, 0, 0.58, 1] },
  { id: 'back', label: '回弹', v: [0.34, 1.56, 0.64, 1] },
];
export const easeLabel = (b: Bezier) => EASE_PRESETS.find((p) => p.v.every((x, i) => Math.abs(x - b[i]) < 1e-3))?.label ?? '自定义';

// cubic-bezier solver (x -> y)
export function bezierAt(b: Bezier, x: number): number {
  const [x1, y1, x2, y2] = b;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const d = (3 * ax * t + 2 * bx) * t + cx;
    const e = sx(t) - x;
    if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break;
    t -= e / d;
  }
  t = Math.min(1, Math.max(0, t));
  return ((ay * t + by) * t + cy) * t;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function sampleTransform(layer: Layer, t: number): Transform {
  const ks = [...layer.keys].sort((a, b) => a.t - b.t);
  let v: Transform;
  if (!ks.length) v = { ...layer.base };
  else if (t <= ks[0].t) v = { ...ks[0].v };
  else if (t >= ks[ks.length - 1].t) v = { ...ks[ks.length - 1].v };
  else {
    const i = ks.findIndex((k) => k.t > t);
    const a = ks[i - 1], b = ks[i];
    const k = bezierAt(a.easing, (t - a.t) / (b.t - a.t));
    v = { x: lerp(a.v.x, b.v.x, k), y: lerp(a.v.y, b.v.y, k), scale: lerp(a.v.scale, b.v.scale, k), rotation: lerp(a.v.rotation, b.v.rotation, k), opacity: lerp(a.v.opacity, b.v.opacity, k) };
  }
  for (const c of layer.clips) {
    if (t < c.start || t >= c.start + c.len) continue;
    const p = (t - c.start) / FPS;
    if (c.motion === 'walk') { v.y += -Math.abs(Math.sin(p * 9)) * 14; v.rotation += Math.sin(p * 9) * 3; }
    if (c.motion === 'wave') v.rotation += Math.sin(p * 12) * 10;
    if (c.motion === 'bounce') { v.y -= Math.abs(Math.sin(p * 6)) * 40; v.scale *= 1 + Math.sin(p * 12) * 0.03; }
    if (c.motion === 'sway') v.rotation += Math.sin(p * 3) * 6;
  }
  return v;
}

export function sampleCamera(shot: Shot, t: number) {
  const ks = [...shot.camera].sort((a, b) => a.t - b.t);
  if (!ks.length) return { zoom: 1, x: 0, y: 0 };
  if (t <= ks[0].t) return ks[0];
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1];
  const i = ks.findIndex((k) => k.t > t);
  const a = ks[i - 1], b = ks[i];
  const k = bezierAt(a.easing, (t - a.t) / (b.t - a.t));
  return { zoom: lerp(a.zoom, b.zoom, k), x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
}

const T = (x: number, y: number, scale = 1, rotation = 0, opacity = 1): Transform => ({ x, y, scale, rotation, opacity });
const E: Bezier = [0.42, 0, 0.58, 1];
const key = (t: number, v: Transform, easing: Bezier = E): Keyframe => ({ id: uid('k'), t, v, easing });
const layer = (p: Partial<Layer> & Pick<Layer, 'name' | 'kind' | 'assetId'>): Layer => ({ id: uid('l'), visible: true, locked: false, parentId: null, depth: 0, base: T(640, 400), keys: [], clips: [], ...p });

export function createSampleProject(): Project {
  const panda = layer({ name: '熊猫阿宝', kind: 'character', assetId: 'panda', depth: 0, keys: [key(0, T(260, 470, 1)), key(48, T(640, 470, 1)), key(96, T(900, 450, 1.1, 0))], clips: [{ id: uid('c'), name: '走路', start: 0, len: 48, motion: 'walk' }, { id: uid('c'), name: '挥手', start: 60, len: 30, motion: 'wave' }] });
  const bird = layer({ name: '小鸟', kind: 'character', assetId: 'bird', depth: -1, keys: [key(0, T(1100, 160, 0.8)), key(72, T(500, 200, 0.8, -8), [0.34, 1.56, 0.64, 1]), key(120, T(200, 120, 0.8))], clips: [{ id: uid('c'), name: '扑翅', start: 0, len: 120, motion: 'bounce' }] });
  const ball = layer({ name: '竹球', kind: 'prop', assetId: 'ball', base: T(820, 560, 0.9), clips: [{ id: uid('c'), name: '弹跳', start: 24, len: 48, motion: 'bounce' }] });
  const bamboo = layer({ name: '竹子', kind: 'prop', assetId: 'bamboo', depth: 2, base: T(1120, 400, 1.2), clips: [{ id: uid('c'), name: '摇摆', start: 0, len: 120, motion: 'sway' }] });
  const bg1 = layer({ name: '竹林背景', kind: 'background', assetId: 'bg_forest', depth: 10, locked: true, base: T(640, 360, 1) });

  const panda2 = layer({ name: '熊猫阿宝', kind: 'character', assetId: 'panda', keys: [key(0, T(640, 520, 1.4)), key(60, T(640, 500, 1.6, 4))], clips: [{ id: uid('c'), name: '挥手', start: 12, len: 48, motion: 'wave' }] });
  const lantern = layer({ name: '灯笼', kind: 'prop', assetId: 'lantern', base: T(300, 200, 1), clips: [{ id: uid('c'), name: '摇摆', start: 0, len: 96, motion: 'sway' }] });
  const bg2 = layer({ name: '夜晚庭院', kind: 'background', assetId: 'bg_night', depth: 10, locked: true, base: T(640, 360, 1) });
  lantern.parentId = null;

  return {
    name: '竹林里的早晨', fps: FPS, width: STAGE_W, height: STAGE_H,
    shots: [
      { id: 'shot1', name: '镜头 1 · 竹林相遇', duration: 120, layers: [panda, bird, ball, bamboo, bg1], camera: [{ id: uid('cam'), t: 0, zoom: 1, x: 0, y: 0, easing: E }, { id: uid('cam'), t: 96, zoom: 1.15, x: 80, y: 20, easing: E }], audio: [{ id: uid('a'), assetId: 'bgm', name: '晨曲.wav', start: 0, len: 120 }, { id: uid('a'), assetId: 'sfx_bird', name: '鸟鸣.wav', start: 30, len: 36 }] },
      { id: 'shot2', name: '镜头 2 · 夜晚特写', duration: 96, layers: [panda2, lantern, bg2], camera: [{ id: uid('cam'), t: 0, zoom: 1.2, x: 0, y: 40, easing: E }, { id: uid('cam'), t: 90, zoom: 1.5, x: 0, y: 80, easing: E }], audio: [{ id: uid('a'), assetId: 'bgm2', name: '夜曲.wav', start: 0, len: 96 }] },
    ],
  };
}

export const fmtTime = (f: number) => {
  const s = Math.floor(f / FPS);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(Math.floor(f % FPS)).padStart(2, '0')}`;
};
