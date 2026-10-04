/**
 * P0-C01: Panda-owned, Main-side resolver for one already-selected FLA frame.
 *
 * This is an ephemeral composition model. It deliberately contains references
 * to shapes and bitmap library items, not parser objects, image bytes, project
 * data, paths, or renderer capabilities. The caller supplies painter-ordered
 * arrays and a concrete frame context; this module preserves that order
 * without selecting timeline frames or interpolating tweens (P1).
 */

export interface FlaDisplayListMatrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export const FLA_DISPLAY_LIST_IDENTITY_MATRIX: FlaDisplayListMatrix =
  Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

/**
 * The frame context is already selected by the caller. C01 resolves its
 * display list; it does not implement keyframe hold rules, Graphic frame
 * synchronization, frame ranges, or tween interpolation.
 */
export interface FlaDisplayListFrameContext {
  readonly frameIndex: number;
  /** Layers are supplied back-to-front in painter order; the resolver preserves it. */
  readonly layers: readonly FlaDisplayListLayer[];
}

export interface FlaDisplayListLayer {
  readonly name: string;
  readonly visible: boolean;
  readonly elements: readonly FlaDisplayListElement[];
}

export type FlaDisplayListElement =
  | {
      readonly kind: 'shape';
      readonly shapeId: string;
      /** Transform from this node's local space into its immediate parent. */
      readonly localTransform?: FlaDisplayListMatrix;
      readonly visible?: boolean;
    }
  | {
      readonly kind: 'bitmap';
      readonly libraryItemName: string;
      /** Transform from this node's local space into its immediate parent. */
      readonly localTransform?: FlaDisplayListMatrix;
      readonly visible?: boolean;
    }
  | {
      readonly kind: 'group';
      readonly groupId: string;
      /** Transform from this group’s local space into its immediate parent. */
      readonly localTransform?: FlaDisplayListMatrix;
      readonly visible?: boolean;
      readonly elements: readonly FlaDisplayListElement[];
    }
  | {
      readonly kind: 'symbol';
      readonly libraryItemName: string;
      readonly symbolType: 'graphic' | 'movieclip' | 'button';
      /** Transform from this instance’s local space into its immediate parent. */
      readonly localTransform?: FlaDisplayListMatrix;
      readonly visible?: boolean;
    };

export interface FlaGraphicSymbolDefinition {
  readonly kind: 'graphic';
  readonly libraryItemName: string;
  /** Concrete frame context for this definition; no frame selection occurs here. */
  readonly frameContext: FlaDisplayListFrameContext;
}

export type FlaDisplayListRoot =
  | {
      readonly kind: 'scene';
      readonly name: string;
      readonly frameContext: FlaDisplayListFrameContext;
    }
  | {
      readonly kind: 'graphic';
      readonly name: string;
      readonly frameContext: FlaDisplayListFrameContext;
    };

export interface FlaDisplayListResolverInput {
  readonly root: FlaDisplayListRoot;
  /** Exact source library-item name to Panda-owned Graphic definition. */
  readonly symbols: ReadonlyMap<string, FlaGraphicSymbolDefinition>;
}

export interface FlaDisplayListResolverLimits {
  /** Bounds nested groups and symbol expansion depth. */
  readonly maxRecursionDepth: number;
  /** Bounds emitted nodes and source nodes visited, including hidden nodes. */
  readonly maxResolvedNodeCount: number;
}

export const DEFAULT_FLA_DISPLAY_LIST_RESOLVER_LIMITS: FlaDisplayListResolverLimits =
  Object.freeze({
    maxRecursionDepth: 64,
    maxResolvedNodeCount: 100_000,
  });

export interface FlaResolvedShapeNode {
  readonly kind: 'shape';
  readonly shapeId: string;
  readonly worldTransform: FlaDisplayListMatrix;
}

export interface FlaResolvedBitmapNode {
  readonly kind: 'bitmap';
  readonly libraryItemName: string;
  readonly worldTransform: FlaDisplayListMatrix;
}

