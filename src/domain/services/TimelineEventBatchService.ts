import {
  ProjectSchema,
  type CharacterActionEvent,
  type GraphicPlaybackEvent,
  type Layer,
  type MoveEvent,
  type OpacityEvent,
  type Project,
  type ScaleEvent,
  type ShakeEvent,
  type Shot,
  type TimelineEvent,
} from '../models';
import { TIMELINE_FPS, frameTimeMs } from '../timeline/frame-grid';
import {
  DialogueService,
  type BatchBoundaryMode,
  type DialogueBatchMovePlan,
  type SharedAudioClipPolicy,
} from './DialogueService';
import { LayerMotionService, layerCompositeKeyTimes } from './LayerMotionService';

/**
 * Official independently editable TimelineEvent interval types supported by
 * WF-07 batch shift & unified duration:
 *
 * - `move`: Same-layer `'move'` channel (non-overlapping, order-preserving).
 *   Shift preserves `from`, `to`, `easing`. Unify-duration pins `startMs` and
 *   sets `endMs = startMs + durationMs` (interpolates `from -> to` over the
 *   new duration).
 * - `scale`: Same-layer `'scale'` channel (non-overlapping, order-preserving).
 *   Shift preserves `from`, `to`, `easing`. Unify-duration pins `startMs` and
 *   sets `endMs = startMs + durationMs`.
 * - `opacity`: Same-layer `'opacity'` channel (non-overlapping, order-preserving).
 *   Shift preserves `from`, `to`, `easing`, `curveToNext`. Unify-duration pins
 *   `startMs` and sets `endMs = startMs + durationMs`.
 * - `shake`: Additive channel (`null`, may overlap). Shift preserves
 *   `amplitudeX`, `amplitudeY`, `frequencyHz`. Unify-duration pins `startMs`
 *   and sets `endMs = startMs + durationMs` (frequency remains in Hz).
 * - `character-action`: Same-layer `'character-action'` channel
 *   (non-overlapping, order-preserving). Shift moves `[startMs, endMs]` while
 *   preserving `actionId` and any `layer.animationTimeLink` referencing the
 *   event. Unify-duration pins `startMs` and sets `endMs = startMs + durationMs`
 *   (controls the bounded playback window without altering internal action speed).
 * - `graphic-playback`: Same-layer `'graphic-playback'` channel
 *   (non-overlapping, order-preserving). Shift moves `[startMs, endMs]` AND
 *   `playbackStartMs` by `deltaMs` (preserving playback phase, requiring
 *   `playbackStartMs + deltaMs >= 0`). Unify-duration pins `startMs` and
 *   `playbackStartMs` and sets `endMs = startMs + durationMs`.
 *
 * Instantaneous switch events (`expression`, `flip`, `visibility`, `mouth-cue`,
 * `graphic-frame`) and dialogue-bound `mouth-pose` events are reported locally
 * in `skipped` without blocking valid selected items.
 *
 * Real keyframe-based motion spans (`layerMotionSpans`) are edited through
 * `LayerMotionService.retimeKeys` (shift) and
 * `LayerMotionService.retimeKeySpanDuration` (proportional frame-grid remap
 * preserving easing & curves) — never by faking keyframe retiming via `endMs`.
 */
export const BATCH_EDITABLE_EVENT_TYPES = [
  'move',
  'scale',
  'opacity',
  'shake',
  'character-action',
  'graphic-playback',
] as const;

export type BatchEditableEventType = (typeof BATCH_EDITABLE_EVENT_TYPES)[number];

export type BatchEditableEvent =
  | MoveEvent
  | ScaleEvent
  | OpacityEvent
  | ShakeEvent
  | CharacterActionEvent
  | GraphicPlaybackEvent;

type TimelineEventChannel =
  | 'move'
  | 'scale'
  | 'opacity'
  | 'character-action'
  | 'graphic-playback';

const EVENT_CHANNEL: Record<BatchEditableEventType, TimelineEventChannel | null> = {
  move: 'move',
  scale: 'scale',
  opacity: 'opacity',
  shake: null,
  'character-action': 'character-action',
  'graphic-playback': 'graphic-playback',
};

export const BATCH_EVENT_TYPE_LABEL: Record<BatchEditableEventType, string> = {
  move: '移动',
  scale: '缩放',
  opacity: '透明度',
  shake: '抖动',
  'character-action': '角色动作',
  'graphic-playback': '元件播放',
};

