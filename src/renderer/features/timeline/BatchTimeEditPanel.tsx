import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Volume2, X } from 'lucide-react';
import {
  BATCH_EVENT_TYPE_LABEL,
  isBatchShiftableEvent,
  layerCompositeKeyTimes,
  type BatchLayerMotionSpanRef,
  type BatchTimelineEditPlan,
  type BatchTimelineSkippedEntry,
  type CrossTypeBatchShiftPlan,
  type Dialogue,
  type DialogueBatchMovePlan,
  type InsertTimeGapPlan,
  type Project,
  type SharedAudioClipPolicy,
  type Shot,
  type TimelineEvent,
} from '../../../domain';
import { Button } from '../../ui';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { dialogueSelectionStore } from '../../stores/dialogueSelectionStore';
import { dialogueStore } from '../../stores/dialogueStore';
import { timelineBatchStore } from '../../stores/timelineBatchStore';
import { dialogueSpeakerName } from '../dialogue/dialogueSpeaker';
import { dialoguePerformanceLinkStore } from '../../stores/dialoguePerformanceLinkStore';
import { useTimelineUi } from './timelineUiStore';

export interface BatchTimeEditPanelProps {
  project: Project;
  shot: Shot;
  onClose: () => void;
}

type BatchTimeMode = 'shift' | 'unify-duration' | 'insert-gap';

interface ActionCandidate {
  readonly id: string;
  readonly kind: 'timeline-event' | 'layer-motion-span';
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly supportedModes: readonly BatchTimeMode[];
  readonly spanRef?: BatchLayerMotionSpanRef;
  readonly layerId?: string;
  readonly keyTimeMs?: number;
}

type PreviewResult =
  | {
      readonly ok: true;
      readonly mode: 'shift';
      readonly requestedDeltaMs: number;
      readonly effectiveDeltaMs: number;
      readonly deltaFrames?: number;
      readonly frameSnapped?: boolean;
      readonly earliestStartMs: number;
      readonly latestEndMs: number;
      readonly changedCount: number;
      readonly dialogueCount: number;
      readonly actionCount: number;
      readonly includedDialogueIds: readonly string[];
      readonly splitAudioClipIds: readonly string[];
      readonly skipped: readonly BatchTimelineSkippedEntry[];
      readonly crossTypePlan?: CrossTypeBatchShiftPlan;
      readonly dialoguePlan?: DialogueBatchMovePlan;
      readonly actionPlan?: BatchTimelineEditPlan;
    }
  | {
      readonly ok: true;
      readonly mode: 'unify-duration';
      readonly earliestStartMs: number;
      readonly latestEndMs: number;
      readonly changedCount: number;
      readonly actionCount: number;
      readonly skipped: readonly BatchTimelineSkippedEntry[];
      readonly actionPlan: BatchTimelineEditPlan;
    }
  | {
      readonly ok: true;
      readonly mode: 'insert-gap';
      readonly plan: InsertTimeGapPlan;
    }
  | { readonly ok: false; readonly message: string };

const EVENT_TYPE_FALLBACK_LABEL: Record<TimelineEvent['type'], string> = {
  ...BATCH_EVENT_TYPE_LABEL,
  expression: '表情',
  flip: '翻转',
  visibility: '显示',
  'mouth-cue': '口型点',
  'mouth-pose': '口型段',
  'graphic-frame': '元件定格',
};

function formatSeconds(ms: number): string {
  return `${(ms / 1_000).toFixed(2)}s`;
}

function formatSignedDeltaMs(ms: number): string {
  const sign = ms > 0 ? '+' : ms < 0 ? '-' : '';
  const seconds = (Math.abs(ms) / 1_000)
    .toFixed(3)
    .replace(/0+$/u, '')
    .replace(/\.$/u, '');
  return `${sign}${seconds}s`;
}

function parseSecondsToMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1_000);
}

function mergeMotionSpans(
  spans: readonly BatchLayerMotionSpanRef[],
): BatchLayerMotionSpanRef[] {
  const timesByLayer = new Map<string, Set<number>>();
  const passthrough: BatchLayerMotionSpanRef[] = [];
  for (const span of spans) {
    if (!span.keyTimesMs) {
      // Legacy range-only spans cannot be merged precisely; preserve them.
      passthrough.push(span);
      continue;
    }
    const times = timesByLayer.get(span.layerId) ?? new Set<number>();
    for (const timeMs of span.keyTimesMs) times.add(timeMs);
    timesByLayer.set(span.layerId, times);
  }
  const merged = [...timesByLayer.entries()].map(([layerId, times]) => {
    const sorted = [...times].sort((left, right) => left - right);
    return {
      id: `merged:${layerId}:${sorted.join(':')}`,
      layerId,
      startMs: sorted[0]!,
      endMs: sorted[sorted.length - 1]!,
      keyTimesMs: sorted,
    };
  });
  return [...passthrough, ...merged];
}

