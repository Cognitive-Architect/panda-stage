import {
  evaluateFlaGraphicVisual,
  type EvaluatedFlaGraphicNode,
} from '../evaluate-fla-graphic';
import {
  measureFlaGraphicSubtreeBounds,
  selectFlaGraphicSubtreeVisual,
  type FlaGraphicAssetDimensionLike,
} from '../fla-graphic-subtree';
import {
  DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT,
  isFlaGraphicDefinition,
  flaGraphicInstanceNodePathKey,
  type CharacterPart,
  type CharacterPartTransform,
  type FlaGraphicDefinition,
  type FlaGraphicInstanceTransformOverrides,
  type FlaGraphicStructureNode,
  type Project,
} from '../models';
import type { CreateAdaptivePartsCharacterInput } from './CharacterService';

const IDENTITY_TRANSFORM: Readonly<CharacterPartTransform> = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

export interface FlaGraphicSubtreeCandidateAssessment {
  readonly nodePath: readonly string[];
  readonly found: boolean;
  readonly extractable: boolean;
  readonly renderable: boolean;
  readonly nodeType: FlaGraphicStructureNode['type'] | null;
  readonly label: string;
  readonly drawOrderRank: number;
  readonly reason?: string;
  readonly warning?: string;
  readonly leafCount: number;
  readonly resourceAssetIds: readonly string[];
  readonly hasFrameCrop: boolean;
  readonly hasUnrenderableDescendants: boolean;
}

export interface FlaGraphicSubtreeSelectionInput {
  readonly nodePath: readonly string[];
  readonly label?: string;
}

export interface BuildAdaptivePartsFromFlaGraphicSubtreesInput {
  readonly project: Pick<Project, 'assets' | 'characters'>;
  readonly definition: FlaGraphicDefinition;
  readonly frameOrdinal: number;
  readonly selections: readonly FlaGraphicSubtreeSelectionInput[];
  readonly instanceTransformOverrides?: FlaGraphicInstanceTransformOverrides;
  readonly characterName?: string;
  readonly createId?: () => string;
}

export function flaGraphicNodePathsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isPrefixNodePath(
  prefix: readonly string[],
  candidate: readonly string[],
): boolean {
  if (prefix.length > candidate.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] !== candidate[index]) return false;
  }
  return true;
}

/**
 * Returns true if the two nodePaths identify the same node or one is an
 * ancestor of the other (meaning extracting both would duplicate artwork).
 */
export function doFlaGraphicNodePathsOverlap(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return isPrefixNodePath(left, right) || isPrefixNodePath(right, left);
}

/**
 * Clones only the sparse instance overrides at `frameOrdinal` along the
 * ancestor/self/descendant chain of `nodePath` so Part extraction preserves the
 * previewed subtree pose without polluting sibling Parts or shared Definitions.
 */
export function filterFlaGraphicInstanceOverridesForSubtree(
  overrides: FlaGraphicInstanceTransformOverrides | undefined,
  frameOrdinal: number,
  nodePath: readonly string[],
): FlaGraphicInstanceTransformOverrides | undefined {
  if (!overrides || nodePath.length === 0) return undefined;
  const frameKey = String(frameOrdinal);
  const frameOverrides = overrides[frameKey];
  if (!frameOverrides) return undefined;

  const filteredFrame: Record<
    string,
    { a: number; b: number; c: number; d: number; tx: number; ty: number }
  > = {};
  let retainedCount = 0;

  for (const [pathKey, matrix] of Object.entries(frameOverrides)) {
    let parsedPath: unknown;
    try {
      parsedPath = JSON.parse(pathKey);
    } catch {
      continue;
    }
    if (
      !Array.isArray(parsedPath) ||
      parsedPath.length === 0 ||
      !parsedPath.every((entry): entry is string => typeof entry === 'string')
    ) {
      continue;
    }
    if (
      isPrefixNodePath(parsedPath, nodePath) ||
      isPrefixNodePath(nodePath, parsedPath)
    ) {
      filteredFrame[flaGraphicInstanceNodePathKey(parsedPath)] = { ...matrix };
      retainedCount += 1;
    }
  }

  return retainedCount > 0 ? { [frameKey]: filteredFrame } : undefined;
}

