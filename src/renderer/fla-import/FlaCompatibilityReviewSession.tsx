import {
  useCallback,
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  FlaCompatibilityStatus,
  FlaInspectionResponse,
  FlaStructuralSummary,
} from '../../shared/fla-import-api';
import type { FlaAssetCommitResponse } from '../../shared/fla-asset-commit-api';
import type { FlaStaticSnapshotCommitResponse } from '../../shared/fla-static-snapshot-api';
import type { FlaFrameSequenceCommitResponse } from '../../shared/fla-frame-sequence-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import {
  compatibilityCounts,
  compatibilityWarnings,
  filterFlaReviewMedia,
  flaReviewPageCount,
  FLA_RASTER_REVIEW_PAGE_SIZES,
  FLA_COMPATIBILITY_LABELS,
  FLA_COMPATIBILITY_STATUSES,
  paginateFlaReviewMedia,
  reviewMedia,
  type FlaRasterReviewFilter,
  type FlaReviewMedia,
} from './fla-review';
import {
  createFlaWorkbenchCandidateSelection,
  createFlaWorkbenchCandidates,
  focusFlaWorkbenchCandidate,
  reconcileFlaWorkbenchFocus,
} from './fla-workbench-candidates';
import {
  isFlaInspectionUserCancelled,
  subscribeToFlaInspection,
  type FlaInspectionOperation,
} from './fla-inspection-lifecycle';
import { FlaStaticSnapshotReview } from './FlaStaticSnapshotReview';
import { FlaFrameSequenceReview } from './FlaFrameSequenceReview';
import {
  FlaRenderWorkbench,
  type FlaRenderWorkbenchMode,
} from './FlaRenderWorkbench';
import type { FlaStageGTerminalState } from './FlaStageGTerminal';
import { FlaStageAInspecting } from './FlaStageAInspecting';
import { FlaStageF3Blocked } from './FlaStageF';
import {
  defaultFlaWorkbenchSection,
  routeFlaInspection,
  type FlaWorkbenchSection,
} from './fla-content-route';
import {
  describeFlaUnifiedCandidate,
  flaUnifiedCandidateSelectionKey,
  runFlaUnifiedImport,
  type FlaUnifiedImportItem,
  type FlaUnifiedImportReceipt,
  type FlaUnifiedImportRunner,
} from './fla-unified-import';

interface FlaCompatibilityReviewSessionProps {
  inspection: FlaInspectionOperation;
  snapshot: EditorProjectSnapshot | null;
  onClose: () => void;
  onCommit?: (response: FlaAssetCommitResponse) => void;
  onSnapshotImported?: (response: FlaStaticSnapshotCommitResponse) => void;
  onSequenceImported?: (response: FlaFrameSequenceCommitResponse) => void;
}

type SessionPhase =
  | 'inspecting'
  | 'ready'
  | 'committing'
  | 'error';