export interface FlaResolvedGroupNode {
  readonly kind: 'group';
  readonly groupId: string;
  readonly symbolLibraryItemName?: string;
  readonly worldTransform: FlaDisplayListMatrix;
  readonly children: readonly FlaResolvedDisplayNode[];
}

export type FlaResolvedDisplayNode =
  | FlaResolvedShapeNode
  | FlaResolvedBitmapNode
  | FlaResolvedGroupNode;

export interface FlaResolvedDisplayLayer {
  readonly name: string;
  readonly children: readonly FlaResolvedDisplayNode[];
}

export interface FlaResolvedDisplayList {
  readonly kind: 'scene' | 'graphic';
  readonly sourceName: string;
  readonly frameIndex: number;
  readonly layers: readonly FlaResolvedDisplayLayer[];
  readonly resolvedNodeCount: number;
}

export type FlaDisplayListResolverErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_MATRIX'
  | 'UNSUPPORTED_SYMBOL_TYPE'
  | 'MISSING_SYMBOL'
  | 'SYMBOL_CYCLE'
  | 'MAX_RECURSION_DEPTH_EXCEEDED'
  | 'MAX_RESOLVED_NODES_EXCEEDED';

export interface FlaDisplayListResolverFailure {
  readonly ok: false;
  readonly code: FlaDisplayListResolverErrorCode;
  readonly message: string;
  readonly sourcePath: string;
}

export type FlaDisplayListResolverResult =
  | { readonly ok: true; readonly displayList: FlaResolvedDisplayList }
  | FlaDisplayListResolverFailure;

interface ResolveContext {
  readonly input: FlaDisplayListResolverInput;
  readonly limits: FlaDisplayListResolverLimits;
  visitedNodeCount: number;
  resolvedNodeCount: number;
}

type ResolveNodesResult =
  | { readonly ok: true; readonly nodes: readonly FlaResolvedDisplayNode[] }
  | FlaDisplayListResolverFailure;

type ResolveLayersResult =
  | { readonly ok: true; readonly layers: readonly FlaResolvedDisplayLayer[] }
  | FlaDisplayListResolverFailure;

function failure(
  code: FlaDisplayListResolverErrorCode,
  message: string,
  sourcePath: string,
): FlaDisplayListResolverFailure {
  return { ok: false, code, message, sourcePath };
}

function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidFrameContext(frameContext: FlaDisplayListFrameContext): boolean {
  return Boolean(frameContext) &&
    Number.isSafeInteger(frameContext.frameIndex) &&
    frameContext.frameIndex >= 0 &&
    Array.isArray(frameContext.layers);
}

function isValidMatrix(matrix: FlaDisplayListMatrix): boolean {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]
    .every(Number.isFinite);
}

/** Affine composition in the frozen parent × local order. */
function composeTransforms(
  parent: FlaDisplayListMatrix,
  local: FlaDisplayListMatrix,
): FlaDisplayListMatrix {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
  };
}

function enterSourceNode(context: ResolveContext, sourcePath: string): FlaDisplayListResolverFailure | null {
  context.visitedNodeCount += 1;
  if (context.visitedNodeCount > context.limits.maxResolvedNodeCount) {
    return failure(
      'MAX_RESOLVED_NODES_EXCEEDED',
      `Display-list traversal exceeded ${context.limits.maxResolvedNodeCount} nodes`,
      sourcePath,
    );
  }
  return null;
}

function addResolvedNode(context: ResolveContext, sourcePath: string): FlaDisplayListResolverFailure | null {
  context.resolvedNodeCount += 1;
  if (context.resolvedNodeCount > context.limits.maxResolvedNodeCount) {
    return failure(
      'MAX_RESOLVED_NODES_EXCEEDED',
      `Resolved display list exceeded ${context.limits.maxResolvedNodeCount} nodes`,
      sourcePath,
    );
  }
  return null;
}

