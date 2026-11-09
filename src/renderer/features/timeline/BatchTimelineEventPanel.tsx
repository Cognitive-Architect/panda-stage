import { MoveHorizontal, Timer } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type {
  BatchEditableEventType,
  BatchTimelineEdit,
  BatchTimelineEditPlan,
  Shot,
} from '../../../domain';
import { BATCH_EDITABLE_EVENT_TYPES } from '../../../domain';
import { Button, DecorativeIcon } from '../../ui';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { timelineBatchStore } from '../../stores/timelineBatchStore';

type BatchScope = BatchTimelineEdit['action'];

interface BatchEventCandidate {
  readonly eventId: string;
  readonly layerLabel: string;
  readonly eventType: BatchEditableEventType;
  readonly startMs: number;
  readonly endMs: number;
}

const EVENT_TYPE_LABEL: Record<BatchEditableEventType, string> = {
  move: '移动',
  scale: '缩放',
  opacity: '透明度',
  shake: '抖动',
};

/** Single source of truth: the domain decides which kinds are batch-editable. */
const SUPPORTED_TYPES = new Set<string>(BATCH_EDITABLE_EVENT_TYPES);

const MAX_LAYER_LABEL = 10;

type BatchPreview =
  | { readonly ok: true; readonly plan: BatchTimelineEditPlan }
  | { readonly ok: false; readonly message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '批量调整失败，请重试。';
}

function formatSeconds(ms: number): string {
  return `${(ms / 1_000).toFixed(2)}s`;
}

function parseSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds)) return null;
  const ms = Math.round(seconds * 1_000);
  return Number.isSafeInteger(ms) ? ms : null;
}

function clampLayerLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_LAYER_LABEL
    ? `${trimmed.slice(0, MAX_LAYER_LABEL)}…`
    : trimmed;
}

/**
 * Display-only layer labels. Two Layers may share a name, but the checkbox
 * still identifies each row by its event id, so a duplicate only needs an
 * ordinal to stay readable.
 */
