import { ProjectSchema, type Project, type Shot, type TimelineEvent } from '../models';

/**
 * Event kinds the formal evaluator gives a real duration span. Expression,
 * flip and visibility are deliberately excluded: they are instantaneous
 * switches, so "duration" has no meaning for them.
 */
export const BATCH_EDITABLE_EVENT_TYPES = [
  'move',
  'scale',
  'opacity',
  'shake',
] as const;

export type BatchEditableEventType = (typeof BATCH_EDITABLE_EVENT_TYPES)[number];

/** A TimelineEvent narrowed to the four kinds the evaluator gives a span. */
export type BatchEditableEvent = Extract<
  TimelineEvent,
  { type: BatchEditableEventType }
>;

/**
 * Evaluator state channel. Events in the same channel overwrite each other by
 * start order, so overlapping or re-ordered pairs change the rendered result.
 * `shake` has no channel: the formal motion seam sums every active shake, so
 * two shakes may overlap and even stack with a move.
 */
type TimelineEventChannel = 'move' | 'scale' | 'opacity';

const EVENT_CHANNEL: Record<BatchEditableEventType, TimelineEventChannel | null> = {
  move: 'move',
  scale: 'scale',
  opacity: 'opacity',
  shake: null,
};

const EVENT_TYPE_LABEL: Record<BatchEditableEventType, string> = {
  move: '移动',
  scale: '缩放',
  opacity: '透明度',
  shake: '抖动',
};

/** Every kind, so an excluded one can still be named in a refusal message. */
const ANY_EVENT_TYPE_LABEL: Record<TimelineEvent['type'], string> = {
  ...EVENT_TYPE_LABEL,
  expression: '表情',
  flip: '翻转',
  visibility: '显示',
};

/** Creator-facing seconds copy for a millisecond shift: 500 → "0.5". */
function formatSeconds(ms: number): string {
  const seconds = Math.abs(ms) / 1_000;
  return Number.isInteger(seconds)
    ? String(seconds)
    : seconds.toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '');
}

export type TimelineEventBatchErrorCode =
  | 'SHOT_NOT_FOUND'
  | 'TIMELINE_EVENT_NOT_FOUND'
  | 'TIMELINE_EVENT_BATCH_TOO_SMALL'
  | 'TIMELINE_EVENT_UNSUPPORTED'
  | 'TIMELINE_EVENT_NOT_TIMED'
  | 'TIMELINE_EVENT_LAYER_MISSING'
  | 'TIMELINE_EVENT_LAYER_LOCKED'
  | 'INVALID_TIMELINE_EDIT_AMOUNT'
  | 'TIMELINE_EVENT_BATCH_OUT_OF_RANGE'
  | 'TIMELINE_EVENT_OVERLAP'
  | 'TIMELINE_EVENT_ORDER_REVERSED';

export class TimelineEventBatchError extends Error {
  constructor(
    readonly code: TimelineEventBatchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TimelineEventBatchError';
  }
}

/** Exactly one action per apply; the two never chain inside one plan. */
export type BatchTimelineEdit =
  | { readonly action: 'shift'; readonly deltaMs: number }
  | { readonly action: 'unify-duration'; readonly durationMs: number };

export interface BatchEditTimelineEventsInput {
  readonly shotId: string;
  /** Selected event ids; duplicates are collapsed. */
  readonly eventIds: readonly string[];
  readonly edit: BatchTimelineEdit;
}

/** One candidate row of a batch edit, expressed in absolute milliseconds. */
export interface BatchTimelineEventEntry {
  readonly eventId: string;
  readonly layerId: string;
  readonly layerName: string;
  readonly eventType: BatchEditableEventType;
  readonly startMs: number;
  readonly endMs: number;
  readonly nextStartMs: number;
  readonly nextEndMs: number;
}

/**
 * A fully validated batch edit. Rendering it is read-only; only `apply`
 * commits it to the Project.
 */
