import { useEffect, useId, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';

export interface CompactOverflowMenuItem {
  label: string;
  testId?: string;
  className?: string;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
  onSelect: () => void;
}

const MENU_WIDTH = 136;
const MENU_MIN_HEIGHT = 48;
const MENU_GAP = 4;
const MENU_MARGIN = 8;

function isPopoverOpen(popover: HTMLDivElement | null): boolean {
  if (!popover) return false;
  try {
    return popover.matches(':popover-open');
  } catch {
    return false;
  }
}

function hidePopoverSafely(popover: HTMLDivElement | null): void {
  if (!popover || typeof popover.hidePopover !== 'function') return;
  try {
    popover.hidePopover();
  } catch {
    // Ignore when popover is already hidden
  }
}

/**
 * Top-layer popover overflow menu for compact character/expression rows.
 * Escapes drawer scroll clipping while keeping keyboard Tab/Escape order.
 */
export function CompactRowOverflowMenu({
  ariaLabel,
  disabled = false,
  items,
  menuClassName = '',
  menuTestId,
  restoreFocusSelector,
  triggerClassName = '',
  triggerTestId,
}: {
  ariaLabel: string;
  disabled?: boolean;
  items: readonly CompactOverflowMenuItem[];
  menuClassName?: string;
  menuTestId?: string;
  restoreFocusSelector?: string;
  triggerClassName?: string;
  triggerTestId?: string;
}): React.JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return undefined;

    const positionPopover = (force = false): void => {
      if (!force && !isPopoverOpen(popover)) return;

      const anchor = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      if (
        viewportWidth <= 0 ||
        viewportHeight <= 0 ||
        anchor.bottom <= 0 ||
        anchor.top >= viewportHeight
      ) {
        if (isPopoverOpen(popover)) hidePopoverSafely(popover);
        return;
      }

      const computedWidth = Number.parseFloat(getComputedStyle(popover).width);
      const width = Math.min(
        Number.isFinite(computedWidth) ? computedWidth : MENU_WIDTH,
        Math.max(0, viewportWidth - MENU_MARGIN * 2),
      );
      const measuredHeight = popover.scrollHeight || MENU_MIN_HEIGHT;
      const height = Math.max(MENU_MIN_HEIGHT, measuredHeight);
      const spaceBelow = viewportHeight - anchor.bottom - MENU_MARGIN;
      const spaceAbove = anchor.top - MENU_MARGIN;
      const opensAbove =
        spaceBelow < height + MENU_GAP && spaceAbove > spaceBelow;
      const availableSpace = Math.max(
        0,
        (opensAbove ? spaceAbove : spaceBelow) - MENU_GAP,
      );
      const visibleHeight = Math.min(height, availableSpace);
      const maxLeft = Math.max(0, viewportWidth - width - MENU_MARGIN);
      const left = Math.max(MENU_MARGIN, Math.min(anchor.right - width, maxLeft));
      const top = opensAbove
        ? Math.max(MENU_MARGIN, anchor.top - MENU_GAP - visibleHeight)
        : Math.min(
            viewportHeight - MENU_MARGIN - visibleHeight,
            anchor.bottom + MENU_GAP,
          );

      popover.style.width = `${width}px`;
      popover.style.maxHeight = `${availableSpace}px`;
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.dataset.placement = opensAbove ? 'above' : 'below';
    };

    const onBeforeToggle = (event: Event): void => {
      if ((event as Event & { newState?: string }).newState === 'open') {
        positionPopover(true);
      }
    };
    const onToggle = (): void => {
      const isOpen = isPopoverOpen(popover);
      setOpen(isOpen);
      if (isOpen) positionPopover(true);
    };
    const onViewportMove = (): void => positionPopover();
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (
        isPopoverOpen(popover) &&
        target instanceof Node &&
        !trigger.contains(target) &&
        !popover.contains(target)
      ) {
        hidePopoverSafely(popover);
      }
    };

    popover.addEventListener('beforetoggle', onBeforeToggle);
    popover.addEventListener('toggle', onToggle);
    document.addEventListener('scroll', onViewportMove, true);
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('resize', onViewportMove);
    window.visualViewport?.addEventListener('resize', onViewportMove);
    window.visualViewport?.addEventListener('scroll', onViewportMove);
    return () => {
      popover.removeEventListener('beforetoggle', onBeforeToggle);
      popover.removeEventListener('toggle', onToggle);
      document.removeEventListener('scroll', onViewportMove, true);
      document.removeEventListener('focusin', onFocusIn, true);
      window.removeEventListener('resize', onViewportMove);
      window.visualViewport?.removeEventListener('resize', onViewportMove);
      window.visualViewport?.removeEventListener('scroll', onViewportMove);
    };
  }, []);

  useEffect(() => {
    if (disabled && isPopoverOpen(popoverRef.current)) {
      hidePopoverSafely(popoverRef.current);
    }
  }, [disabled]);

  const runItem = (item: CompactOverflowMenuItem): void => {
    hidePopoverSafely(popoverRef.current);
    item.onSelect();
    window.requestAnimationFrame(() => {
      if (restoreFocusSelector) {
        const target = document.querySelector<HTMLElement>(restoreFocusSelector);
        if (target?.isConnected) {
          target.focus();
          return;
        }
      }
      if (triggerRef.current?.isConnected) {
        triggerRef.current.focus();
      }
    });
  };

  return (
    <div
      className="character-compact-overflow"
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          isPopoverOpen(popoverRef.current)
        ) {
          event.stopPropagation();
          hidePopoverSafely(popoverRef.current);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        aria-controls={id}
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`character-compact-icon-button character-compact-overflow-trigger ${triggerClassName}`.trim()}
        data-testid={triggerTestId}
        disabled={disabled}
        popoverTarget={id}
        popoverTargetAction="toggle"
        ref={triggerRef}
        title={ariaLabel}
        type="button"
      >
        <Ellipsis aria-hidden="true" size={16} />
      </button>
      <div
        aria-label={ariaLabel}
        className={`character-compact-overflow-menu ${menuClassName}`.trim()}
        data-testid={menuTestId}
        id={id}
        popover="auto"
        ref={popoverRef}
        role="group"
      >
        {items.map((item) => (
          <button
            className={`character-compact-overflow-item${item.danger ? ' is-danger' : ''} ${item.className ?? ''}`.trim()}
            data-testid={item.testId}
            disabled={disabled || item.disabled}
            key={item.label}
            onClick={() => runItem(item)}
            title={item.title}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
