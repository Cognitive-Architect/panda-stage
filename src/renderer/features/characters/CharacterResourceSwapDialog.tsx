import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import type { FlaGraphicDefinition, ImageAsset } from '../../../domain';
import { thumbnailDiagnosticTitle, type ThumbnailState } from '../assets/AssetCard';
import { Button } from '../../ui/Button';
import { GraphicFacePreview } from './GraphicFacePicker';
import { getThumbnailFallbackIconKind, ThumbnailStateIcon } from './ThumbnailStateIcon';
import './character-resource-swap-dialog.css';

export type ResourceSwapValue =
  | { kind: 'image'; assetId: string | null }
  | { kind: 'fla-graphic'; animationId: string; firstFrame?: number };

export interface CharacterResourceSwapDialogProps {
  open: boolean;
  title: string;
  imageAssets: readonly ImageAsset[];
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  onThumbnailError?: (assetId: string) => void;
  emptyOption?: {
    label: string;
    description?: string;
  };
  getDisabledReason?: (asset: ImageAsset) => string | undefined;
  graphicDefinitions?: readonly FlaGraphicDefinition[];
  graphicSelectionMode?: 'frame' | 'definition';
  currentValue: ResourceSwapValue;
  returnFocusTo?: HTMLElement | null;
  onCancel: () => void;
  onConfirm: (nextValue: ResourceSwapValue) => void;
}

const FRAME_PAGE_SIZE = 12;

function isSameResourceSwapValue(
  left: ResourceSwapValue,
  right: ResourceSwapValue,
  graphicSelectionMode: 'frame' | 'definition',
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'image' && right.kind === 'image') {
    return left.assetId === right.assetId;
  }
  if (left.kind === 'fla-graphic' && right.kind === 'fla-graphic') {
    if (left.animationId !== right.animationId) return false;
    return graphicSelectionMode === 'definition' || (left.firstFrame ?? 0) === (right.firstFrame ?? 0);
  }
  return false;
}

function thumbnailStatusLabel(thumbnail?: ThumbnailState): string {
  if (thumbnail?.status === 'loading') return '加载中';
  if (thumbnail?.status === 'missing') {
    if (thumbnail.reason === 'source') return '源文件缺失';
    if (thumbnail.reason === 'error') return '缩略图加载失败';
  }
  return '缩略图缺失';
}

function DialogImageThumbnail({
  asset,
  thumbnail,
  onThumbnailError,
}: {
  asset: ImageAsset;
  thumbnail?: ThumbnailState;
  onThumbnailError?: (assetId: string) => void;
}): React.JSX.Element {
  const status = thumbnail?.status ?? 'loading';
  const iconKind = getThumbnailFallbackIconKind(thumbnail, { assetResolved: true });
  return (
    <span
      className="character-swap-card-preview"
      data-thumbnail-status={status}
      title={thumbnailDiagnosticTitle(thumbnail)}
    >
      {thumbnail?.status === 'ready' ? (
        <img
          alt={`${asset.name} 缩略图`}
          decoding="async"
          onError={() => onThumbnailError?.(asset.id)}
          src={thumbnail.dataUrl}
        />
      ) : (
        <span className="image-asset-picker-thumbnail-fallback" data-thumbnail-icon={iconKind}>
          <ThumbnailStateIcon className="image-asset-picker-thumbnail-icon" kind={iconKind} size={20} />
          <small>{thumbnailStatusLabel(thumbnail)}</small>
        </span>
      )}
    </span>
  );
}

/**
 * Shared non-fullscreen floating resource picker dialog for Character asset/graphic replacement.
 * Keeps candidate selection local until the user explicitly confirms replacement.
 */
