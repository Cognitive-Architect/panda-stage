import type {
  AssetLibraryEntry,
} from '../../stores/assetLibrarySelectors';
import {
  AssetCard,
  type ThumbnailState,
} from './AssetCard';

export interface AssetGridProps {
  entries: readonly AssetLibraryEntry[];
  selectedAssetId: string | null;
  draggingAssetId: string | null;
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  onSelect: (assetId: string) => void;
  onDragStart: (assetId: string) => void;
  onDragEnd: () => void;
  onRebuildThumbnail: (assetId: string) => void;
  onThumbnailError: (assetId: string) => void;
  emptyMessage?: string;
}

export function AssetGrid({
  entries,
  selectedAssetId,
  draggingAssetId,
  thumbnails,
  onSelect,
  onDragStart,
  onDragEnd,
  onRebuildThumbnail,
  onThumbnailError,
  emptyMessage,
}: AssetGridProps): React.JSX.Element {
  if (entries.length === 0) {
    return (
      <div className="asset-library-empty">
        <span aria-hidden="true">＋</span>
        <strong>{emptyMessage ?? '这个分类还没有素材'}</strong>
        <p>
          {emptyMessage
            ? '清除搜索或换一个分类试试。'
            : '使用上方导入入口选择文件，或直接拖入 PNG、JPG、MP3、WAV。'}
        </p>
      </div>
    );
  }
  return (
    <div
      aria-label="素材缩略图网格"
      className="asset-grid"
      data-grid-count={entries.length}
    >
      {entries.map((entry) => (
        <AssetCard
          asset={entry.asset}
          category={entry.category}
          contextLabel={entry.contextLabel}
          dragging={draggingAssetId === entry.asset.id}
          dropPayload={entry.dropPayload}
          key={entry.id}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          onRebuildThumbnail={onRebuildThumbnail}
          onSelect={onSelect}
          onThumbnailError={onThumbnailError}
          selected={selectedAssetId === entry.asset.id}
          thumbnail={
            thumbnails[entry.asset.id] ?? { status: 'loading' }
          }
        />
      ))}
    </div>
  );
}
