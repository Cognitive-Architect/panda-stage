import type { ReactNode } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Slider from '@radix-ui/react-slider';
import * as Tooltip from '@radix-ui/react-tooltip';
import { actions } from '../../core/store';
import type { Layer } from '../../core/model';

export function IconButton({ label, children, onClick, disabled, pressed }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" className="vd-icon" aria-label={label} aria-pressed={pressed}
          disabled={disabled} onClick={(event) => { event.stopPropagation(); onClick(); }}>{children}</button>
      </Tooltip.Trigger>
      <Tooltip.Portal><Tooltip.Content className="vd-tooltip" sideOffset={5}>{label}</Tooltip.Content></Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Menu({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="vd-button">{label}</DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="vd-menu" align="start" sideOffset={5}>{children}</DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function Context({ target, children }: { target: React.ReactElement; children: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{target}</ContextMenu.Trigger>
      <ContextMenu.Portal><ContextMenu.Content className="vd-menu">{children}</ContextMenu.Content></ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function Range({ label, value, min, max, step = 1, disabled, onChange, onCommit }: {
  label: string; value: number; min: number; max: number; step?: number; disabled?: boolean;
  onChange: (v: number) => void; onCommit?: () => void;
}) {
  return (
    <Slider.Root className="vc-slider vd-range" value={[value]} min={min} max={max} step={step} disabled={disabled}
      onValueChange={([v]) => onChange(v)} onValueCommit={onCommit}>
      <Slider.Track className="vc-slider-track"><Slider.Range className="vc-slider-range" /></Slider.Track>
      <Slider.Thumb className="vc-slider-thumb" aria-label={label} />
    </Slider.Root>
  );
}

export const motions = [
  { id: 'walk', name: '走路' }, { id: 'wave', name: '挥手' }, { id: 'bounce', name: '弹跳' }, { id: 'sway', name: '摇摆' },
] as const satisfies readonly { id: Layer['clips'][number]['motion']; name: string }[];

export function MotionMenu({ layerId }: { layerId: string }) {
  return <Menu label="添加动作">{motions.map(({ id, name }) =>
    <DropdownMenu.Item key={id} onSelect={() => actions.addAction(layerId, id)}>{name}</DropdownMenu.Item>)}</Menu>;
}
