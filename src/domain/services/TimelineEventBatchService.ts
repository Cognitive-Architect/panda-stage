import {
  ProjectSchema,
  type CharacterActionEvent,
  type ExpressionEvent,
  type FlipEvent,
  type GraphicPlaybackEvent,
  type Layer,
  type MoveEvent,
  type OpacityEvent,
  type Project,
  type ScaleEvent,
  type ShakeEvent,
  type Shot,
  type TimelineEvent,
  type VisibilityEvent,
} from '../models';
import {
  TIMELINE_FPS,
  frameTimeMs,
  lastValidFrameTime,
} from '../timeline/frame-grid';
import {
  DialogueService,
  type BatchBoundaryMode,
  type DialogueBatchMovePlan,
  type SharedAudioClipPolicy,
} from './DialogueService';
import { LayerMotionService, layerCompositeKeyTimes } from './LayerMotionService';
import { ShotService } from './ShotService';

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

/** Instantaneous switch events are shift-only; they never gain a duration. */
export const BATCH_SHIFTABLE_POINT_EVENT_TYPES = [
  'expression',
  'flip',
  'visibility',
] as const;

export type BatchShiftablePointEventType =
  (typeof BATCH_SHIFTABLE_POINT_EVENT_TYPES)[number];

export type BatchShiftablePointEvent =
  | ExpressionEvent
  | FlipEvent
  | VisibilityEvent;

export type BatchShiftableEvent = BatchEditableEvent | BatchShiftablePointEvent;

export type BatchShiftableEventType =
  | BatchEditableEventType
  | BatchShiftablePointEventType;

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

function eventChannel(eventType: BatchShiftableEventType): TimelineEventChannel | null {
  return isBatchEditableEventType(eventType) ? EVENT_CHANNEL[eventType] : null;
}

function isBatchEditableEventType(
  eventType: BatchShiftableEventType,
): eventType is BatchEditableEventType {
  return (BATCH_EDITABLE_EVENT_TYPES as readonly string[]).includes(eventType);
}

export const BATCH_EVENT_TYPE_LABEL: Record<BatchEditableEventType, string> = {
  move: '移动',
  scale: '缩放',
  opacity: '透明度',
  shake: '抖动',
  'character-action': '角色动作',
  'graphic-playback': '元件播放',
};

export const BATCH_POINT_EVENT_TYPE_LABEL: Record<
  BatchShiftablePointEventType,
  string
> = {
  expression: '表情',
  flip: '翻转',
  visibility: '显示',
};

const ANY_EVENT_TYPE_LABEL: Record<TimelineEvent['type'], string> = {
  ...BATCH_EVENT_TYPE_LABEL,
  ...BATCH_POINT_EVENT_TYPE_LABEL,
  'mouth-cue': '口型点',
  'mouth-pose': '口型段',
  'graphic-frame': '元件定格',
};

const POINT_EVENT_TYPE_SET = new Set<TimelineEvent['type']>(
  BATCH_SHIFTABLE_POINT_EVENT_TYPES,
);

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
  | 'POINT_EVENT_DURATION_UNSUPPORTED'
  | 'POINT_EVENT_CONFLICT'
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
  /** Explicit selected key times; when omitted, all layer keys inside the range participate. */
  readonly keyTimesMs?: readonly number[];
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
  readonly eventType: BatchShiftableEventType;
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
  | 'POINT_EVENT_DURATION_UNSUPPORTED'
  | 'POINT_EVENT_CONFLICT'
  | 'CROSSES_INSERT_POINT'
  | 'LAYER_MISSING'
  | 'LAYER_LOCKED'
  | 'PROTECTED_BASE_KEY'
  | 'INVALID_MOTION_SPAN';

