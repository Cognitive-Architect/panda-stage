import type {
  Asset,
  AssetDropPayload,
} from '../../../domain';
import type {
  AssetLibraryCategory,
} from '../../stores/assetLibrarySelectors';
import { writeAssetDropPayload } from './AssetDropPayload';

export type ThumbnailState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; dataUrl: string };

export interface AssetCardProps {
  asset: Asset;
  category: AssetLibraryCategory;
  contextLabel: string;
  dropPayload: AssetDropPayload;
  selected: boolean;
  dragging: boolean;
  thumbnail: ThumbnailState;
  onSelect: (assetId: string) => void;
  onDragStart: (assetId: string) => void;
  onDragEnd: () => void;
  onRebuildThumbnail: (assetId: string) => void;
  onThumbnailError: (assetId: string) => void;
}

export function AssetCard({
  asset,
  category,
  contextLabel,
  dropPayload,
  selected,
  dragging,
  thumbnail,
  onSelect,
  onDragStart,
  onDragEnd,
  onRebuildThumbnail,
  onThumbnailError,
}: AssetCardProps): React.JSX.Element {
  const image = asset.kind === 'image';
  return (
    <article
      className={[
        'asset-card',
        selected ? 'asset-card-selected' : '',
        dragging ? 'asset-card-dragging' : '',
      ].filter(Boolean).join(' ')}
      data-asset-id={asset.id}
      data-category={category}
      draggable
      onClick={() => onSelect(asset.id)}
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        writeAssetDropPayload(event.dataTransfer, dropPayload);
        onDragStart(asset.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(asset.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="asset-card-preview">
        {image && thumbnail.status === 'ready' ? (
          <img
            alt=""
            decoding="async"
            loading="lazy"
            onError={() => onThumbnailError(asset.id)}
            src={thumbnail.dataUrl}
          />
        ) : (
          <div
            className="asset-thumbnail-placeholder"
            data-thumbnail-status={thumbnail.status}
          >
            <span aria-hidden="true">
              {image ? '▧' : '♫'}
            </span>
            <small>
              {image
                ? thumbnail.status === 'loading'
                  ? '加载缩略图'
                  : '缩略图缺失'
                : '音频素材'}
            </small>
            {image && thumbnail.status === 'missing' ? (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onRebuildThumbnail(asset.id);
                }}
                type="button"
              >
                重建
              </button>
            ) : null}
          </div>
        )}
      </div>
      <strong title={asset.name}>{asset.name}</strong>
      <span>{contextLabel}</span>
    </article>
  );
}
