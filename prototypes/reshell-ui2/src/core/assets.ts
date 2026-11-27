// Original sample artwork created for this prototype (no third-party assets).
export type AssetCategory = '角色' | '道具' | '背景' | '音频';
export interface Asset { id: string; name: string; category: AssetCategory; tags: string[]; svg?: string; w: number; h: number; duration?: number }

const panda = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 260"><ellipse cx="100" cy="190" rx="62" ry="62" fill="#f4f4f4"/><ellipse cx="100" cy="200" rx="34" ry="38" fill="#fff"/><ellipse cx="52" cy="232" rx="22" ry="18" fill="#222"/><ellipse cx="148" cy="232" rx="22" ry="18" fill="#222"/><ellipse cx="44" cy="170" rx="16" ry="30" fill="#222" transform="rotate(20 44 170)"/><ellipse cx="156" cy="170" rx="16" ry="30" fill="#222" transform="rotate(-20 156 170)"/><circle cx="100" cy="82" r="62" fill="#fafafa"/><circle cx="52" cy="32" r="20" fill="#222"/><circle cx="148" cy="32" r="20" fill="#222"/><ellipse cx="76" cy="80" rx="17" ry="22" fill="#222" transform="rotate(-25 76 80)"/><ellipse cx="124" cy="80" rx="17" ry="22" fill="#222" transform="rotate(25 124 80)"/><circle cx="79" cy="80" r="6" fill="#fff"/><circle cx="121" cy="80" r="6" fill="#fff"/><ellipse cx="100" cy="106" rx="10" ry="7" fill="#222"/><path d="M90 118 Q100 126 110 118" stroke="#222" stroke-width="3" fill="none"/><circle cx="62" cy="108" r="8" fill="#ff9fb0" opacity=".6"/><circle cx="138" cy="108" r="8" fill="#ff9fb0" opacity=".6"/></svg>`;
const bird = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90"><ellipse cx="60" cy="50" rx="34" ry="26" fill="#ffb347"/><path d="M40 44 Q20 10 64 34 Z" fill="#ff8c1a"/><circle cx="82" cy="40" r="16" fill="#ffb347"/><circle cx="87" cy="37" r="4" fill="#222"/><path d="M97 42 L114 46 L97 50 Z" fill="#e85d04"/><path d="M28 54 L6 46 L12 60 Z" fill="#ff8c1a"/></svg>`;
const ball = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="#d9b26f"/><path d="M8 50 Q50 20 92 50 M8 50 Q50 80 92 50 M50 6 Q22 50 50 94 M50 6 Q78 50 50 94" stroke="#8a6a32" stroke-width="4" fill="none"/></svg>`;
const bamboo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 420"><rect x="48" y="0" width="24" height="420" rx="8" fill="#5c9e4a"/><g fill="#3f7a31"><rect x="44" y="90" width="32" height="8" rx="4"/><rect x="44" y="200" width="32" height="8" rx="4"/><rect x="44" y="310" width="32" height="8" rx="4"/></g><path d="M72 94 Q110 70 118 40 Q96 80 72 94Z M48 204 Q10 180 2 150 Q24 190 48 204Z" fill="#7cc35f"/></svg>`;
const lantern = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 180"><line x1="60" y1="0" x2="60" y2="30" stroke="#caa04a" stroke-width="4"/><rect x="40" y="26" width="40" height="12" rx="3" fill="#caa04a"/><ellipse cx="60" cy="90" rx="52" ry="56" fill="#e63946"/><path d="M60 34 Q20 90 60 146 M60 34 Q100 90 60 146" stroke="#b52a35" stroke-width="3" fill="none"/><rect x="40" y="142" width="40" height="12" rx="3" fill="#caa04a"/><path d="M52 154 L50 178 M60 154 L60 180 M68 154 L70 178" stroke="#f4d35e" stroke-width="3"/></svg>`;
const forest = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3c9"/><stop offset="1" stop-color="#eaf6d9"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="1040" cy="140" r="70" fill="#fff6c9"/><g fill="#9fcf8f" opacity=".7"><rect x="80" y="0" width="30" height="720"/><rect x="220" y="0" width="22" height="720"/><rect x="980" y="0" width="26" height="720"/><rect x="1180" y="0" width="34" height="720"/></g><path d="M0 560 Q320 500 640 560 T1280 540 V720 H0Z" fill="#8cc06c"/><path d="M0 620 Q400 590 800 630 T1280 610 V720 H0Z" fill="#6aa451"/></svg>`;
const night = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a4a"/><stop offset="1" stop-color="#3a3360"/></linearGradient></defs><rect width="1280" height="720" fill="url(#n)"/><circle cx="1000" cy="130" r="56" fill="#fdf3c4"/><g fill="#fff" opacity=".8"><circle cx="200" cy="90" r="2"/><circle cx="420" cy="160" r="2"/><circle cx="620" cy="70" r="2"/><circle cx="820" cy="200" r="2"/><circle cx="1180" cy="260" r="2"/></g><rect x="0" y="560" width="1280" height="160" fill="#2a2342"/><path d="M80 560 L80 380 L360 300 L640 380 L640 560Z" fill="#433a66"/><rect x="0" y="540" width="1280" height="20" fill="#564b80"/></svg>`;
const flower = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140"><path d="M50 60 V140" stroke="#4f8a3a" stroke-width="6"/><g fill="#ff8fab"><circle cx="50" cy="28" r="18"/><circle cx="28" cy="46" r="18"/><circle cx="72" cy="46" r="18"/><circle cx="36" cy="70" r="18"/><circle cx="64" cy="70" r="18"/></g><circle cx="50" cy="52" r="14" fill="#ffd166"/></svg>`;

