import { evaluateFlaGraphicFrame } from '../../shared/fla-graphic-playback';
import { resolveAnimationPlaybackFrameState } from '../evaluate-shot-at-time';
import { reconstructFlaGraphicStructure } from '../models/flaGraphicStructure';
import type { AnimationFrame, ProjectAnimationDefinition } from '../models/animation';
import { isTalkingAnimationPlaybackInRange, resolveConfiguredAnimationFrameIndex, resolveFlaGraphicPreviewTimeline } from './animationSourceTimeline';
import { evaluateFlaGraphicVisual } from '../evaluate-fla-graphic';
import { isFlaGraphicDefinition, type Character, type CharacterFaceSource, type MouthPoseSource, type Project, type TalkingAnimationPlayback } from '../models';

type ResolvedFace = {
  width: number;
  height: number;
  assetId?: string;
  flaGraphic?: NonNullable<ReturnType<typeof evaluateFlaGraphicVisual>>;
  rasterFrame?: AnimationFrame;
};

export function findTalkingAnimation(project: Project, animationId: string | undefined): ProjectAnimationDefinition | undefined {
  if (!animationId) return undefined;
  return project.animations.find((animation) => animation.id === animationId);
}

export function isCharacterTalkingSourceAvailable(project: Project, animationId: string, playback?: TalkingAnimationPlayback): boolean {
  const animation = findTalkingAnimation(project, animationId);
  return !!animation && animation.frames.length > 0 && (!playback || isTalkingAnimationPlaybackInRange(animation, playback));
}

export function listCharacterTalkingSources(character: Character) {
  return [
    ...Object.values(character.expressionTalkingSources ?? {}),
    ...(character.talkingAnimationId ? [{
      animationId: character.talkingAnimationId, playback: character.talkingAnimationPlayback,
    }] : []),
  ];
}

export function resolveCharacterTalkingFace(
  project: Project, character: Character, expressionId: string | undefined,
  elapsedMs: number | 'rest' | undefined, isImageUnavailable?: (id: string) => boolean,
): ReturnType<typeof resolveTalkingAnimationFace> {
  const dedicated = expressionId ? character.expressionTalkingSources?.[expressionId] : undefined;
  if (dedicated && isCharacterTalkingSourceAvailable(project, dedicated.animationId, dedicated.playback)) {
    const face = resolveTalkingAnimationFace(project, dedicated.animationId, elapsedMs, dedicated.playback, isImageUnavailable);
    if (face) return face;
  }
  return resolveTalkingAnimationFace(project, character.talkingAnimationId, elapsedMs, character.talkingAnimationPlayback, isImageUnavailable);
}

export function resolveTalkingAnimationFace(
  project: Project,
  animationId: string | undefined,
  elapsedMs: number | 'rest' | undefined,
  playback?: TalkingAnimationPlayback,
  isImageUnavailable?: (assetId: string) => boolean,
): { source: CharacterFaceSource; asset: ResolvedFace } | null {
  if (elapsedMs === undefined || !animationId) return null;
  const definition = findTalkingAnimation(project, animationId);
  if (!definition) return null;
  const sample = (() => {
    if (!playback) {
      if (elapsedMs === 'rest') return null;
      const state = resolveAnimationPlaybackFrameState(definition, 0, 0, { mode: 'loop', endBehavior: 'hold' }, elapsedMs);
      return state ? { frameOrdinal: state.frame.ordinal, internalTimeMs: state.internalTimeMs } : null;
    }
    const timeline = resolveFlaGraphicPreviewTimeline(definition, true);
    const index = elapsedMs === 'rest'
      ? playback.restFrame
      : resolveConfiguredAnimationFrameIndex(playback, timeline.totalFrames, Math.floor(elapsedMs * timeline.fps / 1_000));
    return index === undefined ? null : timeline.sampleAtFrameIndex(index);
  })();
  if (!sample) return null;
  const frame = definition.frames[sample.frameOrdinal];
  if (!frame) return null;
  // Even a Graphic with one stored drawing can contain a nested animation.
  const internalTimeMs = sample.internalTimeMs ?? 1_000 * frame.ordinal / definition.source.sourceFps;
  const { width, height } = definition.source.canvas;
  const isUnavailable = (id: string): boolean =>
    !project.assets.some((asset) => asset.id === id && asset.kind === 'image') ||
    Boolean(isImageUnavailable?.(id));
  if (isFlaGraphicDefinition(definition)) {
    const flaGraphic = evaluateFlaGraphicVisual({
      definition, frameOrdinal: frame.ordinal, mode: 'instance', internalTimeMs,
    });
    if (!flaGraphic || flaGraphic.resourceAssetIds.some(isUnavailable)) return null;
    return {
      source: { kind: 'fla-graphic', animationId, firstFrame: frame.ordinal },
      asset: { width, height, flaGraphic, ...(flaGraphic.structureFrame ? {} : { assetId: flaGraphic.frameAssetId }) },
    };
  }
  if (isUnavailable(frame.assetId)) return null;
  return {
    source: { kind: 'image', assetId: frame.assetId },
    asset: { width, height, assetId: frame.assetId, rasterFrame: frame },
  };
}