const ANY_EVENT_TYPE_LABEL: Record<TimelineEvent['type'], string> = {
  ...BATCH_EVENT_TYPE_LABEL,
  expression: '表情',
  flip: '翻转',
  visibility: '显示',
  'mouth-cue': '口型点',
  'mouth-pose': '口型段',
  'graphic-frame': '元件定格',
};

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
  | 'TIMELINE_EVENT_ORDER_REVERSED'
  | 'LAYER_MOTION_RETIME_FAILED';

export class TimelineEventBatchError extends Error {
  constructor(
    readonly code: TimelineEventBatchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TimelineEventBatchError';
  }
}

export type BatchTimelineEdit =
  | { readonly action: 'shift'; readonly deltaMs: number }
  | { readonly action: 'unify-duration'; readonly durationMs: number };

export interface BatchLayerMotionSpanRef {
  readonly id: string;
  readonly layerId: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface BatchEditTimelineEventsInput {
  readonly shotId: string;
  /** Selected TimelineEvent ids; duplicates are collapsed. */
  readonly eventIds?: readonly string[];
  /** Selected LayerMotion keyframe spans; duplicates by id are collapsed. */
  readonly layerMotionSpans?: readonly BatchLayerMotionSpanRef[];
  readonly edit: BatchTimelineEdit;
  readonly boundaryMode?: BatchBoundaryMode;
}

export interface BatchTimelineEventEntry {
  readonly kind: 'timeline-event';
  readonly eventId: string;
  readonly layerId: string;
  readonly layerName: string;
  readonly eventType: BatchEditableEventType;
  readonly startMs: number;
  readonly endMs: number;
  readonly nextStartMs: number;
  readonly nextEndMs: number;
  readonly nextPlaybackStartMs?: number;
}

export interface BatchLayerMotionSpanEntry {
  readonly kind: 'layer-motion-span';
  readonly spanId: string;
  readonly layerId: string;
  readonly layerName: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly nextStartMs: number;
  readonly nextEndMs: number;
  readonly keyTimesMs: readonly number[];
  readonly deltaFrames?: number;
}

export type BatchTimelineSkippedReasonCode =
  | 'UNSUPPORTED_EVENT_TYPE'
  | 'MOUTH_POSE_BOUND_TO_DIALOGUE'
  | 'EVENT_NOT_TIMED'
  | 'LAYER_MISSING'
  | 'LAYER_LOCKED'
  | 'PROTECTED_BASE_KEY'
  | 'INVALID_MOTION_SPAN';

export interface BatchTimelineSkippedEntry {
  readonly itemId: string;
  readonly kind: 'timeline-event' | 'layer-motion-span';
  readonly layerId?: string;
  readonly layerName?: string;
  readonly label: string;
  readonly reasonCode: BatchTimelineSkippedReasonCode;
  readonly reason: string;
}

export interface BatchTimelineEditPlan {
  readonly shotId: string;
  readonly edit: BatchTimelineEdit;
  readonly effectiveDeltaMs: number | null;
  readonly clamped: boolean;
  readonly allowedDeltaRange: {
    readonly minDeltaMs: number;
    readonly maxDeltaMs: number;
  } | null;
  readonly entries: readonly BatchTimelineEventEntry[];
  readonly motionSpanEntries: readonly BatchLayerMotionSpanEntry[];
  readonly skipped: readonly BatchTimelineSkippedEntry[];
  readonly earliestStartMs: number;
  readonly latestEndMs: number;
  readonly changedCount: number;
}

export interface CrossTypeBatchShiftInput {
  readonly shotId: string;
  readonly dialogueIds?: readonly string[];
  readonly eventIds?: readonly string[];
  readonly layerMotionSpans?: readonly BatchLayerMotionSpanRef[];
  readonly deltaMs: number;
  readonly sharedClipPolicy?: SharedAudioClipPolicy;
  readonly boundaryMode?: BatchBoundaryMode;
}

export interface CrossTypeBatchShiftPlan {
  readonly shotId: string;
  readonly requestedDeltaMs: number;
  readonly deltaMs: number;
  readonly clamped: boolean;
  readonly allowedDeltaRange: {
    readonly minDeltaMs: number;
    readonly maxDeltaMs: number;
  };
  readonly dialoguePlan: DialogueBatchMovePlan | null;
  readonly actionPlan: BatchTimelineEditPlan | null;
  readonly skipped: readonly BatchTimelineSkippedEntry[];
  readonly earliestStartMs: number;
  readonly latestEndMs: number;
  readonly changedCount: number;
}

interface SelectedEvent {
  readonly event: BatchEditableEvent;
  readonly layerName: string;
}

interface SelectedMotionSpan {
  readonly span: BatchLayerMotionSpanRef;
  readonly layer: Layer;
  readonly keyTimesMs: readonly number[];
}

interface EventTiming {
  readonly startMs: number;
  readonly endMs: number;
}

function compareEventOrder(
  left: EventTiming & { id: string },
  right: EventTiming & { id: string },
): number {
  return left.startMs - right.startMs || left.id.localeCompare(right.id);
}

function overlaps(left: EventTiming, right: EventTiming): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

export function isBatchEditableEvent(
  event: TimelineEvent,
): event is BatchEditableEvent {
  return (BATCH_EDITABLE_EVENT_TYPES as readonly string[]).includes(event.type);
}

function retimeEvent(
  event: TimelineEvent,
  entry: BatchTimelineEventEntry,
): TimelineEvent {
  switch (event.type) {
    case 'move':
    case 'scale':
    case 'opacity':
    case 'shake':
    case 'character-action':
      return {
        ...event,
        startMs: entry.nextStartMs,
        endMs: entry.nextEndMs,
      };
    case 'graphic-playback':
      return {
        ...event,
        startMs: entry.nextStartMs,
        endMs: entry.nextEndMs,
        playbackStartMs: entry.nextPlaybackStartMs ?? event.playbackStartMs,
      };
    default:
      return event;
  }
}

function deltaMsToFrames(deltaMs: number): number {
  return Math.round((deltaMs * TIMELINE_FPS) / 1_000);
}

/**
 * Batch editor for official independently editable TimelineEvents and
 * LayerMotion keyframe spans of one Shot, plus gap-preserving cross-type shift
 * with timed Dialogues.
 */
export class TimelineEventBatchService {
  private readonly now: () => Date;
  private readonly layerMotionService: LayerMotionService;
  private readonly dialogueService: DialogueService;

