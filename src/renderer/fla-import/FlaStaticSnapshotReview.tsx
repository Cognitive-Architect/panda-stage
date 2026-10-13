import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  FlaStaticSnapshotCommitError,
  FlaRenderableTargetCatalogEntry,
  FlaStaticSnapshotCommitResponse,
} from '../../shared/fla-static-snapshot-api';
import {
  finishIssue762Profile,
  startIssue762Profile,
} from '../../shared/issue762-performance-profile';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { boundedUnsupportedReason, FlaStageF2UnavailableDetails } from './FlaStageF';
import { FlaStageGRecovery, type FlaStageGTerminalState } from './FlaStageGTerminal';
import { flaStaticSnapshotClient, type FlaStaticSnapshotCatalogClient } from './fla-static-snapshot-render';
import {
  flaStaticSnapshotPreviewQueue,
  runFlaStaticSnapshotPreviewTransaction,
} from './fla-static-snapshot-preview-transaction';
import {
  flaStaticSnapshotCandidateKey,
  flaStaticSnapshotCandidateKindLabel,
  flaStaticSnapshotCandidateLabel,
  flaStaticSnapshotCandidateRole,
  groupFlaStaticSnapshotCandidates,
  type FlaStaticSnapshotCandidateFilter,
  type FlaStaticSnapshotCandidatePreview,
  type FlaStaticSnapshotCandidatePreviews,
} from './fla-static-snapshot-candidates';
import {
  checkFlaWorkbenchCandidates,
  clearFlaWorkbenchChecks,
  createFlaWorkbenchCandidateSelection,
  createFlaWorkbenchCandidates,
  flaWorkbenchSnapshotIdentityKey,
  focusFlaWorkbenchCandidate,
  reconcileFlaWorkbenchChecks,
  reconcileFlaWorkbenchFocus,
  toggleFlaWorkbenchCandidateChecked,
} from './fla-workbench-candidates';

interface FlaStaticSnapshotStageFacts {
  width: number;
  height: number;
  frameRate: number;
}

interface FlaStaticSnapshotReviewProps {
  sessionId: string;
  source: { basename: string; sha256: string };
  stage?: FlaStaticSnapshotStageFacts;
  snapshot: EditorProjectSnapshot | null;
  onImported: (response: FlaStaticSnapshotCommitResponse) => void;
  onClose: () => void;
  onCommitStateChange?: (busy: boolean) => void;
  onWorkInProgressChange?: (busy: boolean) => void;
  onTerminalStateChange?: (state: FlaStageGTerminalState) => void;
}

type SnapshotPhase = 'loading' | 'scanning' | 'ready' | 'committing' | 'completed' | 'partial' | 'error';
type ImportItemStatus = 'imported' | 'duplicate' | 'failed' | 'not-attempted';

export interface SnapshotImportItem {
  key: string;
  label: string;
  status: ImportItemStatus;
  assetId?: string;
  assetFileName?: string;
  message?: string;
}

export interface SnapshotImportReceipt {
  selectedCount: number;
  items: SnapshotImportItem[];
  partial: boolean;
  warnings: string[];
  recovery?: Pick<FlaStaticSnapshotCommitError, 'code' | 'message' | 'residualPaths'>;
}

type FocusedSnapshotPreview =
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; url: string; width: number; height: number }
  | { key: string; status: 'error'; message: string };

