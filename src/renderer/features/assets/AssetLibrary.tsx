import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, ChevronLeft, ChevronRight, Filter, Search, X } from 'lucide-react';
import {
  scanAssetReferences,
  updateImageAssetAuthorMetadata,
} from '../../../domain';
import type { ImageAssetAuthorMetadata } from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import {
  ASSET_LIBRARY_CATEGORIES,
  ASSET_LIBRARY_FILTERS,
  assetLibraryFilterCounts,
  filterAssetLibraryItems,
  selectAssetLibraryItems,
  selectAssetLibraryEntries,
  type AssetLibraryFilter,
  type AssetLibraryUsageFilter,
} from '../../stores/assetLibrarySelectors';
import { applyAssetDeleteResponse } from './applyAssetDeleteResponse';
import { applyAssetMetadataResponse } from './applyAssetMetadataResponse';
import { ASSET_DRAG_MIME } from './AssetDropPayload';
import { AssetDetails } from './AssetDetails';
import { AssetGrid } from './AssetGrid';
import { IMAGE_ASSET_USAGE_OPTIONS } from './assetUsage';
import {
  thumbnailStateFromResponse,
  type ThumbnailState,
} from './AssetCard';
import { AssetImportPanel } from './AssetImportPanel';
import {
  refreshImportedAudioMetadata,
  type AssetMetadataProjectIdentity,
  type AssetMetadataRefreshOutcome,
} from './assetMetadataQueue';
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
  isFlaInspectionUserCancelled,
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
  const [usageFilter, setUsageFilter] =
    useState<AssetLibraryUsageFilter>('all');
  const [usageFilterMenuOpen, setUsageFilterMenuOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedAssetId, setSelectedAssetId] =
    useState<string | null>(null);
  const [selectedDetailsOpen, setSelectedDetailsOpen] = useState(false);
  const [hasUnsavedMetadata, setHasUnsavedMetadata] = useState(false);
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
  const [metadataErrors, setMetadataErrors] = useState<Record<string, string>>(
    {},
  );
  const [flaReviewOpen, setFlaReviewOpen] = useState(false);
  const [flaInspection, setFlaInspection] =
    useState<FlaInspectionOperation | null>(null);
  const flaInspectionLifecycle = useRef<FlaInspectionLifecycle | null>(null);
  const flaInspectionOperation = useRef<FlaInspectionOperation | null>(null);
  const detailsDialogRef = useRef<HTMLDivElement | null>(null);
  const usageFilterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const usageFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const lastOpenedAssetId = useRef<string | null>(null);
  const pendingFocusReturnAssetId = useRef<string | null>(null);
  const flaReviewFocusReturnTarget = useRef<HTMLElement | null>(null);
  const pendingFlaReviewFocusReturn = useRef(false);
  const lastCloseRequest = useRef(closeRequestToken ?? 0);
  const lastFlaReviewRequest = useRef(flaReviewRequestToken ?? 0);

  const restoreFlaReviewFocus = useCallback((): void => {
    const originalTarget = flaReviewFocusReturnTarget.current;
    if (
      originalTarget &&
      originalTarget !== document.body &&
      originalTarget.isConnected &&
      !originalTarget.hasAttribute('disabled') &&
      originalTarget.getClientRects().length > 0
    ) {
      originalTarget.focus();
      if (document.activeElement === originalTarget) return;
    }

    const fallback = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="resource-asset-import-fla"], [data-testid="asset-import-fla"]',
      ),
    ).find(
      (element) =>
        !element.hasAttribute('disabled') &&
        element.getClientRects().length > 0,
    );
    fallback?.focus();
  }, []);

  useEffect(() => {
    if (
      !pendingFlaReviewFocusReturn.current ||
      flaReviewOpen ||
      flaInspection
    ) {
      return;
    }
    pendingFlaReviewFocusReturn.current = false;
    restoreFlaReviewFocus();
  }, [flaInspection, flaReviewOpen, restoreFlaReviewFocus]);

  const closeFlaReview = useCallback((): void => {
    pendingFlaReviewFocusReturn.current =
      flaInspectionOperation.current !== null;
    setFlaReviewOpen(false);
    flaInspectionOperation.current = null;
    setFlaInspection(null);
    void flaInspectionLifecycle.current?.cancel();
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
  const items = useMemo(
    () => snapshot ? selectAssetLibraryItems(snapshot.project, category) : [],
    [category, snapshot],
  );
  const counts = useMemo(
    () =>
      snapshot
        ? assetLibraryFilterCounts(snapshot.project)
        : { all: 0, character: 0, background: 0, audio: 0, animation: 0 },
    [snapshot],
  );
  const filterOptions = hideHeading
    ? ASSET_LIBRARY_FILTERS
    : ASSET_LIBRARY_CATEGORIES;
  const visibleItems = useMemo(
    () => filterAssetLibraryItems(
      items,
      searchQuery,
      category === 'audio' || category === 'animation' ? 'all' : usageFilter,
    ),
    [category, items, searchQuery, usageFilter],
  );
  const saveImageMetadata = useCallback(
    (
      assetId: string,
      metadata: ImageAssetAuthorMetadata,
    ): ImageAssetAuthorMetadata => {
      const current = editorProjectStore.getSnapshot();
      if (
        !snapshot ||
        !current ||
        current.projectRoot !== snapshot.projectRoot ||
        current.project.id !== snapshot.project.id
      ) {
        throw new Error('项目已切换，请重新选择素材后再编辑。');
      }
      const project = updateImageAssetAuthorMetadata(
        current.project,
        assetId,
        metadata,
      );
      editorProjectStore.updateProject(project, 'Edit image asset details');
      const savedAsset = project.assets.find(
        (candidate) => candidate.id === assetId,
      );
      if (!savedAsset || savedAsset.kind !== 'image') {
        throw new Error('找不到已更新的图片素材。');
      }
      setHasUnsavedMetadata(false);
      return {
        name: savedAsset.name,
        usage: savedAsset.usage,
        keywords: savedAsset.keywords,
      };
    },
    [snapshot],
  );
  const isPortraitBrowser = hideHeading && view === 'browser';
  const totalPages = isPortraitBrowser
    ? assetLibraryPageCount(visibleItems.length)
    : 1;
  const currentPage = isPortraitBrowser
    ? Math.max(1, Math.min(page, totalPages))
    : 1;
  const pageItems = useMemo(
    () =>
      isPortraitBrowser
        ? paginateAssetLibraryEntries(visibleItems, currentPage)
        : visibleItems,
    [currentPage, isPortraitBrowser, visibleItems],
  );
  const pageEntries = useMemo(
    () => pageItems.flatMap((item) => item.kind === 'asset' ? [item.entry] : []),
    [pageItems],
  );
  const isSearchActive = searchQuery.trim().length > 0;
  const isUsageFilterActive =
    category !== 'audio' && category !== 'animation' && usageFilter !== 'all';
  const isEntireLibraryEmpty = !isSearchActive && counts.all === 0;
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

  const closeSelectedDetails = useCallback(
    (returnFocus = true, discardDraft = false): boolean => {
      if (
        hasUnsavedMetadata &&
        !discardDraft &&
        !window.confirm('放弃尚未保存的素材更改？')
      ) {
        return false;
      }
      setHasUnsavedMetadata(false);
      pendingFocusReturnAssetId.current = returnFocus
        ? lastOpenedAssetId.current ?? selectedAssetId
        : null;
      setSelectedDetailsOpen(false);
      onViewChange('browser');
      return true;
    },
    [hasUnsavedMetadata, onViewChange, selectedAssetId],
  );

  const clearSelectedAsset = useCallback((): boolean => {
    if (selectedDetailsOpen && !closeSelectedDetails(false)) return false;
    pendingFocusReturnAssetId.current = null;
    setSelectedAssetId(null);
    setSelectedDetailsOpen(false);
    setHasUnsavedMetadata(false);
    setAuthoritativeReferences([]);
    return true;
  }, [closeSelectedDetails, selectedDetailsOpen]);

  const reportMetadataDraftChange = useCallback(
    (assetId: string, dirty: boolean): void => {
      if (assetId === selectedAssetId) setHasUnsavedMetadata(dirty);
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
    if (!clearSelectedAsset()) return;
    setCategory(nextCategory);
    if ((nextCategory === 'audio' || nextCategory === 'animation') && usageFilter !== 'all') {
      setUsageFilter('all');
    }
    setUsageFilterMenuOpen(false);
    setPage(1);
  };

  const updateSearchQuery = (nextQuery: string): void => {
    if (!clearSelectedAsset()) return;
    setSearchQuery(nextQuery);
    setPage(1);
  };

  const updateUsageFilter = (
    nextUsage: AssetLibraryUsageFilter,
  ): void => {
    if (category === 'audio' || category === 'animation') return;
    if (!clearSelectedAsset()) return;
    setUsageFilter(nextUsage);
    setUsageFilterMenuOpen(false);
    setPage(1);
    usageFilterTriggerRef.current?.focus();
  };

  useEffect(() => {
    if (!usageFilterMenuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        !usageFilterTriggerRef.current?.contains(target) &&
        !usageFilterMenuRef.current?.contains(target)
      ) {
        setUsageFilterMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setUsageFilterMenuOpen(false);
        usageFilterTriggerRef.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = Array.from(
        usageFilterMenuRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemradio"]',
        ) ?? [],
      );
      if (items.length === 0) return;
      event.preventDefault();
      const currentIndex = items.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex =
        currentIndex < 0
          ? step > 0
            ? 0
            : items.length - 1
          : (currentIndex + step + items.length) % items.length;
      items[nextIndex]?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [usageFilterMenuOpen]);

  useEffect(() => {
    if (!usageFilterMenuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const selected = usageFilterMenuRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"][aria-checked="true"]',
      );
      (selected ?? usageFilterMenuRef.current?.querySelector('button'))?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [usageFilterMenuOpen]);

  const goToPage = (requestedPage: number): void => {
    if (!isPortraitBrowser) return;
    const nextPage = Math.max(1, Math.min(requestedPage, totalPages));
    if (nextPage === currentPage) return;
    const nextItems = paginateAssetLibraryEntries(
      visibleItems,
      nextPage,
    );
    if (selectedDetailsOpen && !closeSelectedDetails(false)) return;
    setPage(nextPage);
    if (
      selectedAssetId &&
      !nextItems.some((item) => item.kind === 'asset' && item.entry.asset.id === selectedAssetId)
    ) {
      setSelectedAssetId(null);
      setAuthoritativeReferences([]);
    }
  };

  useEffect(() => {
    if (
      selectedAssetId &&
      !pageEntries.some((entry) => entry.asset.id === selectedAssetId)
    ) {
      if (!closeSelectedDetails(false)) return;
      setSelectedAssetId(null);
      setSelectedDetailsOpen(false);
      setHasUnsavedMetadata(false);
      setAuthoritativeReferences([]);
    }
  }, [closeSelectedDetails, pageEntries, selectedAssetId]);

  useEffect(() => {
    if (page <= totalPages) return;
    setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!selectedDetailsOpen) return;
    const firstInput = detailsDialogRef.current?.querySelector<HTMLElement>(
      'input:not(:disabled), select:not(:disabled)',
    );
    const firstButton = detailsDialogRef.current?.querySelector<HTMLElement>(
      'button:not(:disabled), summary',
    );
    (firstInput ?? firstButton ?? detailsDialogRef.current)?.focus();
  }, [selectedAssetId, selectedDetailsOpen]);

  useEffect(() => {
    if (!selectedDetailsOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeSelectedDetails();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeSelectedDetails, selectedDetailsOpen]);

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
    if (
      selectedDetailsOpen &&
      selectedAssetId !== assetId &&
      !closeSelectedDetails(false)
    ) {
      return;
    }
    setSelectedAssetId(assetId);
    setSelectedDetailsOpen(true);
    setHasUnsavedMetadata(false);
    setAuthoritativeReferences([]);
    lastOpenedAssetId.current = assetId;
    pendingFocusReturnAssetId.current = null;
    if (!hideHeading) onViewChange('details');
    else onViewChange('browser');
  };

  const refreshAssetMetadata = useCallback(async (
    assetId: string,
    expected?: AssetMetadataProjectIdentity,
  ): Promise<AssetMetadataRefreshOutcome> => {
    const current = editorProjectStore.getSnapshot();
    if (
      !current ||
      (expected &&
        (current.projectRoot !== expected.projectRoot ||
          current.project.id !== expected.projectId))
    ) {
      return { status: 'stopped', applied: false };
    }
    const asset = current.project.assets.find(
      (candidate) => candidate.id === assetId,
    );
    if (!asset) return { status: 'stopped', applied: false };
    setBusy(true);
    setMetadataErrors((existing) => {
      if (!(assetId in existing)) return existing;
      const next = { ...existing };
      delete next[assetId];
      return next;
    });
    setStatus(
      asset.kind === 'audio'
        ? '正在准备配音…'
        : '正在重新读取素材并生成缩略图…',
    );
    try {
      const response =
        await window.pandaStage.assets.refreshMetadata({
          projectRoot: current.projectRoot,
          project: current.project,
          baseRevision: current.revision,
          assetId,
          requestId: crypto.randomUUID(),
        });
      const latest = editorProjectStore.getSnapshot();
      if (
        !latest ||
        latest.projectRoot !== current.projectRoot ||
        latest.project.id !== current.project.id
      ) {
        return { status: 'stopped', applied: false };
      }
      if (!response.ok && asset.kind === 'image') {
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
      const ready =
        response.ok && response.result.status === 'ready' && outcome.applied;
      if (asset.kind === 'audio') {
        setMetadataErrors((existing) => {
          if (ready) {
            if (!(assetId in existing)) return existing;
            const next = { ...existing };
            delete next[assetId];
            return next;
          }
          return { ...existing, [assetId]: outcome.status };
        });
      }
      setStatus(
        ready
          ? asset.kind === 'audio'
            ? '配音已准备好。'
            : '缩略图已重新生成。'
          : outcome.status,
      );
      return {
        status: ready ? 'ready' : 'error',
        applied: outcome.applied,
        ...(ready ? {} : { message: outcome.status }),
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : asset.kind === 'audio'
            ? '无法读取配音。'
            : '缩略图重建失败。';
      if (asset.kind === 'audio') {
        setMetadataErrors((existing) => ({
          ...existing,
          [assetId]: message,
        }));
      }
      setStatus(message);
      return { status: 'error', applied: false, message };
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshAudioMetadataBatch = useCallback(
    (assetIds: readonly string[]) =>
      refreshImportedAudioMetadata(assetIds, {
        getSnapshot: () => editorProjectStore.getSnapshot(),
        refresh: refreshAssetMetadata,
      }),
    [refreshAssetMetadata],
  );

  const deleteSelected = async (): Promise<void> => {
    const current = editorProjectStore.getSnapshot();
    const asset = current?.project.assets.find(
      (candidate) => candidate.id === selectedAssetId,
    );
    if (!current || !asset) return;
    if (
      !window.confirm(
        `确认删除素材“${asset.name}”？${hasUnsavedMetadata ? '未保存的编辑也会丢弃。' : ''}Main Process 会再次检查全部项目引用。`,
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
        closeSelectedDetails(false, true);
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
    const activeElement = document.activeElement;
    flaReviewFocusReturnTarget.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
    const lifecycle =
      flaInspectionLifecycle.current ??
      (flaInspectionLifecycle.current = new FlaInspectionLifecycle(
        window.pandaStage.fla,
      ));
    const operation = lifecycle.start();
    flaInspectionOperation.current = operation;
    setFlaInspection(operation);
    // Keep the Asset Library as the background while the native chooser owns
    // the interaction. Main resolves this only after a source is selected.
    setFlaReviewOpen(false);
    void operation.inspectionStarted.then(() => {
      if (flaInspectionOperation.current === operation) {
        setFlaReviewOpen(true);
      }
    });
    void operation.response.then(
      (nextResponse) => {
        if (
          isFlaInspectionUserCancelled(nextResponse) &&
          flaInspectionOperation.current === operation
        ) {
          closeFlaReview();
        }
      },
      () => undefined,
    );
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
      setUsageFilter('all');
      setPage(1);
      pendingFocusReturnAssetId.current = null;
      setSelectedAssetId(null);
      setSelectedDetailsOpen(false);
      setAuthoritativeReferences([]);
      setMetadataErrors({});
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
        className="asset-library-heading asset-library-heading-visually-hidden"
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
            setStatus(response.ok ? '' : outcome.status);
          }}
          snapshot={snapshot}
        />
      ) : (
        <>
          <AssetImportPanel
            compact={hideHeading}
            showFlaAction={showFlaAction}
            importRequestToken={importRequestToken}
            onImportFla={openFlaReview}
            onImportedAudioAssets={refreshAudioMetadataBatch}
            snapshot={snapshot}
          />
          <div
            className="asset-library-filter-controls"
            data-testid="asset-library-filter-controls"
          >
            <div className="asset-library-search">
              <label className="asset-library-search-label-compact" htmlFor="asset-library-search-input">
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
            <div className="asset-library-usage-filter">
              <button
                aria-expanded={category !== 'audio' && category !== 'animation' && usageFilterMenuOpen}
                aria-haspopup="menu"
                aria-label={
                  category === 'audio' || category === 'animation'
                    ? '按用途筛选（仅图片素材）'
                    : '按用途筛选'
                }
                aria-pressed={usageFilter !== 'all'}
                className="asset-library-usage-filter-trigger"
                data-active={usageFilter !== 'all'}
                data-testid="asset-library-usage-filter"
                disabled={category === 'audio' || category === 'animation'}
                onClick={() => {
                  if (category !== 'audio' && category !== 'animation') {
                    setUsageFilterMenuOpen((open) => !open);
                  }
                }}
                ref={usageFilterTriggerRef}
                title={
                  category === 'audio' ? '用途筛选仅适用于图片素材' : undefined
                }
                type="button"
              >
                <Filter aria-hidden="true" size={18} />
                {usageFilter !== 'all' ? (
                  <span aria-hidden="true" className="asset-library-usage-filter-active-dot" />
                ) : null}
              </button>
              {usageFilterMenuOpen && category !== 'audio' && category !== 'animation' ? (
                <div
                  aria-label="按用途筛选"
                  className="asset-library-usage-filter-menu"
                  data-testid="asset-library-usage-filter-menu"
                  id="asset-library-usage-filter-menu"
                  ref={usageFilterMenuRef}
                  role="menu"
                >
                  {[
                    { value: 'all' as const, label: '全部' },
                    ...IMAGE_ASSET_USAGE_OPTIONS.map((option) =>
                      option.value === 'character'
                        ? { ...option, label: '人物' }
                        : option,
                    ),
                  ].map((option) => (
                    <button
                      aria-checked={usageFilter === option.value}
                      className="asset-library-usage-filter-option"
                      data-usage-filter-value={option.value}
                      key={option.value}
                      onClick={() => updateUsageFilter(option.value)}
                      role="menuitemradio"
                      type="button"
                    >
                      <span>{option.label}</span>
                      <span
                        aria-hidden="true"
                        className="asset-library-usage-filter-check-slot"
                      >
                        {usageFilter === option.value ? (
                          <Check size={17} />
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div
            className="asset-library-browser"
            data-testid="asset-browser-view"
          >
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
            <div className="asset-library-content">
              {snapshot ? (
  <AssetGrid
                project={snapshot.project}
                projectRoot={snapshot.projectRoot}
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
                  void refreshAssetMetadata(assetId)
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
                  isSearchActive
                    ? '没有匹配的素材'
                    : category === 'animation'
                      ? '还没有已导入的动画'
                    : isUsageFilterActive
                      ? '没有符合用途的图片'
                      : isEntireLibraryEmpty
                      ? '素材库还是空的'
                      : undefined
                }
                emptyDescription={
                  isSearchActive
                    ? '清除搜索或换一个用途、分类试试。'
                    : category === 'animation'
                      ? '从 FLA 导入动画后会显示在这里。'
                    : isUsageFilterActive
                      ? '选择其他用途，或恢复“全部用途”。'
                      : isEntireLibraryEmpty
                      ? '拖进图片或音频，或者点上面的「导入素材」。'
                      : undefined
                }
                selectedAssetId={selectedAssetId}
                metadataErrors={metadataErrors}
                thumbnails={thumbnails}
                items={pageItems}
              />
) : (
  <div className="animation-library-empty" data-testid="animation-library-empty">
    <strong>尚未打开项目</strong>
  </div>
)}
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
          {!selectedDetailsOpen ? (
            <AssetDetails
              key={selectedAsset?.id ?? 'empty'}
              asset={selectedAsset}
              busy={busy}
              onCancelEdit={() => closeSelectedDetails(true, true)}
              onDelete={() => void deleteSelected()}
              metadataError={
                selectedAsset ? metadataErrors[selectedAsset.id] : undefined
              }
              onDraftChange={reportMetadataDraftChange}
              onRequestClose={() => closeSelectedDetails()}
              onSaveImageMetadata={saveImageMetadata}
              onRefreshMetadata={
                selectedAsset
                  ? () => void refreshAssetMetadata(selectedAsset.id)
                  : undefined
              }
              references={references}
              thumbnail={selectedAsset ? thumbnails[selectedAsset.id] : undefined}
            />
          ) : null}
        </section>
      )}
      {selectedAsset && selectedDetailsOpen ? (
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
            aria-label="素材详情"
            aria-modal="true"
            aria-labelledby="asset-details-title"
            className="asset-details-dialog"
            data-testid="asset-details-dialog"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const dialog = detailsDialogRef.current;
              if (!dialog) return;
              const focusable = Array.from(
                dialog.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary',
                ),
              ).filter(
                (element) =>
                  !element.closest('details:not([open])') ||
                  element.matches('summary'),
              );
              if (focusable.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
              }
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (
                event.shiftKey &&
                (document.activeElement === first ||
                  !dialog.contains(document.activeElement))
              ) {
                event.preventDefault();
                last?.focus();
              } else if (
                !event.shiftKey &&
                (document.activeElement === last ||
                  !dialog.contains(document.activeElement))
              ) {
                event.preventDefault();
                first?.focus();
              }
            }}
            ref={detailsDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div
              className="asset-details-dialog-body"
              id={`asset-details-dialog-body-${selectedAsset.id}`}
            >
              <AssetDetails
                key={selectedAsset.id}
                asset={selectedAsset}
                busy={busy}
                onCancelEdit={() => closeSelectedDetails(true, true)}
                onDelete={() => void deleteSelected()}
                metadataError={metadataErrors[selectedAsset.id]}
                onDraftChange={reportMetadataDraftChange}
                onRequestClose={() => closeSelectedDetails()}
                onSaveImageMetadata={saveImageMetadata}
                onRefreshMetadata={() =>
                  void refreshAssetMetadata(selectedAsset.id)
                }
                presentation={resolvedPresentation}
                references={references}
                thumbnail={thumbnails[selectedAsset.id]}
              />
            </div>
          </div>
        </section>
      ) : null}
      {status ? <output className="asset-library-status">{status}</output> : null}
    </section>
  );
}
