import type { AffineMatrix2D } from '../../shared/affine-matrix';
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
  FlaGraphicDefinitionSchema,
  isFlaGraphicDefinition,
  isNativeFlaGraphicDefinition,
  ProjectSchema,
  type FlaGraphicDefinition,
  type Project,
} from '../models';
import {
  FlaGraphicStructureSchema,
  type FlaGraphicStructure,
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
  requireFrame(definition, input.frameOrdinal);
  const leaves = editableLeavesFromSource(project, input.source);
  const structure = definition.structure!;
  const frame = structure.frames.find((candidate) => candidate.ordinal === input.frameOrdinal)!;
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
    const location = locateNodeInFrame(structure, input.frameOrdinal, input.afterNodePath);
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
        0,
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
    input.frameOrdinal,
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
  requireFrame(definition, input.frameOrdinal);
  const structure = definition.structure!;
  const location = locateNodeInFrame(structure, input.frameOrdinal, input.nodePath);
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
  if (built.shapeOverride) {
    shapeOverrides = insertShapeOverride(shapeOverrides, 0, [targetNode.id], built.shapeOverride);
  }
  const siblings = [...location.siblings];
  siblings[location.index] = built.node;
  const nextStructure = replaceSiblingsInStructure(
    structure,
    input.frameOrdinal,
    location,
    siblings,
  );
  return commitNativeStructure(project, definition.id, nextStructure, shapeOverrides);
}