const talkingAnimationImageIds = new WeakMap<ProjectAnimationDefinition, ReadonlySet<string>>();

export function listTalkingAnimationImageIds(definition: ProjectAnimationDefinition): ReadonlySet<string> {
  const cached = talkingAnimationImageIds.get(definition);
  if (cached) return cached;
  const ids = new Set<string>();
  const structure = isFlaGraphicDefinition(definition) ? definition.structure : undefined;
  for (const frame of definition.frames) {
    if (!structure?.frames.some((candidate) => candidate.ordinal === frame.ordinal)) ids.add(frame.assetId);
  }
  if (structure) {
    for (const frame of structure.frames) {
      for (const { node } of reconstructFlaGraphicStructure(structure, frame.ordinal)) {
        if (node.type === 'bitmap' && node.assetId) ids.add(node.assetId);
        if (node.type === 'opaque' && node.fallbackAssetId && node.fallbackScope && node.fallbackViewBox) {
          ids.add(node.fallbackAssetId);
        }
      }
    }
  }
  talkingAnimationImageIds.set(definition, ids);
  return ids;
}

/** Thin source adapter. Graphic timing, structure and fallback remain owned by P0. */
export function resolveCharacterFaceSource(project: Project, source: MouthPoseSource): ResolvedFace {
  if (source.kind === 'image') {
    const asset = project.assets.find(candidate => candidate.id === source.assetId && candidate.kind === 'image');
    if (!asset || asset.kind !== 'image') throw new Error(`Unknown face image: ${source.assetId}`);
    return { width: asset.width, height: asset.height, assetId: asset.id, flaGraphic: undefined };
  }
  const definition = project.animations.find(candidate => candidate.id === source.animationId);
  if (!definition || !isFlaGraphicDefinition(definition) || source.firstFrame >= definition.frames.length) {
    throw new Error(`Invalid face Graphic frame: ${source.animationId}/${source.firstFrame}`);
  }
  const selected = evaluateFlaGraphicFrame('single frame', source.firstFrame, undefined, definition.frames.length, 0);
  if (!selected.ok) throw new Error(selected.message);
  const frame = definition.frames[selected.frameIndex]!;
  const flaGraphic = evaluateFlaGraphicVisual({
    definition, frameOrdinal: frame.ordinal, mode: 'instance', internalTimeMs: source.internalTimeMs,
  });
  if (!flaGraphic) throw new Error(`Missing Graphic frame: ${frame.ordinal}`);
  return {
    width: flaGraphic.canvas.width, height: flaGraphic.canvas.height,
    assetId: flaGraphic.structureFrame ? undefined : flaGraphic.frameAssetId,
    flaGraphic,
  };
}

/** Non-throwing variant so missing/broken Expression resources degrade locally. */
export function resolveCharacterFaceSourceOrNull(
  project: Project,
  source: MouthPoseSource,
): ReturnType<typeof resolveCharacterFaceSource> | null {
  try {
    return resolveCharacterFaceSource(project, source);
  } catch {
    return null;
  }
}
