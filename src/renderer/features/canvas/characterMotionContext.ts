import type { Layer, Project } from '../../../domain';
import { localizeDefaultAdaptivePartName } from '../characters/characterPartDisplayName';

/** One read-only label mapping for Canvas context, Inspector and Timeline. */
export function characterMotionParts(project: Project, layer: Layer | undefined) {
  if (layer?.source.kind !== 'character') return [];
  const characterId = layer.source.characterId;
  const character = project.characters.find(c => c.id === characterId);
  if (character?.mode !== 'adaptive-parts') return [];
  const clip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
  const parts = clip?.targetBases.map(b => ({ partId: b.target.partId, displayName: b.displayName })) ?? character.parts;
  return parts.map((part, index) => ({
    partId: part.partId,
    name: part.displayName?.trim() ? localizeDefaultAdaptivePartName(part.displayName) : `部件 ${index + 1}`,
  }));
}
