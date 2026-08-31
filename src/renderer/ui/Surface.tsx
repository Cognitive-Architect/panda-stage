import type { HTMLAttributes, ReactNode } from 'react';

export interface PanelSurfaceProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

/** Semantic panel container for the panel-surface token. */
export function PanelSurface({
  className,
  children,
  ...props
}: PanelSurfaceProps): React.JSX.Element {
  const classes = ['ui-panel-surface', className].filter(Boolean).join(' ');
  return (
    <section {...props} className={classes} data-ui-panel-surface="true">
      {children}
    </section>
  );
}

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Shared heading/action row for panels and workspace sections. */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: SectionHeaderProps): React.JSX.Element {
  const classes = ['ui-section-header', className].filter(Boolean).join(' ');

  return (
    <header className={classes}>
      <div className="ui-section-header__copy">
        <h2 className="ui-section-header__title">{title}</h2>
        {description ? (
          <p className="ui-section-header__description">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="ui-section-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}