function listTimedDialogues(shot: Shot): Dialogue[] {
  return [...shot.dialogues]
    .filter((dialogue) => dialogue.endMs > dialogue.startMs)
    .sort(
      (left, right) =>
        left.startMs - right.startMs ||
        left.endMs - right.endMs ||
        left.id.localeCompare(right.id),
    );
}

function listActionCandidates(shot: Shot): ActionCandidate[] {
  const layersById = new Map(shot.layers.map((layer) => [layer.id, layer]));
  const items: ActionCandidate[] = [];

  for (const event of shot.timelineEvents) {
    if (event.type === 'mouth-pose') continue;
    const layer = layersById.get(event.layerId);
    const layerName = layer?.name ?? '图层';
    const typeLabel = EVENT_TYPE_FALLBACK_LABEL[event.type];
    const isPointEvent =
      event.type === 'expression' ||
      event.type === 'flip' ||
      event.type === 'visibility';
    const available = isBatchShiftableEvent(event) && Boolean(layer) && !layer!.locked;
    const canShift = available && (isPointEvent ? event.endMs === event.startMs : event.endMs > event.startMs);
    const canSetDuration = available && !isPointEvent && event.endMs > event.startMs;
    items.push({
      id: event.id,
      kind: 'timeline-event',
      label: `${layerName} · ${typeLabel}`,
      startMs: event.startMs,
      endMs: event.endMs,
      supportedModes: [
        ...(canShift ? (['shift'] as const) : []),
        ...(canSetDuration ? (['unify-duration'] as const) : []),
      ],
    });
  }

  for (const layer of shot.layers) {
    if (layer.id === shot.backgroundLayerId) continue;
    const times = layerCompositeKeyTimes(layer);
    const nonZero = [...new Set(times.filter((t) => t > 0))].sort(
      (left, right) => left - right,
    );
    for (const timeMs of nonZero) {
      const spanId = `layer-motion:${layer.id}:${timeMs}`;
      items.push({
        id: spanId,
        kind: 'layer-motion-span',
        label: `${layer.name} · 关键帧 ${formatSeconds(timeMs)}`,
        startMs: timeMs,
        endMs: timeMs,
        supportedModes: layer.locked ? [] : ['shift', 'unify-duration'],
        spanRef: {
          id: spanId,
          layerId: layer.id,
          startMs: timeMs,
          endMs: timeMs,
          keyTimesMs: [timeMs],
        },
        layerId: layer.id,
        keyTimeMs: timeMs,
      });
    }
  }

  return items.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.label.localeCompare(right.label),
  );
}

/**
 * Compact overlay for WF-07 batch time editing:
 * - Batch shift timed dialogues (+ audio clips + mouth poses) with one delta.
 * - Batch shift & unify duration for supported action segments and keyframe spans.
 * - Cross-type gap-preserving shift when both dialogues and actions are selected.
 * Temporary selection & preview never mutate Project; Apply commits once.
 */
