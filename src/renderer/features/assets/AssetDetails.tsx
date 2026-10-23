import { useEffect, useRef, useState } from 'react';
import { ZodError } from 'zod';
import type { Asset, ImageAssetAuthorMetadata } from '../../../domain';
import {
  ChevronRight,
  Ellipsis,
  Image,
  ImageOff,
  Music2,
  X,
} from 'lucide-react';
import { DecorativeIcon } from '../../ui';
import {
  formatAssetDuration,
  type ThumbnailState,
} from './AssetCard';
import {
  audioMetadataError,
  audioMetadataState,
} from './assetMetadataState';
import { IMAGE_ASSET_USAGE_OPTIONS } from './assetUsage';

export interface AssetDetailsProps {
  asset: Asset | null;
  references: readonly { label: string; path: string }[];
  busy: boolean;
  onDelete: () => void;
  thumbnail?: ThumbnailState;
  presentation?: 'default' | 'portrait' | 'landscape';
  metadataError?: string;
  onRefreshMetadata?: () => void;
  onRequestClose?: () => void;
  onCancelEdit?: () => void;
  onDraftChange?: (assetId: string, dirty: boolean) => void;
  onSaveImageMetadata?: (
    assetId: string,
    metadata: ImageAssetAuthorMetadata,
  ) => ImageAssetAuthorMetadata | void;
}

type ImageMetadataField = 'name' | 'usage' | 'keywords';

type ImageMetadataFieldErrors = Partial<
  Record<ImageMetadataField, string>
>;

interface ImageMetadataBaseline {
  assetId: string;
  values: ImageAssetAuthorMetadata;
}

function dimensions(asset: Asset): string {
  if (asset.kind === 'image') {
    return `${asset.width} × ${asset.height} px`;
  }
  return formatAssetDuration(asset.durationMs);
}

function preview(
  asset: Asset,
  thumbnail: ThumbnailState | undefined,
  onPreview: () => void,
  previewButtonRef: React.RefObject<HTMLButtonElement | null>,
): React.JSX.Element {
  if (asset.kind === 'audio') {
    return (
      <div className="asset-details-preview-audio">
        <DecorativeIcon
          className="asset-details-preview-icon"
          icon={Music2}
          size={26}
        />
      </div>
    );
  }

  const status = thumbnail?.status ?? 'loading';
  if (thumbnail?.status === 'ready') {
    return (
      <button
        aria-haspopup="dialog"
        aria-label="放大查看图片预览"
        className="asset-details-thumbnail-button"
        data-testid="asset-details-thumbnail"
        onClick={onPreview}
        ref={previewButtonRef}
        type="button"
      >
        <img alt="" src={thumbnail.dataUrl} />
      </button>
    );
  }

  return (
    <div
      className="asset-details-preview-placeholder"
      data-thumbnail-status={status}
      role={
        thumbnail?.status === 'missing' && thumbnail.reason === 'error'
          ? 'alert'
          : undefined
      }
    >
      <DecorativeIcon
        className="asset-details-preview-icon"
        icon={status === 'missing' ? ImageOff : Image}
        size={24}
      />
      <span>
        {status === 'loading'
          ? '加载缩略图'
          : thumbnail?.status === 'missing' && thumbnail.reason === 'source'
            ? '无法预览'
            : thumbnail?.status === 'missing' && thumbnail.reason === 'error'
              ? thumbnail.message ?? '无法读取缩略图'
              : '缩略图缺失'}
      </span>
    </div>
  );
}

