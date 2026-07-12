import type {
  Project, Shot, Layer, TimelineEvent,
  SubtitleStyle,
} from '../../../shared/types';
import {
  MOUTH_OPEN_PERIOD_MS,
} from '../../../shared/constants';
import { interpolate, calculateShakeOffset } from './interpolators';

export interface LayerFrame {
  layerId: string;
  type: 'character' | 'image' | 'text';
  characterId?: string;
  assetId?: string;
  expressionAssetId?: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  flipX: boolean;
  visible: boolean;
  zIndex: number;
  mouthOpen: boolean;
  // Non-destructive shake offset
  shakeOffsetX: number;
  shakeOffsetY: number;
}

export interface DialogueFrame {
  dialogueId: string;
  characterId: string;
  text: string;
  startMs: number;
  durationMs: number;
  audioAssetId?: string;
  volume: number;
  subtitleEnabled: boolean;
}

export interface AudioClipFrame {
  clipId: string;
  assetId: string;
  startMs: number;
  volume: number;
}

export interface SubtitleFrame {
  text: string;
  style: SubtitleStyle;
}

export interface ShotFrame {
  layers: LayerFrame[];
  activeDialogues: DialogueFrame[];
  activeAudioClips: AudioClipFrame[];
  currentSubtitle: SubtitleFrame | null;
  backgroundAssetId?: string;
}

export interface ProjectFrame {
  currentShotIndex: number;
  currentShotTimeMs: number;
  shotFrame: ShotFrame;
}

/**
 * Evaluate the entire project at a given time (in milliseconds).
 * Pure function: no side effects, no DOM access.
 */
export function evaluateProjectAtTime(project: Project, timeMs: number): ProjectFrame {
  let currentShotIndex = 0;
  let accumulatedMs = 0;

  for (let i = 0; i < project.shots.length; i++) {
    const shot = project.shots[i];
    if (timeMs < accumulatedMs + shot.durationMs) {
      currentShotIndex = i;
      break;
    }
    accumulatedMs += shot.durationMs;
    if (i === project.shots.length - 1) {
      // Beyond total duration: return last frame
      currentShotIndex = i;
    }
  }

  const shot = project.shots[currentShotIndex];
  const shotTimeMs = timeMs - accumulatedMs;
  const shotFrame = evaluateShotAtTime(shot, shotTimeMs, project);

  return {
    currentShotIndex,
    currentShotTimeMs: shotTimeMs,
    shotFrame,
  };
}

/**
 * Evaluate a single shot at a given time within the shot.
 * Pure function.
 */
export function evaluateShotAtTime(shot: Shot, timeMs: number, project: Project): ShotFrame {
  // 1. Initialize layers from shot initial state
  const layerFrames: Map<string, LayerFrame> = new Map();
  for (const layer of shot.layers) {
    const expressionAssetId = resolveExpressionAssetId(layer, project);
    layerFrames.set(layer.id, {
      layerId: layer.id,
      type: layer.type,
      characterId: layer.characterId,
      assetId: layer.type === 'image' ? layer.assetId : expressionAssetId,
      expressionAssetId,
      x: layer.x,
      y: layer.y,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY,
      rotation: layer.rotation,
      opacity: layer.opacity,
      flipX: layer.flipX,
      visible: layer.visible,
      zIndex: layer.zIndex,
      mouthOpen: false,
      shakeOffsetX: 0,
      shakeOffsetY: 0,
    });
  }

  // 2. Group events by targetLayerId
  const eventsByLayer = new Map<string, TimelineEvent[]>();
  for (const event of shot.events) {
    const list = eventsByLayer.get(event.targetLayerId) ?? [];
    list.push(event);
    eventsByLayer.set(event.targetLayerId, list);
  }

  // 3. Apply events per layer, per property
  for (const [layerId, events] of eventsByLayer) {
    const layerFrame = layerFrames.get(layerId);
    if (!layerFrame) continue;

    // Sort events by order (ascending) for deterministic priority
    const sortedEvents = [...events].sort((a, b) => a.order - b.order);

    // Group by type
    const moveEvents = sortedEvents.filter(e => e.type === 'move');
    const scaleEvents = sortedEvents.filter(e => e.type === 'scale');
    const opacityEvents = sortedEvents.filter(e => e.type === 'opacity');
    const shakeEvents = sortedEvents.filter(e => e.type === 'shake');
    const expressionEvents = sortedEvents.filter(e => e.type === 'expression');
    const flipEvents = sortedEvents.filter(e => e.type === 'flip');
    const visibilityEvents = sortedEvents.filter(e => e.type === 'visibility');

    // Apply continuous properties (take the one active at timeMs, by order)
    applyContinuousEvent(moveEvents, timeMs, layerFrame, 'x', 'y');
    applyContinuousEvent(scaleEvents, timeMs, layerFrame, 'scaleX', 'scaleY');
    applyContinuousEvent(opacityEvents, timeMs, layerFrame, 'opacity');

    // Apply shake offsets (non-destructive, can stack with move)
    for (const event of shakeEvents) {
      if (timeMs >= event.startMs && timeMs <= event.endMs) {
        const duration = event.endMs - event.startMs;
        const progress = duration > 0 ? (timeMs - event.startMs) / duration : 0;
        const { offsetX, offsetY } = calculateShakeOffset(
          event.payload.amplitudeX,
          event.payload.amplitudeY,
          event.payload.frequency,
          progress
        );
        layerFrame.shakeOffsetX += offsetX;
        layerFrame.shakeOffsetY += offsetY;
      }
    }

    // Apply discrete events: take the most recent one by startMs (and order as tie-breaker)
    applyDiscreteEvent(expressionEvents, timeMs, layerFrame, 'expressionAssetId', project);
    applyDiscreteEvent(flipEvents, timeMs, layerFrame, 'flipX');
    applyDiscreteEvent(visibilityEvents, timeMs, layerFrame, 'visible');
  }

  // 4. Apply dialogues (mouth animation)
  const activeDialogues: DialogueFrame[] = [];
  for (const dialogue of shot.dialogues) {
    if (timeMs >= dialogue.startMs && timeMs < dialogue.startMs + dialogue.durationMs) {
      activeDialogues.push({
        dialogueId: dialogue.id,
        characterId: dialogue.characterId,
        text: dialogue.text,
        startMs: dialogue.startMs,
        durationMs: dialogue.durationMs,
        audioAssetId: dialogue.audioAssetId,
        volume: dialogue.volume,
        subtitleEnabled: dialogue.subtitleEnabled,
      });

      // Mouth animation: fixed frequency cycle
      const char = project.characters.find(c => c.id === dialogue.characterId);
      if (char && char.mouthOpenAssetId) {
        const cyclePos = (timeMs - dialogue.startMs) % MOUTH_OPEN_PERIOD_MS;
        const mouthOpen = cyclePos < MOUTH_OPEN_PERIOD_MS / 2;
        // Find the layer for this character
        for (const lf of layerFrames.values()) {
          if (lf.characterId === dialogue.characterId) {
            lf.mouthOpen = mouthOpen;
            if (mouthOpen) {
              lf.assetId = char.mouthOpenAssetId;
            }
          }
        }
      }
    }
  }

  // 5. Active audio clips
  const activeAudioClips: AudioClipFrame[] = [];
  for (const clip of shot.audioClips) {
    if (timeMs >= clip.startMs) {
      activeAudioClips.push({
        clipId: clip.id,
        assetId: clip.assetId,
        startMs: clip.startMs,
        volume: clip.volume,
      });
    }
  }

  // 6. Subtitle: show the first active dialogue
  let currentSubtitle: SubtitleFrame | null = null;
  const subtitleDialogue = activeDialogues.find(d => d.subtitleEnabled);
  if (subtitleDialogue) {
    const style = project.subtitleStyles[0]; // default style
    if (style) {
      currentSubtitle = {
        text: subtitleDialogue.text,
        style,
      };
    }
  }

  // 7. Sort layers by zIndex for rendering order
  const sortedLayers = Array.from(layerFrames.values()).sort((a, b) => a.zIndex - b.zIndex);

  return {
    layers: sortedLayers,
    activeDialogues,
    activeAudioClips,
    currentSubtitle,
    backgroundAssetId: shot.backgroundAssetId,
  };
}

