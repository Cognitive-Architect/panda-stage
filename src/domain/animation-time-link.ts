import {
  LayerAnimationTimeLinkSchema,
  ProjectSchema,
  type CharacterActionEvent,
  type Layer,
  type LayerAnimationTimeLink,
  type Project,
  type Shot,
} from './models';
import {
  isValidFrameTime,
  isValidSignedFrameTime,
  signedFrameOffsetMs,
  TIMELINE_FPS,
} from './timeline/frame-grid';

export type ResolvedLayerAnimationTimeLink =
  | { readonly status: 'none' }
  | {
      readonly status: 'active';
      readonly link: LayerAnimationTimeLink;
      readonly offsetMs: number;
      readonly sourceStartMs: number;
      readonly sourceEndMs: number;
      readonly startMs: number;
      readonly endMs: number;
      readonly visibleStartMs: number;
      readonly visibleEndMs: number;
      readonly outOfShotBounds: boolean;
      readonly sourceLayer: Layer;
      readonly event: CharacterActionEvent;
    }
  | {
      readonly status: 'broken';
      readonly link: LayerAnimationTimeLink;
    };

export interface AvailableCharacterActionLink {
  readonly key: string;
  readonly link: LayerAnimationTimeLink;
  readonly sourceLayerId: string;
  readonly sourceLayerName: string;
  readonly eventId: string;
  readonly actionId: string;
  readonly actionName: string;
  readonly startMs: number;
  readonly endMs: number;
}

export function animationTimeLinkKey(link: LayerAnimationTimeLink): string {
  return `${link.sourceLayerId}:${link.eventId}`;
}

function formatLinkSeconds(ms: number): string {
  return String(Number((ms / 1_000).toFixed(2)));
}

export function formatAnimationTimeLinkWindow(
  startMs: number,
  endMs: number,
): string {
  return `${formatLinkSeconds(startMs)}–${formatLinkSeconds(endMs)}s`;
}

export function formatAnimationTimeLinkOffset(offsetMs: number): string {
  if (!Number.isFinite(offsetMs) || offsetMs === 0) return '0ms';
  const rounded = Math.round(offsetMs);
  return rounded > 0 ? `+${rounded}ms` : `${rounded}ms`;
}

function shiftAnimationTimeLinkWindow(
  sourceStartMs: number,
  sourceEndMs: number,
  offsetMs: number,
): { readonly startMs: number; readonly endMs: number } {
  if (offsetMs === 0) {
    return { startMs: sourceStartMs, endMs: sourceEndMs };
  }
  if (isValidFrameTime(sourceStartMs) && isValidSignedFrameTime(offsetMs)) {
    const offsetFrames = Math.round((offsetMs * TIMELINE_FPS) / 1_000);
    const startFrame =
      Math.round((sourceStartMs * TIMELINE_FPS) / 1_000) + offsetFrames;
    const startMs = signedFrameOffsetMs(startFrame);
    if (isValidFrameTime(sourceEndMs)) {
      const endFrame =
        Math.round((sourceEndMs * TIMELINE_FPS) / 1_000) + offsetFrames;
      return { startMs, endMs: signedFrameOffsetMs(endFrame) };
    }
    return { startMs, endMs: startMs + (sourceEndMs - sourceStartMs) };
  }
  return {
    startMs: sourceStartMs + offsetMs,
    endMs: sourceEndMs + offsetMs,
  };
}

/**
 * Resolves an animation layer's optional character-action time link against
 * the current Shot state. Never throws on deleted/missing targets: broken links
 * return `{ status: 'broken', link }` so evaluation can fall back to the
 * layer's independent startTimeMs and UI can offer repair or unlink.
 *
 * When `link.offsetMs` is set, author-frame-aligned inputs shift by exact
 * frame indices (preserving frame span without integer rounding drift), while
 * arbitrary millisecond offsets shift `[s, e)` to `[s + offsetMs, e + offsetMs)`
 * directly. Crossing the Shot boundaries clips only `visibleStartMs`/`visibleEndMs`;
 * completely out-of-bounds shifted windows remain `status: 'active'` with
 * `outOfShotBounds: true` (never misclassified as broken).
 */
export function resolveLayerAnimationTimeLink(
  shot: Shot,
  layer: Layer,
): ResolvedLayerAnimationTimeLink {
  if (layer.source.kind !== 'animation' || !layer.animationTimeLink) {
    return { status: 'none' };
  }
  const link = layer.animationTimeLink;
  const sourceLayer = shot.layers.find(
    (candidate) =>
      candidate.id === link.sourceLayerId &&
      candidate.source.kind === 'character',
  );
  if (!sourceLayer) {
    return { status: 'broken', link };
  }
  const event = shot.timelineEvents.find(
    (candidate): candidate is CharacterActionEvent =>
      candidate.type === 'character-action' &&
      candidate.id === link.eventId &&
      candidate.layerId === link.sourceLayerId,
  );
  if (!event || event.endMs <= event.startMs) {
    return { status: 'broken', link };
  }
  const offsetMs = link.offsetMs ?? 0;
  const { startMs, endMs } = shiftAnimationTimeLinkWindow(
    event.startMs,
    event.endMs,
    offsetMs,
  );
  const visibleStartMs = Math.max(0, startMs);
  const visibleEndMs = Math.min(shot.durationMs, endMs);
  return {
    status: 'active',
    link,
    offsetMs,
    sourceStartMs: event.startMs,
    sourceEndMs: event.endMs,
    startMs,
    endMs,
    visibleStartMs,
    visibleEndMs,
    outOfShotBounds: visibleStartMs >= visibleEndMs,
    sourceLayer,
    event,
  };
}