function resolveLayers(
  frameContext: FlaDisplayListFrameContext,
  parentTransform: FlaDisplayListMatrix,
  symbolStack: readonly string[],
  nestingDepth: number,
  sourcePath: string,
  context: ResolveContext,
): ResolveLayersResult {
  if (!isValidFrameContext(frameContext)) {
    return failure('INVALID_INPUT', 'Invalid selected frame context', sourcePath);
  }

  const layers: FlaResolvedDisplayLayer[] = [];
  for (let layerIndex = 0; layerIndex < frameContext.layers.length; layerIndex += 1) {
    const layer = frameContext.layers[layerIndex];
    const layerPath = `${sourcePath}/layer[${layerIndex}]`;
    const layerBudgetFailure = enterSourceNode(context, layerPath);
    if (layerBudgetFailure) return layerBudgetFailure;
    if (!layer) return failure('INVALID_INPUT', 'Missing layer entry', layerPath);
    if (!layer.visible) continue;

    const resolved = resolveElements(
      layer.elements,
      parentTransform,
      symbolStack,
      nestingDepth,
      `${layerPath}:${layer.name}`,
      context,
    );
    if (!resolved.ok) return resolved;
    layers.push({ name: layer.name, children: resolved.nodes });
  }
  return { ok: true, layers };
}

function resolveElements(
  elements: readonly FlaDisplayListElement[],
  parentTransform: FlaDisplayListMatrix,
  symbolStack: readonly string[],
  nestingDepth: number,
  sourcePath: string,
  context: ResolveContext,
): ResolveNodesResult {
  if (!Array.isArray(elements)) {
    return failure('INVALID_INPUT', 'Frame or group elements must be an array', sourcePath);
  }

  const nodes: FlaResolvedDisplayNode[] = [];
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex];
    const elementPath = `${sourcePath}/element[${elementIndex}]`;
    const nodeBudgetFailure = enterSourceNode(context, elementPath);
    if (nodeBudgetFailure) return nodeBudgetFailure;
    if (!element) return failure('INVALID_INPUT', 'Missing display element', elementPath);
    if (element.visible === false) continue;

    const localTransform = element.localTransform ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX;
    if (!isValidMatrix(localTransform)) {
      return failure('INVALID_MATRIX', 'Display element matrix contains a non-finite value', elementPath);
    }
    const worldTransform = composeTransforms(parentTransform, localTransform);
    if (!isValidMatrix(worldTransform)) {
      return failure('INVALID_MATRIX', 'Accumulated display element matrix is not finite', elementPath);
    }

    if (element.kind === 'shape') {
      if (!element.shapeId) return failure('INVALID_INPUT', 'Shape reference is empty', elementPath);
      const budgetFailure = addResolvedNode(context, elementPath);
      if (budgetFailure) return budgetFailure;
      nodes.push({ kind: 'shape', shapeId: element.shapeId, worldTransform });
      continue;
    }

    if (element.kind === 'bitmap') {
      if (!element.libraryItemName) return failure('INVALID_INPUT', 'Bitmap reference is empty', elementPath);
      const budgetFailure = addResolvedNode(context, elementPath);
      if (budgetFailure) return budgetFailure;
      nodes.push({ kind: 'bitmap', libraryItemName: element.libraryItemName, worldTransform });
      continue;
    }

    if (element.kind === 'group') {
      const nextDepth = nestingDepth + 1;
      if (nextDepth > context.limits.maxRecursionDepth) {
        return failure(
          'MAX_RECURSION_DEPTH_EXCEEDED',
          `Display-list nesting exceeded ${context.limits.maxRecursionDepth}`, elementPath,
        );
      }
      const budgetFailure = addResolvedNode(context, elementPath);
      if (budgetFailure) return budgetFailure;
      const children = resolveElements(
        element.elements,
        worldTransform,
        symbolStack,
        nextDepth,
        `${elementPath}:${element.groupId}`,
        context,
      );
      if (!children.ok) return children;
      nodes.push({ kind: 'group', groupId: element.groupId, worldTransform, children: children.nodes });
      continue;
    }

    if (element.symbolType !== 'graphic') {
      return failure(
        'UNSUPPORTED_SYMBOL_TYPE',
        `Only Graphic symbols are supported in C01: ${element.libraryItemName} (${element.symbolType})`,
        elementPath,
      );
    }
    if (!element.libraryItemName) {
      return failure('INVALID_INPUT', 'Graphic symbol reference is empty', elementPath);
    }
    if (symbolStack.includes(element.libraryItemName)) {
      return failure(
        'SYMBOL_CYCLE',
        `Graphic symbol cycle: ${[...symbolStack, element.libraryItemName].join(' -> ')}`,
        elementPath,
      );
    }
    const definition = context.input.symbols.get(element.libraryItemName);
    if (!definition) {
      return failure(
        'MISSING_SYMBOL',
        `Graphic symbol definition not found: ${element.libraryItemName}`,
        elementPath,
      );
    }
    if (definition.libraryItemName !== element.libraryItemName || definition.kind !== 'graphic') {
      return failure('INVALID_INPUT', 'Graphic symbol definition identity is inconsistent', elementPath);
    }

    const nextDepth = nestingDepth + 1;
    if (nextDepth > context.limits.maxRecursionDepth) {
      return failure(
        'MAX_RECURSION_DEPTH_EXCEEDED',
        `Symbol expansion exceeded ${context.limits.maxRecursionDepth}`, elementPath,
      );
    }
    const budgetFailure = addResolvedNode(context, elementPath);
    if (budgetFailure) return budgetFailure;
    const childLayers = resolveLayers(
      definition.frameContext,
      worldTransform,
      [...symbolStack, element.libraryItemName],
      nextDepth,
      `${elementPath}:symbol(${element.libraryItemName})`,
      context,
    );
    if (!childLayers.ok) return childLayers;
    nodes.push({
      kind: 'group',
      groupId: `symbol:${element.libraryItemName}`,
      symbolLibraryItemName: element.libraryItemName,
      worldTransform,
      children: childLayers.layers.flatMap((layer) => layer.children),
    });
  }
  return { ok: true, nodes };
}

