import type { Asset } from '../../../domain';
import { Image, ImageOff, Music2 } from 'lucide-react';
import { DecorativeIcon } from '../../ui';
import {
  formatAssetDuration,
  type ThumbnailState,
} from './AssetCard';

export interface AssetDetailsProps {
  asset: Asset | null;
  references: readonly { label: string; path: string }[];
  busy: boolean;
  onDelete: () => void;
  thumbnail?: ThumbnailState;
  presentation?: 'default' | 'portrait';
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
}: AssetDetailsProps): React.JSX.Element {
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
  return (
    <aside
      className={`asset-details${presentation === 'portrait' ? ' asset-details-portrait' : ''}`}
    >
      {preview(asset, thumbnail)}
      <div className="asset-details-heading">
        <p className="eyebrow">已选素材</p>
        <h3>{asset.name}</h3>
      </div>
      <dl>
        <div>
          <dt>类型</dt>
          <dd>{asset.kind === 'image' ? '图片' : '音频'}</dd>
        </div>
        <div>
          <dt>尺寸 / 时长</dt>
          <dd>{dimensions(asset)}</dd>
        </div>
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
