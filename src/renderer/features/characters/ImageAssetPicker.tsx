import { useState } from 'react';
import { Search } from 'lucide-react';
import type { ImageAsset } from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';
import {
  getThumbnailFallbackIconKind,
  ThumbnailStateIcon,
} from './ThumbnailStateIcon';

export interface ImageAssetPickerProps {
  label: string;
  assets: readonly ImageAsset[];
  selectedAssetId: string | null;
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  presentation?: 'default' | 'inline';
  /** Opt-in Expression workflow capacity controls; other picker hosts stay unchanged. */
  searchAndPaginate?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  onChange: (assetId: string | null) => void;
  onThumbnailError: (assetId: string) => void;
  emptyOption?: {
    label: string;
    description?: string;
    optional?: boolean;
  };
  emptyState?: {
    label: string;
    description: string;
  };
  getDisabledReason?: (asset: ImageAsset) => string | undefined;
  selectionConflict?: string;
  helperText?: string;
  emptyActionLabel?: string;
  selectedAction?: React.ReactNode;
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
  const status = thumbnail?.status ?? (asset ? 'loading' : 'missing');
  const label = asset ? thumbnailLabel(thumbnail) : '素材不可用';
  const iconKind = getThumbnailFallbackIconKind(thumbnail, {
    assetResolved: Boolean(asset),
  });

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
          data-thumbnail-icon={iconKind}
          data-thumbnail-fallback={status}
        >
          <ThumbnailStateIcon
            className="image-asset-picker-thumbnail-icon"
            kind={iconKind}
            size={20}
          />
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
      <ThumbnailStateIcon
        className="image-asset-picker-thumbnail-icon"
        kind="empty"
        size={20}
      />
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
  emptyState?: { description?: string },
): string {
  if (asset) return `${asset.width}×${asset.height}`;
  if (assetId) return `素材 ID：${assetId}`;
  return emptyState ? (emptyState.description ?? '') : '未选择图片';
}

export const IMAGE_ASSET_PAGE_SIZE = 12;

export function paginateImageAssetCandidates(
  assets: readonly ImageAsset[],
  query: string,
  requestedPage: number,
): {
  assets: readonly ImageAsset[];
  matchCount: number;
  page: number;
  pageCount: number;
} {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = normalizedQuery
    ? assets.filter((asset) => asset.name.toLocaleLowerCase().includes(normalizedQuery))
    : assets;
  const pageCount = Math.max(1, Math.ceil(matches.length / IMAGE_ASSET_PAGE_SIZE));
  const page = Number.isFinite(requestedPage)
    ? Math.min(pageCount, Math.max(1, Math.trunc(requestedPage)))
    : 1;
  const start = (page - 1) * IMAGE_ASSET_PAGE_SIZE;
  return {
    assets: matches.slice(start, start + IMAGE_ASSET_PAGE_SIZE),
    matchCount: matches.length,
    page,
    pageCount,
  };
}