function defaultLabelForNode(
  node: FlaGraphicStructureNode,
  fallbackId: string,
): string {
  switch (node.type) {
    case 'symbol':
      return node.symbolRef.trim() || fallbackId;
    case 'group':
      return node.groupId?.trim() || '编组';
    case 'bitmap':
      return node.bitmapRef.trim() || '位图';
    case 'opaque':
      return node.opaqueKind === 'shape' ? '图形' : node.opaqueKind;
  }
}

function sortedChildrenByDrawOrder(
  nodes: readonly EvaluatedFlaGraphicNode[],
): EvaluatedFlaGraphicNode[] {
  return [...nodes].sort((left, right) => left.source.drawOrder - right.source.drawOrder);
}

function findNodeAndRank(
  layers: readonly { readonly nodes: readonly EvaluatedFlaGraphicNode[] }[],
  targetPath: readonly string[],
): { node: EvaluatedFlaGraphicNode; rank: number } | null {
  let rankCounter = 0;
  let found: { node: EvaluatedFlaGraphicNode; rank: number } | null = null;

  const walk = (nodes: readonly EvaluatedFlaGraphicNode[]): boolean => {
    for (const node of sortedChildrenByDrawOrder(nodes)) {
      const currentRank = rankCounter;
      rankCounter += 1;
      if (flaGraphicNodePathsEqual(node.path, targetPath)) {
        found = { node, rank: currentRank };
        return true;
      }
      if (node.children.length > 0 && walk(node.children)) {
        return true;
      }
    }
    return false;
  };

  for (const layer of layers) {
    if (walk(layer.nodes)) break;
  }
  return found;
}

function summarizeSubtreeLeaves(root: EvaluatedFlaGraphicNode): {
  leafCount: number;
  renderableLeafCount: number;
  hasFrameCrop: boolean;
  hasUnrenderableDescendants: boolean;
} {
  let leafCount = 0;
  let renderableLeafCount = 0;
  let hasFrameCrop = false;
  let hasUnrenderableDescendants = false;

  const walk = (node: EvaluatedFlaGraphicNode): void => {
    if (node.source.type === 'bitmap') {
      leafCount += 1;
      if (node.renderable && node.source.assetId) {
        renderableLeafCount += 1;
      } else {
        hasUnrenderableDescendants = true;
      }
      return;
    }
    if (node.source.type === 'opaque') {
      leafCount += 1;
      if (node.renderable && node.source.fallbackAssetId) {
        renderableLeafCount += 1;
        if (node.source.fallbackScope === 'frame-crop') {
          hasFrameCrop = true;
        }
      } else {
        hasUnrenderableDescendants = true;
      }
      return;
    }
    if (!node.renderable) {
      hasUnrenderableDescendants = true;
    }
    for (const child of node.children) {
      walk(child);
    }
  };

  walk(root);
  return {
    leafCount,
    renderableLeafCount,
    hasFrameCrop,
    hasUnrenderableDescendants,
  };
}

/**
 * Assesses whether `nodePath` in `definition` at `frameOrdinal` can be safely
 * extracted as an independent `AdaptiveParts` `CharacterPart`, returning
 * draw-order rank, warnings, and exact rejection reasons when unextractable.
 */