  constructor(
    options: {
      now?: () => Date;
      layerMotionService?: LayerMotionService;
      dialogueService?: DialogueService;
    } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.layerMotionService =
      options.layerMotionService ?? new LayerMotionService();
    this.dialogueService = options.dialogueService ?? new DialogueService({ now: this.now });
  }

  /**
   * Validates a batch edit without mutating Project. Unsupported items are
   * reported locally in `plan.skipped` without blocking valid selected items.
   */
  plan(
    project: Project,
    input: BatchEditTimelineEventsInput,
  ): BatchTimelineEditPlan {
    const shot = this.shot(project, input.shotId);
    const edit = this.validEdit(input.edit);
    const boundaryMode: BatchBoundaryMode = input.boundaryMode ?? 'reject';
    const eventIds = [...new Set(input.eventIds ?? [])];
    const uniqueSpans = new Map<string, BatchLayerMotionSpanRef>();
    for (const span of input.layerMotionSpans ?? []) {
      if (!uniqueSpans.has(span.id)) uniqueSpans.set(span.id, span);
    }
    const spans = [...uniqueSpans.values()];

    if (eventIds.length === 0 && spans.length === 0) {
      throw new TimelineEventBatchError(
        'TIMELINE_EVENT_BATCH_TOO_SMALL',
        '请至少选择一条动作区间再进行批量调整。',
      );
    }

    const eventsById = new Map(
      shot.timelineEvents.map((event) => [event.id, event]),
    );
    const layersById = new Map(shot.layers.map((layer) => [layer.id, layer]));
    const selectedEvents: SelectedEvent[] = [];
    const selectedSpans: SelectedMotionSpan[] = [];
    const skipped: BatchTimelineSkippedEntry[] = [];

    for (const eventId of eventIds) {
      const event = eventsById.get(eventId);
      if (!event) {
        throw new TimelineEventBatchError(
          'TIMELINE_EVENT_NOT_FOUND',
          '所选动作中有事件已不存在，请重新选择。',
        );
      }
      const layer = layersById.get(event.layerId);
      const layerName = layer?.name ?? '该对象';
      const typeLabel = ANY_EVENT_TYPE_LABEL[event.type];

      if (!isBatchEditableEvent(event)) {
        skipped.push({
          itemId: event.id,
          kind: 'timeline-event',
          layerId: event.layerId,
          layerName,
          label: `${layerName} · ${typeLabel}`,
          reasonCode:
            event.type === 'mouth-pose'
              ? 'MOUTH_POSE_BOUND_TO_DIALOGUE'
              : 'UNSUPPORTED_EVENT_TYPE',
          reason:
            event.type === 'mouth-pose'
              ? `「${layerName}」的口型段随对白联动，请批量移动对应对白。`
              : `「${layerName}」的${typeLabel}不支持区间批量调整，已跳过。`,
        });
        continue;
      }
      if (!layer) {
        skipped.push({
          itemId: event.id,
          kind: 'timeline-event',
          layerId: event.layerId,
          label: typeLabel,
          reasonCode: 'LAYER_MISSING',
          reason: '所选动作所属的对象已不在当前镜头里，已跳过。',
        });
        continue;
      }
      if (layer.locked) {
        skipped.push({
          itemId: event.id,
          kind: 'timeline-event',
          layerId: layer.id,
          layerName: layer.name,
          label: `${layer.name} · ${typeLabel}`,
          reasonCode: 'LAYER_LOCKED',
          reason: `「${layer.name}」已锁定，先解锁再批量调整，已跳过。`,
        });
        continue;
      }
      if (event.endMs <= event.startMs) {
        skipped.push({
          itemId: event.id,
          kind: 'timeline-event',
          layerId: layer.id,
          layerName: layer.name,
          label: `${layer.name} · ${typeLabel}`,
          reasonCode: 'EVENT_NOT_TIMED',
          reason: `「${layer.name}」的${typeLabel}没有有效持续时间，已跳过。`,
        });
        continue;
      }
      selectedEvents.push({ event, layerName: layer.name });
    }

    for (const span of spans) {
      const layer = layersById.get(span.layerId);
      if (!layer) {
        skipped.push({
          itemId: span.id,
          kind: 'layer-motion-span',
          layerId: span.layerId,
          label: '对象关键帧选段',
          reasonCode: 'LAYER_MISSING',
          reason: '关键帧选段所属对象已不在当前镜头里，已跳过。',
        });
        continue;
      }
      if (layer.locked) {
        skipped.push({
          itemId: span.id,
          kind: 'layer-motion-span',
          layerId: layer.id,
          layerName: layer.name,
          label: `${layer.name} · 关键帧选段`,
          reasonCode: 'LAYER_LOCKED',
          reason: `「${layer.name}」已锁定，先解锁再批量调整，已跳过。`,
        });
        continue;
      }
      const allKeyTimes = layerCompositeKeyTimes(layer);
      const keyTimesMs = allKeyTimes.filter(
        (timeMs) => timeMs >= span.startMs && timeMs <= span.endMs,
      );
      if (span.endMs <= span.startMs || keyTimesMs.length < 2) {
        skipped.push({
          itemId: span.id,
          kind: 'layer-motion-span',
          layerId: layer.id,
          layerName: layer.name,
          label: `${layer.name} · 关键帧选段`,
          reasonCode: 'INVALID_MOTION_SPAN',
          reason: `「${layer.name}」的关键帧选段至少需要 2 枚关键帧，已跳过。`,
        });
        continue;
      }
      if (edit.action === 'shift' && keyTimesMs.includes(0)) {
        skipped.push({
          itemId: span.id,
          kind: 'layer-motion-span',
          layerId: layer.id,
          layerName: layer.name,
          label: `${layer.name} · 关键帧选段`,
          reasonCode: 'PROTECTED_BASE_KEY',
          reason: `「${layer.name}」包含受保护的 0ms 基础关键帧，不支持平移，已跳过。`,
        });
        continue;
      }
      selectedSpans.push({ span, layer, keyTimesMs });
    }

    if (selectedEvents.length === 0 && selectedSpans.length === 0) {
      throw new TimelineEventBatchError(
        'TIMELINE_EVENT_UNSUPPORTED',
        skipped[0]?.reason ?? '所选项目均不支持当前批量时间调整。',
      );
    }

    // Compute unified shift bounds if shift action.
    let allowedDeltaRange: { minDeltaMs: number; maxDeltaMs: number } | null = null;
    let effectiveDeltaMs: number | null = null;
    let clamped = false;
    let effectiveEdit = edit;

    if (edit.action === 'shift') {
      let minDeltaMs = Number.NEGATIVE_INFINITY;
      let maxDeltaMs = Number.POSITIVE_INFINITY;
      for (const { event } of selectedEvents) {
        minDeltaMs = Math.max(minDeltaMs, -event.startMs);
        if (event.type === 'graphic-playback') {
          minDeltaMs = Math.max(minDeltaMs, -event.playbackStartMs);
        }
        maxDeltaMs = Math.min(maxDeltaMs, shot.durationMs - event.endMs);
      }
      for (const { keyTimesMs } of selectedSpans) {
        const firstKey = keyTimesMs[0]!;
        const lastKey = keyTimesMs[keyTimesMs.length - 1]!;
        // Non-0ms keys must stay at >= frame 1.
        minDeltaMs = Math.max(minDeltaMs, frameTimeMs(1) - firstKey);
        maxDeltaMs = Math.min(maxDeltaMs, shot.durationMs - lastKey);
      }
      allowedDeltaRange = { minDeltaMs, maxDeltaMs };
      effectiveDeltaMs =
        boundaryMode === 'clamp'
          ? Math.min(Math.max(edit.deltaMs, minDeltaMs), maxDeltaMs)
          : edit.deltaMs;
      clamped = effectiveDeltaMs !== edit.deltaMs;
      effectiveEdit = { action: 'shift', deltaMs: effectiveDeltaMs };
    }

    const entries = selectedEvents.map(
      ({ event, layerName }): BatchTimelineEventEntry => {
        const nextTiming = this.candidateEventTiming(
          shot,
          event,
          effectiveEdit,
          layerName,
        );
        return {
          kind: 'timeline-event',
          eventId: event.id,
          layerId: event.layerId,
          layerName,
          eventType: event.type,
          startMs: event.startMs,
          endMs: event.endMs,
          nextStartMs: nextTiming.startMs,
          nextEndMs: nextTiming.endMs,
          ...(nextTiming.playbackStartMs !== undefined
            ? { nextPlaybackStartMs: nextTiming.playbackStartMs }
            : {}),
        };
      },
    );

    this.assertNoNewChannelConflict(shot, entries);

    const motionSpanEntries = selectedSpans.map(
      ({ span, layer, keyTimesMs }): BatchLayerMotionSpanEntry => {
        if (effectiveEdit.action === 'shift') {
          const deltaFrames = deltaMsToFrames(effectiveEdit.deltaMs);
          try {
            const retimePlan = this.layerMotionService.planKeysRetime(project, {
              shotId: shot.id,
              layerId: layer.id,
              fromTimesMs: keyTimesMs,
              deltaFrames,
            });
            const nextTimes = retimePlan.moves.map((move) => move.toTimeMs);
            return {
              kind: 'layer-motion-span',
              spanId: span.id,
              layerId: layer.id,
              layerName: layer.name,
              startMs: keyTimesMs[0]!,
              endMs: keyTimesMs[keyTimesMs.length - 1]!,
              nextStartMs: nextTimes[0]!,
              nextEndMs: nextTimes[nextTimes.length - 1]!,
              keyTimesMs,
              deltaFrames,
            };
          } catch (error) {
            throw new TimelineEventBatchError(
              'LAYER_MOTION_RETIME_FAILED',
              error instanceof Error
                ? `「${layer.name}」关键帧平移失败：${error.message}`
                : `「${layer.name}」关键帧平移失败。`,
            );
          }
        }
        try {
          const durationPlan = this.layerMotionService.planKeySpanDuration(
            project,
            {
              shotId: shot.id,
              layerId: layer.id,
              startMs: keyTimesMs[0]!,
              endMs: keyTimesMs[keyTimesMs.length - 1]!,
              durationMs: effectiveEdit.durationMs,
            },
          );
          return {
            kind: 'layer-motion-span',
            spanId: span.id,
            layerId: layer.id,
            layerName: layer.name,
            startMs: durationPlan.startMs,
            endMs: durationPlan.endMs,
            nextStartMs: durationPlan.startMs,
            nextEndMs: durationPlan.nextEndMs,
            keyTimesMs,
          };
        } catch (error) {
          throw new TimelineEventBatchError(
            'LAYER_MOTION_RETIME_FAILED',
            error instanceof Error
              ? `「${layer.name}」关键帧统一时长失败：${error.message}`
              : `「${layer.name}」关键帧统一时长失败。`,
          );
        }
      },
    );

    const allStarts = [
      ...entries.map((entry) => entry.nextStartMs),
      ...motionSpanEntries.map((entry) => entry.nextStartMs),
    ];
    const allEnds = [
      ...entries.map((entry) => entry.nextEndMs),
      ...motionSpanEntries.map((entry) => entry.nextEndMs),
    ];
    const changedCount =
      entries.filter(
        (entry) =>
          entry.nextStartMs !== entry.startMs || entry.nextEndMs !== entry.endMs,
      ).length +
      motionSpanEntries.filter(
        (entry) =>
          entry.nextStartMs !== entry.startMs || entry.nextEndMs !== entry.endMs,
      ).length;

    return {
      shotId: shot.id,
      edit: effectiveEdit,
      effectiveDeltaMs,
      clamped,
      allowedDeltaRange,
      entries,
      motionSpanEntries,
      skipped,
      earliestStartMs: Math.min(...allStarts),
      latestEndMs: Math.max(...allEnds),
      changedCount,
    };
  }

