import type { ReactNode } from 'react';

export interface CharacterCompactObjectRowProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  thumbnail: ReactNode;
  selected?: boolean;
  previewing?: boolean;
  onSelect?: (trigger: HTMLElement | null) => void;
  selectAriaLabel?: string;
  selectTestId?: string;
  rowTestId?: string;
  tooltip?: string;
  actions?: ReactNode;
  disabled?: boolean;
  assetState?: 'configured' | 'missing' | 'empty';
}

/**
 * Unified compact object row matching Adaptive Parts visual grammar:
 * [48px thumbnail | primary title + optional 1-line source | Lucide icon actions].
 */
export function CharacterCompactObjectRow({
  title,
  subtitle,
  badge,
  thumbnail,
  selected,
  previewing = false,
  onSelect,
  selectAriaLabel,
  selectTestId,
  rowTestId,
  tooltip,
  actions,
  disabled = false,
  assetState,
}: CharacterCompactObjectRowProps): React.JSX.Element {
  const mainContent = (
    <>
      <span className="character-compact-row-thumb">{thumbnail}</span>
      <span className="character-compact-row-copy">
        <span className="character-compact-row-title-line">
          <strong>{title}</strong>
          {badge}
        </span>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
    </>
  );

  return (
    <div
      className="character-compact-row"
      data-previewing={previewing || undefined}
      data-selected={selected ? 'true' : undefined}
      data-testid={rowTestId}
    >
      {onSelect ? (
        <button
          aria-label={selectAriaLabel ?? title}
          aria-pressed={selected}
          className="character-compact-row-main"
          data-asset-state={assetState}
          data-edit-target-selected={selected !== undefined ? String(selected) : undefined}
          data-testid={selectTestId}
          disabled={disabled}
          onClick={(event) => onSelect(event.currentTarget)}
          title={tooltip ?? (subtitle ? `${title} · ${subtitle}` : title)}
          type="button"
        >
          {mainContent}
        </button>
      ) : (
        <div
          className="character-compact-row-main"
          data-asset-state={assetState}
          title={tooltip ?? (subtitle ? `${title} · ${subtitle}` : title)}
        >
          {mainContent}
        </div>
      )}
      {actions ? <div className="character-compact-row-actions">{actions}</div> : null}
    </div>
  );
}
