import type { Asset } from '../../../domain';
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
  selected: boolean;
  dragging: boolean;
  thumbnail: ThumbnailState;
  onSelect: (assetId: string) => void;
  onDragStart: (assetId: string) => void;
  onDragEnd: () => void;
  onRebuildThumbnail: (assetId: string) => void;
}

function dragType(
  category: AssetLibraryCategory,
): 'character-image' | 'background-image' | 'audio' {
  return category === 'audio'
    ? 'audio'
    : category === 'character'
      ? 'character-image'
      : 'background-image';
}

export function AssetCard({
  asset,
  category,
  selected,
  dragging,
  thumbnail,
  onSelect,
  onDragStart,
  onDragEnd,
  onRebuildThumbnail,
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
      draggable
      onClick={() => onSelect(asset.id)}
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        writeAssetDropPayload(event.dataTransfer, {
          version: 1,
          assetId: asset.id,
          type: dragType(category),
        });
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
      <span>{category === 'audio' ? '音频' : '图片'}</span>
    </article>
  );
}