export interface BatchTimelineEditPlan {
  readonly shotId: string;
  readonly edit: BatchTimelineEdit;
  readonly entries: readonly BatchTimelineEventEntry[];
  readonly earliestStartMs: number;
  readonly latestEndMs: number;
  /** Rows whose timing actually changes; 0 means the batch is a no-op. */
  readonly changedCount: number;
}

interface SelectedEvent {
  readonly event: BatchEditableEvent;
  readonly layerName: string;
}

interface EventTiming {
  readonly startMs: number;
  readonly endMs: number;
}

/** The formal evaluator's own start order: earliest start first, then id. */
function compareEventOrder(left: EventTiming & { id: string }, right: EventTiming & { id: string }): number {
  return left.startMs - right.startMs || left.id.localeCompare(right.id);
}

function overlaps(left: EventTiming, right: EventTiming): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function isBatchEditableEvent(event: TimelineEvent): event is BatchEditableEvent {
  return (BATCH_EDITABLE_EVENT_TYPES as readonly string[]).includes(event.type);
}

/**
 * Only the four supported kinds ever get retimed. A payload that already uses
 * an excluded kind is returned untouched, keeping this entry point unable to
 * rewrite expression/flip/visibility timing.
 */
function retimeEvent(
  event: TimelineEvent,
  startMs: number,
  endMs: number,
): TimelineEvent {
  switch (event.type) {
    case 'move':
    case 'scale':
    case 'opacity':
    case 'shake':
      return { ...event, startMs, endMs };
    default:
      return event;
  }
}

/**
 * Batch editor for the duration-bearing TimelineEvents of one Shot.
 *
 * AUTO-02 established the shape this reuses: a read-only `plan` built from a
 * single snapshot plus an atomic `apply` that replaces the Shot once, so the
 * caller records exactly one History command. Nothing here touches the
 * evaluator, the event payloads, Dialogue, audio clips, or the Shot length.
 */
export class TimelineEventBatchService {
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Validates a whole batch without writing anything. Every candidate is
   * derived from the same snapshot, so one illegal row rejects the batch
   * instead of leaving half the group retimed.
   */
  plan(project: Project, input: BatchEditTimelineEventsInput): BatchTimelineEditPlan {
    const shot = this.shot(project, input.shotId);
    const edit = this.validEdit(input.edit);
    const eventIds = [...new Set(input.eventIds)];
    if (eventIds.length < 2) {
      throw new TimelineEventBatchError(
        'TIMELINE_EVENT_BATCH_TOO_SMALL',
        '至少勾选两条动作事件才能批量调整。',
      );
    }

    const eventsById = new Map(
      shot.timelineEvents.map((event) => [event.id, event]),
    );
    const layersById = new Map(shot.layers.map((layer) => [layer.id, layer]));
    const selected: SelectedEvent[] = eventIds.map((eventId) => {
      const event = eventsById.get(eventId);
      if (!event) {
        throw new TimelineEventBatchError(
          'TIMELINE_EVENT_NOT_FOUND',
          '所选动作中有事件已不存在，请重新勾选。',
        );
      }
      if (!isBatchEditableEvent(event)) {
        throw new TimelineEventBatchError(
          'TIMELINE_EVENT_UNSUPPORTED',
          `「${
            layersById.get(event.layerId)?.name ?? '该对象'
          }」的${ANY_EVENT_TYPE_LABEL[event.type]}事件不支持批量调整。`,
        );
      }
      const layer = layersById.get(event.layerId);
      if (!layer) {
        throw new TimelineEventBatchError(
          'TIMELINE_EVENT_LAYER_MISSING',
          '所选动作所属的对象已不在当前镜头里。',
        );
      }
      if (event.endMs <= event.startMs) {
        throw new TimelineEventBatchError(
          'TIMELINE_EVENT_NOT_TIMED',
          `「${layer.name}」的${EVENT_TYPE_LABEL[event.type]}还没有持续时间，不能批量调整。`,
        );
      }
      if (layer.locked) {
        throw new TimelineEventBatchError(
          'TIMELINE_EVENT_LAYER_LOCKED',
          `「${layer.name}」已锁定，先解锁再批量调整。`,
        );
      }
      return { event, layerName: layer.name };
    });

    const entries = selected.map(({ event, layerName }): BatchTimelineEventEntry => {
      const nextTiming = this.candidateTiming(shot, event, edit, layerName);
      return {
        eventId: event.id,
        layerId: event.layerId,
        layerName,
        eventType: event.type,
        startMs: event.startMs,
        endMs: event.endMs,
        nextStartMs: nextTiming.startMs,
        nextEndMs: nextTiming.endMs,
      };
    });

    this.assertNoNewChannelConflict(shot, entries);

    return {
      shotId: shot.id,
      edit,
      entries,
      earliestStartMs: Math.min(...entries.map((entry) => entry.nextStartMs)),
      latestEndMs: Math.max(...entries.map((entry) => entry.nextEndMs)),
      changedCount: entries.filter(
        (entry) =>
          entry.nextStartMs !== entry.startMs || entry.nextEndMs !== entry.endMs,
      ).length,
    };
  }

