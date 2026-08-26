import type { LucideIcon, LucideProps } from 'lucide-react';

export interface DecorativeIconProps
  extends Omit<LucideProps, 'aria-hidden' | 'className'> {
  icon: LucideIcon;
  className?: string;
}

/** Render a Lucide icon as decoration with no duplicate accessible name. */
export function DecorativeIcon({
  icon: Icon,
  className = 'ui-icon',
  ...props
}: DecorativeIconProps): React.JSX.Element {
  return (
    <Icon
      {...props}
      aria-hidden="true"
      className={className}
      focusable="false"
    />
  );
}
