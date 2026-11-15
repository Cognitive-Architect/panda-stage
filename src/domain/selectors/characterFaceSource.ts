import { evaluateFlaGraphicFrame } from '../../shared/fla-graphic-playback';
import { evaluateFlaGraphicVisual } from '../evaluate-fla-graphic';
import { isFlaGraphicDefinition, type CharacterFaceSource, type Project } from '../models';

/** Thin source adapter. Graphic timing, structure and fallback remain owned by P0. */
export function resolveCharacterFaceSource(project: Project, source: CharacterFaceSource) {
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