  /**
   * Commits an already validated batch as one Shot replacement. A no-op (zero
   * shift, or every selected event already has the requested duration) returns
   * the same Project reference so revision and History stay untouched.
   */
  apply(project: Project, input: BatchEditTimelineEventsInput): Project {
    const plan = this.plan(project, input);
    if (plan.changedCount === 0) return project;

    const shot = this.shot(project, input.shotId);
    const entryById = new Map(plan.entries.map((entry) => [entry.eventId, entry]));
    const nextShot: Shot = {
      ...shot,
      timelineEvents: shot.timelineEvents.map((event) => {
        const entry = entryById.get(event.id);
        return entry
          ? retimeEvent(event, entry.nextStartMs, entry.nextEndMs)
          : event;
      }),
    };
    return ProjectSchema.parse({
      ...project,
      shots: project.shots.map((candidate) =>
        candidate.id === nextShot.id ? nextShot : candidate,
      ),
      updatedAt: this.now().toISOString(),
      createdAt: project.createdAt,
    });
  }

  private validEdit(edit: BatchTimelineEdit): BatchTimelineEdit {
    const raw = edit.action === 'shift' ? edit.deltaMs : edit.durationMs;
    if (!Number.isSafeInteger(raw)) {
      throw new TimelineEventBatchError(
        'INVALID_TIMELINE_EDIT_AMOUNT',
        '请输入有效的秒数，例如 0.50 或 -0.50。',
      );
    }
    if (edit.action === 'unify-duration' && edit.durationMs < 1) {
      throw new TimelineEventBatchError(
        'INVALID_TIMELINE_EDIT_AMOUNT',
        '统一时长必须大于 0 秒。',
      );
    }
    return edit;
  }

