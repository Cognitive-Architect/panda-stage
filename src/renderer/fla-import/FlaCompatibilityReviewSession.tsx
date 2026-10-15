import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { FlaInspectionResponse } from '../../shared/fla-import-api';
import type { FlaAssetCommitResponse } from '../../shared/fla-asset-commit-api';
import type { FlaStaticSnapshotCommitResponse } from '../../shared/fla-static-snapshot-api';
import type { FlaFrameSequenceCommitResponse } from '../../shared/fla-frame-sequence-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { reviewMedia } from './fla-review';
import {
  createFlaWorkbenchCandidateSelection,
  createFlaWorkbenchCandidates,
  focusFlaWorkbenchCandidate,
  sortFlaWorkbenchCandidates,
  type FlaWorkbenchCandidate,
} from './fla-workbench-candidates';
import {
  isFlaInspectionUserCancelled,
  subscribeToFlaInspection,
  type FlaInspectionOperation,
} from './fla-inspection-lifecycle';
import { FlaStaticSnapshotReview } from './FlaStaticSnapshotReview';
import { FlaFrameSequenceReview } from './FlaFrameSequenceReview';
import type { FlaStageGTerminalState } from './FlaStageGTerminal';
import { FlaStageAInspecting } from './FlaStageAInspecting';
import { FlaStageF3Blocked } from './FlaStageF';
import { FlaUnifiedWorkbench, type FlaUnifiedWorkbenchProgress } from './FlaUnifiedWorkbench';
import {
  describeFlaUnifiedCandidate,
  flaUnifiedCandidateSelectionKey,
  runFlaUnifiedImport,
  type FlaUnifiedImportItem,
  type FlaUnifiedImportReceipt,
  type FlaUnifiedImportRunner,
} from './fla-unified-import';
import {
  newSelectableFlaUnifiedCandidates,
  reconcileFlaUnifiedSelection,
  requiresFlaBulkSelectionConfirmation,
} from './fla-unified-workbench-selection';

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
  const [snapshotCandidates, setSnapshotCandidates] = useState<readonly FlaWorkbenchCandidate[]>([]);
  const [sequenceCandidates, setSequenceCandidates] = useState<readonly FlaWorkbenchCandidate[]>([]);
  const [focusedCandidateIdentityKey, setFocusedCandidateIdentityKey] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [bulkConfirmationOpen, setBulkConfirmationOpen] = useState(false);
  const [catalogProgress, setCatalogProgress] = useState<FlaUnifiedWorkbenchProgress>({
    phase: 'loading', completed: 0, total: 0, omittedCandidateCount: 0,
  });
  const [checkedCandidates, setCheckedCandidates] = useState<Map<string, FlaUnifiedImportItem>>(() => new Map());
  const [importReceipt, setImportReceipt] = useState<FlaUnifiedImportReceipt | null>(null);
  const [unifiedImportRunning, setUnifiedImportRunning] = useState(false);
  const [stopAfterCurrentRequested, setStopAfterCurrentRequested] = useState(false);
  const [importRunnerRevision, setImportRunnerRevision] = useState(0);
  const [thumbnailUrls, setThumbnailUrls] = useState<Readonly<Record<string, string>>>({});
  const [snapshotWorkInProgress, setSnapshotWorkInProgress] = useState(false);
  const [sequenceWorkInProgress, setSequenceWorkInProgress] = useState(false);
  const [renderTerminalState, setRenderTerminalState] = useState<FlaStageGTerminalState>('active');
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
          setRasterSelection(createFlaWorkbenchCandidateSelection());
          setSnapshotCandidates([]);
          setSequenceCandidates([]);
          setFocusedCandidateIdentityKey(null);
          setSearchText('');
          setSelectedOnly(false);
          setBulkConfirmationOpen(false);
          setCatalogProgress({ phase: 'loading', completed: 0, total: 0, omittedCandidateCount: 0 });
          setCheckedCandidates(new Map());
          setImportReceipt(null);
          setSnapshotWorkInProgress(true);
          setSequenceWorkInProgress(true);
          setRenderTerminalState('active');
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
  const visibleSequenceCandidates = useMemo(
    () => sequenceCandidates.filter((candidate): candidate is Extract<FlaWorkbenchCandidate, { kind: 'sequence' }> =>
      candidate.kind === 'sequence' && candidate.provenance.frameCount > 1,
    ),
    [sequenceCandidates],
  );
  const unifiedCandidates = useMemo(
    () => sortFlaWorkbenchCandidates([
      ...rasterCandidates,
      ...snapshotCandidates,
      ...visibleSequenceCandidates,
    ]).map((candidate) => ({
      ...candidate,
      checked: candidate.selectable && checkedCandidateKeys.has(flaUnifiedCandidateSelectionKey(candidate)),
      focused: candidate.identityKey === focusedCandidateIdentityKey,
    })),
    [checkedCandidateKeys, focusedCandidateIdentityKey, rasterCandidates, snapshotCandidates, visibleSequenceCandidates],
  );
  const selectedCount = checkedCandidates.size;
  const focusedCandidate = unifiedCandidates.find((candidate) =>
    candidate.identityKey === focusedCandidateIdentityKey,
  ) ?? null;
  const focusedRenderTargetId = focusedCandidate && focusedCandidate.kind !== 'raster'
    ? focusedCandidate.provenance.renderTargetId
    : null;
  const focusedSnapshotCandidate = focusedCandidate?.kind === 'snapshot'
    ? focusedCandidate
    : focusedCandidate?.kind === 'sequence'
      ? unifiedCandidates.find((candidate) => candidate.kind === 'snapshot' &&
        candidate.provenance.renderTargetId === focusedRenderTargetId) ?? null
      : null;
  const focusedSequenceCandidate = focusedCandidate?.kind === 'sequence'
    ? focusedCandidate
    : focusedCandidate?.kind === 'snapshot' && focusedCandidate.operation.target.frameCount > 1
      ? visibleSequenceCandidates.find((candidate) => candidate.provenance.renderTargetId === focusedRenderTargetId) ?? null
      : null;
  const showSnapshotPreview = Boolean(focusedSnapshotCandidate?.selectable &&
    !(focusedCandidate?.kind === 'sequence' && focusedCandidate.selectable) &&
    !(focusedCandidate?.kind === 'sequence' && (!focusedCandidate.supported || focusedCandidate.blank || focusedCandidate.preview.status === 'error')));
  const showSequencePreview = Boolean(focusedSequenceCandidate?.supported && !focusedSequenceCandidate.blank &&
    !(focusedCandidate?.kind === 'sequence' && focusedCandidate.preview.status === 'error'));
  const showGeneratedSequencePreview = focusedCandidate?.kind === 'sequence' && focusedCandidate.selectable;
  const selectionLocked = unifiedImportRunning;
  const newEligibleCandidates = useMemo(() => {
    return newSelectableFlaUnifiedCandidates(unifiedCandidates, searchText);
  }, [searchText, unifiedCandidates]);

  useEffect(() => {
    if (unifiedCandidates.length === 0 || catalogProgress.phase === 'loading') return;
    if (focusedCandidateIdentityKey && unifiedCandidates.some((candidate) =>
      candidate.identityKey === focusedCandidateIdentityKey,
    )) return;
    setFocusedCandidateIdentityKey(unifiedCandidates[0]?.identityKey ?? null);
  }, [catalogProgress.phase, focusedCandidateIdentityKey, unifiedCandidates]);

  useEffect(() => {
    if (!ir) return undefined;
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
  const focusUnifiedCandidate = (candidate: FlaWorkbenchCandidate): void => {
    if (unifiedImportRunningRef.current) return;
    setFocusedCandidateIdentityKey(candidate.identityKey);
    if (candidate.kind === 'raster') {
      setRasterSelection((current) => focusFlaWorkbenchCandidate(current, candidate.id));
    }
  };
  const selectCurrentResults = (): void => {
    if (selectionLocked || selectedOnly || newEligibleCandidates.length === 0) return;
    const items = newEligibleCandidates.map(describeFlaUnifiedCandidate);
    if (requiresFlaBulkSelectionConfirmation(items.length)) {
      setBulkConfirmationOpen(true);
      return;
    }
    checkUnifiedCandidates(items);
    setBulkConfirmationOpen(false);
  };
  const confirmCurrentResults = (): void => {
    if (selectionLocked) return;
    const items = newEligibleCandidates.map(describeFlaUnifiedCandidate);
    if (items.length > 0) checkUnifiedCandidates(items);
    setBulkConfirmationOpen(false);
  };
  const clearAllUnifiedCandidates = (): void => {
    if (selectionLocked) return;
    setCheckedCandidates(new Map());
    setBulkConfirmationOpen(false);
  };
  const reconcileUnifiedCandidates = useCallback((
    kind: 'raster' | 'snapshot' | 'sequence',
    currentSelectableKeys: ReadonlySet<string>,
  ): void => {
    setCheckedCandidates((current) => reconcileFlaUnifiedSelection(current, kind, currentSelectableKeys));
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
    setBulkConfirmationOpen(false);
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
      setCheckedCandidates(new Map());
      setSelectedOnly(false);
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
      setCheckedCandidates(new Map());
      setSelectedOnly(false);
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

  useEffect(() => {
    if (!ir || !sessionId) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeSession();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [closeSession, ir, sessionId]);

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

  const closeLocked = phase === 'committing' || unifiedImportRunning || renderTerminalState !== 'active';
  const snapshotPreview = (
    <FlaStaticSnapshotReview
      key={sessionId + ':' + ir.source.sha256 + ':snapshot'}
      checkedCandidateKeys={checkedCandidateKeys}
      importLocked={unifiedImportRunning}
      onToggleCandidate={toggleUnifiedCandidate}
      onCheckCandidates={checkUnifiedCandidates}
      onClearCandidates={clearUnifiedCandidates}
      onReconcileCandidates={reconcileUnifiedCandidates}
      onRegisterImportRunner={registerSnapshotImportRunner}
      onWorkInProgressChange={setSnapshotWorkInProgress}
      onTerminalStateChange={setRenderTerminalState}
      onCandidatesChange={setSnapshotCandidates}
      onCatalogProgressChange={setCatalogProgress}
      focusedCandidateIdentityKey={focusedSnapshotCandidate?.identityKey ?? null}
      presentation="unified-preview"
      sessionId={sessionId}
      source={{ basename: ir.source.basename, sha256: ir.source.sha256 }}
      stage={ir.document}
      onImported={(result) => onSnapshotImported?.(result)}
    />
  );
  const sequencePreview = (
    <FlaFrameSequenceReview
      key={sessionId + ':' + ir.source.sha256 + ':sequence'}
      checkedCandidateKeys={checkedCandidateKeys}
      importLocked={unifiedImportRunning}
      onToggleCandidate={toggleUnifiedCandidate}
      onReconcileCandidates={reconcileUnifiedCandidates}
      onRegisterImportRunner={registerSequenceImportRunner}
      onWorkInProgressChange={setSequenceWorkInProgress}
      onTerminalStateChange={setRenderTerminalState}
      onCandidatesChange={setSequenceCandidates}
      focusedCandidateIdentityKey={focusedSequenceCandidate?.identityKey ?? null}
      showUnifiedSequencePreview={showGeneratedSequencePreview}
      presentation="unified-preview"
      sessionId={sessionId}
      source={{ basename: ir.source.basename, sha256: ir.source.sha256 }}
      embedded
      snapshot={snapshot}
      onImported={(result) => onSequenceImported?.(result)}
    />
  );

  return (
    <FlaReviewPortal>
      <section
        aria-label="FLA 导入工作台"
        aria-modal="true"
        className="fla-review-session fla-c03-session"
        data-review-layout="portal"
        data-testid="fla-review-session"
        data-workbench-route="unified"
        role="dialog"
      >
        <header className="fla-c03-header" data-testid="fla-review-header">
          <div>
            <h1 title={ir.source.basename}>{ir.source.basename}</h1>
          </div>
          <button
            aria-label="关闭"
            data-testid="fla-review-cancel"
            disabled={closeLocked}
            onClick={closeSession}
            title={closeLocked ? '项目保存完成前不能关闭；可停止后续导入。' : undefined}
            type="button"
          >
            ×
          </button>
        </header>

        <FlaUnifiedWorkbench
          candidates={unifiedCandidates}
          focusedCandidateIdentityKey={focusedCandidateIdentityKey}
          searchText={searchText}
          selectedOnly={selectedOnly}
          selectedCount={selectedCount}
          locked={selectionLocked}
          canImport={canImportSelected}
          importing={unifiedImportRunning}
          stopAfterCurrentRequested={stopAfterCurrentRequested}
          bulkConfirmationOpen={bulkConfirmationOpen}
          newEligibleCount={newEligibleCandidates.length}
          progress={catalogProgress}
          receipt={importReceipt}
          showSnapshotPreview={showSnapshotPreview}
          showSequencePreview={showSequencePreview}
          snapshotPreview={snapshotPreview}
          sequencePreview={sequencePreview}
          onSearchTextChange={(value) => {
            setSearchText(value);
          }}
          onToggleSelectedOnly={() => {
            setBulkConfirmationOpen(false);
            setSelectedOnly((current) => !current);
          }}
          onFocusCandidate={focusUnifiedCandidate}
          onToggleCandidate={(candidate, checked) => {
            toggleUnifiedCandidate(describeFlaUnifiedCandidate(candidate), checked);
          }}
          onSelectCurrentResults={selectCurrentResults}
          onConfirmBulkSelection={confirmCurrentResults}
          onCancelBulkSelection={() => setBulkConfirmationOpen(false)}
          onClearSelection={clearAllUnifiedCandidates}
          onImport={() => void runImportAction()}
          onStopAfterCurrent={requestStopAfterCurrent}
        />
      </section>
    </FlaReviewPortal>
  );
}

function flaDiagnosticUserMessage(response: FlaInspectionResponse | null): string | null {
  const diagnostics = response?.diagnostics;
  if (!diagnostics || diagnostics.length === 0) return null;
  const archive = diagnostics.find(
    (diagnostic) => diagnostic.category === 'archive-malformed',
  );
  return (archive ?? diagnostics[0]!).userMessage;
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
