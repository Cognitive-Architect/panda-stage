import { invertAffineMatrix, type AffineMatrix2D } from '../shared/affine-matrix';
import {
  captureCharacterPartAnimationBasis,
  composeAnimatedCharacterPartTransform,
  resolveLayeredCharacterPartTransforms,
} from './character-part-animation';
import { evaluateFlaGraphicVisual, type EvaluatedFlaGraphicNode } from './evaluate-fla-graphic';
import type { EvaluatedLayer } from './evaluate-shot-at-time';
import {
  isFlaGraphicDefinition,
  type FlaGraphicStructure,
  type FlaGraphicStructureNode,
  type Layer,
  type LayerAttachmentTarget,
  type Project,
} from './models';
import { resolveFlaGraphicStableNodeIdentity } from './models/flaGraphicTimeline';

export function layerAttachmentTargetKey(target: LayerAttachmentTarget): string {
  if (target.kind === 'character-part') return 'part:' + target.partId;
  if (target.identityPath?.length) return 'graphic-id:' + JSON.stringify(target.identityPath);
  return 'graphic-path:' + JSON.stringify(target.nodePath ?? []);
}

interface GraphicIdentityContainer {
  readonly ownerKind: 'frame' | 'symbol';
  readonly ownerSymbolDefId: string | null;
  readonly containerRootNodes: readonly FlaGraphicStructureNode[];
}

interface EvaluatedGraphicCandidate {
  readonly node: EvaluatedFlaGraphicNode;
  readonly identityPath: readonly string[];
}

function* collectEvaluatedGraphicIdentities(
  nodes: readonly EvaluatedFlaGraphicNode[],
  structure: FlaGraphicStructure,
  container: GraphicIdentityContainer,
  ancestorIdentityPath: readonly string[],
): Iterable<EvaluatedGraphicCandidate> {
  for (const node of nodes) {
    // Extracted shape overrides are frame-local synthetic siblings, not structure nodes.
    if (node.extractedFromNodePath || !node.renderable) continue;
    const stableId = resolveFlaGraphicStableNodeIdentity(
      node.source,
      structure,
      container.ownerKind,
      container.ownerSymbolDefId,
      container.containerRootNodes,
    );
    if (stableId) {
      yield { node, identityPath: [...ancestorIdentityPath, stableId] };
    }
    if (node.source.type === 'group') {
      yield* collectEvaluatedGraphicIdentities(
        node.children,
        structure,
        container,
        ancestorIdentityPath,
      );
    } else if (node.source.type === 'symbol') {
      const nestedDefId = node.source.nestedDefinitionId;
      if (nestedDefId) {
        const nestedDef = structure.symbolDefinitions?.[nestedDefId];
        // Crossing into a shared Symbol definition requires a verifiable occurrence identity.
        if (!nestedDef || !stableId) continue;
        yield* collectEvaluatedGraphicIdentities(
          node.children,
          structure,
          {
            ownerKind: 'symbol',
            ownerSymbolDefId: nestedDefId,
            containerRootNodes: nestedDef.children,
          },
          [...ancestorIdentityPath, stableId],
        );
      } else {
        yield* collectEvaluatedGraphicIdentities(
          node.children,
          structure,
          container,
          ancestorIdentityPath,
        );
      }
    }
  }
}

