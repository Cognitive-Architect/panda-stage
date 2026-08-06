import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  scanAssetReferences,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import {
  ASSET_LIBRARY_CATEGORIES,
  assetCategoryCounts,
  selectAssetLibraryEntries,
  type AssetLibraryCategory,
} from '../../stores/assetLibrarySelectors';
import { applyAssetDeleteResponse } from './applyAssetDeleteResponse';
import { applyAssetMetadataResponse } from './applyAssetMetadataResponse';
import { ASSET_DRAG_MIME } from './AssetDropPayload';
import { AssetDetails } from './AssetDetails';
import { AssetGrid } from './AssetGrid';
import type { ThumbnailState } from './AssetCard';
import { AssetImportPanel } from './AssetImportPanel';

export type AssetWorkspaceView = 'browser' | 'details';

export interface AssetLibraryProps {
  snapshot: EditorProjectSnapshot | null;
  view?: AssetWorkspaceView;
  onViewChange?: (view: AssetWorkspaceView) => void;
  importRequestToken?: number;
}

export function AssetLibrary({
  snapshot,
  view = 'browser',
  onViewChange = () => undefined,
  importRequestToken,
}: AssetLibraryProps): React.JSX.Element {
  const [category, setCategory] =
    useState<AssetLibraryCategory>('background');
  const [selectedAssetId, setSelectedAssetId] =
    useState<string | null>(null);
  const [draggingAssetId, setDraggingAssetId] =
    useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    '打开项目后即可分类浏览、拖动和安全删除素材。',
  );
  const [authoritativeReferences, setAuthoritativeReferences] =
    useState<readonly { label: string; path: string }[]>([]);
  const [thumbnails, setThumbnails] = useState<
    Record<string, ThumbnailState>
  >({});

  const entries = useMemo(
    () =>
      snapshot
        ? selectAssetLibraryEntries(snapshot.project, category)
        : [],
    [category, snapshot],
  );
  const counts = useMemo(
    () =>
      snapshot
        ? assetCategoryCounts(snapshot.project)
        : { character: 0, background: 0, audio: 0 },
    [snapshot],
  );
  const selectedAsset = useMemo(
    () =>
      snapshot?.project.assets.find(
        (asset) => asset.id === selectedAssetId,
      ) ?? null,
    [selectedAssetId, snapshot],
  );
  const localReferences = useMemo(
    () =>
      snapshot && selectedAsset
        ? scanAssetReferences(snapshot.project, selectedAsset.id)
        : [],
    [selectedAsset, snapshot],
  );
  const references =
    authoritativeReferences.length > 0
      ? authoritativeReferences
      : localReferences;

  useEffect(() => {
    if (
      selectedAssetId &&
      !snapshot?.project.assets.some(
        (asset) => asset.id === selectedAssetId,
      )
    ) {
      setSelectedAssetId(null);
      setAuthoritativeReferences([]);
    }
  }, [selectedAssetId, snapshot]);

  useEffect(() => {
    let active = true;
    const imageEntries = entries.filter(
      (entry) => entry.asset.kind === 'image',
    );
    setThumbnails(
      Object.fromEntries(
        imageEntries.map(({ asset }) => [
          asset.id,
          asset.sha256
            ? { status: 'loading' as const }
            : { status: 'missing' as const },
        ]),
      ),
    );
    if (!snapshot) return () => {
      active = false;
    };
    for (const { asset } of imageEntries) {
      if (!asset.sha256) continue;
      void window.pandaStage.assets
        .readThumbnail({
          projectRoot: snapshot.projectRoot,
          assetId: asset.id,
          sha256: asset.sha256,
        })
        .then((response) => {
          if (!active) return;
          setThumbnails((current) => ({
            ...current,
            [asset.id]:
              response.ok && response.status === 'ready'
                ? {
                    status: 'ready',
                    dataUrl: response.dataUrl,
                  }
                : { status: 'missing' },
          }));
        })
        .catch(() => {
          if (!active) return;
          setThumbnails((current) => ({
            ...current,
            [asset.id]: { status: 'missing' },
          }));
        });
    }
    return () => {
      active = false;
    };
  }, [entries, snapshot]);

  const selectAsset = (assetId: string): void => {
    setSelectedAssetId(assetId);
    setAuthoritativeReferences([]);
    onViewChange('details');
  };

  const rebuildThumbnail = async (assetId: string): Promise<void> => {
    const current = editorProjectStore.getSnapshot();
    if (!current) return;
    setBusy(true);
    setStatus('正在重新读取素材并生成缩略图…');
    try {
      const response =
        await window.pandaStage.assets.refreshMetadata({
          projectRoot: current.projectRoot,
          project: current.project,
          baseRevision: current.revision,
          assetId,
          requestId: crypto.randomUUID(),
        });
      const outcome = applyAssetMetadataResponse(
        response,
        editorProjectStore,
      );
      setStatus(
        outcome.applied
          ? '缩略图已重新生成。'
          : outcome.status,
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '缩略图重建失败。',
      );
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async (): Promise<void> => {
    const current = editorProjectStore.getSnapshot();
    const asset = current?.project.assets.find(
      (candidate) => candidate.id === selectedAssetId,
    );
    if (!current || !asset) return;
    if (
      !window.confirm(
        `确认删除素材“${asset.name}”？Main Process 会再次检查全部项目引用。`,
      )
    ) {
      setStatus('已取消删除，项目没有发生变化。');
      return;
    }
    setBusy(true);
    setStatus('正在检查引用并执行一致性删除…');
    try {
      const response = await window.pandaStage.assets.delete({
        projectRoot: current.projectRoot,
        project: current.project,
        baseRevision: current.revision,
        assetId: asset.id,
      });
      const outcome = applyAssetDeleteResponse(
        response,
        editorProjectStore,
      );
      setAuthoritativeReferences(outcome.references);
      setStatus(outcome.status);
      if (outcome.applied) setSelectedAssetId(null);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '素材删除失败。',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={[
        'asset-library',
        dragOver ? 'asset-library-drag-over' : '',
      ].filter(Boolean).join(' ')}
      aria-labelledby="asset-library-heading"
      data-testid="asset-library"
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragOver(false);
        }
      }}
      onDragOver={(event) => {
        if (
          draggingAssetId ||
          Array.from(event.dataTransfer.types).includes(
            ASSET_DRAG_MIME,
          )
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragOver(true);
        }
      }}
      onDrop={(event) => {
        if (draggingAssetId) {
          event.preventDefault();
          setStatus(
            '素材拖动已结束；画布放置将在后续工单提供。',
          );
        }
        setDraggingAssetId(null);
        setDragOver(false);
      }}
    >
      <div className="asset-library-heading">
        <div>
          <p className="eyebrow">项目素材</p>
          <h2 id="asset-library-heading">项目素材库</h2>
        </div>
        <output>
          {snapshot
            ? `共 ${snapshot.project.assets.length} 项`
            : '尚未打开项目'}
        </output>
      </div>
      {view === 'browser' ? (
        <>
          <AssetImportPanel
            importRequestToken={importRequestToken}
            snapshot={snapshot}
          />
          <div
            className="asset-library-browser"
            data-testid="asset-browser-view"
          >
            <nav aria-label="素材分类" className="asset-category-tabs">
              {ASSET_LIBRARY_CATEGORIES.map((item) => (
                <button
                  aria-pressed={category === item.id}
                  className={
                    category === item.id
                      ? 'asset-category-active'
                      : ''
                  }
                  key={item.id}
                  onClick={() => {
                    setCategory(item.id);
                    setSelectedAssetId(null);
                    setAuthoritativeReferences([]);
                  }}
                  type="button"
                >
                  <span>{item.label}</span>
                  <strong>{counts[item.id]}</strong>
                </button>
              ))}
            </nav>
            <div className="asset-library-content">
              <AssetGrid
                draggingAssetId={draggingAssetId}
                entries={entries}
                onDragEnd={() => {
                  setDraggingAssetId(null);
                  setDragOver(false);
                  setStatus('素材拖动已结束。');
                }}
                onDragStart={(assetId) => {
                  setDraggingAssetId(assetId);
                  setStatus(
                    '正在拖动素材；载荷仅包含受控身份 ID 和枚举类型。',
                  );
                }}
                onRebuildThumbnail={(assetId) =>
                  void rebuildThumbnail(assetId)
                }
                onSelect={selectAsset}
                onThumbnailError={(assetId) => {
                  setThumbnails((current) =>
                    current[assetId]?.status === 'missing'
                      ? current
                      : {
                          ...current,
                          [assetId]: { status: 'missing' },
                        },
                  );
                }}
                selectedAssetId={selectedAssetId}
                thumbnails={thumbnails}
              />
            </div>
          </div>
        </>
      ) : (
        <section
          aria-labelledby="asset-details-view-heading"
          className="asset-details-view"
          data-testid="asset-details-view"
        >
          <div className="asset-details-view-heading">
            <div>
              <p className="eyebrow">素材浏览</p>
              <h3 id="asset-details-view-heading">素材详情</h3>
            </div>
            <button
              data-testid="asset-details-back"
              onClick={() => onViewChange('browser')}
              type="button"
            >
              返回素材库
            </button>
          </div>
          <AssetDetails
            asset={selectedAsset}
            busy={busy}
            onDelete={() => void deleteSelected()}
            references={references}
          />
        </section>
      )}
      <output className="asset-library-status">{status}</output>
    </section>
  );
}
