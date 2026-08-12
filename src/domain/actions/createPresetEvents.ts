import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../constants';
import { TimelineEventSchema } from '../models/timeline-event';
import type { Layer, Project, Shot, TimelineEvent } from '../models';
import {
  ACTION_PRESET_BY_ID,
  type ActionPresetId,
} from './ActionPreset';
import { evaluateShotAtTime } from '../evaluate-shot-at-time';

export interface CreatePresetEventsOptions {
  /** Override id generation; defaults to `crypto.randomUUID`. */
  createId?: () => string;
}

export interface CreatePresetEventsParams {
  /**
   * Event start time in integer milliseconds. When omitted, the action starts
   * at the end of the retained sequence for its target layer.
   */
  startMs?: number;
  /** Override the preset's default duration in integer milliseconds. */
  durationMs?: number;
  /** Target center X for the `move-to` preset. */
  targetX?: number;
  /** Target center Y for the `move-to` preset. */
  targetY?: number;
  /** Scale multiplier for the `scale-emphasis` preset. */
  scaleFactor?: number;
  /** Horizontal shake amplitude for the `shake` preset. */
  amplitudeX?: number;
  /** Vertical shake amplitude for the `shake` preset. */
  amplitudeY?: number;
  /** Shake frequency in Hz for the `shake` preset. */
  frequencyHz?: number;
  /** Target expression id for the `expression-switch` preset. */
  expressionId?: string;
}

const OFFSCREEN_MARGIN = 300;
const DEFAULT_SCALE_FACTOR = 1.3;
const DEFAULT_SHAKE_AMPLITUDE = 24;
const DEFAULT_SHAKE_FREQUENCY_HZ = 6;

/**
 * Returns the deterministic append boundary for one layer's action sequence.
 * Events on other layers never serialize this target, and an empty sequence
 * starts at the shot origin.
 */