function collectFrameStructureIdentityCounts(
  nodes: readonly FlaGraphicStructureNode[],
  structure: FlaGraphicStructure,
  container: GraphicIdentityContainer,
  ancestorIdentityPath: readonly string[],
  counts: Map<string, number>,
): void {
  for (const node of nodes) {
    const stableId = resolveFlaGraphicStableNodeIdentity(
      node,
      structure,
      container.ownerKind,
      container.ownerSymbolDefId,
      container.containerRootNodes,
    );
    if (stableId) {
      const key = JSON.stringify([...ancestorIdentityPath, stableId]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (node.type === 'group') {
      collectFrameStructureIdentityCounts(node.children, structure, container, ancestorIdentityPath, counts);
    } else if (node.type === 'symbol') {
      const nestedDefId = node.nestedDefinitionId;
      if (nestedDefId) {
        const nestedDef = structure.symbolDefinitions?.[nestedDefId];
        if (!nestedDef || !stableId) continue;
        collectFrameStructureIdentityCounts(
          nestedDef.children,
          structure,
          {
            ownerKind: 'symbol',
            ownerSymbolDefId: nestedDefId,
            containerRootNodes: nestedDef.children,
          },
          [...ancestorIdentityPath, stableId],
          counts,
        );
      } else if (node.children) {
        collectFrameStructureIdentityCounts(node.children, structure, container, ancestorIdentityPath, counts);
      }
    }
  }
}

function resolveLegacyNodePathInFrame(
  structure: FlaGraphicStructure,
  frameNodes: readonly FlaGraphicStructureNode[],
  nodePath: readonly string[],
): { readonly found: boolean; readonly identityPath: readonly string[] | null } {
  if (nodePath.length === 0) return { found: false, identityPath: null };
  let ownerKind: 'frame' | 'symbol' = 'frame';
  let ownerSymbolDefId: string | null = null;
  let containerRootNodes: readonly FlaGraphicStructureNode[] = frameNodes;
  let searchNodes: readonly FlaGraphicStructureNode[] = frameNodes;
  const ancestorIdentityPath: string[] = [];

  for (let i = 0; i < nodePath.length; i += 1) {
    const nodeId = nodePath[i]!;
    const node = searchNodes.find((candidate) => candidate.id === nodeId);
    if (!node) return { found: false, identityPath: null };
    const stableId = resolveFlaGraphicStableNodeIdentity(
      node,
      structure,
      ownerKind,
      ownerSymbolDefId,
      containerRootNodes,
    );
    if (i === nodePath.length - 1) {
      if (!stableId) return { found: true, identityPath: null };
      const candidatePath = [...ancestorIdentityPath, stableId];
      const counts = new Map<string, number>();
      collectFrameStructureIdentityCounts(
        frameNodes,
        structure,
        { ownerKind: 'frame', ownerSymbolDefId: null, containerRootNodes: frameNodes },
        [],
        counts,
      );
      return {
        found: true,
        identityPath: counts.get(JSON.stringify(candidatePath)) === 1 ? candidatePath : null,
      };
    }
    if (node.type === 'group') {
      searchNodes = node.children;
    } else if (node.type === 'symbol') {
      if (node.nestedDefinitionId) {
        const def = structure.symbolDefinitions?.[node.nestedDefinitionId];
        if (!def || !stableId) return { found: true, identityPath: null };
        ancestorIdentityPath.push(stableId);
        ownerKind = 'symbol';
        ownerSymbolDefId = node.nestedDefinitionId;
        containerRootNodes = def.children;
        searchNodes = def.children;
      } else {
        searchNodes = node.children ?? [];
      }
    } else {
      return { found: false, identityPath: null };
    }
  }
  return { found: false, identityPath: null };
}

/**
 * Proves a stable cross-frame identity chain for a legacy v44 `nodePath`
 * against the owning Graphic Definition's structure. Returns `null` when
 * missing, unprovable (opaque / temporary multi-frame node), or ambiguous.
 */
export function resolveLegacyGraphicAttachmentIdentityPath(
  structure: FlaGraphicStructure,
  nodePath: readonly string[],
): readonly string[] | null {
  let proven: readonly string[] | null = null;
  let provenKey: string | null = null;
  for (const frame of structure.frames) {
    const frameNodes = frame.layers.flatMap((layer) => layer.nodes);
    const result = resolveLegacyNodePathInFrame(structure, frameNodes, nodePath);
    if (!result.found) continue;
    if (!result.identityPath) return null;
    const key = JSON.stringify(result.identityPath);
    if (provenKey !== null && provenKey !== key) return null;
    proven = result.identityPath;
    provenKey = key;
  }
  return proven;
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
  if (!graphic?.layers || !graphic.structureFrame) return [];
  const frameRootNodes = graphic.structureFrame.layers.flatMap((entry) => entry.nodes);
  const rootContainer: GraphicIdentityContainer = {
    ownerKind: 'frame',
    ownerSymbolDefId: null,
    containerRootNodes: frameRootNodes,
  };
  const candidates = graphic.layers.flatMap(({ nodes }) => [
    ...collectEvaluatedGraphicIdentities(nodes, definition.structure!, rootContainer, []),
  ]);
  const identityCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate.identityPath);
    identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  return candidates.flatMap(({ node, identityPath }) => {
    if (identityCounts.get(JSON.stringify(identityPath)) !== 1) return [];
    const transform = {
      ...node.worldTransform,
      tx: node.worldTransform.tx - graphic.canvas.width / 2,
      ty: node.worldTransform.ty - graphic.canvas.height / 2,
    };
    return invertAffineMatrix(transform) ? [{
      target: { kind: 'graphic-node' as const, identityPath: [...identityPath] },
      label: node.displayName ?? node.path.join(' / '),
      transform,
    }] : [];
  });
}

export type LayerAttachmentTargetLookup = ReadonlyMap<string, AffineMatrix2D>;

/**
 * Builds a per-invocation owner-local target lookup for one specific owner Layer
 * instance. Failures are isolated locally so each attached child can fall back
 * to its own `ownerLocalFallback` without affecting other owners.
 */
export function buildLayerAttachmentTargetLookup(
  project: Project,
  owner: Layer,
  evaluated: EvaluatedLayer,
): LayerAttachmentTargetLookup {
  const lookup = new Map<string, AffineMatrix2D>();
  try {
    for (const item of resolveLayerAttachmentTargets(project, owner, evaluated)) {
      const key = layerAttachmentTargetKey(item.target);
      if (!lookup.has(key)) lookup.set(key, item.transform);
    }
  } catch {
    // A damaged or temporarily unavailable owner falls back locally per child.
  }
  return lookup;
}

export function resolveLayerAttachmentLocalMatrix(
  project: Project,
  owner: Layer,
  evaluated: EvaluatedLayer,
  target: LayerAttachmentTarget,
  targetLookup?: LayerAttachmentTargetLookup | (() => LayerAttachmentTargetLookup),
): AffineMatrix2D | undefined {
  try {
    let resolvedTarget: LayerAttachmentTarget = target;
    if (target.kind === 'graphic-node' && !target.identityPath?.length) {
      if (!target.nodePath?.length || owner.source.kind !== 'animation') return undefined;
      const animationId = owner.source.animationId;
      const definition = project.animations.find(({ id }) => id === animationId);
      if (!definition || !isFlaGraphicDefinition(definition) || !definition.structure) return undefined;
      const proven = resolveLegacyGraphicAttachmentIdentityPath(definition.structure, target.nodePath);
      if (!proven) return undefined;
      resolvedTarget = { kind: 'graphic-node', identityPath: [...proven] };
    }
    const key = layerAttachmentTargetKey(resolvedTarget);
    if (targetLookup) {
      const lookup = typeof targetLookup === 'function' ? targetLookup() : targetLookup;
      return lookup.get(key);
    }
    return resolveLayerAttachmentTargets(project, owner, evaluated)
      .find((item) => layerAttachmentTargetKey(item.target) === key)?.transform;
  } catch {
    // A damaged or temporarily unavailable target can still follow the owner.
    return undefined;
  }
}