/**
 * Lists every character-action event instance in `shot` as a concrete link
 * target, distinguishing multiple occurrences of the same action by event ID
 * and time window.
 */
export function listAvailableCharacterActionLinks(
  project: Project,
  shot: Shot,
): AvailableCharacterActionLink[] {
  const characterLayersById = new Map<string, Layer>();
  for (const layer of shot.layers) {
    if (layer.source.kind === 'character') {
      characterLayersById.set(layer.id, layer);
    }
  }
  const results: AvailableCharacterActionLink[] = [];
  for (const event of shot.timelineEvents) {
    if (event.type !== 'character-action' || event.endMs <= event.startMs) {
      continue;
    }
    const sourceLayer = characterLayersById.get(event.layerId);
    if (!sourceLayer || sourceLayer.source.kind !== 'character') {
      continue;
    }
    const characterId = sourceLayer.source.characterId;
    const character = project.characters.find(
      (candidate) => candidate.id === characterId,
    );
    const action = character?.actions?.find(
      (candidate) => candidate.id === event.actionId,
    );
    const link: LayerAnimationTimeLink = {
      kind: 'character-action',
      sourceLayerId: sourceLayer.id,
      eventId: event.id,
    };
    results.push({
      key: animationTimeLinkKey(link),
      link,
      sourceLayerId: sourceLayer.id,
      sourceLayerName: sourceLayer.name,
      eventId: event.id,
      actionId: event.actionId,
      actionName: action?.name ?? '角色动作',
      startMs: event.startMs,
      endMs: event.endMs,
    });
  }
  return results.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.sourceLayerName.localeCompare(right.sourceLayerName) ||
      left.eventId.localeCompare(right.eventId),
  );
}

/**
 * Pure project editor that sets or clears `layer.animationTimeLink` on an
 * animation layer while preserving its original independent `startTimeMs` and
 * playback settings for unlinking or broken-link fallback.
 */
export function setLayerAnimationTimeLink(
  project: Project,
  shotId: string,
  layerId: string,
  link: LayerAnimationTimeLink | undefined,
): Project {
  const shotIndex = project.shots.findIndex((candidate) => candidate.id === shotId);
  if (shotIndex < 0) {
    throw new Error(`找不到镜头：${shotId}`);
  }
  const shot = project.shots[shotIndex]!;
  const layerIndex = shot.layers.findIndex((candidate) => candidate.id === layerId);
  if (layerIndex < 0) {
    throw new Error(`找不到图层：${layerId}`);
  }
  const layer = shot.layers[layerIndex]!;
  if (layer.source.kind !== 'animation') {
    throw new Error('只有动画图层支持跟随角色动作时间联动。');
  }
  if (layer.locked) {
    throw new Error('动画图层已锁定，无法修改时间联动。');
  }

  let validatedLink: LayerAnimationTimeLink | undefined;
  if (link !== undefined) {
    validatedLink = LayerAnimationTimeLinkSchema.parse(link);
    const sourceLayer = shot.layers.find(
      (candidate) =>
        candidate.id === validatedLink!.sourceLayerId &&
        candidate.source.kind === 'character',
    );
    const targetEvent = shot.timelineEvents.find(
      (candidate) =>
        candidate.type === 'character-action' &&
        candidate.id === validatedLink!.eventId &&
        candidate.layerId === validatedLink!.sourceLayerId &&
        candidate.endMs > candidate.startMs,
    );
    if (!sourceLayer || !targetEvent) {
      throw new Error('目标角色动作事件不存在，无法建立时间联动。');
    }
  }

  const nextLayer: Layer = { ...layer };
  if (validatedLink) {
    const normalizedOffset = validatedLink.offsetMs;
    nextLayer.animationTimeLink =
      normalizedOffset !== undefined && normalizedOffset !== 0
        ? {
            kind: validatedLink.kind,
            sourceLayerId: validatedLink.sourceLayerId,
            eventId: validatedLink.eventId,
            offsetMs: normalizedOffset,
          }
        : {
            kind: validatedLink.kind,
            sourceLayerId: validatedLink.sourceLayerId,
            eventId: validatedLink.eventId,
          };
  } else {
    delete nextLayer.animationTimeLink;
  }

  const nextLayers = [...shot.layers];
  nextLayers[layerIndex] = nextLayer;
  const nextShots = [...project.shots];
  nextShots[shotIndex] = { ...shot, layers: nextLayers };

  return ProjectSchema.parse({
    ...project,
    shots: nextShots,
  });
}