export function BatchTimeEditPanel({
  project,
  shot,
  onClose,
}: BatchTimeEditPanelProps): React.JSX.Element {
  const selectedDialogueIds = useSyncExternalStore(
    dialogueSelectionStore.subscribe,
    dialogueSelectionStore.getSelectedDialogueIds,
  );
  const [selectedActionIds, setSelectedActionIds] = useState<readonly string[]>([]);
  const [mode, setMode] = useState<BatchTimeMode>('shift');
  const [deltaInput, setDeltaInput] = useState('0.50');
  const [durationInput, setDurationInput] = useState('1.00');
  const [sharedClipPolicy, setSharedClipPolicy] =
    useState<SharedAudioClipPolicy>('split');
  const [includeLinkedPerformance, setIncludeLinkedPerformance] =
    useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [gapDurationInput, setGapDurationInput] = useState('0.50');
  const [confirmedGapExtensionToMs, setConfirmedGapExtensionToMs] = useState<
    number | null
  >(null);
  const timelineUi = useTimelineUi();
  const editableLayers = useMemo(
    () => shot.layers.filter((layer) => layer.id !== shot.backgroundLayerId),
    [shot.backgroundLayerId, shot.layers],
  );
  const [gapLayerIds, setGapLayerIds] = useState<readonly string[]>(() =>
    editableLayers.filter((layer) => !layer.locked).map((layer) => layer.id),
  );

  useEffect(() => {
    setGapLayerIds(
      editableLayers.filter((layer) => !layer.locked).map((layer) => layer.id),
    );
    setConfirmedGapExtensionToMs(null);
  }, [shot.id]);

  const timedDialogues = useMemo(() => listTimedDialogues(shot), [shot]);
  const timedDialogueIdSet = useMemo(
    () => new Set(timedDialogues.map((dialogue) => dialogue.id)),
    [timedDialogues],
  );
  const activeDialogueIds = useMemo(
    () => selectedDialogueIds.filter((id) => timedDialogueIdSet.has(id)),
    [selectedDialogueIds, timedDialogueIdSet],
  );

  const actionCandidates = useMemo(() => listActionCandidates(shot), [shot]);
  const actionById = useMemo(
    () => new Map(actionCandidates.map((item) => [item.id, item])),
    [actionCandidates],
  );

  // Prune stale or mode-incompatible action selections on shot/project/mode updates.
  useEffect(() => {
    setSelectedActionIds((current) =>
      current.every((id) => actionById.get(id)?.supportedModes.includes(mode))
        ? current
        : current.filter((id) => actionById.get(id)?.supportedModes.includes(mode)),
    );
  }, [actionById, mode]);

  // Escape closes cleanly without touching Project.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const selectedEventIds = useMemo(
    () =>
      selectedActionIds.filter(
        (id) =>
          actionById.get(id)?.kind === 'timeline-event' &&
          actionById.get(id)?.supportedModes.includes(mode),
      ),
    [selectedActionIds, actionById, mode],
  );
  const selectedMotionSpans = useMemo(() => {
    const timesByLayer = new Map<string, number[]>();
    for (const id of selectedActionIds) {
      const item = actionById.get(id);
      if (
        item?.kind !== 'layer-motion-span' ||
        !item.layerId ||
        item.keyTimeMs === undefined
      ) {
        continue;
      }
      const times = timesByLayer.get(item.layerId) ?? [];
      times.push(item.keyTimeMs);
      timesByLayer.set(item.layerId, times);
    }
    return [...timesByLayer.entries()].map(
      ([layerId, times]): BatchLayerMotionSpanRef => {
        const sorted = [...new Set(times)].sort((left, right) => left - right);
        return {
          id: `layer-motion:${layerId}:${sorted.join(':')}`,
          layerId,
          startMs: sorted[0]!,
          endMs: sorted[sorted.length - 1]!,
          keyTimesMs: sorted,
        };
      },
    );
  }, [selectedActionIds, actionById]);

  const availablePerformanceLinks = useMemo(
    () =>
      activeDialogueIds.length > 0
        ? dialoguePerformanceLinkStore.resolve(
            project.id,
            shot,
            activeDialogueIds,
          )
        : { eventIds: [], layerMotionSpans: [], missingCount: 0, blockedCount: 0 },
    [activeDialogueIds, project.id, shot],
  );
  const linkedPerformance = includeLinkedPerformance
    ? availablePerformanceLinks
    : { eventIds: [], layerMotionSpans: [], missingCount: 0, blockedCount: 0 };
  const effectiveEventIds = useMemo(
    () => [...new Set([...selectedEventIds, ...linkedPerformance.eventIds])],
    [linkedPerformance.eventIds, selectedEventIds],
  );
  const effectiveMotionSpans = useMemo(
    () =>
      mergeMotionSpans([
        ...selectedMotionSpans,
        ...linkedPerformance.layerMotionSpans,
      ]),
    [linkedPerformance.layerMotionSpans, selectedMotionSpans],
  );

  const hasSharedClipWithUnselected = useMemo(() => {
    if (activeDialogueIds.length === 0) return false;
    const selectedSet = new Set(activeDialogueIds);
    const clipIds = new Set(
      shot.dialogues
        .filter((d) => selectedSet.has(d.id) && d.audioClipId)
        .map((d) => d.audioClipId!),
    );
    return shot.dialogues.some(
      (d) => !selectedSet.has(d.id) && d.audioClipId && clipIds.has(d.audioClipId),
    );
  }, [activeDialogueIds, shot.dialogues]);

  /** Shared clip between a dialogue that moves and one that stays put. */
  const hasSharedClipAcrossInsertPoint = useMemo(() => {
    if (mode !== 'insert-gap') return false;
    const atMs = timelineUi.currentTimeMs;
    const moving = new Set(
      shot.dialogues
        .filter((dialogue) => dialogue.startMs >= atMs && dialogue.endMs > dialogue.startMs)
        .map((dialogue) => dialogue.id),
    );
    if (moving.size === 0) return false;
    const movingClipIds = new Set(
      shot.dialogues
        .filter((dialogue) => moving.has(dialogue.id) && dialogue.audioClipId)
        .map((dialogue) => dialogue.audioClipId!),
    );
    return shot.dialogues.some(
      (dialogue) =>
        !moving.has(dialogue.id) &&
        dialogue.audioClipId &&
        movingClipIds.has(dialogue.audioClipId),
    );
  }, [mode, shot.dialogues, timelineUi.currentTimeMs]);

  const parsedDeltaMs = parseSecondsToMs(deltaInput);
  const parsedDurationMs = parseSecondsToMs(durationInput);
  const parsedGapDurationMs = parseSecondsToMs(gapDurationInput);

  const preview: PreviewResult | null = useMemo(() => {
    const hasDialogues = activeDialogueIds.length > 0;
    const hasActions =
      effectiveEventIds.length > 0 || effectiveMotionSpans.length > 0;

    if (mode === 'insert-gap') {
      if (parsedGapDurationMs === null || parsedGapDurationMs < 1) {
        return { ok: false, message: '请输入大于 0 的插入空白时长（秒）。' };
      }
      try {
        return {
          ok: true,
          mode: 'insert-gap',
          plan: timelineBatchStore.planInsertGap({
            atMs: timelineUi.currentTimeMs,
            durationMs: parsedGapDurationMs,
            layerIds: gapLayerIds,
            sharedClipPolicy,
          }),
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : '无法计算插入空白预览。',
        };
      }
    }

    if (mode === 'shift') {
      if (!hasDialogues && !hasActions) return null;
      if (parsedDeltaMs === null) {
        return { ok: false, message: '请输入有效的偏移秒数，例如 0.50 或 -0.50。' };
      }
      try {
        if (hasDialogues && hasActions) {
          const crossTypePlan = timelineBatchStore.planCrossTypeShift({
            dialogueIds: activeDialogueIds,
            eventIds: effectiveEventIds,
            layerMotionSpans: effectiveMotionSpans,
            deltaMs: parsedDeltaMs,
            sharedClipPolicy,
          });
          return {
            ok: true,
            mode: 'shift',
            requestedDeltaMs: parsedDeltaMs,
            effectiveDeltaMs: crossTypePlan.deltaMs,
            deltaFrames: crossTypePlan.deltaFrames,
            frameSnapped: crossTypePlan.frameSnapped,
            earliestStartMs: crossTypePlan.earliestStartMs,
            latestEndMs: crossTypePlan.latestEndMs,
            changedCount: crossTypePlan.changedCount,
            dialogueCount: crossTypePlan.dialoguePlan?.entries.length ?? 0,
            actionCount:
              (crossTypePlan.actionPlan?.entries.length ?? 0) +
              (crossTypePlan.actionPlan?.motionSpanEntries.length ?? 0),
            includedDialogueIds:
              crossTypePlan.dialoguePlan?.includedDialogueIds ?? [],
            splitAudioClipIds:
              crossTypePlan.dialoguePlan?.splitAudioClipIds ?? [],
            skipped: crossTypePlan.skipped,
            crossTypePlan,
          };
        }
        if (hasDialogues) {
          const dialoguePlan = dialogueStore.planMoveMany(
            activeDialogueIds,
            parsedDeltaMs,
            { sharedClipPolicy },
          );
          return {
            ok: true,
            mode: 'shift',
            requestedDeltaMs: parsedDeltaMs,
            effectiveDeltaMs: dialoguePlan.deltaMs,
            earliestStartMs: dialoguePlan.earliestStartMs,
            latestEndMs: dialoguePlan.latestEndMs,
            changedCount:
              dialoguePlan.deltaMs === 0 ? 0 : dialoguePlan.entries.length,
            dialogueCount: dialoguePlan.entries.length,
            actionCount: 0,
            includedDialogueIds: dialoguePlan.includedDialogueIds,
            splitAudioClipIds: dialoguePlan.splitAudioClipIds,
            skipped: [],
            dialoguePlan,
          };
        }
        const actionPlan = timelineBatchStore.plan({
          eventIds: effectiveEventIds,
          layerMotionSpans: effectiveMotionSpans,
          edit: { action: 'shift', deltaMs: parsedDeltaMs },
        });
        return {
          ok: true,
          mode: 'shift',
          requestedDeltaMs: parsedDeltaMs,
          effectiveDeltaMs: actionPlan.effectiveDeltaMs ?? parsedDeltaMs,
          deltaFrames: actionPlan.deltaFrames,
          frameSnapped: actionPlan.frameSnapped,
          earliestStartMs: actionPlan.earliestStartMs,
          latestEndMs: actionPlan.latestEndMs,
          changedCount: actionPlan.changedCount,
          dialogueCount: 0,
          actionCount:
            actionPlan.entries.length + actionPlan.motionSpanEntries.length,
          includedDialogueIds: [],
          splitAudioClipIds: [],
          skipped: actionPlan.skipped,
          actionPlan,
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : '无法计算批量平移预览。',
        };
      }
    }

    if (!hasActions) return null;
    if (parsedDurationMs === null || parsedDurationMs < 1) {
      return { ok: false, message: '请输入大于 0 的统一时长（秒）。' };
    }
    try {
      const actionPlan = timelineBatchStore.plan({
        eventIds: selectedEventIds,
        layerMotionSpans: selectedMotionSpans,
        edit: { action: 'unify-duration', durationMs: parsedDurationMs },
      });
      return {
        ok: true,
        mode: 'unify-duration',
        earliestStartMs: actionPlan.earliestStartMs,
        latestEndMs: actionPlan.latestEndMs,
        changedCount: actionPlan.changedCount,
        actionCount:
          actionPlan.entries.length + actionPlan.motionSpanEntries.length,
        skipped: actionPlan.skipped,
        actionPlan,
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : '无法计算统一时长预览。',
      };
    }
  }, [
    project,
    shot,
    activeDialogueIds,
    selectedEventIds,
    selectedMotionSpans,
    effectiveEventIds,
    effectiveMotionSpans,
    mode,
    parsedDeltaMs,
    parsedDurationMs,
    parsedGapDurationMs,
    gapLayerIds,
    timelineUi.currentTimeMs,
    sharedClipPolicy,
  ]);

  const previewChangedCount = preview?.ok
    ? preview.mode === 'insert-gap'
      ? preview.plan.changedCount
      : preview.changedCount
    : 0;
  const previewSkipped = preview?.ok
    ? preview.mode === 'insert-gap'
      ? preview.plan.skipped
      : preview.skipped
    : [];
  const previewGapExtensionToMs =
    preview?.ok && preview.mode === 'insert-gap'
      ? preview.plan.extensionToMs
      : null;
  const gapExtensionConfirmed =
    previewGapExtensionToMs === null ||
    confirmedGapExtensionToMs === previewGapExtensionToMs;
  useEffect(() => {
    if (
      confirmedGapExtensionToMs !== null &&
      confirmedGapExtensionToMs !== previewGapExtensionToMs
    ) {
      setConfirmedGapExtensionToMs(null);
    }
  }, [confirmedGapExtensionToMs, previewGapExtensionToMs]);
  const canApply =
    Boolean(preview?.ok) &&
    previewChangedCount > 0 &&
    (mode !== 'insert-gap' || gapExtensionConfirmed);

  const handleApply = (): void => {
    if (!preview || !preview.ok || previewChangedCount === 0) return;
    setCommitError(null);
    const snapshotBefore = editorProjectStore.getSnapshot();
    if (!snapshotBefore || snapshotBefore.project.id !== project.id) return;
    try {
      if (preview.mode === 'insert-gap') {
        timelineBatchStore.applyInsertGap({
          atMs: timelineUi.currentTimeMs,
          durationMs: preview.plan.durationMs,
          layerIds: gapLayerIds,
          sharedClipPolicy,
        });
        onClose();
        return;
      }
      if (preview.mode === 'shift') {
        if (preview.crossTypePlan) {
          const moves = includeLinkedPerformance
            ? // Remap with the exact per-key moves the batch performed: a single
              // integer delta fabricates identities on the 24fps grid.
              (preview.crossTypePlan.actionPlan?.motionSpanEntries ?? [])
                .filter((entry) => (entry.keyMoves?.length ?? 0) > 0)
                .map((entry) => ({
                  layerId: entry.layerId,
                  keyMoves: entry.keyMoves!,
                }))
            : [];
          const commitCrossType = (): void => {
            timelineBatchStore.applyCrossTypeShift({
              dialogueIds: activeDialogueIds,
              eventIds: effectiveEventIds,
              layerMotionSpans: effectiveMotionSpans,
              deltaMs: parsedDeltaMs!,
              sharedClipPolicy,
            });
          };
          if (includeLinkedPerformance && moves.length > 0) {
            dialoguePerformanceLinkStore.applyTrackedMove(
              project.id,
              shot.id,
              activeDialogueIds,
              moves,
              commitCrossType,
            );
          } else {
            commitCrossType();
          }
        } else if (preview.dialoguePlan) {
          dialogueStore.moveMany(activeDialogueIds, parsedDeltaMs!, {
            sharedClipPolicy,
          });
        } else if (preview.actionPlan) {
          timelineBatchStore.apply({
            eventIds: effectiveEventIds,
            layerMotionSpans: effectiveMotionSpans,
            edit: { action: 'shift', deltaMs: parsedDeltaMs! },
          });
        }
      } else {
        timelineBatchStore.apply({
          eventIds: selectedEventIds,
          layerMotionSpans: selectedMotionSpans,
          edit: { action: 'unify-duration', durationMs: parsedDurationMs! },
        });
      }
      onClose();
    } catch (error) {
      setCommitError(
        error instanceof Error ? error.message : '批量时间编辑失败，请重试。',
      );
    }
  };

  const toggleDialogue = (dialogueId: string): void => {
    setCommitError(null);
    dialogueSelectionStore.toggleInSelection(dialogueId);
  };

  const toggleAction = (actionId: string): void => {
    setCommitError(null);
    setSelectedActionIds((current) =>
      current.includes(actionId)
        ? current.filter((id) => id !== actionId)
        : [...current, actionId],
    );
  };

  const adjustDelta = (stepMs: number): void => {
    const base = parsedDeltaMs ?? 0;
    setDeltaInput(((base + stepMs) / 1_000).toFixed(2));
  };

  return (
    <section
      aria-label="批量时间编辑"
      className="batch-time-edit-panel"
      data-testid="batch-time-edit-panel"
    >
      <header className="batch-time-edit-header">
        <h3>批量时间编辑</h3>
        <button
          type="button"
          className="batch-time-edit-close"
          aria-label="关闭批量时间编辑"
          onClick={onClose}
        >
          <X aria-hidden="true" focusable="false" size={16} />
        </button>
      </header>

      <div className="batch-time-edit-modes" role="tablist" aria-label="编辑模式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'shift'}
          className={`batch-time-mode-tab${mode === 'shift' ? ' is-active' : ''}`}
          data-testid="batch-time-mode-shift"
          onClick={() => {
            setMode('shift');
            setCommitError(null);
          }}
        >
          整体平移
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'unify-duration'}
          className={`batch-time-mode-tab${
            mode === 'unify-duration' ? ' is-active' : ''
          }`}
          data-testid="batch-time-mode-unify"
          onClick={() => {
            setMode('unify-duration');
            setCommitError(null);
          }}
        >
          统一动作时长
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'insert-gap'}
          className={`batch-time-mode-tab${
            mode === 'insert-gap' ? ' is-active' : ''
          }`}
          data-testid="batch-time-mode-insert-gap"
          onClick={() => {
            setMode('insert-gap');
            setCommitError(null);
          }}
        >
          插入空白
        </button>
      </div>

      {mode === 'shift' ? (
        <div className="batch-time-edit-control-row">
          <label className="batch-time-input-label">
            <span>偏移（秒）</span>
            <input
              type="number"
              step="0.1"
              value={deltaInput}
              data-testid="batch-time-delta-input"
              onChange={(event) => {
                setDeltaInput(event.target.value);
                setCommitError(null);
              }}
            />
          </label>
          <div className="batch-time-step-buttons">
            <button type="button" onClick={() => adjustDelta(-500)}>
              -0.5s
            </button>
            <button type="button" onClick={() => adjustDelta(-100)}>
              -0.1s
            </button>
            <button type="button" onClick={() => adjustDelta(100)}>
              +0.1s
            </button>
            <button type="button" onClick={() => adjustDelta(500)}>
              +0.5s
            </button>
          </div>
        </div>
      ) : mode === 'unify-duration' ? (
        <div className="batch-time-edit-control-row">
          <label className="batch-time-input-label">
            <span>目标时长（秒）</span>
            <input
              type="number"
              min="0.05"
              step="0.1"
              value={durationInput}
              data-testid="batch-time-duration-input"
              onChange={(event) => {
                setDurationInput(event.target.value);
                setCommitError(null);
              }}
            />
          </label>
        </div>
      ) : (
        <div className="batch-time-edit-control-row">
          <label className="batch-time-input-label">
            <span>插入时长（秒）</span>
            <input
              type="number"
              min="0.04"
              step="0.1"
              value={gapDurationInput}
              data-testid="batch-time-gap-duration-input"
              onChange={(event) => {
                setGapDurationInput(event.target.value);
                setConfirmedGapExtensionToMs(null);
                setCommitError(null);
              }}
            />
          </label>
          <span className="batch-time-note">
            {`从 ${formatSeconds(timelineUi.currentTimeMs)} 起插入空白`}
          </span>
        </div>
      )}

      {(mode === 'shift' && hasSharedClipWithUnselected) ||
      (mode === 'insert-gap' && hasSharedClipAcrossInsertPoint) ? (
        <div
          className="batch-time-shared-clip-policy"
          data-testid="batch-time-shared-clip-policy"
        >
          <span>共享配音处理</span>
          <label>
            <input
              type="radio"
              name="sharedClipPolicy"
              value="split"
              checked={sharedClipPolicy === 'split'}
              onChange={() => setSharedClipPolicy('split')}
            />
            拆分共享配音（保留未选对白原位置）
          </label>
          <label>
            <input
              type="radio"
              name="sharedClipPolicy"
              value="include"
              checked={sharedClipPolicy === 'include'}
              onChange={() => setSharedClipPolicy('include')}
            />
            联选共享对白一起平移
          </label>
        </div>
      ) : null}

      {mode === 'shift' &&
      activeDialogueIds.length > 0 &&
      (availablePerformanceLinks.eventIds.length > 0 ||
        availablePerformanceLinks.layerMotionSpans.length > 0 ||
        availablePerformanceLinks.missingCount > 0 ||
        availablePerformanceLinks.blockedCount > 0) ? (
        <>
          {availablePerformanceLinks.eventIds.length > 0 ||
          availablePerformanceLinks.layerMotionSpans.length > 0 ? (
            <label
              className="batch-time-linked-performance"
              data-testid="batch-time-linked-performance"
            >
              <input
                type="checkbox"
                checked={includeLinkedPerformance}
                onChange={(event) => {
                  setIncludeLinkedPerformance(event.target.checked);
                  setCommitError(null);
                }}
              />
              <span>
                {`连同剧本关联表演移动（${
                  availablePerformanceLinks.eventIds.length +
                  availablePerformanceLinks.layerMotionSpans.reduce(
                    (sum, span) => sum + (span.keyTimesMs?.length ?? 0),
                    0,
                  )
                } 项）`}
              </span>
            </label>
          ) : null}
          {availablePerformanceLinks.missingCount > 0 ? (
            <div className="batch-time-note" role="status">
              {`${availablePerformanceLinks.missingCount} 项关联表演已被修改或删除（同刻新建的其他键不算），本次不会移动。`}
            </div>
          ) : null}
          {availablePerformanceLinks.blockedCount > 0 ? (
            <div className="batch-time-note" role="status">
              {`${availablePerformanceLinks.blockedCount} 个关联键在同刻新增了未关联属性，整键移动会带上无关内容，本次局部跳过。`}
            </div>
          ) : null}
        </>
      ) : null}

      {mode === 'insert-gap' ? (
        <div className="batch-time-group" data-testid="batch-time-gap-layers">
          <div className="batch-time-group-title">参与图层</div>
          <div className="batch-time-gap-layers">
            {editableLayers.map((layer) => {
              const checked = gapLayerIds.includes(layer.id);
              return (
                <label key={layer.id} className="batch-time-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={layer.locked}
                    onChange={() =>
                      setGapLayerIds((current) =>
                        checked
                          ? current.filter((id) => id !== layer.id)
                          : [...current, layer.id],
                      )
                    }
                  />
                  <span className="batch-time-item-label">
                    <span>{layer.name}</span>
                    {layer.locked ? (
                      <span className="batch-time-badge">已锁定</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="batch-time-selection-toolbar">
        {mode === 'shift' && timedDialogues.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              dialogueSelectionStore.setSelection(
                timedDialogues.map((d) => d.id),
              )
            }
          >
            全选对白（{timedDialogues.length}）
          </button>
        ) : null}
        {actionCandidates.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              setSelectedActionIds(
                actionCandidates
                  .filter((item) => item.supportedModes.includes(mode))
                  .map((item) => item.id),
              )
            }
          >
            全选动作（{actionCandidates.filter((item) => item.supportedModes.includes(mode)).length}）
          </button>
        ) : null}
        {activeDialogueIds.length > 0 || selectedActionIds.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              dialogueSelectionStore.clear();
              setSelectedActionIds([]);
            }}
          >
            清空选择
          </button>
        ) : null}
      </div>

      <div className="batch-time-lists">
        {mode === 'shift' && timedDialogues.length > 0 ? (
          <div className="batch-time-group">
            <div className="batch-time-group-title">已定时对白</div>
            <ul className="batch-time-list" data-testid="batch-time-dialogue-list">
              {timedDialogues.map((dialogue) => {
                const checked = activeDialogueIds.includes(dialogue.id);
                const speaker = dialogueSpeakerName(
                  dialogue,
                  project.characters,
                );
                return (
                  <li key={dialogue.id}>
                    <label className="batch-time-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDialogue(dialogue.id)}
                      />
                      <span className="batch-time-item-label">
                        <strong>{speaker}</strong>
                        <span>{dialogue.text}</span>
                      </span>
                      <span className="batch-time-item-meta">
                        {dialogue.audioClipId ? (
                          <Volume2
                            aria-label="已绑定配音"
                            size={13}
                            focusable="false"
                          />
                        ) : null}
                        <span>
                          {formatSeconds(dialogue.startMs)}–
                          {formatSeconds(dialogue.endMs)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {actionCandidates.length > 0 ? (
          <div className="batch-time-group">
            <div className="batch-time-group-title">动作与关键帧</div>
            <ul className="batch-time-list" data-testid="batch-time-action-list">
              {actionCandidates.map((item) => {
                const checked = selectedActionIds.includes(item.id);
                const supported = item.supportedModes.includes(mode);
                return (
                  <li key={item.id}>
                    <label
                      className={`batch-time-item${
                        supported ? '' : ' is-unsupported'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!supported}
                        onChange={() => toggleAction(item.id)}
                      />
                      <span className="batch-time-item-label">
                        <span>{item.label}</span>
                        {!supported ? (
                          <span className="batch-time-badge">
                            {mode === 'unify-duration'
                              ? '仅支持平移'
                              : '暂不支持'}
                          </span>
                        ) : null}
                      </span>
                      <span className="batch-time-item-meta">
                        {item.keyTimeMs !== undefined
                          ? '关键帧'
                          : `${formatSeconds(item.startMs)}–${formatSeconds(item.endMs)}`}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {timedDialogues.length === 0 && actionCandidates.length === 0 ? (
          <p className="batch-time-empty">当前镜头没有可批量调整的对白或动作区间。</p>
        ) : null}
      </div>

      {preview ? (
        preview.ok ? (
          <div
            className="batch-time-preview"
            data-testid="batch-time-preview"
            role="status"
          >
            <div>
              {previewChangedCount === 0
                ? '没有可后移的受支持内容。'
                : `预计调整 ${previewChangedCount} 项：${formatSeconds(
                    preview.mode === 'insert-gap'
                      ? preview.plan.earliestStartMs
                      : preview.earliestStartMs,
                  )} – ${formatSeconds(
                    preview.mode === 'insert-gap'
                      ? preview.plan.latestEndMs
                      : preview.latestEndMs,
                  )}`}
            </div>
            {preview.mode === 'insert-gap' ? (
              <>
                {preview.plan.effectiveDeltaMs !== preview.plan.durationMs ? (
                  <div
                    className="batch-time-gap-effective"
                    data-testid="batch-time-gap-effective"
                  >
                    {`关键帧按 24fps 对齐，实际后移 ${formatSeconds(
                      preview.plan.effectiveDeltaMs,
                    )}（请求 ${formatSeconds(preview.plan.durationMs)}）`}
                  </div>
                ) : null}
                {preview.plan.crossTypePlan?.dialoguePlan ? (
                  <div
                    className="batch-time-gap-shared-audio"
                    data-testid="batch-time-gap-shared-audio"
                  >
                    {`移动对白 ${preview.plan.crossTypePlan.dialoguePlan.includedDialogueIds.length} 条；共享配音 ${
                      preview.plan.crossTypePlan.dialoguePlan.splitAudioClipIds.length
                    } 段按「${
                      sharedClipPolicy === 'split'
                        ? '拆分，未选对白留在原位'
                        : '连同未选对白一起移动'
                    }」处理`}
                  </div>
                ) : null}
                {preview.plan.needsShotExtension &&
                preview.plan.extensionToMs !== null ? (
                  <label
                    className="batch-time-extend-confirm"
                    data-testid="batch-time-gap-extension"
                  >
                    <input
                      type="checkbox"
                      checked={
                        confirmedGapExtensionToMs ===
                        preview.plan.extensionToMs
                      }
                      onChange={(event) =>
                        setConfirmedGapExtensionToMs(
                          event.target.checked
                            ? preview.plan.extensionToMs
                            : null,
                        )
                      }
                    />
                    <span>
                      {`镜头需延长至 ${formatSeconds(preview.plan.extensionToMs)} 才能插入`}
                    </span>
                  </label>
                ) : null}
                {preview.plan.unsupported.length > 0 ? (
                  <ul
                    className="batch-time-skipped"
                    data-testid="batch-time-gap-unsupported"
                  >
                    {preview.plan.unsupported.map((item) => (
                      <li key={`${item.kind}:${item.layerId ?? item.label}`}>
                        <AlertTriangle aria-hidden="true" size={13} />
                        <span>{item.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
            {preview.mode === 'shift' &&
            preview.frameSnapped &&
            preview.deltaFrames !== undefined ? (
              <div className="batch-time-note" data-testid="batch-time-frame-sync-note">
                {`含关键帧，按 24fps 帧网格统一偏移 ${formatSignedDeltaMs(
                  preview.effectiveDeltaMs,
                )}（${preview.deltaFrames > 0 ? '+' : ''}${preview.deltaFrames} 帧）`}
              </div>
            ) : null}
            {preview.mode === 'shift' && preview.splitAudioClipIds.length > 0 ? (
              <div className="batch-time-note">
                将拆分 {preview.splitAudioClipIds.length} 段共享配音，未选对白保持原位。
              </div>
            ) : null}
            {preview.mode === 'shift' &&
            preview.includedDialogueIds.length > 0 ? (
              <div className="batch-time-note">
                已联选 {preview.includedDialogueIds.length} 条共享配音对白同步平移。
              </div>
            ) : null}
            {previewSkipped.length > 0 ? (
              <ul
                className="batch-time-skipped"
                data-testid="batch-time-skipped"
              >
                {previewSkipped.map((item) => (
                  <li key={item.itemId}>
                    <AlertTriangle aria-hidden="true" size={13} />
                    <span>{item.reason}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div
            className="batch-time-error"
            data-testid="batch-time-error"
            role="alert"
          >
            {preview.message}
          </div>
        )
      ) : null}

      {commitError ? (
        <div className="batch-time-error" role="alert">
          {commitError}
        </div>
      ) : null}

      <footer className="batch-time-edit-actions">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button
          variant="primary"
          data-testid="batch-time-apply"
          disabled={!canApply}
          onClick={handleApply}
        >
          应用
        </Button>
      </footer>
    </section>
  );
}
