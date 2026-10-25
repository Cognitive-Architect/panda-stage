/**
 * V2-R2 Frame Sequence - renderer review surface.
 *
 * The component owns the existing R2 review state machine and presents it as
 * the sequence sibling of the accepted Stage D snapshot workbench. The visual
 * shell is intentionally task-first: target selection, range, review, and the
 * explicit import action are visible together without changing the R2 IPC or
 * Project mutation boundaries.
 *
 * Hard boundaries (R2-A/B/C/D/E + Corrective A/B/C/D):
 *  - previewing / importing never mutates the Project until explicit commit;
 *  - over-cap / reversed / out-of-range ranges are rejected before any IPC;
 *  - the per-frame PNG bytes stay Main-owned; the Renderer only holds
 *    transient object URLs for the current bounded sequence;
 *  - a stale / late completion cannot overwrite the current request or
 *    become commit-eligible;
 *  - re-render invalidates the prior commit candidate;
 *  - closing / unmounting cancels or invalidates live sequence work;
 *  - focusing a filmstrip frame changes review focus only, never R2 authority.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { sampleLoopingAnimationFrameIndex } from '../features/assets/animationPlayback';
import type {
  FlaRenderableTargetCatalogEntry,
  FlaRenderTarget,
} from '../../shared/fla-static-snapshot-api';
import type {
  FlaFrameSequenceCommitResponse,
  FlaFrameSequenceResponse,
  FlaFrameSequenceSuccess,
} from '../../shared/fla-frame-sequence-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { flaStaticSnapshotClient } from './fla-static-snapshot-render';
import { flaFrameSequenceClient } from './fla-frame-sequence-render';
import { flaStaticSnapshotPreviewQueue } from './fla-static-snapshot-preview-transaction';
import { boundedUnsupportedReason, FlaStageF2UnavailableDetails } from './FlaStageF';
import {
  FlaStageGImporting,
  type FlaStageGTerminalState,
} from './FlaStageGTerminal';
import {
  buildRange,
  formatSequenceRangeSummaryForPresentation,
  getSequenceStartFrameInputWidthPx,
  getDefaultSequenceRange,
  intentChangeReset,
  isCommitEligible,
  isCurrentResponse,
  isStaleAgainstIntent,
  MAX_SEQUENCE_FRAMES,
  resolveVisibleSequenceFocus,
  postCommitSequenceState,
  rerenderReset,
  validateRange,
} from './fla-frame-sequence-review-state';
import {
  flaSequencePlaybackReducer,
  initialFlaSequencePlaybackState,
} from './fla-frame-sequence-playback-state';
import {
  createFlaWorkbenchCandidateSelection,
  createFlaWorkbenchCandidates,
  type FlaWorkbenchCandidate,
} from './fla-workbench-candidates';
import {
  describeFlaUnifiedCandidate,
  flaUnifiedCandidateSelectionKey,
  type FlaUnifiedImportItem,
  type FlaUnifiedImportRunner,
  type FlaUnifiedRouteResult,
} from './fla-unified-import';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface FlaFrameSequenceReviewProps {
  sessionId: string;
  source: { basename: string; sha256: string };
  sourceFps: number;
  snapshot: EditorProjectSnapshot | null;
  checkedCandidateKeys: ReadonlySet<string>;
  importLocked: boolean;
  onToggleCandidate: (item: FlaUnifiedImportItem, checked: boolean) => void;
  onReconcileCandidates: (kind: 'sequence', keys: ReadonlySet<string>) => void;
  onRegisterImportRunner: (runner: FlaUnifiedImportRunner | null) => void;
  embedded?: boolean;
  onImported: (response: FlaFrameSequenceCommitResponse) => void;
  onWorkInProgressChange?: (busy: boolean) => void;
  onTerminalStateChange?: (state: FlaStageGTerminalState) => void;
  presentation?: 'standard' | 'unified-preview';
  focusedCandidateIdentityKey?: string | null;
  onCandidatesChange?: (candidates: readonly FlaWorkbenchCandidate[]) => void;
  showUnifiedSequencePreview?: boolean;
  selectedOnlyView?: boolean;
  multiSelectMode?: boolean;
  canImportSingle?: boolean;
  onImportSingle?: () => void;
}

function handleSequenceActionKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  action: () => void,
): void {
  if (event.key !== 'Enter' || event.repeat) return;
  event.preventDefault();
  action();
}

type RenderPhase =
  | 'loading'
  | 'selecting'
  | 'rendering'
  | 'preview-ready'
  | 'committing'
  | 'committed'
  | 'cancelled'
  | 'error';

export function FlaFrameSequenceReview({
  sessionId,
  source,
  sourceFps,
  snapshot,
  checkedCandidateKeys,
  importLocked,
  onToggleCandidate,
  onReconcileCandidates,
  onRegisterImportRunner,
  embedded = false,
  onImported,
  onWorkInProgressChange,
  onTerminalStateChange,
  presentation = 'standard',
  focusedCandidateIdentityKey,
  onCandidatesChange,
  showUnifiedSequencePreview = true,
  selectedOnlyView = false,
  multiSelectMode = true,
  canImportSingle = false,
  onImportSingle,
}: FlaFrameSequenceReviewProps): React.JSX.Element {
  const [phase, setPhase] = useState<RenderPhase>('loading');
  const [entries, setEntries] = useState<FlaRenderableTargetCatalogEntry[]>([]);
  const [targetSearch, setTargetSearch] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  // F2 detail focus is separate from the R2 render/commit authority. Focusing
  // an unavailable entry must preserve the last valid supported sequence.
  const [focusedTargetId, setFocusedTargetId] = useState<string | null>(null);
  const [startFrameIndex, setStartFrameIndex] = useState(0);
  const [endFrameIndex, setEndFrameIndex] = useState(0);
  const [importAsAnimation, setImportAsAnimation] = useState(presentation === 'unified-preview');
  const [animationName, setAnimationName] = useState(() =>
    source.basename.replace(/\.fla$/iu, ''),
  );
  const [completedFrameCount, setCompletedFrameCount] = useState(0);
  const [success, setSuccess] = useState<FlaFrameSequenceSuccess | null>(null);
  const [previewUrls, setPreviewUrls] = useState<ReadonlyArray<string>>([]);
  const [playbackState, dispatchPlayback] = useReducer(
    flaSequencePlaybackReducer,
    initialFlaSequencePlaybackState,
  );
  const selectedPreviewIndex = playbackState.selectedIndex;
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  const [errorMessage, setErrorMessage] = useState('');
  const sourceFpsAvailable =
    Number.isFinite(sourceFps) && sourceFps > 0 && sourceFps <= 1_000;
  const effectiveImportAsAnimation = importAsAnimation && sourceFpsAvailable;

  // R2-D: the latest completed sequence the UI has accepted. Only this one
  // is commit-eligible; an older / stale result cannot become current.
  const activeRequestIdRef = useRef<string | null>(null);
  const activeIntentRef = useRef<{
    renderTargetId: string;
    startFrameIndex: number;
    endFrameIndex: number;
  } | null>(null);
  const acceptedRequestIdRef = useRef<string | null>(null);
  const latestSequenceRef = useRef<FlaFrameSequenceSuccess | null>(null);
  const catalogInitializedRef = useRef(false);
  const nameSuggestionTargetIdRef = useRef<string | null>(null);
  const filmstripRef = useRef<HTMLDivElement | null>(null);
  const playbackSessionKeyRef = useRef<string | null>(null);
  const playbackStartedAtRef = useRef(0);
  // Problem B (Corrective #296): active progress subscription handle.
  // Subscribed only while a request is in flight; removed on
  // cancel / re-render / completion / unmount.
  const progressUnsubRef = useRef<(() => void) | null>(null);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.target.renderTargetId === selectedTargetId) ?? null,
    [entries, selectedTargetId],
  );
  const reviewClassName = [
    'fla-frame-sequence-review',
    embedded ? 'fla-render-workbench-panel' : '',
    presentation === 'unified-preview' ? 'fla-frame-sequence-review-unified-preview' : '',
  ].filter(Boolean).join(' ');
  const targetFrameCount = selectedEntry?.target.frameCount ?? 0;
  const validation = useMemo(
    () => validateRange(startFrameIndex, endFrameIndex, targetFrameCount),
    [startFrameIndex, endFrameIndex, targetFrameCount],
  );
  const orderedSequenceItems = useMemo(
    () => success?.items.slice().sort((a, b) => a.frameIndex - b.frameIndex) ?? [],
    [success],
  );
  const renderedRange = success && orderedSequenceItems.length > 0
    ? {
        renderTargetId: success.renderTargetId,
        startFrameIndex: orderedSequenceItems[0]!.frameIndex,
        endFrameIndex: orderedSequenceItems[orderedSequenceItems.length - 1]!.frameIndex,
      }
    : null;
  const currentIntent = selectedEntry
    ? { renderTargetId: selectedEntry.target.renderTargetId, startFrameIndex, endFrameIndex }
    : null;
  const activeRenderIntent = phase === 'rendering' ? activeIntentRef.current : null;
  const activeRenderFrameCount = activeRenderIntent
    ? Math.max(0, activeRenderIntent.endFrameIndex - activeRenderIntent.startFrameIndex + 1)
    : 0;
  const sequenceMatchesIntent = Boolean(
    currentIntent && !isStaleAgainstIntent(renderedRange, currentIntent),
  );
  const sequenceAuthorityCurrent = Boolean(
    phase === 'preview-ready' &&
      success &&
      isCommitEligible(success, acceptedRequestIdRef.current === success.requestId),
  );
  const sequenceIsCurrent = Boolean(
    sequenceAuthorityCurrent &&
      currentIntent &&
      success?.renderTargetId === currentIntent.renderTargetId &&
      sequenceMatchesIntent,
  );
  const displayedSequenceItems = sequenceIsCurrent ? orderedSequenceItems : [];
  const displayedPreviewUrls = sequenceIsCurrent ? previewUrls : [];
  const selectedPreviewItem = displayedSequenceItems[selectedPreviewIndex] ?? null;
  const selectedPreviewUrl = displayedPreviewUrls[selectedPreviewIndex] ?? null;
  const hasPreview = Boolean(selectedPreviewItem && selectedPreviewUrl);
  const previewTargetId = phase === 'rendering'
    ? activeRenderIntent?.renderTargetId ?? null
    : sequenceIsCurrent && success
      ? success.renderTargetId
      : selectedEntry?.target.renderTargetId ?? null;
  const previewTarget = entries.find((entry) => entry.target.renderTargetId === previewTargetId)?.target ?? null;
  const previewState = phase === 'rendering'
    ? 'rendering'
    : phase === 'error'
      ? 'error'
      : hasPreview
        ? phase === 'committed' ? 'committed' : 'valid'
        : 'needs-preview';

  const sequencePreviewInputs = useMemo(() => {
    if (phase === 'rendering') {
      if (!activeRenderIntent) return undefined;
      return { [activeRenderIntent.renderTargetId]: { status: 'checking' as const } };
    }
    const previewItem = orderedSequenceItems[selectedPreviewIndex];
    const previewUrl = previewUrls[selectedPreviewIndex];
    if (!sequenceAuthorityCurrent || !success || !previewItem || !previewUrl || orderedSequenceItems.length === 0) {
      return undefined;
    }
    const firstFrame = orderedSequenceItems[0];
    const lastFrame = orderedSequenceItems[orderedSequenceItems.length - 1];
    if (!firstFrame || !lastFrame) return undefined;
    return {
      [success.renderTargetId]: {
        status: 'verified' as const,
        previewUrl,
        sha256: previewItem.preview.sha256,
        requestId: success.requestId,
        startFrameIndex: firstFrame.frameIndex,
        endFrameIndex: lastFrame.frameIndex,
      },
    };
  }, [activeRenderIntent, orderedSequenceItems, phase, previewUrls, selectedPreviewIndex, sequenceAuthorityCurrent, success]);
  const sequenceCandidates = useMemo(
    () => createFlaWorkbenchCandidates({
      context: { sessionId, source },
      sequenceEntries: entries,
      sequencePreviews: sequencePreviewInputs,
      selection: createFlaWorkbenchCandidateSelection(focusedTargetId),
    })
      .filter((candidate) => candidate.kind === 'sequence')
      .map((candidate) => ({
        ...candidate,
        checked: candidate.selectable && checkedCandidateKeys.has(flaUnifiedCandidateSelectionKey(candidate)),
      })),
    [checkedCandidateKeys, entries, focusedTargetId, sequencePreviewInputs, sessionId, source.basename, source.sha256],
  );
  useEffect(() => {
    onCandidatesChange?.(sequenceCandidates);
  }, [onCandidatesChange, sequenceCandidates]);

  useEffect(() => {
    if (!focusedCandidateIdentityKey) return;
    const candidate = sequenceCandidates.find((item) => item.identityKey === focusedCandidateIdentityKey);
    if (!candidate || candidate.kind !== 'sequence') return;
    const renderTargetId = candidate.operation.target.renderTargetId;
    setFocusedTargetId(renderTargetId);
    if (selectedTargetId === renderTargetId) return;
    const entry = entries.find((item) => item.target.renderTargetId === renderTargetId);
    if (!entry) return;
    const restoredRange = success?.renderTargetId === renderTargetId && renderedRange
      ? { startFrameIndex: renderedRange.startFrameIndex, endFrameIndex: renderedRange.endFrameIndex }
      : getDefaultSequenceRange(entry.target.frameCount);
    setSelectedTargetId(renderTargetId);
    setStartFrameIndex(restoredRange.startFrameIndex);
    setEndFrameIndex(restoredRange.endFrameIndex);
  }, [entries, focusedCandidateIdentityKey, renderedRange, selectedTargetId, sequenceCandidates, success]);
  useEffect(() => {
    if (!selectedTargetId || nameSuggestionTargetIdRef.current === selectedTargetId) return;
    const entry = entries.find((item) => item.target.renderTargetId === selectedTargetId);
    if (!entry) return;
    nameSuggestionTargetIdRef.current = selectedTargetId;
    if (presentation === 'unified-preview') setImportAsAnimation(true);
    setAnimationName(presentation === 'unified-preview'
      ? entry.target.userLabel
      : source.basename.replace(/\.fla$/iu, ''));
  }, [entries, presentation, selectedTargetId, source.basename]);
  const sequenceCandidateById = useMemo(
    () => new Map(sequenceCandidates.map((candidate) => [candidate.id, candidate])),
    [sequenceCandidates],
  );
  const currentSelectableKeys = useMemo(
    () => new Set(sequenceCandidates.filter((candidate) => candidate.selectable).map(flaUnifiedCandidateSelectionKey)),
    [sequenceCandidates],
  );
  const focusedSequenceCandidate = sequenceCandidates.find((candidate) =>
    candidate.kind === 'sequence' && candidate.identityKey === focusedCandidateIdentityKey,
  );
  const focusedSequenceMatchesPreview = !focusedCandidateIdentityKey ||
    focusedSequenceCandidate?.operation.target.renderTargetId === success?.renderTargetId;
  const canNavigatePreview = Boolean(
    sequenceIsCurrent && hasPreview && showUnifiedSequencePreview && focusedSequenceMatchesPreview &&
      sourceFpsAvailable &&
      !importLocked && documentVisible,
  );
  const playbackContextKey = canNavigatePreview && displayedSequenceItems.length >= 2 && success && renderedRange
    ? JSON.stringify([
        sessionId,
        source.sha256,
        success.renderTargetId,
        success.requestId,
        renderedRange.startFrameIndex,
        renderedRange.endFrameIndex,
        focusedCandidateIdentityKey ?? null,
        selectedOnlyView,
      ])
    : null;
  playbackSessionKeyRef.current = playbackContextKey;
  const playbackButton = (
    <button
      aria-label={playbackState.isPlaying ? '暂停序列播放' : '播放序列'}
      aria-pressed={playbackState.isPlaying}
      className="fla-frame-sequence-playback-button"
      data-playing={playbackState.isPlaying ? 'true' : 'false'}
      data-testid="fla-frame-sequence-playback"
      disabled={!playbackContextKey}
      onClick={() => {
        if (playbackState.isPlaying) dispatchPlayback({ type: 'pause' });
        else if (playbackContextKey) {
          playbackStartedAtRef.current = performance.now() -
            playbackState.selectedIndex * 1_000 / sourceFps;
          dispatchPlayback({ type: 'play', sessionKey: playbackContextKey });
        }
      }}
      type="button"
    >
      {presentation === 'unified-preview'
        ? playbackState.isPlaying ? '⏸' : '▶'
        : playbackState.isPlaying ? '⏸ 暂停' : '▶ 播放'}
    </button>
  );

  const stopPlayback = useCallback(() => {
    dispatchPlayback({ type: 'invalidate' });
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (playbackState.isPlaying && playbackState.activeSessionKey !== playbackContextKey) {
      dispatchPlayback({ type: 'invalidate' });
    }
  }, [playbackContextKey, playbackState.activeSessionKey, playbackState.isPlaying]);

  useEffect(() => {
    const syncVisibility = (): void => {
      const visible = document.visibilityState === 'visible';
      setDocumentVisible(visible);
      if (!visible) stopPlayback();
    };
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, [stopPlayback]);

  useEffect(() => {
    const { activeSessionKey, generation, isPlaying } = playbackState;
    if (!isPlaying || !activeSessionKey || activeSessionKey !== playbackContextKey) return undefined;
    let animationFrame = 0;
    const sample = (now: number): void => {
      if (document.visibilityState !== 'visible' || playbackSessionKeyRef.current !== activeSessionKey) {
        dispatchPlayback({ type: 'invalidate' });
        return;
      }
      const selectedIndex = sampleLoopingAnimationFrameIndex(
        now - playbackStartedAtRef.current,
        sourceFps,
        playbackState.frameCount,
      );
      dispatchPlayback({
        type: 'sample',
        sessionKey: activeSessionKey,
        generation,
        selectedIndex,
      });
      animationFrame = window.requestAnimationFrame(sample);
    };
    animationFrame = window.requestAnimationFrame(sample);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [playbackContextKey, playbackState.activeSessionKey, playbackState.frameCount, playbackState.generation, playbackState.isPlaying, sourceFps]);

  useIsomorphicLayoutEffect(() => {
    if (!selectedPreviewItem) return;
    const strip = filmstripRef.current;
    const selectedButton = strip?.querySelector<HTMLButtonElement>(
      `[data-frame-index="${selectedPreviewItem.frameIndex}"]`,
    );
    if (!strip || !selectedButton) return;
    const stripBounds = strip.getBoundingClientRect();
    const buttonBounds = selectedButton.getBoundingClientRect();
    const visibleLeft = stripBounds.left + strip.clientLeft + 5;
    const visibleRight = stripBounds.right - strip.clientLeft - 5;
    if (buttonBounds.left < visibleLeft) {
      strip.scrollLeft -= visibleLeft - buttonBounds.left;
    } else if (buttonBounds.right > visibleRight) {
      strip.scrollLeft += buttonBounds.right - visibleRight;
    }
  }, [selectedPreviewItem?.frameIndex]);

  const visibleEntries = useMemo(() => {
    const query = targetSearch.trim().toLocaleLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => {
      const candidate = sequenceCandidateById.get(entry.target.renderTargetId);
      return candidate?.searchText.includes(query) ?? false;
    });
  }, [entries, sequenceCandidateById, targetSearch]);
  const visibleSequenceCandidates = useMemo(
    () => visibleEntries.map((entry) => sequenceCandidateById.get(entry.target.renderTargetId))
      .filter((candidate) => candidate !== undefined),
    [sequenceCandidateById, visibleEntries],
  );
  const effectiveFocusedTargetId = useMemo(
    () => resolveVisibleSequenceFocus(
      focusedTargetId,
      visibleSequenceCandidates.map((candidate) => candidate.id),
    ),
    [focusedTargetId, visibleSequenceCandidates],
  );
  const focusedEntry = useMemo(
    () => entries.find((entry) => entry.target.renderTargetId === effectiveFocusedTargetId) ?? null,
    [entries, effectiveFocusedTargetId],
  );

  useEffect(() => {
    onWorkInProgressChange?.(phase === 'loading' || phase === 'rendering');
  }, [onWorkInProgressChange, phase]);

  useEffect(() => () => onWorkInProgressChange?.(false), [onWorkInProgressChange]);

  useEffect(() => {
    onTerminalStateChange?.('active');
    return () => {
      onTerminalStateChange?.('active');
    };
  }, [onTerminalStateChange]);

  useEffect(() => {
    onReconcileCandidates('sequence', currentSelectableKeys);
  }, [currentSelectableKeys, onReconcileCandidates]);

  // Revoke object URLs on unmount / sequence change.
  useEffect(() => {
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  // Load the catalog once (reused from R1 surface).
  useEffect(() => {
    let disposed = false;
    catalogInitializedRef.current = false;
    void (async () => {
      try {
        const response = await flaStaticSnapshotClient.catalog(sessionId);
        if (disposed) return;
        if (!response.ok) {
          setErrorMessage(response.error.message);
          setPhase('error');
          return;
        }
        setEntries(response.entries);
        if (!catalogInitializedRef.current) {
          catalogInitializedRef.current = true;
          const firstSupported = response.entries.find((entry) => entry.previewSupported);
          if (firstSupported) {
            const defaultRange = getDefaultSequenceRange(firstSupported.target.frameCount);
            setSelectedTargetId(firstSupported.target.renderTargetId);
            setFocusedTargetId(firstSupported.target.renderTargetId);
            setStartFrameIndex(defaultRange.startFrameIndex);
            setEndFrameIndex(defaultRange.endFrameIndex);
          } else {
            const firstEntry = response.entries[0];
            if (firstEntry) {
              const defaultRange = getDefaultSequenceRange(firstEntry.target.frameCount);
              setSelectedTargetId(firstEntry.target.renderTargetId);
              setFocusedTargetId(firstEntry.target.renderTargetId);
              setStartFrameIndex(defaultRange.startFrameIndex);
              setEndFrameIndex(defaultRange.endFrameIndex);
            }
          }
        }
        setPhase('selecting');
      } catch (error) {
        if (disposed) return;
        setErrorMessage(error instanceof Error ? error.message : '无法获取可渲染内容列表。');
        setPhase('error');
      }
    })();
    return () => {
      disposed = true;
    };
  }, [sessionId]);

  const clearPreviewResources = (): void => {
    stopPlayback();
    setPreviewUrls((current) => {
      for (const url of current) URL.revokeObjectURL(url);
      return [];
    });
    dispatchPlayback({ type: 'load', frameCount: 0 });
  };

  // Editing the target or range currently bound to a render invalidates that
  // exact request. Browsing another target only changes the visible draft; it
  // leaves a still-current checked sequence available until a new render starts.
  useEffect(() => {
    const currentIntentChanged = Boolean(
      success &&
      selectedTargetId === success.renderTargetId &&
      isStaleAgainstIntent(renderedRange, {
        renderTargetId: success.renderTargetId,
        startFrameIndex,
        endFrameIndex,
      }),
    );
    const activeIntent = activeIntentRef.current;
    const activeIntentChanged = Boolean(
      activeIntent &&
      selectedTargetId === activeIntent.renderTargetId &&
      (startFrameIndex !== activeIntent.startFrameIndex || endFrameIndex !== activeIntent.endFrameIndex),
    );
    if (!currentIntentChanged && !activeIntentChanged) return;

    const activeRequestId = activeRequestIdRef.current;
    const reset = intentChangeReset();
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
    activeRequestIdRef.current = null;
    activeIntentRef.current = null;
    acceptedRequestIdRef.current = null;
    latestSequenceRef.current = null;
    setSuccess(reset.success);
    setCompletedFrameCount(reset.completedFrameCount);
    clearPreviewResources();
    setPhase((current) => (current === 'loading' ? current : reset.phase));
    if (activeRequestId) {
      void flaFrameSequenceClient.cancel({
        format: 'fla-frame-sequence-cancel',
        version: 1,
        sessionId,
        requestId: activeRequestId,
      });
    }
  }, [endFrameIndex, renderedRange?.endFrameIndex, renderedRange?.renderTargetId, renderedRange?.startFrameIndex, selectedTargetId, sessionId, startFrameIndex, success]);

  // Cancel / invalidate any in-flight sequence on unmount (Corrective C).
  // Problem B: also remove the progress subscription to avoid leaks.
  useEffect(() => {
    return () => {
      progressUnsubRef.current?.();
      progressUnsubRef.current = null;
      const requestId = activeRequestIdRef.current;
      if (requestId) {
        void flaFrameSequenceClient.cancel({
          format: 'fla-frame-sequence-cancel',
          version: 1,
          sessionId,
          requestId,
        });
      }
    };
  }, [sessionId]);

  const buildPreviewUrls = (sequence: FlaFrameSequenceSuccess): string[] => {
    // Bounded transient display only - the PNG bytes are not retained after
    // unmount. Ordered by requested frame order, never completion order.
    return sequence.items
      .slice()
      .sort((a, b) => a.frameIndex - b.frameIndex)
      .map((item) =>
        URL.createObjectURL(new Blob([item.preview.bytes.buffer as ArrayBuffer], { type: 'image/png' })),
      );
  };

  const renderSequence = async (): Promise<void> => {
    stopPlayback();
    if (!selectedEntry || !validation.valid || !snapshot) return;
    const renderTargetId = selectedEntry.target.renderTargetId;
    const range = buildRange(renderTargetId, startFrameIndex, endFrameIndex);
    if (!range) {
      setErrorMessage('所选帧范围无效。');
      setPhase('error');
      return;
    }
    const requestId = crypto.randomUUID();
    activeRequestIdRef.current = requestId;
    activeIntentRef.current = {
      renderTargetId,
      startFrameIndex,
      endFrameIndex,
    };
    acceptedRequestIdRef.current = null;
    latestSequenceRef.current = null;
    onTerminalStateChange?.('active');
    setPhase('rendering');
    setErrorMessage('');
    setCompletedFrameCount(0);
    setSuccess(null);
    clearPreviewResources();
    // Problem B: subscribe to live progress for THIS request only.
    // Stale-request progress is ignored; the subscription is removed
    // on completion / cancel / re-render / unmount.
    progressUnsubRef.current?.();
    progressUnsubRef.current = flaFrameSequenceClient.progressSubscribe((progress) => {
      if (progress.requestId !== activeRequestIdRef.current) return;
      // Monotonic: never let a late/duplicate update lower the count.
      setCompletedFrameCount((current) => Math.max(current, progress.completedFrameCount));
    });
    try {
      const response: FlaFrameSequenceResponse = await flaStaticSnapshotPreviewQueue.run(async () => {
        if (activeRequestIdRef.current !== requestId) {
          return {
            ok: false as const,
            error: {
              code: 'SEQUENCE_CANCELLED' as const,
              message: 'Sequence cancelled before rendering began',
              requestId,
              completedFrameCount: 0,
            },
          };
        }
        return flaFrameSequenceClient.render({
          format: 'fla-frame-sequence-render',
          version: 1,
          requestId,
          sessionId,
          range,
        });
      });
      // Corrective C: a stale / late result can never overwrite the current
      // request or become commit-eligible.
      if (!isCurrentResponse(activeRequestIdRef.current, response)) return;
      activeRequestIdRef.current = null;
      activeIntentRef.current = null;
      progressUnsubRef.current?.();
      progressUnsubRef.current = null;
      if (response.ok) {
        const urls = buildPreviewUrls(response);
        setSuccess(response);
        setPreviewUrls(urls);
        dispatchPlayback({ type: 'load', frameCount: urls.length });
        acceptedRequestIdRef.current = response.requestId;
        latestSequenceRef.current = response;
        setPhase('preview-ready');
      } else {
        setCompletedFrameCount(response.error.completedFrameCount ?? 0);
        setErrorMessage(response.error.message);
        setPhase(response.error.code === 'SEQUENCE_CANCELLED' ? 'cancelled' : 'error');
      }
    } catch (error) {
      if (!isCurrentResponse(activeRequestIdRef.current, { ok: false, error: { code: 'RENDER_FAILED', message: '', requestId } })) return;
      activeRequestIdRef.current = null;
      activeIntentRef.current = null;
      progressUnsubRef.current?.();
      progressUnsubRef.current = null;
      setErrorMessage(error instanceof Error ? error.message : '序列渲染失败。');
      setPhase('error');
    }
  };

  const cancelSequence = async (): Promise<void> => {
    if (phase !== 'rendering') return;
    stopPlayback();
    const requestId = activeRequestIdRef.current;
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
    try {
      const response = await flaFrameSequenceClient.cancel({
        format: 'fla-frame-sequence-cancel',
        version: 1,
        sessionId,
        ...(requestId ? { requestId } : {}),
      });
      if (response.completedFrameCount !== undefined) {
        setCompletedFrameCount(response.completedFrameCount);
      }
    } catch {
      /* ignore - UI must not get stuck */
    }
    activeRequestIdRef.current = null;
    activeIntentRef.current = null;
    setPhase('cancelled');
  };

  const rerenderSequence = async (): Promise<void> => {
    // Corrective C: re-render invalidates the prior commit candidate.
    stopPlayback();
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
    activeRequestIdRef.current = null;
    activeIntentRef.current = null;
    const reset = rerenderReset();
    setPhase(reset.phase);
    acceptedRequestIdRef.current = null;
    latestSequenceRef.current = null;
    setSuccess(null);
    clearPreviewResources();
    await renderSequence();
  };

  const runUnifiedImport = useCallback<FlaUnifiedImportRunner>(async (
    selectedItems,
    currentSnapshot,
    shouldCancel,
  ): Promise<FlaUnifiedRouteResult> => {
    const candidateByKey = new Map(sequenceCandidates.map((candidate) => [
      flaUnifiedCandidateSelectionKey(candidate),
      candidate,
    ]));
    const candidate = selectedItems
      .map((item) => candidateByKey.get(item.key))
      .find((item) => item !== undefined);
    if (selectedItems.length !== 1 || candidate?.kind !== 'sequence' || !candidate.selectable ||
      !success || !sequenceAuthorityCurrent ||
      candidate.preview.requestId !== success.requestId ||
      candidate.operation.target.renderTargetId !== success.renderTargetId ||
      !isCommitEligible(success, acceptedRequestIdRef.current === success.requestId)) {
      return {
        items: selectedItems.map((item) => ({
          ...item,
          status: 'failed' as const,
          message: '帧序列预览或范围已变化；请重新生成并明确选择后再导入。',
        })),
        snapshot: currentSnapshot,
        stopFollowingRoutes: true,
      };
    }
    if (shouldCancel()) {
      return {
        items: selectedItems.map((item) => ({
          ...item,
          status: 'not-attempted' as const,
          message: '已取消后续导入，此项未尝试。',
        })),
        snapshot: currentSnapshot,
        cancelled: true,
      };
    }
    if (effectiveImportAsAnimation && !animationName.trim()) {
      return {
        items: selectedItems.map((item) => ({
          ...item,
          status: 'failed' as const,
          message: '请输入动画名称后再导入。',
        })),
        snapshot: currentSnapshot,
        stopFollowingRoutes: true,
      };
    }
    const firstItem = orderedSequenceItems[0];
    const lastItem = orderedSequenceItems[orderedSequenceItems.length - 1];
    if (!firstItem || !lastItem) {
      return {
        items: selectedItems.map((item) => ({ ...item, status: 'failed' as const, message: '序列帧数据不完整，未提交。' })),
        snapshot: currentSnapshot,
        stopFollowingRoutes: true,
      };
    }
    const range = buildRange(success.renderTargetId, firstItem.frameIndex, lastItem.frameIndex);
    if (!range) {
      return {
        items: selectedItems.map((item) => ({ ...item, status: 'failed' as const, message: '序列范围无效，无法导入。' })),
        snapshot: currentSnapshot,
        stopFollowingRoutes: true,
      };
    }
    onTerminalStateChange?.('importing');
    setPhase('committing');
    setErrorMessage('');
    try {
      const response = await flaFrameSequenceClient.commit({
        format: 'fla-frame-sequence-commit',
        version: 1,
        projectRoot: currentSnapshot.projectRoot,
        project: currentSnapshot.project,
        baseRevision: currentSnapshot.revision,
        sessionId,
        confirmedSequenceRequestId: success.requestId,
        importAsAnimation: effectiveImportAsAnimation,
        ...(effectiveImportAsAnimation ? { animationName: animationName.trim() } : {}),
        source,
        range,
        sequence: {
          requestId: success.requestId,
          sha256EachFrame: success.items.map((item) => item.preview.sha256),
          widthEachFrame: success.items.map((item) => item.preview.width),
          heightEachFrame: success.items.map((item) => item.preview.height),
          byteLengthEachFrame: success.items.map((item) => item.preview.bytes.byteLength),
          targetRenderTargetIdEachFrame: success.items.map((item) => item.preview.targetRenderTargetId),
        },
        confirmed: true,
      });
      if (response.ok) {
        const next = postCommitSequenceState();
        setPhase(next.phase);
        acceptedRequestIdRef.current = null;
        try {
          onImported(response);
          return {
            items: selectedItems.map((item) => ({
              ...item,
              status: response.projectChanged ? 'imported' as const : 'duplicate' as const,
              baseRevision: response.baseRevision,
              savedRevision: response.savedRevision,
              importedAssetCount: response.result.summary.importedCount,
              duplicateAssetCount: response.result.summary.duplicateCount,
            })),
            snapshot: {
              ...currentSnapshot,
              project: response.project,
              revision: response.savedRevision,
            },
          };
        } catch {
          return {
            items: selectedItems.map((item) => ({
              ...item,
              status: response.projectChanged ? 'imported' as const : 'duplicate' as const,
              baseRevision: response.baseRevision,
              savedRevision: response.savedRevision,
              importedAssetCount: response.result.summary.importedCount,
              duplicateAssetCount: response.result.summary.duplicateCount,
              message: '项目已提交，但界面状态同步失败；请返回素材库核对，勿重复导入。',
            })),
            snapshot: {
              ...currentSnapshot,
              project: response.project,
              revision: response.savedRevision,
            },
            warnings: ['序列已保存到项目，但素材库界面状态未能同步；已停止后续路由。'],
            stopFollowingRoutes: true,
          };
        }
      }
      const candidateStillCurrent = isSequenceCommitRetryable(response.error.code);
      if (!candidateStillCurrent) {
          activeRequestIdRef.current = null;
          acceptedRequestIdRef.current = null;
          latestSequenceRef.current = null;
          setSuccess(null);
          clearPreviewResources();
      }
      setErrorMessage(response.error.message);
      setPhase(candidateStillCurrent ? 'preview-ready' : 'selecting');
      return {
        items: selectedItems.map((item) => ({ ...item, status: 'failed' as const, message: response.error.message })),
        snapshot: currentSnapshot,
        stopFollowingRoutes: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '序列导入失败，结果无法确认。';
      setErrorMessage(message);
      setPhase('preview-ready');
      return {
        items: selectedItems.map((item) => ({ ...item, status: 'failed' as const, message })),
        snapshot: currentSnapshot,
        warnings: ['序列提交结果无法确认；为避免重复写入，已停止后续路由。请检查素材库。'],
        stopFollowingRoutes: true,
      };
    } finally {
      onTerminalStateChange?.('active');
    }
  }, [
    onImported,
    onTerminalStateChange,
    orderedSequenceItems,
    renderedRange,
    sequenceCandidates,
    sequenceAuthorityCurrent,
    sessionId,
    source,
    effectiveImportAsAnimation,
    animationName,
    success,
  ]);

  const runUnifiedImportRef = useRef(runUnifiedImport);
  runUnifiedImportRef.current = runUnifiedImport;
  const registeredImportRunner = useCallback<FlaUnifiedImportRunner>(
    (selectedItems, currentSnapshot, shouldCancel) =>
      runUnifiedImportRef.current(selectedItems, currentSnapshot, shouldCancel),
    [],
  );
  useEffect(() => {
    onRegisterImportRunner(registeredImportRunner);
    return () => onRegisterImportRunner(null);
  }, [onRegisterImportRunner, registeredImportRunner]);

  if (!selectedEntry) {
    return (
      <div className={reviewClassName} data-fla-session-id={sessionId} data-testid="fla-frame-sequence-review" data-workbench-panel={embedded ? 'sequence' : undefined} role="note">
        {phase === 'loading' ? (
          <p data-testid="fla-frame-sequence-loading">正在分析可渲染的图形…</p>
        ) : phase === 'error' ? (
          <p role="alert" data-testid="fla-frame-sequence-error">{errorMessage}</p>
        ) : (
          <p data-testid="fla-frame-sequence-empty">这个 FLA 没有可渲染的矢量内容。</p>
        )}
      </div>
    );
  }

  const target = selectedEntry.target;
  const supported = selectedEntry.previewSupported;
  const intentLocked = phase === 'rendering' || phase === 'committing' || importLocked;
  const singleImportDisabled = !canImportSingle || importLocked ||
    (effectiveImportAsAnimation && animationName.trim().length === 0);
  const canGeneratePhase = !sequenceIsCurrent && (
    phase === 'selecting' || phase === 'cancelled' || phase === 'error' ||
    phase === 'committed' || phase === 'preview-ready'
  );
  const canGenerate = supported && validation.valid && Boolean(snapshot) &&
    canGeneratePhase;
  const showUnifiedGenerationHint =
    presentation === 'unified-preview' &&
    canGenerate &&
    !importLocked &&
    (phase === 'selecting' || phase === 'preview-ready');
  const canSelectSequence = Boolean(sequenceCandidates.find((candidate) =>
    candidate.kind === 'sequence' && candidate.operation.target.renderTargetId === selectedTargetId && candidate.selectable,
  )) && !importLocked;
  const updateStartFrameOneBased = (value: number): void => {
    stopPlayback();
    const nextStartFrameIndex = Math.trunc(value) - 1;
    const lastFrameIndex = Math.max(0, targetFrameCount - 1);
    setStartFrameIndex(nextStartFrameIndex);
    setEndFrameIndex(Math.min(lastFrameIndex, nextStartFrameIndex + MAX_SEQUENCE_FRAMES - 1));
  };

  if (phase === 'committing' && !embedded) {
    return (
      <div className={`${reviewClassName} fla-stage-g-panel`} data-fla-session-id={sessionId} data-stage-g-state="importing" data-testid="fla-frame-sequence-review">
        <FlaStageGImporting
          importKind={effectiveImportAsAnimation ? 'animation' : 'image'}
          route="sequence"
        />
      </div>
    );
  }

  return (
    <div
      className={reviewClassName}
      data-preview-state={previewState}
      data-fla-session-id={sessionId}
      data-testid="fla-frame-sequence-review"
      data-workbench-panel={embedded ? 'sequence' : undefined}
      data-unified-sequence-preview={showUnifiedSequencePreview ? 'true' : 'false'}
    >
      <div className="fla-frame-sequence-workbench" data-testid="fla-frame-sequence-workbench">
        <aside className="fla-frame-sequence-target-region" data-testid="fla-frame-sequence-target-region">
          <section aria-labelledby="fla-frame-sequence-target-heading">
            <header className="fla-frame-sequence-region-heading">
              <div>
                <p className="fla-render-panel-kicker">可渲染目标</p>
                <h3 id="fla-frame-sequence-target-heading">选择目标</h3>
              </div>
              <span data-testid="fla-frame-sequence-target-count">
                {targetSearch.trim() ? `${visibleEntries.length} / ${entries.length}` : `${entries.length} 个`}
              </span>
            </header>
            <label className="fla-frame-sequence-target-search">
              <span>搜索</span>
              <input
                aria-label="搜索目标名称"
                data-testid="fla-frame-sequence-target-search"
                onChange={(event) => setTargetSearch(event.currentTarget.value)}
                placeholder="按名称搜索"
                type="search"
                value={targetSearch}
              />
            </label>
            <ul className="fla-frame-sequence-targets" data-testid="fla-frame-sequence-targets">
              {visibleEntries.map((entry) => {
                const entryTarget = entry.target;
                const candidate = sequenceCandidateById.get(entryTarget.renderTargetId);
                const showException = !entry.previewSupported;
                return (
                  <li
                    className={[
                      entryTarget.renderTargetId === selectedTargetId ? 'is-selected' : '',
                      candidate?.selectable ? 'has-import-candidate' : '',
                    ].filter(Boolean).join(' ')}
                    data-focused={entryTarget.renderTargetId === effectiveFocusedTargetId ? 'true' : 'false'}
                    data-fla-candidate-id={candidate?.identityKey ?? entryTarget.renderTargetId}
                    data-preview-binding-key={candidate?.preview.bindingKey}
                    data-preview-supported={entry.previewSupported ? 'true' : 'false'}
                    data-checked={candidate?.checked ? 'true' : 'false'}
                    data-render-target-selected={entryTarget.renderTargetId === selectedTargetId ? 'true' : 'false'}
                    key={candidate?.identityKey ?? entryTarget.renderTargetId}
                  >
                    <label aria-label={`${candidate?.displayLabel ?? entryTarget.userLabel}，${entryTarget.frameCount} 帧`} title={entryTarget.userLabel}>
                      <input
                        type="radio"
                        name="fla-frame-sequence-target"
                        checked={entryTarget.renderTargetId === selectedTargetId}
                        disabled={!entry.previewSupported || intentLocked}
                        onChange={() => {
                          stopPlayback();
                          const defaultRange = getDefaultSequenceRange(entryTarget.frameCount);
                          setSelectedTargetId(entryTarget.renderTargetId);
                          setFocusedTargetId(entryTarget.renderTargetId);
                          setStartFrameIndex(defaultRange.startFrameIndex);
                          setEndFrameIndex(defaultRange.endFrameIndex);
                        }}
                        data-testid={`fla-frame-sequence-target-${entryTarget.renderTargetId}`}
                      />
                      <span className="fla-frame-sequence-target-copy">
                        <strong title={entryTarget.userLabel}>{candidate?.displayLabel ?? entryTarget.userLabel}</strong>
                        <small>{entryTarget.frameCount} 帧</small>
                        {showException ? (
                          <small
                            className={entry.previewSupported ? 'fla-frame-sequence-target-fidelity' : 'fla-frame-sequence-unsupported'}
                            title={entry.previewSupported ? compatibilitySummary(entryTarget.compatibility) : boundedUnsupportedReason(entry.unsupportedReason)}
                          >
                            {entry.previewSupported ? '需注意兼容性' : '暂不可预览'}
                          </small>
                        ) : null}
                      </span>
                    </label>
                    {candidate?.selectable ? (
                      <label className="fla-frame-sequence-candidate-select">
                        <input
                          aria-label={`选择 ${candidate.displayLabel} 帧序列`}
                          checked={candidate.checked}
                          data-testid={`fla-frame-sequence-candidate-check-${entryTarget.renderTargetId}`}
                          disabled={!canSelectSequence}
                          onChange={() => onToggleCandidate(describeFlaUnifiedCandidate(candidate), !candidate.checked)}
                          type="checkbox"
                        />
                        <span>选择序列</span>
                      </label>
                    ) : null}
                    {!entry.previewSupported ? (
                      <button
                      aria-pressed={entryTarget.renderTargetId === effectiveFocusedTargetId}
                        className="fla-stage-f2-focus"
                        data-testid={`fla-frame-sequence-f2-focus-${entryTarget.renderTargetId}`}
                        disabled={intentLocked}
                        onClick={() => setFocusedTargetId(entryTarget.renderTargetId)}
                        type="button"
                      >
                        查看说明
                      </button>
                    ) : null}
                  </li>
                );
              })}
              {visibleEntries.length === 0 ? (
                <li className="fla-frame-sequence-targets-empty">没有匹配的目标，请清除搜索。</li>
              ) : null}
            </ul>
          </section>
        </aside>

        <section className="fla-frame-sequence-preview-region" data-testid="fla-frame-sequence-preview-region">
          <header className="fla-frame-sequence-region-heading">
            <div>
              <p className="fla-render-panel-kicker">帧序列</p>
              <h3 title={previewTarget?.userLabel}>
                {previewTarget ? `${previewTarget.userLabel} · 当前帧预览` : '当前帧预览'}
              </h3>
            </div>
            {phase === 'rendering' || (phase === 'committing' && embedded) ? null : (
              <output
                data-preview-state={previewState}
                data-testid="fla-frame-sequence-preview-status"
              >
                {sequencePreviewStatus(phase, hasPreview)}
              </output>
            )}
          </header>

          <div
            className="fla-frame-sequence-preview-stage"
            data-preview-state={previewState}
            data-preview-frame-index={selectedPreviewItem?.frameIndex}
            data-preview-target-id={previewTargetId ?? undefined}
            data-testid="fla-frame-sequence-preview-area"
          >
            {selectedPreviewUrl && selectedPreviewItem ? (
              <>
                <button
                  aria-label="上一帧"
                  className="fla-frame-sequence-step-button is-previous"
                  data-testid="fla-frame-sequence-previous"
                  disabled={!canNavigatePreview || displayedSequenceItems.length < 2 || selectedPreviewIndex === 0}
                  onClick={() => dispatchPlayback({ type: 'step', direction: -1 })}
                  type="button"
                >
                  ‹
                </button>
                <img
                  alt={`${target.userLabel} 第 ${selectedPreviewItem.frameIndex + 1} 帧预览`}
                  data-frame-index={selectedPreviewItem.frameIndex}
                  data-testid="fla-frame-sequence-preview-image"
                  src={selectedPreviewUrl}
                />
                <button
                  aria-label="下一帧"
                  className="fla-frame-sequence-step-button is-next"
                  data-testid="fla-frame-sequence-next"
                  disabled={!canNavigatePreview || displayedSequenceItems.length < 2 || selectedPreviewIndex >= displayedSequenceItems.length - 1}
                  onClick={() => dispatchPlayback({ type: 'step', direction: 1 })}
                  type="button"
                >
                  ›
                </button>
              </>
            ) : (
              <div
                aria-live={phase === 'rendering' ? 'polite' : undefined}
                className="fla-frame-sequence-preview-placeholder"
                data-testid="fla-frame-sequence-preview-placeholder"
                role={phase === 'rendering' ? 'status' : undefined}
              >
                {showUnifiedGenerationHint ? (
                  <strong data-testid="fla-frame-sequence-unified-idle-hint">
                    单击下方按钮生成预览
                  </strong>
                ) : null}
                {showUnifiedGenerationHint ? null : (
                  <>
                    <strong>
                      {phase === 'rendering'
                        ? activeRenderIntent && currentIntent?.renderTargetId !== activeRenderIntent.renderTargetId && previewTarget
                          ? `正在生成预览…（${previewTarget.userLabel}）`
                          : '正在生成预览…'
                        : selectedEntry.isBlank
                        ? '这是空白画面'
                        : !supported
                          ? '此项暂不可预览'
                            : phase === 'error'
                              ? presentation === 'unified-preview' ? '预览生成失败' : '连续画面生成失败'
                              : presentation === 'unified-preview' ? '尚未生成预览' : '尚未生成连续画面'}
                    </strong>
                    <span data-testid={phase === 'rendering' ? 'fla-frame-sequence-central-progress' : undefined}>
                      {phase === 'rendering'
                        ? `已完成 ${completedFrameCount} / ${activeRenderFrameCount} 帧`
                        : selectedEntry.isBlank
                        ? '源内容为空，不能导入。'
                        : !supported
                          ? boundedUnsupportedReason(selectedEntry.unsupportedReason)
                            : phase === 'error'
                              ? errorMessage || '请调整起始帧后重试。'
                              : presentation === 'unified-preview'
                                ? '调整范围后生成预览，最多 24 帧。'
                                : '选择起始帧后，按需生成最多 24 张连续图片。'}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div
            className="fla-frame-sequence-range"
            data-range-end={String(endFrameIndex)}
            data-range-start={String(startFrameIndex)}
            data-testid="fla-frame-sequence-range"
            aria-labelledby="fla-frame-sequence-range-heading"
          >
            <header className="fla-frame-sequence-range-heading">
              <div>
                <p className="fla-render-panel-kicker">范围</p>
                <h3 id="fla-frame-sequence-range-heading">帧范围</h3>
              </div>
              <output aria-live="polite" data-testid="fla-frame-sequence-count">
                {validation.valid ? `${validation.frameCount} 帧` : '范围无效'}
              </output>
            </header>
            <div className="fla-frame-sequence-range-inputs" aria-disabled={intentLocked}>
              <label>
                <span>起始帧</span>
                <input
                  aria-label="起始帧"
                  aria-describedby={validation.message
                    ? 'fla-frame-sequence-range-cap fla-frame-sequence-range-error'
                    : 'fla-frame-sequence-range-cap'}
                  aria-invalid={!validation.valid}
                  type="number"
                  min={1}
                  max={Math.max(1, targetFrameCount)}
                  value={startFrameIndex + 1}
                  disabled={intentLocked}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) updateStartFrameOneBased(value);
                  }}
                  onInput={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) updateStartFrameOneBased(value);
                  }}
                  style={presentation === 'unified-preview'
                    ? { width: `${getSequenceStartFrameInputWidthPx(startFrameIndex + 1)}px` }
                    : undefined}
                  data-testid="fla-frame-sequence-start"
                />
              </label>
              <span className="fla-frame-sequence-range-arrow" aria-hidden="true">→</span>
              <output data-testid="fla-frame-sequence-end">至第 {endFrameIndex + 1} 帧</output>
              <output className="fla-frame-sequence-range-result" aria-live="polite">
                = {validation.valid ? `${validation.frameCount} 帧` : '—'}
              </output>
            </div>
            <output
              className="fla-frame-sequence-range-summary"
              data-testid="fla-frame-sequence-range-summary"
              aria-live="polite"
            >
              {formatSequenceRangeSummaryForPresentation(
                startFrameIndex,
                endFrameIndex,
                validation,
                presentation,
              )}
            </output>
            {presentation !== 'unified-preview' ? (
              <fieldset
                className="fla-frame-sequence-import-mode"
                data-testid="fla-frame-sequence-import-mode-standard"
                disabled={importLocked}
              >
                <legend>序列入库方式</legend>
                <label>
                  <input
                    checked={!effectiveImportAsAnimation}
                    name={`fla-frame-sequence-import-mode-${sessionId}`}
                    onChange={() => setImportAsAnimation(false)}
                    type="radio"
                  />
                  <span>作为普通 PNG 图片</span>
                </label>
                <label>
                  <input
                    checked={effectiveImportAsAnimation}
                    disabled={!sourceFpsAvailable}
                    name={`fla-frame-sequence-import-mode-${sessionId}`}
                    onChange={() => setImportAsAnimation(true)}
                    type="radio"
                  />
                  <span>作为动画素材</span>
                </label>
                {effectiveImportAsAnimation ? (
                  <label className="fla-frame-sequence-animation-name">
                    <span>动画名称</span>
                    <input
                      aria-label="动画名称"
                      maxLength={200}
                      onChange={(event) => setAnimationName(event.currentTarget.value)}
                      value={animationName}
                    />
                  </label>
                ) : null}
                <small>
                  {sourceFpsAvailable
                    ? '动画将按源文件时序预览；目前仅支持素材库预览，不能加入镜头或正式导出。'
                    : '源文件播放速度无法确认，不能作为动画素材入库。'}
                </small>
              </fieldset>
            ) : null}
            <p
              className={`fla-frame-sequence-range-cap${presentation === 'unified-preview' ? ' sr-only' : ''}`}
              id="fla-frame-sequence-range-cap"
            >
              单次最多生成 {MAX_SEQUENCE_FRAMES} 帧。
            </p>
            {!validation.valid && validation.message ? (
              <p id="fla-frame-sequence-range-error" role="alert" data-testid="fla-frame-sequence-range-error">{validation.message}</p>
            ) : null}
            {presentation === 'unified-preview' ? (
              <div className="fla-c03-sequence-actions">
                {sequenceIsCurrent ? (
                  <div className="fla-c03-sequence-import-options" data-testid="fla-frame-sequence-import-mode">
                    <div className="fla-c03-sequence-format" role="group" aria-label="导入格式">
                      <button
                        aria-pressed={effectiveImportAsAnimation}
                        data-testid="fla-frame-sequence-format-animation"
                        disabled={!sourceFpsAvailable || importLocked}
                        onClick={() => setImportAsAnimation(true)}
                        title={sourceFpsAvailable ? '导入为动画素材' : '源文件播放速度无法确认，不能导入为动画'}
                        type="button"
                      >
                        动画
                      </button>
                      <button
                        aria-pressed={!effectiveImportAsAnimation}
                        data-testid="fla-frame-sequence-format-images"
                        disabled={importLocked}
                        onClick={() => setImportAsAnimation(false)}
                        title="逐帧导入 PNG 图片"
                        type="button"
                      >
                        图片
                      </button>
                    </div>
                    {effectiveImportAsAnimation ? (
                      <details className="fla-c03-animation-name-edit" data-testid="fla-frame-sequence-name-edit">
                        <summary title={animationName || '动画名称'}>{animationName || '填写动画名称'}</summary>
                        <label>
                          <span className="sr-only">动画名称</span>
                          <input
                            aria-label="动画名称"
                            maxLength={200}
                            onChange={(event) => setAnimationName(event.currentTarget.value)}
                            value={animationName}
                          />
                        </label>
                      </details>
                    ) : null}
                    {!sourceFpsAvailable ? (
                      <small className="fla-c03-sequence-format-status" role="status">
                        源文件播放速度无法确认，本次按图片导入。
                      </small>
                    ) : null}
                    {effectiveImportAsAnimation && !animationName.trim() ? (
                      <small className="fla-c03-sequence-format-error" role="alert">
                        请填写动画名称。
                      </small>
                    ) : null}
                  </div>
                ) : null}
                {phase === 'rendering' ? (
                  <button
                    type="button"
                    onClick={() => void cancelSequence()}
                    onKeyDown={(event) => handleSequenceActionKeyDown(event, () => void cancelSequence())}
                    data-testid="fla-frame-sequence-cancel"
                  >
                    取消生成
                  </button>
                ) : null}
                {canGeneratePhase ? (
                  <button
                    type="button"
                    disabled={!canGenerate}
                    onClick={() => void renderSequence()}
                    onKeyDown={(event) => handleSequenceActionKeyDown(event, () => void renderSequence())}
                    data-testid="fla-frame-sequence-render"
                  >
                    {presentation === 'unified-preview' ? '生成预览' : '生成连续画面'}
                  </button>
                ) : null}
                {sequenceIsCurrent ? (
                  !multiSelectMode && onImportSingle ? (
                    <button
                      className="fla-c03-sequence-import-primary"
                      data-testid="fla-frame-sequence-import-single"
                      disabled={singleImportDisabled}
                      onClick={onImportSingle}
                      type="button"
                    >
                      {effectiveImportAsAnimation ? '导入动画' : '导入图片'}
                    </button>
                  ) : null
                ) : null}
                {sequenceIsCurrent ? (
                  <button
                    type="button"
                    onClick={() => void rerenderSequence()}
                    onKeyDown={(event) => handleSequenceActionKeyDown(event, () => void rerenderSequence())}
                    data-testid="fla-frame-sequence-rerender"
                  >
                    重新生成
                  </button>
                ) : null}
                {playbackButton}
              </div>
            ) : null}
          </div>

          <div className="fla-frame-sequence-filmstrip-region" data-testid="fla-frame-sequence-filmstrip-region">
            {presentation !== 'unified-preview' ? (
              <header className="fla-frame-sequence-filmstrip-heading">
                <span>序列预览</span>
                <div className="fla-frame-sequence-filmstrip-controls">
                  {hasPreview ? (
                    <output
                      aria-label={`第 ${selectedPreviewIndex + 1} / ${displayedSequenceItems.length} 帧`}
                      data-batch-frame-index={selectedPreviewIndex + 1}
                      data-frame-count={displayedSequenceItems.length}
                      data-testid="fla-frame-sequence-frame-counter"
                    >
                      第 {selectedPreviewIndex + 1} / {displayedSequenceItems.length} 帧
                    </output>
                  ) : null}
                  {playbackButton}
                  <small>{displayedSequenceItems.length > 0 ? `${displayedSequenceItems.length} 帧` : '尚未生成'}</small>
                </div>
              </header>
            ) : null}
          <div
            className="fla-frame-sequence-filmstrip"
            data-testid="fla-frame-sequence-filmstrip"
            ref={filmstripRef}
            role="list"
            aria-label="已生成帧序列"
          >
              {displayedSequenceItems.length > 0 ? displayedSequenceItems.map((item, index) => {
                const url = displayedPreviewUrls[index];
                return (
                  <div key={`${item.frameIndex}-${item.preview.requestId}`} role="listitem">
                    <button
                      aria-label={`查看第 ${item.frameIndex + 1} 帧`}
                      aria-pressed={selectedPreviewIndex === index}
                      className={selectedPreviewIndex === index ? 'is-selected' : undefined}
                      data-frame-index={item.frameIndex}
                      data-testid={`fla-frame-sequence-filmstrip-item-${item.frameIndex}`}
                      onClick={() => dispatchPlayback({ type: 'select', selectedIndex: index })}
                      type="button"
                    >
                      <span className="fla-frame-sequence-filmstrip-thumb">
                        {url ? <img alt="" src={url} /> : null}
                      </span>
                      <span>{String(item.frameIndex + 1).padStart(2, '0')}</span>
                    </button>
                  </div>
                );
              }) : (
                <p data-testid="fla-frame-sequence-filmstrip-empty">生成后将在这里按顺序显示缩略图。</p>
              )}
            </div>
          </div>
        </section>

        <aside
          className="fla-frame-sequence-details-region"
          data-focused-target-id={focusedEntry?.target.renderTargetId}
          data-testid="fla-frame-sequence-details-region"
        >
          {focusedEntry && !focusedEntry.previewSupported ? (
            <FlaStageF2UnavailableDetails entry={focusedEntry} />
          ) : null}
          {focusedEntry?.previewSupported !== false ? (
            <>
          <p className="fla-render-panel-kicker">序列详情</p>
          <h3 title={target.userLabel}>{target.userLabel}</h3>
          <dl className="fla-frame-sequence-details" data-testid="fla-frame-sequence-details">
            <div><dt>素材</dt><dd>{renderTargetKindLabel(target.kind)} · {targetFrameCount} 帧</dd></div>
            <div><dt>输出</dt><dd>PNG 序列</dd></div>
            <div><dt>范围</dt><dd>第 {startFrameIndex + 1}–{endFrameIndex + 1} 帧 · {validation.valid ? `${validation.frameCount} 帧` : '无效'}</dd></div>
            <div><dt>结果</dt><dd>{displayedSequenceItems.length > 0 ? `${displayedSequenceItems.length} 帧已生成` : '待生成'}</dd></div>
          </dl>
           <details className="fla-frame-sequence-more" data-testid="fla-frame-sequence-more-details">
            <summary>更多详情</summary>
            <ul>
              {target.compatibility.map((status) => (
                <li data-status={status} key={status}>{compatibilityNote(status)}</li>
              ))}
            </ul>
            <dl className="fla-frame-sequence-detail-more">
              <div><dt>目标标识</dt><dd title={target.renderTargetId}>{target.renderTargetId}</dd></div>
              {target.sourceLibraryItemName ? (
                <div><dt>源元件</dt><dd title={target.sourceLibraryItemName}>{target.sourceLibraryItemName}</dd></div>
              ) : null}
              {target.sourceTimelineIndex !== undefined ? (
                <div><dt>源时间线</dt><dd>{target.sourceTimelineIndex}</dd></div>
              ) : null}
            </dl>
            {!supported ? <p className="fla-frame-sequence-unsupported">{boundedUnsupportedReason(selectedEntry.unsupportedReason)}</p> : null}
          </details>
            </>
          ) : null}
        </aside>
      </div>

      {presentation === 'standard' ? (
      <div className="fla-frame-sequence-action-bar" data-operation-target-id={target.renderTargetId} data-testid="fla-frame-sequence-action-bar">
        <div className="fla-frame-sequence-action-status">
          <strong data-testid="fla-frame-sequence-action-state" title={target.userLabel}>
            {target.userLabel} · 第 {startFrameIndex + 1}–{endFrameIndex + 1} 帧 · {validation.valid ? `${validation.frameCount} 帧` : '范围无效'}{phase === 'rendering' ? '' : ` · ${sequenceFooterState(phase, supported, sequenceIsCurrent)}`}
          </strong>
          {phase === 'cancelled' ? (
            <output data-testid="fla-frame-sequence-cancelled">
              已取消：{completedFrameCount} / {validation.valid ? validation.frameCount : 0} 帧
            </output>
          ) : null}
          {errorMessage ? <span role="alert" data-testid="fla-frame-sequence-error">{errorMessage}</span> : null}
        </div>
        <div className="fla-frame-sequence-action-buttons">
          {canGeneratePhase ? (
            <button
              className="fla-render-primary-action"
              type="button"
              disabled={!canGenerate}
              onClick={() => void renderSequence()}
              onKeyDown={(event) => handleSequenceActionKeyDown(event, () => void renderSequence())}
              data-testid="fla-frame-sequence-render"
            >
              生成帧序列
            </button>
          ) : null}
          {phase === 'rendering' ? (
            <button
              className="fla-render-primary-action"
              type="button"
              onClick={() => void cancelSequence()}
              onKeyDown={(event) => handleSequenceActionKeyDown(event, () => void cancelSequence())}
              data-testid="fla-frame-sequence-cancel"
            >
              取消
            </button>
          ) : null}
          {sequenceIsCurrent ? (
            <button
              className="fla-frame-sequence-secondary-action"
              type="button"
              onClick={() => void rerenderSequence()}
              onKeyDown={(event) => handleSequenceActionKeyDown(event, () => void rerenderSequence())}
              data-testid="fla-frame-sequence-rerender"
            >
              重新生成
            </button>
          ) : null}
        </div>
      </div>
      ) : null}
    </div>
  );
}