export function CharacterResourceSwapDialog({
  open,
  title,
  imageAssets,
  thumbnails,
  onThumbnailError,
  emptyOption,
  getDisabledReason,
  graphicDefinitions = [],
  graphicSelectionMode = 'frame',
  currentValue,
  returnFocusTo,
  onCancel,
  onConfirm,
}: CharacterResourceSwapDialogProps): React.JSX.Element | null {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const hasGraphics = graphicDefinitions.length > 0;
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'image' | 'fla-graphic'>('image');
  const [pending, setPending] = useState<ResourceSwapValue>(currentValue);
  const [framePage, setFramePage] = useState(0);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      triggerRef.current = returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setSearchQuery('');
      setPending(currentValue);
      setActiveTab(currentValue.kind === 'fla-graphic' && hasGraphics ? 'fla-graphic' : 'image');
      if (currentValue.kind === 'fla-graphic') {
        setFramePage(Math.floor((currentValue.firstFrame ?? 0) / FRAME_PAGE_SIZE));
      } else {
        setFramePage(0);
      }
      window.requestAnimationFrame(() => {
        searchRef.current?.focus();
      });
    }
    wasOpenRef.current = open;
  }, [currentValue, hasGraphics, open, returnFocusTo]);

  const restoreFocus = (): void => {
    const target = returnFocusTo ?? triggerRef.current;
    if (target && target.isConnected) {
      window.requestAnimationFrame(() => {
        target.focus();
      });
    }
  };

  const handleClose = (): void => {
    onCancel();
    restoreFocus();
  };

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredImages = useMemo(
    () =>
      normalizedQuery
        ? imageAssets.filter((asset) => asset.name.toLocaleLowerCase().includes(normalizedQuery))
        : imageAssets,
    [imageAssets, normalizedQuery],
  );
  const filteredGraphics = useMemo(
    () =>
      normalizedQuery
        ? graphicDefinitions.filter((def) => def.name.toLocaleLowerCase().includes(normalizedQuery))
        : graphicDefinitions,
    [graphicDefinitions, normalizedQuery],
  );

  const selectedGraphicDef = useMemo(
    () =>
      pending.kind === 'fla-graphic'
        ? graphicDefinitions.find((def) => def.id === pending.animationId)
        : undefined,
    [graphicDefinitions, pending],
  );

  const canConfirm = useMemo(() => {
    if (pending.kind === 'image') {
      if (pending.assetId === null) return Boolean(emptyOption);
      const asset = imageAssets.find((candidate) => candidate.id === pending.assetId);
      if (!asset) return false;
      return !getDisabledReason?.(asset);
    }
    return Boolean(selectedGraphicDef);
  }, [emptyOption, getDisabledReason, imageAssets, pending, selectedGraphicDef]);

  const summaryText = useMemo(() => {
    if (pending.kind === 'image') {
      if (pending.assetId === null) return emptyOption?.label ?? '未选择';
      const asset = imageAssets.find((candidate) => candidate.id === pending.assetId);
      return asset ? `${asset.name} (${asset.width}×${asset.height})` : '素材不可用';
    }
    if (!selectedGraphicDef) return '元件不可用';
    return graphicSelectionMode === 'frame'
      ? `${selectedGraphicDef.name} · 第 ${(pending.firstFrame ?? 0) + 1} 帧`
      : selectedGraphicDef.name;
  }, [emptyOption?.label, graphicSelectionMode, imageAssets, pending, selectedGraphicDef]);

  const handleConfirm = (): void => {
    if (!canConfirm) return;
    if (isSameResourceSwapValue(pending, currentValue, graphicSelectionMode)) {
      handleClose();
      return;
    }
    onConfirm(pending);
    restoreFocus();
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handleClose();
      return;
    }

    if (event.key === 'Tab' && dialogRef.current) {
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)',
        ),
      ).filter((el) => el.offsetParent !== null || dialogRef.current?.contains(el));
      if (focusable.length > 0) {
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }

    if (event.key === 'Enter') {
      const target = event.target;
      if (
        target === searchRef.current ||
        (target instanceof HTMLElement && target.getAttribute('role') === 'option')
      ) {
        event.preventDefault();
        handleConfirm();
      }
    }
  };

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const options = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [],
    );
    if (options.length === 0) return;
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    const cols = window.innerWidth <= 480 ? 1 : window.innerWidth <= 820 ? 2 : 3;
    let nextIndex = currentIndex;
    if (currentIndex === -1) {
      nextIndex = 0;
    } else if (event.key === 'ArrowRight') {
      nextIndex = Math.min(options.length - 1, currentIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === 'ArrowDown') {
      nextIndex = Math.min(options.length - 1, currentIndex + cols);
    } else if (event.key === 'ArrowUp') {
      nextIndex = Math.max(0, currentIndex - cols);
    }
    if (nextIndex !== currentIndex) {
      event.preventDefault();
      const nextOption = options[nextIndex];
      nextOption?.focus();
      nextOption?.click();
    }
  };

  if (!open) return null;

  const showEmptyOption = Boolean(emptyOption && !normalizedQuery);
  const isImageEmpty = filteredImages.length === 0 && !showEmptyOption;
  const isGraphicEmpty = filteredGraphics.length === 0;
  const frameCount = selectedGraphicDef?.frames.length ?? 0;
  const framePageCount = Math.max(1, Math.ceil(frameCount / FRAME_PAGE_SIZE));
  const safeFramePage = Math.min(framePage, framePageCount - 1);
  const visibleFrames = selectedGraphicDef
    ? selectedGraphicDef.frames.slice(
        safeFramePage * FRAME_PAGE_SIZE,
        (safeFramePage + 1) * FRAME_PAGE_SIZE,
      )
    : [];

  return createPortal(
    <div
      className="character-swap-backdrop"
      data-testid="character-swap-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="character-swap-dialog"
        data-testid="character-resource-swap-dialog"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header className="character-swap-header">
          <h3 id={titleId}>{title}</h3>
          <button
            aria-label="关闭素材选择器"
            className="character-swap-close"
            data-testid="character-swap-dialog-close"
            onClick={handleClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="character-swap-toolbar">
          <label className="character-swap-search-wrap">
            <Search aria-hidden="true" size={16} />
            <input
              aria-label="搜索素材"
              data-testid="character-swap-search"
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="搜索素材名称…"
              ref={searchRef}
              type="search"
              value={searchQuery}
            />
            {searchQuery ? (
              <button
                aria-label="清空搜索"
                className="character-swap-search-clear"
                onClick={() => {
                  setSearchQuery('');
                  searchRef.current?.focus();
                }}
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            ) : null}
          </label>
          {hasGraphics ? (
            <div aria-label="素材类型" className="character-swap-type-tabs" role="tablist">
              <button
                aria-selected={activeTab === 'image'}
                className="character-swap-type-tab"
                data-testid="character-swap-tab-image"
                onClick={() => setActiveTab('image')}
                role="tab"
                type="button"
              >
                图片
              </button>
              <button
                aria-selected={activeTab === 'fla-graphic'}
                className="character-swap-type-tab"
                data-testid="character-swap-tab-graphic"
                onClick={() => setActiveTab('fla-graphic')}
                role="tab"
                type="button"
              >
                FLA 元件
              </button>
            </div>
          ) : null}
        </div>

        <div className="character-swap-body">
          {activeTab === 'image' ? (
            isImageEmpty ? (
              <div className="character-swap-empty" data-testid="character-swap-empty-state">
                <span>没有匹配素材</span>
                {searchQuery ? (
                  <button
                    className="character-swap-empty-clear"
                    onClick={() => {
                      setSearchQuery('');
                      searchRef.current?.focus();
                    }}
                    type="button"
                  >
                    清空搜索
                  </button>
                ) : null}
              </div>
            ) : (
              <div
                aria-label={`${title}候选图片`}
                className="character-swap-grid"
                data-testid="character-swap-candidates"
                onKeyDown={handleGridKeyDown}
                ref={gridRef}
                role="listbox"
              >
                {showEmptyOption && emptyOption ? (
                  <button
                    aria-selected={pending.kind === 'image' && pending.assetId === null}
                    className="character-swap-card"
                    data-testid="character-swap-empty-option"
                    onClick={() => setPending({ kind: 'image', assetId: null })}
                    role="option"
                    type="button"
                  >
                    <span className="character-swap-card-preview image-asset-picker-neutral-empty-thumbnail">
                      <ThumbnailStateIcon className="image-asset-picker-thumbnail-icon" kind="empty" size={24} />
                    </span>
                    <span className="character-swap-card-copy">
                      <strong>{emptyOption.label}</strong>
                      {emptyOption.description ? <small>{emptyOption.description}</small> : null}
                    </span>
                    {pending.kind === 'image' && pending.assetId === null ? (
                      <span aria-hidden="true" className="character-swap-card-check">✓</span>
                    ) : null}
                  </button>
                ) : null}
                {filteredImages.map((asset) => {
                  const selected = pending.kind === 'image' && pending.assetId === asset.id;
                  const disabledReason = getDisabledReason?.(asset);
                  return (
                    <button
                      aria-selected={selected}
                      className="character-swap-card"
                      data-asset-id={asset.id}
                      data-testid={`character-swap-candidate-image-${asset.id}`}
                      disabled={Boolean(disabledReason)}
                      key={asset.id}
                      onClick={() => setPending({ kind: 'image', assetId: asset.id })}
                      role="option"
                      title={disabledReason ?? `${asset.name} (${asset.width}×${asset.height})`}
                      type="button"
                    >
                      <DialogImageThumbnail
                        asset={asset}
                        onThumbnailError={onThumbnailError}
                        thumbnail={thumbnails[asset.id]}
                      />
                      <span className="character-swap-card-copy">
                        <strong>{asset.name}</strong>
                        <small>{asset.width}×{asset.height}</small>
                        {disabledReason ? <em>{disabledReason}</em> : null}
                      </span>
                      {selected ? (
                        <span aria-hidden="true" className="character-swap-card-check">✓</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )
          ) : isGraphicEmpty ? (
            <div className="character-swap-empty" data-testid="character-swap-empty-state">
              <span>没有匹配素材</span>
              {searchQuery ? (
                <button
                  className="character-swap-empty-clear"
                  onClick={() => {
                    setSearchQuery('');
                    searchRef.current?.focus();
                  }}
                  type="button"
                >
                  清空搜索
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div
                aria-label={`${title}候选 FLA 元件`}
                className="character-swap-grid"
                data-testid="character-swap-candidates"
                onKeyDown={handleGridKeyDown}
                ref={gridRef}
                role="listbox"
              >
                {filteredGraphics.map((def) => {
                  const selected = pending.kind === 'fla-graphic' && pending.animationId === def.id;
                  return (
                    <button
                      aria-selected={selected}
                      className="character-swap-card"
                      data-animation-id={def.id}
                      data-testid={`character-swap-candidate-graphic-${def.id}`}
                      key={def.id}
                      onClick={() => {
                        setFramePage(0);
                        setPending({
                          kind: 'fla-graphic',
                          animationId: def.id,
                          ...(graphicSelectionMode === 'frame' ? { firstFrame: 0 } : {}),
                        });
                      }}
                      role="option"
                      title={def.name}
                      type="button"
                    >
                      <span className="character-swap-card-preview">
                        <GraphicFacePreview
                          label={def.name}
                          source={{ kind: 'fla-graphic', animationId: def.id, firstFrame: 0 }}
                        />
                      </span>
                      <span className="character-swap-card-copy">
                        <strong>{def.name}</strong>
                        <small>{def.frames.length} 帧</small>
                      </span>
                      {selected ? (
                        <span aria-hidden="true" className="character-swap-card-check">✓</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {graphicSelectionMode === 'frame' && selectedGraphicDef ? (
                <div className="character-swap-frames-section">
                  <div className="character-swap-frames-header">
                    <strong>选择元件帧 · {selectedGraphicDef.name}</strong>
                    <span>共 {frameCount} 帧</span>
                  </div>
                  <div aria-label="选择元件帧" className="character-swap-frames-grid">
                    {visibleFrames.map((frame, index) => {
                      const firstFrame = safeFramePage * FRAME_PAGE_SIZE + index;
                      const frameSelected =
                        pending.kind === 'fla-graphic' &&
                        pending.animationId === selectedGraphicDef.id &&
                        (pending.firstFrame ?? 0) === firstFrame;
                      const frameSource = {
                        kind: 'fla-graphic' as const,
                        animationId: selectedGraphicDef.id,
                        firstFrame,
                      };
                      return (
                        <button
                          aria-label={`第 ${firstFrame + 1} 帧`}
                          aria-pressed={frameSelected}
                          className="character-swap-frame-button"
                          data-testid={`character-swap-frame-${firstFrame}`}
                          key={frame.ordinal}
                          onClick={() =>
                            setPending({
                              kind: 'fla-graphic',
                              animationId: selectedGraphicDef.id,
                              firstFrame,
                            })
                          }
                          type="button"
                        >
                          <GraphicFacePreview label={`第 ${firstFrame + 1} 帧`} source={frameSource} />
                          <span>{firstFrame + 1}</span>
                        </button>
                      );
                    })}
                  </div>
                  {framePageCount > 1 ? (
                    <div className="character-swap-frames-pagination">
                      <button
                        disabled={safeFramePage === 0}
                        onClick={() => setFramePage((p) => Math.max(0, p - 1))}
                        type="button"
                      >
                        上一页
                      </button>
                      <span>
                        {safeFramePage + 1} / {framePageCount}
                      </span>
                      <button
                        disabled={safeFramePage + 1 >= framePageCount}
                        onClick={() => setFramePage((p) => Math.min(framePageCount - 1, p + 1))}
                        type="button"
                      >
                        下一页
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="character-swap-footer">
          <span className="character-swap-summary" title={summaryText}>
            当前：{summaryText}
          </span>
          <div className="character-swap-actions">
            <Button data-testid="character-swap-cancel" onClick={handleClose} variant="secondary">
              取消
            </Button>
            <Button
              data-testid="character-swap-confirm"
              disabled={!canConfirm}
              onClick={handleConfirm}
              variant="primary"
            >
              确认替换
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