  /**
   * Commits a validated action batch as one atomic candidate Project.
   * Returns the same Project reference when no item changes.
   */
  apply(project: Project, input: BatchEditTimelineEventsInput): Project {
    const plan = this.plan(project, input);
    if (plan.changedCount === 0) return project;

    let candidate = project;
    if (plan.entries.length > 0) {
      const shot = this.shot(candidate, plan.shotId);
      const entryById = new Map(
        plan.entries.map((entry) => [entry.eventId, entry]),
      );
      const nextShot: Shot = {
        ...shot,
        timelineEvents: shot.timelineEvents.map((event) => {
          const entry = entryById.get(event.id);
          return entry ? retimeEvent(event, entry) : event;
        }),
      };
      candidate = ProjectSchema.parse({
        ...candidate,
        shots: candidate.shots.map((item) =>
          item.id === nextShot.id ? nextShot : item,
        ),
        updatedAt: this.now().toISOString(),
        createdAt: project.createdAt,
      });
    }

    for (const spanEntry of plan.motionSpanEntries) {
      if (
        spanEntry.nextStartMs === spanEntry.startMs &&
        spanEntry.nextEndMs === spanEntry.endMs
      ) {
        continue;
      }
      if (plan.edit.action === 'shift') {
        candidate = this.layerMotionService.retimeKeys(candidate, {
          shotId: plan.shotId,
          layerId: spanEntry.layerId,
          fromTimesMs: spanEntry.keyTimesMs,
          deltaFrames: spanEntry.deltaFrames ?? 0,
        });
      } else {
        candidate = this.layerMotionService.retimeKeySpanDuration(candidate, {
          shotId: plan.shotId,
          layerId: spanEntry.layerId,
          startMs: spanEntry.startMs,
          endMs: spanEntry.endMs,
          durationMs: plan.edit.durationMs,
        });
      }
    }

    return candidate === project
      ? project
      : ProjectSchema.parse({
          ...candidate,
          updatedAt: this.now().toISOString(),
          createdAt: project.createdAt,
        });
  }

