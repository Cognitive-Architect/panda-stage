import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import {
  scanAssetReferences,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import {
  ASSET_LIBRARY_CATEGORIES,
  ASSET_LIBRARY_FILTERS,
  assetLibraryFilterCounts,
  filterAssetLibraryEntries,
  selectAssetLibraryEntries,
  type AssetLibraryFilter,
} from '../../stores/assetLibrarySelectors';
import { applyAssetDeleteResponse } from './applyAssetDeleteResponse';
import { applyAssetMetadataResponse } from './applyAssetMetadataResponse';
import { ASSET_DRAG_MIME } from './AssetDropPayload';
import { AssetDetails } from './AssetDetails';
import { AssetGrid } from './AssetGrid';
import {
  thumbnailStateFromResponse,
  type ThumbnailState,
} from './AssetCard';
import { AssetImportPanel } from './AssetImportPanel';
import {
  assetLibraryPageCount,
  paginateAssetLibraryEntries,
} from './assetLibraryPagination';
import { applyFlaAssetCommitResponse } from './applyFlaAssetCommitResponse';
import { applyFlaFrameSequenceCommitResponse } from './applyFlaFrameSequenceCommitResponse';
import { applyFlaStaticSnapshotCommitResponse } from './applyFlaStaticSnapshotCommitResponse';
import { FlaCompatibilityReviewSession } from '../../fla-import/FlaCompatibilityReviewSession';
import { DecorativeIcon } from '../../ui';
import {
  FlaInspectionLifecycle,
  type FlaInspectionOperation,
} from '../../fla-import/fla-inspection-lifecycle';

export type AssetWorkspaceView = 'browser' | 'details';
export type AssetLibraryPresentation = 'default' | 'portrait' | 'landscape';

const DEFAULT_ASSET_LIBRARY_STATUS =
  '打开项目后即可分类浏览、拖动和安全删除素材。';

export interface AssetLibraryProps {
  snapshot: EditorProjectSnapshot | null;
  view?: AssetWorkspaceView;
  presentation?: AssetLibraryPresentation;
  onViewChange?: (view: AssetWorkspaceView) => void;
  importRequestToken?: number;
  flaReviewRequestToken?: number;
  closeRequestToken?: number;
  hideHeading?: boolean;
  showFlaAction?: boolean;
}

export function AssetLibrary({
  snapshot,
  view = 'browser',
  presentation,
  onViewChange = () => undefined,
  importRequestToken,
  flaReviewRequestToken,
  closeRequestToken,
  hideHeading = false,
  showFlaAction = true,
}: AssetLibraryProps): React.JSX.Element {
  const resolvedPresentation =
    presentation ?? (hideHeading ? 'portrait' : 'default');
  const [category, setCategory] = useState<AssetLibraryFilter>(() =>
    hideHeading ? 'all' : 'background',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedAssetId, setSelectedAssetId] =
    useState<string | null>(null);
  const [selectedDetailsOpen, setSelectedDetailsOpen] = useState(false);
  const [draggingAssetId, setDraggingAssetId] =
    useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    hideHeading ? '' : DEFAULT_ASSET_LIBRARY_STATUS,
  );
  const [authoritativeReferences, setAuthoritativeReferences] =
    useState<readonly { label: string; path: string }[]>([]);
  const [thumbnails, setThumbnails] = useState<
    Record<string, ThumbnailState>
  >({});
  const [flaReviewOpen, setFlaReviewOpen] = useState(false);
  const [flaInspection, setFlaInspection] =
    useState<FlaInspectionOperation | null>(null);
  const flaInspectionLifecycle = useRef<FlaInspectionLifecycle | null>(null);
  const detailsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastOpenedAssetId = useRef<string | null>(null);
  const pendingFocusReturnAssetId = useRef<string | null>(null);
  const lastCloseRequest = useRef(closeRequestToken ?? 0);
  const lastFlaReviewRequest = useRef(flaReviewRequestToken ?? 0);

  const closeFlaReview = useCallback((): void => {
    setFlaReviewOpen(false);
    setFlaInspection(null);
    void flaInspectionLifecycle.current?.cancel();
    setStatus('FLA review closed; Project and Asset state are unchanged.');
  }, []);

  useEffect(() => {
    if (
      closeRequestToken === undefined ||
      closeRequestToken === lastCloseRequest.current
    ) {
      return;
    }
    lastCloseRequest.current = closeRequestToken;
    closeFlaReview();
  }, [closeFlaReview, closeRequestToken]);

  useEffect(() => {
    return () => {
      void flaInspectionLifecycle.current?.cancel();
    };
  }, []);

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
        ? assetLibraryFilterCounts(snapshot.project)
        : { all: 0, character: 0, background: 0, audio: 0 },
    [snapshot],
  );
  const filterOptions = hideHeading
    ? ASSET_LIBRARY_FILTERS
    : ASSET_LIBRARY_CATEGORIES;
  const visibleEntries = useMemo(
    () => filterAssetLibraryEntries(entries, searchQuery),
    [entries, searchQuery],
  );
  const isPortraitBrowser = hideHeading && view === 'browser';
  const totalPages = isPortraitBrowser
    ? assetLibraryPageCount(visibleEntries.length)
    : 1;
  const currentPage = isPortraitBrowser
    ? Math.max(1, Math.min(page, totalPages))
    : 1;
  const pageEntries = useMemo(
    () =>
      isPortraitBrowser
        ? paginateAssetLibraryEntries(visibleEntries, currentPage)
        : visibleEntries,
    [currentPage, isPortraitBrowser, visibleEntries],
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

  const clearSelectedAsset = useCallback((): void => {
    pendingFocusReturnAssetId.current = null;
    setSelectedAssetId(null);
    setSelectedDetailsOpen(false);
    setAuthoritativeReferences([]);
  }, []);

  const closeSelectedDetails = useCallback(
    (returnFocus = true): void => {
      pendingFocusReturnAssetId.current = returnFocus
        ? lastOpenedAssetId.current ?? selectedAssetId
        : null;
      setSelectedDetailsOpen(false);
    },
    [selectedAssetId],
  );

  const focusAssetCard = useCallback((assetId: string): void => {
    if (typeof document === 'undefined') return;
    const library = document.querySelector<HTMLElement>(
      '[data-testid="asset-library"]',
    );
    const card = library
      ? Array.from(
          library.querySelectorAll<HTMLElement>('[data-asset-id]'),
        ).find((candidate) => candidate.dataset.assetId === assetId)
      : null;
    card?.focus({ preventScroll: true });
  }, []);

  const selectCategory = (nextCategory: AssetLibraryFilter): void => {
    setCategory(nextCategory);
    setPage(1);
    clearSelectedAsset();
  };

  const updateSearchQuery = (nextQuery: string): void => {
    setSearchQuery(nextQuery);
    setPage(1);
    clearSelectedAsset();
  };

  const goToPage = (requestedPage: number): void => {
    if (!isPortraitBrowser) return;
    const nextPage = Math.max(1, Math.min(requestedPage, totalPages));
    if (nextPage === currentPage) return;
    const nextEntries = paginateAssetLibraryEntries(
      visibleEntries,
      nextPage,
    );
    setPage(nextPage);
    closeSelectedDetails(false);
    if (
      selectedAssetId &&
      !nextEntries.some((entry) => entry.asset.id === selectedAssetId)
    ) {
      clearSelectedAsset();
    }
  };

  useEffect(() => {
    if (
      selectedAssetId &&
      !pageEntries.some((entry) => entry.asset.id === selectedAssetId)
    ) {
      setSelectedAssetId(null);
      setSelectedDetailsOpen(false);
      setAuthoritativeReferences([]);
    }
  }, [pageEntries, selectedAssetId]);

  useEffect(() => {
    if (page <= totalPages) return;
    setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!selectedDetailsOpen || !isPortraitBrowser) return;
    detailsCloseButtonRef.current?.focus();
  }, [isPortraitBrowser, selectedDetailsOpen]);

  useEffect(() => {
    if (!isPortraitBrowser || !selectedDetailsOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeSelectedDetails();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeSelectedDetails, isPortraitBrowser, selectedDetailsOpen]);

  useEffect(() => {
    if (selectedDetailsOpen || !pendingFocusReturnAssetId.current) return;
    const assetId = pendingFocusReturnAssetId.current;
    pendingFocusReturnAssetId.current = null;
    focusAssetCard(assetId);
  }, [focusAssetCard, selectedDetailsOpen]);

  useEffect(() => {
    let active = true;
    const imageEntries = entries.filter(
      (entry) => entry.asset.kind === 'image',
    );
    setThumbnails(
      Object.fromEntries(
        imageEntries.map(({ asset }) => [
          asset.id,
          { status: 'loading' as const },
        ]),
      ),
    );
    if (!snapshot) return () => {
      active = false;
    };
    for (const { asset } of imageEntries) {
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
            [asset.id]: thumbnailStateFromResponse(response),
          }));
        })
        .catch(() => {
          if (!active) return;
          setThumbnails((current) => ({
            ...current,
            [asset.id]: {
              status: 'missing',
              reason: 'error',
            },
          }));
        });
    }
    return () => {
      active = false;
    };
  }, [entries, snapshot]);

  const selectAsset = (assetId: string): void => {
    setSelectedAssetId(assetId);
    setSelectedDetailsOpen(hideHeading);
    setAuthoritativeReferences([]);
    if (hideHeading) {
      lastOpenedAssetId.current = assetId;
      pendingFocusReturnAssetId.current = null;
    }
    if (!hideHeading) onViewChange('details');
  };

  const rebuildThumbnail = async (assetId: string): Promise<void> => {
    const current = editorProjectStore.getSnapshot();
    if (!current) return;
    const asset = current.project.assets.find(
      (candidate) => candidate.id === assetId,
    );
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
      if (!response.ok) {
        setThumbnails((existing) => ({
          ...existing,
          [assetId]: {
            status: 'missing',
            reason:
              response.error.code === 'ASSET_METADATA_SOURCE_MISSING'
                ? 'source'
                : 'error',
            message: response.error.message,
            ...(response.error.relativePath ?? asset?.relativePath
              ? {
                  relativePath:
                    response.error.relativePath ?? asset?.relativePath,
                }
              : {}),
          },
        }));
      }
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
      if (outcome.applied) {
        setSelectedAssetId(null);
        closeSelectedDetails(false);
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '素材删除失败。',
      );
    } finally {
      setBusy(false);
    }
  };

  const openFlaReview = (): void => {
    if (!snapshot) {
      setStatus('Open a Panda Stage project before reviewing an FLA.');
      return;
    }
    const lifecycle =
      flaInspectionLifecycle.current ??
      (flaInspectionLifecycle.current = new FlaInspectionLifecycle(
        window.pandaStage.fla,
      ));
    setFlaInspection(lifecycle.start());
    setFlaReviewOpen(true);
  };

  useEffect(() => {
    if (
      flaReviewRequestToken === undefined ||
      flaReviewRequestToken === lastFlaReviewRequest.current
    ) {
      return;
    }
    lastFlaReviewRequest.current = flaReviewRequestToken;
    openFlaReview();
  }, [flaReviewRequestToken, openFlaReview]);

  useEffect(() => {
    if (view !== 'browser' && flaReviewOpen) closeFlaReview();
  }, [closeFlaReview, flaReviewOpen, view]);

  // Portrait Assets keeps operation results and errors visible, but does not
  // reserve a row for the generic steady-state guidance copy.
  useEffect(() => {
    if (!hideHeading) return;
    setStatus((current) =>
      current === DEFAULT_ASSET_LIBRARY_STATUS ? '' : current,
    );
  }, [hideHeading]);

  const previousHideHeading = useRef(hideHeading);
  useEffect(() => {
    const previousPortraitAssets = previousHideHeading.current;
    previousHideHeading.current = hideHeading;
    if (previousPortraitAssets === hideHeading) return;

    setPage(1);
    pendingFocusReturnAssetId.current = null;
    setSelectedAssetId(null);
    setSelectedDetailsOpen(false);
    setAuthoritativeReferences([]);
    setSearchQuery('');
    setCategory(hideHeading ? 'all' : 'background');
  }, [hideHeading]);

  const previousProjectRoot = useRef(snapshot?.projectRoot);
  useEffect(() => {
    const previousProject = previousProjectRoot.current;
    previousProjectRoot.current = snapshot?.projectRoot;
    if (previousProject !== snapshot?.projectRoot) {
      setCategory(hideHeading ? 'all' : 'background');
      setSearchQuery('');
      setPage(1);
      pendingFocusReturnAssetId.current = null;
      setSelectedAssetId(null);
      setSelectedDetailsOpen(false);
      setAuthoritativeReferences([]);
    }
    if (previousProject !== snapshot?.projectRoot && flaReviewOpen) {
      closeFlaReview();
    }
  }, [
    closeFlaReview,
    flaReviewOpen,
    hideHeading,
    snapshot?.projectRoot,
  ]);

  return (
    <section
      className={[
        'asset-library',
        `asset-library-presentation-${resolvedPresentation}`,
        dragOver ? 'asset-library-drag-over' : '',
      ].filter(Boolean).join(' ')}
      aria-labelledby="asset-library-heading"
      data-testid="asset-library"
      data-asset-library-presentation={resolvedPresentation}
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
      <div
        className={[
          'asset-library-heading',
          hideHeading ? 'asset-library-heading-visually-hidden' : '',
        ].filter(Boolean).join(' ')}
      >
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
      {view === 'browser' ? flaReviewOpen && flaInspection ? (
        <FlaCompatibilityReviewSession
          inspection={flaInspection}
          onClose={closeFlaReview}
          onCommit={(response) => {
            const outcome = applyFlaAssetCommitResponse(
              response,
              editorProjectStore,
            );
            setStatus(outcome.status);
          }}
          onSnapshotImported={(response) => {
            const outcome = applyFlaStaticSnapshotCommitResponse(
              response,
              editorProjectStore,
            );
            setStatus(outcome.status);
          }}
          onSequenceImported={(response) => {
            const outcome = applyFlaFrameSequenceCommitResponse(
              response,
              editorProjectStore,
            );
            setStatus(outcome.status);
          }}
          onIntent={() => setStatus('已确认 FLA 素材选择；尚未创建项目素材。')}
          snapshot={snapshot}
        />
      ) : (
        <>
          <AssetImportPanel
            compact={hideHeading}
            showFlaAction={showFlaAction}
            importRequestToken={importRequestToken}
            onImportFla={openFlaReview}
            snapshot={snapshot}
          />
          <div
            className="asset-library-browser"
            data-testid="asset-browser-view"
          >
            {hideHeading ? (
              <div className="asset-library-search">
                <label htmlFor="asset-library-search-input">
                  搜索素材
                </label>
                <div className="asset-library-search-control">
                  <DecorativeIcon
                    className="asset-library-search-icon"
                    icon={Search}
                    size={18}
                  />
                  <input
                    aria-label="搜索素材"
                    id="asset-library-search-input"
                    onChange={(event) => updateSearchQuery(event.target.value)}
                    placeholder="搜索素材"
                    type="search"
                    value={searchQuery}
                  />
                  {searchQuery ? (
                    <button
                      aria-label="清除搜索"
                      className="asset-library-search-clear"
                      data-testid="asset-library-search-clear"
                      onClick={() => updateSearchQuery('')}
                      title="清除搜索"
                      type="button"
                    >
                      <DecorativeIcon icon={X} size={18} />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <nav aria-label="素材分类" className="asset-category-tabs">
              {filterOptions.map((item) => (
                <button
                  aria-pressed={category === item.id}
                  className={
                    category === item.id
                      ? 'asset-category-active'
                      : ''
                  }
                  key={item.id}
                  onClick={() => selectCategory(item.id)}
                  type="button"
                >
                  <span>{item.label}</span>
                  <strong>{counts[item.id]}</strong>
                </button>
              ))}
            </nav>
            {hideHeading && selectedAsset && selectedDetailsOpen ? (
              <section
                role="presentation"
                className="asset-details-overlay"
                data-selected-asset-id={selectedAsset.id}
                data-testid="asset-details-overlay"
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    closeSelectedDetails();
                  }
                }}
              >
                <div
                  aria-label="Asset details"
                  aria-modal="true"
                  className="asset-details-dialog"
                  data-testid="asset-details-dialog"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                >
                  <button
                    aria-label="关闭素材详情"
                    aria-controls={`asset-details-dialog-body-${selectedAsset.id}`}
                    data-testid="asset-details-close"
                    onClick={() => closeSelectedDetails()}
                    ref={detailsCloseButtonRef}
                    type="button"
                  >
                    <span>当前选中</span>
                    <span aria-hidden="true">·</span>
                    <strong title={selectedAsset.name}>
                      {selectedAsset.name}
                    </strong>
                    <DecorativeIcon
                      className="asset-details-close-icon"
                      icon={X}
                      size={18}
                    />
                  </button>
                {selectedDetailsOpen ? (
                  <div
                    className="asset-details-dialog-body"
                    id={`asset-details-dialog-body-${selectedAsset.id}`}
                  >
                    <AssetDetails
                      asset={selectedAsset}
                      busy={busy}
                      onDelete={() => void deleteSelected()}
                      presentation="portrait"
                      references={references}
                      thumbnail={thumbnails[selectedAsset.id]}
                    />
                  </div>
                ) : null}
                </div>
              </section>
            ) : null}
            <div className="asset-library-content">
              <AssetGrid
                draggingAssetId={draggingAssetId}
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
                          [assetId]: {
                            status: 'missing',
                            reason: 'error',
                          },
                        },
                  );
                }}
                emptyMessage={
                  searchQuery.trim() ? '没有匹配的素材' : undefined
                }
                selectedAssetId={selectedAssetId}
                thumbnails={thumbnails}
                entries={pageEntries}
              />
              {isPortraitBrowser && totalPages > 1 ? (
                <nav
                  aria-label="绱犳潗鍒嗛〉"
                  className="asset-library-pagination"
                  data-page={currentPage}
                  data-testid="asset-library-pagination"
                  data-total-pages={totalPages}
                >
                  <button
                    aria-label="上一页"
                    disabled={currentPage === 1}
                    onClick={() => goToPage(currentPage - 1)}
                    type="button"
                  >
                    <DecorativeIcon icon={ChevronLeft} size={18} />
                  </button>
                  <span
                    aria-live="polite"
                    data-testid="asset-library-page-status"
                  >
                    <strong>{currentPage}</strong>
                    <span aria-hidden="true"> / </span>
                    <strong>{totalPages}</strong>
                  </span>
                  <button
                    aria-label="下一页"
                    disabled={currentPage === totalPages}
                    onClick={() => goToPage(currentPage + 1)}
                    type="button"
                  >
                    <DecorativeIcon icon={ChevronRight} size={18} />
                  </button>
                </nav>
              ) : null}
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
            thumbnail={selectedAsset ? thumbnails[selectedAsset.id] : undefined}
          />
        </section>
      )}
      <output className="asset-library-status">{status}</output>
    </section>
  );
}
