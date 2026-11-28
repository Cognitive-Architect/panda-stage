import {
  decomposeSvgToEditableShapeRegions,
  findFlaExtractedShapeRegionByPath,
  isFlaGraphicEditableSubtreeShapeNode,
  isFlaGraphicNodeTransformable,
  resolveFlaGraphicSymbolChildren,
  type FlaEditableShapeRegion,
  type FlaGraphicDefinition,
  type FlaGraphicShapeNodeOverride,
  type FlaGraphicShapeOverrides,
  type FlaGraphicStructure,
  type FlaGraphicStructureFrame,
  type FlaGraphicStructureNode,
  type ImageAsset,
  type Layer,
  type Project,
  type Shot,
} from '../../../domain';
import type { AffineMatrix2D } from '../../../shared/affine-matrix';

export type FlaGraphicEditDrafts = Readonly<
  Record<string, Readonly<Record<string, AffineMatrix2D>>>
>;

export type FlaGraphicEditMode = 'instance' | 'definition';

export interface FlaGraphicEditTarget {
  readonly key: string;
  readonly sessionKey: string;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly projectInstanceId: number;
  readonly shotId: string;
  readonly layerId: string;
  readonly layer: Layer;
  readonly animation: FlaGraphicDefinition;
  readonly frameOrdinal: number;
  readonly frame: FlaGraphicStructureFrame;
}

export interface FlaGraphicEditScopeState {
  readonly targetKey: string;
  readonly sessionKey?: string;
  readonly editMode: FlaGraphicEditMode;
  readonly frameOrdinal: number;
  readonly path: readonly string[];
}

/** Returns the parent scope, or null when the current scope is the instance root. */
export function parentFlaGraphicEditScopePath(
  path: readonly string[],
): readonly string[] | null {
  return path.length === 0 ? null : path.slice(0, -1);
}

export interface FlaGraphicExitScopeTransition {
  readonly nextScopePath: readonly string[] | null;
  readonly nextSelectedNodePath: readonly string[] | null;
}

/**
 * Computes the next scope path and selection continuity when exiting one level
 * of FLA Graphic edit scope: popping to a parent scope re-selects the exited
 * Group/Symbol if it is still selectable; popping from the root scope exits
 * edit mode.
 */
