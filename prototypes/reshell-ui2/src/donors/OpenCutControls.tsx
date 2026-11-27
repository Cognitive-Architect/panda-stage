/*
 * Adapted directly from OpenCut Classic (MIT, archived):
 * - apps/web/src/components/ui/number-field.tsx
 *   https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e919144200294fb9fed22a222592a0aeea/apps/web/src/components/ui/number-field.tsx
 * - apps/web/src/timeline/components/graph-editor/bezier-graph.tsx
 *   https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e919144200294fb9fed22a222592a0aeea/apps/web/src/timeline/components/graph-editor/bezier-graph.tsx
 * Copyright (c) OpenCut — MIT License (see ../../LICENSES/opencut-LICENSE)
 * Changes: replaced Tailwind/Hugeicons/Next.js client wrappers with plain CSS classes + lucide-react;
 * pointer-capture fallback alongside pointer-lock so scrubbing works smoothly inside embedded webviews.
 */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { EASE_PRESETS, type Bezier } from '../core/model';

/* ---------- OpenCut NumberField ---------- */
export interface ScrubRange { from: number; to: number; pixelsPerUnit: number }

function clampVal(value: number, min?: number, max?: number): number {
  if (min != null && max != null) return Math.min(max, Math.max(min, value));
  if (min != null) return Math.max(min, value);
  if (max != null) return Math.min(max, value);
  return value;
}

function scrubAcrossRanges(startValue: number, pixelDelta: number, ranges: readonly ScrubRange[], min?: number, max?: number): number {
  let currentValue = clampVal(startValue, min, max);
  let remainingPixels = pixelDelta;
  while (remainingPixels !== 0) {
    const dir = Math.sign(remainingPixels);
    const range = ranges.find((r) => (dir > 0 ? currentValue >= r.from && currentValue < r.to : currentValue > r.from && currentValue <= r.to));
    if (!range) break;
    const boundary = dir > 0 ? range.to : range.from;
    const pixelsToBoundary = Math.abs(boundary - currentValue) * range.pixelsPerUnit;
    if (Math.abs(remainingPixels) <= pixelsToBoundary) {
      currentValue += remainingPixels / range.pixelsPerUnit;
      break;
    }
    currentValue = boundary;
    remainingPixels -= dir * pixelsToBoundary;
  }
  return clampVal(currentValue, min, max);
}

let gestureSeq = 0;

export function OpenCutNumberField({
  icon, label, suffix, value, step = 1, min, max, defaultValue, disabled, scrubRanges, dragSensitivity = 1, onChange,
}: {
  icon?: ReactNode; label?: string; suffix?: string; value: number; step?: number; min?: number; max?: number;
  defaultValue?: number; disabled?: boolean; scrubRanges?: readonly ScrubRange[]; dragSensitivity?: number;
  onChange: (value: number, gestureKey: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const dec = Math.max(0, Math.ceil(-Math.log10(step)));
  const fmt = (n: number) => Number(n.toFixed(Math.min(3, dec)));
  const shown = draft ?? String(Number(value.toFixed(4)));
  const isDefault = defaultValue !== undefined && Math.abs(value - defaultValue) <= 1e-4;

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (raw.trim() && Number.isFinite(parsed) && clampVal(parsed, min, max) !== value) onChange(clampVal(parsed, min, max), `oc-edit:${gestureSeq++}`);
    setDraft(null);
  };

  const handleScrubDown = (event: RPointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startValue = value;
    const gKey = `oc-scrub:${gestureSeq++}`;
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const mult = moveEvent.shiftKey ? 5 : moveEvent.altKey ? 0.2 : 1;
      const next = scrubRanges
        ? scrubAcrossRanges(startValue, dx * mult, scrubRanges, min, max)
        : clampVal(startValue + Math.round((dx / 2) * dragSensitivity) * step * mult, min, max);
      onChange(Number(next.toFixed(Math.min(4, dec + 2))), gKey);
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('lostpointercapture', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('lostpointercapture', onUp);
  };

  return (
    <div className={`oc-num ${disabled ? 'disabled' : ''}`}>
      {icon && (
        <button type="button" className="oc-num-icon" disabled={disabled} title="左右拖动调值" onMouseDown={(e) => e.preventDefault()} onPointerDown={handleScrubDown}>
          {icon}
        </button>
      )}
      <input
        type="text"
        aria-label={label}
        inputMode="decimal"
        disabled={disabled}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => { if (draft !== null) commit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            if (e.key === 'Escape') setDraft(null);
            else e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const mult = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
            onChange(fmt(clampVal(value + mult * step, min, max)), `oc-key:${gestureSeq++}`);
            setDraft(null);
          }
        }}
      />
      {suffix && <span className="oc-num-suf">{suffix}</span>}
      {defaultValue !== undefined && !isDefault && !disabled && (
        <button type="button" className="oc-num-reset" title="重置为默认值" onClick={() => onChange(defaultValue, `oc-reset:${gestureSeq++}`)}>
          <RotateCcw size={11} />
        </button>
      )}
    </div>
  );
}