/** Resolve one caller-selected scene or Graphic frame into an ordered tree. */
export function resolveFlaDisplayList(
  input: FlaDisplayListResolverInput,
  limits: Partial<FlaDisplayListResolverLimits> = {},
): FlaDisplayListResolverResult {
  const resolvedLimits = { ...DEFAULT_FLA_DISPLAY_LIST_RESOLVER_LIMITS, ...limits };
  if (!validLimit(resolvedLimits.maxRecursionDepth) || !validLimit(resolvedLimits.maxResolvedNodeCount)) {
    return failure('INVALID_INPUT', 'Resolver limits must be positive safe integers', 'root');
  }
  if (!input || !input.root || !input.root.name || !input.symbols ||
      typeof input.symbols.get !== 'function' ||
      (input.root.kind !== 'scene' && input.root.kind !== 'graphic')) {
    return failure('INVALID_INPUT', 'Resolver input requires a named root and symbol map', 'root');
  }

  const rootTransform = FLA_DISPLAY_LIST_IDENTITY_MATRIX;
  const rootSymbolStack = input.root.kind === 'graphic' ? [input.root.name] : [];
  const context: ResolveContext = {
    input,
    limits: resolvedLimits,
    visitedNodeCount: 0,
    resolvedNodeCount: 0,
  };
  const layers = resolveLayers(
    input.root.frameContext,
    rootTransform,
    rootSymbolStack,
    0,
    `${input.root.kind}(${input.root.name})`,
    context,
  );
  if (!layers.ok) return layers;
  return {
    ok: true,
    displayList: {
      kind: input.root.kind,
      sourceName: input.root.name,
      frameIndex: input.root.frameContext.frameIndex,
      layers: layers.layers,
      resolvedNodeCount: context.resolvedNodeCount,
    },
  };
}