export interface BatchTimelineSkippedEntry {
  readonly itemId: string;
  readonly kind: 'dialogue' | 'timeline-event' | 'layer-motion-span';
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
  /** Unified integer frame shift when LayerMotion keyframe spans participate. */
  readonly deltaFrames?: number;
  /** True when the requested shift was quantized to the 24fps frame grid. */
  readonly frameSnapped?: boolean;
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
  /** Unified integer frame shift when LayerMotion keyframe spans participate. */
  readonly deltaFrames?: number;
  /** True when the requested shift was quantized to the 24fps frame grid. */
  readonly frameSnapped?: boolean;
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

export interface InsertTimeGapInput {
  readonly shotId: string;
  readonly atMs: number;
  readonly durationMs: number;
  /** Editable layers whose events/keyframes participate; defaults to all unlocked layers. */
  readonly layerIds?: readonly string[];
  readonly sharedClipPolicy?: SharedAudioClipPolicy;
}

export interface InsertGapUnsupportedEntry {
  readonly kind:
    | 'standalone-audio'
    | 'camera-key'
    | 'camera-override'
    | 'depth-key'
    | 'parent-key'
    | 'graphic-frame';
  readonly layerId?: string;
  readonly label: string;
  readonly reason: string;
}

export interface InsertTimeGapPlan {
  readonly shotId: string;
  readonly atMs: number;
  readonly durationMs: number;
  readonly dialogueIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly layerMotionSpans: readonly BatchLayerMotionSpanRef[];
  readonly crossTypePlan: CrossTypeBatchShiftPlan | null;
  readonly skipped: readonly BatchTimelineSkippedEntry[];
  readonly unsupported: readonly InsertGapUnsupportedEntry[];
  readonly needsShotExtension: boolean;
  readonly extensionToMs: number | null;
  readonly earliestStartMs: number;
  readonly latestEndMs: number;
  readonly changedCount: number;
}

interface SelectedEvent {
  readonly event: BatchShiftableEvent;
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

export function isBatchShiftablePointEvent(
  event: TimelineEvent,
): event is BatchShiftablePointEvent {
  return POINT_EVENT_TYPE_SET.has(event.type);
}

export function isBatchShiftableEvent(
  event: TimelineEvent,
): event is BatchShiftableEvent {
  return isBatchEditableEvent(event) || isBatchShiftablePointEvent(event);
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
    case 'expression':
    case 'flip':
    case 'visibility':
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

function frameIndexForTimeMs(timeMs: number): number {
  return Math.round((timeMs * TIMELINE_FPS) / 1_000);
}

function deltaMsToFrames(deltaMs: number): number {
  return Math.round((deltaMs * TIMELINE_FPS) / 1_000);
}

interface FrameAlignedBatchDelta {
  readonly effectiveDeltaMs: number;
  readonly deltaFrames: number;
  readonly clamped: boolean;
  readonly frameSnapped: boolean;
  readonly minLegalDeltaMs: number;
  readonly maxLegalDeltaMs: number;
}

/**
 * Resolves ONE unified 24fps frame-grid shift shared by Dialogues,
 * TimelineEvents, and LayerMotion keyframe spans whenever at least one
 * LayerMotion span is included in the batch.
 *
 * Uses the earliest selected keyframe as the deterministic frame anchor so
 * repeated shifts (e.g. +100ms repeatedly) step along exact persisted frame
 * timestamps with zero cumulative quantization drift between keyframes and
 * millisecond-timed dialogues/events.
 */
function resolveFrameAlignedBatchDelta(params: {
  readonly requestedDeltaMs: number;
  readonly minDeltaMs: number;
  readonly maxDeltaMs: number;
  readonly shotDurationMs: number;
  readonly spans: readonly { readonly keyTimesMs: readonly number[] }[];
  readonly boundaryMode: BatchBoundaryMode;
}): FrameAlignedBatchDelta {
  const {
    requestedDeltaMs,
    minDeltaMs,
    maxDeltaMs,
    shotDurationMs,
    spans,
    boundaryMode,
  } = params;
  const lastShotFrame = frameIndexForTimeMs(lastValidFrameTime(shotDurationMs));
  let minSpanDeltaFrames = Number.NEGATIVE_INFINITY;
  let maxSpanDeltaFrames = Number.POSITIVE_INFINITY;
  let anchorFrameIndex = Number.POSITIVE_INFINITY;
  for (const { keyTimesMs } of spans) {
    const firstFrame = frameIndexForTimeMs(keyTimesMs[0]!);
    const lastFrame = frameIndexForTimeMs(keyTimesMs[keyTimesMs.length - 1]!);
    anchorFrameIndex = Math.min(anchorFrameIndex, firstFrame);
    // Frame zero is protected. Millisecond bounds apply only to timed items.
    minSpanDeltaFrames = Math.max(minSpanDeltaFrames, 1 - firstFrame);
    maxSpanDeltaFrames = Math.min(maxSpanDeltaFrames, lastShotFrame - lastFrame);
  }
  const anchorMs = frameTimeMs(anchorFrameIndex);
  const msForFrames = (df: number): number =>
    frameTimeMs(anchorFrameIndex + df) - anchorMs;

  // Compute exact legal frame delta bounds [minLegalFrames, maxLegalFrames]
  // where BOTH span frame bounds AND ms bounds [minDeltaMs, maxDeltaMs] hold.
  let minLegalFrames = Math.max(
    minSpanDeltaFrames,
    Math.ceil((minDeltaMs * TIMELINE_FPS) / 1_000) - 1,
  );
  while (
    minLegalFrames > minSpanDeltaFrames &&
    msForFrames(minLegalFrames - 1) >= minDeltaMs
  ) {
    minLegalFrames -= 1;
  }
  while (
    minLegalFrames < maxSpanDeltaFrames &&
    msForFrames(minLegalFrames) < minDeltaMs
  ) {
    minLegalFrames += 1;
  }

  let maxLegalFrames = Math.min(
    maxSpanDeltaFrames,
    Math.floor((maxDeltaMs * TIMELINE_FPS) / 1_000) + 1,
  );
  while (
    maxLegalFrames < maxSpanDeltaFrames &&
    msForFrames(maxLegalFrames + 1) <= maxDeltaMs
  ) {
    maxLegalFrames += 1;
  }
  while (
    maxLegalFrames > minSpanDeltaFrames &&
    msForFrames(maxLegalFrames) > maxDeltaMs
  ) {
    maxLegalFrames -= 1;
  }

  if (minLegalFrames > maxLegalFrames) {
    minLegalFrames = 0;
    maxLegalFrames = 0;
  }

  const minLegalDeltaMs = msForFrames(minLegalFrames);
  const maxLegalDeltaMs = msForFrames(maxLegalFrames);
  const rawFrames = deltaMsToFrames(requestedDeltaMs);

  if (boundaryMode === 'clamp') {
    const clampedFrames = Math.min(
      Math.max(rawFrames, minLegalFrames),
      maxLegalFrames,
    );
    const effectiveDeltaMs = msForFrames(clampedFrames);
    return {
      effectiveDeltaMs,
      deltaFrames: clampedFrames,
      clamped:
        clampedFrames !== rawFrames ||
        requestedDeltaMs < minDeltaMs ||
        requestedDeltaMs > maxDeltaMs,
      frameSnapped: effectiveDeltaMs !== requestedDeltaMs,
      minLegalDeltaMs,
      maxLegalDeltaMs,
    };
  }

  // Reject requests outside the timed-item bounds or the permitted frame span.
  if (requestedDeltaMs < minDeltaMs || rawFrames < minSpanDeltaFrames) {
    throw new TimelineEventBatchError(
      'TIMELINE_EVENT_BATCH_OUT_OF_RANGE',
      '批量提前移动会超出镜头起点，请缩小提前量。',
    );
  }
  if (requestedDeltaMs > maxDeltaMs || rawFrames > maxSpanDeltaFrames) {
    throw new TimelineEventBatchError(
      'TIMELINE_EVENT_BATCH_OUT_OF_RANGE',
      '批量延后移动会超出镜头时长，请缩短延后量或先延长镜头。',
    );
  }

  // Requested delta is within ms bounds: align to nearest legal frame inside
  // [minLegalFrames, maxLegalFrames] so frame-grid rounding never overshoots bounds.
  const effectiveFrames = Math.min(
    Math.max(rawFrames, minLegalFrames),
    maxLegalFrames,
  );
  const effectiveDeltaMs = msForFrames(effectiveFrames);
  return {
    effectiveDeltaMs,
    deltaFrames: effectiveFrames,
    clamped: false,
    frameSnapped: effectiveDeltaMs !== requestedDeltaMs,
    minLegalDeltaMs,
    maxLegalDeltaMs,
  };
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
  private readonly shotService: ShotService;

  constructor(
    options: {
      now?: () => Date;
      layerMotionService?: LayerMotionService;
      dialogueService?: DialogueService;
      shotService?: ShotService;
    } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.layerMotionService =
      options.layerMotionService ?? new LayerMotionService();
    this.dialogueService = options.dialogueService ?? new DialogueService({ now: this.now });
    this.shotService = options.shotService ?? new ShotService({ now: this.now });
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
      const selectionKey = span.keyTimesMs
        ? `${span.layerId}:keys:${[...new Set(span.keyTimesMs)]
            .sort((left, right) => left - right)
            .join(',')}`
        : `${span.layerId}:range:${span.startMs}:${span.endMs}`;
      if (!uniqueSpans.has(selectionKey)) uniqueSpans.set(selectionKey, span);
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

      if (!isBatchShiftableEvent(event)) {
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
      if (isBatchShiftablePointEvent(event)) {
        if (edit.action === 'unify-duration') {
          skipped.push({
            itemId: event.id,
            kind: 'timeline-event',
            layerId: layer.id,
            layerName: layer.name,
            label: `${layer.name} · ${typeLabel}`,
            reasonCode: 'POINT_EVENT_DURATION_UNSUPPORTED',
            reason: `「${layer.name}」的${typeLabel}是点事件，只能平移，不能统一时长。`,
          });
          continue;
        }
        if (event.endMs !== event.startMs) {
          skipped.push({
            itemId: event.id,
            kind: 'timeline-event',
            layerId: layer.id,
            layerName: layer.name,
            label: `${layer.name} · ${typeLabel}`,
            reasonCode: 'EVENT_NOT_TIMED',
            reason: `「${layer.name}」的${typeLabel}不是零时长点事件，已跳过。`,
          });
          continue;
        }
      } else if (event.endMs <= event.startMs) {
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
      const requestedKeyTimes = span.keyTimesMs
        ? [...new Set(span.keyTimesMs)].sort((left, right) => left - right)
        : allKeyTimes.filter(
            (timeMs) => timeMs >= span.startMs && timeMs <= span.endMs,
          );
      const keyTimesMs = requestedKeyTimes.filter((timeMs) =>
        allKeyTimes.includes(timeMs),
      );
      const minimumKeyCount = edit.action === 'shift' ? 1 : 2;
      if (
        span.endMs < span.startMs ||
        keyTimesMs.length !== requestedKeyTimes.length ||
        keyTimesMs.length < minimumKeyCount
      ) {
        skipped.push({
          itemId: span.id,
          kind: 'layer-motion-span',
          layerId: layer.id,
          layerName: layer.name,
          label: `${layer.name} · 关键帧选段`,
          reasonCode: 'INVALID_MOTION_SPAN',
          reason:
            edit.action === 'shift'
              ? `「${layer.name}」的关键帧选段至少需要 1 枚真实关键帧，已跳过。`
              : `「${layer.name}」的关键帧选段至少需要 2 枚真实关键帧，已跳过。`,
        });
        continue;
      }
      if (edit.action === 'unify-duration') {
        const covered = allKeyTimes.filter(
          (timeMs) => timeMs >= keyTimesMs[0]! && timeMs <= keyTimesMs[keyTimesMs.length - 1]!,
        );
        if (covered.length !== keyTimesMs.length) {
          skipped.push({
            itemId: span.id,
            kind: 'layer-motion-span',
            layerId: layer.id,
            layerName: layer.name,
            label: `${layer.name} · 关键帧选段`,
            reasonCode: 'INVALID_MOTION_SPAN',
            reason: `「${layer.name}」的统一时长要求选段连续，已跳过。`,
          });
          continue;
        }
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
    let resolvedDeltaFrames: number | undefined;
    let frameSnapped: boolean | undefined;
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

      if (selectedSpans.length > 0) {
        const aligned = resolveFrameAlignedBatchDelta({
          requestedDeltaMs: edit.deltaMs,
          minDeltaMs,
          maxDeltaMs,
          spans: selectedSpans,
          shotDurationMs: shot.durationMs,
          boundaryMode,
        });
        effectiveDeltaMs = aligned.effectiveDeltaMs;
        resolvedDeltaFrames = aligned.deltaFrames;
        frameSnapped = aligned.frameSnapped;
        clamped = aligned.clamped;
        allowedDeltaRange = {
          minDeltaMs: aligned.minLegalDeltaMs,
          maxDeltaMs: aligned.maxLegalDeltaMs,
        };
        effectiveEdit = { action: 'shift', deltaMs: effectiveDeltaMs };
      } else {
        allowedDeltaRange = { minDeltaMs, maxDeltaMs };
        effectiveDeltaMs =
          boundaryMode === 'clamp'
            ? Math.min(Math.max(edit.deltaMs, minDeltaMs), maxDeltaMs)
            : edit.deltaMs;
        clamped = effectiveDeltaMs !== edit.deltaMs;
        effectiveEdit = { action: 'shift', deltaMs: effectiveDeltaMs };
      }
    }

    let entries = selectedEvents.map(
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

    const pointConflictResult = this.filterPointEventConflicts(shot, entries);
    entries = pointConflictResult.entries;
    skipped.push(...pointConflictResult.skipped);
    if (entries.length === 0 && selectedSpans.length === 0) {
      throw new TimelineEventBatchError(
        'TIMELINE_EVENT_UNSUPPORTED',
        skipped[0]?.reason ?? '所选项目均不支持当前批量时间调整。',
      );
    }

    this.assertNoNewChannelConflict(shot, entries);

    const motionSpanEntries = selectedSpans.map(
      ({ span, layer, keyTimesMs }): BatchLayerMotionSpanEntry => {
        if (effectiveEdit.action === 'shift') {
          const deltaFrames =
            resolvedDeltaFrames ?? deltaMsToFrames(effectiveEdit.deltaMs);
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
      ...(resolvedDeltaFrames !== undefined
        ? { deltaFrames: resolvedDeltaFrames }
        : {}),
      ...(frameSnapped !== undefined ? { frameSnapped } : {}),
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
    const shotDurationMs = this.shot(project, input.shotId).durationMs;
    if (eventIds.length > 0 || layerMotionSpans.length > 0) {
      try {
        actionProbe = this.plan(project, {
          shotId: input.shotId,
          eventIds,
          layerMotionSpans,
          edit: { action: 'shift', deltaMs: 0 },
          boundaryMode: 'reject',
        });
        for (const entry of actionProbe.entries) {
          // With a zero shift, nextPlaybackStartMs is the current playback start.
          minDeltaMs = Math.max(
            minDeltaMs,
            -entry.startMs,
            -(entry.nextPlaybackStartMs ?? entry.startMs),
          );
          maxDeltaMs = Math.min(maxDeltaMs, shotDurationMs - entry.endMs);
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

    let effectiveDeltaMs: number;
    let deltaFrames: number | undefined;
    let frameSnapped: boolean | undefined;
    let clamped: boolean;
    let resolvedAllowedRange = { minDeltaMs, maxDeltaMs };

    if (actionProbe && actionProbe.motionSpanEntries.length > 0) {
      const aligned = resolveFrameAlignedBatchDelta({
        requestedDeltaMs: input.deltaMs,
        minDeltaMs,
        maxDeltaMs,
        spans: actionProbe.motionSpanEntries,
        shotDurationMs,
        boundaryMode,
      });
      effectiveDeltaMs = aligned.effectiveDeltaMs;
      deltaFrames = aligned.deltaFrames;
      frameSnapped = aligned.frameSnapped;
      clamped = aligned.clamped;
      resolvedAllowedRange = {
        minDeltaMs: aligned.minLegalDeltaMs,
        maxDeltaMs: aligned.maxLegalDeltaMs,
      };
    } else {
      effectiveDeltaMs =
        boundaryMode === 'clamp'
          ? Math.min(Math.max(input.deltaMs, minDeltaMs), maxDeltaMs)
          : input.deltaMs;
      clamped = effectiveDeltaMs !== input.deltaMs;
    }

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
      ...(deltaFrames !== undefined ? { deltaFrames } : {}),
      ...(frameSnapped !== undefined ? { frameSnapped } : {}),
      clamped,
      allowedDeltaRange: resolvedAllowedRange,
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

  /**
   * Plans the first Spacer slice: insert positive blank time at the playhead and
   * shift only officially supported content at/after that point. Crossing
   * intervals, locked layers and unsupported timing objects are reported
   * locally rather than silently cut, skipped without notice, or claimed as a
   * full-track ripple.
   */
  planInsertGap(
    project: Project,
    input: InsertTimeGapInput,
  ): InsertTimeGapPlan {
    const shot = this.shot(project, input.shotId);
    if (
      !Number.isSafeInteger(input.atMs) ||
      input.atMs < 0 ||
      input.atMs > shot.durationMs
    ) {
      throw new TimelineEventBatchError(
        'TIMELINE_EVENT_BATCH_OUT_OF_RANGE',
        '插入位置必须位于当前镜头范围内。',
      );
    }
    if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 1) {
      throw new TimelineEventBatchError(
        'INVALID_TIMELINE_EDIT_AMOUNT',
        '插入空白时长必须是大于 0 的整数毫秒。',
      );
    }

    const atMs = input.atMs;
    const durationMs = input.durationMs;
    const layerFilter = input.layerIds ? new Set(input.layerIds) : null;
    const includesLayer = (layerId: string): boolean =>
      layerFilter === null || layerFilter.has(layerId);
    const layersById = new Map(shot.layers.map((layer) => [layer.id, layer]));
    const dialogueIds: string[] = [];
    const eventIds: string[] = [];
    const layerMotionSpans: BatchLayerMotionSpanRef[] = [];
    const skipped: BatchTimelineSkippedEntry[] = [];
    const unsupported: InsertGapUnsupportedEntry[] = [];

    for (const dialogue of shot.dialogues) {
      if (dialogue.endMs <= dialogue.startMs) continue;
      if (dialogue.startMs >= atMs) {
        dialogueIds.push(dialogue.id);
      } else if (dialogue.endMs > atMs) {
        skipped.push({
          itemId: dialogue.id,
          kind: 'dialogue',
          label: '对白',
          reasonCode: 'CROSSES_INSERT_POINT',
          reason: `有一条对白跨越插入点（${formatSeconds(dialogue.startMs)}–${formatSeconds(dialogue.endMs)}s），请先调整或拆开，已跳过。`,
        });
      }
    }

    for (const event of shot.timelineEvents) {
      if (!includesLayer(event.layerId)) continue;
      const layer = layersById.get(event.layerId);
      const layerName = layer?.name ?? '该对象';
      const typeLabel = ANY_EVENT_TYPE_LABEL[event.type];
      if (event.type === 'mouth-pose' || event.type === 'mouth-cue') continue;
      if (event.type === 'graphic-frame') {
        if (event.startMs >= atMs) {
          unsupported.push({
            kind: 'graphic-frame',
            layerId: event.layerId,
            label: `${layerName} · ${typeLabel}`,
            reason: `「${layerName}」的${typeLabel}尚未纳入 Spacer，已保留原位。`,
          });
        }
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
          reason: `「${layer.name}」已锁定，未纳入本次插入，已跳过。`,
        });
        continue;
      }
      if (event.startMs >= atMs) {
        eventIds.push(event.id);
      } else if (event.endMs > atMs) {
        skipped.push({
          itemId: event.id,
          kind: 'timeline-event',
          layerId: layer.id,
          layerName: layer.name,
          label: `${layer.name} · ${typeLabel}`,
          reasonCode: 'CROSSES_INSERT_POINT',
          reason: `「${layer.name}」的${typeLabel}跨越插入点，首版不自动截断，已跳过。`,
        });
      }
    }

    for (const layer of shot.layers) {
      if (layer.id === shot.backgroundLayerId || !includesLayer(layer.id)) {
        continue;
      }
      const times = layerCompositeKeyTimes(layer).filter(
        (timeMs) => timeMs > 0 && timeMs >= atMs,
      );
      if (layer.locked) {
        if (times.length > 0) {
          skipped.push({
            itemId: `layer-motion:${layer.id}`,
            kind: 'layer-motion-span',
            layerId: layer.id,
            layerName: layer.name,
            label: `${layer.name} · 关键帧`,
            reasonCode: 'LAYER_LOCKED',
            reason: `「${layer.name}」已锁定，关键帧未纳入本次插入，已跳过。`,
          });
        }
      } else if (times.length > 0) {
        layerMotionSpans.push({
          id: `spacer:${layer.id}`,
          layerId: layer.id,
          startMs: times[0]!,
          endMs: times[times.length - 1]!,
          keyTimesMs: times,
        });
      }

      if (layer.depthKeys?.some((key) => key.timeMs >= atMs)) {
        unsupported.push({
          kind: 'depth-key',
          layerId: layer.id,
          label: `${layer.name} · 深度键`,
          reason: `「${layer.name}」的深度键尚未纳入 Spacer，已保留原位。`,
        });
      }
      if (layer.parentKeys?.some((key) => key.timeMs >= atMs)) {
        unsupported.push({
          kind: 'parent-key',
          layerId: layer.id,
          label: `${layer.name} · 父级交接`,
          reason: `「${layer.name}」的父级交接尚未纳入 Spacer，已保留原位。`,
        });
      }
    }

    const referencedClipIds = new Set(
      shot.dialogues
        .map((dialogue) => dialogue.audioClipId)
        .filter((clipId): clipId is string => clipId !== undefined),
    );
    for (const clip of shot.audioClips) {
      if (referencedClipIds.has(clip.id)) continue;
      if (clip.startMs >= atMs || (clip.startMs < atMs && clip.endMs > atMs)) {
        unsupported.push({
          kind: 'standalone-audio',
          label: `独立音频 · ${clip.name}`,
          reason: `独立音频「${clip.name}」尚未纳入 Spacer，已保留原位。`,
        });
      }
    }

    for (const key of shot.camera?.keys ?? []) {
      if (key.timeMs >= atMs) {
        unsupported.push({
          kind: 'camera-key',
          label: '镜头相机键',
          reason: '镜头相机键尚未纳入 Spacer，已保留原位。',
        });
        break;
      }
    }
    for (const override of shot.camera?.overrides ?? []) {
      if (override.startMs >= atMs || (override.startMs < atMs && override.endMs > atMs)) {
        unsupported.push({
          kind: 'camera-override',
          label: '镜头相机接管',
          reason: '镜头相机接管尚未纳入 Spacer，已保留原位。',
        });
        break;
      }
    }

    const hasSupported =
      dialogueIds.length > 0 ||
      eventIds.length > 0 ||
      layerMotionSpans.length > 0;
    let maxEndMs = atMs;
    if (hasSupported) {
      for (const dialogueId of dialogueIds) {
        const dialogue = shot.dialogues.find(
          (candidate) => candidate.id === dialogueId,
        );
        if (dialogue) maxEndMs = Math.max(maxEndMs, dialogue.endMs);
      }
      for (const eventId of eventIds) {
        const event = shot.timelineEvents.find(
          (candidate) => candidate.id === eventId,
        );
        if (event) maxEndMs = Math.max(maxEndMs, event.endMs);
      }
      for (const span of layerMotionSpans) {
        maxEndMs = Math.max(maxEndMs, span.endMs);
      }
    }
    const requiredEndMs = maxEndMs + durationMs;
    const needsShotExtension = hasSupported && requiredEndMs > shot.durationMs;
    const extensionToMs = needsShotExtension ? requiredEndMs : null;
    const planningProject = needsShotExtension
      ? this.shotService.setDuration(project, shot.id, requiredEndMs)
      : project;

    let crossTypePlan: CrossTypeBatchShiftPlan | null = null;
    if (hasSupported) {
      try {
        crossTypePlan = this.planCrossTypeShift(planningProject, {
          shotId: shot.id,
          dialogueIds,
          eventIds,
          layerMotionSpans,
          deltaMs: durationMs,
          ...(input.sharedClipPolicy
            ? { sharedClipPolicy: input.sharedClipPolicy }
            : {}),
        });
      } catch (error) {
        if (
          error instanceof TimelineEventBatchError &&
          (error.code === 'TIMELINE_EVENT_UNSUPPORTED' ||
            error.code === 'TIMELINE_EVENT_BATCH_TOO_SMALL')
        ) {
          crossTypePlan = null;
        } else {
          throw error;
        }
      }
    }

    const allSkipped = [...skipped, ...(crossTypePlan?.skipped ?? [])];
    const changedCount = crossTypePlan?.changedCount ?? 0;
    return {
      shotId: shot.id,
      atMs,
      durationMs,
      dialogueIds,
      eventIds,
      layerMotionSpans,
      crossTypePlan,
      skipped: allSkipped,
      unsupported,
      needsShotExtension,
      extensionToMs,
      earliestStartMs: crossTypePlan?.earliestStartMs ?? atMs,
      latestEndMs: crossTypePlan?.latestEndMs ?? atMs,
      changedCount,
    };
  }

  /**
   * Applies the planned Spacer as one candidate Project. Shot extension and
   * cross-type shift are composed before the renderer's single History commit.
   */
  applyInsertGap(project: Project, input: InsertTimeGapInput): Project {
    const plan = this.planInsertGap(project, input);
    if (plan.changedCount === 0) return project;
    let candidate = plan.needsShotExtension && plan.extensionToMs !== null
      ? this.shotService.setDuration(project, plan.shotId, plan.extensionToMs)
      : project;
    candidate = this.applyCrossTypeShift(candidate, {
      shotId: plan.shotId,
      dialogueIds: plan.dialogueIds,
      eventIds: plan.eventIds,
      layerMotionSpans: plan.layerMotionSpans,
      deltaMs: plan.durationMs,
      ...(input.sharedClipPolicy
        ? { sharedClipPolicy: input.sharedClipPolicy }
        : {}),
    });
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
    event: BatchShiftableEvent,
    edit: BatchTimelineEdit,
    layerName: string,
  ): { startMs: number; endMs: number; playbackStartMs?: number } {
    const startMs =
      edit.action === 'shift' ? event.startMs + edit.deltaMs : event.startMs;
    const endMs =
      edit.action === 'shift'
        ? event.endMs + edit.deltaMs
        : event.startMs + edit.durationMs;
    const label = ANY_EVENT_TYPE_LABEL[event.type];

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
    if (endMs < startMs) {
      throw new TimelineEventBatchError(
        'INVALID_TIMELINE_EDIT_AMOUNT',
        `「${layerName}」的${label}调整后时间无效。`,
      );
    }
    if (!isBatchShiftablePointEvent(event) && endMs === startMs) {
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

  /**
   * Point events have no interval overlap semantics. Two same-layer, same-type
   * switch events landing on the same timestamp would make the effective one
   * depend on ID ordering, so report them locally instead of silently stacking.
   */
  private filterPointEventConflicts(
    shot: Shot,
    entries: readonly BatchTimelineEventEntry[],
  ): {
    entries: BatchTimelineEventEntry[];
    skipped: BatchTimelineSkippedEntry[];
  } {
    const pointEntries = entries.filter((entry) =>
      POINT_EVENT_TYPE_SET.has(entry.eventType),
    );
    if (pointEntries.length === 0) {
      return { entries: [...entries], skipped: [] };
    }

    const targetCounts = new Map<string, number>();
    for (const entry of pointEntries) {
      const key = `${entry.layerId}:${entry.eventType}:${entry.nextStartMs}`;
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
    }

    const conflictingIds = new Set<string>();
    for (const entry of pointEntries) {
      const key = `${entry.layerId}:${entry.eventType}:${entry.nextStartMs}`;
      const collidesWithUnselected = shot.timelineEvents.some(
        (other) =>
          other.id !== entry.eventId &&
          other.layerId === entry.layerId &&
          other.type === entry.eventType &&
          other.startMs === entry.nextStartMs,
      );
      if (collidesWithUnselected || (targetCounts.get(key) ?? 0) > 1) {
        conflictingIds.add(entry.eventId);
      }
    }

    if (conflictingIds.size === 0) {
      return { entries: [...entries], skipped: [] };
    }

    const skipped = pointEntries
      .filter((entry) => conflictingIds.has(entry.eventId))
      .map(
        (entry): BatchTimelineSkippedEntry => ({
          itemId: entry.eventId,
          kind: 'timeline-event',
          layerId: entry.layerId,
          layerName: entry.layerName,
          label: `${entry.layerName} · ${ANY_EVENT_TYPE_LABEL[entry.eventType]}`,
          reasonCode: 'POINT_EVENT_CONFLICT',
          reason: `「${entry.layerName}」在 ${formatSeconds(
            entry.nextStartMs,
          )} 秒已有同类型点事件，本次平移会重合；请调整偏移或先处理该点事件，已跳过。`,
        }),
      );

    return {
      entries: entries.filter((entry) => !conflictingIds.has(entry.eventId)),
      skipped,
    };
  }

  private assertNoNewChannelConflict(
    shot: Shot,
    entries: readonly BatchTimelineEventEntry[],
  ): void {
    const candidateById = new Map(
      entries.map((entry) => [entry.eventId, entry]),
    );

    for (const entry of entries) {
      const channel = eventChannel(entry.eventType);
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
        const channelLabel = ANY_EVENT_TYPE_LABEL[entry.eventType];

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