/* ---------- OpenCut BezierGraph ---------- */
const GRAPH_WIDTH = 160;
const GRAPH_HEIGHT = 104;
const GRAPH_PADDING = 14;
const SVG_WIDTH = GRAPH_WIDTH + GRAPH_PADDING * 2;
const SVG_HEIGHT = GRAPH_HEIGHT + GRAPH_PADDING * 2;
const HANDLE_RADIUS = 4.5;
const ENDPOINT_RADIUS = 2.5;
const SNAP_THRESHOLD = 0.06;
const SNAP_TARGETS = [0, 1];
const CURVE_SEGMENTS = 64;

function getBezierPoint(progress: number, p0: number, p1: number, p2: number, p3: number) {
  const u = 1 - progress;
  return u * u * u * p0 + 3 * u * u * progress * p1 + 3 * u * progress * progress * p2 + progress * progress * progress * p3;
}

const toSvgX = (v: number) => GRAPH_PADDING + v * GRAPH_WIDTH;
const toSvgY = (v: number) => GRAPH_PADDING + (1 - v) * GRAPH_HEIGHT;
const fromSvgX = (x: number) => Math.max(0, Math.min(1, (x - GRAPH_PADDING) / GRAPH_WIDTH));
const fromSvgY = (y: number) => Math.max(-0.5, Math.min(1.5, 1 - (y - GRAPH_PADDING) / GRAPH_HEIGHT));
const clampHandleY = (y: number) => Math.max(HANDLE_RADIUS, Math.min(SVG_HEIGHT - HANDLE_RADIUS, y));

export function OpenCutBezierGraph({ value, onChange }: { value: Bezier; onChange: (next: Bezier, gestureKey: string) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeHandle, setActiveHandle] = useState<'c1' | 'c2' | null>(null);
  const shiftRef = useRef(false);
  const gestureRef = useRef('');

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftRef.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const pts: string[] = [];
  for (let i = 0; i <= CURVE_SEGMENTS; i++) {
    const p = i / CURVE_SEGMENTS;
    pts.push(`${toSvgX(getBezierPoint(p, 0, value[0], value[2], 1)).toFixed(1)},${toSvgY(getBezierPoint(p, 0, value[1], value[3], 1)).toFixed(1)}`);
  }
  const path = `M${pts.join('L')}`;
  const c1 = { x: toSvgX(value[0]), y: clampHandleY(toSvgY(value[1])) };
  const c2 = { x: toSvgX(value[2]), y: clampHandleY(toSvgY(value[3])) };
  const p0 = { x: toSvgX(0), y: toSvgY(0) };
  const p1 = { x: toSvgX(1), y: toSvgY(1) };

  const onHandleDown = (handle: 'c1' | 'c2') => (event: RPointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    gestureRef.current = `oc-bez:${gestureSeq++}`;
    setActiveHandle(handle);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onMove = (event: RPointerEvent<SVGSVGElement>) => {
    if (!activeHandle || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) / rect.width) * SVG_WIDTH;
    const sy = ((event.clientY - rect.top) / rect.height) * SVG_HEIGHT;
    const x = Number(fromSvgX(sx).toFixed(3));
    let y = fromSvgY(sy);
    if (!shiftRef.current) {
      for (const t of SNAP_TARGETS) if (Math.abs(y - t) < SNAP_THRESHOLD) y = t;
    }
    y = Number(y.toFixed(3));
    const next: Bezier = [...value];
    if (activeHandle === 'c1') { next[0] = x; next[1] = y; } else { next[2] = x; next[3] = y; }
    onChange(next, gestureRef.current);
  };

  const preset = EASE_PRESETS.find((p) => p.v.every((x, i) => Math.abs(x - value[i]) < 1e-3));

  return (
    <div className="oc-bezier">
      <div className="oc-bezier-pills">
        {EASE_PRESETS.map((p) => (
          <button key={p.id} type="button" className={preset?.id === p.id ? 'on' : ''} onClick={() => onChange(p.v, `oc-preset:${gestureSeq++}`)}>
            {p.label}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="oc-bezier-svg"
        onPointerMove={onMove}
        onPointerUp={() => setActiveHandle(null)}
        onPointerCancel={() => setActiveHandle(null)}
      >
        <rect x={GRAPH_PADDING} y={GRAPH_PADDING} width={GRAPH_WIDTH} height={GRAPH_HEIGHT} className="oc-bez-box" />
        <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="oc-bez-diag" />
        <line x1={p0.x} y1={p0.y} x2={c1.x} y2={c1.y} className="oc-bez-arm" />
        <line x1={p1.x} y1={p1.y} x2={c2.x} y2={c2.y} className="oc-bez-arm" />
        <path d={path} className="oc-bez-curve" />
        <circle cx={p0.x} cy={p0.y} r={ENDPOINT_RADIUS} className="oc-bez-end" />
        <circle cx={p1.x} cy={p1.y} r={ENDPOINT_RADIUS} className="oc-bez-end" />
        <circle cx={c1.x} cy={c1.y} r={HANDLE_RADIUS} className={`oc-bez-handle ${activeHandle === 'c1' ? 'drag' : ''}`} onPointerDown={onHandleDown('c1')} />
        <circle cx={c2.x} cy={c2.y} r={HANDLE_RADIUS} className={`oc-bez-handle ${activeHandle === 'c2' ? 'drag' : ''}`} onPointerDown={onHandleDown('c2')} />
      </svg>
      <div className="oc-bezier-meta">
        <span>cubic-bezier({value.map((n) => Math.round(n * 100) / 100).join(', ')})</span>
      </div>
    </div>
  );
}
