import type { ReactNode } from 'react';
import { Button } from './Button';

export interface SegmentedTabOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedTabsProps {
  'aria-label': string;
  options: readonly SegmentedTabOption[];
  value: string;
  onChange(value: string): void;
  className?: string;
}

/** A compact single-choice workspace/tab control. */
export function SegmentedTabs({
  'aria-label': ariaLabel,
  options,
  value,
  onChange,
  className,
}: SegmentedTabsProps): React.JSX.Element {
  const classes = ['ui-segmented-tabs', className].filter(Boolean).join(' ');

  return (
    <div aria-label={ariaLabel} className={classes} role="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        const itemClasses = [
          'ui-segmented-tabs__item',
          selected ? 'ui-segmented-tabs__item--selected' : undefined,
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <Button
            aria-selected={selected}
            className={itemClasses}
            data-ui-segmented-tab="true"
            disabled={option.disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="tab"
            variant="secondary"
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
