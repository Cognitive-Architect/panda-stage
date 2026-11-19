import {
  characterNodeTransformCapabilities,
  type CharacterNodeTransformCapabilities,
  type Layer,
  type LayerVisualPart,
  type LayerVisualParts,
  type Project,
} from '../../../domain';
import { localizeDefaultAdaptivePartName } from './characterPartDisplayName';

export type CharacterNodeId = 'root' | 'body' | 'face' | 'head' | `part:${string}`;
export type AdaptiveCharacterNodeId = Extract<CharacterNodeId, `part:${string}`>;

type CharacterNodeSemantics =
  | { id: 'root'; role: 'root'; writeback: 'layer'; motion: 'layer' }
  | { id: 'body'; role: 'body'; writeback: 'composite-body-placement'; motion: null }
  | { id: 'face'; role: 'face'; writeback: 'composite-face-placement'; motion: 'character-clip-v3' }
  | { id: 'head'; role: 'head'; writeback: 'composite-head-placement'; motion: null }
  | { id: AdaptiveCharacterNodeId; role: 'part'; partId: string; writeback: 'adaptive-default-pose'; motion: 'character-clip-v1' };

export type CharacterNode = CharacterNodeSemantics & {
  readonly name: string;
  readonly capabilities: CharacterNodeTransformCapabilities;
};

export function isCharacterNodeMotionEditable(
  node: CharacterNode | null | undefined,
): node is Extract<CharacterNode, { motion: 'character-clip-v1' | 'character-clip-v3' }> {
  return node?.motion === 'character-clip-v1' || node?.motion === 'character-clip-v3';
}

export interface CharacterView {
  readonly characterId: string;
  readonly layerId: string;
  readonly nodes: readonly CharacterNode[];
  /** The existing resolved slots and active variant, if the caller has evaluated the frame. */
  readonly visual?: LayerVisualParts;
}

export function characterPartNodeId(partId: string): AdaptiveCharacterNodeId {
  return `part:${partId}`;
}

export function adaptivePartIdForNodeId(nodeId: CharacterNodeId | null): string | null {
  return nodeId?.startsWith('part:') ? nodeId.slice('part:'.length) : null;
}

export function resolveCharacterView(
  project: Project,
  layer: Layer | undefined,
  visual?: LayerVisualParts,
): CharacterView | null {
  if (layer?.source.kind !== 'character') return null;
  const { characterId } = layer.source;
  const character = project.characters.find((entry) => entry.id === characterId);
  if (!character) return null;

  let nodes: CharacterNode[];
  switch (character.mode) {
    case 'adaptive-parts': {
      // An authored v1 instance uses its frozen Part targets, as does its visual projection.
      const clip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
      const parts = clip?.targetBases.map((basis) => ({
        partId: basis.target.partId,
        displayName: basis.displayName,
      })) ?? character.parts;
      nodes = parts.map(({ partId, displayName }, index) => {
        const id = characterPartNodeId(partId);
        return {
          id,
          partId,
          name: localizeDefaultAdaptivePartName(displayName ?? '', index + 1),
          role: 'part',
          writeback: 'adaptive-default-pose',
          motion: 'character-clip-v1',
          capabilities: characterNodeTransformCapabilities(character, id),
        };
      });
      break;
    }
    case 'single-image':
    case 'composite':
      nodes = [{
        id: 'root',
        role: 'root',
        name: '角色整体',
        writeback: 'layer',
        motion: 'layer',
        capabilities: characterNodeTransformCapabilities(character, 'root'),
      }];
      if (character.mode === 'composite') {
        nodes.push(
          {
            id: 'body',
            role: 'body',
            name: '身体',
            writeback: 'composite-body-placement',
            motion: null,
            capabilities: characterNodeTransformCapabilities(character, 'body'),
          },
          {
            id: 'face',
            role: 'face',
            name: '脸部',
            writeback: 'composite-face-placement',
            motion: 'character-clip-v3',
            capabilities: characterNodeTransformCapabilities(character, 'face'),
          },
        );
        if (character.head) {
          nodes.push({
            id: 'head',
            role: 'head',
            name: '头部',
            writeback: 'composite-head-placement',
            motion: null,
            capabilities: characterNodeTransformCapabilities(character, 'head'),
          });
        }
      }
      break;
  }
  return { characterId, layerId: layer.id, nodes, visual };
}

/** Relates a rendered slot/variant to its semantic node without using its drawable ID. */
export function characterNodeForVisualPart(
  view: CharacterView | null | undefined,
  part: LayerVisualPart,
): CharacterNode | undefined {
  if (!view || view.layerId !== part.ownerLayerId) return undefined;
  const { source } = part;
  const id = source.kind === 'adaptive-part' || source.kind === 'adaptive-part-fla-graphic'
    ? characterPartNodeId(source.characterPartId)
    : part.slot === 'single' ? 'root' : part.slot;
  return view.nodes.find((node) => node.id === id);
}