export function ImageAssetPicker({
  label,
  assets,
  selectedAssetId,
  thumbnails,
  presentation = 'default',
  searchAndPaginate = false,
  disabled = false,
  onOpenChange,
  onChange,
  onThumbnailError,
  emptyOption,
  emptyState,
  getDisabledReason,
  selectionConflict,
  helperText,
  emptyActionLabel = '选择',
  selectedAction,
  testId,
}: ImageAssetPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId);
  const selectedEmptyState = emptyOption ?? emptyState;
  const candidatePage = searchAndPaginate
    ? paginateImageAssetCandidates(assets, searchQuery, page)
    : null;
  const candidateAssets = candidatePage?.assets ?? assets;

  const selectAsset = (assetId: string | null): void => {
    if (disabled) return;
    onChange(assetId);
    setOpen(false);
    onOpenChange?.(false);
  };

  const selectedLabel = selectedAsset
    ? selectedAsset.name
    : selectedAssetId
      ? '素材不可用'
      : selectedEmptyState?.label ?? '未选择图片';
  const selectedMetadata = assetMetadata(
    selectedAsset,
    selectedAssetId,
    selectedEmptyState,
  );

  const selectedButton = (
    <button
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-label={`${label}：${selectedLabel}`}
      className={`image-asset-picker-selected${selectedAssetId ? '' : ' image-asset-picker-selected-empty'}`}
      data-testid={testId ? `${testId}-selected` : undefined}
      disabled={disabled}
      onClick={() => {
        const nextOpen = !open;
        if (nextOpen) {
          setSearchQuery('');
          setPage(1);
        }
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
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
        {selectedMetadata ? <small>{selectedMetadata}</small> : null}
      </span>
      <span aria-hidden="true" className="image-asset-picker-selected-action">
        {open ? '收起' : selectedAssetId ? '更换' : emptyActionLabel}
      </span>
    </button>
  );

  return (
    <section
      aria-label={label}
      className={`image-asset-picker${presentation === 'inline' ? ' image-asset-picker-inline' : ''}`}
      data-image-asset-picker={label}
      data-image-asset-picker-presentation={presentation}
      data-selected-asset-id={selectedAssetId ?? ''}
      data-testid={testId}
    >
      <div className="image-asset-picker-heading">
        <strong>{label}</strong>
        {emptyOption?.optional ? <small>可选</small> : null}
      </div>
      {selectedAction && selectedAssetId ? (
        <div className="image-asset-picker-selected-row">
          {selectedButton}
          {selectedAction}
        </div>
      ) : (
        selectedButton
      )}
      {selectionConflict ? (
        <small className="image-asset-picker-conflict" role="alert">
          {selectionConflict}
        </small>
      ) : null}
      {helperText ? (
        <small className="image-asset-picker-helper">{helperText}</small>
      ) : null}
      {open ? (
        <>
        {searchAndPaginate ? (
          <label className="image-asset-picker-search">
            <Search aria-hidden="true" focusable="false" size={16} />
            <input
              aria-label="搜索素材名称"
              data-testid={testId ? `${testId}-search` : undefined}
              disabled={disabled}
              onChange={(event) => {
                setSearchQuery(event.currentTarget.value);
                setPage(1);
              }}
              placeholder="搜索素材名称"
              type="search"
              value={searchQuery}
            />
          </label>
        ) : null}
        <div
          aria-label={`${label}候选素材`}
          className="image-asset-picker-candidates"
          data-testid={testId ? `${testId}-candidates` : undefined}
          role="listbox"
        >
          {emptyOption ? (
            <button
              aria-label={
                emptyOption.description
                  ? `${emptyOption.label}：${emptyOption.description}`
                  : emptyOption.label
              }
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
                {emptyOption.description ? (
                  <small>{emptyOption.description}</small>
                ) : null}
              </span>
              {!selectedAssetId ? <SelectionCheck /> : null}
            </button>
          ) : null}
          {candidateAssets.map((asset) => {
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
          {candidateAssets.length === 0 && !emptyOption ? (
            <p className="image-asset-picker-empty-state">
              {assets.length === 0 ? '暂无图片素材' : '没有匹配的图片素材'}
            </p>
          ) : null}
        </div>
        {candidatePage && candidatePage.pageCount > 1 ? (
          <div className="image-asset-picker-pagination">
            <button
              data-testid={testId ? `${testId}-previous` : undefined}
              disabled={disabled || candidatePage.page === 1}
              onClick={() => setPage(candidatePage.page - 1)}
              type="button"
            >
              ‹ 上一页
            </button>
            <span data-testid={testId ? `${testId}-page` : undefined}>
              {candidatePage.page} / {candidatePage.pageCount}
            </span>
            <button
              data-testid={testId ? `${testId}-next` : undefined}
              disabled={disabled || candidatePage.page === candidatePage.pageCount}
              onClick={() => setPage(candidatePage.page + 1)}
              type="button"
            >
              下一页 ›
            </button>
          </div>
        ) : null}
        </>
      ) : null}
    </section>
  );
}