export function assessFlaGraphicSubtreeCandidate(input: {
  readonly definition: FlaGraphicDefinition;
  readonly frameOrdinal: number;
  readonly nodePath: readonly string[];
  readonly instanceTransformOverrides?: FlaGraphicInstanceTransformOverrides;
  readonly assets?: readonly FlaGraphicAssetDimensionLike[];
}): FlaGraphicSubtreeCandidateAssessment {
  const fallbackLabel = input.nodePath.at(-1) ?? '零件';
  if (
    input.nodePath.length === 0 ||
    !isFlaGraphicDefinition(input.definition) ||
    !input.definition.structure
  ) {
    return {
      nodePath: [...input.nodePath],
      found: false,
      extractable: false,
      renderable: false,
      nodeType: null,
      label: fallbackLabel,
      drawOrderRank: -1,
      reason: '当前 Graphic 缺少可提取的结构数据。',
      leafCount: 0,
      resourceAssetIds: [],
      hasFrameCrop: false,
      hasUnrenderableDescendants: false,
    };
  }

  const evaluated = evaluateFlaGraphicVisual({
    definition: input.definition,
    frameOrdinal: input.frameOrdinal,
    mode: 'instance',
    instanceTransformOverrides: input.instanceTransformOverrides,
  });
  if (!evaluated || !evaluated.structureFrame || !evaluated.layers) {
    return {
      nodePath: [...input.nodePath],
      found: false,
      extractable: false,
      renderable: false,
      nodeType: null,
      label: fallbackLabel,
      drawOrderRank: -1,
      reason: '当前帧尚未包含可提取的结构层。',
      leafCount: 0,
      resourceAssetIds: [],
      hasFrameCrop: false,
      hasUnrenderableDescendants: false,
    };
  }

  const match = findNodeAndRank(evaluated.layers, input.nodePath);
  if (!match) {
    return {
      nodePath: [...input.nodePath],
      found: false,
      extractable: false,
      renderable: false,
      nodeType: null,
      label: fallbackLabel,
      drawOrderRank: -1,
      reason: '所选节点在当前帧结构中不存在。',
      leafCount: 0,
      resourceAssetIds: [],
      hasFrameCrop: false,
      hasUnrenderableDescendants: false,
    };
  }

  const { node, rank } = match;
  const label = defaultLabelForNode(node.source, fallbackLabel);
  const leafSummary = summarizeSubtreeLeaves(node);
  const subtreeVisual = selectFlaGraphicSubtreeVisual(evaluated, input.nodePath);
  const tightBounds = measureFlaGraphicSubtreeBounds(subtreeVisual, input.assets);

  if (leafSummary.renderableLeafCount === 0 || !tightBounds) {
    return {
      nodePath: [...input.nodePath],
      found: true,
      extractable: false,
      renderable: false,
      nodeType: node.source.type,
      label,
      drawOrderRank: rank,
      reason: '该节点下没有可单独渲染的矢量或位图内容。',
      leafCount: leafSummary.leafCount,
      resourceAssetIds: subtreeVisual.resourceAssetIds,
      hasFrameCrop: leafSummary.hasFrameCrop,
      hasUnrenderableDescendants: leafSummary.hasUnrenderableDescendants,
    };
  }

  const warning = leafSummary.hasFrameCrop
    ? '包含按整帧裁切回退的节点，独立变换边缘可能带有原画裁切区域。'
    : leafSummary.hasUnrenderableDescendants
      ? '包含不支持独立提取的子节点，创建零件时会跳过这些子节点。'
      : undefined;

  return {
    nodePath: [...input.nodePath],
    found: true,
    extractable: true,
    renderable: true,
    nodeType: node.source.type,
    label,
    drawOrderRank: rank,
    ...(warning ? { warning } : {}),
    leafCount: leafSummary.leafCount,
    resourceAssetIds: subtreeVisual.resourceAssetIds,
    hasFrameCrop: leafSummary.hasFrameCrop,
    hasUnrenderableDescendants: leafSummary.hasUnrenderableDescendants,
  };
}

function sanitizeDisplayName(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  const base = trimmed.length > 0 ? trimmed : fallback;
  return base.slice(0, 200);
}

function uniqueCharacterName(
  desiredBase: string,
  existingNames: readonly string[],
): string {
  const trimmed = desiredBase.trim().slice(0, 180) || '拆件角色';
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  if (!taken.has(trimmed.toLowerCase())) return trimmed;
  let suffix = 2;
  while (taken.has(`${trimmed} (${suffix})`.toLowerCase())) {
    suffix += 1;
  }
  return `${trimmed} (${suffix})`.slice(0, 200);
}

