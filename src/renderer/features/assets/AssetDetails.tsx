import { useEffect, useState } from 'react';
import { ZodError } from 'zod';
import type { Asset } from '../../../domain';
import type {
  ImageAssetAuthorMetadata,
} from '../../../domain';
import { Image, ImageOff, Music2 } from 'lucide-react';
import { DecorativeIcon } from '../../ui';
import {
  formatAssetDuration,
  type ThumbnailState,
} from './AssetCard';
import {
  audioMetadataError,
  audioMetadataState,
} from './assetMetadataState';
import {
  IMAGE_ASSET_USAGE_OPTIONS,
  imageAssetUsageLabel,
} from './assetUsage';

export interface AssetDetailsProps {
  asset: Asset | null;
  references: readonly { label: string; path: string }[];
  busy: boolean;
  onDelete: () => void;
  thumbnail?: ThumbnailState;
  presentation?: 'default' | 'portrait';
  metadataError?: string;
  onRefreshMetadata?: () => void;
  onSaveImageMetadata?: (
    assetId: string,
    metadata: ImageAssetAuthorMetadata,
  ) => void;
}

function dimensions(asset: Asset): string {
  if (asset.kind === 'image') {
    return `${asset.width} × ${asset.height} px`;
  }
  return formatAssetDuration(asset.durationMs);
}

