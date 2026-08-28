export interface ShotThumbnailPlaceholderProps {
  index: number;
  name: string;
}

export function ShotThumbnailPlaceholder({
  index,
  name,
}: ShotThumbnailPlaceholderProps): React.JSX.Element {
  return (
    <div
      className="shot-thumbnail-placeholder"
      aria-label={`${name} 缩略图占位`}
    >
      <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
    </div>
  );
}
