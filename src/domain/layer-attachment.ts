import { invertAffineMatrix, type AffineMatrix2D } from '../shared/affine-matrix';
import {
  captureCharacterPartAnimationBasis,
  composeAnimatedCharacterPartTransform,
  resolveLayeredCharacterPartTransforms,
} from './character-part-animation';
import { evaluateFlaGraphicVisual, type EvaluatedFlaGraphicNode } from './evaluate-fla-graphic';
import type { EvaluatedLayer } from './evaluate-shot-at-time';
import { isFlaGraphicDefinition, type Layer, type LayerAttachmentTarget, type Project } from './models';

export function layerAttachmentTargetKey(target: LayerAttachmentTarget): string {
  return target.kind === 'character-part' ? 'part:' + target.partId : 'node:' + JSON.stringify(target.nodePath);
}

function* structuredNodes(nodes: readonly EvaluatedFlaGraphicNode[]): Iterable<EvaluatedFlaGraphicNode> {
  for (const node of nodes) {
    if (node.renderable) yield node;
    yield* structuredNodes(node.children);
  }
}

interface AvailableAttachment {
  target: LayerAttachmentTarget;
  label: string;
  transform: AffineMatrix2D;
}

/** Exact owner-local poses, independent of loaded image resources and viewport projection. */
export function resolveLayerAttachmentTargets(
  project: Project,
  layer: Layer,
  evaluated: EvaluatedLayer,
): AvailableAttachment[] {
  const source = layer.source;
  if (source.kind === 'character' && !evaluated.characterAction) {
    const character = project.characters.find(({ id }) => id === source.characterId);
    if (character?.mode !== 'adaptive-parts') return [];
    const clip = layer.animationClip?.version === 1
      ? layer.animationClip : captureCharacterPartAnimationBasis(project, character, layer.id);
    const values = evaluated.animationValues ?? [];
    const layered = evaluated.layeredCharacterAction
      ? resolveLayeredCharacterPartTransforms(clip, character, values, evaluated.layeredCharacterAction)
      : undefined;
    return clip.targetBases.flatMap((basis) => {
      const partId = basis.target.partId;
      const pose = layered?.get(partId) ?? composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, values);
      const head = character.headMotionBinding?.partIds.includes(partId) ? evaluated.headGroupTransform : undefined;
      const transform = head ? {
        ...pose,
        tx: pose.tx + head.translateX,
        ty: pose.ty + head.translateY,
      } : pose;
      return invertAffineMatrix(transform) ? [{
        target: { kind: 'character-part', partId },
        label: basis.displayName ?? partId,
        transform,
      }] : [];
    });
  }
  if (source.kind !== 'animation' || !evaluated.animationFrame) return [];
  const definition = project.animations.find(({ id }) => id === source.animationId);
  if (!definition || !isFlaGraphicDefinition(definition) || !definition.structure) return [];
  const graphic = evaluateFlaGraphicVisual({
    definition,
    frameOrdinal: evaluated.animationFrame.frameOrdinal,
    internalTimeMs: evaluated.animationFrame.internalTimeMs,
    mode: 'instance',
    instanceShapeOverrides: layer.flaGraphicInstanceShapeOverrides,
    instanceTextOverrides: layer.flaGraphicInstanceTextOverrides,
    instanceTransformOverrides: layer.flaGraphicInstanceTransformOverrides,
  });
  if (!graphic?.layers) return [];
  return graphic.layers.flatMap(({ nodes }) => [...structuredNodes(nodes)].flatMap((node) => {
    const transform = {
      ...node.worldTransform,
      tx: node.worldTransform.tx - graphic.canvas.width / 2,
      ty: node.worldTransform.ty - graphic.canvas.height / 2,
    };
    return invertAffineMatrix(transform) ? [{
      target: { kind: 'graphic-node' as const, nodePath: [...node.path] },
      label: node.displayName ?? node.path.join(' / '),
      transform,
    }] : [];
  }));
}

export function resolveLayerAttachmentLocalMatrix(
  project: Project,
  owner: Layer,
  evaluated: EvaluatedLayer,
  target: LayerAttachmentTarget,
): AffineMatrix2D | undefined {
  try {
    const key = layerAttachmentTargetKey(target);
    return resolveLayerAttachmentTargets(project, owner, evaluated)
      .find((item) => layerAttachmentTargetKey(item.target) === key)?.transform;
  } catch {
    // A damaged or temporarily unavailable target can still follow the owner.
    return undefined;
  }
}
