import type { ReactNode, RefObject } from 'react';

export function CharacterFloatPanel({
  side,
  open,
  id,
  handle,
  onToggle,
  children,
}: {
  side: 'left' | 'right';
  open: boolean;
  id: string;
  handle: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const name = side === 'left' ? '角色操作' : '角色属性';
  const action = (open ? '收起' : '展开') + name;
  return (
    <aside
      className={'character-float-panel character-float-panel-' + side}
      aria-label={name}
      data-expanded={open}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        onToggle();
        handle.current?.focus();
      }}
    >
      <button
        aria-controls={id}
        aria-expanded={open}
        aria-label={action}
        className="adaptive-parts-float-handle character-float-handle"
        data-testid={'character-float-' + side + '-toggle'}
        onClick={onToggle}
        ref={handle}
        title={action}
        type="button"
      >
        <span aria-hidden="true" className="floating-panel-grip" />
      </button>
      <div className="character-float-panel-content" id={id} inert={!open}>
        {children}
      </div>
    </aside>
  );
}