export function resolveFlaGraphicExitScopeTransition(
  frame: FlaGraphicStructureFrame,
  currentScopePath: readonly string[],
  structure?: Pick<FlaGraphicStructure, 'symbolDefinitions'> | null,
): FlaGraphicExitScopeTransition {
  const parentPath = parentFlaGraphicEditScopePath(currentScopePath);
  if (!parentPath) {
    return { nextScopePath: null, nextSelectedNodePath: null };
  }
  const exitedNode = getFlaGraphicNodeAtPath(frame, currentScopePath, structure);
  const nextSelectedNodePath = exitedNode && flaGraphicNodeCanSelect(exitedNode)
    ? [...currentScopePath]
    : null;
  return { nextScopePath: parentPath, nextSelectedNodePath };
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

export function clearFlaGraphicEditDraft(
  drafts: FlaGraphicEditDrafts,
  targetKey: string,
  path: readonly string[],
): FlaGraphicEditDrafts {
  const nodeKey = flaGraphicNodePathKey(path);
  const targetDraft = drafts[targetKey];
  if (!targetDraft || !(nodeKey in targetDraft)) return drafts;
  const nextTargetDraft = { ...targetDraft };
  delete nextTargetDraft[nodeKey];
  const next = { ...drafts };
  if (Object.keys(nextTargetDraft).length === 0) delete next[targetKey];
  else next[targetKey] = nextTargetDraft;
  return next;
}

export function clearFlaGraphicEditTargetDrafts(
  drafts: FlaGraphicEditDrafts,
  targetKey: string,
): FlaGraphicEditDrafts {
  if (!(targetKey in drafts)) return drafts;
  const next = { ...drafts };
  delete next[targetKey];
  return next;
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
  const sessionParts = [
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
  ];
  const sessionKey = JSON.stringify(sessionParts);
  const key = JSON.stringify([
    ...sessionParts,
    structureIdentity(animation),
  ]);
  return {
    key,
    sessionKey,
    projectId: project.id,
    projectRoot,
    projectInstanceId,
    shotId: shot.id,
    layerId: layer.id,
    layer,
    animation,
    frameOrdinal: frame.ordinal,
    frame,
  };
}

export function getFlaGraphicScopeNodes(
  frame: FlaGraphicStructureFrame,
  path: readonly string[],
  structure?: Pick<FlaGraphicStructure, 'symbolDefinitions'> | null,
): readonly FlaGraphicStructureNode[] {
  if (path.length === 0) {
    return frame.layers.flatMap((layer) =>
      [...layer.nodes].sort((left, right) => left.drawOrder - right.drawOrder),
    );
  }
  const parent = getFlaGraphicNodeAtPath(frame, path, structure);
  if (parent?.type === 'group') {
    return [...parent.children].sort((left, right) => left.drawOrder - right.drawOrder);
  }
  if (parent?.type === 'symbol') {
    return [...resolveFlaGraphicSymbolChildren(parent, structure)].sort(
      (left, right) => left.drawOrder - right.drawOrder,
    );
  }
  return [];
}

export function getFlaGraphicNodeAtPath(
  frame: FlaGraphicStructureFrame,
  path: readonly string[],
  structure?: Pick<FlaGraphicStructure, 'symbolDefinitions'> | null,
  shapeOverrides?: {
    readonly shared?: FlaGraphicShapeOverrides;
    readonly instance?: FlaGraphicShapeOverrides;
  },
): FlaGraphicStructureNode | null {
  if (path.length === 0) return null;
  let nodes: readonly FlaGraphicStructureNode[] = frame.layers.flatMap(
    (layer) => layer.nodes,
  );
  let current: FlaGraphicStructureNode | undefined;
  for (const nodeId of path) {
    current = nodes.find((node) => node.id === nodeId);
    if (!current) {
      current = undefined;
      break;
    }
    nodes = current.type === 'group'
      ? current.children
      : current.type === 'symbol'
        ? resolveFlaGraphicSymbolChildren(current, structure)
        : [];
  }
  if (current) return current;
  if (!shapeOverrides) return null;
  const frameKey = String(frame.ordinal);
  const extracted =
    findFlaExtractedShapeRegionByPath(
      shapeOverrides.instance?.[frameKey],
      path,
    ) ??
    findFlaExtractedShapeRegionByPath(
      shapeOverrides.shared?.[frameKey],
      path,
    );
  if (!extracted) return null;
  const ownerNode = getFlaGraphicNodeAtPath(frame, extracted.ownerPath, structure);
  return {
    id: extracted.entry.id,
    type: 'opaque',
    drawOrder: ownerNode?.drawOrder ?? 0,
    localTransform: extracted.entry.localTransform,
    opaqueKind: 'shape',
    fallbackScope: 'subtree',
    ...(ownerNode?.type === 'opaque' && ownerNode.sourceRef
      ? { sourceRef: ownerNode.sourceRef }
      : {}),
    ...(ownerNode?.type === 'opaque' && ownerNode.fallbackAssetId
      ? { fallbackAssetId: ownerNode.fallbackAssetId }
      : {}),
    fallbackViewBox: {
      x: extracted.entry.baseViewBox.x,
      y: extracted.entry.baseViewBox.y,
      width: Math.max(1e-6, extracted.entry.baseViewBox.width),
      height: Math.max(1e-6, extracted.entry.baseViewBox.height),
    },
  };
}

export function flaGraphicNodePathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

export function isFlaGraphicNodeEnterable(
  node: FlaGraphicStructureNode,
  structure?: Pick<FlaGraphicStructure, 'symbolDefinitions'> | null,
): node is Extract<FlaGraphicStructureNode, { type: 'group' | 'symbol' }> {
  if (node.type === 'group') return node.children.length > 0;
  if (node.type === 'symbol') return resolveFlaGraphicSymbolChildren(node, structure).length > 0;
  return false;
}

export function collectFlaGraphicStructureAssetIds(
  frame: FlaGraphicStructureFrame,
  structure?: Pick<FlaGraphicStructure, 'symbolDefinitions'> | null,
): string[] {
  const assetIds = new Set<string>();
  const visit = (nodes: readonly FlaGraphicStructureNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'bitmap' && node.assetId) assetIds.add(node.assetId);
      if (node.type === 'opaque' && node.fallbackAssetId && node.fallbackViewBox && node.fallbackScope) {
        assetIds.add(node.fallbackAssetId);
      }
      if (node.type === 'group') visit(node.children);
      else if (node.type === 'symbol') visit(resolveFlaGraphicSymbolChildren(node, structure));
    }
  };
  for (const layer of frame.layers) visit(layer.nodes);
  return [...assetIds];
}

