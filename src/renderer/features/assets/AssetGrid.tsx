import type {
  AssetLibraryItem,
} from '../../stores/assetLibrarySelectors';
import type { Project } from '../../../domain';
import {
  AssetCard,
  type ThumbnailState,
} from './AssetCard';
import { AnimationLibraryCard } from './AnimationLibraryPanel';

export interface AssetGridProps {
  items: readonly AssetLibraryItem[];
  project: Project;
  projectRoot: string;
  selectedAssetId: string | null;
  draggingAssetId: string | null;
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  onSelect: (assetId: string) => void;
  onDragStart: (assetId: string) => void;
  onDragEnd: () => void;
  onRebuildThumbnail: (assetId: string) => void;
  onThumbnailError: (assetId: string) => void;
  emptyMessage?: string;
  emptyDescription?: string;
  metadataErrors?: Readonly<Record<string, string>>;
  display?: 'grid' | 'list';
  selectedItemId?: string | null;
  onItemSelect?(item: AssetLibraryItem): void;
  onItemActivate?(item: AssetLibraryItem): void;
  onItemContext?(item: AssetLibraryItem): void;
}

export function AssetGrid({
  items,
  project,
  projectRoot,
  selectedAssetId,
  draggingAssetId,
  thumbnails,
  onSelect,
  onDragStart,
  onDragEnd,
  onRebuildThumbnail,
  onThumbnailError,
  emptyMessage,
  emptyDescription,
  metadataErrors,
  display,
  selectedItemId,
  onItemSelect,
  onItemActivate,
  onItemContext,
}: AssetGridProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div className="asset-library-empty">
        {display ? <strong>{emptyMessage ?? '没有素材'}</strong> : <>

        <span aria-hidden="true">＋</span>
        <strong>{emptyMessage ?? '这个分类还没有素材'}</strong>
        <p>
          {emptyDescription ??
            (emptyMessage
              ? '清除搜索或换一个分类试试。'
              : '使用上方导入入口选择文件，或直接拖入 PNG、JPG、MP3、WAV。')}
        </p>
        </>}
      </div>
    );
  }
  return (
    <div
      aria-label="素材缩略图网格"
      className="asset-grid"
      data-display={display}
      data-grid-count={items.length}
    >
      {items.map((item) => item.kind === 'animation' ? (
        <AnimationLibraryCard
          animation={item.animation}
          key={item.id}
          project={project}
          projectRoot={projectRoot}
          selected={selectedItemId === item.id}
          onSelect={onItemSelect ? () => onItemSelect(item) : undefined}
          onActivate={onItemActivate ? () => onItemActivate(item) : undefined}
          onContext={onItemContext ? () => onItemContext(item) : undefined}
        />
      ) : (
        <AssetCard
          asset={item.entry.asset}
          category={item.entry.category}
          contextLabel={item.entry.contextLabel}
          dragging={draggingAssetId === item.entry.asset.id}
          dropPayload={item.entry.dropPayload}
          key={item.id}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          onRebuildThumbnail={onRebuildThumbnail}
          onSelect={onItemSelect ? () => onItemSelect(item) : onSelect}
          onActivate={onItemActivate ? () => onItemActivate(item) : undefined}
          onContext={onItemContext ? () => onItemContext(item) : undefined}
          onThumbnailError={onThumbnailError}
          metadataError={metadataErrors?.[item.entry.asset.id]}
          selected={onItemSelect ? selectedItemId === item.id : selectedAssetId === item.entry.asset.id}
          thumbnail={thumbnails[item.entry.asset.id] ?? { status: 'loading' }}
        />
      ))}
    </div>
  );
}
