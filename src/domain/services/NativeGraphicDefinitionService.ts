import type { AffineMatrix2D } from '../../shared/affine-matrix';
import { multiplyAffineMatrices } from '../../shared/affine-matrix';
import { evaluateFlaGraphicVisual, type EvaluatedFlaGraphicNode } from '../evaluate-fla-graphic';
import {
  cloneFlaEditableShapeRegion,
  unionFlaShapeRegionBounds,
  type FlaEditableShapeRegion,
  type FlaEditableStroke,
  type FlaGraphicShapeNodeOverride,
  type FlaShapeBounds,
} from '../fla-shape-vector';
import {
  FLA_GRAPHIC_MAX_FRAMES,
  FlaGraphicDefinitionSchema,
  isFlaGraphicDefinition,
  isNativeFlaGraphicDefinition,
  ProjectSchema,
  resolveFlaGraphicStableNodeIdentity,
  type FlaGraphicDefinition,
  type Project,
} from '../models';
import {
  FlaGraphicStructureSchema,
  resolveFlaGraphicStructureFrame,
  type FlaGraphicStructure,
  type FlaGraphicStructureFrame,
  type FlaGraphicStructureLayer,
  type FlaGraphicStructureNode,
} from '../models/flaGraphicStructure';
import { scanAnimationDefinitionReferences, scanAssetReferences } from '../validators/referenceScanner';
import { LayerServiceError } from './LayerService';
import { doFlaGraphicNodePathsOverlap, flaGraphicNodePathsEqual } from './flaGraphicSubtreeParts';

/** Native Definitions follow the same common canvas/timing contract as source-backed ones. */
export const NATIVE_GRAPHIC_SOURCE_FPS = 24;
export const NATIVE_GRAPHIC_LAYER_NAME = '原生内容';
const NATIVE_GRAPHIC_DEFAULT_NAME = '原生元件';
const NAME_MAX_LENGTH = 200;


interface ResolvedVectorLeaf {
  readonly kind: 'vector';
  readonly label: string;
  readonly worldTransform: AffineMatrix2D;
  readonly baseViewBox: FlaShapeBounds;
  readonly regions: readonly FlaEditableShapeRegion[];
  readonly residueStrokes: readonly FlaEditableStroke[];
  readonly defsSvg?: string;
}

interface ResolvedBitmapLeaf {
  readonly kind: 'bitmap';
  readonly label: string;
  readonly worldTransform: AffineMatrix2D;
  readonly assetId: string;
  readonly assetName: string;
  readonly width: number;
  readonly height: number;
}

type ResolvedContentLeaf = ResolvedVectorLeaf | ResolvedBitmapLeaf;

export interface CreateNativeGraphicInput {
  /** Shot that owns the Layer instance the selection was made on. */
  readonly shotId: string;
  readonly layerId: string;
  /** Frame ordinal the source selection was resolved against. */
  readonly frameOrdinal: number;
  readonly nodePaths: readonly (readonly string[])[];
  readonly name?: string;
  readonly createId?: () => string;
}

export interface CreateNativeGraphicResult {
  readonly project: Project;
  readonly animationId: string;
  readonly name: string;
}

export interface DuplicateNativeGraphicInput {
  readonly animationId: string;
  readonly name?: string;
  readonly createId?: () => string;
}

export interface DeleteNativeGraphicInput {
  readonly animationId: string;
}

export interface ReleasedNativeGraphicAsset {
  readonly assetId: string;
  readonly name: string;
}

export interface DeleteNativeGraphicResult {
  readonly project: Project;
  /** Media that is no longer referenced anywhere after deletion (it is kept in the library). */
  readonly releasedAssets: readonly ReleasedNativeGraphicAsset[];
}

export interface NativeGraphicNodeTarget {
  readonly animationId: string;
  readonly frameOrdinal: number;
  readonly nodePath: readonly string[];
}

export interface NativeGraphicNodeSource {
  readonly animationId: string;
  readonly frameOrdinal: number;
  readonly nodePath: readonly string[];
}

export interface AddNativeGraphicNodeInput {
  readonly animationId: string;
  readonly frameOrdinal: number;
  /** Source editable node/media to copy into the native Definition. */
  readonly source: NativeGraphicNodeSource;
  /** Insert after this sibling node path; omitted appends to the end. */
  readonly afterNodePath?: readonly string[];
  readonly createId?: () => string;
}

export interface ReplaceNativeGraphicNodeInput extends NativeGraphicNodeTarget {
  readonly source: NativeGraphicNodeSource;
}

export interface MoveNativeGraphicNodeInput extends NativeGraphicNodeTarget {
  /** +1 draws the node in front of its next sibling; -1 behind its previous sibling. */
  readonly direction: 1 | -1;
}