export function FlaStaticSnapshotReview({
  sessionId,
  source,
  stage,
  snapshot,
  onImported,
  onClose,
  onCommitStateChange,
  onWorkInProgressChange,
  onTerminalStateChange,
}: FlaStaticSnapshotReviewProps): React.JSX.Element {
  const [phase, setPhase] = useState<SnapshotPhase>('loading');
  const [entries, setEntries] = useState<FlaRenderableTargetCatalogEntry[]>([]);
  const [catalogSummary, setCatalogSummary] = useState('');
  const [omittedCandidateCount, setOmittedCandidateCount] = useState(0);
  const [previews, setPreviews] = useState<FlaStaticSnapshotCandidatePreviews>({});
  const [candidateSelection, setCandidateSelection] = useState(createFlaWorkbenchCandidateSelection);
  const [focusedPreview, setFocusedPreview] = useState<FocusedSnapshotPreview | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateFilter, setCandidateFilter] = useState<FlaStaticSnapshotCandidateFilter>('all');
  const [scanProgress, setScanProgress] = useState(0);
  const [importProgress, setImportProgress] = useState(0);
  const [receipt, setReceipt] = useState<SnapshotImportReceipt | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const previewUrlsRef = useRef(new Set<string>());
  const focusedPreviewUrlRef = useRef<{ key: string; url: string } | null>(null);
  const focusedCandidateIdentityKeyRef = useRef<string | null>(null);
  const activePreviewRequestIdRef = useRef<string | null>(null);
  const pendingScanProgressProfileRef = useRef<{
    progress: number;
    startedAt: number | null;
    candidateIndex: number;
    targetId: string;
    status: string;
  } | null>(null);
  const thumbnailImageLoadStartedAtRef = useRef(new Map<string, {
    startedAt: number | null;
    candidateIndex: number;
    targetId: string;
  }>());
  const candidateContext = useMemo(
    () => ({ sessionId, source: { basename: source.basename, sha256: source.sha256 } }),
    [sessionId, source.basename, source.sha256],
  );
  useLayoutEffect(() => {
    const pending = pendingScanProgressProfileRef.current;
    if (!pending || pending.progress !== scanProgress) return;
    finishIssue762Profile('ui.scan.react-state-commit', pending.startedAt, {
      candidateIndex: pending.candidateIndex,
      targetId: pending.targetId,
      status: pending.status,
    });
    pendingScanProgressProfileRef.current = null;
  }, [scanProgress]);

  const entryByKey = useMemo(
    () => new Map(entries.map((entry) => [flaStaticSnapshotCandidateKey(entry), entry])),
    [entries],
  );
  const candidates = useMemo(
    () => createFlaWorkbenchCandidates({
      context: candidateContext,
      snapshotEntries: entries,
      snapshotPreviews: previews,
      selection: candidateSelection,
    }).filter((candidate) => candidate.kind === 'snapshot'),
    [candidateContext, candidateSelection, entries, previews],
  );
  const candidateById = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate])),
    [candidates],
  );
  const selectedCandidateKeys = candidateSelection.checkedCandidateIds;
  const visibleGroups = useMemo(
    () => groupFlaStaticSnapshotCandidates(entries, previews, candidateSearch, candidateFilter),
    [candidateFilter, candidateSearch, entries, previews],
  );
  const visibleCandidates = useMemo(
    () => visibleGroups.flatMap((group) => group.entries)
      .map((entry) => candidateById.get(flaStaticSnapshotCandidateKey(entry)))
      .filter((candidate) => candidate !== undefined),
    [candidateById, visibleGroups],
  );
  const effectiveFocusedCandidateKey = useMemo(
    () => reconcileFlaWorkbenchFocus(
      visibleCandidates,
      candidateSelection.focusedCandidateId,
      phase === 'scanning',
    ),
    [candidateSelection.focusedCandidateId, phase, visibleCandidates],
  );
  const effectiveFocusedCandidateIdentityKey = effectiveFocusedCandidateKey
    ? candidateById.get(effectiveFocusedCandidateKey)?.identityKey ?? null
    : null;
  focusedCandidateIdentityKeyRef.current = effectiveFocusedCandidateIdentityKey;
  const focusedEntry = effectiveFocusedCandidateKey
    ? entryByKey.get(effectiveFocusedCandidateKey) ?? null
    : null;
  const focusedStatus = focusedEntry
    ? previews[flaStaticSnapshotCandidateKey(focusedEntry)]
    : undefined;
  const focusedPreviewForEntry = effectiveFocusedCandidateIdentityKey &&
    focusedPreview?.key === effectiveFocusedCandidateIdentityKey
    ? focusedPreview
    : null;
  const previewAreaState = !effectiveFocusedCandidateKey ? 'empty' : focusedPreviewForEntry?.status ?? (
    focusedStatus?.status === 'supported'
      ? 'loading'
      : focusedStatus?.status ?? 'needs-preview'
  );
  const supportedEntries = useMemo(
    () => entries.filter((entry) => candidateById.get(flaStaticSnapshotCandidateKey(entry))?.selectable),
    [candidateById, entries],
  );
  const visibleSupportedCount = visibleGroups.reduce(
    (count, group) => count + group.entries.filter(
      (entry) => candidateById.get(flaStaticSnapshotCandidateKey(entry))?.selectable,
    ).length,
    0,
  );
  const selectedEntries = useMemo(
    () => entries.filter((entry) => candidateById.get(flaStaticSnapshotCandidateKey(entry))?.checked),
    [candidateById, entries],
  );
  const blankCount = entries.filter((entry) => entry.isBlank).length;
  const unsupportedCount = entries.filter((entry) => {
    const candidate = candidateById.get(flaStaticSnapshotCandidateKey(entry));
    return !entry.isBlank && candidate?.supported === false;
  }).length;

  useEffect(() => {
    setCandidateSelection((current) => reconcileFlaWorkbenchChecks(current, candidates));
  }, [candidates]);

  useEffect(() => {
    setCandidateSelection(createFlaWorkbenchCandidateSelection());
  }, [sessionId, source.sha256]);
  const checkedCatalogSummary = entries.length === 0
    ? catalogSummary
    : phase === 'scanning'
      ? `正在检查候选预览 ${scanProgress} / ${entries.length}；目前 ${supportedEntries.length} 项可导入、${unsupportedCount} 项暂不可导入、${blankCount} 项为空白。`
      : `检查完成：${supportedEntries.length} 项可导入、${unsupportedCount} 项暂不可导入、${blankCount} 项为空白。`;

  useEffect(() => {
    onWorkInProgressChange?.(phase === 'loading' || phase === 'scanning');
  }, [onWorkInProgressChange, phase]);

  useEffect(() => () => onWorkInProgressChange?.(false), [onWorkInProgressChange]);

  const updateFocusedPreview = useCallback((next: FocusedSnapshotPreview | null): void => {
    const nextUrl = next?.status === 'ready' ? next.url : null;
    const currentUrl = focusedPreviewUrlRef.current;
    if (currentUrl && currentUrl.url !== nextUrl) URL.revokeObjectURL(currentUrl.url);
    focusedPreviewUrlRef.current = nextUrl && next
      ? { key: next.key, url: nextUrl }
      : null;
    setFocusedPreview(next);
  }, []);

  const markFocusedPreviewUnavailable = useCallback((candidateId: string, identityKey: string, message: string): void => {
    updateFocusedPreview({ key: identityKey, status: 'error', message });
    setPreviews((current) => ({
      ...current,
      [candidateId]: { ...current[candidateId], status: 'unsupported', reason: message },
    }));
  }, [updateFocusedPreview]);

  useEffect(() => {
    onCommitStateChange?.(false);
    onTerminalStateChange?.('active');
    let disposed = false;
    let scanRequestId: string | null = null;

    const setCandidatePreview = (key: string, preview: FlaStaticSnapshotCandidatePreview): void => {
      setPreviews((current) => ({ ...current, [key]: preview }));
    };
    const setCandidatePreviewAndProgress = (
      index: number,
      entry: FlaRenderableTargetCatalogEntry,
      preview: FlaStaticSnapshotCandidatePreview,
    ): void => {
      const key = flaStaticSnapshotCandidateKey(entry);
      const startedAt = startIssue762Profile();
      setCandidatePreview(key, preview);
      pendingScanProgressProfileRef.current = {
        progress: index + 1,
        startedAt,
        candidateIndex: index,
        targetId: entry.target.renderTargetId,
        status: preview.status,
      };
      setScanProgress(index + 1);
    };

    void (async () => {
      try {
        const catalogStartedAt = startIssue762Profile();
        const response = await flaStaticSnapshotClient.catalog(sessionId, { includeAuthoredStates: true });
        finishIssue762Profile('ui.catalog.main-roundtrip', catalogStartedAt, {
          outcome: response.ok ? 'success' : response.error.code,
          candidateCount: response.ok ? response.entries.length : 0,
        });
        if (disposed) return;
        if (!response.ok) {
          setErrorMessage(response.error.message);
          setPhase('error');
          return;
        }

        setEntries(response.entries);
        setCatalogSummary(response.summary);
        setOmittedCandidateCount(response.omittedCandidateCount);
        const firstReviewable =
          response.entries.find((entry) =>
            flaStaticSnapshotCandidateRole(entry) === 'scene-referenced-graphic' &&
            entry.previewSupported && !entry.isBlank,
          ) ??
          response.entries.find((entry) =>
            flaStaticSnapshotCandidateRole(entry) === 'scene' &&
            entry.previewSupported && !entry.isBlank,
          ) ??
          response.entries.find((entry) => entry.previewSupported && !entry.isBlank);
        const firstEntry = firstReviewable ?? response.entries[0];
        setCandidateSelection((current) => focusFlaWorkbenchCandidate(
          current,
          firstEntry ? flaStaticSnapshotCandidateKey(firstEntry) : null,
        ));
        setPhase('scanning');

        for (let index = 0; index < response.entries.length; index += 1) {
          if (disposed) return;
          const entry = response.entries[index];
          if (!entry) continue;
          const candidateStartedAt = startIssue762Profile();
          if (entry.isBlank) {
            setCandidatePreviewAndProgress(index, entry, { status: 'blank' });
            finishIssue762Profile('ui.scan.candidate-total', candidateStartedAt, {
              candidateIndex: index,
              targetId: entry.target.renderTargetId,
              outcome: 'blank',
            });
            continue;
          }
          if (!entry.previewSupported) {
            setCandidatePreviewAndProgress(index, entry, {
              status: 'unsupported',
              reason: entry.unsupportedReason ?? '当前无法安全生成预览。',
            });
            finishIssue762Profile('ui.scan.candidate-total', candidateStartedAt, {
              candidateIndex: index,
              targetId: entry.target.renderTargetId,
              outcome: 'catalog-unsupported',
            });
            continue;
          }

          const requestId = crypto.randomUUID();
          scanRequestId = requestId;
          const outcome = await runFlaStaticSnapshotPreviewTransaction(
            flaStaticSnapshotClient,
            {
              format: 'fla-static-snapshot-preview',
              version: 1,
              requestId,
              sessionId,
              target: {
                ...entry.target,
                selectedFrameIndex: entry.target.selectedFrameIndex ?? 0,
              },
            },
            flaStaticSnapshotPreviewQueue,
            undefined,
            {
              shouldRun: () => !disposed,
              profileLabel: 'candidate-scan',
              candidateIndex: index,
              onRequestStart: () => {
                activePreviewRequestIdRef.current = requestId;
              },
              onRequestSettled: () => {
                if (activePreviewRequestIdRef.current === requestId) {
                  activePreviewRequestIdRef.current = null;
                }
                if (scanRequestId === requestId) scanRequestId = null;
              },
            },
          );
          if (disposed || outcome.skipped) return;
          if (outcome.cleanupError) {
            const previewFailure = outcome.operationError?.message;
            throw new Error(
              `预览资源清理失败，检查已停止。${previewFailure ? `${previewFailure}；` : ''}${outcome.cleanupError.message}`,
            );
          }
          if (outcome.operationError) {
            setCandidatePreviewAndProgress(index, entry, {
              status: 'unsupported',
              reason: outcome.operationError.message,
            });
          } else if (!outcome.response?.ok || !outcome.response.bytes) {
            setCandidatePreviewAndProgress(index, entry, {
              status: 'unsupported',
              reason: outcome.response?.ok ? '预览没有返回图像。' : outcome.response?.error.message ?? '预览失败。',
            });
          } else {
            try {
              const thumbnailStartedAt = startIssue762Profile();
              const previewUrl = await createCandidateThumbnailUrl(outcome.response.bytes);
              finishIssue762Profile('ui.thumbnail.candidate-create', thumbnailStartedAt, {
                candidateIndex: index,
                targetId: entry.target.renderTargetId,
                pngByteLength: outcome.response.bytes.byteLength,
              });
              if (disposed) {
                URL.revokeObjectURL(previewUrl);
                return;
              }
              previewUrlsRef.current.add(previewUrl);
              thumbnailImageLoadStartedAtRef.current.set(previewUrl, {
                startedAt: startIssue762Profile(),
                candidateIndex: index,
                targetId: entry.target.renderTargetId,
              });
              const identityKey = flaWorkbenchSnapshotIdentityKey(candidateContext, entry);
              if (focusedCandidateIdentityKeyRef.current === identityKey) {
                const fullSizeUrl = createCandidateFullSizeUrl(outcome.response.bytes);
                updateFocusedPreview({
                  key: identityKey,
                  status: 'ready',
                  url: fullSizeUrl,
                  width: outcome.response.width,
                  height: outcome.response.height,
                });
              }
              setCandidatePreviewAndProgress(index, entry, {
                status: 'supported',
                previewUrl,
                sha256: outcome.response.sha256,
              });
            } catch (error) {
              setCandidatePreviewAndProgress(index, entry, {
                status: 'unsupported',
                reason: error instanceof Error ? error.message : '无法显示预览图像。',
              });
            }
          }
          finishIssue762Profile('ui.scan.candidate-total', candidateStartedAt, {
            candidateIndex: index,
            targetId: entry.target.renderTargetId,
            outcome: outcome.operationError
              ? 'preview-error'
              : outcome.response?.ok
                ? 'preview-supported'
                : 'preview-unsupported',
          });
        }
        if (!disposed) setPhase('ready');
      } catch (error) {
        if (disposed) return;
        setErrorMessage(error instanceof Error ? error.message : '无法检查 FLA 候选。');
        setPhase('error');
      }
    })();

    return () => {
      disposed = true;
      onCommitStateChange?.(false);
      onTerminalStateChange?.('active');
      const requestId = activePreviewRequestIdRef.current ?? scanRequestId;
      if (requestId) {
        void flaStaticSnapshotClient.cancel({
          format: 'fla-static-snapshot-cancel',
          version: 1,
          requestId,
        }).catch(() => undefined);
      }
      void flaStaticSnapshotClient.cancel({
        format: 'fla-static-snapshot-cancel',
        version: 1,
        sessionId,
      }).catch(() => undefined);
      for (const previewUrl of previewUrlsRef.current) URL.revokeObjectURL(previewUrl);
      previewUrlsRef.current.clear();
      thumbnailImageLoadStartedAtRef.current.clear();
      const fullSizePreview = focusedPreviewUrlRef.current;
      if (fullSizePreview) URL.revokeObjectURL(fullSizePreview.url);
      focusedPreviewUrlRef.current = null;
    };
  }, [candidateContext, onCommitStateChange, onTerminalStateChange, sessionId, updateFocusedPreview]);

  useEffect(() => {
    const candidateId = effectiveFocusedCandidateKey;
    const identityKey = effectiveFocusedCandidateIdentityKey;
    const entry = focusedEntry;
    const status = focusedStatus;
    const canRequest = Boolean(
      candidateId && identityKey && entry && status?.status === 'supported' && status.sha256 &&
      (phase === 'scanning' || phase === 'ready'),
    );

    if (!canRequest || !candidateId || !identityKey || !entry || !status?.sha256) {
      if (
        phase !== 'scanning' && phase !== 'ready' ||
        focusedPreviewUrlRef.current && focusedPreviewUrlRef.current.key !== identityKey
      ) {
        updateFocusedPreview(null);
      }
      return;
    }
    if (focusedPreviewUrlRef.current?.key === identityKey) return;

    let disposed = false;
    const requestId = crypto.randomUUID();
    updateFocusedPreview({ key: identityKey, status: 'loading' });

    void (async () => {
      const outcome = await runFlaStaticSnapshotPreviewTransaction(
        flaStaticSnapshotClient,
        {
          format: 'fla-static-snapshot-preview',
          version: 1,
          requestId,
          sessionId,
          target: {
            ...entry.target,
            selectedFrameIndex: entry.target.selectedFrameIndex ?? 0,
          },
        },
        flaStaticSnapshotPreviewQueue,
        undefined,
        {
          shouldRun: () => !disposed && focusedCandidateIdentityKeyRef.current === identityKey,
          profileLabel: 'focused-preview',
          onRequestStart: () => {
            activePreviewRequestIdRef.current = requestId;
          },
          onRequestSettled: () => {
            if (activePreviewRequestIdRef.current === requestId) {
              activePreviewRequestIdRef.current = null;
            }
          },
        },
      );
      if (disposed || outcome.skipped || focusedCandidateIdentityKeyRef.current !== identityKey) return;

      const failureMessage = outcome.cleanupError
        ? '清晰预览的资源清理失败。为避免错误导入，此项暂不可导入。'
        : outcome.operationError
          ? '清晰预览暂时无法显示。此项暂不可导入，请重新检查或返回。'
          : !outcome.response?.ok || !outcome.response.bytes
            ? '清晰预览暂时无法显示。此项暂不可导入，请重新检查或返回。'
            : outcome.response.sha256 !== status.sha256
              ? '候选图像已变化。请重新检查后再导入。'
              : null;
      if (failureMessage) {
        markFocusedPreviewUnavailable(candidateId, identityKey, failureMessage);
        return;
      }

      const response = outcome.response;
      if (!response?.ok) return;
      const url = createCandidateFullSizeUrl(response.bytes);
      if (disposed || focusedCandidateIdentityKeyRef.current !== identityKey) {
        URL.revokeObjectURL(url);
        return;
      }
      updateFocusedPreview({
        key: identityKey,
        status: 'ready',
        url,
        width: response.width,
        height: response.height,
      });
    })().catch(() => {
      if (disposed || focusedCandidateIdentityKeyRef.current !== identityKey) return;
      markFocusedPreviewUnavailable(
        candidateId,
        identityKey,
        '清晰预览暂时无法显示。此项暂不可导入，请重新检查或返回。',
      );
    });

    return () => {
      disposed = true;
      if (activePreviewRequestIdRef.current === requestId) {
        void flaStaticSnapshotClient.cancel({
          format: 'fla-static-snapshot-cancel',
          version: 1,
          requestId,
        }).catch(() => undefined);
      }
    };
  }, [effectiveFocusedCandidateIdentityKey, effectiveFocusedCandidateKey, focusedEntry, focusedStatus?.sha256, focusedStatus?.status, markFocusedPreviewUnavailable, phase, sessionId, updateFocusedPreview]);

  const close = (): void => {
    if (phase === 'committing') return;
    void flaStaticSnapshotClient.cancel({
      format: 'fla-static-snapshot-cancel',
      version: 1,
      sessionId,
    }).catch(() => undefined);
    onClose();
  };

  const toggleCandidate = (entry: FlaRenderableTargetCatalogEntry): void => {
    if (phase !== 'ready') return;
    const key = flaStaticSnapshotCandidateKey(entry);
    setCandidateSelection((current) => toggleFlaWorkbenchCandidateChecked(
      current,
      candidateById.get(key),
    ));
  };

  const selectVisibleSupported = (): void => {
    if (phase !== 'ready') return;
    const visible = visibleGroups.flatMap((group) => group.entries)
      .map((entry) => candidateById.get(flaStaticSnapshotCandidateKey(entry)))
      .filter((candidate) => candidate !== undefined);
    setCandidateSelection((current) => checkFlaWorkbenchCandidates(current, visible));
  };

  const clearSelection = (): void => {
    setCandidateSelection((current) => clearFlaWorkbenchChecks(current));
  };

  const updateCandidateFilter = (filter: FlaStaticSnapshotCandidateFilter): void => {
    const nextGroups = groupFlaStaticSnapshotCandidates(entries, previews, candidateSearch, filter);
    const nextVisibleCandidates = nextGroups.flatMap((group) => group.entries)
      .map((entry) => candidateById.get(flaStaticSnapshotCandidateKey(entry)))
      .filter((candidate) => candidate !== undefined);
    const nextFocusKey = reconcileFlaWorkbenchFocus(
      nextVisibleCandidates,
      candidateSelection.focusedCandidateId,
      phase === 'scanning',
    );
    setCandidateFilter(filter);
    setCandidateSelection((current) => focusFlaWorkbenchCandidate(current, nextFocusKey));
  };

  const updateCandidateSearch = (search: string): void => {
    const nextGroups = groupFlaStaticSnapshotCandidates(entries, previews, search, candidateFilter);
    const nextVisibleCandidates = nextGroups.flatMap((group) => group.entries)
      .map((entry) => candidateById.get(flaStaticSnapshotCandidateKey(entry)))
      .filter((candidate) => candidate !== undefined);
    const nextFocusKey = reconcileFlaWorkbenchFocus(
      nextVisibleCandidates,
      candidateSelection.focusedCandidateId,
      phase === 'scanning',
    );
    setCandidateSearch(search);
    setCandidateSelection((current) => focusFlaWorkbenchCandidate(current, nextFocusKey));
  };

  const focusedSelectionNeedsPreview = Boolean(
    effectiveFocusedCandidateKey && selectedCandidateKeys.has(effectiveFocusedCandidateKey) &&
    focusedPreviewForEntry?.status !== 'ready',
  );

  const importSelected = async (): Promise<void> => {
    if (phase !== 'ready' || selectedEntries.length === 0 || !snapshot || focusedSelectionNeedsPreview) return;
    setPhase('committing');
    setImportProgress(0);
    setReceipt(null);
    setErrorMessage('');
    let finalReceipt: SnapshotImportReceipt = {
      selectedCount: selectedEntries.length,
      items: [],
      partial: true,
      warnings: [],
    };
    try {
      onCommitStateChange?.(true);
      onTerminalStateChange?.('importing');
      finalReceipt = await runFlaStaticSnapshotBatchImport({
        client: flaStaticSnapshotClient,
        queue: flaStaticSnapshotPreviewQueue,
        selectedEntries,
        previews,
        sessionId,
        source,
        snapshot,
        onImported,
        onProgress: setImportProgress,
      });
    } catch {
      finalReceipt = {
        selectedCount: selectedEntries.length,
        items: selectedEntries.map((entry) => ({
          key: flaStaticSnapshotCandidateKey(entry),
          label: flaStaticSnapshotCandidateLabel(entry),
          status: 'failed',
          message: '批量导入未能确认最终结果；请检查素材库，不要重复提交。',
        })),
        partial: true,
        warnings: ['批量导入流程异常结束，已停止后续操作。'],
      };
    } finally {
      const callbackWarnings: string[] = [];
      try {
        onTerminalStateChange?.(finalReceipt.partial ? 'recovery' : 'success');
      } catch {
        callbackWarnings.push('页面状态未能同步；请以本页导入回执为准。');
      }
      try {
        onCommitStateChange?.(false);
      } catch {
        callbackWarnings.push('页面忙碌状态通知未能更新；请返回素材库重新进入。');
      }
      if (callbackWarnings.length > 0) {
        finalReceipt = {
          ...finalReceipt,
          partial: true,
          warnings: [...finalReceipt.warnings, ...callbackWarnings],
        };
      }
      setReceipt(finalReceipt);
      setPhase(finalReceipt.partial ? 'partial' : 'completed');
    }
  };

  if (phase === 'loading' || phase === 'error') {
    return (
      <div
        className="fla-snapshot-review fla-render-workbench-panel"
        data-preview-state={phase === 'error' ? 'error' : 'needs-preview'}
        data-testid="fla-snapshot-review"
        data-workbench-panel="snapshot"
        role="note"
      >
        {phase === 'loading'
          ? <p data-testid="fla-snapshot-loading">正在读取候选状态…</p>
          : <p role="alert" data-testid="fla-snapshot-error">{errorMessage || '无法读取 FLA 候选。'}</p>}
        <button type="button" data-testid="fla-snapshot-close" onClick={close}>返回</button>
      </div>
    );
  }

  if (receipt && (phase === 'completed' || phase === 'partial')) {
    const importedCount = receipt.items.filter((item) => item.status === 'imported').length;
    const duplicateCount = receipt.items.filter((item) => item.status === 'duplicate').length;
    const failedCount = receipt.items.filter((item) => item.status === 'failed').length;
    const notAttemptedCount = receipt.items.filter((item) => item.status === 'not-attempted').length;
    return (
      <section
        className="fla-snapshot-review fla-render-workbench-panel fla-snapshot-batch-receipt"
        data-testid="fla-snapshot-review"
        data-stage-g-state={phase === 'completed' ? 'success' : 'recovery'}
        data-workbench-panel="snapshot"
        aria-labelledby="fla-snapshot-receipt-heading"
      >
        <header>
          <h3 id="fla-snapshot-receipt-heading">{phase === 'completed' ? '导入完成' : '已完成部分导入'}</h3>
          <output data-testid="fla-snapshot-import-counts">
            共处理 {receipt.selectedCount} 项 · 新导入 {importedCount} 项 · 复用已有素材 {duplicateCount} 项 · 失败 {failedCount} 项 · 未尝试 {notAttemptedCount} 项
          </output>
        </header>
        {receipt.warnings.map((warning, index) => (
          <p className="fla-snapshot-receipt-warning" data-testid="fla-snapshot-import-warning" key={`${index}-${warning}`} role="alert">
            {warning}
          </p>
        ))}
        <ul className="fla-snapshot-receipt-items" data-testid="fla-snapshot-import-receipt">
          {receipt.items.map((item) => (
            <li data-status={item.status} key={item.key}>
              <strong>{item.label}</strong>
              <span>{item.status === 'imported' ? '已新建' : item.status === 'duplicate' ? '已复用' : item.status === 'not-attempted' ? '未尝试' : '失败'}</span>
              {item.assetFileName ? <small>{item.assetFileName}</small> : null}
              {item.message ? <small>{item.message}</small> : null}
            </li>
          ))}
        </ul>
        {receipt.recovery ? (
          <FlaStageGRecovery
            candidateStillCurrent={false}
            code={receipt.recovery.code}
            message={receipt.recovery.message}
            onClose={close}
            onPrimary={() => {
              onTerminalStateChange?.('active');
              setReceipt(null);
              setPhase('ready');
            }}
            residualPaths={receipt.recovery.residualPaths}
            route="snapshot"
          />
        ) : (
          <div className="fla-snapshot-action-buttons">
            <button type="button" data-testid="fla-snapshot-close" onClick={close}>返回素材库</button>
          </div>
        )}
      </section>
    );
  }

  if (entries.length === 0 && phase === 'ready') {
    return (
      <div className="fla-snapshot-review fla-render-workbench-panel" data-testid="fla-snapshot-review" role="note">
        <p data-testid="fla-snapshot-empty">这个 FLA 没有发现可检查的图形状态。</p>
        <button type="button" data-testid="fla-snapshot-close" onClick={close}>返回</button>
      </div>
    );
  }

  const focusedUnavailableEntry = focusedEntry && focusedStatus?.status === 'unsupported'
    ? {
        ...focusedEntry,
        previewSupported: false,
        unsupportedReason: focusedStatus.reason ?? focusedEntry.unsupportedReason ?? '当前无法安全生成预览。',
      }
    : null;
  const canImport = phase === 'ready' && selectedEntries.length > 0 && Boolean(snapshot) && !focusedSelectionNeedsPreview;

  return (
    <div
      className="fla-snapshot-review fla-render-workbench-panel"
      data-preview-state={phase === 'scanning' ? 'rendering' : phase === 'committing' ? 'committing' : 'ready'}
      data-fla-session-id={sessionId}
      data-testid="fla-snapshot-review"
      data-workbench-panel="snapshot"
    >
      <div className="fla-snapshot-workbench" data-testid="fla-snapshot-workbench">
        <aside className="fla-snapshot-source-region" data-testid="fla-snapshot-source-region">
          <section className="fla-snapshot-target-region" aria-labelledby="fla-snapshot-target-heading">
            <header>
              <div>
                <p className="fla-render-panel-kicker">FLA 候选</p>
                <h3 id="fla-snapshot-target-heading">可用素材预览</h3>
              </div>
              <span data-testid="fla-snapshot-target-count">{entries.length} 项</span>
            </header>
            {stage ? (
              <p className="fla-snapshot-stage-fact" data-testid="fla-snapshot-source-facts">
                {stage.width} × {stage.height} · {stage.frameRate} fps
              </p>
            ) : null}
            <p className="fla-snapshot-catalog-summary" data-testid="fla-snapshot-catalog-summary">{checkedCatalogSummary}</p>
            {omittedCandidateCount > 0 ? (
              <p className="fla-snapshot-limit-warning" data-testid="fla-snapshot-catalog-limit" role="status">
                另有 {omittedCandidateCount} 项未列出；这些项目尚未检查，不能导入。
              </p>
            ) : null}
            <label className="fla-snapshot-target-search">
              <span>搜索素材</span>
              <input
                aria-label="搜索候选名称"
                data-testid="fla-snapshot-target-search"
                onChange={(event) => updateCandidateSearch(event.currentTarget.value)}
                placeholder="按名称搜索"
                type="search"
                value={candidateSearch}
              />
            </label>
            <div className="fla-snapshot-candidate-tools" aria-label="候选选择工具">
              <button type="button" data-testid="fla-snapshot-select-supported" disabled={phase !== 'ready' || visibleSupportedCount === 0} onClick={selectVisibleSupported}>
                选中可预览项
              </button>
              <button type="button" data-testid="fla-snapshot-clear-selection" disabled={phase !== 'ready' || selectedCandidateKeys.size === 0} onClick={clearSelection}>
                清空
              </button>
            </div>
            <div className="fla-snapshot-candidate-tools fla-snapshot-candidate-role-filters" aria-label="候选分类" role="group">
              <button
                aria-pressed={candidateFilter === 'all'}
                data-testid="fla-snapshot-filter-all"
                onClick={() => updateCandidateFilter('all')}
                type="button"
              >
                全部候选
              </button>
              <button
                aria-pressed={candidateFilter === 'compositions'}
                data-testid="fla-snapshot-filter-compositions"
                onClick={() => updateCandidateFilter('compositions')}
                type="button"
              >
                场景组合
              </button>
              <button
                aria-pressed={candidateFilter === 'graphic-states'}
                data-testid="fla-snapshot-filter-graphic-states"
                onClick={() => updateCandidateFilter('graphic-states')}
                type="button"
              >
                图形状态
              </button>
            </div>
            {phase === 'scanning' ? (
              <output className="fla-snapshot-scan-progress" data-testid="fla-snapshot-scan-progress" role="status">
                正在逐项检查预览 {scanProgress} / {entries.length}
              </output>
            ) : null}
            <ul className="fla-snapshot-targets fla-snapshot-candidates" data-testid="fla-snapshot-targets">
              {visibleGroups.map((group) => {
                const firstEntry = group.entries[0];
                if (!firstEntry) return null;
                return (
                  <li
                    className={group.duplicate ? 'is-duplicate-group' : undefined}
                    data-status={group.status}
                    data-duplicate={group.duplicate ? 'true' : 'false'}
                    data-testid={`fla-snapshot-candidate-group-${group.key}`}
                    key={group.key}
                  >
                    {group.duplicate ? <small className="fla-snapshot-duplicate-label">画面完全相同 · {group.sourceCount} 个来源</small> : null}
                    {group.entries.map((entry) => {
                      const key = flaStaticSnapshotCandidateKey(entry);
                      const candidate = candidateById.get(key);
                      const candidatePreview = candidate?.preview;
                      const status = candidatePreview?.status === 'verified'
                        ? 'supported'
                        : candidatePreview?.status === 'blank'
                          ? 'blank'
                          : candidatePreview?.status === 'checking' || candidatePreview?.status === 'unscanned'
                            ? 'checking'
                            : 'unsupported';
                      const selectable = Boolean(candidate?.selectable) && phase === 'ready';
                      const label = candidate?.displayLabel ?? flaStaticSnapshotCandidateLabel(entry);
                      const focused = key === effectiveFocusedCandidateKey;
                      return (
                        <div
                          className={`fla-snapshot-candidate-row${focused ? ' is-focused' : ''}`}
                          data-focused={focused ? 'true' : 'false'}
                          data-fla-candidate-id={candidate?.identityKey ?? key}
                          data-preview-supported={selectable ? 'true' : 'false'}
                          data-preview-binding-key={candidatePreview?.bindingKey}
                          data-catalog-preview-supported={entry.previewSupported ? 'true' : 'false'}
                          data-is-blank={entry.isBlank ? 'true' : 'false'}
                          data-catalog-role={flaStaticSnapshotCandidateRole(entry)}
                          data-source-library-item-name={entry.target.sourceLibraryItemName ?? ''}
                          data-source-frame-index={entry.target.selectedFrameIndex ?? 0}
                          data-render-target-id={entry.target.renderTargetId}
                          data-testid={`fla-snapshot-candidate-${key}`}
                          key={key}
                        >
                          <button
                            aria-pressed={focused}
                            className="fla-snapshot-candidate-focus"
                            disabled={phase === 'committing'}
                            onClick={() => setCandidateSelection((current) => focusFlaWorkbenchCandidate(current, key))}
                            type="button"
                          >
                            {candidatePreview?.previewUrl ? (
                          <img
                            src={candidatePreview.previewUrl}
                            alt=""
                            onLoad={(event) => {
                              const imageUrl = event.currentTarget.src;
                              const profile = thumbnailImageLoadStartedAtRef.current.get(imageUrl);
                              if (!profile) return;
                              thumbnailImageLoadStartedAtRef.current.delete(imageUrl);
                              finishIssue762Profile('ui.thumbnail.image-element-load', profile.startedAt, {
                                candidateIndex: profile.candidateIndex,
                                targetId: profile.targetId,
                              });
                            }}
                            onError={(event) => {
                              const imageUrl = event.currentTarget.src;
                              const profile = thumbnailImageLoadStartedAtRef.current.get(imageUrl);
                              if (!profile) return;
                              thumbnailImageLoadStartedAtRef.current.delete(imageUrl);
                              finishIssue762Profile('ui.thumbnail.image-element-error', profile.startedAt, {
                                candidateIndex: profile.candidateIndex,
                                targetId: profile.targetId,
                              });
                            }}
                          />
                            ) : (
                              <span className={`fla-snapshot-candidate-placeholder is-${status}`} aria-hidden="true">
                                {status === 'blank' ? '空白' : status === 'unsupported' ? '不可预览' : status === 'checking' ? '检查中' : '预览'}
                              </span>
                            )}
                            <span className="fla-snapshot-candidate-copy">
                              <strong title={entry.target.userLabel}>{label}</strong>
                              <small>{flaStaticSnapshotCandidateKindLabel(entry)}</small>
                            </span>
                          </button>
                          <label className="fla-snapshot-candidate-select">
                            <input
                              aria-label={`选择 ${label}`}
                              checked={candidate?.checked ?? false}
                              disabled={!selectable}
                              onChange={() => toggleCandidate(entry)}
                              type="checkbox"
                            />
                            <span className="sr-only">选择素材</span>
                          </label>
                          <span className={`fla-snapshot-candidate-status is-${status}`}>
                            {status === 'supported' ? '可导入' : status === 'blank' ? '空白状态' : status === 'checking' ? '检查中' : '暂不可导入'}
                          </span>
                        </div>
                      );
                    })}
                  </li>
                );
              })}
              {visibleGroups.length === 0 ? <li className="fla-snapshot-targets-empty">没有匹配的候选。</li> : null}
            </ul>
          </section>
        </aside>

        <section className="fla-snapshot-preview-region" data-testid="fla-snapshot-preview-region">
          <header className="fla-snapshot-region-heading">
            <h3>{focusedEntry ? '候选预览' : '预览'}</h3>
            <output aria-live="polite" data-preview-state={previewAreaState} data-testid="fla-snapshot-preview-status">
              {!effectiveFocusedCandidateKey ? '无可预览素材' : focusedStatus?.status === 'blank' ? '空白状态' : focusedStatus?.status === 'unsupported' ? '暂不可导入' : focusedPreviewForEntry?.status === 'ready' ? '可导入' : focusedStatus?.status === 'supported' ? '正在加载清晰预览' : phase === 'scanning' ? '正在检查' : '等待检查'}
            </output>
          </header>
          <div className="fla-snapshot-preview-stage" data-preview-state={previewAreaState} data-testid="fla-snapshot-preview-area">
            {focusedPreviewForEntry?.status === 'ready' ? (
              <img
                alt={focusedEntry ? flaStaticSnapshotCandidateLabel(focusedEntry) : 'FLA 候选预览'}
                data-preview-height={focusedPreviewForEntry.height}
                data-preview-resolution="full"
                data-preview-width={focusedPreviewForEntry.width}
                data-catalog-role={focusedEntry ? flaStaticSnapshotCandidateRole(focusedEntry) : undefined}
                data-render-target-id={focusedEntry?.target.renderTargetId}
                data-source-frame-index={focusedEntry?.target.selectedFrameIndex ?? 0}
                data-source-library-item-name={focusedEntry?.target.sourceLibraryItemName ?? ''}
                data-testid="fla-snapshot-preview-image"
                onError={() => {
                  const candidateId = effectiveFocusedCandidateKey;
                  const identityKey = effectiveFocusedCandidateIdentityKey;
                  const currentPreviewUrl = focusedPreviewUrlRef.current;
                  if (
                    !candidateId || !identityKey || focusedCandidateIdentityKeyRef.current !== identityKey ||
                    !currentPreviewUrl || currentPreviewUrl.key !== identityKey ||
                    currentPreviewUrl.url !== focusedPreviewForEntry.url
                  ) return;
                  markFocusedPreviewUnavailable(
                    candidateId,
                    identityKey,
                    '清晰预览暂时无法显示。此项暂不可导入，请重新检查或返回。',
                  );
                }}
                src={focusedPreviewForEntry.url}
              />
            ) : (
              <div className="fla-snapshot-preview-placeholder" data-testid="fla-snapshot-preview-placeholder" role={focusedPreviewForEntry?.status === 'error' ? 'alert' : undefined}>
                <strong>{focusedPreviewForEntry?.status === 'error' ? '清晰预览暂不可用' : !effectiveFocusedCandidateKey ? '当前筛选无可预览素材' : focusedStatus?.status === 'blank' ? '这是空白状态' : focusedStatus?.status === 'unsupported' ? '此项暂不可导入' : focusedStatus?.status === 'supported' ? '正在加载清晰预览…' : phase === 'scanning' ? '正在生成候选预览…' : '选择一个候选查看'}</strong>
                <span>{focusedPreviewForEntry?.status === 'error' ? focusedPreviewForEntry.message : focusedStatus?.status === 'unsupported' ? boundedUnsupportedReason(focusedStatus.reason) : !effectiveFocusedCandidateKey ? '请选择可预览素材，或调整筛选条件和搜索内容。' : '只有成功生成并显示的预览才能加入导入选择。'}</span>
              </div>
            )}
          </div>
          {phase === 'committing' ? (
            <output className="fla-snapshot-import-progress" data-testid="fla-snapshot-import-progress" role="status">
              正在导入 {importProgress} / {selectedEntries.length}
            </output>
          ) : null}
        </section>

        <aside className="fla-snapshot-details-region" data-testid="fla-snapshot-details-region">
          {focusedUnavailableEntry ? (
            <FlaStageF2UnavailableDetails entry={focusedUnavailableEntry} />
          ) : focusedEntry ? (
            <>
              <h3 title={focusedEntry.target.userLabel}>{flaStaticSnapshotCandidateLabel(focusedEntry)}</h3>
              <dl className="fla-snapshot-details" data-testid="fla-snapshot-details">
                <div><dt>来源类型</dt><dd>{flaStaticSnapshotCandidateKindLabel(focusedEntry)}</dd></div>
                <div><dt>时间线范围</dt><dd>{focusedEntry.target.frameCount} 帧</dd></div>
                <div><dt>当前状态</dt><dd>{focusedStatus?.status === 'supported' ? '可导入' : focusedStatus?.status === 'blank' ? '空白状态' : focusedStatus?.status === 'unsupported' ? '暂不可导入' : '正在检查'}</dd></div>
              </dl>
              <details className="fla-snapshot-compatibility" data-testid="fla-snapshot-compatibility-details">
                <summary>来源详情</summary>
                <dl className="fla-snapshot-detail-more">
                  <div><dt>目标名称</dt><dd title={focusedEntry.target.userLabel}>{focusedEntry.target.userLabel}</dd></div>
                  {focusedEntry.target.sourceLibraryItemName ? <div><dt>源元件</dt><dd title={focusedEntry.target.sourceLibraryItemName}>{focusedEntry.target.sourceLibraryItemName}</dd></div> : null}
                  <div><dt>源帧</dt><dd>{(focusedEntry.target.selectedFrameIndex ?? 0) + 1}</dd></div>
                  <div><dt>目标标识</dt><dd title={focusedEntry.target.renderTargetId}>{focusedEntry.target.renderTargetId}</dd></div>
                </dl>
              </details>
            </>
          ) : (
            <p>选择一个候选以查看来源和状态。</p>
          )}
          <dl className="fla-snapshot-details" data-testid="fla-snapshot-candidate-summary">
            <div><dt>可导入</dt><dd>{supportedEntries.length}</dd></div>
            <div><dt>暂不可导入</dt><dd>{unsupportedCount}</dd></div>
            <div><dt>空白状态</dt><dd>{blankCount}</dd></div>
            <div><dt>已选择</dt><dd>{selectedEntries.length}</dd></div>
          </dl>
        </aside>
      </div>

      <div className="fla-snapshot-action-bar" data-testid="fla-snapshot-action-bar">
        <div className="fla-snapshot-action-status">
          <strong data-testid="fla-snapshot-action-state">
            {phase === 'scanning' ? `检查候选 ${scanProgress} / ${entries.length}` : phase === 'committing' ? `导入 ${importProgress} / ${selectedEntries.length}` : `${selectedEntries.length} 项已选`}
          </strong>
          {errorMessage ? <span role="alert" data-testid="fla-snapshot-error">{errorMessage}</span> : null}
        </div>
        <div className="fla-snapshot-action-buttons">
          <button
            className="fla-snapshot-close-action"
            disabled={phase === 'committing'}
            onClick={close}
            type="button"
            data-testid="fla-snapshot-close"
          >
            取消
          </button>
          <button
            className="fla-render-primary-action"
            disabled={!canImport}
            onClick={() => void importSelected()}
            type="button"
            data-testid="fla-snapshot-import"
          >
            {phase === 'scanning' ? '正在检查…' : `确认并导入 ${selectedEntries.length} 项`}
          </button>
        </div>
      </div>
    </div>
  );
}

