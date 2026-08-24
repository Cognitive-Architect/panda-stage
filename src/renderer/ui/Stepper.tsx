import { Button } from './Button';

export interface StepperProps {
  value: React.ReactNode;
  onDecrement(): void;
  onIncrement(): void;
  decrementDisabled?: boolean;
  incrementDisabled?: boolean;
  'aria-label'?: string;
  className?: string;
}

/** Three-part stepper: decrement, exact display value, increment. */
export function Stepper({
  value,
  onDecrement,
  onIncrement,
  decrementDisabled = false,
  incrementDisabled = false,
  'aria-label': ariaLabel = 'Value',
  className,
}: StepperProps): React.JSX.Element {
  const classes = ['ui-stepper', className].filter(Boolean).join(' ');

  return (
    <div aria-label={ariaLabel} className={classes} role="group">
      <Button
        aria-label={`Decrease ${ariaLabel}`}
        disabled={decrementDisabled}
        onClick={onDecrement}
        variant="secondary"
      >
        −
      </Button>
      <output aria-live="polite" className="ui-stepper__value">
        {value}
      </output>
      <Button
        aria-label={`Increase ${ariaLabel}`}
        disabled={incrementDisabled}
        onClick={onIncrement}
        variant="secondary"
      >
        +
      </Button>
    </div>
  );
}
