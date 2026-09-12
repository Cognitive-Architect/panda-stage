import { useState } from 'react';
import type { ImageAsset } from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';

export interface ImageAssetPickerProps {
  label: string;
  assets: readonly ImageAsset[];
  selectedAssetId: string | null;
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  disabled?: boolean;
  onChange: (assetId: string | null) => void;
  onThumbnailError: (assetId: string) => void;
  emptyOption?: {
    label: string;
    description: string;
    optional?: boolean;
  };
  emptyState?: {
    label: string;
    description: string;
  };
  getDisabledReason?: (asset: ImageAsset) => string | undefined;
  selectionConflict?: string;
  helperText?: string;
  testId?: string;
}

function thumbnailLabel(thumbnail?: ThumbnailState): string {
  if (thumbnail?.status === 'loading') return '加载中';
  if (thumbnail?.status === 'missing') {
    if (thumbnail.reason === 'source') return '源文件缺失';
    if (thumbnail.reason === 'error') return '缩略图加载失败';
  }
  return '缩略图缺失';
}

function AssetThumbnail({
  asset,
  className,
  onThumbnailError,
  thumbnail,
}: {
  asset?: ImageAsset;
  className: string;
  onThumbnailError: (assetId: string) => void;
  thumbnail?: ThumbnailState;
}): React.JSX.Element {
  const status = thumbnail?.status ?? 'missing';
  const label = asset ? thumbnailLabel(thumbnail) : '素材不可用';

  return (
    <span
      aria-label={label}
      className={className}
      data-thumbnail-reason={
        thumbnail?.status === 'missing' ? thumbnail.reason : undefined
      }
      data-thumbnail-status={status}
    >
      {asset && thumbnail?.status === 'ready' ? (
        <img
          alt={`${asset.name} 缩略图`}
          decoding="async"
          onError={() => onThumbnailError(asset.id)}
          src={thumbnail.dataUrl}
        />
      ) : (
        <span
          aria-hidden="true"
          className="image-asset-picker-thumbnail-fallback"
          data-thumbnail-fallback={status}
        >
          {asset ? '▧' : '?'}
        </span>
      )}
      {asset && status !== 'ready' ? (
        <small>{label}</small>
      ) : null}
    </span>
  );
}

function EmptyAssetThumbnail({
  className,
}: {
  className: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`${className} image-asset-picker-neutral-empty-thumbnail`}
      data-thumbnail-status="empty"
    >
      <span aria-hidden="true">○</span>
    </span>
  );
}

function SelectionCheck(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="image-asset-picker-candidate-check"
    >
      ✓
    </span>
  );
}

function assetMetadata(
  asset: ImageAsset | undefined,
  assetId: string | null,
  emptyState?: { description: string },
): string {
  if (asset) return `${asset.width}×${asset.height}`;
  if (assetId) return `素材 ID：${assetId}`;
  return emptyState?.description ?? '未选择图片';
}

export function ImageAssetPicker({
  label,
  assets,
  selectedAssetId,
  thumbnails,
  disabled = false,
  onChange,
  onThumbnailError,
  emptyOption,
  emptyState,
  getDisabledReason,
  selectionConflict,
  helperText,
  testId,
}: ImageAssetPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId);
  const selectedEmptyState = emptyOption ?? emptyState;

  const selectAsset = (assetId: string | null): void => {
    if (disabled) return;
    onChange(assetId);
    setOpen(false);
  };

  const selectedLabel = selectedAsset
    ? selectedAsset.name
    : selectedAssetId
      ? '素材不可用'
      : selectedEmptyState?.label ?? '未选择图片';

  return (
    <section
      aria-label={label}
      className="image-asset-picker"
      data-image-asset-picker={label}
      data-selected-asset-id={selectedAssetId ?? ''}
      data-testid={testId}
    >
      <div className="image-asset-picker-heading">
        <strong>{label}</strong>
        {emptyOption?.optional ? <small>可选</small> : null}
      </div>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${label}：${selectedLabel}`}
        className={`image-asset-picker-selected${selectedAssetId ? '' : ' image-asset-picker-selected-empty'}`}
        data-testid={testId ? `${testId}-selected` : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {selectedAssetId ? (
          <AssetThumbnail
            asset={selectedAsset}
            className="image-asset-picker-selected-thumbnail"
            onThumbnailError={onThumbnailError}
            thumbnail={thumbnails[selectedAssetId]}
          />
        ) : (
          <EmptyAssetThumbnail className="image-asset-picker-selected-thumbnail" />
        )}
        <span className="image-asset-picker-selected-copy">
          <strong>{selectedLabel}</strong>
          <small>
            {assetMetadata(selectedAsset, selectedAssetId, selectedEmptyState)}
          </small>
        </span>
        <span aria-hidden="true" className="image-asset-picker-selected-action">
          {open ? '收起' : selectedAssetId ? '更换' : '选择'}
        </span>
      </button>
      {selectionConflict ? (
        <small className="image-asset-picker-conflict" role="alert">
          {selectionConflict}
        </small>
      ) : null}
      {helperText ? (
        <small className="image-asset-picker-helper">{helperText}</small>
      ) : null}
      {open ? (
        <div
          aria-label={`${label}候选素材`}
          className="image-asset-picker-candidates"
          data-testid={testId ? `${testId}-candidates` : undefined}
          role="listbox"
        >
          {emptyOption ? (
            <button
              aria-label={`${emptyOption.label}：${emptyOption.description}`}
              aria-selected={!selectedAssetId}
              className={`image-asset-picker-candidate image-asset-picker-empty-candidate${!selectedAssetId ? ' image-asset-picker-candidate-selected' : ''}`}
              data-asset-empty="true"
              disabled={disabled}
              onClick={() => selectAsset(null)}
              role="option"
              type="button"
            >
              <EmptyAssetThumbnail className="image-asset-picker-candidate-thumbnail image-asset-picker-empty-thumbnail" />
              <span className="image-asset-picker-candidate-copy">
                <strong>{emptyOption.label}</strong>
                <small>{emptyOption.description}</small>
              </span>
              {!selectedAssetId ? <SelectionCheck /> : null}
            </button>
          ) : null}
          {assets.map((asset) => {
            const disabledReason = getDisabledReason?.(asset);
            const candidateSelected = asset.id === selectedAssetId;
            return (
              <button
                aria-label={`${asset.name}，${asset.width}×${asset.height}${disabledReason ? `，${disabledReason}` : ''}`}
                aria-selected={candidateSelected}
                className={`image-asset-picker-candidate${candidateSelected ? ' image-asset-picker-candidate-selected' : ''}`}
                data-asset-id={asset.id}
                data-disabled-reason={disabledReason}
                disabled={disabled || Boolean(disabledReason)}
                key={asset.id}
                onClick={() => selectAsset(asset.id)}
                role="option"
                title={disabledReason ?? asset.name}
                type="button"
              >
                <AssetThumbnail
                  asset={asset}
                  className="image-asset-picker-candidate-thumbnail"
                  onThumbnailError={onThumbnailError}
                  thumbnail={thumbnails[asset.id]}
                />
                <span className="image-asset-picker-candidate-copy">
                  <strong title={asset.name}>{asset.name}</strong>
                  <small>{asset.width}×{asset.height}</small>
                  {disabledReason ? <em>{disabledReason}</em> : null}
                </span>
                {candidateSelected ? <SelectionCheck /> : null}
              </button>
            );
          })}
          {assets.length === 0 && !emptyOption ? (
            <p className="image-asset-picker-empty-state">暂无图片素材</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
