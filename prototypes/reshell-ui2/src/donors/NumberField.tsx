/*
 * Adapted from Animora src/components/Fields.tsx (NumberField)
 *   https://github.com/itsrajverma/animora/blob/5866ed2193ef19b53986ecfb46164df88134cdbe/src/components/Fields.tsx
 *   Copyright (c) Raj Verma — MIT License (see ../../LICENSES/animora-LICENSE)
 * with the reset-to-default affordance and scrub-end callback ideas from OpenCut Classic number-field.tsx
 *   https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e919144200294fb9fed22a222592a0aeea/apps/web/src/components/ui/number-field.tsx
 *   Copyright (c) OpenCut — MIT License (see ../../LICENSES/opencut-LICENSE)
 * Changes: removed Animora model/color imports, gesture key is generated locally, added className/reset props.
 */
import { useRef, useState } from 'react';

interface NumProps {
  label: string;
  value: number;
  onChange: (v: number, key: string) => void;
  step?: number; min?: number; max?: number; unit?: string; title?: string;
  /** Show the (draggable) label as a small suffix inside the box, SVGator style. */
  suffix?: boolean;
  disabled?: boolean;
  className?: string;
  defaultValue?: number;
  /** pixels of drag per step */
  pxPerStep?: number;
}

const clamp = (v: number, min?: number, max?: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
const round = (v: number, step: number) => {
  const dec = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(v.toFixed(Math.min(4, dec + 1)));
};
let g = 0;

/** Numeric input whose label can be dragged horizontally to scrub the value. */
export function NumberField({ label, value, onChange, step = 1, min, max, unit, title, suffix, disabled, className = '', defaultValue, pxPerStep = 2 }: NumProps) {
  const [text, setText] = useState<string | null>(null);
  const keyRef = useRef('');
  const shown = text ?? String(round(value, step));

  const commit = (s: string) => {
    const v = parseFloat(s);
    if (Number.isFinite(v)) onChange(clamp(v, min, max), 'field:' + label + ':' + g++);
    setText(null);
  };

  const startScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = value;
    keyRef.current = 'scrub:' + g++;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = clamp(v0 + Math.round((ev.clientX - x0) / pxPerStep) * step * k, min, max);
      onChange(round(v, step), keyRef.current);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const labelEl = <span className="num-label" onPointerDown={disabled ? undefined : startScrub}>{label}</span>;
  return (
    <div className={`num-field ${suffix ? 'suffix' : ''} ${disabled ? 'disabled' : ''} ${className}`} title={title}>
      {!suffix && labelEl}
      <input
        disabled={disabled}
        value={shown}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
            onChange(round(clamp(value + k * step, min, max), step), 'field:' + label + ':' + g++);
            setText(null);
          }
        }}
      />
      {unit && <span className="num-unit">{unit}</span>}
      {suffix && labelEl}
      {defaultValue !== undefined && Math.abs(value - defaultValue) > 1e-6 && !disabled && (
        <button className="num-reset" title="重置" onClick={() => onChange(defaultValue, 'reset:' + g++)}>↺</button>
      )}
    </div>
  );
}