  /**
   * Plans a gap-preserving cross-type shift across selected timed Dialogues
   * and selected action events / LayerMotion spans with one unified delta.
   */
  planCrossTypeShift(
    project: Project,
    input: CrossTypeBatchShiftInput,
  ): CrossTypeBatchShiftPlan {
    const dialogueIds = [...new Set(input.dialogueIds ?? [])];
    const eventIds = [...new Set(input.eventIds ?? [])];
    const layerMotionSpans = input.layerMotionSpans ?? [];
    const boundaryMode: BatchBoundaryMode = input.boundaryMode ?? 'reject';

    if (
      dialogueIds.length === 0 &&
      eventIds.length === 0 &&
      layerMotionSpans.length === 0
    ) {
      throw new TimelineEventBatchError(
        'TIMELINE_EVENT_BATCH_TOO_SMALL',
        '请至少选择一条对白或动作区间再进行整体平移。',
      );
    }

    // First probe allowed ranges with delta=0 so we can compute a single
    // unified allowedDeltaRange across both dialogues and actions.
    let minDeltaMs = Number.NEGATIVE_INFINITY;
    let maxDeltaMs = Number.POSITIVE_INFINITY;

    if (dialogueIds.length > 0) {
      const probe = this.dialogueService.planMoveMany(project, {
        shotId: input.shotId,
        dialogueIds,
        deltaMs: 0,
        sharedClipPolicy: input.sharedClipPolicy,
        boundaryMode: 'reject',
      });
      minDeltaMs = Math.max(minDeltaMs, probe.allowedDeltaRange.minDeltaMs);
      maxDeltaMs = Math.min(maxDeltaMs, probe.allowedDeltaRange.maxDeltaMs);
    }

    let actionProbe: BatchTimelineEditPlan | null = null;
    let skippedOnlyActionError: BatchTimelineSkippedEntry[] = [];
    if (eventIds.length > 0 || layerMotionSpans.length > 0) {
      try {
        actionProbe = this.plan(project, {
          shotId: input.shotId,
          eventIds,
          layerMotionSpans,
          edit: { action: 'shift', deltaMs: 0 },
          boundaryMode: 'reject',
        });
        if (actionProbe.allowedDeltaRange) {
          minDeltaMs = Math.max(minDeltaMs, actionProbe.allowedDeltaRange.minDeltaMs);
          maxDeltaMs = Math.min(maxDeltaMs, actionProbe.allowedDeltaRange.maxDeltaMs);
        }
      } catch (error) {
        if (
          dialogueIds.length > 0 &&
          error instanceof TimelineEventBatchError &&
          error.code === 'TIMELINE_EVENT_UNSUPPORTED'
        ) {
          // Only unsupported actions were selected alongside valid dialogues:
          // record them as skipped and still allow the dialogues to shift.
          skippedOnlyActionError = this.collectUnsupportedAsSkipped(
            project,
            input.shotId,
            eventIds,
            layerMotionSpans,
          );
        } else {
          throw error;
        }
      }
    }

    const effectiveDeltaMs =
      boundaryMode === 'clamp'
        ? Math.min(Math.max(input.deltaMs, minDeltaMs), maxDeltaMs)
        : input.deltaMs;
    const clamped = effectiveDeltaMs !== input.deltaMs;

    const dialoguePlan =
      dialogueIds.length > 0
        ? this.dialogueService.planMoveMany(project, {
            shotId: input.shotId,
            dialogueIds,
            deltaMs: effectiveDeltaMs,
            sharedClipPolicy: input.sharedClipPolicy,
            boundaryMode: 'reject',
          })
        : null;

    const actionPlan = actionProbe
      ? this.plan(project, {
          shotId: input.shotId,
          eventIds,
          layerMotionSpans,
          edit: { action: 'shift', deltaMs: effectiveDeltaMs },
          boundaryMode: 'reject',
        })
      : null;

    const starts: number[] = [];
    const ends: number[] = [];
    if (dialoguePlan) {
      starts.push(dialoguePlan.earliestStartMs);
      ends.push(dialoguePlan.latestEndMs);
    }
    if (actionPlan) {
      starts.push(actionPlan.earliestStartMs);
      ends.push(actionPlan.latestEndMs);
    }

    const changedCount =
      (dialoguePlan && dialoguePlan.deltaMs !== 0
        ? dialoguePlan.entries.length
        : 0) + (actionPlan?.changedCount ?? 0);

    return {
      shotId: input.shotId,
      requestedDeltaMs: input.deltaMs,
      deltaMs: effectiveDeltaMs,
      clamped,
      allowedDeltaRange: { minDeltaMs, maxDeltaMs },
      dialoguePlan,
      actionPlan,
      skipped: actionPlan ? actionPlan.skipped : skippedOnlyActionError,
      earliestStartMs: Math.min(...starts),
      latestEndMs: Math.max(...ends),
      changedCount,
    };
  }