function uniqueDefinitionName(project: Project, baseName: string): string {
  const base = baseName.trim().slice(0, NAME_MAX_LENGTH) || NATIVE_GRAPHIC_DEFAULT_NAME;
  const existing = new Set(project.animations.map((animation) => animation.name.toLocaleLowerCase()));
  if (!existing.has(base.toLocaleLowerCase())) return base;
  for (let counter = 2; counter <= 10_000; counter += 1) {
    const suffix = ` (${counter})`;
    const candidate = `${base.slice(0, NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new LayerServiceError('NATIVE_GRAPHIC_NAME_CONFLICT', '无法生成唯一的元件名称。');
}

function matrixTranslation(matrix: AffineMatrix2D, x: number, y: number): AffineMatrix2D {
  return { ...matrix, tx: matrix.tx - x, ty: matrix.ty - y };
}

function finiteMatrix(matrix: AffineMatrix2D): AffineMatrix2D {
  return {
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    tx: matrix.tx,
    ty: matrix.ty,
  };
}

function cloneStroke(stroke: FlaEditableStroke): FlaEditableStroke {
  return { ...stroke, commands: stroke.commands.map((command) => ({ ...command })) };
}

function cloneRegion(region: FlaEditableShapeRegion): FlaEditableShapeRegion {
  return cloneFlaEditableShapeRegion(region);
}

interface ContentAabb {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function expandAabb(
  aabb: ContentAabb | null,
  matrix: AffineMatrix2D,
  rect: { x: number; y: number; width: number; height: number },
): ContentAabb {
  const corners: readonly [number, number][] = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ];
  let { minX, minY, maxX, maxY } = aabb ?? {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const [x, y] of corners) {
    const worldX = matrix.a * x + matrix.c * y + matrix.tx;
    const worldY = matrix.b * x + matrix.d * y + matrix.ty;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) continue;
    if (worldX < minX) minX = worldX;
    if (worldY < minY) minY = worldY;
    if (worldX > maxX) maxX = worldX;
    if (worldY > maxY) maxY = worldY;
  }
  return { minX, minY, maxX, maxY };
}

function leafContentRect(leaf: ResolvedContentLeaf): { x: number; y: number; width: number; height: number } | null {
  if (leaf.kind === 'bitmap') {
    if (leaf.width <= 0 || leaf.height <= 0) return null;
    return { x: 0, y: 0, width: leaf.width, height: leaf.height };
  }
  const bounds = unionFlaShapeRegionBounds(leaf.regions, leaf.residueStrokes);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
  return {
    x: bounds.x - leaf.baseViewBox.x,
    y: bounds.y - leaf.baseViewBox.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function collectEvaluatedNodes(
  layers: readonly { readonly nodes: readonly EvaluatedFlaGraphicNode[] }[],
): EvaluatedFlaGraphicNode[] {
  const nodes: EvaluatedFlaGraphicNode[] = [];
  const walk = (node: EvaluatedFlaGraphicNode): void => {
    nodes.push(node);
    node.children.forEach(walk);
  };
  for (const layer of layers) layer.nodes.forEach(walk);
  return nodes;
}

function findEvaluatedNodeByPath(
  nodes: readonly EvaluatedFlaGraphicNode[],
  path: readonly string[],
): EvaluatedFlaGraphicNode | null {
  return nodes.find((node) => flaGraphicNodePathsEqual(node.path, path)) ?? null;
}

function labelOfNode(node: EvaluatedFlaGraphicNode): string {
  return node.displayName?.trim() || node.regionRef?.trim() || node.source.id;
}

function collectContentLeaves(input: {
  readonly project: Project;
  readonly evaluatedNodes: readonly EvaluatedFlaGraphicNode[];
  readonly nodePath: readonly string[];
}): ResolvedContentLeaf[] {
  const selected = findEvaluatedNodeByPath(input.evaluatedNodes, input.nodePath);
  if (!selected) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SELECTION_INVALID',
      '所选节点在当前元件结构中不存在，请重新选择后再试。',
    );
  }
  const leaves: ResolvedContentLeaf[] = [];
  const visited = new Set<string>();
  const collect = (node: EvaluatedFlaGraphicNode): void => {
    const key = JSON.stringify(node.path);
    if (visited.has(key)) return;
    visited.add(key);
    const source = node.source;
    if (node.vectorVisual) {
      const hasVectorContent =
        node.vectorVisual.regions.length > 0 ||
        (node.vectorVisual.residueStrokes?.length ?? 0) > 0;
      if (!hasVectorContent) return;
      leaves.push({
        kind: 'vector',
        label: labelOfNode(node),
        worldTransform: finiteMatrix(node.worldTransform),
        baseViewBox: { ...node.vectorVisual.baseViewBox },
        regions: node.vectorVisual.regions.map(cloneRegion),
        residueStrokes: (node.vectorVisual.residueStrokes ?? []).map(cloneStroke),
        ...(node.vectorVisual.defsSvg ? { defsSvg: node.vectorVisual.defsSvg } : {}),
      });
      return;
    }
    if (source.type === 'bitmap') {
      if (!source.assetId) {
        throw new LayerServiceError(
          'NATIVE_GRAPHIC_MEDIA_UNRESOLVED',
          `所选媒体“${source.bitmapRef}”尚未绑定项目素材，无法创建原生元件。`,
        );
      }
      const asset = input.project.assets.find(
        (candidate) => candidate.id === source.assetId && candidate.kind === 'image',
      );
      if (!asset || asset.kind !== 'image') {
        throw new LayerServiceError(
          'NATIVE_GRAPHIC_MEDIA_UNRESOLVED',
          `所选媒体“${source.bitmapRef}”对应的项目素材缺失，无法创建原生元件。`,
        );
      }
      leaves.push({
        kind: 'bitmap',
        label: asset.name || source.bitmapRef,
        worldTransform: finiteMatrix(node.worldTransform),
        assetId: asset.id,
        assetName: asset.name,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
      });
      return;
    }
    if (source.type === 'group' || source.type === 'symbol') {
      for (const child of node.children) collect(child);
      return;
    }
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SOURCE_NODE_NOT_EDITABLE',
      `所选内容“${labelOfNode(node)}”不是可编辑的矢量形状或已绑定媒体，无法创建原生元件。`,
    );
  };
  collect(selected);
  // Extracted shape-region siblings belong to the selected shape node but are
  // flattened next to it in the evaluated tree.
  for (const candidate of input.evaluatedNodes) {
    if (
      candidate.extractedFromNodePath &&
      flaGraphicNodePathsEqual(candidate.extractedFromNodePath, input.nodePath)
    ) {
      collect(candidate);
    }
  }
  if (leaves.length === 0) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SELECTION_INVALID',
      `所选内容“${labelOfNode(selected)}”没有可复制的矢量绘制内容或已绑定媒体。`,
    );
  }
  return leaves;
}

function resolveNativeDefinition(project: Project, animationId: string): {
  readonly index: number;
  readonly definition: FlaGraphicDefinition;
} {
  const index = project.animations.findIndex((candidate) => candidate.id === animationId);
  if (index < 0) {
    throw new LayerServiceError('NATIVE_GRAPHIC_DEFINITION_NOT_FOUND', '找不到指定的元件定义。');
  }
  const definition = project.animations[index]!;
  if (!isFlaGraphicDefinition(definition) || !definition.structure) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SOURCE_REQUIRED',
      '当前元件没有可编辑的结构数据。',
    );
  }
  return { index, definition };
}

function resolveNativeEditableDefinition(project: Project, animationId: string): {
  readonly index: number;
  readonly definition: FlaGraphicDefinition;
} {
  const resolved = resolveNativeDefinition(project, animationId);
  if (!isNativeFlaGraphicDefinition(resolved.definition)) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_NOT_NATIVE',
      '该操作只支持原生元件；来源型 FLA 元件保持只读结构。',
    );
  }
  return resolved;
}

function requireFrame(definition: FlaGraphicDefinition, frameOrdinal: number): void {
  if (!definition.structure?.frames.some((frame) => frame.ordinal === frameOrdinal)) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_FRAME_REQUIRED',
      '所选元件帧不存在，请重新选择后再试。',
    );
  }
}

function buildNativeNodeFromLeaf(
  leaf: ResolvedContentLeaf,
  id: string,
  drawOrder: number,
  localTransform: AffineMatrix2D,
): { readonly node: FlaGraphicStructureNode; readonly shapeOverride?: FlaGraphicShapeNodeOverride } {
  if (leaf.kind === 'bitmap') {
    return {
      node: {
        type: 'bitmap',
        id,
        authored: 'native',
        drawOrder,
        localTransform: finiteMatrix(localTransform),
        bitmapRef: leaf.assetName.trim().slice(0, 1_000) || '原生媒体',
        assetId: leaf.assetId,
      },
    };
  }
  return {
    node: {
      type: 'opaque',
      id,
      authored: 'native',
      drawOrder,
      localTransform: finiteMatrix(localTransform),
      opaqueKind: 'shape',
      fallbackScope: 'subtree',
      fallbackViewBox: { ...leaf.baseViewBox },
    },
    shapeOverride: {
      baseViewBox: { ...leaf.baseViewBox },
      regions: leaf.regions.map(cloneRegion),
      excludedRegionRefs: [],
      extractedRegions: [],
      ...(leaf.residueStrokes.length > 0
        ? { residueStrokes: leaf.residueStrokes.map(cloneStroke) }
        : {}),
      ...(leaf.defsSvg ? { sourceDefsSvg: leaf.defsSvg } : {}),
    } satisfies FlaGraphicShapeNodeOverride,
  };
}

function newNativeNodeId(createId: () => string): string {
  return `native-${createId()}`.slice(0, 1_000);
}

function requireEditableFlaGraphicSource(
  layer: Project['shots'][number]['layers'][number],
  project: Project,
): FlaGraphicDefinition {
  if (layer.source.kind !== 'animation') {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SOURCE_REQUIRED',
      '请选择一个 FLA Graphic 动画图层的可编辑结构节点。',
    );
  }
  const animationId = layer.source.animationId;
  const definition = project.animations.find(
    (candidate) => candidate.id === animationId,
  );
  if (!definition || !isFlaGraphicDefinition(definition) || !definition.structure) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SOURCE_REQUIRED',
      '当前图层未关联可编辑的结构化 Graphic，无法创建原生元件。',
    );
  }
  return definition;
}

function resolvedLeavesForNode(input: {
  readonly project: Project;
  readonly definition: FlaGraphicDefinition;
  readonly frameOrdinal: number;
  readonly nodePath: readonly string[];
  readonly instanceTransformOverrides?: Parameters<typeof evaluateFlaGraphicVisual>[0]['instanceTransformOverrides'];
  readonly instanceShapeOverrides?: Parameters<typeof evaluateFlaGraphicVisual>[0]['instanceShapeOverrides'];
}): ResolvedContentLeaf[] {
  requireFrame(input.definition, input.frameOrdinal);
  const evaluated = evaluateFlaGraphicVisual({
    definition: input.definition,
    frameOrdinal: input.frameOrdinal,
    mode: 'instance',
    ...(input.instanceTransformOverrides
      ? { instanceTransformOverrides: input.instanceTransformOverrides }
      : {}),
    ...(input.instanceShapeOverrides
      ? { instanceShapeOverrides: input.instanceShapeOverrides }
      : {}),
  });
  if (!evaluated?.layers) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SELECTION_INVALID',
      '当前元件帧没有可复制的结构内容。',
    );
  }
  return collectContentLeaves({
    project: input.project,
    evaluatedNodes: collectEvaluatedNodes(evaluated.layers),
    nodePath: input.nodePath,
  });
}

function contentBounds(leaves: readonly ResolvedContentLeaf[]): ContentAabb {
  let aabb: ContentAabb | null = null;
  for (const leaf of leaves) {
    const rect = leafContentRect(leaf);
    if (!rect) {
      throw new LayerServiceError(
        'NATIVE_GRAPHIC_SELECTION_INVALID',
        `所选内容“${leaf.label}”没有可测量的绘制范围，无法创建原生元件。`,
      );
    }
    aabb = expandAabb(aabb, leaf.worldTransform, rect);
  }
  if (
    !aabb ||
    !Number.isFinite(aabb.minX) ||
    !Number.isFinite(aabb.minY) ||
    !Number.isFinite(aabb.maxX) ||
    !Number.isFinite(aabb.maxY) ||
    aabb.maxX - aabb.minX <= 0 ||
    aabb.maxY - aabb.minY <= 0
  ) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SELECTION_INVALID',
      '所选内容的绘制范围无效，无法创建原生元件。',
    );
  }
  return aabb;
}

function insertShapeOverride(
  overrides: Record<string, Record<string, FlaGraphicShapeNodeOverride>>,
  frameOrdinal: number,
  nodePath: readonly string[],
  override: FlaGraphicShapeNodeOverride,
): Record<string, Record<string, FlaGraphicShapeNodeOverride>> {
  const frameKey = String(frameOrdinal);
  const next = { ...overrides };
  next[frameKey] = { ...(next[frameKey] ?? {}), [JSON.stringify(nodePath)]: override };
  return next;
}

function removeShapeOverridePaths(
  overrides: Record<string, Record<string, FlaGraphicShapeNodeOverride>>,
  removedPath: readonly string[],
): Record<string, Record<string, FlaGraphicShapeNodeOverride>> {
  const result: Record<string, Record<string, FlaGraphicShapeNodeOverride>> = {};
  for (const [frameKey, frameMap] of Object.entries(overrides)) {
    const nextFrame: Record<string, FlaGraphicShapeNodeOverride> = {};
    for (const [pathKey, nodeOverride] of Object.entries(frameMap)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(pathKey);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed) || !parsed.every((entry): entry is string => typeof entry === 'string')) {
        continue;
      }
      const underRemoved = parsed.length >= removedPath.length &&
        removedPath.every((id, index) => parsed[index] === id);
      if (!underRemoved) nextFrame[pathKey] = nodeOverride;
    }
    if (Object.keys(nextFrame).length > 0) result[frameKey] = nextFrame;
  }
  return result;
}

interface StructureNodeLocation {
  readonly layerIndex: number;
  readonly parentPath: readonly string[];
  readonly siblings: readonly FlaGraphicStructureNode[];
  readonly index: number;
}

function locateNodeInFrame(
  structure: FlaGraphicStructure,
  frameOrdinal: number,
  nodePath: readonly string[],
): StructureNodeLocation | null {
  const frame = structure.frames.find((candidate) => candidate.ordinal === frameOrdinal);
  if (!frame || nodePath.length === 0) return null;
  const head = nodePath[0]!;
  const rest = nodePath.slice(1);
  for (const [layerIndex, layer] of frame.layers.entries()) {
    const index = layer.nodes.findIndex((node) => node.id === head);
    if (index < 0) continue;
    if (rest.length === 0) {
      return { layerIndex, parentPath: [], siblings: layer.nodes, index };
    }
    let current: FlaGraphicStructureNode = layer.nodes[index]!;
    const parentPath: string[] = [head];
    while (rest.length > 0) {
      const nextId = rest.shift()!;
      if (current.type === 'group') {
        const nextIndex = current.children.findIndex((node) => node.id === nextId);
        if (nextIndex < 0) return null;
        if (rest.length === 0) {
          return {
            layerIndex,
            parentPath: [...parentPath],
            siblings: current.children,
            index: nextIndex,
          };
        }
        parentPath.push(nextId);
        current = current.children[nextIndex]!;
        continue;
      }
      return null;
    }
  }
  return null;
}

function replaceSiblingsInStructure(
  structure: FlaGraphicStructure,
  frameOrdinal: number,
  location: StructureNodeLocation,
  nextSiblings: readonly FlaGraphicStructureNode[],
): FlaGraphicStructure {
  const frame = structure.frames.find((candidate) => candidate.ordinal === frameOrdinal);
  if (!frame) return structure;
  const frames = structure.frames.map((candidate) => {
    if (candidate.ordinal !== frameOrdinal) return candidate;
    const layers = [...candidate.layers];
    const layer = layers[location.layerIndex]!;
    if (location.parentPath.length === 0) {
      layers[location.layerIndex] = { ...layer, nodes: [...nextSiblings] };
      return { ...candidate, layers };
    }
    const updateChildren = (
      nodes: readonly FlaGraphicStructureNode[],
      path: readonly string[],
    ): FlaGraphicStructureNode[] | null => {
      if (path.length === 0) return [...nextSiblings];
      const [head, ...rest] = path;
      const index = nodes.findIndex((node) => node.id === head);
      if (index < 0) return null;
      const target = nodes[index]!;
      if (target.type !== 'group') return null;
      const children = updateChildren(target.children, rest);
      if (!children) return null;
      const next = [...nodes];
      next[index] = { ...target, children };
      return next;
    };
    const nextNodes = updateChildren(layer.nodes, location.parentPath);
    if (!nextNodes) return candidate;
    layers[location.layerIndex] = { ...layer, nodes: nextNodes };
    return { ...candidate, layers };
  });
  return { ...structure, frames };
}

function reindexDrawOrder(nodes: readonly FlaGraphicStructureNode[]): FlaGraphicStructureNode[] {
  return nodes.map((node, index) => (node.drawOrder === index ? node : { ...node, drawOrder: index }));
}

/**
 * Creates a reusable native Graphic Definition from editable vector shapes or
 * bound media of an existing FLA Graphic instance. The new Definition is
 * authored content: nodes get fresh author ids, frames carry the common timing
 * contract, and no external FLA path or fabricated media is recorded.
 */
export function createNativeGraphicDefinitionFromNodes(
  project: Project,
  input: CreateNativeGraphicInput,
): CreateNativeGraphicResult {
  const shot = project.shots.find((candidate) => candidate.id === input.shotId);
  if (!shot) {
    throw new LayerServiceError('SHOT_NOT_FOUND', '找不到要编辑的镜头。');
  }
  const layer = shot.layers.find((candidate) => candidate.id === input.layerId);
  if (!layer) {
    throw new LayerServiceError('LAYER_NOT_FOUND', '找不到要编辑的图层。');
  }
  const sourceDefinition = requireEditableFlaGraphicSource(layer, project);
  requireFrame(sourceDefinition, input.frameOrdinal);
  if (input.nodePaths.length === 0) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SELECTION_EMPTY',
      '请先选择至少一个可编辑的矢量形状或已绑定媒体。',
    );
  }
  for (let left = 0; left < input.nodePaths.length; left += 1) {
    for (let right = left + 1; right < input.nodePaths.length; right += 1) {
      if (doFlaGraphicNodePathsOverlap(input.nodePaths[left]!, input.nodePaths[right]!)) {
        throw new LayerServiceError(
          'NATIVE_GRAPHIC_SELECTION_OVERLAP',
          '所选内容之间存在包含关系，请只保留彼此独立的节点。',
        );
      }
    }
  }

  const leaves = input.nodePaths.flatMap((nodePath) =>
    resolvedLeavesForNode({
      project,
      definition: sourceDefinition,
      frameOrdinal: input.frameOrdinal,
      nodePath,
      ...(layer.flaGraphicInstanceTransformOverrides
        ? { instanceTransformOverrides: layer.flaGraphicInstanceTransformOverrides }
        : {}),
      ...(layer.flaGraphicInstanceShapeOverrides
        ? { instanceShapeOverrides: layer.flaGraphicInstanceShapeOverrides }
        : {}),
    }),
  );
  const bounds = contentBounds(leaves);
  const canvas = {
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };

  const createId = input.createId ?? (() => crypto.randomUUID());
  const nodes: FlaGraphicStructureNode[] = [];
  let shapeOverrides: Record<string, Record<string, FlaGraphicShapeNodeOverride>> = {};
  leaves.forEach((leaf, index) => {
    const nodeId = newNativeNodeId(createId);
    const shifted = matrixTranslation(leaf.worldTransform, bounds.minX, bounds.minY);
    const built = buildNativeNodeFromLeaf(leaf, nodeId, index, shifted);
    nodes.push(built.node);
    if (built.shapeOverride) {
      shapeOverrides = insertShapeOverride(shapeOverrides, 0, [nodeId], built.shapeOverride);
    }
  });

  const frameDurationMs = 1_000 / NATIVE_GRAPHIC_SOURCE_FPS;
  const suggestedName = input.name?.trim() ||
    leaves.map((leaf) => leaf.label).join(' + ').slice(0, NAME_MAX_LENGTH) ||
    NATIVE_GRAPHIC_DEFAULT_NAME;
  const name = uniqueDefinitionName(project, suggestedName);
  const structure = FlaGraphicStructureSchema.parse({
    version: 1,
    frames: [{ ordinal: 0, layers: [{ name: NATIVE_GRAPHIC_LAYER_NAME, nodes }] }],
  });
  const definition = FlaGraphicDefinitionSchema.parse({
    id: createId(),
    name,
    kind: 'fla-graphic',
    source: {
      origin: 'native',
      targetKind: 'graphic-symbol',
      targetName: name,
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: NATIVE_GRAPHIC_SOURCE_FPS,
      canvas,
      anchor: { x: 0, y: 0 },
      documentCanvas: canvas,
    },
    durationMs: frameDurationMs,
    frames: [{
      ordinal: 0,
      sourceFrameIndex: 0,
      sourceViewport: { x: 0, y: 0, width: canvas.width, height: canvas.height },
      offset: { x: 0, y: 0 },
      startMs: 0,
      durationMs: frameDurationMs,
      createdBySequenceImport: false,
    }],
    structure,
    ...(Object.keys(shapeOverrides).length > 0
      ? { flaGraphicSharedShapeOverrides: shapeOverrides }
      : {}),
  });
  const nextProject = ProjectSchema.parse({
    ...project,
    animations: [...project.animations, definition],
  });
  return { project: nextProject, animationId: definition.id, name };
}

/** Duplicates a native Definition with a new id/name; instances of the copy diverge. */
export function duplicateNativeGraphicDefinition(
  project: Project,
  input: DuplicateNativeGraphicInput,
): CreateNativeGraphicResult {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  const createId = input.createId ?? (() => crypto.randomUUID());
  const name = uniqueDefinitionName(project, input.name?.trim() || `${definition.name} 副本`);
  const clone = JSON.parse(JSON.stringify(definition)) as FlaGraphicDefinition;
  const copy = FlaGraphicDefinitionSchema.parse({
    ...clone,
    id: createId(),
    name,
  });
  const nextProject = ProjectSchema.parse({
    ...project,
    animations: [...project.animations, copy],
  });
  return { project: nextProject, animationId: copy.id, name };
}

function structuralAssetIds(definition: FlaGraphicDefinition): string[] {
  const ids = new Set<string>();
  const visit = (nodes: readonly FlaGraphicStructureNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'bitmap' && node.assetId) ids.add(node.assetId);
      if (node.type === 'opaque' && node.fallbackAssetId) ids.add(node.fallbackAssetId);
      if (node.type === 'group') visit(node.children);
      if (node.type === 'symbol') visit(node.children ?? []);
    }
  };
  for (const frame of definition.structure?.frames ?? []) {
    for (const layer of frame.layers) visit(layer.nodes);
  }
  for (const frame of definition.frames) {
    if (frame.assetId) ids.add(frame.assetId);
  }
  return [...ids];
}

/**
 * Deletes an unused native Definition. A Definition still referenced by any
 * Layer instance, Character part/face, graphic event, or saved segment is
 * refused with the exact blockers instead of leaving broken references.
 */
export function deleteNativeGraphicDefinition(
  project: Project,
  input: DeleteNativeGraphicInput,
): DeleteNativeGraphicResult {
  const { index, definition } = resolveNativeEditableDefinition(project, input.animationId);
  const references = scanAnimationDefinitionReferences(project, definition.id);
  if (references.length > 0) {
    const listed = references.slice(0, 8).map((reference) => `· ${reference.label}（${reference.path}）`);
    const more = references.length > 8 ? `\n…以及另外 ${references.length - 8} 处引用` : '';
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_IN_USE',
      `元件“${definition.name}”仍被以下内容引用，不能删除：\n${listed.join('\n')}${more}`,
    );
  }
  const candidateAssetIds = structuralAssetIds(definition);
  const nextProject = ProjectSchema.parse({
    ...project,
    animations: project.animations.filter((_candidate, candidateIndex) => candidateIndex !== index),
  });
  const releasedAssets = candidateAssetIds.flatMap((assetId) => {
    if (scanAssetReferences(nextProject, assetId).length > 0) return [];
    const asset = nextProject.assets.find((candidate) => candidate.id === assetId);
    return asset ? [{ assetId, name: asset.name }] : [];
  });
  return { project: nextProject, releasedAssets };
}

function pruneRemovedPathsFromLayers(
  project: Project,
  animationId: string,
  removedPath: readonly string[],
): Project {
  const pathIsUnderRemoved = (candidateKey: string): boolean => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidateKey);
    } catch {
      return false;
    }
    if (!Array.isArray(parsed) || !parsed.every((entry): entry is string => typeof entry === 'string')) {
      return false;
    }
    return parsed.length >= removedPath.length &&
      removedPath.every((id, index) => parsed[index] === id);
  };
  let changed = false;
  const shots = project.shots.map((shot) => {
    let shotChanged = false;
    const layers = shot.layers.map((layer) => {
      if (layer.source.kind !== 'animation' || layer.source.animationId !== animationId) return layer;
      let layerChanged = false;
      const nextLayer = { ...layer };
      if (layer.flaGraphicInstanceTransformOverrides) {
        const nextOverrides: typeof layer.flaGraphicInstanceTransformOverrides = {};
        for (const [frameKey, frameOverrides] of Object.entries(layer.flaGraphicInstanceTransformOverrides)) {
          const kept: typeof frameOverrides = {};
          for (const [overrideKey, matrix] of Object.entries(frameOverrides)) {
            if (!pathIsUnderRemoved(overrideKey)) kept[overrideKey] = matrix;
            else layerChanged = true;
          }
          if (Object.keys(kept).length > 0) nextOverrides[frameKey] = kept;
        }
        if (layerChanged) {
          if (Object.keys(nextOverrides).length > 0) nextLayer.flaGraphicInstanceTransformOverrides = nextOverrides;
          else delete nextLayer.flaGraphicInstanceTransformOverrides;
        }
      }
      if (layer.flaGraphicInstanceShapeOverrides) {
        let shapeChanged = false;
        const nextShape: NonNullable<typeof layer.flaGraphicInstanceShapeOverrides> = {};
        for (const [frameKey, frameMap] of Object.entries(layer.flaGraphicInstanceShapeOverrides)) {
          const kept: (typeof frameMap) = {};
          for (const [overrideKey, override] of Object.entries(frameMap)) {
            if (!pathIsUnderRemoved(overrideKey)) kept[overrideKey] = override;
            else shapeChanged = true;
          }
          if (Object.keys(kept).length > 0) nextShape[frameKey] = kept;
        }
        if (shapeChanged) {
          layerChanged = true;
          if (Object.keys(nextShape).length > 0) nextLayer.flaGraphicInstanceShapeOverrides = nextShape;
          else delete nextLayer.flaGraphicInstanceShapeOverrides;
        }
      }
      if (layer.flaGraphicInstanceTextOverrides) {
        let textChanged = false;
        const nextText: NonNullable<typeof layer.flaGraphicInstanceTextOverrides> = {};
        for (const [frameKey, frameMap] of Object.entries(layer.flaGraphicInstanceTextOverrides)) {
          const kept: (typeof frameMap) = {};
          for (const [overrideKey, value] of Object.entries(frameMap)) {
            if (!pathIsUnderRemoved(overrideKey)) kept[overrideKey] = value;
            else textChanged = true;
          }
          if (Object.keys(kept).length > 0) nextText[frameKey] = kept;
        }
        if (textChanged) {
          layerChanged = true;
          if (Object.keys(nextText).length > 0) nextLayer.flaGraphicInstanceTextOverrides = nextText;
          else delete nextLayer.flaGraphicInstanceTextOverrides;
        }
      }
      if (layerChanged) {
        shotChanged = true;
        return nextLayer;
      }
      return layer;
    });
    if (shotChanged) {
      changed = true;
      return { ...shot, layers };
    }
    return shot;
  });
  return changed ? { ...project, shots } : project;
}

function commitNativeStructure(
  project: Project,
  animationId: string,
  nextStructure: FlaGraphicStructure,
  nextShapeOverrides?: Record<string, Record<string, FlaGraphicShapeNodeOverride>>,
): Project {
  const { index, definition } = resolveNativeEditableDefinition(project, animationId);
  const nextDefinition: FlaGraphicDefinition = {
    ...definition,
    structure: nextStructure,
  };
  // `undefined` keeps the existing shared overrides (e.g. a pure sibling reorder);
  // an explicit object replaces them (an empty object removes them all).
  const overrides = nextShapeOverrides === undefined
    ? definition.flaGraphicSharedShapeOverrides
    : Object.keys(nextShapeOverrides).length > 0
      ? nextShapeOverrides
      : undefined;
  if (overrides) {
    nextDefinition.flaGraphicSharedShapeOverrides = overrides;
  } else {
    delete nextDefinition.flaGraphicSharedShapeOverrides;
  }
  const nextAnimations = [...project.animations];
  nextAnimations[index] = nextDefinition;
  return ProjectSchema.parse({ ...project, animations: nextAnimations });
}

function editableLeavesFromSource(
  project: Project,
  source: NativeGraphicNodeSource,
): ResolvedContentLeaf[] {
  const { definition } = resolveNativeDefinition(project, source.animationId);
  return resolvedLeavesForNode({
    project,
    definition,
    frameOrdinal: source.frameOrdinal,
    nodePath: source.nodePath,
  });
}

/** Removes one native node and its children; referencing instance overrides are pruned. */
export function removeNativeGraphicNode(
  project: Project,
  target: NativeGraphicNodeTarget,
): Project {
  const { definition } = resolveNativeEditableDefinition(project, target.animationId);
  requireFrame(definition, target.frameOrdinal);
  const structure = definition.structure!;
  const location = locateNodeInFrame(structure, target.frameOrdinal, target.nodePath);
  if (!location) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_NODE_NOT_FOUND',
      '找不到要删除的节点，请重新选择。',
    );
  }
  const totalTopLevel = structure.frames
    .find((frame) => frame.ordinal === target.frameOrdinal)!
    .layers.reduce((count, layer) => count + layer.nodes.length, 0);
  if (location.parentPath.length === 0 && totalTopLevel <= 1) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_LAST_NODE',
      '原生元件至少需要保留一个节点。',
    );
  }
  const nextSiblings = reindexDrawOrder([
    ...location.siblings.slice(0, location.index),
    ...location.siblings.slice(location.index + 1),
  ]);
  const nextStructure = replaceSiblingsInStructure(
    structure,
    target.frameOrdinal,
    location,
    nextSiblings,
  );
  const nextShapeOverrides = definition.flaGraphicSharedShapeOverrides
    ? removeShapeOverridePaths(definition.flaGraphicSharedShapeOverrides, target.nodePath)
    : undefined;
  const prunedProject = pruneRemovedPathsFromLayers(project, definition.id, target.nodePath);
  return commitNativeStructure(prunedProject, definition.id, nextStructure, nextShapeOverrides);
}

/** Moves one native node within its sibling order (one authored undo step). */
export function moveNativeGraphicNode(
  project: Project,
  target: MoveNativeGraphicNodeInput,
): Project {
  const { definition } = resolveNativeEditableDefinition(project, target.animationId);
  requireFrame(definition, target.frameOrdinal);
  const structure = definition.structure!;
  const location = locateNodeInFrame(structure, target.frameOrdinal, target.nodePath);
  if (!location) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_NODE_NOT_FOUND',
      '找不到要调整顺序的节点，请重新选择。',
    );
  }
  const nextIndex = location.index + target.direction;
  if (nextIndex < 0 || nextIndex >= location.siblings.length) return project;
  const siblings = [...location.siblings];
  const moved = siblings[location.index]!;
  siblings[location.index] = siblings[nextIndex]!;
  siblings[nextIndex] = moved;
  const nextStructure = replaceSiblingsInStructure(
    structure,
    target.frameOrdinal,
    location,
    reindexDrawOrder(siblings),
  );
  return commitNativeStructure(project, definition.id, nextStructure);
}

/** Copies one editable source node/media into the native Definition as a new node. */
export function addNativeGraphicNode(
  project: Project,
  input: AddNativeGraphicNodeInput,
): { readonly project: Project; readonly nodePath: readonly string[] } {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  // Exposure cells may be held; the new content is authored on the real
  // authored keyframe that the cell exposes, never on the cell itself.
  const { frame, authoredOrdinal } = requireNativeAuthoredFrame(definition, input.frameOrdinal);
  const leaves = editableLeavesFromSource(project, input.source);
  const structure = definition.structure!;
  const layerIndex = 0;
  const layer = frame.layers[layerIndex];
  if (!layer) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_FRAME_REQUIRED',
      '当前元件帧缺少内容图层，无法添加节点。',
    );
  }
  const createId = input.createId ?? (() => crypto.randomUUID());
  let insertIndex = layer.nodes.length;
  if (input.afterNodePath) {
    const location = locateNodeInFrame(structure, authoredOrdinal, input.afterNodePath);
    if (!location) {
      throw new LayerServiceError(
        'NATIVE_GRAPHIC_NODE_NOT_FOUND',
        '找不到要插入位置的节点，请重新选择。',
      );
    }
    if (location.parentPath.length > 0) {
      throw new LayerServiceError(
        'NATIVE_GRAPHIC_SELECTION_INVALID',
        '仅支持在一级节点之后插入新节点。',
      );
    }
    insertIndex = location.index + 1;
  }
  const newNodes: FlaGraphicStructureNode[] = [];
  let shapeOverrides: Record<string, Record<string, FlaGraphicShapeNodeOverride>> =
    (definition.flaGraphicSharedShapeOverrides ?? {}) as Record<
      string,
      Record<string, FlaGraphicShapeNodeOverride>
    >;
  const newPaths: string[][] = [];
  leaves.forEach((leaf, offset) => {
    const nodeId = newNativeNodeId(createId);
    const built = buildNativeNodeFromLeaf(leaf, nodeId, insertIndex + offset, leaf.worldTransform);
    newNodes.push(built.node);
    newPaths.push([nodeId]);
    if (built.shapeOverride) {
      shapeOverrides = insertShapeOverride(
        shapeOverrides,
        authoredOrdinal,
        [nodeId],
        built.shapeOverride,
      );
    }
  });
  const nextNodes = reindexDrawOrder([
    ...layer.nodes.slice(0, insertIndex),
    ...newNodes,
    ...layer.nodes.slice(insertIndex),
  ]);
  const location: StructureNodeLocation = {
    layerIndex,
    parentPath: [],
    siblings: layer.nodes,
    index: insertIndex,
  };
  const nextStructure = replaceSiblingsInStructure(
    structure,
    authoredOrdinal,
    location,
    nextNodes,
  );
  return {
    project: commitNativeStructure(project, definition.id, nextStructure, shapeOverrides),
    nodePath: newPaths[0]!,
  };
}

/**
 * Replaces one native node's content with an editable source shape/media while
 * keeping the node's author identity, draw order, and placement.
 */
export function replaceNativeGraphicNode(
  project: Project,
  input: ReplaceNativeGraphicNodeInput,
): Project {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  const { authoredOrdinal } = requireNativeAuthoredFrame(definition, input.frameOrdinal);
  const structure = definition.structure!;
  const location = locateNodeInFrame(structure, authoredOrdinal, input.nodePath);
  if (!location) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_NODE_NOT_FOUND',
      '找不到要替换内容的节点，请重新选择。',
    );
  }
  const targetNode = location.siblings[location.index]!;
  if (targetNode.authored !== 'native') {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_NOT_NATIVE',
      '只能替换原生元件内的节点内容。',
    );
  }
  const leaves = editableLeavesFromSource(project, input.source);
  if (leaves.length !== 1) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SELECTION_INVALID',
      '替换节点仅支持单个可编辑的矢量形状或已绑定媒体。',
    );
  }
  const leaf = leaves[0]!;
  const built = buildNativeNodeFromLeaf(
    leaf,
    targetNode.id,
    targetNode.drawOrder,
    targetNode.localTransform,
  );
  let shapeOverrides: Record<string, Record<string, FlaGraphicShapeNodeOverride>> =
    removeShapeOverridePaths(
      (definition.flaGraphicSharedShapeOverrides ?? {}) as Record<
        string,
        Record<string, FlaGraphicShapeNodeOverride>
      >,
      input.nodePath,
    );
  // The evaluator reads overrides by the complete path from the frame root,
  // including any Group ancestors, so the new content must be keyed the same way.
  const completePath = [...location.parentPath, targetNode.id];
  if (built.shapeOverride) {
    shapeOverrides = insertShapeOverride(
      shapeOverrides,
      authoredOrdinal,
      completePath,
      built.shapeOverride,
    );
  }
  const siblings = [...location.siblings];
  siblings[location.index] = built.node;
  const nextStructure = replaceSiblingsInStructure(
    structure,
    authoredOrdinal,
    location,
    siblings,
  );
  return commitNativeStructure(project, definition.id, nextStructure, shapeOverrides);
}

/* ------------------------------------------------------------------------- *
 * Issue #1453 — native Definition exposure and frame authoring.
 *
 * Exposure is expressed with the existing Definition frame contract: each
 * played frame ordinal is one exposure cell. An authored keyframe owns its
 * layer content; a held cell stores `holdFromOrdinal` and no layers, and the
 * evaluator resolves it to that earlier authored frame. No parallel playhead or
 * second animation container is introduced, and source-backed Definitions never
 * carry hold markers (every operation below refuses them).
 *
 * Reference lifecycle: removing content prunes the referencing instance
 * transform/shape/text overrides, definition shared shape overrides, and node
 * identity aliases (a stale override can therefore never resurrect removed
 * nodes). Internal-timeline tracks are deliberately left inert instead of being
 * rewritten: their identity resolves through a live node, so a track for a
 * removed node is never consulted by the evaluator and stays harmless data
 * until the creator deletes it.
 * ------------------------------------------------------------------------- */

const IDENTITY_MATRIX: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export type NativeGraphicFrameGeometry = Pick<
  FlaGraphicDefinition['frames'][number],
  'sourceViewport' | 'offset'
>;

export interface NativeGraphicExposureFrameInfo {
  readonly ordinal: number;
  /** Authored keyframe supplying this cell's content. */
  readonly authoredOrdinal: number;
  readonly held: boolean;
  /** Authored keyframe with no layer content (e.g. an inserted blank frame). */
  readonly blank: boolean;
  readonly layerCount: number;
}

/** UI projection of the authored exposure cells of a native Definition. */
export function listNativeGraphicExposureFrames(
  definition: FlaGraphicDefinition,
): NativeGraphicExposureFrameInfo[] {
  if (!definition.structure) return [];
  return definition.structure.frames.map((frame) => {
    const resolved = resolveFlaGraphicStructureFrame(definition.structure!, frame.ordinal);
    const authored = resolved?.frame ?? frame;
    return {
      ordinal: frame.ordinal,
      authoredOrdinal: resolved?.authoredOrdinal ?? frame.ordinal,
      held: frame.holdFromOrdinal !== undefined,
      blank: authored.layers.every((layer) => layer.nodes.length === 0),
      layerCount: authored.layers.length,
    };
  });
}

function nativeFrameDurationMs(definition: FlaGraphicDefinition): number {
  return 1_000 / definition.source.sourceFps;
}

/**
 * Rebuild the Definition frame list (and its shared timing contract) from one
 * geometry per played exposure cell. Only native Definitions use this: they
 * never own baked frame media or source frame labels.
 */
function withNativeFrameGeometries(
  definition: FlaGraphicDefinition,
  geometries: readonly NativeGraphicFrameGeometry[],
): FlaGraphicDefinition {
  const frameDurationMs = nativeFrameDurationMs(definition);
  const startFrameIndex = definition.source.startFrameIndex;
  const frames = geometries.map((geometry, index) => ({
    ordinal: index,
    sourceFrameIndex: startFrameIndex + index,
    sourceViewport: { ...geometry.sourceViewport },
    offset: { ...geometry.offset },
    startMs: index * frameDurationMs,
    durationMs: frameDurationMs,
    createdBySequenceImport: false,
  }));
  const next: FlaGraphicDefinition = {
    ...definition,
    source: {
      ...definition.source,
      endFrameIndex: startFrameIndex + geometries.length - 1,
    },
    durationMs: geometries.length * frameDurationMs,
    frames,
  };
  delete next.sourceFrameLabels;
  return next;
}

function frameGeometries(definition: FlaGraphicDefinition): NativeGraphicFrameGeometry[] {
  return definition.frames.map((frame) => ({
    sourceViewport: { ...frame.sourceViewport },
    offset: { ...frame.offset },
  }));
}

function requireNativeAuthoredFrame(
  definition: FlaGraphicDefinition,
  frameOrdinal: number,
): { readonly frame: FlaGraphicStructureFrame; readonly authoredOrdinal: number } {
  if (!definition.structure) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SOURCE_REQUIRED',
      '当前元件没有可编辑的结构数据。',
    );
  }
  const resolved = resolveFlaGraphicStructureFrame(definition.structure, frameOrdinal);
  if (!resolved) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_FRAME_REQUIRED',
      '所选元件帧不存在，请重新选择后再试。',
    );
  }
  return { frame: resolved.frame, authoredOrdinal: resolved.authoredOrdinal };
}

function replaceStructureFrameContent(
  structure: FlaGraphicStructure,
  authoredOrdinal: number,
  nextFrame: FlaGraphicStructureFrame,
): FlaGraphicStructure {
  return {
    ...structure,
    frames: structure.frames.map((frame) =>
      frame.ordinal === authoredOrdinal ? nextFrame : frame,
    ),
  };
}

function blankFrameLayers(
  sourceLayers: readonly FlaGraphicStructureLayer[],
): FlaGraphicStructureLayer[] {
  const layers = sourceLayers.length > 0
    ? sourceLayers
    : [{ name: NATIVE_GRAPHIC_LAYER_NAME, nodes: [] }];
  return layers.map((layer) => ({ name: layer.name, nodes: [] }));
}

function collectStructureNodeIds(nodes: readonly FlaGraphicStructureNode[]): string[] {
  const ids: string[] = [];
  const visit = (list: readonly FlaGraphicStructureNode[]): void => {
    for (const node of list) {
      ids.push(node.id);
      if (node.type === 'group') visit(node.children);
      else if (node.type === 'symbol' && node.children) visit(node.children);
    }
  };
  visit(nodes);
  return ids;
}

function removeAliasEntries(
  structure: FlaGraphicStructure,
  containerKey: string,
  nodeIds: readonly string[],
): FlaGraphicStructure {
  const aliases = structure.nodeIdentityAliases;
  const container = aliases?.[containerKey];
  if (!aliases || !container) return structure;
  const nextContainer = { ...container };
  for (const nodeId of nodeIds) delete nextContainer[nodeId];
  const nextAliases = { ...aliases };
  if (Object.keys(nextContainer).length === 0) delete nextAliases[containerKey];
  else nextAliases[containerKey] = nextContainer;
  const nextStructure = { ...structure };
  if (Object.keys(nextAliases).length === 0) delete nextStructure.nodeIdentityAliases;
  else nextStructure.nodeIdentityAliases = nextAliases;
  return nextStructure;
}

function removeAliasContainers(
  structure: FlaGraphicStructure,
  containerKeys: readonly string[],
): FlaGraphicStructure {
  const aliases = structure.nodeIdentityAliases;
  if (!aliases) return structure;
  const nextAliases = { ...aliases };
  let changed = false;
  for (const containerKey of containerKeys) {
    if (containerKey in nextAliases) {
      delete nextAliases[containerKey];
      changed = true;
    }
  }
  if (!changed) return structure;
  const nextStructure = { ...structure };
  if (Object.keys(nextAliases).length === 0) delete nextStructure.nodeIdentityAliases;
  else nextStructure.nodeIdentityAliases = nextAliases;
  return nextStructure;
}

function dropShapeOverrideFrames(
  definition: FlaGraphicDefinition,
  frameOrdinals: readonly number[],
): Record<string, Record<string, FlaGraphicShapeNodeOverride>> | undefined {
  const overrides = definition.flaGraphicSharedShapeOverrides;
  if (!overrides) return undefined;
  const removed = new Set(frameOrdinals.map((ordinal) => String(ordinal)));
  const next = Object.fromEntries(
    Object.entries(overrides).filter(([frameKey]) => !removed.has(frameKey)),
  );
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Removes per-instance frame-keyed overrides for exposure cells being cleared. */
function pruneFrameOrdinalOverridesFromLayers(
  project: Project,
  animationId: string,
  frameOrdinals: readonly number[],
): Project {
  if (frameOrdinals.length === 0) return project;
  const removed = new Set(frameOrdinals.map((ordinal) => String(ordinal)));
  const pruneFrameMap = <T>(map: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!map) return undefined;
    const next = Object.fromEntries(
      Object.entries(map).filter(([frameKey]) => !removed.has(frameKey)),
    );
    return Object.keys(next).length > 0 ? next : undefined;
  };
  let changed = false;
  const shots = project.shots.map((shot) => {
    let shotChanged = false;
    const layers = shot.layers.map((layer) => {
      if (layer.source.kind !== 'animation' || layer.source.animationId !== animationId) {
        return layer;
      }
      const nextLayer = { ...layer };
      let layerChanged = false;
      const transform = pruneFrameMap(layer.flaGraphicInstanceTransformOverrides);
      if (transform !== layer.flaGraphicInstanceTransformOverrides) {
        layerChanged = true;
        if (transform) nextLayer.flaGraphicInstanceTransformOverrides = transform;
        else delete nextLayer.flaGraphicInstanceTransformOverrides;
      }
      const shape = pruneFrameMap(layer.flaGraphicInstanceShapeOverrides);
      if (shape !== layer.flaGraphicInstanceShapeOverrides) {
        layerChanged = true;
        if (shape) nextLayer.flaGraphicInstanceShapeOverrides = shape;
        else delete nextLayer.flaGraphicInstanceShapeOverrides;
      }
      const text = pruneFrameMap(layer.flaGraphicInstanceTextOverrides);
      if (text !== layer.flaGraphicInstanceTextOverrides) {
        layerChanged = true;
        if (text) nextLayer.flaGraphicInstanceTextOverrides = text;
        else delete nextLayer.flaGraphicInstanceTextOverrides;
      }
      if (layerChanged) shotChanged = true;
      return layerChanged ? nextLayer : layer;
    });
    if (shotChanged) changed = true;
    return shotChanged ? { ...shot, layers } : shot;
  });
  return changed ? { ...project, shots } : project;
}

function commitNativeDefinition(
  project: Project,
  animationId: string,
  mutate: (definition: FlaGraphicDefinition) => FlaGraphicDefinition,
): Project {
  const { index, definition } = resolveNativeEditableDefinition(project, animationId);
  const nextDefinition = mutate(definition);
  if (nextDefinition === definition) return project;
  const nextAnimations = [...project.animations];
  nextAnimations[index] = nextDefinition;
  return ProjectSchema.parse({ ...project, animations: nextAnimations });
}

export interface AddNativeGraphicBlankKeyframeInput {
  readonly animationId: string;
  /** Existing cell to blank, or `frames.length` to append a new blank frame. */
  readonly frameOrdinal: number;
}

export interface AddNativeGraphicBlankKeyframeResult {
  readonly project: Project;
  readonly frameOrdinal: number;
}

/**
 * Inserts a blank authored keyframe at an exposure cell. An existing cell is
 * blanked in place (no ordinal shifting, other frames keep their exact timing);
 * `frameOrdinal === frames.length` appends a new blank authored frame.
 */
export function addNativeGraphicBlankKeyframe(
  project: Project,
  input: AddNativeGraphicBlankKeyframeInput,
): AddNativeGraphicBlankKeyframeResult {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  const frameCount = definition.frames.length;
  if (
    !Number.isSafeInteger(input.frameOrdinal) ||
    input.frameOrdinal < 0 ||
    input.frameOrdinal > frameCount
  ) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_FRAME_ORDINAL_INVALID',
      `空白关键帧位置超出范围（0–${frameCount}）。`,
    );
  }
  const structure = definition.structure!;
  const sourceLayers =
    frameCount === 0
      ? []
      : requireNativeAuthoredFrame(
          definition,
          Math.min(input.frameOrdinal, frameCount - 1),
        ).frame.layers;
  const blankFrame: FlaGraphicStructureFrame = {
    ordinal: input.frameOrdinal,
    layers: blankFrameLayers(sourceLayers),
  };
  const prunedProject = input.frameOrdinal < frameCount
    ? pruneFrameOrdinalOverridesFromLayers(project, definition.id, [input.frameOrdinal])
    : project;
  const nextStructure = input.frameOrdinal < frameCount
    ? removeAliasContainers(
        replaceStructureFrameContent(structure, input.frameOrdinal, blankFrame),
        [`frame:${input.frameOrdinal}`],
      )
    : { ...structure, frames: [...structure.frames, blankFrame] };
  const geometries = [...frameGeometries(definition)];
  if (input.frameOrdinal === frameCount) {
    geometries.push({ ...geometries[geometries.length - 1]! });
  }
  const nextProject = commitNativeDefinition(
    prunedProject,
    definition.id,
    (current) => {
      const nextDefinition = {
        ...withNativeFrameGeometries(current, geometries),
        structure: nextStructure,
      };
      if (input.frameOrdinal < frameCount) {
        const overrides = dropShapeOverrideFrames(current, [input.frameOrdinal]);
        if (overrides) nextDefinition.flaGraphicSharedShapeOverrides = overrides;
        else delete nextDefinition.flaGraphicSharedShapeOverrides;
      }
      return nextDefinition;
    },
  );
  return { project: nextProject, frameOrdinal: input.frameOrdinal };
}

export interface CopyNativeGraphicFrameInput {
  readonly animationId: string;
  /** Played exposure cell whose displayed content is copied. */
  readonly sourceFrameOrdinal: number;
  readonly createId?: () => string;
}

export interface CopyNativeGraphicFrameResult {
  readonly project: Project;
  /** Appended authored frame ordinal. */
  readonly frameOrdinal: number;
}

interface NativeNodeCopyMove {
  readonly fromPathKey: string;
  readonly toPathKey: string;
}

function cloneNativeNodeForCopy(
  node: FlaGraphicStructureNode,
  id: string,
  oldPath: readonly string[],
  newPath: readonly string[],
  createId: () => string,
  moves: NativeNodeCopyMove[],
): FlaGraphicStructureNode {
  const oldPathKey = JSON.stringify(oldPath);
  const newPathKey = JSON.stringify(newPath);
  moves.push({ fromPathKey: oldPathKey, toPathKey: newPathKey });
  if (node.type === 'group') {
    return {
      ...node,
      id,
      groupId: `native-group-${createId()}`.slice(0, 1_000),
      children: node.children.map((child) => {
        const childId = newNativeNodeId(createId);
        return cloneNativeNodeForCopy(
          child,
          childId,
          [...oldPath, child.id],
          [...newPath, childId],
          createId,
          moves,
        );
      }),
    };
  }
  if (node.type === 'symbol' && node.children) {
    return {
      ...node,
      id,
      children: node.children.map((child) => {
        const childId = newNativeNodeId(createId);
        return cloneNativeNodeForCopy(
          child,
          childId,
          [...oldPath, child.id],
          [...newPath, childId],
          createId,
          moves,
        );
      }),
    };
  }
  return { ...node, id };
}

/**
 * Appends a copy of the content displayed at `sourceFrameOrdinal` as a new
 * authored keyframe. Copied nodes get fresh author ids, so they are distinct
 * and independently editable (and, being authored-native, keep a proven
 * `node:<id>` identity for the internal timeline).
 */
export function copyNativeGraphicFrame(
  project: Project,
  input: CopyNativeGraphicFrameInput,
): CopyNativeGraphicFrameResult {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  if (definition.frames.length >= FLA_GRAPHIC_MAX_FRAMES) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_FRAME_LIMIT',
      `原生元件最多支持 ${FLA_GRAPHIC_MAX_FRAMES} 帧，无法继续复制。`,
    );
  }
  const source = requireNativeAuthoredFrame(definition, input.sourceFrameOrdinal);
  const createId = input.createId ?? (() => crypto.randomUUID());
  const moves: NativeNodeCopyMove[] = [];
  const layers = source.frame.layers.map((layer) => ({
    name: layer.name,
    nodes: layer.nodes.map((node) => {
      const nodeId = newNativeNodeId(createId);
      return cloneNativeNodeForCopy(
        node,
        nodeId,
        [node.id],
        [nodeId],
        createId,
        moves,
      );
    }),
  }));
  const frameOrdinal = definition.frames.length;
  const sourceOverrides =
    definition.flaGraphicSharedShapeOverrides?.[String(source.authoredOrdinal)] ?? {};
  const copiedOverrides: Record<string, FlaGraphicShapeNodeOverride> = {};
  for (const move of moves) {
    const override = sourceOverrides[move.fromPathKey];
    if (override) {
      copiedOverrides[move.toPathKey] = JSON.parse(
        JSON.stringify(override),
      ) as FlaGraphicShapeNodeOverride;
    }
  }
  const geometries = frameGeometries(definition);
  geometries.push({ ...geometries[geometries.length - 1]! });
  const nextProject = commitNativeDefinition(project, definition.id, (current) => {
    const nextStructure: FlaGraphicStructure = {
      ...current.structure!,
      frames: [
        ...current.structure!.frames,
        { ordinal: frameOrdinal, layers },
      ],
    };
    const nextOverrides: Record<string, Record<string, FlaGraphicShapeNodeOverride>> = {
      ...(current.flaGraphicSharedShapeOverrides ?? {}),
    };
    if (Object.keys(copiedOverrides).length > 0) {
      nextOverrides[String(frameOrdinal)] = copiedOverrides;
    } else {
      delete nextOverrides[String(frameOrdinal)];
    }
    const nextDefinition = {
      ...withNativeFrameGeometries(current, geometries),
      structure: nextStructure,
    };
    if (Object.keys(nextOverrides).length > 0) {
      nextDefinition.flaGraphicSharedShapeOverrides = nextOverrides;
    } else {
      delete nextDefinition.flaGraphicSharedShapeOverrides;
    }
    return nextDefinition;
  });
  return { project: nextProject, frameOrdinal };
}

export interface NativeGraphicExposureInput {
  readonly animationId: string;
  readonly count: number;
}

export interface ExtendNativeGraphicExposureResult {
  readonly project: Project;
  readonly addedFrames: number;
  /** Authored keyframe held by the appended exposure frames. */
  readonly authoredOrdinal: number;
}

/**
 * Extends the final displayed content by appending held exposure cells. The
 * held cells reference the authored keyframe currently displayed at the end, so
 * every layer of that keyframe (including its authored edits) stays identical
 * across the extended range without duplicating node content.
 */
export function extendNativeGraphicExposure(
  project: Project,
  input: NativeGraphicExposureInput,
): ExtendNativeGraphicExposureResult {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  const count = input.count;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_EXPOSURE_COUNT_INVALID',
      '延长曝光的帧数必须为正整数。',
    );
  }
  if (definition.frames.length + count > FLA_GRAPHIC_MAX_FRAMES) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_FRAME_LIMIT',
      `原生元件最多支持 ${FLA_GRAPHIC_MAX_FRAMES} 帧，无法延长曝光。`,
    );
  }
  const lastOrdinal = definition.frames.length - 1;
  const { authoredOrdinal } = requireNativeAuthoredFrame(definition, lastOrdinal);
  const structure = definition.structure!;
  const geometries = frameGeometries(definition);
  const appended: FlaGraphicStructureFrame[] = [];
  for (let index = 1; index <= count; index += 1) {
    appended.push({
      ordinal: lastOrdinal + index,
      layers: [],
      holdFromOrdinal: authoredOrdinal,
    });
    geometries.push({ ...geometries[geometries.length - 1]! });
  }
  const nextProject = commitNativeDefinition(project, definition.id, (current) => ({
    ...withNativeFrameGeometries(current, geometries),
    structure: { ...structure, frames: [...structure.frames, ...appended] },
  }));
  return { project: nextProject, addedFrames: count, authoredOrdinal };
}

export interface ShortenNativeGraphicExposureResult {
  readonly project: Project;
  readonly removedFrames: number;
}

/**
 * Shortens exposure by removing trailing held cells. Authored keyframes are
 * never silently deleted: when the final cell is an authored keyframe the
 * operation refuses with an actionable message.
 */
export function shortenNativeGraphicExposure(
  project: Project,
  input: NativeGraphicExposureInput,
): ShortenNativeGraphicExposureResult {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  const count = input.count;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_EXPOSURE_COUNT_INVALID',
      '缩短曝光的帧数必须为正整数。',
    );
  }
  const structure = definition.structure!;
  let trailingHeld = 0;
  for (let index = structure.frames.length - 1; index >= 0; index -= 1) {
    if (structure.frames[index]!.holdFromOrdinal === undefined) break;
    trailingHeld += 1;
  }
  if (trailingHeld === 0) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_EXPOSURE_NOT_HELD',
      '元件末帧是作者关键帧，没有可缩短的曝光；请先延长曝光，或改为空白关键帧。',
    );
  }
  const removedFrames = Math.min(count, trailingHeld);
  const nextLength = structure.frames.length - removedFrames;
  const removedOrdinals = Array.from(
    { length: removedFrames },
    (_unused, index) => nextLength + index,
  );
  const geometries = frameGeometries(definition).slice(0, nextLength);
  const prunedProject = pruneFrameOrdinalOverridesFromLayers(
    project,
    definition.id,
    removedOrdinals,
  );
  const nextStructure = removeAliasContainers(
    {
      ...structure,
      frames: structure.frames.slice(0, nextLength),
    },
    removedOrdinals.map((ordinal) => `frame:${ordinal}`),
  );
  const overrides = dropShapeOverrideFrames(definition, removedOrdinals);
  const nextProject = commitNativeDefinition(prunedProject, definition.id, (current) => {
    const nextDefinition = {
      ...withNativeFrameGeometries(current, geometries),
      structure: nextStructure,
    };
    if (overrides) nextDefinition.flaGraphicSharedShapeOverrides = overrides;
    else delete nextDefinition.flaGraphicSharedShapeOverrides;
    return nextDefinition;
  });
  return { project: nextProject, removedFrames };
}

export interface NativeGraphicLayerTarget {
  readonly animationId: string;
  readonly frameOrdinal: number;
}

export interface AddNativeGraphicLayerInput extends NativeGraphicLayerTarget {
  readonly name?: string;
}

/** Adds one empty layer on top of the authored frame's layer stack. */
export function addNativeGraphicLayer(
  project: Project,
  input: AddNativeGraphicLayerInput,
): Project {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  const { frame, authoredOrdinal } = requireNativeAuthoredFrame(definition, input.frameOrdinal);
  const rawName = input.name?.trim().slice(0, 500) ?? '';
  const name = rawName || `图层 ${frame.layers.length + 1}`;
  const nextFrame: FlaGraphicStructureFrame = {
    ...frame,
    layers: [...frame.layers, { name, nodes: [] }],
  };
  const nextStructure = replaceStructureFrameContent(
    definition.structure!,
    authoredOrdinal,
    nextFrame,
  );
  return commitNativeDefinition(project, definition.id, (current) => ({
    ...current,
    structure: nextStructure,
  }));
}

export interface RemoveNativeGraphicLayerInput extends NativeGraphicLayerTarget {
  readonly layerIndex: number;
}

/** Removes one authored layer and prunes the overrides/aliases of its nodes. */
export function removeNativeGraphicLayer(
  project: Project,
  input: RemoveNativeGraphicLayerInput,
): Project {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  const { frame, authoredOrdinal } = requireNativeAuthoredFrame(definition, input.frameOrdinal);
  if (
    !Number.isSafeInteger(input.layerIndex) ||
    input.layerIndex < 0 ||
    input.layerIndex >= frame.layers.length
  ) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_LAYER_NOT_FOUND',
      '找不到要删除的图层，请重新选择。',
    );
  }
  if (frame.layers.length <= 1) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_LAST_LAYER',
      '原生元件帧至少需要保留一个图层。',
    );
  }
  const removedLayer = frame.layers[input.layerIndex]!;
  const removedNodeIds = collectStructureNodeIds(removedLayer.nodes);
  const removedRootPaths = removedLayer.nodes.map((node) => [node.id]);
  let nextStructure = replaceStructureFrameContent(definition.structure!, authoredOrdinal, {
    ...frame,
    layers: frame.layers.filter((_layer, index) => index !== input.layerIndex),
  });
  if (removedNodeIds.length > 0) {
    nextStructure = removeAliasEntries(
      nextStructure,
      `frame:${authoredOrdinal}`,
      removedNodeIds,
    );
  }
  let overrides = definition.flaGraphicSharedShapeOverrides as
    | Record<string, Record<string, FlaGraphicShapeNodeOverride>>
    | undefined;
  for (const rootPath of removedRootPaths) {
    if (overrides) overrides = removeShapeOverridePaths(overrides, rootPath);
  }
  let prunedProject = project;
  for (const rootPath of removedRootPaths) {
    prunedProject = pruneRemovedPathsFromLayers(prunedProject, definition.id, rootPath);
  }
  return commitNativeDefinition(prunedProject, definition.id, (current) => {
    const nextDefinition = { ...current, structure: nextStructure };
    if (overrides && Object.keys(overrides).length > 0) {
      nextDefinition.flaGraphicSharedShapeOverrides = overrides;
    } else {
      delete nextDefinition.flaGraphicSharedShapeOverrides;
    }
    return nextDefinition;
  });
}

export interface MoveNativeGraphicLayerInput extends NativeGraphicLayerTarget {
  readonly layerIndex: number;
  /** +1 moves the layer in front of its next sibling; -1 behind its previous. */
  readonly direction: 1 | -1;
}

/** Reorders one authored layer within its frame (draw order = layer array order). */
export function moveNativeGraphicLayer(
  project: Project,
  input: MoveNativeGraphicLayerInput,
): Project {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  const { frame, authoredOrdinal } = requireNativeAuthoredFrame(definition, input.frameOrdinal);
  if (
    !Number.isSafeInteger(input.layerIndex) ||
    input.layerIndex < 0 ||
    input.layerIndex >= frame.layers.length
  ) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_LAYER_NOT_FOUND',
      '找不到要调整顺序的图层，请重新选择。',
    );
  }
  const nextIndex = input.layerIndex + input.direction;
  if (nextIndex < 0 || nextIndex >= frame.layers.length) return project;
  const layers = [...frame.layers];
  const moved = layers[input.layerIndex]!;
  layers[input.layerIndex] = layers[nextIndex]!;
  layers[nextIndex] = moved;
  const nextStructure = replaceStructureFrameContent(
    definition.structure!,
    authoredOrdinal,
    { ...frame, layers },
  );
  return commitNativeDefinition(project, definition.id, (current) => ({
    ...current,
    structure: nextStructure,
  }));
}

function parsePathKey(pathKey: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(pathKey);
    return Array.isArray(parsed) && parsed.every((entry): entry is string => typeof entry === 'string')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function prependGroupToPathKey(
  pathKey: string,
  nodeId: string,
  groupId: string,
): string | null | undefined {
  const parsed = parsePathKey(pathKey);
  if (!parsed || parsed[0] !== nodeId) return undefined;
  return JSON.stringify([groupId, ...parsed]);
}

/** Removes the leading group segment; a group's own override entry is dropped. */
function removeFirstPathSegment(
  pathKey: string,
  nodeId: string,
): string | null | undefined {
  const parsed = parsePathKey(pathKey);
  if (!parsed || parsed[0] !== nodeId) return undefined;
  return parsed.length > 1 ? JSON.stringify(parsed.slice(1)) : null;
}

/**
 * Path-key remap contract: `undefined` keeps the key unchanged, `null` drops the
 * entry, a string replaces the key.
 */
type NodePathKeyRemap = (pathKey: string) => string | null | undefined;

function remapPathKeyedRecord<T>(
  record: Record<string, T> | undefined,
  remap: NodePathKeyRemap,
): { readonly next: Record<string, T> | undefined; readonly changed: boolean } {
  if (!record) return { next: undefined, changed: false };
  let changed = false;
  const next: Record<string, T> = {};
  for (const [pathKey, value] of Object.entries(record)) {
    const mapped = remap(pathKey);
    if (mapped === null) {
      changed = true;
      continue;
    }
    if (mapped === undefined) {
      next[pathKey] = value;
      continue;
    }
    if (mapped !== pathKey) changed = true;
    next[mapped] = value;
  }
  return { next: changed ? next : record, changed };
}

/** Remaps definition shared shape overrides (all frames) with a path transform. */
function remapDefinitionShapeOverridePaths(
  definition: FlaGraphicDefinition,
  remap: NodePathKeyRemap,
): Record<string, Record<string, FlaGraphicShapeNodeOverride>> | undefined {
  const overrides = definition.flaGraphicSharedShapeOverrides;
  if (!overrides) return undefined;
  let changed = false;
  const next: Record<string, Record<string, FlaGraphicShapeNodeOverride>> = {};
  for (const [frameKey, frameMap] of Object.entries(overrides)) {
    const result = remapPathKeyedRecord(frameMap, remap);
    if (result.changed) changed = true;
    if (result.next && Object.keys(result.next).length > 0) next[frameKey] = result.next;
    else if (result.next === undefined) next[frameKey] = frameMap;
  }
  return changed ? next : overrides;
}

/**
 * Instance data needed to keep transforms identical when a Group disappears:
 * a promoted direct child's instance override must absorb the group's effective
 * matrix, and instances that only transformed the group itself need an explicit
 * direct-child override because the authored child matrix alone loses that
 * transform. Deeper overrides stay relative to their surviving parent, which
 * already carries the composed matrix.
 */
interface UngroupTransformComposition {
  readonly frameKey: string;
  readonly groupId: string;
  /** The group's own instance transform override for this authored frame. */
  readonly groupInstanceOverride: AffineMatrix2D | undefined;
  /** The group's authored local matrix (definition level). */
  readonly groupAuthoredTransform: AffineMatrix2D;
  readonly childAuthoredTransforms: ReadonlyMap<string, AffineMatrix2D>;
}

function composeFiniteMatrix(
  outer: AffineMatrix2D,
  inner: AffineMatrix2D,
): AffineMatrix2D | null {
  const composed = multiplyAffineMatrices(outer, inner);
  return [
    composed.a,
    composed.b,
    composed.c,
    composed.d,
    composed.tx,
    composed.ty,
  ].every(Number.isFinite)
    ? composed
    : null;
}

function affineMatricesEquivalent(left: AffineMatrix2D, right: AffineMatrix2D): boolean {
  return (['a', 'b', 'c', 'd', 'tx', 'ty'] as const).every(
    (key) => Math.abs(left[key] - right[key]) <= 1e-9,
  );
}

/**
 * Remaps one instance transform-override frame map. When `composition` is
 * present, an override for a child promoted to the removed group's position
 * absorbs the group's effective matrix; deeper overrides are only re-keyed
 * because their surviving parent keeps carrying the composed matrix.
 */
function remapInstanceTransformFrameMaps(
  map: Record<string, Record<string, AffineMatrix2D>> | undefined,
  remap: NodePathKeyRemap,
  composition: UngroupTransformComposition | undefined,
): Record<string, Record<string, AffineMatrix2D>> | undefined {
  if (!map) return undefined;
  let changed = false;
  const nextMap: Record<string, Record<string, AffineMatrix2D>> = {};
  for (const [frameKey, frameMap] of Object.entries(map)) {
    const isComposedFrame = composition !== undefined && frameKey === composition.frameKey;
    const groupEffective = isComposedFrame
      ? composition!.groupInstanceOverride ?? composition!.groupAuthoredTransform
      : undefined;
    let frameChanged = false;
    const nextFrame: Record<string, AffineMatrix2D> = {};
    for (const [pathKey, matrix] of Object.entries(frameMap)) {
      const mapped = remap(pathKey);
      if (mapped === null) {
        changed = true;
        frameChanged = true;
        continue;
      }
      let nextMatrix = matrix;
      if (isComposedFrame && groupEffective) {
        const parsed = parsePathKey(pathKey);
        // Only a direct child (`[groupId, childId]`) is promoted to the
        // removed group's position and must absorb its effective matrix.
        // Deeper paths keep their surviving parent, so composing the group
        // matrix again would apply it twice.
        if (parsed && parsed[0] === composition!.groupId && parsed.length === 2) {
          nextMatrix = composeFiniteMatrix(groupEffective, matrix) ?? matrix;
        }
      }
      const nextKey = mapped ?? pathKey;
      if (nextKey !== pathKey || nextMatrix !== matrix) frameChanged = true;
      nextFrame[nextKey] = nextMatrix;
    }
    // An instance that only overrode the group still has to carry those
    // children's effective matrices; otherwise ungroup would shift them.
    if (
      isComposedFrame &&
      composition!.groupInstanceOverride &&
      !affineMatricesEquivalent(composition!.groupInstanceOverride, composition!.groupAuthoredTransform)
    ) {
      for (const [childId, authored] of composition!.childAuthoredTransforms) {
        const childKey = JSON.stringify([childId]);
        if (nextFrame[childKey] !== undefined) continue;
        nextFrame[childKey] = composeFiniteMatrix(composition!.groupInstanceOverride, authored) ?? authored;
        frameChanged = true;
      }
    }
    if (frameChanged) changed = true;
    if (frameChanged) {
      // An emptied frame map is removed entirely; the override schema rejects
      // empty maps and an empty override set carries no authored data.
      if (Object.keys(nextFrame).length > 0) nextMap[frameKey] = nextFrame;
    } else {
      nextMap[frameKey] = frameMap;
    }
  }
  if (!changed) return map;
  return Object.keys(nextMap).length > 0 ? nextMap : undefined;
}

/** Remaps every instance override map of Layers that reference the Definition. */
function remapInstanceOverridePaths(
  project: Project,
  animationId: string,
  remap: NodePathKeyRemap,
  compositionFor?: (
    layer: Project['shots'][number]['layers'][number],
  ) => UngroupTransformComposition | undefined,
): Project {
  let changed = false;
  const shots = project.shots.map((shot) => {
    let shotChanged = false;
    const layers = shot.layers.map((layer) => {
      if (layer.source.kind !== 'animation' || layer.source.animationId !== animationId) {
        return layer;
      }
      const composition = compositionFor?.(layer);
      let layerChanged = false;
      const nextLayer = { ...layer };
      const remapFrameMaps = <T>(map: Record<string, Record<string, T>> | undefined):
        | Record<string, Record<string, T>>
        | undefined => {
        if (!map) return undefined;
        let mapChanged = false;
        const nextMap: Record<string, Record<string, T>> = {};
        for (const [frameKey, frameMap] of Object.entries(map)) {
          const result = remapPathKeyedRecord(frameMap, remap);
          if (result.changed) mapChanged = true;
          if (result.next) nextMap[frameKey] = result.next;
        }
        return mapChanged ? nextMap : map;
      };
      const transform = remapInstanceTransformFrameMaps(
        layer.flaGraphicInstanceTransformOverrides,
        remap,
        composition,
      );
      if (transform !== layer.flaGraphicInstanceTransformOverrides) {
        layerChanged = true;
        if (transform) nextLayer.flaGraphicInstanceTransformOverrides = transform;
        else delete nextLayer.flaGraphicInstanceTransformOverrides;
      }
      const shape = remapFrameMaps(layer.flaGraphicInstanceShapeOverrides);
      if (shape !== layer.flaGraphicInstanceShapeOverrides) {
        layerChanged = true;
        if (shape) nextLayer.flaGraphicInstanceShapeOverrides = shape;
        else delete nextLayer.flaGraphicInstanceShapeOverrides;
      }
      const text = remapFrameMaps(layer.flaGraphicInstanceTextOverrides);
      if (text !== layer.flaGraphicInstanceTextOverrides) {
        layerChanged = true;
        if (text) nextLayer.flaGraphicInstanceTextOverrides = text;
        else delete nextLayer.flaGraphicInstanceTextOverrides;
      }
      if (layerChanged) shotChanged = true;
      return layerChanged ? nextLayer : layer;
    });
    if (shotChanged) changed = true;
    return shotChanged ? { ...shot, layers } : shot;
  });
  return changed ? { ...project, shots } : project;
}

export interface GroupNativeGraphicNodesInput {
  readonly animationId: string;
  readonly frameOrdinal: number;
  /** Top-level node paths of one layer. */
  readonly nodePaths: readonly (readonly string[])[];
  readonly name?: string;
  readonly createId?: () => string;
}

export interface GroupNativeGraphicNodesResult {
  readonly project: Project;
  readonly groupPath: readonly string[];
}

/**
 * Groups selected top-level nodes of one authored layer into a native Group.
 * Node ids, identity aliases and internal-timeline tracks are preserved, so
 * grouping only changes draw grouping and the persisted node paths (which are
 * remapped for shape / instance overrides).
 */
export function groupNativeGraphicNodes(
  project: Project,
  input: GroupNativeGraphicNodesInput,
): GroupNativeGraphicNodesResult {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  const { frame, authoredOrdinal } = requireNativeAuthoredFrame(definition, input.frameOrdinal);
  if (input.nodePaths.length === 0) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_SELECTION_EMPTY',
      '请先选择至少一个节点。',
    );
  }
  const nodeIds: string[] = [];
  for (const nodePath of input.nodePaths) {
    if (nodePath.length !== 1) {
      throw new LayerServiceError(
        'NATIVE_GRAPHIC_GROUP_UNSUPPORTED',
        '组合仅支持同一图层的一级节点。',
      );
    }
    if (nodeIds.includes(nodePath[0]!)) {
      throw new LayerServiceError(
        'NATIVE_GRAPHIC_SELECTION_OVERLAP',
        '所选节点存在重复，请重新选择。',
      );
    }
    nodeIds.push(nodePath[0]!);
  }
  const layerIndex = frame.layers.findIndex((layer) =>
    nodeIds.every((nodeId) => layer.nodes.some((node) => node.id === nodeId)),
  );
  if (layerIndex < 0) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_GROUP_UNSUPPORTED',
      '组合仅支持同一图层的一级节点。',
    );
  }
  const layer = frame.layers[layerIndex]!;
  if (nodeIds.some((nodeId) => !layer.nodes.some((node) => node.id === nodeId))) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_NODE_NOT_FOUND',
      '找不到要组合的节点，请重新选择。',
    );
  }
  const selected = new Set(nodeIds);
  const selectedNodes = layer.nodes
    .filter((node) => selected.has(node.id))
    .sort((left, right) => left.drawOrder - right.drawOrder);
  const createId = input.createId ?? (() => crypto.randomUUID());
  const groupId = `native-group-${createId()}`.slice(0, 1_000);
  const groupNode: FlaGraphicStructureNode = {
    type: 'group',
    id: groupId,
    authored: 'native',
    drawOrder: 0,
    localTransform: { ...IDENTITY_MATRIX },
    groupId: input.name?.trim().slice(0, 1_000) || '分组',
    children: selectedNodes.map((node, index) => ({ ...node, drawOrder: index })),
  };
  const remaining = layer.nodes.filter((node) => !selected.has(node.id));
  const firstIndex = layer.nodes.findIndex((node) => selected.has(node.id));
  const insertIndex = remaining.filter(
    (node) => layer.nodes.indexOf(node) < firstIndex,
  ).length;
  const nextLayerNodes = reindexDrawOrder([
    ...remaining.slice(0, insertIndex),
    groupNode,
    ...remaining.slice(insertIndex),
  ]);
  const nextLayers = [...frame.layers];
  nextLayers[layerIndex] = { ...layer, nodes: nextLayerNodes };
  const nextStructure = replaceStructureFrameContent(
    definition.structure!,
    authoredOrdinal,
    { ...frame, layers: nextLayers },
  );
  const remap = (pathKey: string): string | null | undefined => {
    for (const nodeId of nodeIds) {
      const mapped = prependGroupToPathKey(pathKey, nodeId, groupId);
      if (mapped) return mapped;
    }
    return undefined;
  };
  const remappedProject = remapInstanceOverridePaths(project, definition.id, remap);
  const remappedOverrides = remapDefinitionShapeOverridePaths(definition, remap);
  const nextProject = commitNativeDefinition(remappedProject, definition.id, (current) => {
    const nextDefinition = { ...current, structure: nextStructure };
    if (remappedOverrides && Object.keys(remappedOverrides).length > 0) {
      nextDefinition.flaGraphicSharedShapeOverrides = remappedOverrides;
    } else {
      delete nextDefinition.flaGraphicSharedShapeOverrides;
    }
    return nextDefinition;
  });
  return { project: nextProject, groupPath: [groupId] };
}

export interface UngroupNativeGraphicNodeInput extends NativeGraphicLayerTarget {
  readonly nodePath: readonly string[];
}

export interface UngroupNativeGraphicNodeResult {
  readonly project: Project;
  /** Node paths of the children that replaced the group. */
  readonly nodePaths: readonly (readonly string[])[];
}

/**
 * Ungroups one top-level native Group. The group's authored matrix is composed
 * into each promoted child, and only the promoted direct children's instance
 * overrides absorb the group's effective matrix (its instance override, else the
 * authored matrix); deeper overrides are re-keyed only, because their surviving
 * parent already carries the composed matrix. The evaluated matrix before and
 * after ungroup is therefore identical for every instance.
 */
export function ungroupNativeGraphicNode(
  project: Project,
  input: UngroupNativeGraphicNodeInput,
): UngroupNativeGraphicNodeResult {
  const { definition } = resolveNativeEditableDefinition(project, input.animationId);
  const { frame, authoredOrdinal } = requireNativeAuthoredFrame(definition, input.frameOrdinal);
  if (input.nodePath.length !== 1) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_UNGROUP_UNSUPPORTED',
      '解组仅支持图层一级的分组。',
    );
  }
  const groupId = input.nodePath[0]!;
  const layerIndex = frame.layers.findIndex((layer) =>
    layer.nodes.some((node) => node.id === groupId),
  );
  if (layerIndex < 0) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_NODE_NOT_FOUND',
      '找不到要解组的节点，请重新选择。',
    );
  }
  const layer = frame.layers[layerIndex]!;
  const groupIndex = layer.nodes.findIndex((node) => node.id === groupId);
  const group = layer.nodes[groupIndex]!;
  if (group.type !== 'group') {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_UNGROUP_UNSUPPORTED',
      '所选节点不是分组，无法解组。',
    );
  }
  if (group.clipPaths && group.clipPaths.length > 0) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_UNGROUP_UNSUPPORTED',
      '带遮罩的分组暂不支持解组。',
    );
  }
  const structure = definition.structure!;
  const frameRootNodes = frame.layers.flatMap((candidate) => candidate.nodes);
  const resolveFrameTrackId = (node: FlaGraphicStructureNode): string | null =>
    resolveFlaGraphicStableNodeIdentity(node, structure, 'frame', null, frameRootNodes, authoredOrdinal);
  const ownsTimelineTrack = (node: FlaGraphicStructureNode): boolean => {
    const trackId = resolveFrameTrackId(node);
    return Boolean(
      trackId && structure.timeline?.tracks.some((track) => track.trackId === trackId),
    );
  };
  // A track stores a TRS matrix that replaces the node's authored transform, so
  // the group's matrix cannot be composed into it losslessly. Refuse instead of
  // silently dropping the animation or the group transform.
  if (ownsTimelineTrack(group)) {
    throw new LayerServiceError(
      'NATIVE_GRAPHIC_UNGROUP_UNSUPPORTED',
      '该分组含关键帧动画，暂不支持解组；请先删除分组上的关键帧后再试。',
    );
  }
  const frameKey = String(authoredOrdinal);
  const sharedFrameOverrides = definition.flaGraphicSharedShapeOverrides?.[frameKey];
  for (const child of group.children) {
    if (ownsTimelineTrack(child)) {
      throw new LayerServiceError(
        'NATIVE_GRAPHIC_UNGROUP_UNSUPPORTED',
        '分组内的子节点含关键帧动画，暂不支持解组；请先删除子节点上的关键帧后再试。',
      );
    }
    if (child.clipPaths && child.clipPaths.length > 0) {
      throw new LayerServiceError(
        'NATIVE_GRAPHIC_UNGROUP_UNSUPPORTED',
        '分组内的子节点带遮罩，暂不支持解组；请先移除遮罩后再试。',
      );
    }
    if (child.type === 'opaque' && child.fallbackScope === 'frame-crop') {
      throw new LayerServiceError(
        'NATIVE_GRAPHIC_UNGROUP_UNSUPPORTED',
        '分组内含帧裁剪降级内容，暂不支持解组。',
      );
    }
    const childOverrideKey = JSON.stringify([groupId, child.id]);
    if ((sharedFrameOverrides?.[childOverrideKey]?.extractedRegions.length ?? 0) > 0) {
      throw new LayerServiceError(
        'NATIVE_GRAPHIC_UNGROUP_UNSUPPORTED',
        '分组内含已拆分的独立区域，暂不支持解组；请先合并区域后再试。',
      );
    }
  }
  for (const shot of project.shots) {
    for (const candidate of shot.layers) {
      if (
        candidate.source.kind !== 'animation' ||
        candidate.source.animationId !== definition.id
      ) {
        continue;
      }
      const instanceFrame = candidate.flaGraphicInstanceShapeOverrides?.[frameKey];
      if (!instanceFrame) continue;
      for (const child of group.children) {
        const childOverrideKey = JSON.stringify([groupId, child.id]);
        if ((instanceFrame[childOverrideKey]?.extractedRegions.length ?? 0) > 0) {
          throw new LayerServiceError(
            'NATIVE_GRAPHIC_UNGROUP_UNSUPPORTED',
            '分组内含已拆分的独立区域，暂不支持解组；请先合并区域后再试。',
          );
        }
      }
    }
  }
  const children = [...group.children]
    .sort((left, right) => left.drawOrder - right.drawOrder)
    .map((child) => ({
      ...child,
      localTransform: multiplyAffineMatrices(group.localTransform, child.localTransform),
      ...(child.clipPaths
        ? {
            clipPaths: child.clipPaths.map((clipPath) => ({
              ...clipPath,
              shapes: clipPath.shapes.map((shape) =>
                shape.parentLocalTransform
                  ? {
                      ...shape,
                      parentLocalTransform: multiplyAffineMatrices(
                        group.localTransform,
                        shape.parentLocalTransform,
                      ),
                    }
                  : shape,
              ),
            })),
          }
        : {}),
    }));
  const nextLayerNodes = reindexDrawOrder([
    ...layer.nodes.slice(0, groupIndex),
    ...children,
    ...layer.nodes.slice(groupIndex + 1),
  ]);
  const nextLayers = [...frame.layers];
  nextLayers[layerIndex] = { ...layer, nodes: nextLayerNodes };
  const nextStructure = removeAliasEntries(
    replaceStructureFrameContent(structure, authoredOrdinal, {
      ...frame,
      layers: nextLayers,
    }),
    `frame:${authoredOrdinal}`,
    [groupId],
  );
  const remap = (pathKey: string): string | null | undefined =>
    removeFirstPathSegment(pathKey, groupId);
  const childAuthoredTransforms = new Map(
    group.children.map((child) => [child.id, child.localTransform] as const),
  );
  const remappedProject = remapInstanceOverridePaths(
    project,
    definition.id,
    remap,
    (candidate) => ({
      frameKey,
      groupId,
      groupInstanceOverride: candidate.flaGraphicInstanceTransformOverrides
        ?.[frameKey]?.[JSON.stringify([groupId])],
      groupAuthoredTransform: group.localTransform,
      childAuthoredTransforms,
    }),
  );
  const remappedOverrides = remapDefinitionShapeOverridePaths(definition, remap);
  const nextProject = commitNativeDefinition(remappedProject, definition.id, (current) => {
    const nextDefinition = { ...current, structure: nextStructure };
    if (remappedOverrides && Object.keys(remappedOverrides).length > 0) {
      nextDefinition.flaGraphicSharedShapeOverrides = remappedOverrides;
    } else {
      delete nextDefinition.flaGraphicSharedShapeOverrides;
    }
    return nextDefinition;
  });
  return {
    project: nextProject,
    nodePaths: children.map((child) => [child.id]),
  };
}