export function nextPresetStartMs(shot: Shot, layerId: string): number {
  return shot.timelineEvents.reduce(
    (boundary, event) =>
      event.layerId === layerId ? Math.max(boundary, event.endMs) : boundary,
    0,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Maps a timeline event *type* to the logical property it mutates. This is the
 * single source of truth shared by `propertyOf` and by overlap detection, which
 * has to compare against a preset's `eventType` string rather than a full event
 * object. The mapping must stay in lock-step with `propertyOf`.
 */
function propertyOfType(type: TimelineEvent['type']): string {
  switch (type) {
    case 'move':
    case 'shake':
      return 'position';
    case 'scale':
      return 'scale';
    case 'opacity':
      return 'opacity';
    case 'expression':
      return 'expression';
    case 'flip':
      return 'flip';
    case 'visibility':
      return 'visibility';
  }
}

function propertyOf(event: TimelineEvent): string {
  return propertyOfType(event.type);
}

/**
 * Detects overlapping timeline events on the same layer and property. Day 25
 * only declares the conflict (DEBT-CONFLICT-B25-001); full overlap semantics
 * are deferred to Day 27. This never throws.
 */
function detectOverlap(
  shot: Shot,
  layerId: string,
  property: string,
  startMs: number,
  endMs: number,
): boolean {
  const conflict = shot.timelineEvents.some(
    (event) =>
      event.layerId === layerId &&
      propertyOf(event) === property &&
      event.startMs < endMs &&
      startMs < event.endMs,
  );
  if (conflict) {
    console.warn(
      `[DEBT-CONFLICT-B25-001] 同一图层同一属性(${property})的时间区间存在重叠，` +
        '叠加语义将在 Day 27 解决。',
    );
  }
  return conflict;
}

function moveFromX(presetId: ActionPresetId, layer: Layer): number {
  if (presetId === 'enter-left') {
    return -OFFSCREEN_MARGIN;
  }
  if (presetId === 'enter-right') {
    return PROJECT_WIDTH + OFFSCREEN_MARGIN;
  }
  return layer.x;
}

function moveTarget(
  presetId: ActionPresetId,
  layer: Layer,
  params: CreatePresetEventsParams,
): { x: number; y: number } {
  if (presetId === 'enter-left' || presetId === 'enter-right') {
    return { x: layer.x, y: layer.y };
  }
  const x = clamp(params.targetX ?? layer.x, 0, PROJECT_WIDTH);
  const y = clamp(params.targetY ?? layer.y, 0, PROJECT_HEIGHT);
  return { x, y };
}

/**
 * Pure function that turns a preset selection into validated timeline events.
 * Always returns events with unique ids, integer millisecond times, and
 * coordinates in the 1920×1080 logical space. The result passes
 * `TimelineEventSchema`.
 */
export function createPresetEvents(
  project: Project,
  shotId: string,
  layerId: string,
  presetId: ActionPresetId,
  params: CreatePresetEventsParams = {},
  options: CreatePresetEventsOptions = {},
): TimelineEvent[] {
  const createId = options.createId ?? (() => crypto.randomUUID());
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  if (!shot) {
    throw new Error(`找不到镜头：${shotId}`);
  }
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  if (!layer) {
    throw new Error(`找不到图层：${layerId}`);
  }

  const preset = ACTION_PRESET_BY_ID[presetId];
  const startMs = Math.round(
    params.startMs ?? nextPresetStartMs(shot, layerId),
  );
  const durationMs = Math.round(params.durationMs ?? preset.defaultDurationMs);
  const endMs = startMs + durationMs;
  const id = createId();

  // Resolve the layer's *real* evaluated state at `startMs` so that the new
  // event's `from`/`to` anchor to where the layer actually is at that moment
  // (which may already be mid-animation from earlier events) instead of the
  // static base-state defined on the Layer. When there are no prior events
  // affecting this layer at `startMs`, the evaluated state equals the static
  // base state, so existing single-event behavior is preserved.
  const evaluatedShot = evaluateShotAtTime(shot, startMs, project);
  const evaluatedLayer = evaluatedShot.layers.find(
    (candidate) => candidate.id === layerId,
  );
  const baseX = evaluatedLayer?.x ?? layer.x;
  const baseY = evaluatedLayer?.y ?? layer.y;
  const baseScaleX = evaluatedLayer?.scaleX ?? layer.scaleX;
  const baseScaleY = evaluatedLayer?.scaleY ?? layer.scaleY;
  const baseOpacity = evaluatedLayer?.opacity ?? layer.opacity;

  // Map the preset's event *type* to its logical property so that e.g. a new
  // `move` event is correctly compared against existing `shake` events (both
  // mutate `position`). Passing the raw `preset.eventType` would never match.
  const hasPropertyOverlap = detectOverlap(
    shot,
    layerId,
    propertyOfType(preset.eventType),
    startMs,
    endMs,
  );

  let event: TimelineEvent;

  switch (preset.eventType) {
    case 'move': {
      // An overlapping position timeline has no single trustworthy evaluated
      // destination: the old evaluator may end on a stale/degenerate event.
      // For a new enter action, use the layer's authored destination in that
      // conflict case. With no overlap, retain Issue #54's evaluated chaining
      // rule so enter-after-move still lands at the real boundary state.
      const enterDestination =
        presetId === 'enter-left' || presetId === 'enter-right'
          ? hasPropertyOverlap
            ? { x: layer.x, y: layer.y }
            : { x: baseX, y: baseY }
          : moveTarget(presetId, layer, params);
      const fromX =
        presetId === 'enter-left' || presetId === 'enter-right'
          ? moveFromX(presetId, layer)
          : baseX;
      const fromY =
        presetId === 'enter-left' || presetId === 'enter-right'
          ? enterDestination.y
          : baseY;
      event = TimelineEventSchema.parse({
        id,
        type: 'move',
        layerId,
        startMs,
        endMs,
        from: { x: fromX, y: fromY },
        to: enterDestination,
        easing: 'ease-in-out',
      });
      break;
    }
    case 'scale': {
      const base = baseScaleX;
      const factor = params.scaleFactor ?? DEFAULT_SCALE_FACTOR;
      event = TimelineEventSchema.parse({
        id,
        type: 'scale',
        layerId,
        startMs,
        endMs,
        from: { x: base, y: baseScaleY },
        to: { x: base * factor, y: baseScaleY * factor },
        easing: 'ease-in-out',
      });
      break;
    }
    case 'opacity': {
      const from = presetId === 'fade-in' ? 0 : baseOpacity;
      const to = presetId === 'fade-in' ? baseOpacity : 0;
      event = TimelineEventSchema.parse({
        id,
        type: 'opacity',
        layerId,
        startMs,
        endMs,
        from,
        to,
        easing: 'ease-in-out',
      });
      break;
    }
    case 'shake': {
      const amplitudeX = params.amplitudeX ?? DEFAULT_SHAKE_AMPLITUDE;
      const amplitudeY = params.amplitudeY ?? 0;
      const frequencyHz = params.frequencyHz ?? DEFAULT_SHAKE_FREQUENCY_HZ;
      event = TimelineEventSchema.parse({
        id,
        type: 'shake',
        layerId,
        startMs,
        endMs,
        amplitudeX,
        amplitudeY,
        frequencyHz,
      });
      break;
    }
    case 'expression': {
      const expressionId = params.expressionId;
      if (!expressionId) {
        throw new Error('表情切换需要指定 expressionId。');
      }
      if (layer.source.kind !== 'character') {
        throw new Error('表情切换仅适用于角色图层。');
      }
      const characterId = layer.source.characterId;
      const character = project.characters.find(
        (candidate) => candidate.id === characterId,
      );
      if (!character) {
        throw new Error('找不到该图层所属的角色。');
      }
      if (
        !character.expressions.some(
          (expression) => expression.id === expressionId,
        )
      ) {
        throw new Error('所选表情不属于该角色。');
      }
      event = TimelineEventSchema.parse({
        id,
        type: 'expression',
        layerId,
        startMs,
        endMs,
        expressionId,
      });
      break;
    }
  }

  return [event];
}
