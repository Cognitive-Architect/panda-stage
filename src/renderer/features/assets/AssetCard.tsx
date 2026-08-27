import type {
  Asset,
  AssetDropPayload,
} from '../../../domain';
import type {
  AssetLibraryCategory,
} from '../../stores/assetLibrarySelectors';
import type { AssetThumbnailReadResponse } from '../../../shared/asset-thumbnail-api';
import { Image, ImageOff, Music2 } from 'lucide-react';
import { DecorativeIcon } from '../../ui';
import { writeAssetDropPayload } from './AssetDropPayload';

export type ThumbnailMissingReason = 'cache' | 'source' | 'error';

export type ThumbnailState =
  | { status: 'loading' }
  | {
      status: 'missing';
      reason?: ThumbnailMissingReason;
      message?: string;
      relativePath?: string;
    }
  | { status: 'ready'; dataUrl: string };

const draggedCards = new WeakSet<HTMLElement>();

export function formatAssetDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return '时长未知';
  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(2)} 秒`;
  }
  const totalSeconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function thumbnailStateFromResponse(
  response: AssetThumbnailReadResponse,
): ThumbnailState {
  if (response.ok && response.status === 'ready') {
    return { status: 'ready', dataUrl: response.dataUrl };
  }
  if (response.ok) {
    return { status: 'missing', reason: 'cache' };
  }
  return {
    status: 'missing',
    reason:
      response.error.code === 'ASSET_THUMBNAIL_SOURCE_MISSING'
        ? 'source'
        : 'error',
    message: response.error.message,
    ...(response.error.relativePath
      ? { relativePath: response.error.relativePath }
      : {}),
  };
}

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
  const sourceMissing =
    image && thumbnail.status === 'missing' && thumbnail.reason === 'source';
  const sourceStatus = sourceMissing
    ? 'missing'
    : thumbnail.status === 'ready' ||
        (thumbnail.status === 'missing' && thumbnail.reason === 'cache')
      ? 'present'
      : 'unknown';
  const typeLabel =
    category === 'character'
      ? '角色'
      : category === 'background'
        ? '背景'
        : '音频';
  const metadata = image
    ? `${asset.width} × ${asset.height} px`
    : asset.durationMs === undefined
      ? '时长未知'
      : formatAssetDuration(asset.durationMs);
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
      onClick={(event) => {
        if (draggedCards.has(event.currentTarget)) {
          draggedCards.delete(event.currentTarget);
          return;
        }
        onSelect(asset.id);
      }}
      onDragEnd={(event) => {
        const card = event.currentTarget;
        onDragEnd();
        if (typeof window === 'undefined') {
          draggedCards.delete(card);
          return;
        }
        window.setTimeout(() => {
          draggedCards.delete(card);
        }, 0);
      }}
      onDragStart={(event) => {
        draggedCards.add(event.currentTarget);
        writeAssetDropPayload(event.dataTransfer, dropPayload);
        onDragStart(asset.id);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(asset.id);
        }
      }}
      aria-pressed={selected}
      role="button"
      tabIndex={0}
    >
      <div
        className="asset-card-preview"
        data-media-kind={asset.kind}
      >
        {image && thumbnail.status === 'ready' ? (
          <img
            alt=""
            decoding="async"
            loading="lazy"
            onError={() => onThumbnailError(asset.id)}
            src={thumbnail.dataUrl}
          />
        ) : image ? (
          <div
            className="asset-thumbnail-placeholder"
            data-thumbnail-status={thumbnail.status}
            data-thumbnail-source-status={sourceStatus}
          >
            <DecorativeIcon
              className="asset-thumbnail-icon"
              icon={thumbnail.status === 'missing' ? ImageOff : Image}
              size={24}
            />
            <small>
              {thumbnail.status === 'loading'
                ? '加载缩略图'
                : sourceMissing
                  ? '源文件缺失，无法重建缩略图'
                  : '缩略图缺失'}
            </small>
            {sourceMissing && thumbnail.relativePath ? (
              <code>{thumbnail.relativePath}</code>
            ) : null}
            {thumbnail.status === 'missing' && !sourceMissing ? (
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
        ) : (
          <div className="asset-card-audio-placeholder">
            <DecorativeIcon
              className="asset-card-audio-icon"
              icon={Music2}
              size={30}
            />
            <span>音频素材</span>
          </div>
        )}
      </div>
      <span
        className={`asset-card-type-badge asset-card-type-badge-${category}`}
        data-asset-type={category}
      >
        {typeLabel}
      </span>
      <div className="asset-card-copy">
        <strong className="asset-card-name" title={asset.name}>
          {asset.name}
        </strong>
        <span className="asset-card-context">{contextLabel}</span>
        <span className="asset-card-metadata">{metadata}</span>
      </div>
    </article>
  );
}