function layerLabels(shot: Shot): Map<string, string> {
  const totals = new Map<string, number>();
  for (const layer of shot.layers) {
    totals.set(layer.name, (totals.get(layer.name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const layer of shot.layers) {
    const total = totals.get(layer.name) ?? 0;
    if (total < 2) {
      labels.set(layer.id, clampLayerLabel(layer.name));
      continue;
    }
    const ordinal = (seen.get(layer.name) ?? 0) + 1;
    seen.set(layer.name, ordinal);
    labels.set(layer.id, clampLayerLabel(`${layer.name}（${ordinal}）`));
  }
  return labels;
}

/** Duration-bearing TimelineEvents of the current Shot, in time order. */
function listCandidates(shot: Shot | null): BatchEventCandidate[] {
  if (!shot) return [];
  const labels = layerLabels(shot);
  return [...shot.timelineEvents]
    .filter(
      (event) => event.endMs > event.startMs && SUPPORTED_TYPES.has(event.type),
    )
    .sort(
      (left, right) =>
        left.startMs - right.startMs || left.endMs - right.endMs,
    )
    .map((event) => ({
      eventId: event.id,
      layerLabel: labels.get(event.layerId) ?? '对象',
      eventType: event.type as BatchEditableEventType,
      startMs: event.startMs,
      endMs: event.endMs,
    }));
}

/** Read-only domain validation; the panel never writes to the Project here. */
function planPreview(
  eventIds: readonly string[],
  edit: BatchTimelineEdit | null,
): BatchPreview | null {
  if (eventIds.length < 2 || edit === null) return null;
  try {
    return { ok: true, plan: timelineBatchStore.plan(eventIds, edit) };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * Batch Adjust → 动作 (EF-03 V0): shift several duration-bearing TimelineEvents,
 * or give them one shared duration. The panel is a thin view over the domain
 * plan; it keeps only local checkbox, action and amount state and commits
 * through one Store call. Event payloads, unselected events, Dialogue, audio
 * clips and the Shot length are never edited here.
 */
export function BatchTimelineEventPanel(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [scope, setScope] = useState<BatchScope>('shift');
  const [shiftInput, setShiftInput] = useState('0.50');
  const [durationInput, setDurationInput] = useState('0.80');
  const [status, setStatus] = useState('');

  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  ) ?? null;
  const candidates = useMemo(
    () => (snapshot ? listCandidates(shot) : []),
    [shot, snapshot],
  );
  const candidateIds = useMemo(
    () => new Set(candidates.map((candidate) => candidate.eventId)),
    [candidates],
  );
  // A deleted, undone or retyped event must never stay selected.
  useEffect(() => {
    setSelectedIds((current) =>
      current.every((id) => candidateIds.has(id))
        ? current
        : current.filter((id) => candidateIds.has(id)),
    );
  }, [candidateIds]);

  const selection = selectedIds.filter((id) => candidateIds.has(id));
  const amountMs =
    scope === 'shift' ? parseSeconds(shiftInput) : parseSeconds(durationInput);
  const edit: BatchTimelineEdit | null =
    amountMs === null
      ? null
      : scope === 'shift'
        ? { action: 'shift', deltaMs: amountMs }
        : { action: 'unify-duration', durationMs: amountMs };
  const preview = planPreview(selection, edit);
  const unchanged = preview?.ok === true && preview.plan.changedCount === 0;
  const canApply = preview?.ok === true && !unchanged;
  const blockedMessage =
    candidates.length < 2
      ? '当前镜头至少要有两条有时长的动作事件才能批量调整。'
      : selection.length < 2
        ? '至少勾选两条动作事件。'
        : edit === null
          ? scope === 'shift'
            ? '请输入有效的秒数，例如 0.50 或 -0.50。'
            : '请输入有效时长秒数，例如 0.80。'
          : preview && !preview.ok
            ? preview.message
            : unchanged
              ? '这些动作已经是这个时间，无需调整。'
              : '';

  const resetStatus = (): void => setStatus('');

  const toggle = (eventId: string): void => {
    resetStatus();
    setSelectedIds((current) =>
      current.includes(eventId)
        ? current.filter((id) => id !== eventId)
        : [...current, eventId],
    );
  };

  const apply = (): void => {
    if (!canApply || edit === null) return;
    try {
      timelineBatchStore.apply(selection, edit);
      setStatus(`已调整 ${selection.length} 条动作事件。`);
    } catch (error) {
      setStatus(messageOf(error));
    }
  };

  return (
    <section
      aria-label="批量调整动作"
      className="batch-adjust"
      data-testid="batch-timeline-panel"
    >
      <p className="batch-adjust-shot" data-testid="batch-timeline-shot">
        {shot ? shot.name : '未选择镜头'}
      </p>
      {candidates.length === 0 ? (
        <p className="batch-adjust-empty">
          当前镜头还没有可调整的动作事件，先去时间轴加一段移动、缩放、透明度或抖动。
        </p>
      ) : (
        <>
          <ul className="batch-adjust-list">
            {candidates.map((candidate) => {
              const checked = selectedIds.includes(candidate.eventId);
              const entry = preview?.ok
                ? preview.plan.entries.find(
                    (row) => row.eventId === candidate.eventId,
                  )
                : undefined;
              return (
                <li key={candidate.eventId}>
                  <label
                    className="batch-adjust-row"
                    data-event-type={candidate.eventType}
                  >
                    <input
                      checked={checked}
                      className="batch-adjust-check"
                      onChange={() => toggle(candidate.eventId)}
                      type="checkbox"
                    />
                    <span className="batch-adjust-name">
                      {candidate.layerLabel}
                      <span className="batch-timeline-kind">
                        {EVENT_TYPE_LABEL[candidate.eventType]}
                      </span>
                    </span>
                    <span className="batch-adjust-time">
                      {formatSeconds(candidate.startMs)} →{' '}
                      {formatSeconds(candidate.endMs)}
                    </span>
                    {entry ? (
                      <span className="batch-adjust-next">
                        改为 {formatSeconds(entry.nextStartMs)} →{' '}
                        {formatSeconds(entry.nextEndMs)}
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
          <button
            className="batch-adjust-select-all"
            data-testid="batch-timeline-select-all"
            onClick={() => {
              resetStatus();
              setSelectedIds(
                selection.length === candidates.length
                  ? []
                  : candidates.map((candidate) => candidate.eventId),
              );
            }}
            type="button"
          >
            {selection.length === candidates.length
              ? '取消全选'
              : '全选本镜头动作'}
          </button>

          <div
            aria-label="调整方式"
            className="batch-timeline-scope"
            role="group"
          >
            <button
              aria-pressed={scope === 'shift'}
              className="batch-timeline-scope-option"
              data-testid="batch-timeline-scope-shift"
              onClick={() => {
                resetStatus();
                setScope('shift');
              }}
              type="button"
            >
              整体平移
            </button>
            <button
              aria-pressed={scope === 'unify-duration'}
              className="batch-timeline-scope-option"
              data-testid="batch-timeline-scope-unify"
              onClick={() => {
                resetStatus();
                setScope('unify-duration');
              }}
              type="button"
            >
              统一时长
            </button>
          </div>

          <label className="batch-adjust-delta" htmlFor="batch-timeline-amount">
            <span>{scope === 'shift' ? '移动' : '时长'}</span>
            <input
              className="batch-adjust-delta-input"
              data-testid="batch-timeline-amount"
              id="batch-timeline-amount"
              inputMode="decimal"
              onChange={(event) => {
                resetStatus();
                if (scope === 'shift') setShiftInput(event.target.value);
                else setDurationInput(event.target.value);
              }}
              type="text"
              value={scope === 'shift' ? shiftInput : durationInput}
            />
            <span>秒</span>
          </label>

          <p className="batch-adjust-summary" data-testid="batch-timeline-impact">
            影响：{selection.length} 条动作
            {preview?.ok && unchanged ? ' · 无需调整' : ''}
          </p>
          <p className="batch-adjust-summary" data-testid="batch-timeline-range">
            结果：
            {preview?.ok
              ? `最早 ${formatSeconds(preview.plan.earliestStartMs)} · 最晚 ${formatSeconds(preview.plan.latestEndMs)}`
              : '等待合法的调整参数'}
          </p>

          {blockedMessage ? (
            <p
              className="batch-adjust-blocked"
              data-testid="batch-timeline-blocked"
              role="alert"
            >
              {blockedMessage}
            </p>
          ) : null}

          <Button
            className="batch-adjust-apply"
            data-testid="batch-timeline-apply"
            disabled={!canApply}
            onClick={apply}
            variant="primary"
          >
            <DecorativeIcon
              icon={scope === 'shift' ? MoveHorizontal : Timer}
              size={16}
            />
            <span>应用调整</span>
          </Button>
          {status ? (
            <p className="batch-adjust-status" role="status">
              {status}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