export function AssetDetails({
  asset,
  references,
  busy,
  onDelete,
  thumbnail,
  presentation = 'default',
  metadataError,
  onRefreshMetadata,
  onRequestClose,
  onCancelEdit,
  onDraftChange,
  onSaveImageMetadata,
}: AssetDetailsProps): React.JSX.Element {
  const [imageNameDraft, setImageNameDraft] = useState(
    asset?.kind === 'image' ? asset.name : '',
  );
  const [imageUsageDraft, setImageUsageDraft] = useState<
    NonNullable<Extract<Asset, { kind: 'image' }>['usage']>
  >(asset?.kind === 'image' ? asset.usage : 'uncategorized');
  const [keywordsDraft, setKeywordsDraft] = useState(
    asset?.kind === 'image' ? asset.keywords.join(', ') : '',
  );
  const [fieldErrors, setFieldErrors] = useState<ImageMetadataFieldErrors>({});
  const [formError, setFormError] = useState('');
  const [metadataConflict, setMetadataConflict] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const metadataBaseline = useRef<ImageMetadataBaseline | null>(
    asset?.kind === 'image'
      ? {
          assetId: asset.id,
          values: {
            name: asset.name,
            usage: asset.usage,
            keywords: asset.keywords,
          },
        }
      : null,
  );
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previewCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasPreviewOpenRef = useRef(false);

  const imageDraftIsDirty =
    asset?.kind === 'image' &&
    (imageNameDraft !== asset.name ||
      imageUsageDraft !== asset.usage ||
      keywordsDraft !== asset.keywords.join(', '));

  useEffect(() => {
    if (asset?.kind === 'image') {
      setImageNameDraft(asset.name);
      setImageUsageDraft(asset.usage);
      setKeywordsDraft(asset.keywords.join(', '));
    } else {
      setImageNameDraft('');
      setImageUsageDraft('uncategorized');
      setKeywordsDraft('');
    }
    setFieldErrors({});
    setFormError('');
    setMetadataConflict(false);
    setPreviewOpen(false);
    setMoreOpen(false);
  }, [asset?.id]);

  useEffect(() => {
    if (asset?.kind !== 'image') {
      metadataBaseline.current = null;
      setMetadataConflict(false);
      return;
    }

    const nextValues: ImageAssetAuthorMetadata = {
      name: asset.name,
      usage: asset.usage,
      keywords: asset.keywords,
    };
    const previous = metadataBaseline.current;
    if (!previous || previous.assetId !== asset.id) {
      metadataBaseline.current = { assetId: asset.id, values: nextValues };
      return;
    }

    const metadataChanged =
      previous.values.name !== nextValues.name ||
      previous.values.usage !== nextValues.usage ||
      previous.values.keywords.join('\u0000') !==
        nextValues.keywords.join('\u0000');
    if (!metadataChanged) return;

    const draftMatchesPrevious =
      imageNameDraft === previous.values.name &&
      imageUsageDraft === previous.values.usage &&
      keywordsDraft === previous.values.keywords.join(', ');
    metadataBaseline.current = { assetId: asset.id, values: nextValues };

    if (draftMatchesPrevious) {
      setImageNameDraft(nextValues.name);
      setImageUsageDraft(nextValues.usage);
      setKeywordsDraft(nextValues.keywords.join(', '));
      setMetadataConflict(false);
    } else {
      setMetadataConflict(true);
    }
  }, [
    asset?.id,
    asset?.kind,
    asset?.kind === 'image' ? asset.name : undefined,
    asset?.kind === 'image' ? asset.usage : undefined,
    asset?.kind === 'image' ? asset.keywords : undefined,
    imageNameDraft,
    imageUsageDraft,
    keywordsDraft,
  ]);

  useEffect(() => {
    if (metadataConflict && !imageDraftIsDirty) {
      setMetadataConflict(false);
    }
  }, [imageDraftIsDirty, metadataConflict]);

  useEffect(() => {
    if (asset?.kind === 'image') {
      onDraftChange?.(asset.id, imageDraftIsDirty);
    }
  }, [asset?.id, asset?.kind, imageDraftIsDirty, onDraftChange]);

  useEffect(() => {
    if (previewOpen) {
      previewCloseButtonRef.current?.focus();
    } else if (wasPreviewOpenRef.current) {
      previewTriggerRef.current?.focus();
    }
    wasPreviewOpenRef.current = previewOpen;
  }, [previewOpen]);

  if (!asset) {
    return (
      <aside className="asset-details asset-details-empty">
        <strong>素材详情</strong>
        <p>选择一个素材即可查看或编辑。</p>
      </aside>
    );
  }

  const sourceStatus =
    asset.kind === 'audio'
      ? 'unknown'
      : thumbnail?.status === 'missing' && thumbnail.reason === 'source'
        ? 'missing'
        : thumbnail?.status === 'ready' ||
            (thumbnail?.status === 'missing' &&
              thumbnail.reason === 'cache')
          ? 'present'
          : 'checking';
  const metadataState = audioMetadataState(asset, metadataError);
  const metadataErrorMessage = audioMetadataError(asset, metadataError);
  const isImageEditable = asset.kind === 'image' && Boolean(onSaveImageMetadata);
  const closePreview = (): void => setPreviewOpen(false);
  const saveImageMetadata = (
    event: React.FormEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    if (asset.kind !== 'image' || !onSaveImageMetadata) return;
    setFieldErrors({});
    setFormError('');
    try {
      const saved = onSaveImageMetadata(asset.id, {
        name: imageNameDraft,
        usage: imageUsageDraft,
        keywords: keywordsDraft.split(/[,，\n]/u),
      });
      if (saved) {
        metadataBaseline.current = { assetId: asset.id, values: saved };
        setImageNameDraft(saved.name);
        setImageUsageDraft(saved.usage);
        setKeywordsDraft(saved.keywords.join(', '));
        setMetadataConflict(false);
      }
    } catch (error) {
      if (error instanceof ZodError) {
        const nextFieldErrors: ImageMetadataFieldErrors = {};
        for (const issue of error.issues) {
          const field = issue.path[0];
          if (field === 'name') {
            nextFieldErrors.name = '名称须为 1 到 200 个字符。';
          } else if (field === 'keywords') {
            nextFieldErrors.keywords = '关键词最多 8 个，每个不超过 32 个字符。';
          } else if (field === 'usage') {
            nextFieldErrors.usage = '请选择有效用途。';
          }
        }
        setFieldErrors(nextFieldErrors);
        if (Object.keys(nextFieldErrors).length === 0) {
          setFormError('素材信息无效，请检查后重试。');
        }
        return;
      }
      setFormError(
        error instanceof Error ? error.message : '素材信息更新失败。',
      );
    }
  };
  const cancelImageMetadata = (): void => {
    setImageNameDraft(asset.kind === 'image' ? asset.name : '');
    setImageUsageDraft(asset.kind === 'image' ? asset.usage : 'uncategorized');
    setKeywordsDraft(asset.kind === 'image' ? asset.keywords.join(', ') : '');
    if (asset.kind === 'image') {
      metadataBaseline.current = {
        assetId: asset.id,
        values: {
          name: asset.name,
          usage: asset.usage,
          keywords: asset.keywords,
        },
      };
    }
    setMetadataConflict(false);
    setFieldErrors({});
    setFormError('');
    onCancelEdit?.();
  };
  const showPreview = (): void => {
    if (asset.kind === 'image' && thumbnail?.status === 'ready') {
      setPreviewOpen(true);
    }
  };
  const updateDraftField = (
    field: ImageMetadataField,
    value: string,
  ): void => {
    if (field === 'name') setImageNameDraft(value);
    if (field === 'usage') {
      setImageUsageDraft(
        value as NonNullable<Extract<Asset, { kind: 'image' }>['usage']>,
      );
    }
    if (field === 'keywords') setKeywordsDraft(value);
    setFieldErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError('');
  };

  return (
    <aside
      className={`asset-details asset-details-compact${presentation === 'portrait' ? ' asset-details-portrait' : ''}${presentation === 'landscape' ? ' asset-details-landscape' : ''}`}
      data-testid="asset-details"
    >
      <header className="asset-details-header">
        <h2 id="asset-details-title">
          {asset.kind === 'image' ? '编辑素材' : '素材信息'}
        </h2>
        <div className="asset-details-header-actions">
          <details
            className="asset-details-more"
            onToggle={(event) => setMoreOpen(event.currentTarget.open)}
            open={moreOpen}
          >
            <summary aria-label="更多素材操作" title="更多素材操作">
              <DecorativeIcon icon={Ellipsis} size={20} />
            </summary>
            <div className="asset-details-more-menu">
              <button
                className="asset-details-delete-action"
                disabled={busy}
                onClick={onDelete}
                type="button"
              >
                {busy ? '正在删除…' : '删除素材'}
              </button>
            </div>
          </details>
          {onRequestClose ? (
            <button
              aria-label="关闭素材详情"
              className="asset-details-close"
              data-testid="asset-details-close"
              onClick={onRequestClose}
              type="button"
            >
              <DecorativeIcon icon={X} size={18} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="asset-details-summary">
        <div className="asset-details-preview">
          {preview(asset, thumbnail, showPreview, previewTriggerRef)}
        </div>
        <div className="asset-details-summary-copy">
          <span>{asset.kind === 'image' ? '图片素材' : '音频素材'}</span>
          <span>{dimensions(asset)}</span>
          {asset.kind === 'audio' ? (
            <strong title={asset.name}>{asset.name}</strong>
          ) : null}
        </div>
      </div>

      {asset.kind === 'image' && isImageEditable ? (
        <form
          className="asset-author-metadata-form"
          data-testid="asset-author-metadata-form"
          noValidate
          onSubmit={saveImageMetadata}
        >
          <label data-testid="asset-author-name">
            名称
            <input
              autoFocus
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'asset-name-error' : undefined}
              maxLength={200}
              onChange={(event) => updateDraftField('name', event.target.value)}
              required
              value={imageNameDraft}
            />
            {fieldErrors.name ? (
              <small className="asset-metadata-field-error" id="asset-name-error" role="alert">
                {fieldErrors.name}
              </small>
            ) : null}
          </label>
          <label data-testid="asset-author-usage">
            用途
            <select
              aria-invalid={Boolean(fieldErrors.usage)}
              aria-describedby={fieldErrors.usage ? 'asset-usage-error' : undefined}
              onChange={(event) => updateDraftField('usage', event.target.value)}
              value={imageUsageDraft}
            >
              {IMAGE_ASSET_USAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {fieldErrors.usage ? (
              <small className="asset-metadata-field-error" id="asset-usage-error" role="alert">
                {fieldErrors.usage}
              </small>
            ) : null}
          </label>
          <label data-testid="asset-author-keywords">
            关键词
            <input
              aria-invalid={Boolean(fieldErrors.keywords)}
              aria-describedby={fieldErrors.keywords ? 'asset-keywords-error' : undefined}
              onChange={(event) => updateDraftField('keywords', event.target.value)}
              placeholder="添加关键词"
              value={keywordsDraft}
            />
            {fieldErrors.keywords ? (
              <small className="asset-metadata-field-error" id="asset-keywords-error" role="alert">
                {fieldErrors.keywords}
              </small>
            ) : null}
          </label>
          {formError ? (
            <p className="asset-metadata-form-error" role="alert">
              {formError}
            </p>
          ) : null}
          {metadataConflict ? (
            <p className="asset-metadata-form-error" data-testid="asset-metadata-conflict" role="alert">
              工程中的素材信息已改变。未保存的输入已保留；再次保存会覆盖当前值。
            </p>
          ) : null}
          <div className="asset-author-metadata-actions">
            <button
              className="asset-metadata-cancel"
              disabled={busy}
              onClick={cancelImageMetadata}
              type="button"
            >
              取消
            </button>
            <button className="asset-metadata-save" disabled={busy} type="submit">
              {busy ? '正在保存…' : '保存'}
            </button>
          </div>
        </form>
      ) : asset.kind === 'image' ? (
        <strong className="asset-details-readonly-name">{asset.name}</strong>
      ) : null}

      {metadataState ? (
        <div className="asset-details-audio-status">
          <span>音频分析</span>
          <span
            data-audio-metadata-status={metadataState}
            role={metadataState === 'error' ? 'alert' : undefined}
          >
            {metadataState === 'ready'
              ? '可用'
              : metadataState === 'error'
                ? metadataErrorMessage ?? '无法读取配音'
                : '正在准备…'}
          </span>
          {metadataState === 'error' && onRefreshMetadata ? (
            <button
              className="asset-details-retry"
              disabled={busy}
              onClick={onRefreshMetadata}
              type="button"
            >
              重试
            </button>
          ) : null}
        </div>
      ) : null}

      {asset.kind === 'image' && sourceStatus === 'missing' ? (
        <p className="asset-details-source-error" role="alert">
          源文件缺失，无法读取或重建缩略图。
        </p>
      ) : null}

      <div className="asset-details-disclosures">
        {references.length > 0 ? (
          <details className="asset-details-disclosure">
            <summary>
              <span>被 {references.length} 处使用</span>
              <DecorativeIcon
                className="asset-details-disclosure-chevron"
                icon={ChevronRight}
                size={16}
              />
            </summary>
            <ul className="asset-details-reference-list">
              {references.map((reference) => (
                <li key={reference.path}>
                  <span>{reference.label}</span>
                  <code>{reference.path}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="asset-details-unreferenced">当前未被项目使用</p>
        )}
        <details className="asset-details-disclosure">
          <summary>
            <span>详细信息</span>
            <DecorativeIcon
              className="asset-details-disclosure-chevron"
              icon={ChevronRight}
              size={16}
            />
          </summary>
          <dl
            data-testid={
              asset.kind === 'image' && asset.flaSnapshot
                ? 'asset-fla-snapshot-origin'
                : undefined
            }
            className="asset-details-technical-list"
          >
            <div>
              <dt>项目内路径</dt>
              <dd>{asset.relativePath}</dd>
            </div>
            <div>
              <dt>路径状态</dt>
              <dd>
                {sourceStatus === 'missing'
                  ? '源文件缺失'
                  : sourceStatus === 'present'
                    ? '源文件存在'
                    : asset.kind === 'audio'
                      ? '尚未读取源文件状态'
                      : '正在检查源文件'}
              </dd>
            </div>
            {asset.kind === 'image' && asset.flaSnapshot ? (
              <>
                <div>
                  <dt>来源 FLA</dt>
                  <dd>{asset.flaSnapshot.sourceBasename}</dd>
                </div>
                <div>
                  <dt>源元件</dt>
                  <dd>{asset.flaSnapshot.sourceLibraryItemName ?? asset.flaSnapshot.targetName}</dd>
                </div>
                <div>
                  <dt>源帧</dt>
                  <dd>{asset.flaSnapshot.selectedFrameIndex + 1}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </details>
      </div>

      {previewOpen && asset.kind === 'image' && thumbnail?.status === 'ready' ? (
        <div
          className="asset-thumbnail-preview-overlay"
          data-testid="asset-thumbnail-preview-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closePreview();
            } else if (event.key === 'Tab') {
              event.preventDefault();
              previewCloseButtonRef.current?.focus();
            }
          }}
          role="presentation"
        >
          <div
            aria-label="图片预览"
            aria-modal="true"
            className="asset-thumbnail-preview-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button
              aria-label="关闭图片预览"
              className="asset-thumbnail-preview-close"
              onClick={closePreview}
              ref={previewCloseButtonRef}
              type="button"
            >
              <DecorativeIcon icon={X} size={18} />
            </button>
            <img alt={asset.name} src={thumbnail.dataUrl} />
          </div>
        </div>
      ) : null}
    </aside>
  );
}