export function FlaCompatibilityReviewSession({
  inspection,
  snapshot,
  onClose,
  onCommit,
  onSnapshotImported,
  onSequenceImported,
}: FlaCompatibilityReviewSessionProps): React.JSX.Element {
  const [phase, setPhase] = useState<SessionPhase>('inspecting');
  const [response, setResponse] = useState<FlaInspectionResponse | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rasterSelection, setRasterSelection] = useState(createFlaWorkbenchCandidateSelection);
  const [checkedCandidates, setCheckedCandidates] = useState<Map<string, FlaUnifiedImportItem>>(() => new Map());
  const [importReceipt, setImportReceipt] = useState<FlaUnifiedImportReceipt | null>(null);
  const [unifiedImportRunning, setUnifiedImportRunning] = useState(false);
  const [stopAfterCurrentRequested, setStopAfterCurrentRequested] = useState(false);
  const [importRunnerRevision, setImportRunnerRevision] = useState(0);
  const [thumbnailUrls, setThumbnailUrls] = useState<Readonly<Record<string, string>>>({});
  const [compatibilityNotesOpen, setCompatibilityNotesOpen] = useState(false);
  const [rasterPage, setRasterPage] = useState(1);
  const [rasterPageSize, setRasterPageSize] = useState<number>(FLA_RASTER_REVIEW_PAGE_SIZES[0]);
  const [rasterFilter, setRasterFilter] = useState<FlaRasterReviewFilter>('all');
  const [rasterSearch, setRasterSearch] = useState('');
  const [workbenchSection, setWorkbenchSection] = useState<FlaWorkbenchSection>('compositions');
  const [compositionWorkbenchMounted, setCompositionWorkbenchMounted] = useState(false);
  const [snapshotWorkbenchMounted, setSnapshotWorkbenchMounted] = useState(false);
  const [sequenceWorkbenchMounted, setSequenceWorkbenchMounted] = useState(false);
  const [snapshotWorkInProgress, setSnapshotWorkInProgress] = useState(false);
  const [sequenceWorkInProgress, setSequenceWorkInProgress] = useState(false);
  const [renderMode, setRenderMode] = useState<FlaRenderWorkbenchMode>('snapshot');
  const [renderTerminalState, setRenderTerminalState] = useState<FlaStageGTerminalState>('active');
  const reviewBodyRef = useRef<HTMLDivElement | null>(null);
  const reviewScrollTop = useRef(0);
  const snapshotImportRunnerRef = useRef<FlaUnifiedImportRunner | null>(null);
  const sequenceImportRunnerRef = useRef<FlaUnifiedImportRunner | null>(null);
  const cancelAfterCurrentRef = useRef(false);
  const unifiedImportRunningRef = useRef(false);

  useEffect(() => {
    return subscribeToFlaInspection(
      inspection,
      (nextResponse) => {
        if (isFlaInspectionUserCancelled(nextResponse)) {
          // Native picker cancellation is a clean dismissal, not a failed
          // inspection.  Do not briefly mount F3 or expose its diagnostics.
          onClose();
          return;
        }
        setResponse(nextResponse);
        if (nextResponse.ok) {
          setThumbnailUrls({});
          setSessionId(nextResponse.sessionId);
          setRasterSelection(createFlaWorkbenchCandidateSelection(nextResponse.ir.media[0]?.id ?? null));
          setCheckedCandidates(new Map());
          setImportReceipt(null);
          const initialSection = defaultFlaWorkbenchSection(nextResponse.ir.media.length);
          setWorkbenchSection(initialSection);
          setCompositionWorkbenchMounted(initialSection === 'compositions');
          setSnapshotWorkbenchMounted(initialSection === 'compositions');
          setSequenceWorkbenchMounted(false);
          setSnapshotWorkInProgress(initialSection === 'compositions');
          setSequenceWorkInProgress(false);
          setRasterPage(1);
          setRasterPageSize(16);
          setRasterFilter('all');
          setRasterSearch('');
          setCompatibilityNotesOpen(false);
          setRenderMode('snapshot');
          setRenderTerminalState('active');
          reviewScrollTop.current = 0;
          setPhase('ready');
        } else {
          setPhase('error');
        }
      },
      (error: unknown) => {
        setResponse({
          ok: false,
          error: {
            code: 'PARSER_CRASH',
            message: error instanceof Error ? error.message : 'FLA inspection failed',
          },
        });
        setPhase('error');
      },
    );
  }, [inspection]);

  const ir = response?.ok ? response.ir : null;
  const contentRoute = response ? routeFlaInspection(response) : 'blocked';
  const checkedCandidateKeys = useMemo(
    () => new Set(checkedCandidates.keys()),
    [checkedCandidates],
  );
  const selectedUnifiedItems = useMemo(
    () => [...checkedCandidates.values()],
    [checkedCandidates],
  );
  const reviewItems = useMemo(
    () => (ir ? reviewMedia(ir, snapshot?.project.assets ?? []) : []),
    [ir, snapshot],
  );
  const rasterCandidates = useMemo(
    () => ir && sessionId
      ? createFlaWorkbenchCandidates({
          context: { sessionId, source: ir.source },
          rasterMedia: reviewItems.map(({ media }) => media),
          rasterThumbnailUrls: thumbnailUrls,
          selection: rasterSelection,
        })
          .filter((candidate) => candidate.kind === 'raster')
          .map((candidate) => ({
            ...candidate,
            checked: candidate.selectable && checkedCandidateKeys.has(flaUnifiedCandidateSelectionKey(candidate)),
          }))
      : [],
    [checkedCandidateKeys, ir, rasterSelection, reviewItems, sessionId, thumbnailUrls],
  );
  const candidateByMediaId = useMemo(
    () => new Map(rasterCandidates.map((candidate) => [candidate.id, candidate])),
    [rasterCandidates],
  );
  const selectedMediaIds = useMemo(
    () => new Set(rasterCandidates.flatMap((candidate) =>
      candidate.kind === 'raster' && candidate.checked ? [candidate.operation.mediaId] : [],
    )),
    [rasterCandidates],
  );
  const selectedCount = selectedMediaIds.size;
  const filteredReviewItems = useMemo(() => {
    return filterFlaReviewMedia(reviewItems, rasterFilter, rasterSearch, selectedMediaIds);
  }, [rasterFilter, rasterSearch, reviewItems, selectedMediaIds]);
  const rasterPageCount = flaReviewPageCount(filteredReviewItems.length, rasterPageSize);
  const pagedReviewItems = useMemo(() => {
    return paginateFlaReviewMedia(filteredReviewItems, rasterPage, rasterPageSize);
  }, [filteredReviewItems, rasterPage, rasterPageSize]);
  const visibleRasterCandidates = useMemo(
    () => pagedReviewItems.map(({ media }) => candidateByMediaId.get(media.id))
      .filter((candidate) => candidate !== undefined),
    [candidateByMediaId, pagedReviewItems],
  );
  const effectiveFocusedMediaId = useMemo(
    () => reconcileFlaWorkbenchFocus(
      visibleRasterCandidates,
      rasterSelection.focusedCandidateId,
      false,
    ),
    [rasterSelection.focusedCandidateId, visibleRasterCandidates],
  );
  const usedMediaCount = reviewItems.filter((item) => !item.libraryOnly).length;
  const libraryOnlyMediaCount = reviewItems.length - usedMediaCount;
  const focusedItem = pagedReviewItems.find(({ media }) => media.id === effectiveFocusedMediaId)
    ?? null;
  const selectionLocked = unifiedImportRunning;

  useEffect(() => {
    if (effectiveFocusedMediaId === rasterSelection.focusedCandidateId) return;
    setRasterSelection((current) => focusFlaWorkbenchCandidate(current, effectiveFocusedMediaId));
  }, [effectiveFocusedMediaId, rasterSelection.focusedCandidateId]);

  useEffect(() => {
    if (rasterPage <= rasterPageCount) return;
    reviewScrollTop.current = 0;
    setRasterPage(rasterPageCount);
  }, [rasterPage, rasterPageCount]);

  useEffect(() => {
    if (!ir) return undefined;
    reviewScrollTop.current = reviewBodyRef.current?.scrollTop ?? reviewScrollTop.current;
    const created: Record<string, string> = {};
    if (typeof URL.createObjectURL === 'function') {
      for (const media of ir.media) {
        const bytes = media.payload.bytes.slice();
        const blob = new Blob([bytes.buffer as ArrayBuffer], {
          type: media.payload.mimeType,
        });
        created[media.id] = URL.createObjectURL(blob);
      }
    }
    setThumbnailUrls(created);
    return () => {
      for (const url of Object.values(created)) URL.revokeObjectURL(url);
    };
  }, [ir]);

  useLayoutEffect(() => {
    const body = reviewBodyRef.current;
    if (!body) return;
    const maximumScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const nextScrollTop = Math.min(reviewScrollTop.current, maximumScrollTop);
    if (Math.abs(body.scrollTop - nextScrollTop) > 0.5) {
      body.scrollTop = nextScrollTop;
    }
  }, [
    compatibilityNotesOpen,
    pagedReviewItems,
    phase,
    rasterPage,
    rasterPageSize,
    rasterSearch,
    selectedMediaIds,
    thumbnailUrls,
  ]);

  const rememberReviewScroll = (): void => {
    if (reviewBodyRef.current) reviewScrollTop.current = reviewBodyRef.current.scrollTop;
  };

  const resetRasterBrowsePosition = (): void => {
    reviewScrollTop.current = 0;
    setRasterPage(1);
  };

  const changeRasterFilter = (nextFilter: FlaRasterReviewFilter): void => {
    if (nextFilter === rasterFilter) return;
    resetRasterBrowsePosition();
    setRasterFilter(nextFilter);
  };

  const changeRasterSearch = (nextSearch: string): void => {
    resetRasterBrowsePosition();
    setRasterSearch(nextSearch);
  };

  const changeRasterPageSize = (nextPageSize: number): void => {
    if (!FLA_RASTER_REVIEW_PAGE_SIZES.includes(nextPageSize as (typeof FLA_RASTER_REVIEW_PAGE_SIZES)[number])) {
      return;
    }
    resetRasterBrowsePosition();
    setRasterPageSize(nextPageSize);
  };

  const changeRasterPage = (delta: number): void => {
    const nextPage = Math.min(
      Math.max(1, rasterPage + delta),
      rasterPageCount,
    );
    if (nextPage === rasterPage) return;
    resetRasterBrowsePosition();
    setRasterPage(nextPage);
  };

  const registerImportRunner = useCallback((
    kind: 'snapshot' | 'sequence',
    runner: FlaUnifiedImportRunner | null,
  ): void => {
    const target = kind === 'snapshot' ? snapshotImportRunnerRef : sequenceImportRunnerRef;
    const wasAvailable = target.current !== null;
    target.current = runner;
    if (wasAvailable !== (runner !== null)) {
      setImportRunnerRevision((current) => current + 1);
    }
  }, []);
  const registerSnapshotImportRunner = useCallback(
    (runner: FlaUnifiedImportRunner | null): void => registerImportRunner('snapshot', runner),
    [registerImportRunner],
  );
  const registerSequenceImportRunner = useCallback(
    (runner: FlaUnifiedImportRunner | null): void => registerImportRunner('sequence', runner),
    [registerImportRunner],
  );
  const toggleUnifiedCandidate = useCallback((item: FlaUnifiedImportItem, checked: boolean): void => {
    if (unifiedImportRunningRef.current) return;
    setCheckedCandidates((current) => {
      const next = new Map(current);
      if (checked) next.set(item.key, item);
      else next.delete(item.key);
      return next;
    });
  }, []);
  const checkUnifiedCandidates = useCallback((items: readonly FlaUnifiedImportItem[]): void => {
    if (unifiedImportRunningRef.current) return;
    setCheckedCandidates((current) => {
      const next = new Map(current);
      for (const item of items) next.set(item.key, item);
      return next;
    });
  }, []);
  const clearUnifiedCandidates = useCallback((keys: readonly string[]): void => {
    if (unifiedImportRunningRef.current) return;
    const keysToClear = new Set(keys);
    setCheckedCandidates((current) => new Map([...current].filter(([key]) => !keysToClear.has(key))));
  }, []);
  const reconcileUnifiedCandidates = useCallback((
    kind: 'raster' | 'snapshot' | 'sequence',
    currentSelectableKeys: ReadonlySet<string>,
  ): void => {
    setCheckedCandidates((current) => {
      let changed = false;
      const next = new Map<string, FlaUnifiedImportItem>();
      for (const [key, item] of current) {
        if (item.kind === kind && !currentSelectableKeys.has(key)) {
          changed = true;
          continue;
        }
        next.set(key, item);
      }
      return changed ? next : current;
    });
  }, []);
  const currentRasterSelectableKeys = useMemo(
    () => new Set(rasterCandidates.filter((candidate) => candidate.selectable).map(flaUnifiedCandidateSelectionKey)),
    [rasterCandidates],
  );
  useEffect(() => {
    reconcileUnifiedCandidates('raster', currentRasterSelectableKeys);
  }, [currentRasterSelectableKeys, reconcileUnifiedCandidates]);
  useEffect(() => {
    setCheckedCandidates(new Map());
    setImportReceipt(null);
  }, [sessionId, ir?.source.sha256]);

  const rasterImportRunner = useCallback<FlaUnifiedImportRunner>(async (
    items,
    currentSnapshot,
    shouldCancel,
  ) => {
    const candidatesByKey = new Map(rasterCandidates.map((candidate) => [
      flaUnifiedCandidateSelectionKey(candidate),
      candidate,
    ]));
    const selected = items.map((item) => ({ item, candidate: candidatesByKey.get(item.key) }));
    const staleSelection = selected.some(({ item, candidate }) => item.kind !== 'raster' || candidate?.kind !== 'raster');
    if (staleSelection) {
      return {
        items: items.map((item) => ({
          ...item,
          status: 'failed' as const,
          message: '位图候选身份已变化；请重新检查并明确选择后再导入。',
        })),
        snapshot: currentSnapshot,
        stopFollowingRoutes: true,
      };
    }
    if (shouldCancel()) {
      return {
        items: items.map((item) => ({ ...item, status: 'not-attempted' as const, message: '已取消后续导入，此项未尝试。' })),
        snapshot: currentSnapshot,
        cancelled: true,
      };
    }
    const selectedCandidates = selected.flatMap(({ candidate }) => candidate?.kind === 'raster' ? [candidate] : []);
    const selectedMediaIds = selectedCandidates.map((candidate) => candidate.operation.mediaId);
    if (selectedMediaIds.length === 0 || new Set(selectedMediaIds).size !== selectedMediaIds.length) {
      return {
        items: items.map((item) => ({ ...item, status: 'failed' as const, message: '位图选择为空或包含重复身份，未提交。' })),
        snapshot: currentSnapshot,
        stopFollowingRoutes: true,
      };
    }

    try {
      const response = await window.pandaStage.fla.commitSelected({
        format: 'fla-raster-commit',
        version: 1,
        projectRoot: currentSnapshot.projectRoot,
        project: currentSnapshot.project,
        baseRevision: currentSnapshot.revision,
        sessionId: selectedCandidates[0]!.operation.sessionId,
        source: {
          basename: selectedCandidates[0]!.source.basename,
          sha256: selectedCandidates[0]!.operation.sourceSha256,
        },
        selectedMediaIds,
        selectedCount: selectedMediaIds.length,
        confirmed: true,
      });
      if (response.ok && response.status === 'cancelled') {
        return {
          items: items.map((item) => ({ ...item, status: 'not-attempted' as const, message: '导入操作已取消，此项未提交。' })),
          snapshot: currentSnapshot,
          cancelled: true,
        };
      }
      if (!response.ok) {
        const errorSnapshot = response.error.currentProject && response.error.currentRevision !== undefined
          ? { ...currentSnapshot, project: response.error.currentProject, revision: response.error.currentRevision }
          : currentSnapshot;
        return {
          items: items.map((item) => ({ ...item, status: 'failed' as const, message: response.error.message })),
          snapshot: errorSnapshot,
          stopFollowingRoutes: true,
        };
      }

      const resultsByMediaId = new Map(response.results.map((result) => [result.mediaId, result]));
      let storeSyncFailed = false;
      try {
        onCommit?.(response);
      } catch {
        storeSyncFailed = true;
      }
      const resultItems = selected.map(({ item, candidate }) => {
        const mediaId = candidate?.kind === 'raster' ? candidate.operation.mediaId : '';
        const result = resultsByMediaId.get(mediaId);
        if (!result) {
          return { ...item, status: 'failed' as const, message: '主进程没有返回此位图的结果；请检查素材库后再处理。' };
        }
        return {
          ...item,
          status: result.status,
          baseRevision: response.baseRevision,
          savedRevision: response.savedRevision,
          importedAssetCount: result.status === 'imported' ? 1 : 0,
          duplicateAssetCount: result.status === 'duplicate' ? 1 : 0,
          ...(storeSyncFailed ? { message: '项目已提交，但界面状态同步失败；请返回素材库核对，勿重复导入。' } : {}),
        };
      });
      return {
        items: resultItems,
        snapshot: { ...currentSnapshot, project: response.project, revision: response.savedRevision },
        ...(storeSyncFailed ? {
          warnings: ['位图已保存到项目，但素材库界面状态未能同步；已停止后续路由。'],
          stopFollowingRoutes: true,
        } : {}),
        ...(resultItems.some((item) => item.status === 'failed') ? { stopFollowingRoutes: true } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '位图导入结果无法确认。';
      return {
        items: items.map((item) => ({ ...item, status: 'failed' as const, message })),
        snapshot: currentSnapshot,
        warnings: ['位图提交结果无法确认；为避免重复写入，已停止后续路由。请检查素材库。'],
        stopFollowingRoutes: true,
      };
    }
  }, [onCommit, rasterCandidates]);

  const canImportSelected = useMemo(() => {
    if (
      !snapshot ||
      selectedUnifiedItems.length === 0 ||
      unifiedImportRunning ||
      snapshotWorkInProgress ||
      sequenceWorkInProgress ||
      renderTerminalState !== 'active'
    ) return false;
    return selectedUnifiedItems.every((item) => item.kind === 'raster' ||
      (item.kind === 'snapshot' && snapshotImportRunnerRef.current !== null) ||
      (item.kind === 'sequence' && sequenceImportRunnerRef.current !== null));
  }, [importRunnerRevision, renderTerminalState, selectedUnifiedItems, snapshot, snapshotWorkInProgress, sequenceWorkInProgress, unifiedImportRunning]);

  const runImportAction = async (): Promise<void> => {
    if (!snapshot || !canImportSelected || unifiedImportRunningRef.current) return;
    const items = [...selectedUnifiedItems];
    const keys = new Set(items.map((item) => item.key));
    cancelAfterCurrentRef.current = false;
    unifiedImportRunningRef.current = true;
    setStopAfterCurrentRequested(false);
    setImportReceipt(null);
    setUnifiedImportRunning(true);
    setPhase('committing');
    try {
      const receipt = await runFlaUnifiedImport({
        items,
        snapshot,
        runners: {
          raster: rasterImportRunner,
          ...(snapshotImportRunnerRef.current ? { snapshot: snapshotImportRunnerRef.current } : {}),
          ...(sequenceImportRunnerRef.current ? { sequence: sequenceImportRunnerRef.current } : {}),
        },
        shouldCancel: () => cancelAfterCurrentRef.current,
      });
      setImportReceipt(receipt);
      setCheckedCandidates((current) => new Map([...current].filter(([key]) => !keys.has(key))));
    } catch (error) {
      const message = error instanceof Error
        ? `导入结果无法确认：${error.message}`
        : '导入结果无法确认；请检查素材库后再处理。';
      const itemsWithFailure = items.map((item) => ({ ...item, status: 'failed' as const, message }));
      setImportReceipt({
        selectedCount: items.length,
        items: itemsWithFailure,
        counts: {
          imported: 0,
          duplicate: 0,
          failed: items.length,
          notAttempted: 0,
          importedAssets: 0,
          duplicateAssets: 0,
        },
        partial: true,
        cancelled: false,
        warnings: ['导入结果无法确认；为避免重复写入，已清除本次勾选，请先检查素材库。'],
        snapshot,
      });
      setCheckedCandidates((current) => new Map([...current].filter(([key]) => !keys.has(key))));
    } finally {
      unifiedImportRunningRef.current = false;
      setUnifiedImportRunning(false);
      setPhase('ready');
      setStopAfterCurrentRequested(false);
      cancelAfterCurrentRef.current = false;
      setRenderTerminalState('active');
    }
  };

  const requestStopAfterCurrent = (): void => {
    if (!unifiedImportRunningRef.current) return;
    cancelAfterCurrentRef.current = true;
    setStopAfterCurrentRequested(true);
  };

  const closeSession = (): void => {
    if (unifiedImportRunningRef.current || renderTerminalState !== 'active') return;
    onClose();
  };

  if (phase === 'inspecting') {
    return (
      <FlaReviewPortal>
        <FlaStageAInspecting onCancel={closeSession} />
      </FlaReviewPortal>
    );
  }

  if (response && !response.ok) {
    return (
      <FlaReviewPortal>
        <FlaStageF3Blocked response={response} onClose={onClose} />
      </FlaReviewPortal>
    );
  }

  if (!ir || !sessionId) {
    const diagnostic = flaDiagnosticUserMessage(response);
    return (
      <FlaReviewPortal>
        <section
          aria-label="FLA 兼容性预览"
          aria-modal="true"
          className="fla-review-session"
          data-review-layout="portal"
          data-testid="fla-review-session"
          role="dialog"
        >
          <header className="fla-review-heading" data-testid="fla-review-header">
            <div>
              <p className="eyebrow">导入前检查</p>
              <h2>FLA 兼容性预览</h2>
            </div>
            <button autoFocus onClick={onClose} type="button">返回素材库</button>
          </header>
          <div className="fla-review-body fla-review-status-body">
            {diagnostic ? (
              <output data-testid="fla-review-diagnostic" role="alert">
                {diagnostic}
              </output>
            ) : (
              <output data-testid="fla-review-error" role="alert">
                FLA 检查失败，请关闭后重试。
              </output>
            )}
          </div>
        </section>
      </FlaReviewPortal>
    );
  }

  const counts = compatibilityCounts(ir);
  const warnings = compatibilityWarnings(ir);
  const hasSourceBitmaps = contentRoute === 'v1-raster-review';
  const rasterRoute = hasSourceBitmaps && workbenchSection === 'source-assets';
  const compositionRoute = workbenchSection === 'compositions';
  const compositionWorkInProgress = snapshotWorkInProgress || sequenceWorkInProgress;
  const workbenchActionsLocked =
    phase === 'committing' ||
    unifiedImportRunning ||
    renderTerminalState !== 'active' ||
    compositionWorkInProgress;
  const workbenchCloseLocked =
    phase === 'committing' ||
    unifiedImportRunning ||
    renderTerminalState !== 'active';
  const selectWorkbenchSection = (section: FlaWorkbenchSection): void => {
    if (workbenchActionsLocked) return;
    if (section === 'source-assets' && !hasSourceBitmaps) return;
    if (section === 'compositions') {
      if (!compositionWorkbenchMounted) {
        if (renderMode === 'snapshot') setSnapshotWorkInProgress(true);
        else setSequenceWorkInProgress(true);
      }
      setCompositionWorkbenchMounted(true);
      if (renderMode === 'snapshot') setSnapshotWorkbenchMounted(true);
      else setSequenceWorkbenchMounted(true);
    }
    setWorkbenchSection(section);
  };
  const selectAll = (): void => {
    if (selectionLocked) return;
    rememberReviewScroll();
    checkUnifiedCandidates(rasterCandidates.map(describeFlaUnifiedCandidate));
  };
  const clearAll = (): void => {
    if (selectionLocked) return;
    rememberReviewScroll();
    clearUnifiedCandidates(rasterCandidates
      .filter((candidate) => candidate.checked)
      .map(flaUnifiedCandidateSelectionKey));
  };
  const selectRenderMode = (mode: FlaRenderWorkbenchMode): void => {
    if (phase === 'committing' || unifiedImportRunning || renderTerminalState !== 'active') return;
    setRenderMode(mode);
    setRenderTerminalState('active');
    if (mode === 'snapshot') {
      if (!snapshotWorkbenchMounted) setSnapshotWorkInProgress(true);
      setSnapshotWorkbenchMounted(true);
    } else {
      if (!sequenceWorkbenchMounted) setSequenceWorkInProgress(true);
      setSequenceWorkbenchMounted(true);
    }
  };

  return (
    <FlaReviewPortal>
      <section
        aria-label="FLA 导入工作台"
        aria-modal="true"
        className="fla-review-session"
        data-review-layout="portal"
        data-testid="fla-review-session"
        data-workbench-route={rasterRoute ? 'raster' : 'render'}
        role="dialog"
      >
        <header className="fla-review-heading fla-raster-review-heading" data-testid="fla-review-header">
          <div className="fla-review-heading-copy">
            <h2>FLA 导入工作台</h2>
            <nav
              aria-label="FLA 素材类型"
              className="fla-import-workbench-tabs"
              data-testid="fla-import-workbench-tabs"
              role="tablist"
            >
              <button
                aria-controls="fla-composition-panel"
                aria-selected={compositionRoute}
                className="fla-import-workbench-tab"
                data-testid="fla-workbench-tab-compositions"
                disabled={workbenchActionsLocked}
                id="fla-workbench-tab-compositions"
                onClick={() => selectWorkbenchSection('compositions')}
                role="tab"
                type="button"
              >
                组合素材
              </button>
              <button
                aria-controls="fla-source-assets-panel"
                aria-selected={rasterRoute}
                className="fla-import-workbench-tab"
                data-testid="fla-workbench-tab-source-assets"
                disabled={!hasSourceBitmaps || workbenchActionsLocked}
                id="fla-workbench-tab-source-assets"
                onClick={() => selectWorkbenchSection('source-assets')}
                role="tab"
                type="button"
              >
                原始位图 / 零件
              </button>
            </nav>
          </div>
          {!workbenchCloseLocked ? (
            <button
              data-testid="fla-review-cancel"
              onClick={() => void closeSession()}
              type="button"
            >
              取消
            </button>
          ) : null}
        </header>

        <div
          className="fla-review-body"
          data-preserves-scroll-position="true"
          data-testid="fla-review-body"
          onScroll={(event) => {
            reviewScrollTop.current = event.currentTarget.scrollTop;
          }}
          ref={reviewBodyRef}
        >
          {rasterRoute && response?.ok === true && response.trace?.recoveryApplied ? (
            <output
              className="fla-review-recovery-notice"
              data-testid="fla-review-recovery-notice"
              role="status"
            >
              Panda 已处理一个兼容性问题；原 FLA 文件没有被修改。
            </output>
          ) : null}
          {hasSourceBitmaps ? (
            <div
              aria-labelledby="fla-workbench-tab-source-assets"
              className="fla-raster-workbench"
              data-testid="fla-raster-workbench"
              hidden={!rasterRoute}
              id="fla-source-assets-panel"
              role="tabpanel"
            >
              <aside className="fla-raster-overview" data-testid="fla-raster-overview">
                <div>
                  <p className="fla-raster-panel-kicker">FLA 文件 · 只读预览</p>
                  <h3 title={ir.source.basename}>{ir.source.basename}</h3>
                </div>
                <dl className="fla-review-summary" data-testid="fla-review-summary">
                  <div><dt>舞台</dt><dd>{ir.document.width} × {ir.document.height} · {ir.document.frameRate} fps</dd></div>
                  <div><dt>位图摘要</dt><dd data-testid="fla-review-media-count">{ir.media.length} 项位图 · {usedMediaCount} 已使用 · {libraryOnlyMediaCount} 仅素材库</dd></div>
                </dl>
                <details className="fla-raster-file-details" data-testid="fla-raster-file-details">
                  <summary>文件详情</summary>
                  <dl className="fla-review-summary">
                    <div><dt>格式</dt><dd>{ir.source.format.toUpperCase()}</dd></div>
                    <div><dt>文件大小</dt><dd>{ir.source.byteLength.toLocaleString('en-US')} bytes</dd></div>
                    <div><dt>解析器</dt><dd>{ir.source.parser.entrypoint}</dd></div>
                  </dl>
                </details>
                {ir.structure ? (
                  <details className="fla-raster-structure" data-testid="fla-raster-structure">
                    <summary>结构信息</summary>
                    <dl className="fla-review-summary">
                      <FlaStructuralSummaryReadOnly summary={ir.structure} />
                    </dl>
                  </details>
                ) : null}
                <section
                  aria-label="兼容性说明"
                  className="fla-review-compatibility"
                  data-stage-f-severity={warnings.length > 0 ? 'warning' : 'clear'}
                  data-testid="fla-stage-f1-raster-warning"
                >
                  <details
                    className="fla-review-compatibility-notes"
                    data-testid="fla-compatibility-notes"
                    open={compatibilityNotesOpen}
                  >
                    <summary
                      className="fla-raster-compatibility-summary"
                      onClick={(event) => {
                        event.preventDefault();
                        rememberReviewScroll();
                        setCompatibilityNotesOpen((current) => !current);
                      }}
                    >
                      <strong data-testid="fla-raster-compatibility-summary">
                        {warnings.length > 0 ? `⚠ ${warnings.length} 个兼容性提示` : '无兼容性提示'}
                      </strong>
                      <span>查看兼容性说明</span>
                    </summary>
                    <ul data-testid="fla-compatibility-summary">
                      {FLA_COMPATIBILITY_STATUSES.map((status) => (
                        <li data-status={status} key={status}>
                          <strong>{FLA_COMPATIBILITY_LABELS[status]}</strong>
                          <span>{counts[status]}</span>
                        </li>
                      ))}
                    </ul>
                    {warnings.length > 0 ? (
                      <ul className="fla-review-warnings" data-testid="fla-compatibility-warnings">
                        {warnings.map((warning) => (
                          <li key={`${warning.feature}:${warning.status}`}>
                            <strong>{FLA_COMPATIBILITY_LABELS[warning.status]} · {compatibilityFeatureLabel(warning.feature)}</strong>
                            <span>{compatibilityReason(warning.feature, warning.status, warning.reason)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                </section>
              </aside>

              <section aria-labelledby="fla-raster-grid-heading" className="fla-raster-selection" data-testid="fla-raster-selection">
                <header className="fla-raster-selection-header">
                  <div>
                    <p className="fla-raster-panel-kicker">选择素材</p>
                    <h3 id="fla-raster-grid-heading">位图素材</h3>
                  </div>
                  <div className="fla-raster-grid-count" data-testid="fla-raster-grid-count">
                    <strong>{filteredReviewItems.length} / {reviewItems.length}</strong>
                    <span>{selectedCount} 已选</span>
                  </div>
                </header>
                <div className="fla-raster-browse-controls" data-testid="fla-raster-browse-controls">
                  <div
                    aria-label="筛选位图素材"
                    className="fla-raster-filter-group"
                    role="group"
                  >
                    {([
                      ['all', '全部'],
                      ['selected', '已选'],
                      ['unselected', '未选'],
                    ] as const).map(([filter, label]) => (
                      <button
                        aria-pressed={rasterFilter === filter}
                        className={rasterFilter === filter ? 'is-active' : undefined}
                        data-testid={`fla-review-filter-${filter}`}
                        key={filter}
                        onClick={() => changeRasterFilter(filter)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="fla-raster-search">
                    <span>搜索文件名</span>
                    <input
                      aria-label="搜索文件名"
                      data-testid="fla-review-search"
                      onChange={(event) => changeRasterSearch(event.currentTarget.value)}
                      placeholder="搜索文件名"
                      type="search"
                      value={rasterSearch}
                    />
                  </label>
                  <div className="fla-raster-browse-secondary">
                    <div className="fla-raster-selection-utilities" aria-label="全局选择工具">
                      <button
                        data-testid="fla-review-select-all"
                        disabled={selectionLocked}
                        onClick={selectAll}
                        type="button"
                      >
                        全选
                      </button>
                      <button
                        data-testid="fla-review-clear-all"
                        disabled={selectionLocked}
                        onClick={clearAll}
                        type="button"
                      >
                        清空
                      </button>
                    </div>
                    <label className="fla-raster-page-size">
                      <span>每页</span>
                      <select
                        aria-label="每页数量"
                        data-testid="fla-review-page-size"
                        onChange={(event) => changeRasterPageSize(Number(event.currentTarget.value))}
                        value={rasterPageSize}
                      >
                        {FLA_RASTER_REVIEW_PAGE_SIZES.map((size) => (
                          <option key={size} value={size}>{size}</option>
                        ))}
                      </select>
                    </label>
                    <nav aria-label="位图素材分页" className="fla-raster-pagination" data-testid="fla-review-pagination">
                      <button
                        aria-label="上一页"
                        disabled={rasterPage <= 1}
                        onClick={() => changeRasterPage(-1)}
                        type="button"
                      >
                        ‹
                      </button>
                      <span data-testid="fla-review-page-status">{rasterPage} / {rasterPageCount}</span>
                      <button
                        aria-label="下一页"
                        disabled={rasterPage >= rasterPageCount}
                        onClick={() => changeRasterPage(1)}
                        type="button"
                      >
                        ›
                      </button>
                    </nav>
                  </div>
                </div>
                <div
                  aria-label="FLA 位图素材"
                  className="fla-review-media-grid"
                  data-scroll-region="fla-media-grid"
                  data-testid="fla-review-media-grid"
                >
                  {pagedReviewItems.length > 0 ? pagedReviewItems.map((item) => (
                    <FlaReviewMediaCard
                      candidateIdentity={candidateByMediaId.get(item.media.id)?.identityKey ?? item.media.id}
                      displayLabel={candidateByMediaId.get(item.media.id)?.displayLabel ?? item.media.name}
                      focused={effectiveFocusedMediaId === item.media.id}
                      item={item}
                      key={item.media.id}
                      previewBindingKey={candidateByMediaId.get(item.media.id)?.preview.bindingKey ?? item.media.id}
                      selected={candidateByMediaId.get(item.media.id)?.checked ?? false}
                      selectionLocked={selectionLocked}
                      thumbnailUrl={thumbnailUrls[item.media.id]}
                      onFocus={() => setRasterSelection((current) => focusFlaWorkbenchCandidate(current, item.media.id))}
                      onToggle={() => {
                        const candidate = candidateByMediaId.get(item.media.id);
                        if (candidate) toggleUnifiedCandidate(describeFlaUnifiedCandidate(candidate), !candidate.checked);
                      }}
                    />
                  )) : (
                    <p className="fla-raster-empty" data-testid="fla-review-empty-state">
                      没有匹配的位图素材，请清除搜索或筛选条件。
                    </p>
                  )}
                </div>
              </section>

              <aside className="fla-raster-detail" data-testid="fla-raster-detail">
                <p className="fla-raster-panel-kicker">素材详情</p>
                {focusedItem ? (
                  <FlaReviewMediaDetail
                    displayLabel={candidateByMediaId.get(focusedItem.media.id)?.displayLabel ?? focusedItem.media.name}
                    item={focusedItem}
                    selected={candidateByMediaId.get(focusedItem.media.id)?.checked ?? false}
                    thumbnailUrl={thumbnailUrls[focusedItem.media.id]}
                  />
                ) : (
                  <p>聚焦一个位图素材以查看详情。</p>
                )}
              </aside>
            </div>
          ) : null}
          {compositionWorkbenchMounted ? (
            <div
              aria-labelledby="fla-workbench-tab-compositions"
              className="fla-review-zero-raster"
              data-testid="fla-review-zero-raster"
              hidden={!compositionRoute}
              id="fla-composition-panel"
              role="tabpanel"
            >
              <FlaRenderWorkbench
                compatibility={ir.compatibility}
                mode={renderMode}
                onModeChange={selectRenderMode}
                sourceBasename={ir.source.basename}
                terminalState={renderTerminalState}
              >
                {snapshotWorkbenchMounted ? (
                  <div data-testid="fla-unified-snapshot-panel" hidden={renderMode !== 'snapshot'}>
                    <FlaStaticSnapshotReview
                      key={`${sessionId}:${ir.source.sha256}:snapshot`}
                      checkedCandidateKeys={checkedCandidateKeys}
                      importLocked={unifiedImportRunning}
                      onToggleCandidate={toggleUnifiedCandidate}
                      onCheckCandidates={checkUnifiedCandidates}
                      onClearCandidates={clearUnifiedCandidates}
                      onReconcileCandidates={reconcileUnifiedCandidates}
                      onRegisterImportRunner={registerSnapshotImportRunner}
                      onWorkInProgressChange={setSnapshotWorkInProgress}
                      onTerminalStateChange={setRenderTerminalState}
                      sessionId={sessionId}
                      source={{ basename: ir.source.basename, sha256: ir.source.sha256 }}
                      stage={ir.document}
                      onImported={(response) => onSnapshotImported?.(response)}
                    />
                  </div>
                ) : null}
                {sequenceWorkbenchMounted ? (
                  <div data-testid="fla-unified-sequence-panel" hidden={renderMode !== 'sequence'}>
                    <FlaFrameSequenceReview
                      key={`${sessionId}:${ir.source.sha256}:sequence`}
                      checkedCandidateKeys={checkedCandidateKeys}
                      importLocked={unifiedImportRunning}
                      onToggleCandidate={toggleUnifiedCandidate}
                      onReconcileCandidates={reconcileUnifiedCandidates}
                      onRegisterImportRunner={registerSequenceImportRunner}
                      onWorkInProgressChange={setSequenceWorkInProgress}
                      onTerminalStateChange={setRenderTerminalState}
                      sessionId={sessionId}
                      source={{ basename: ir.source.basename, sha256: ir.source.sha256 }}
                      embedded
                      snapshot={snapshot}
                      onImported={(response) => onSequenceImported?.(response)}
                    />
                  </div>
                ) : null}
              </FlaRenderWorkbench>
            </div>
          ) : null}
        </div>

        <div className="fla-review-action-stack fla-unified-import-action-stack" data-testid="fla-unified-import-action-stack">
          <div className="fla-review-action-bar fla-review-selection-toolbar" data-testid="fla-unified-import-action-bar">
            <div>
              <strong data-testid="fla-unified-import-selected-count">
                {unifiedImportRunning
                  ? stopAfterCurrentRequested ? '当前操作完成后将停止后续导入' : `正在导入已选 ${selectedUnifiedItems.length} 项…`
                  : `${selectedUnifiedItems.length} 项已选`}
              </strong>
              {unifiedImportRunning ? (
                <output data-testid="fla-unified-import-progress" role="status">
                  已提交操作不会中断；停止后将保留已完成结果。
                </output>
              ) : null}
            </div>
            <div className="fla-review-action-buttons">
              {unifiedImportRunning ? (
                <button
                  className="fla-review-action-cancel"
                  data-testid="fla-unified-import-stop"
                  disabled={stopAfterCurrentRequested}
                  onClick={requestStopAfterCurrent}
                  type="button"
                >
                  {stopAfterCurrentRequested ? '已请求停止' : '停止后续导入'}
                </button>
              ) : (
                <button
                  className="fla-review-primary-action"
                  data-testid="fla-unified-import"
                  disabled={!canImportSelected}
                  onClick={() => void runImportAction()}
                  type="button"
                >
                  导入 {selectedUnifiedItems.length} 项
                </button>
              )}
            </div>
          </div>
          {importReceipt ? (
            <section
              aria-label="统一导入回执"
              className="fla-unified-import-receipt"
              data-testid="fla-unified-import-receipt"
              data-partial={importReceipt.partial ? 'true' : 'false'}
              role={importReceipt.partial ? 'alert' : 'status'}
            >
              <strong>导入回执</strong>
              <output data-testid="fla-unified-import-counts">
                共 {importReceipt.selectedCount} 项：新导入 {importReceipt.counts.imported} 项、复用 {importReceipt.counts.duplicate} 项、失败 {importReceipt.counts.failed} 项、未尝试 {importReceipt.counts.notAttempted} 项。
              </output>
              <output data-testid="fla-unified-import-asset-counts">
                新建素材 {importReceipt.counts.importedAssets} 项、复用素材 {importReceipt.counts.duplicateAssets} 项。
              </output>
              {importReceipt.cancelled ? <span data-testid="fla-unified-import-cancelled">已停止后续导入。</span> : null}
              {importReceipt.warnings.map((warning, index) => (
                <p key={`${index}-${warning}`} role="alert">{warning}</p>
              ))}
              <ul data-testid="fla-unified-import-items">
                {importReceipt.items.map((item) => (
                  <li
                    data-base-revision={item.baseRevision}
                    data-kind={item.kind}
                    data-saved-revision={item.savedRevision}
                    data-status={item.status}
                    key={item.key}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.status === 'imported' ? '已导入' : item.status === 'duplicate' ? '已复用' : item.status === 'failed' ? '失败' : '未尝试'}</span>
                    {item.baseRevision !== undefined && item.savedRevision !== undefined ? (
                      <small>项目版本 {item.baseRevision} → {item.savedRevision}</small>
                    ) : null}
                    {item.message ? <small>{item.message}</small> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </section>
    </FlaReviewPortal>
  );
}

function FlaReviewMediaCard({
  candidateIdentity,
  displayLabel,
  focused,
  item,
  previewBindingKey,
  selected,
  selectionLocked,
  thumbnailUrl,
  onFocus,
  onToggle,
}: {
  candidateIdentity: string;
  displayLabel: string;
  focused: boolean;
  item: FlaReviewMedia;
  previewBindingKey: string;
  selected: boolean;
  selectionLocked: boolean;
  thumbnailUrl?: string;
  onFocus: () => void;
  onToggle: () => void;
}): React.JSX.Element {
  const { media } = item;
  return (
    <article
      aria-label={displayLabel}
      className={`fla-review-media-card${selected ? ' fla-review-media-card-selected' : ''}${focused ? ' fla-review-media-card-focused' : ''}`}
      data-alpha-kind={media.payload.alpha.kind}
      data-fla-candidate-id={candidateIdentity}
      data-fla-media-id={media.id}
      data-library-only={item.libraryOnly ? 'true' : 'false'}
      data-source-format={media.sourceFormat}
      data-target-file-name={item.name.targetFileName}
      data-testid={`fla-review-media-card-${media.id}`}
      data-zero-alpha-pixels={media.payload.alpha.zeroAlphaPixels}
      data-preview-binding-key={previewBindingKey}
    >
      <label>
        <input
          aria-label={`选择 ${displayLabel}`}
          checked={selected}
          data-selection-target="checkbox"
          disabled={selectionLocked}
          onChange={onToggle}
          type="checkbox"
        />
        <span>{selected ? '已选' : '选择'}</span>
      </label>
      <div
        aria-label={`预览 ${displayLabel}`}
        className="fla-review-thumbnail"
        data-selection-target="thumbnail"
        onClick={onFocus}
        onFocus={onFocus}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onFocus();
        }}
        role="button"
        tabIndex={0}
      >
        {thumbnailUrl ? (
          <img alt={displayLabel} loading="lazy" src={thumbnailUrl} />
        ) : (
          <span>缩略图不可用</span>
        )}
      </div>
      <strong title={media.name}>{displayLabel}</strong>
      <span className="fla-review-media-usage" data-usage-state={item.libraryOnly ? 'library-only' : 'used'}>
        {item.libraryOnly ? '仅素材库' : '已使用'}
      </span>
      {item.warnings.length > 0 ? <span className="fla-review-card-warning">需确认文件名</span> : null}
    </article>
  );
}

function FlaReviewMediaDetail({
  displayLabel,
  item,
  selected,
  thumbnailUrl,
}: {
  displayLabel: string;
  item: FlaReviewMedia;
  selected: boolean;
  thumbnailUrl?: string;
}): React.JSX.Element {
  const { media } = item;
  const normalizedSourceReference = media.sourceReference.replaceAll('\\', '/');
  const sourceBasename = normalizedSourceReference.slice(
    normalizedSourceReference.lastIndexOf('/') + 1,
  );
  const sourceMatchesTarget = sourceBasename.toLocaleLowerCase('en-US') ===
    item.name.targetFileName.toLocaleLowerCase('en-US');
  return (
    <div className="fla-review-media-detail-content" data-focused-media-id={media.id}>
      <div className="fla-review-detail-preview">
        {thumbnailUrl ? (
          <img alt={displayLabel} src={thumbnailUrl} />
        ) : (
          <span>预览不可用</span>
        )}
      </div>
      <div className="fla-review-detail-heading">
        <h3 title={media.name}>{displayLabel}</h3>
        <span data-selected={selected ? 'true' : 'false'}>{selected ? '已选择' : '未选择'}</span>
      </div>
      <dl>
        <div><dt>尺寸与格式</dt><dd>{media.width} × {media.height} · {media.sourceFormat.toUpperCase()}</dd></div>
        <div><dt>使用状态</dt><dd>{item.libraryOnly ? '仅素材库' : '已在舞台中使用'}</dd></div>
        {sourceMatchesTarget ? (
          <div><dt>来源与目标</dt><dd title={media.sourceReference}>{media.sourceReference}（保持文件名）</dd></div>
        ) : (
          <>
            <div><dt>来源</dt><dd title={media.sourceReference}>{media.sourceReference}</dd></div>
            <div><dt>目标文件名</dt><dd>{item.name.targetFileName}</dd></div>
          </>
        )}
      </dl>
      {item.warnings.length > 0 ? (
        <div className="fla-review-detail-warnings" data-testid="fla-review-detail-warnings" role="note">
          <strong>文件名提醒</strong>
          <ul className="fla-review-name-warnings">
            {item.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Primary user-facing diagnostic copy derived from the response.  Prefers the
 * most specific category (archive-malformed) and otherwise falls back to the
 * first attached diagnostic.  Returns `null` when no diagnostic is present so
 * callers can show a neutral fallback without implying a specific cause.
 * Developer-only detail fields are never surfaced here.
 */
function flaDiagnosticUserMessage(response: FlaInspectionResponse | null): string | null {
  const diagnostics = response?.diagnostics;
  if (!diagnostics || diagnostics.length === 0) return null;
  const archive = diagnostics.find(
    (diagnostic) => diagnostic.category === 'archive-malformed',
  );
  return (archive ?? diagnostics[0]!).userMessage;
}

function FlaStructuralSummaryReadOnly({
  summary,
}: {
  summary: FlaStructuralSummary;
}): React.JSX.Element {
  const symbolBreakdown: string[] = [];
  if (summary.graphicCount > 0) symbolBreakdown.push(`图形 ${summary.graphicCount}`);
  if (summary.movieClipCount > 0) symbolBreakdown.push(`影片剪辑 ${summary.movieClipCount}`);
  if (summary.buttonCount > 0) symbolBreakdown.push(`按钮 ${summary.buttonCount}`);
  return (
    <div
      className="fla-review-structure"
      data-testid="fla-review-structure"
      role="group"
      aria-label="FLA 结构信息"
    >
      <div className="fla-review-structure-row">
        <dt>场景</dt>
        <dd data-testid="fla-review-structure-scene">{summary.sceneCount}</dd>
      </div>
      <div className="fla-review-structure-row">
        <dt>元件</dt>
        <dd data-testid="fla-review-structure-symbol">
          {summary.symbolCount}
          {symbolBreakdown.length > 0
            ? `（${symbolBreakdown.join('、')}）`
            : ''}
        </dd>
      </div>
      <div className="fla-review-structure-row">
        <dt>图层</dt>
        <dd data-testid="fla-review-structure-layer">{summary.layerCount}</dd>
      </div>
      <div className="fla-review-structure-row">
        <dt>帧</dt>
        <dd data-testid="fla-review-structure-frame">{summary.frameCount}</dd>
      </div>
      {summary.tweenCount > 0 ? (
        <div className="fla-review-structure-row">
          <dt>补间</dt>
          <dd data-testid="fla-review-structure-tween">{summary.tweenCount}</dd>
        </div>
      ) : null}
    </div>
  );
}

function compatibilityFeatureLabel(feature: string): string {
  const labels: Readonly<Record<string, string>> = {
    'actionscript': 'ActionScript 脚本',
    'basic-tweens': '基础补间',
    'bitmap-media': '位图素材',
    'symbol-movieclip-semantics': '元件/影片剪辑',
    'timeline-frame-placement': '时间轴使用',
    'unresolved-bitmap-reference': '位图引用',
  };
  return labels[feature] ?? '其他功能';
}

function compatibilityReason(
  feature: string,
  status: FlaCompatibilityStatus,
  reason: string,
): string {
  if (feature === 'unresolved-bitmap-reference') {
    const prefix = 'Bitmap reference was not found: ';
    return reason.startsWith(prefix)
      ? `未找到位图引用：${reason.slice(prefix.length)}`
      : '未找到对应的位图引用。';
  }
  if (status === 'exact') return '此类内容可以在当前预览中使用。';
  if (status === 'degraded') return '当前可预览，时间轴动画暂不导入。';
  if (status === 'unsupported') return '此类内容暂不在当前 FLA 导入范围内。';
  if (status === 'not-present') return '源文件中未发现此类内容。';
  return '暂时无法确定此类内容的兼容性。';
}

function FlaReviewPortal({ children }: { children: ReactNode }): React.JSX.Element {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const appRoot = document.getElementById('root');
    if (!appRoot) return undefined;
    const wasInert = appRoot.inert;
    appRoot.inert = true;
    return () => {
      appRoot.inert = wasInert;
    };
  }, []);

  const surface = (
    <div
      aria-label="FLA 兼容性预览前景层"
      className="fla-review-portal"
      data-testid="fla-review-portal"
    >
      <div
        aria-hidden="true"
        className="fla-review-backdrop"
        data-testid="fla-review-backdrop"
      />
      {children}
    </div>
  );
  if (typeof document === 'undefined') return <>{children}</>;
  return createPortal(surface, document.body);
}