export function flaGraphicNodeCanSelect(
  node: FlaGraphicStructureNode,
): boolean {
  return node.type !== 'opaque' || Boolean(
    (node.fallbackAssetId && node.fallbackScope && node.fallbackViewBox) ||
    // Authored-native Shapes own editable vector regions instead of a fallback asset.
    (node.authored === 'native' && node.opaqueKind === 'shape' && node.fallbackViewBox),
  );
}

export function flaGraphicNodeCanTransform(
  node: FlaGraphicStructureNode,
): boolean {
  return isFlaGraphicNodeTransformable(node);
}

export function flaGraphicNodeHasReadyVisual(
  node: FlaGraphicStructureNode,
  images: ReadonlyMap<string, HTMLImageElement>,
  assets: ReadonlyMap<string, Pick<ImageAsset, 'width' | 'height'>>,
  structure?: Pick<FlaGraphicStructure, 'symbolDefinitions'> | null,
): boolean {
  if (node.type === 'bitmap') {
    return Boolean(node.assetId && images.has(node.assetId) && assets.has(node.assetId));
  }
  if (node.type === 'opaque') {
    // Authored-native Shapes render from editable vector regions, not from a
    // fallback SVG asset, so their content is ready without one.
    if (node.authored === 'native') return Boolean(node.fallbackViewBox);
    return Boolean(
      node.fallbackAssetId &&
        node.fallbackScope &&
        node.fallbackViewBox &&
        images.has(node.fallbackAssetId) &&
        assets.has(node.fallbackAssetId),
    );
  }
  const children = node.type === 'group'
    ? node.children
    : resolveFlaGraphicSymbolChildren(node, structure);
  return children.some((child) => flaGraphicNodeHasReadyVisual(child, images, assets, structure));
}

/** Resolves effective per-frame Shape overrides respecting instance vs definition edit mode. */
export function resolveEffectiveFlaShapeFrameOverrides(
  definition: FlaGraphicDefinition,
  layer: Layer,
  frameOrdinal: number,
  editMode: FlaGraphicEditMode,
): Readonly<Record<string, FlaGraphicShapeNodeOverride>> | undefined {
  const frameKey = String(frameOrdinal);
  const shared = definition.flaGraphicSharedShapeOverrides?.[frameKey];
  if (editMode === 'definition') return shared;
  const instance = layer.flaGraphicInstanceShapeOverrides?.[frameKey];
  if (!shared) return instance;
  if (!instance) return shared;
  return { ...shared, ...instance };
}

export interface FlaGraphicNodeShapeEditInfo {
  readonly node: FlaGraphicStructureNode;
  readonly isExtractedSibling: boolean;
  readonly regions: readonly FlaEditableShapeRegion[];
  readonly activeRegion: FlaEditableShapeRegion | null;
  readonly hasUnrenderableResidue: boolean;
  readonly ambiguousRegionRefs: ReadonlySet<string>;
  readonly bitmapFillRegionRefs: ReadonlySet<string>;
}

