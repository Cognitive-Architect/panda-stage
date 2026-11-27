// Shared timeline mechanics (ruler, playhead scrub, item drag, zoom). Each variant supplies its own rows & look.
import { useEffect, useRef, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { waveform } from './assets';
import { FPS, uid } from './model';
import { actions, currentShot, getState, useStore, type Sel } from './store';

export interface TItem { sel: Sel; start: number; len?: number; label?: string; color?: string; shape: 'key' | 'bar' | 'audio' | 'cam'; seed?: string }
export interface TRow { id: string; header: ReactNode; items: TItem[]; height: number; className?: string; onHeaderClick?: () => void; active?: boolean }

const same = (a: Sel, b: Sel) => !!a && !!b && a.kind === b.kind && a.id === b.id;

export function TimelineBody({ rows, headerWidth, rulerHeight = 24, className = '', renderItem = (_, target) => target }: { renderItem?: (item: TItem, target: ReactElement<HTMLAttributes<HTMLDivElement>>) => ReactElement; rows: TRow[]; headerWidth: number; rulerHeight?: number; className?: string }) {
  const shot = useStore(currentShot);
  const time = useStore((s) => s.time);
  const ppf = useStore((s) => s.pxPerFrame);
  const sel = useStore((s) => s.sel);
  const scroller = useRef<HTMLDivElement>(null);
  const width = shot.duration * ppf + 80;

  const frameAt = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect();
    return (clientX - r.left - headerWidth + scroller.current!.scrollLeft) / ppf;
  };
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    actions.play(false);
    actions.seek(Math.round(frameAt(e.clientX)));
    const move = (m: PointerEvent) => actions.seek(Math.round(frameAt(m.clientX)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const dragItem = (it: TItem, mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    actions.select(it.sel);
    const f0 = frameAt(e.clientX); const s0 = it.start; const l0 = it.len ?? 0; const key = uid('tdrag');
    let moved = false;
    const move = (m: PointerEvent) => {
      const d = Math.round(frameAt(m.clientX) - f0);
      if (!moved && d === 0) return; moved = true;
      if (mode === 'move') actions.moveItem(it.sel, s0 + d, key); else actions.resizeClip(it.sel, l0 + d, key);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (!moved && it.shape !== 'bar' && it.shape !== 'audio') actions.seek(it.start); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  useEffect(() => {
    const target = scroller.current;
    const zoom = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.altKey) return;
      event.preventDefault();
      actions.setTimelineZoom(getState().pxPerFrame * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    target?.addEventListener('wheel', zoom, { passive: false });
    return () => target?.removeEventListener('wheel', zoom);
  }, []);

  const step = ppf >= 12 ? 6 : ppf >= 5 ? 12 : ppf >= 2.5 ? 24 : 48;
  const ticks: number[] = []; for (let f = 0; f <= shot.duration; f += step) ticks.push(f);

  return (
    <div ref={scroller} className={`tl ${className}`}>
      <div className="tl-inner" style={{ width: headerWidth + width }}>
        <div className="tl-ruler" style={{ height: rulerHeight }}>
          <div className="tl-corner" style={{ width: headerWidth }} />
          <div className="tl-ruler-track" style={{ width }} onPointerDown={scrub}>
            {ticks.map((f) => (
              <div key={f} className="tl-tick" style={{ left: f * ppf }}><span>{f % FPS === 0 ? `${f / FPS}s` : f}</span></div>
            ))}
            <div className="tl-end" style={{ left: shot.duration * ppf }} />
          </div>
        </div>
        {rows.map((r) => (
          <div key={r.id} className={`tl-row ${r.className ?? ''} ${r.active ? 'active' : ''}`} style={{ height: r.height }}>
            <div className="tl-head" style={{ width: headerWidth }} onClick={r.onHeaderClick}>{r.header}</div>
            <div className="tl-lane" style={{ width }} onPointerDown={scrub}>
              {r.items.map((it) => {
                const on = same(it.sel, sel);
                if (it.shape === 'key' || it.shape === 'cam')
                  return renderItem(it, <div key={it.sel!.id} className={`tl-key ${it.shape} ${on ? 'on' : ''}`} style={{ left: it.start * ppf, ['--c' as string]: it.color }} onPointerDown={dragItem(it, 'move')} title={`第 ${it.start} 帧`} />);
                const w = (it.len ?? 1) * ppf;
                return renderItem(it,
                  <div key={it.sel!.id} className={`tl-bar ${it.shape} ${on ? 'on' : ''}`} style={{ left: it.start * ppf, width: w, ['--c' as string]: it.color }} onPointerDown={dragItem(it, 'move')}>
                    {it.shape === 'audio' && (
                      <svg className="tl-wave" viewBox={`0 0 ${Math.max(1, Math.round(w / 3))} 20`} preserveAspectRatio="none">
                        {waveform(it.seed ?? it.sel!.id, Math.max(1, Math.round(w / 3))).map((a, i) => <rect key={i} x={i} y={10 - a * 9} width={0.6} height={a * 18} />)}
                      </svg>
                    )}
                    <span className="tl-bar-label">{it.label}</span>
                    {it.shape === 'bar' && <i className="tl-grip" onPointerDown={dragItem(it, 'resize')} />}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="tl-playhead" style={{ left: headerWidth + time * ppf }}><i /></div>
      </div>
    </div>
  );
}

/** Standard row builders so A/B/C show the same data with different headers. */
export function layerKeyItems(l: { id: string; keys: { id: string; t: number }[] }, color?: string): TItem[] {
  return l.keys.map((k) => ({ sel: { kind: 'key', layerId: l.id, id: k.id }, start: k.t, shape: 'key', color }));
}
export function layerClipItems(l: { id: string; clips: { id: string; start: number; len: number; name: string }[] }, color?: string): TItem[] {
  return l.clips.map((c) => ({ sel: { kind: 'clip', layerId: l.id, id: c.id }, start: c.start, len: c.len, label: c.name, shape: 'bar', color }));
}
