import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Volume2, X } from 'lucide-react';
import {
  BATCH_EVENT_TYPE_LABEL,
  isBatchEditableEvent,
  layerCompositeKeyTimes,
  type BatchLayerMotionSpanRef,
  type BatchTimelineEditPlan,
  type BatchTimelineSkippedEntry,
  type CrossTypeBatchShiftPlan,
  type Dialogue,
  type DialogueBatchMovePlan,
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

export interface BatchTimeEditPanelProps {
  project: Project;
  shot: Shot;
  onClose: () => void;
}

type BatchTimeMode = 'shift' | 'unify-duration';

interface ActionCandidate {
  readonly id: string;
  readonly kind: 'timeline-event' | 'layer-motion-span';
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly supported: boolean;
  readonly spanRef?: BatchLayerMotionSpanRef;
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
    const supported =
      isBatchEditableEvent(event) &&
      Boolean(layer) &&
      !layer!.locked &&
      event.endMs > event.startMs;
    items.push({
      id: event.id,
      kind: 'timeline-event',
      label: `${layerName} · ${typeLabel}`,
      startMs: event.startMs,
      endMs: event.endMs,
      supported,
    });
  }

  for (const layer of shot.layers) {
    if (layer.id === shot.backgroundLayerId) continue;
    const times = layerCompositeKeyTimes(layer);
    const nonZero = times.filter((t) => t > 0);
    if (nonZero.length >= 2) {
      const startMs = nonZero[0]!;
      const endMs = nonZero[nonZero.length - 1]!;
      const spanId = `layer-motion:${layer.id}:${startMs}:${endMs}`;
      items.push({
        id: spanId,
        kind: 'layer-motion-span',
        label: `${layer.name} · 关键帧选段`,
        startMs,
        endMs,
        supported: !layer.locked,
        spanRef: { id: spanId, layerId: layer.id, startMs, endMs },
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
  const [commitError, setCommitError] = useState<string | null>(null);

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

  // Prune stale action selections on shot/project updates.
  useEffect(() => {
    setSelectedActionIds((current) =>
      current.every((id) => actionById.has(id))
        ? current
        : current.filter((id) => actionById.has(id)),
    );
  }, [actionById]);

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
        (id) => actionById.get(id)?.kind === 'timeline-event',
      ),
    [selectedActionIds, actionById],
  );
  const selectedMotionSpans = useMemo(
    () =>
      selectedActionIds
        .map((id) => actionById.get(id)?.spanRef)
        .filter((span): span is BatchLayerMotionSpanRef => Boolean(span)),
    [selectedActionIds, actionById],
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

  const parsedDeltaMs = parseSecondsToMs(deltaInput);
  const parsedDurationMs = parseSecondsToMs(durationInput);

  const preview: PreviewResult | null = useMemo(() => {
    const hasDialogues = activeDialogueIds.length > 0;
    const hasActions =
      selectedEventIds.length > 0 || selectedMotionSpans.length > 0;

    if (mode === 'shift') {
      if (!hasDialogues && !hasActions) return null;
      if (parsedDeltaMs === null) {
        return { ok: false, message: '请输入有效的偏移秒数，例如 0.50 或 -0.50。' };
      }
      try {
        if (hasDialogues && hasActions) {
          const crossTypePlan = timelineBatchStore.planCrossTypeShift({
            dialogueIds: activeDialogueIds,
            eventIds: selectedEventIds,
            layerMotionSpans: selectedMotionSpans,
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
          eventIds: selectedEventIds,
          layerMotionSpans: selectedMotionSpans,
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
    mode,
    parsedDeltaMs,
    parsedDurationMs,
    sharedClipPolicy,
  ]);

  const canApply = Boolean(preview && preview.ok && preview.changedCount > 0);

  const handleApply = (): void => {
    if (!preview || !preview.ok || preview.changedCount === 0) return;
    setCommitError(null);
    const snapshotBefore = editorProjectStore.getSnapshot();
    if (!snapshotBefore || snapshotBefore.project.id !== project.id) return;
    try {
      if (preview.mode === 'shift') {
        if (preview.crossTypePlan) {
          timelineBatchStore.applyCrossTypeShift({
            dialogueIds: activeDialogueIds,
            eventIds: selectedEventIds,
            layerMotionSpans: selectedMotionSpans,
            deltaMs: parsedDeltaMs!,
            sharedClipPolicy,
          });
        } else if (preview.dialoguePlan) {
          dialogueStore.moveMany(activeDialogueIds, parsedDeltaMs!, {
            sharedClipPolicy,
          });
        } else if (preview.actionPlan) {
          timelineBatchStore.apply({
            eventIds: selectedEventIds,
            layerMotionSpans: selectedMotionSpans,
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
      ) : (
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
      )}

      {mode === 'shift' && hasSharedClipWithUnselected ? (
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
                  .filter((item) => item.supported)
                  .map((item) => item.id),
              )
            }
          >
            全选动作（{actionCandidates.filter((item) => item.supported).length}）
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
            <div className="batch-time-group-title">动作区间</div>
            <ul className="batch-time-list" data-testid="batch-time-action-list">
              {actionCandidates.map((item) => {
                const checked = selectedActionIds.includes(item.id);
                return (
                  <li key={item.id}>
                    <label
                      className={`batch-time-item${
                        item.supported ? '' : ' is-unsupported'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAction(item.id)}
                      />
                      <span className="batch-time-item-label">
                        <span>{item.label}</span>
                        {!item.supported ? (
                          <span className="batch-time-badge">暂不支持</span>
                        ) : null}
                      </span>
                      <span className="batch-time-item-meta">
                        {formatSeconds(item.startMs)}–
                        {formatSeconds(item.endMs)}
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
              {preview.changedCount === 0
                ? '目标时间与当前一致，无变更。'
                : `预计调整 ${preview.changedCount} 项：${formatSeconds(
                    preview.earliestStartMs,
                  )} – ${formatSeconds(preview.latestEndMs)}`}
            </div>
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
            {preview.skipped.length > 0 ? (
              <ul
                className="batch-time-skipped"
                data-testid="batch-time-skipped"
              >
                {preview.skipped.map((item) => (
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
