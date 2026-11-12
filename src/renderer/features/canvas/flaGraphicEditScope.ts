import type {
  FlaGraphicDefinition,
  FlaGraphicStructureFrame,
  FlaGraphicStructureNode,
  ImageAsset,
  Project,
  Shot,
} from '../../../domain';
import type { AffineMatrix2D } from '../../../shared/affine-matrix';

export type FlaGraphicEditDrafts = Readonly<
  Record<string, Readonly<Record<string, AffineMatrix2D>>>
>;

export interface FlaGraphicEditTarget {
  readonly key: string;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly projectInstanceId: number;
  readonly shotId: string;
  readonly layerId: string;
  readonly animation: FlaGraphicDefinition;
  readonly frameOrdinal: number;
  readonly frame: FlaGraphicStructureFrame;
}

export interface FlaGraphicEditScopeState {
  readonly targetKey: string;
  readonly frameOrdinal: number;
  readonly path: readonly string[];
}

/** Returns the parent scope, or null when the current scope is the instance root. */
export function parentFlaGraphicEditScopePath(
  path: readonly string[],
): readonly string[] | null {
  return path.length === 0 ? null : path.slice(0, -1);
}

export function recordFlaGraphicEditDraft(
  drafts: FlaGraphicEditDrafts,
  targetKey: string,
  path: readonly string[],
  matrix: AffineMatrix2D,
): FlaGraphicEditDrafts {
  const nodeKey = flaGraphicNodePathKey(path);
  return {
    ...drafts,
    [targetKey]: {
      ...drafts[targetKey],
      [nodeKey]: matrix,
    },
  };
}

export function retainValidFlaGraphicEditDrafts(
  drafts: FlaGraphicEditDrafts,
  validTargetKeys: ReadonlySet<string>,
): FlaGraphicEditDrafts {
  const entries = Object.entries(drafts).filter(([key]) => validTargetKeys.has(key));
  return entries.length === Object.keys(drafts).length
    ? drafts
    : Object.fromEntries(entries);
}

function structureIdentity(definition: FlaGraphicDefinition): string {
  const structureText = JSON.stringify(definition.structure) ?? '';
  // Two independent 32-bit streams keep the transient target key compact while
  // including every persisted node, transform, fallback reference, and frame.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < structureText.length; index += 1) {
    const code = structureText.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${structureText.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

export function resolveFlaGraphicEditTarget(input: {
  readonly project: Project | null;
  readonly projectRoot: string | null;
  readonly projectInstanceId: number | null;
  readonly shot: Shot | null;
  readonly layerId: string | null;
}): FlaGraphicEditTarget | null {
  const { project, projectRoot, projectInstanceId, shot, layerId } = input;
  if (!project || !projectRoot || projectInstanceId === null || !shot || !layerId) {
    return null;
  }
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.source.kind !== 'animation') return null;
  const animationId = layer.source.animationId;
  const animation = project.animations.find((candidate) => candidate.id === animationId);
  if (
    !animation ||
    !('kind' in animation) ||
    animation.kind !== 'fla-graphic' ||
    !animation.structure
  ) return null;
  const frame = animation.structure.frames.find((candidate) => candidate.ordinal === 0);
  if (!frame) return null;
  const key = JSON.stringify([
    projectInstanceId,
    project.id,
    projectRoot,
    shot.id,
    layer.id,
    layer.source.flaOccurrence?.occurrenceId ?? null,
    layer.source.flaOccurrence?.sourceAddress ?? null,
    layer.source.flaOccurrence?.adapterIdentity ?? null,
    animation.id,
    frame.ordinal,
    animation.source.sha256,
    animation.source.targetName,
    animation.source.anchor,
    animation.source.canvas,
    animation.frames.map((candidate) => [
      candidate.ordinal,
      candidate.assetId,
      candidate.sha256,
      candidate.sourceViewport,
    ]),
    structureIdentity(animation),
  ]);
  return {
    key,
    projectId: project.id,
    projectRoot,
    projectInstanceId,
    shotId: shot.id,
    layerId: layer.id,
    animation,
    frameOrdinal: frame.ordinal,
    frame,
  };
}

export function getFlaGraphicScopeNodes(
  frame: FlaGraphicStructureFrame,
  path: readonly string[],
): readonly FlaGraphicStructureNode[] {
  if (path.length === 0) {
    return frame.layers.flatMap((layer) =>
      [...layer.nodes].sort((left, right) => left.drawOrder - right.drawOrder),
    );
  }
  const parent = getFlaGraphicNodeAtPath(frame, path);
  if (parent?.type !== 'group' && parent?.type !== 'symbol') return [];
  return [...parent.children].sort((left, right) => left.drawOrder - right.drawOrder);
}

export function getFlaGraphicNodeAtPath(
  frame: FlaGraphicStructureFrame,
  path: readonly string[],
): FlaGraphicStructureNode | null {
  if (path.length === 0) return null;
  let nodes: readonly FlaGraphicStructureNode[] = frame.layers.flatMap(
    (layer) => layer.nodes,
  );
  let current: FlaGraphicStructureNode | undefined;
  for (const nodeId of path) {
    current = nodes.find((node) => node.id === nodeId);
    if (!current) return null;
    nodes = current.type === 'group' || current.type === 'symbol'
      ? current.children
      : [];
  }
  return current ?? null;
}

export function flaGraphicNodePathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

export function isFlaGraphicNodeEnterable(
  node: FlaGraphicStructureNode,
): node is Extract<FlaGraphicStructureNode, { type: 'group' | 'symbol' }> {
  return (node.type === 'group' || node.type === 'symbol') && node.children.length > 0;
}

export function collectFlaGraphicStructureAssetIds(
  frame: FlaGraphicStructureFrame,
): string[] {
  const assetIds = new Set<string>();
  const visit = (nodes: readonly FlaGraphicStructureNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'bitmap' && node.assetId) assetIds.add(node.assetId);
      if (node.type === 'opaque' && node.fallbackAssetId && node.fallbackViewBox && node.fallbackScope) {
        assetIds.add(node.fallbackAssetId);
      }
      if (node.type === 'group' || node.type === 'symbol') visit(node.children);
    }
  };
  for (const layer of frame.layers) visit(layer.nodes);
  return [...assetIds];
}

export function flaGraphicNodeCanSelect(
  node: FlaGraphicStructureNode,
): boolean {
  return node.type !== 'opaque' || Boolean(
    node.fallbackAssetId && node.fallbackScope && node.fallbackViewBox,
  );
}

export function flaGraphicNodeCanTransform(
  node: FlaGraphicStructureNode,
): boolean {
  return node.type !== 'opaque';
}

export function flaGraphicNodeHasReadyVisual(
  node: FlaGraphicStructureNode,
  images: ReadonlyMap<string, HTMLImageElement>,
  assets: ReadonlyMap<string, Pick<ImageAsset, 'width' | 'height'>>,
): boolean {
  if (node.type === 'bitmap') {
    return Boolean(node.assetId && images.has(node.assetId) && assets.has(node.assetId));
  }
  if (node.type === 'opaque') {
    return Boolean(
      node.fallbackAssetId &&
        node.fallbackScope &&
        node.fallbackViewBox &&
        images.has(node.fallbackAssetId) &&
        assets.has(node.fallbackAssetId),
    );
  }
  return node.children.some((child) => flaGraphicNodeHasReadyVisual(child, images, assets));
}