export const ASSETS: Asset[] = [
  { id: 'panda', name: '熊猫阿宝', category: '角色', tags: ['主角'], svg: panda, w: 200, h: 260 },
  { id: 'bird', name: '小鸟', category: '角色', tags: ['配角'], svg: bird, w: 120, h: 90 },
  { id: 'ball', name: '竹球', category: '道具', tags: ['运动'], svg: ball, w: 100, h: 100 },
  { id: 'bamboo', name: '竹子', category: '道具', tags: ['植物'], svg: bamboo, w: 120, h: 420 },
  { id: 'lantern', name: '灯笼', category: '道具', tags: ['节日'], svg: lantern, w: 120, h: 180 },
  { id: 'flower', name: '小花', category: '道具', tags: ['植物'], svg: flower, w: 100, h: 140 },
  { id: 'bg_forest', name: '竹林背景', category: '背景', tags: ['白天'], svg: forest, w: 1280, h: 720 },
  { id: 'bg_night', name: '夜晚庭院', category: '背景', tags: ['夜晚'], svg: night, w: 1280, h: 720 },
  { id: 'bgm', name: '晨曲.wav', category: '音频', tags: ['配乐'], w: 0, h: 0, duration: 120 },
  { id: 'bgm2', name: '夜曲.wav', category: '音频', tags: ['配乐'], w: 0, h: 0, duration: 96 },
  { id: 'sfx_bird', name: '鸟鸣.wav', category: '音频', tags: ['音效'], w: 0, h: 0, duration: 36 },
  { id: 'sfx_pop', name: '弹出.wav', category: '音频', tags: ['音效'], w: 0, h: 0, duration: 12 },
];
export const CATEGORIES: AssetCategory[] = ['角色', '道具', '背景', '音频'];
export const assetById = (id: string) => ASSETS.find((a) => a.id === id)!;
export const assetUrl = (a: Asset) => (a.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(a.svg)}` : '');

const imgCache = new Map<string, HTMLImageElement>();
export function assetImage(id: string): HTMLImageElement {
  let img = imgCache.get(id);
  if (!img) { img = new Image(); img.src = assetUrl(assetById(id)); imgCache.set(id, img); }
  return img;
}

/** Deterministic pseudo waveform for mock audio. */
export function waveform(seed: string, count: number): number[] {
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) { h = (h * 1103515245 + 12345) | 0; out.push(0.25 + 0.75 * Math.abs(Math.sin(i * 0.35 + (h & 255) / 40)) * ((h >>> 8) % 100) / 100); }
  return out;
}