/**
 * Converts explicitly chosen Graphic subtree nodes from one source frame into a
 * single `CreateAdaptivePartsCharacterInput` sorted back-to-front by authored
 * draw order, cloning any local overrides per Part.
 */
export function buildAdaptivePartsFromFlaGraphicSubtrees(
  input: BuildAdaptivePartsFromFlaGraphicSubtreesInput,
): CreateAdaptivePartsCharacterInput {
  if (input.selections.length === 0) {
    throw new Error('At least one Graphic subtree selection is required to create Adaptive Parts.');
  }

  const assessed = input.selections.map((selection, index) => {
    for (let prior = 0; prior < index; prior += 1) {
      if (
        doFlaGraphicNodePathsOverlap(
          input.selections[prior]!.nodePath,
          selection.nodePath,
        )
      ) {
        throw new Error('Selected Graphic subtrees must not overlap or contain each other.');
      }
    }
    const candidate = assessFlaGraphicSubtreeCandidate({
      definition: input.definition,
      frameOrdinal: input.frameOrdinal,
      nodePath: selection.nodePath,
      instanceTransformOverrides: input.instanceTransformOverrides,
      assets: input.project.assets,
    });
    if (!candidate.extractable || !candidate.renderable) {
      throw new Error(
        candidate.reason ?? `Graphic subtree cannot be extracted: ${selection.nodePath.join(' > ')}`,
      );
    }
    return {
      selection,
      candidate,
      inputIndex: index,
    };
  });

  assessed.sort((left, right) => {
    if (left.candidate.drawOrderRank !== right.candidate.drawOrderRank) {
      return left.candidate.drawOrderRank - right.candidate.drawOrderRank;
    }
    return left.inputIndex - right.inputIndex;
  });

  const nextId = input.createId ?? (() => crypto.randomUUID());
  const usedDisplayNames = new Map<string, number>();

  const parts: CharacterPart[] = assessed.map(({ selection, candidate }, drawOrder) => {
    const partId = nextId();
    const rawLabel = sanitizeDisplayName(
      selection.label ?? candidate.label,
      `零件 ${drawOrder + 1}`,
    );
    const key = rawLabel.toLowerCase();
    const seen = usedDisplayNames.get(key) ?? 0;
    usedDisplayNames.set(key, seen + 1);
    const displayName =
      seen === 0
        ? rawLabel
        : sanitizeDisplayName(`${rawLabel.slice(0, 190)} (${seen + 1})`, `零件 ${drawOrder + 1}`);

    const filteredOverrides = filterFlaGraphicInstanceOverridesForSubtree(
      input.instanceTransformOverrides,
      input.frameOrdinal,
      selection.nodePath,
    );

    return {
      partId,
      source: {
        kind: 'source-instance',
        sourceId: `fla-subtree:${partId}`,
        sourcePoseFrame: input.frameOrdinal,
        effectiveFrame: input.frameOrdinal,
      },
      visualSource: {
        kind: 'fla-graphic',
        animationId: input.definition.id,
        nodePath: [...selection.nodePath],
        poseFrameOrdinal: input.frameOrdinal,
        ...(filteredOverrides ? { instanceTransformOverrides: filteredOverrides } : {}),
      },
      sourceRestTransform: { ...IDENTITY_TRANSFORM },
      restTransform: { ...IDENTITY_TRANSFORM },
      staticAdjustment: { ...DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT },
      drawOrder,
      visible: true,
      displayName,
    };
  });

  const name = uniqueCharacterName(
    input.characterName ?? `${input.definition.name} 拆件`,
    input.project.characters.map((character) => character.name),
  );

  return {
    name,
    sourceRootTransform: { ...IDENTITY_TRANSFORM },
    defaultScale: 1,
    defaultFlipX: false,
    parts,
  };
}
