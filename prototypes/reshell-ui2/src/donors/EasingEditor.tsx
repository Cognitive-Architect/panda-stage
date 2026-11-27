/*
 * Adapted from Animora src/components/EasingEditor.tsx
 *   https://github.com/itsrajverma/animora/blob/5866ed2193ef19b53986ecfb46164df88134cdbe/src/components/EasingEditor.tsx
 *   Copyright (c) Raj Verma — MIT License (see ../../LICENSES/animora-LICENSE)
 * Handle snapping (0/1 targets, Shift disables) and padded graph geometry from OpenCut Classic bezier-graph.tsx
 *   https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e919144200294fb9fed22a222592a0aeea/apps/web/src/timeline/components/graph-editor/bezier-graph.tsx
 *   Copyright (c) OpenCut — MIT License (see ../../LICENSES/opencut-LICENSE)
 * Changes: works on a [x1,y1,x2,y2] tuple instead of Animora easing ids; Chinese preset list; one undo entry per drag
 * gesture; steps/saved-easing features removed (Panda keyframes are cubic-bezier only).
 */
import { useRef } from 'react';
import { EASE_PRESETS, bezierAt, type Bezier } from '../core/model';

const W = 200;
const H = 140;
const PAD_Y = 30;
const SNAP = 0.06;
let g = 0;

export function EasingEditor({ value, onChange, compact }: { value: Bezier; onChange: (b: Bezier, key: string) => void; compact?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const X = (t: number) => t * W;
  const Y = (v: number) => PAD_Y + (1 - v) * (H - 2 * PAD_Y);
  let d = '';
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    d += `${i ? 'L' : 'M'}${X(t).toFixed(1)} ${Y(bezierAt(value, t)).toFixed(1)}`;
  }
  const preset = EASE_PRESETS.find((p) => p.v.every((x, i) => Math.abs(x - value[i]) < 1e-3));

  const drag = (which: 0 | 1) => (ev: React.PointerEvent) => {
    ev.preventDefault();
    const svg = svgRef.current!;
    const key = 'ease:' + g++;
    (ev.target as Element).setPointerCapture(ev.pointerId);
    const move = (m: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (m.clientX - r.left) / r.width));
      const yPix = ((m.clientY - r.top) / r.height) * H;
      let y = Math.min(2, Math.max(-1, 1 - (yPix - PAD_Y) / (H - 2 * PAD_Y)));
      if (!m.shiftKey) for (const t of [0, 1]) if (Math.abs(y - t) < SNAP) y = t;
      const b = [...value] as Bezier;
      b[which * 2] = Number(x.toFixed(3));
      b[which * 2 + 1] = Number(y.toFixed(3));
      value = b;
      onChange(b, key);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`easing-editor ${compact ? 'compact' : ''}`}>
      <div className="ease-presets">
        {EASE_PRESETS.map((p) => (
          <button key={p.id} className={preset?.id === p.id ? 'on' : ''} onClick={() => onChange(p.v, 'preset:' + g++)}>{p.label}</button>
        ))}
      </div>
      <svg ref={svgRef} className="easing-curve" viewBox={`0 0 ${W} ${H}`}>
        <rect x={0} y={Y(1)} width={W} height={Y(0) - Y(1)} className="easing-box" />
        <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} className="easing-diag" />
        <path d={d} className="easing-path" />
        <line x1={X(0)} y1={Y(0)} x2={X(value[0])} y2={Y(value[1])} className="easing-arm" />
        <line x1={X(1)} y1={Y(1)} x2={X(value[2])} y2={Y(value[3])} className="easing-arm" />
        <circle cx={X(value[0])} cy={Y(value[1])} r={6} className="easing-handle" onPointerDown={drag(0)} />
        <circle cx={X(value[2])} cy={Y(value[3])} r={6} className="easing-handle" onPointerDown={drag(1)} />
      </svg>
      <div className="easing-code">
        <input
          key={value.join(',')}
          defaultValue={value.map((v) => Math.round(v * 1000) / 1000).join(', ')}
          title="x1, y1, x2, y2"
          onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
          onBlur={(ev) => {
            const v = ev.target.value.split(/[\s,]+/).map(Number);
            if (v.length === 4 && v.every(Number.isFinite)) onChange([Math.min(1, Math.max(0, v[0])), v[1], Math.min(1, Math.max(0, v[2])), v[3]], 'code:' + g++);
          }}
        />
        <span>{preset?.label ?? '自定义'}</span>
      </div>
    </div>
  );
}
