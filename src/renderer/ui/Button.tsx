import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/**
 * Native button primitive. The data contract deliberately leaves the
 * consumer's existing className untouched while adding the UI-M1 variant.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { type = 'button', variant = 'primary', ...props },
    ref,
  ): React.JSX.Element {
    return (
      <button
        {...props}
        data-ui-button="true"
        data-ui-variant={variant}
        ref={ref}
        type={type}
      />
    );
  },
);

export interface IconButtonProps
  extends Omit<ButtonProps, 'children' | 'aria-label'> {
  'aria-label': string;
  icon: ReactNode;
}

/** An icon-only button with an explicit accessible name and 44px target. */
export function IconButton({
  icon,
  ...props
}: IconButtonProps): React.JSX.Element {
  if (!props['aria-label'].trim()) {
    throw new Error('IconButton requires a non-empty aria-label.');
  }

  return (
    <Button {...props} data-ui-size="icon">
      <span aria-hidden="true">{icon}</span>
    </Button>
  );
}
