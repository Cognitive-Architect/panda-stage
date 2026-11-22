import { evaluateFlaGraphicFrame } from '../../shared/fla-graphic-playback';
import { resolveAnimationPlaybackFrameState } from '../evaluate-shot-at-time';
import { reconstructFlaGraphicStructure } from '../models/flaGraphicStructure';
import type { AnimationFrame, ProjectAnimationDefinition } from '../models/animation';
import { evaluateFlaGraphicVisual } from '../evaluate-fla-graphic';
import { isFlaGraphicDefinition, type CharacterFaceSource, type Project } from '../models';

type ResolvedFace = {
  width: number;
  height: number;
  assetId?: string;
  flaGraphic?: NonNullable<ReturnType<typeof evaluateFlaGraphicVisual>>;
  rasterFrame?: AnimationFrame;
};

export function resolveTalkingAnimationFace(
  project: Project,
  animationId: string | undefined,
  elapsedMs: number | undefined,
  isImageUnavailable?: (assetId: string) => boolean,
): { source: CharacterFaceSource; asset: ResolvedFace } | null {
  if (elapsedMs === undefined || !animationId) return null;
  const definition = project.animations.find((candidate) => candidate.id === animationId);
  if (!definition) return null;
  const state = resolveAnimationPlaybackFrameState(definition, 0, 0, { mode: 'loop', endBehavior: 'hold' }, elapsedMs);
  if (!state) return null;
  const { frame, internalTimeMs } = state;
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
export function resolveCharacterFaceSource(project: Project, source: CharacterFaceSource): ResolvedFace {
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
  const flaGraphic = evaluateFlaGraphicVisual({ definition, frameOrdinal: frame.ordinal, mode: 'instance' });
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
  source: CharacterFaceSource,
): ReturnType<typeof resolveCharacterFaceSource> | null {
  try {
    return resolveCharacterFaceSource(project, source);
  } catch {
    return null;
  }
}