function createCandidateFullSizeUrl(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: 'image/png' }));
}

async function createCandidateThumbnailUrl(bytes: Uint8Array): Promise<string> {
  const thumbnailStartedAt = startIssue762Profile();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const imageDecodeStartedAt = startIssue762Profile();
  const bitmap = await createImageBitmap(new Blob([copy.buffer], { type: 'image/png' }));
  finishIssue762Profile('ui.thumbnail.image-bitmap-decode', imageDecodeStartedAt, {
    pngByteLength: bytes.byteLength,
    width: bitmap.width,
    height: bitmap.height,
  });
  try {
    const maxSide = 160;
    const scale = Math.min(1, maxSide / bitmap.width, maxSide / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法显示候选预览。');
    const canvasDrawStartedAt = startIssue762Profile();
    context.drawImage(bitmap, 0, 0, width, height);
    finishIssue762Profile('ui.thumbnail.canvas-draw', canvasDrawStartedAt, { width, height });
    const encodeStartedAt = startIssue762Profile();
    const thumbnail = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('无法生成候选缩略图。'));
      }, 'image/png');
    });
    finishIssue762Profile('ui.thumbnail.canvas-encode', encodeStartedAt, {
      width,
      height,
      outputByteLength: thumbnail.size,
    });
    const url = URL.createObjectURL(thumbnail);
    finishIssue762Profile('ui.thumbnail.create-total', thumbnailStartedAt, {
      pngByteLength: bytes.byteLength,
      width,
      height,
      outputByteLength: thumbnail.size,
    });
    return url;
  } finally {
    bitmap.close();
  }
}