function preview(asset: Asset, thumbnail?: ThumbnailState): React.JSX.Element {
  if (asset.kind === 'audio') {
    return (
      <div className="asset-details-preview asset-details-preview-audio">
        <DecorativeIcon
          className="asset-details-preview-icon"
          icon={Music2}
          size={30}
        />
        <span>音频素材</span>
      </div>
    );
  }

  const status = thumbnail?.status ?? 'loading';
  if (thumbnail?.status === 'ready') {
    return (
      <div className="asset-details-preview">
        <img alt="" src={thumbnail.dataUrl} />
      </div>
    );
  }

  return (
    <div
      className="asset-details-preview asset-details-preview-placeholder"
      data-thumbnail-status={status}
    >
      <DecorativeIcon
        className="asset-details-preview-icon"
        icon={status === 'missing' ? ImageOff : Image}
        size={28}
      />
      <span>
        {status === 'loading'
          ? '加载缩略图'
          : thumbnail?.status === 'missing' && thumbnail.reason === 'source'
            ? '源文件缺失'
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
  onSaveImageMetadata,
}: AssetDetailsProps): React.JSX.Element {
  const [editingImageMetadata, setEditingImageMetadata] = useState(false);
  const [imageNameDraft, setImageNameDraft] = useState('');
  const [imageUsageDraft, setImageUsageDraft] = useState<
    NonNullable<Extract<Asset, { kind: 'image' }>['usage']>
  >('uncategorized');
  const [keywordsDraft, setKeywordsDraft] = useState('');
  const [imageMetadataError, setImageMetadataError] = useState('');

  useEffect(() => {
    setEditingImageMetadata(false);
    setImageMetadataError('');
  }, [asset?.id]);

  if (!asset) {
    return (
      <aside className="asset-details asset-details-empty">
        <strong>素材详情</strong>
        <p>选择一个素材，查看尺寸、时长、项目内路径和引用位置。</p>
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
  const beginImageMetadataEdit = (): void => {
    if (asset.kind !== 'image') return;
    setImageNameDraft(asset.name);
    setImageUsageDraft(asset.usage);
    setKeywordsDraft(asset.keywords.join(', '));
    setImageMetadataError('');
    setEditingImageMetadata(true);
  };
  const cancelImageMetadataEdit = (): void => {
    setEditingImageMetadata(false);
    setImageMetadataError('');
  };
  const saveImageMetadata = (
    event: React.FormEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    if (asset.kind !== 'image' || !onSaveImageMetadata) return;
    try {
      onSaveImageMetadata(asset.id, {
        name: imageNameDraft,
        usage: imageUsageDraft,
        keywords: keywordsDraft.split(/[,，\n]/u),
      });
      setEditingImageMetadata(false);
      setImageMetadataError('');
    } catch (error) {
      if (error instanceof ZodError) {
        const fields = new Set(error.issues.map((issue) => issue.path[0]));
        setImageMetadataError(
          fields.has('name')
            ? '名称须为 1 到 200 个字符。'
            : fields.has('keywords')
              ? '关键词最多 8 个，每个不超过 32 个字符。'
              : '用途无效，请重新选择。',
        );
        return;
      }
      setImageMetadataError(
        error instanceof Error ? error.message : '素材信息更新失败。',
      );
    }
  };
  return (
    <aside
      className={`asset-details${presentation === 'portrait' ? ' asset-details-portrait' : ''}`}
    >
      {preview(asset, thumbnail)}
      <div className="asset-details-heading">
        <p className="eyebrow">已选素材</p>
        <h3>{asset.name}</h3>
      </div>
      <dl
        data-testid={
          asset.kind === 'image' && asset.flaSnapshot
            ? 'asset-fla-snapshot-origin'
            : undefined
        }
      >
        <div>
          <dt>类型</dt>
          <dd>{asset.kind === 'image' ? '图片' : '音频'}</dd>
        </div>
        <div>
          <dt>尺寸 / 时长</dt>
          <dd>{dimensions(asset)}</dd>
        </div>
        {asset.kind === 'image' ? (
          <>
            <div data-testid="asset-author-usage">
              <dt>用途</dt>
              <dd>{imageAssetUsageLabel(asset.usage)}</dd>
            </div>
            <div data-testid="asset-author-keywords">
              <dt>关键词</dt>
              <dd>{asset.keywords.length > 0 ? asset.keywords.join(' · ') : '无'}</dd>
            </div>
          </>
        ) : null}
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
        {metadataState ? (
          <div>
            <dt>音频分析</dt>
            <dd data-audio-metadata-status={metadataState}>
              {metadataState === 'ready'
                ? '可用'
                : metadataState === 'error'
                  ? metadataErrorMessage ?? '无法读取配音'
                  : '正在准备…'}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>项目内路径</dt>
          <dd>{asset.relativePath}</dd>
        </div>
        <div>
          <dt>路径状态</dt>
          <dd>
            {sourceStatus === 'missing'
              ? '源文件缺失，无法读取或重建缩略图'
              : sourceStatus === 'present'
                ? '源文件存在'
                : asset.kind === 'audio'
                  ? '尚未读取源文件状态'
                  : '正在检查源文件'}
          </dd>
        </div>
      </dl>
      {asset.kind === 'image' && onSaveImageMetadata ? (
        editingImageMetadata ? (
          <form
            className="asset-author-metadata-form"
            data-testid="asset-author-metadata-form"
            onSubmit={saveImageMetadata}
          >
            <label>
              名称
              <input
                autoFocus
                maxLength={200}
                onChange={(event) => setImageNameDraft(event.target.value)}
                required
                value={imageNameDraft}
              />
            </label>
            <label>
              用途
              <select
                onChange={(event) =>
                  setImageUsageDraft(
                    event.target.value as typeof imageUsageDraft,
                  )
                }
                value={imageUsageDraft}
              >
                {IMAGE_ASSET_USAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              关键词
              <input
                aria-describedby="asset-author-keywords-hint"
                onChange={(event) => setKeywordsDraft(event.target.value)}
                placeholder="门，关闭"
                value={keywordsDraft}
              />
            </label>
            <small id="asset-author-keywords-hint">
              用逗号分隔，最多 8 个词；重复词会合并。
            </small>
            {imageMetadataError ? (
              <p role="alert">{imageMetadataError}</p>
            ) : null}
            <div className="asset-author-metadata-actions">
              <button disabled={busy} type="submit">
                确认
              </button>
              <button onClick={cancelImageMetadataEdit} type="button">
                取消
              </button>
            </div>
          </form>
        ) : (
          <button
            className="asset-author-metadata-edit"
            disabled={busy}
            onClick={beginImageMetadataEdit}
            type="button"
          >
            编辑名称、用途和关键词
          </button>
        )
      ) : null}
      {metadataState === 'error' && onRefreshMetadata ? (
        <button disabled={busy} onClick={onRefreshMetadata} type="button">
          重试
        </button>
      ) : null}
      {references.length > 0 ? (
        <div className="asset-reference-warning" role="alert">
          <strong>正在被以下位置使用</strong>
          <ul>
            {references.map((reference) => (
              <li key={reference.path}>
                <span>{reference.label}</span>
                <code>{reference.path}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="asset-unreferenced">当前项目没有引用这个素材。</p>
      )}
      <button
        className="asset-delete-button"
        disabled={busy}
        onClick={onDelete}
        type="button"
      >
        {busy ? '正在删除…' : '删除未引用素材'}
      </button>
    </aside>
  );
}