  /**
   * Commits a gap-preserving cross-type shift across dialogues and actions in
   * one atomic candidate Project so the renderer records a single Undo entry.
   */
  applyCrossTypeShift(
    project: Project,
    input: CrossTypeBatchShiftInput,
  ): Project {
    const plan = this.planCrossTypeShift(project, input);
    if (plan.changedCount === 0) return project;

    let candidate = project;
    if (plan.dialoguePlan && plan.dialoguePlan.deltaMs !== 0) {
      candidate = this.dialogueService.moveMany(candidate, {
        shotId: input.shotId,
        dialogueIds: input.dialogueIds ?? [],
        deltaMs: plan.deltaMs,
        sharedClipPolicy: input.sharedClipPolicy,
        boundaryMode: 'reject',
      });
    }
    if (plan.actionPlan && plan.actionPlan.changedCount > 0) {
      candidate = this.apply(candidate, {
        shotId: input.shotId,
        eventIds: input.eventIds,
        layerMotionSpans: input.layerMotionSpans,
        edit: { action: 'shift', deltaMs: plan.deltaMs },
        boundaryMode: 'reject',
      });
    }
    return candidate;
  }

  private collectUnsupportedAsSkipped(
    project: Project,
    shotId: string,
    eventIds: readonly string[],
    layerMotionSpans: readonly BatchLayerMotionSpanRef[],
  ): BatchTimelineSkippedEntry[] {
    const shot = this.shot(project, shotId);
    const layersById = new Map(shot.layers.map((layer) => [layer.id, layer]));
    const skipped: BatchTimelineSkippedEntry[] = [];
    for (const eventId of eventIds) {
      const event = shot.timelineEvents.find((candidate) => candidate.id === eventId);
      if (!event) continue;
      const layer = layersById.get(event.layerId);
      const layerName = layer?.name ?? '该对象';
      const typeLabel = ANY_EVENT_TYPE_LABEL[event.type];
      skipped.push({
        itemId: event.id,
        kind: 'timeline-event',
        layerId: event.layerId,
        layerName,
        label: `${layerName} · ${typeLabel}`,
        reasonCode:
          event.type === 'mouth-pose'
            ? 'MOUTH_POSE_BOUND_TO_DIALOGUE'
            : layer?.locked
              ? 'LAYER_LOCKED'
              : 'UNSUPPORTED_EVENT_TYPE',
        reason:
          event.type === 'mouth-pose'
            ? `「${layerName}」的口型段随对白联动，请批量移动对应对白。`
            : layer?.locked
              ? `「${layerName}」已锁定，先解锁再批量调整，已跳过。`
              : `「${layerName}」的${typeLabel}不支持区间批量调整，已跳过。`,
      });
    }
    for (const span of layerMotionSpans) {
      const layer = layersById.get(span.layerId);
      const layerName = layer?.name ?? '该对象';
      skipped.push({
        itemId: span.id,
        kind: 'layer-motion-span',
        layerId: span.layerId,
        layerName,
        label: `${layerName} · 关键帧选段`,
        reasonCode: layer?.locked ? 'LAYER_LOCKED' : 'PROTECTED_BASE_KEY',
        reason: layer?.locked
          ? `「${layerName}」已锁定，已跳过。`
          : `「${layerName}」的关键帧选段暂不支持此平移操作，已跳过。`,
      });
    }
    return skipped;
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

  private candidateEventTiming(
    shot: Shot,
    event: BatchEditableEvent,
    edit: BatchTimelineEdit,
    layerName: string,
  ): { startMs: number; endMs: number; playbackStartMs?: number } {
    const startMs =
      edit.action === 'shift' ? event.startMs + edit.deltaMs : event.startMs;
    const endMs =
      edit.action === 'shift'
        ? event.endMs + edit.deltaMs
        : event.startMs + edit.durationMs;
    const label = BATCH_EVENT_TYPE_LABEL[event.type];

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
          ? `「${layerName}」的${label}再往前移动 ${formatSeconds(edit.deltaMs)} 秒会超出镜头开头。`
          : `「${layerName}」的${label}起点已在镜头开头之前。`,
      );
    }
    if (endMs > shot.durationMs) {
      throw new TimelineEventBatchError(
        'TIMELINE_EVENT_BATCH_OUT_OF_RANGE',
        edit.action === 'shift'
          ? `「${layerName}」的${label}再往后移动 ${formatSeconds(edit.deltaMs)} 秒会超出镜头结尾。`
          : `「${layerName}」的${label}统一为 ${formatSeconds(edit.durationMs)} 秒会超出镜头结尾。`,
      );
    }
    if (endMs <= startMs) {
      throw new TimelineEventBatchError(
        'INVALID_TIMELINE_EDIT_AMOUNT',
        `「${layerName}」的${label}调整后没有持续时间。`,
      );
    }

    if (event.type === 'graphic-playback') {
      const playbackStartMs =
        edit.action === 'shift'
          ? event.playbackStartMs + edit.deltaMs
          : event.playbackStartMs;
      if (playbackStartMs < 0) {
        throw new TimelineEventBatchError(
          'TIMELINE_EVENT_BATCH_OUT_OF_RANGE',
          `「${layerName}」的元件播放起始相位再往前移动 ${formatSeconds(
            edit.action === 'shift' ? edit.deltaMs : 0,
          )} 秒会早于镜头开头。`,
        );
      }
      return { startMs, endMs, playbackStartMs };
    }

    return { startMs, endMs };
  }

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
        const channelLabel = BATCH_EVENT_TYPE_LABEL[entry.eventType];

        if (
          !overlaps(currentTiming, {
            startMs: other.startMs,
            endMs: other.endMs,
          }) &&
          overlaps(nextTiming, otherTiming)
        ) {
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
        if (
          currentOrder !== 0 &&
          nextOrder !== 0 &&
          Math.sign(currentOrder) !== Math.sign(nextOrder)
        ) {
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