export async function runFlaStaticSnapshotBatchImport(options: {
  client: FlaStaticSnapshotCatalogClient;
  queue: typeof flaStaticSnapshotPreviewQueue;
  selectedEntries: readonly FlaRenderableTargetCatalogEntry[];
  previews: FlaStaticSnapshotCandidatePreviews;
  sessionId: string;
  source: { basename: string; sha256: string };
  snapshot: EditorProjectSnapshot;
  onImported: (response: FlaStaticSnapshotCommitResponse) => void;
  onProgress: (progress: number) => void;
}): Promise<SnapshotImportReceipt> {
  const {
    client,
    queue,
    selectedEntries,
    previews,
    sessionId,
    source,
    snapshot,
    onImported,
    onProgress,
  } = options;
  let currentProject = snapshot.project;
  let currentRevision = snapshot.revision;
  let stopAfterFailure = false;
  let stopReason = '前一项导入未能确认，后续项目未尝试。';
  let recovery: SnapshotImportReceipt['recovery'];
  const items: SnapshotImportItem[] = [];
  const warnings: string[] = [];

  const reportProgress = (index: number): void => {
    try {
      onProgress(index + 1);
    } catch {
      warnings.push('导入进度显示未能更新；请以本页结果回执为准。');
    }
  };

  for (let index = 0; index < selectedEntries.length; index += 1) {
    const entry = selectedEntries[index];
    if (!entry) {
      items.push({
        key: `missing-${index}`,
        label: `第 ${index + 1} 项`,
        status: 'failed',
        message: '候选数据缺失，未尝试导入。',
      });
      reportProgress(index);
      continue;
    }

    const key = flaStaticSnapshotCandidateKey(entry);
    const label = flaStaticSnapshotCandidateLabel(entry);
    if (stopAfterFailure) {
      items.push({ key, label, status: 'not-attempted', message: stopReason });
      reportProgress(index);
      continue;
    }

    const expectedPreview = previews[key];
    if (!expectedPreview?.sha256 || expectedPreview.status !== 'supported') {
      items.push({ key, label, status: 'failed', message: '缺少可用且已检查的预览，未导入。' });
      reportProgress(index);
      continue;
    }

    const requestId = crypto.randomUUID();
    let commitAttempted = false;
    const outcome = await runFlaStaticSnapshotPreviewTransaction(
      client,
      {
        format: 'fla-static-snapshot-preview',
        version: 1,
        requestId,
        sessionId,
        target: {
          ...entry.target,
          selectedFrameIndex: entry.target.selectedFrameIndex ?? 0,
        },
      },
      queue,
      async (preview) => {
        if (!preview.ok || !preview.bytes) {
          return {
            kind: 'preview-failed' as const,
            message: preview.ok ? '重新检查时没有得到预览图像。' : preview.error.message,
          };
        }
        if (preview.sha256 !== expectedPreview.sha256) {
          return {
            kind: 'preview-changed' as const,
            message: '候选图像已变化；为避免导入未确认内容，此项未导入。',
          };
        }

        commitAttempted = true;
        const commitStartedAt = startIssue762Profile();
        const response = await client.commit({
          format: 'fla-static-snapshot-commit',
          version: 1,
          projectRoot: snapshot.projectRoot,
          project: currentProject,
          baseRevision: currentRevision,
          sessionId,
          confirmedPreviewRequestId: preview.requestId,
          source,
          target: {
            ...entry.target,
            selectedFrameIndex: entry.target.selectedFrameIndex ?? 0,
          },
          preview: {
            sha256: preview.sha256,
            width: preview.width,
            height: preview.height,
            byteLength: preview.bytes.byteLength,
          },
          confirmed: true,
        });
        finishIssue762Profile('ui.commit.main-transaction', commitStartedAt, {
          requestId: preview.requestId,
          candidateIndex: index,
          targetId: entry.target.renderTargetId,
          outcome: response.ok ? response.result.status : response.error.code,
        });
        return { kind: 'commit-response' as const, response };
      },
      { profileLabel: 'commit-preview', candidateIndex: index },
    );

    if (outcome.operationError) {
      const message = commitAttempted
        ? '提交结果无法确认；为避免重复写入，已停止后续导入。请检查素材库后再处理。'
        : outcome.operationError.message || '预览失败，未导入。';
      items.push({ key, label, status: 'failed', message });
      if (commitAttempted) {
        stopAfterFailure = true;
        stopReason = '上一项提交结果无法确认，未继续尝试后续项目。';
      }
    } else if (outcome.value?.kind === 'preview-failed' || outcome.value?.kind === 'preview-changed') {
      items.push({ key, label, status: 'failed', message: outcome.value.message });
    } else if (outcome.value?.kind === 'commit-response' && outcome.value.response.ok) {
      const response = outcome.value.response;
      currentProject = response.project;
      currentRevision = response.savedRevision;
      const item: SnapshotImportItem = {
        key,
        label,
        status: response.result.status === 'imported' ? 'imported' : 'duplicate',
        assetId: response.result.assetId,
        assetFileName: response.result.targetFileName,
        message: response.result.message,
      };
      items.push(item);
      try {
        const librarySyncStartedAt = startIssue762Profile();
        onImported(response);
        finishIssue762Profile('ui.commit.project-store-update', librarySyncStartedAt, {
          candidateIndex: index,
          targetId: entry.target.renderTargetId,
          savedRevision: response.savedRevision,
        });
      } catch {
        item.message = `${item.message ?? ''} 项目已提交，但界面状态同步失败；请勿重复导入，返回素材库核对。`.trim();
        warnings.push('素材已经写入项目，但界面状态同步失败；请勿重复导入，返回素材库核对。');
        stopAfterFailure = true;
        stopReason = '上一项已写入项目，但界面状态未能同步，未继续尝试后续项目。';
      }
    } else if (outcome.value?.kind === 'commit-response' && 'error' in outcome.value.response) {
      const response = outcome.value.response;
      items.push({ key, label, status: 'failed', message: response.error.message });
      recovery = {
        code: response.error.code,
        message: response.error.message,
        residualPaths: response.error.residualPaths,
      };
      stopAfterFailure = true;
      stopReason = '上一项导入失败，未继续提交。';
    } else {
      items.push({ key, label, status: 'failed', message: '未能确认预览结果，此项没有提交。' });
    }

    if (outcome.cleanupError) {
      warnings.push('预览资源清理未完成，已停止后续导入；已经显示为“已新建”或“已复用”的素材不会回滚。请返回素材库核对。');
      const item = items[items.length - 1];
      if (item) item.message = `${item.message ?? ''} 预览资源清理未完成。`.trim();
      stopAfterFailure = true;
      stopReason = '上一项的预览资源未能清理，未继续尝试后续项目。';
    }

    reportProgress(index);
  }

  const partial = items.some((item) => item.status === 'failed' || item.status === 'not-attempted') || warnings.length > 0;
  return {
    selectedCount: selectedEntries.length,
    items,
    partial,
    warnings,
    ...(recovery ? { recovery } : {}),
  };
}