/** Resolves decomposed/overridden regions for an editable subtree Shape or extracted sibling. */
export function resolveFlaGraphicNodeShapeInfo(input: {
  readonly target: FlaGraphicEditTarget;
  readonly editMode: FlaGraphicEditMode;
  readonly path: readonly string[];
  readonly regionRef: string | null;
  readonly svgText?: string;
}): FlaGraphicNodeShapeEditInfo | null {
  const { target, editMode, path, regionRef, svgText } = input;
  const node = getFlaGraphicNodeAtPath(
    target.frame,
    path,
    target.animation.structure,
    {
      shared: target.animation.flaGraphicSharedShapeOverrides,
      instance:
        editMode === 'definition'
          ? undefined
          : target.layer.flaGraphicInstanceShapeOverrides,
    },
  );
  if (!node || !isFlaGraphicEditableSubtreeShapeNode(node)) return null;

  const frameOverrides = resolveEffectiveFlaShapeFrameOverrides(
    target.animation,
    target.layer,
    target.frameOrdinal,
    editMode,
  );
  const extracted = findFlaExtractedShapeRegionByPath(frameOverrides, path);
  if (extracted) {
    return {
      node,
      isExtractedSibling: true,
      regions: [extracted.entry.region],
      activeRegion: extracted.entry.region,
      hasUnrenderableResidue: false,
      ambiguousRegionRefs: new Set(),
      bitmapFillRegionRefs: new Set(),
    };
  }

  const nodeOverride = frameOverrides?.[JSON.stringify(path)];
  if (nodeOverride) {
    const excluded = new Set(nodeOverride.excludedRegionRefs);
    const regions = nodeOverride.regions.filter((r) => !excluded.has(r.regionRef));
    const activeRegion =
      (regionRef
        ? regions.find((r) => r.regionRef === regionRef)
        : regions.length === 1
          ? regions[0]
          : undefined) ?? null;
    const hasUnrenderableResidue = Boolean(
      nodeOverride.hasUnrenderableResidue ||
        (nodeOverride.bitmapFillRegionRefs?.length ?? 0) > 0 ||
        nodeOverride.regions.some((r) => r.fill.kind === 'preserved'),
    );
    return {
      node,
      isExtractedSibling: false,
      regions,
      activeRegion,
      hasUnrenderableResidue,
      ambiguousRegionRefs: new Set(nodeOverride.ambiguousRegionRefs ?? []),
      bitmapFillRegionRefs: new Set(nodeOverride.bitmapFillRegionRefs ?? []),
    };
  }

  if (!svgText) {
    return {
      node,
      isExtractedSibling: false,
      regions: [],
      activeRegion: null,
      hasUnrenderableResidue: false,
      ambiguousRegionRefs: new Set(),
      bitmapFillRegionRefs: new Set(),
    };
  }

  const decomposed = decomposeSvgToEditableShapeRegions(svgText, {
    ...(node.sourceRef ? { sourceShapeRef: node.sourceRef } : {}),
    ...(node.fallbackViewBox ? { baseViewBox: node.fallbackViewBox } : {}),
  });
  const activeRegion =
    (regionRef
      ? decomposed.regions.find((r) => r.regionRef === regionRef)
      : decomposed.regions.length === 1
        ? decomposed.regions[0]
        : undefined) ?? null;
  return {
    node,
    isExtractedSibling: false,
    regions: decomposed.regions,
    activeRegion,
    hasUnrenderableResidue: decomposed.hasUnrenderableResidue,
    ambiguousRegionRefs: decomposed.ambiguousRegionRefs,
    bitmapFillRegionRefs: decomposed.bitmapFillRegionRefs,
  };
}
