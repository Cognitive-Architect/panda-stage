import type { Layer, Project } from '../../../domain';
import { resolveCharacterView } from '../characters/characterView';

/** Compatibility read adapter for the existing v1 authoring lane. */
export function characterMotionParts(project: Project, layer: Layer | undefined) {
  return resolveCharacterView(project, layer)?.nodes.flatMap((node) =>
    node.motion === 'character-clip-v1' ? [{ partId: node.partId, name: node.name }] : [],
  ) ?? [];
}
