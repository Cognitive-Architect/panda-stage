export interface ShotThumbnailPlaceholderProps {
  fingerprint?: string;
  index: number;
  message?: string;
  name: string;
  shotId?: string;
  status?: ShotThumbnailPlaceholderStatus;
}

export type ShotThumbnailPlaceholderStatus =
  | 'empty'
  | 'loading'
  | 'missing'
  | 'error';

export function ShotThumbnailPlaceholder({
  fingerprint,
  index,
  message,
  name,
  shotId,
  status,
}: ShotThumbnailPlaceholderProps): React.JSX.Element {
  return (
    <div
      className="shot-thumbnail-placeholder"
      aria-label={`${name} 缩略图占位`}
      data-thumbnail-shot-id={shotId}
      data-shot-thumbnail="true"
      data-thumbnail-fingerprint={fingerprint}
      data-thumbnail-status={status}
      data-testid="shot-thumbnail"
    >
      <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      {status ? <small>{message}</small> : null}
    </div>
  );
}
