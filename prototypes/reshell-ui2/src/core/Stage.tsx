// Shared Konva stage (same rendering stack as production Panda). Variants wrap it with their own chrome.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Group, Image as KImage, Layer as KLayer, Rect, Stage as KStage, Text } from 'react-konva';
import type Konva from 'konva';
import { assetById, assetImage } from './assets';
import { sampleCamera, sampleTransform, STAGE_H, STAGE_W, uid, type Layer } from './model';
import { actions, currentShot, useStore } from './store';

export interface StageTheme { backdrop: string; frameStroke: string; accent: string; safe?: boolean }
export interface OverlayRect { x: number; y: number; w: number; h: number }

export function Stage({ theme, onOverlay, dropAssets = true }: { theme: StageTheme; onOverlay?: (r: OverlayRect | null) => void; dropAssets?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 450 });
  const [, force] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const shot = useStore(currentShot);
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const layerId = useStore((s) => s.layerId);
  const viewZoom = useStore((s) => s.viewZoom);
  const gesture = useRef('');

  useLayoutEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const imgs = new Set(shot.layers.map((l) => assetImage(l.assetId)));
    imgs.forEach((img) => { if (!img.complete) img.addEventListener('load', () => force((n) => n + 1), { once: true }); });
  }, [shot]);

  const fit = Math.min((size.w - 48) / STAGE_W, (size.h - 48) / STAGE_H) * viewZoom;
  const ox = (size.w - STAGE_W * fit) / 2 + pan.x;
  const oy = (size.h - STAGE_H * fit) / 2 + pan.y;
  const cam = sampleCamera(shot, time);

  const ordered = [...shot.layers].reverse();
  const byId = new Map(shot.layers.map((l) => [l.id, l]));
  const world = (l: Layer) => {
    const v = sampleTransform(l, time);
    const p = l.parentId ? byId.get(l.parentId) : undefined;
    if (p) {
      const pv = sampleTransform(p, time);
      const p0 = p.keys.length ? [...p.keys].sort((a, b) => a.t - b.t)[0].v : p.base;
      v.x += pv.x - p0.x;
      v.y += pv.y - p0.y;
    }
    const par = 1 / (1 + Math.max(0, l.depth) * 0.08);
    v.x -= cam.x * par;
    v.y -= cam.y * par;
    return v;
  };

  // Compute exact selection box analytically so it never lags behind Konva's commit phase or triggers render loops.
  const selLayer = layerId ? byId.get(layerId) : undefined;
  let selBox: { cx: number; cy: number; w: number; h: number; rotation: number; aabb: OverlayRect } | null = null;
  if (selLayer && selLayer.visible) {
    const a = assetById(selLayer.assetId);
    const v = world(selLayer);
    const sx = STAGE_W / 2 + (v.x - STAGE_W / 2) * cam.zoom;
    const sy = STAGE_H / 2 + (v.y - STAGE_H / 2) * cam.zoom;
    const cx = ox + sx * fit;
    const cy = oy + sy * fit;
    const w = a.w * v.scale * cam.zoom * fit;
    const h = a.h * v.scale * cam.zoom * fit;
    const rad = (v.rotation * Math.PI) / 180;
    const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
    selBox = {
      cx, cy, w, h, rotation: v.rotation,
      aabb: { x: Math.round(cx - bw / 2), y: Math.round(cy - bh / 2), w: Math.round(bw), h: Math.round(bh) },
    };
  }

  const onOverlayRef = useRef(onOverlay);
  onOverlayRef.current = onOverlay;
  const ax = playing || !selBox ? null : selBox.aabb.x;
  const ay = playing || !selBox ? null : selBox.aabb.y;
  const aw = playing || !selBox ? null : selBox.aabb.w;
  const ah = playing || !selBox ? null : selBox.aabb.h;
  useEffect(() => {
    if (!onOverlayRef.current) return;
    if (ax === null || ay === null || aw === null || ah === null) onOverlayRef.current(null);
    else onOverlayRef.current({ x: ax, y: ay, w: aw, h: ah });
  }, [ax, ay, aw, ah]);

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    actions.setViewZoom(viewZoom * (e.evt.deltaY < 0 ? 1.1 : 1 / 1.1));
  };
  const startPan = (e: React.PointerEvent) => {
    if (e.button !== 1 && !(e.button === 0 && e.altKey)) return;
    e.preventDefault();
    const x0 = e.clientX - pan.x, y0 = e.clientY - pan.y;
    const move = (m: PointerEvent) => setPan({ x: m.clientX - x0, y: m.clientY - y0 });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={host}
      className="stage-host"
      style={{ background: theme.backdrop }}
      onPointerDown={startPan}
      onDoubleClick={(e) => { if (e.target === host.current) { setPan({ x: 0, y: 0 }); actions.setViewZoom(1); } }}
      onDragOver={(e) => dropAssets && e.dataTransfer.types.includes('text/asset') && e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('text/asset'); if (!id) return;
        const r = host.current!.getBoundingClientRect();
        actions.placeAsset(id, { x: Math.round((e.clientX - r.left - ox) / fit), y: Math.round((e.clientY - r.top - oy) / fit) });
      }}
    >
      <KStage width={size.w} height={size.h} onWheel={onWheel} onMouseDown={(e) => { if (e.target === e.target.getStage()) actions.selectLayer(null); }}>
        <KLayer>
          <Group x={ox} y={oy} scaleX={fit} scaleY={fit}>
            <Rect width={STAGE_W} height={STAGE_H} fill="#000" shadowColor="#000" shadowBlur={30} shadowOpacity={0.5} onMouseDown={() => actions.selectLayer(null)} />
            <Group clipX={0} clipY={0} clipWidth={STAGE_W} clipHeight={STAGE_H}>
              <Group x={STAGE_W / 2} y={STAGE_H / 2} scaleX={cam.zoom} scaleY={cam.zoom} offsetX={STAGE_W / 2} offsetY={STAGE_H / 2}>
                {ordered.map((l) => {
                  if (!l.visible) return null;
                  const a = assetById(l.assetId); const v = world(l);
                  return (
                    <KImage
                      key={l.id}
                      image={assetImage(l.assetId)}
                      width={a.w} height={a.h} offsetX={a.w / 2} offsetY={a.h / 2}
                      x={v.x} y={v.y} scaleX={v.scale} scaleY={v.scale} rotation={v.rotation} opacity={v.opacity}
                      draggable={!l.locked}
                      onMouseDown={(e) => { e.cancelBubble = true; actions.selectLayer(l.id); }}
                      onDragStart={() => { gesture.current = uid('drag'); actions.play(false); actions.selectLayer(l.id); }}
                      onDragMove={(e) => {
                        const b = world(l); const base = sampleTransform({ ...l, clips: [] }, time);
                        actions.setProps(l.id, { x: Math.round(base.x + e.target.x() - b.x), y: Math.round(base.y + e.target.y() - b.y) }, gesture.current);
                      }}
                    />
                  );
                })}
              </Group>
            </Group>
            {theme.safe && <Rect x={STAGE_W * 0.05} y={STAGE_H * 0.05} width={STAGE_W * 0.9} height={STAGE_H * 0.9} stroke="rgba(255,255,255,.18)" dash={[8, 8]} strokeWidth={1 / fit} listening={false} />}
            <Rect width={STAGE_W} height={STAGE_H} stroke={theme.frameStroke} strokeWidth={1 / fit} listening={false} />
          </Group>
          {selBox && selLayer && (
            <Group x={selBox.cx} y={selBox.cy} rotation={selBox.rotation} listening={false}>
              <Rect x={-selBox.w / 2 - 2} y={-selBox.h / 2 - 2} width={selBox.w + 4} height={selBox.h + 4} stroke={theme.accent} strokeWidth={1.5} dash={selLayer.locked ? [4, 4] : undefined} />
              {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => (
                <Rect key={`${sx}${sy}`} x={sx * (selBox.w / 2 + 2) - 3} y={sy * (selBox.h / 2 + 2) - 3} width={6} height={6} fill="#fff" stroke={theme.accent} />
              ))}
              {selLayer.locked && <Text x={-selBox.w / 2} y={-selBox.h / 2 - 18} text="已锁定" fontSize={11} fill={theme.accent} />}
            </Group>
          )}
        </KLayer>
      </KStage>
    </div>
  );
}