function resolveExpressionAssetId(layer: Layer, project: Project): string | undefined {
  if (layer.type !== 'character' || !layer.characterId) return layer.assetId;
  const char = project.characters.find(c => c.id === layer.characterId);
  if (!char) return layer.assetId;
  const exprName = layer.expression || char.defaultExpression;
  return char.expressions[exprName] || layer.assetId;
}

function applyContinuousEvent(
  events: TimelineEvent[],
  timeMs: number,
  layer: LayerFrame,
  ...props: string[]
): void {
  for (const event of events) {
    if (timeMs >= event.startMs && timeMs <= event.endMs) {
      const duration = event.endMs - event.startMs;
      const progress = duration > 0 ? (timeMs - event.startMs) / duration : 0;
      const t = event.easing === 'ease-in-out' ? easeInOutCubic(progress) : progress;

      if (event.type === 'move' && props.includes('x') && props.includes('y')) {
        layer.x = interpolate(layer.x, event.payload.toX, t, event.easing);
        layer.y = interpolate(layer.y, event.payload.toY, t, event.easing);
      } else if (event.type === 'scale' && props.includes('scaleX') && props.includes('scaleY')) {
        layer.scaleX = interpolate(layer.scaleX, event.payload.toScaleX, t, event.easing);
        layer.scaleY = interpolate(layer.scaleY, event.payload.toScaleY, t, event.easing);
      } else if (event.type === 'opacity' && props.includes('opacity')) {
        layer.opacity = interpolate(layer.opacity, event.payload.toOpacity, t, event.easing);
      }
    }
  }
}

function applyDiscreteEvent(
  events: TimelineEvent[],
  timeMs: number,
  layer: LayerFrame,
  prop: 'expressionAssetId' | 'flipX' | 'visible',
  project?: Project
): void {
  // Find the most recent event at or before timeMs
  // Sort by startMs descending, then order descending
  const applicable = events
    .filter(e => timeMs >= e.startMs)
    .sort((a, b) => {
      if (a.startMs !== b.startMs) return b.startMs - a.startMs;
      return b.order - a.order;
    });

  const latest = applicable[0];
  if (!latest) return;

  if (latest.type === 'expression' && prop === 'expressionAssetId' && project) {
    const char = project.characters.find(c => c.id === layer.characterId);
    if (char) {
      layer.expressionAssetId = char.expressions[latest.payload.expression] || layer.expressionAssetId;
      layer.assetId = layer.expressionAssetId;
    }
  } else if (latest.type === 'flip' && prop === 'flipX') {
    layer.flipX = latest.payload.flipX;
  } else if (latest.type === 'visibility' && prop === 'visible') {
    layer.visible = latest.payload.visible;
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