function isSequenceCommitRetryable(code: string): boolean {
  return code === 'ASSET_COMMIT_FAILED' || code === 'COMMIT_BUSY';
}

function renderTargetKindLabel(kind: FlaRenderTarget['kind']): string {
  switch (kind) {
    case 'scene':
      return '场景';
    case 'timeline':
      return '时间线';
    case 'graphic-symbol':
      return '图形元件';
    default:
      return '未知目标';
  }
}

function compatibilitySummary(compatibility: FlaRenderTarget['compatibility']): string {
  return compatibility.map((status) => compatibilityNote(status)).join(' ');
}

function compatibilityNote(status: FlaRenderTarget['compatibility'][number]): string {
  switch (status) {
    case 'exact':
      return '当前目标在安全渲染范围内。';
    case 'degraded':
      return '当前可预览，但部分时间轴或图形细节可能不完整。';
    case 'unsupported':
      return '当前目标不在可渲染范围内。';
    case 'unknown':
      return '当前目标兼容性尚未完全确认。';
    case 'not-present':
      return '源文件中未发现此类兼容性信息。';
    default:
      return '暂时无法确定此类内容的兼容性。';
  }
}

function sequencePreviewStatus(phase: RenderPhase, hasPreview: boolean): string {
  if (phase === 'rendering') return '';
  if (phase === 'committing') return '正在导入';
  if (phase === 'committed') return '已导入';
  if (phase === 'error') return '需要重试';
  if (phase === 'cancelled') return '已取消';
  return hasPreview ? '最新序列有效' : '等待生成';
}

function sequenceFooterState(phase: RenderPhase, supported: boolean, sequenceIsCurrent: boolean): string {
  if (!supported) return '不可预览';
  if (phase === 'rendering') return '';
  if (phase === 'committing') return '导入中';
  if (phase === 'committed') return '已导入';
  if (sequenceIsCurrent) return '最新序列有效';
  if (phase === 'cancelled') return '已取消';
  if (phase === 'error') return '需要重试';
  return '待生成';
}