  /**
   * One row's new timing. Shift keeps every duration and the spacing inside
   * the group; unify pins each start and only moves the end.
   */
  private candidateTiming(
    shot: Shot,
    event: BatchEditableEvent,
    edit: BatchTimelineEdit,
    layerName: string,
  ): EventTiming {
    const startMs =
      edit.action === 'shift' ? event.startMs + edit.deltaMs : event.startMs;
    const endMs =
      edit.action === 'shift'
        ? event.endMs + edit.deltaMs
        : event.startMs + edit.durationMs;

    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs)) {
      throw new TimelineEventBatchError(
        'TIMELINE_EVENT_BATCH_OUT_OF_RANGE',
        '调整后的时间超出可表示的毫秒范围。',
      );
    }
    if (startMs < 0) {
      throw new TimelineEventBatchError(
        'TIMELINE_EVENT_BATCH_OUT_OF_RANGE',
        edit.action === 'shift'
          ? `「${layerName}」的${
              EVENT_TYPE_LABEL[event.type]
            }再往前移动 ${formatSeconds(edit.deltaMs)} 秒会超出镜头开头。`
          : `「${layerName}」的${EVENT_TYPE_LABEL[event.type]}起点已在镜头开头之前。`,
      );
    }
    // The batch never extends the Shot: an author who needs a longer Shot
    // changes the Shot first, so this refusal is the honest one.
    if (endMs > shot.durationMs) {
      throw new TimelineEventBatchError(
        'TIMELINE_EVENT_BATCH_OUT_OF_RANGE',
        edit.action === 'shift'
          ? `「${layerName}」的${
              EVENT_TYPE_LABEL[event.type]
            }再往后移动 ${formatSeconds(edit.deltaMs)} 秒会超出镜头结尾。`
          : `「${layerName}」的${
              EVENT_TYPE_LABEL[event.type]
            }统一为 ${formatSeconds(edit.durationMs)} 秒会超出镜头结尾。`,
      );
    }
    if (endMs <= startMs) {
      throw new TimelineEventBatchError(
        'INVALID_TIMELINE_EDIT_AMOUNT',
        `「${layerName}」的${EVENT_TYPE_LABEL[event.type]}调整后没有持续时间。`,
      );
    }
    return { startMs, endMs };
  }

  /**
   * Bounded conflict check: only same-channel pairs on the same Layer can
   * override each other in the formal evaluator. A pair that already broke the
   * rule before this edit is not a new fault and is left alone, and a batch is
   * compared as a whole so an in-flight state is never mistaken for a conflict.
   */
  private assertNoNewChannelConflict(
    shot: Shot,
    entries: readonly BatchTimelineEventEntry[],
  ): void {
    const candidateById = new Map(
      entries.map((entry) => [entry.eventId, entry]),
    );

    for (const entry of entries) {
      const channel = EVENT_CHANNEL[entry.eventType];
      if (!channel) continue;
      for (const other of shot.timelineEvents) {
        if (other.id === entry.eventId) continue;
        if (other.layerId !== entry.layerId) continue;
        if (!isBatchEditableEvent(other)) continue;
        if (EVENT_CHANNEL[other.type] !== channel) continue;

        const otherCandidate = candidateById.get(other.id);
        const otherTiming: EventTiming = otherCandidate
          ? {
              startMs: otherCandidate.nextStartMs,
              endMs: otherCandidate.nextEndMs,
            }
          : { startMs: other.startMs, endMs: other.endMs };
        const nextTiming: EventTiming = {
          startMs: entry.nextStartMs,
          endMs: entry.nextEndMs,
        };
        const currentTiming: EventTiming = {
          startMs: entry.startMs,
          endMs: entry.endMs,
        };
        const channelLabel = EVENT_TYPE_LABEL[entry.eventType];

        if (!overlaps(currentTiming, { startMs: other.startMs, endMs: other.endMs }) && overlaps(nextTiming, otherTiming)) {
          throw new TimelineEventBatchError(
            'TIMELINE_EVENT_OVERLAP',
            `「${entry.layerName}」的两段${channelLabel}会重叠，同一对象的${channelLabel}必须首尾错开。`,
          );
        }

        const currentOrder = compareEventOrder(
          { id: entry.eventId, ...currentTiming },
          { id: other.id, startMs: other.startMs, endMs: other.endMs },
        );
        const nextOrder = compareEventOrder(
          { id: entry.eventId, ...nextTiming },
          { id: other.id, ...otherTiming },
        );
        if (currentOrder !== 0 && nextOrder !== 0 && Math.sign(currentOrder) !== Math.sign(nextOrder)) {
          throw new TimelineEventBatchError(
            'TIMELINE_EVENT_ORDER_REVERSED',
            `「${entry.layerName}」的两段${channelLabel}顺序会被颠倒，播放结果会跟着改变。`,
          );
        }
      }
    }
  }

  private shot(project: Project, shotId: string): Shot {
    const shot = project.shots.find((candidate) => candidate.id === shotId);
    if (!shot) {
      throw new TimelineEventBatchError('SHOT_NOT_FOUND', '找不到当前镜头。');
    }
    return shot;
  }
}
