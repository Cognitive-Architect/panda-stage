import {
  invertAffineMatrix,
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../../shared/affine-matrix';
import {
  evaluateFlaGraphicVisual,
  type EvaluatedFlaGraphicLayer,
  type EvaluatedFlaGraphicNode,
} from '../evaluate-fla-graphic';
import {
  CharacterPartTransformV22Schema,
  type CharacterPartTransform,
  type FlaGraphicDefinition,
} from '../models';

const MAX_POSE_VALUE = 1_000_000;
const IDENTITY_TRANSFORM: Readonly<CharacterPartTransform> = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

export type FlaGraphicAuthorPoseOrigin =
  | 'definition-frame'
  | 'sibling-graphic'
  | 'scene-frame';

export interface FlaGraphicAuthorPoseNode {
  readonly kind: 'group' | 'symbol' | 'bitmap' | 'opaque';
  readonly opaqueKind?: 'shape' | 'text' | 'filter' | 'symbol' | 'unknown';
  readonly sourceAddress?: string;
  readonly symbolRef?: string;
  readonly nestedDefinitionId?: string;
  readonly bitmapRef?: string;
  readonly sourceRef?: string;
  readonly groupId?: string;
  readonly regionRef?: string;
  readonly descendantProvenance?: readonly string[];
  readonly ancestorSymbolChain: readonly string[];
  readonly authoredWorldTransform: AffineMatrix2D;
  readonly drawOrderRank: number;
}

export interface FlaGraphicAuthorPoseReference {
  readonly origin: FlaGraphicAuthorPoseOrigin;
  readonly sourceLabel: string;
  readonly referenceFrameOrdinal?: number;
  readonly referenceSymbolRef?: string;
  readonly nodes: readonly FlaGraphicAuthorPoseNode[];
}

export type FlaGraphicAuthorPoseMatchBasis =
  | 'source-address'
  | 'ancestor-symbol-chain'
  | 'unique-symbol-ref'
  | 'unique-bitmap-ref'
  | 'unique-shape-ref'
  | 'unique-group-provenance';

export interface FlaGraphicAuthorPosePartCandidate {
  readonly partIndex: number;
  readonly selectionKey: string;
  readonly node: EvaluatedFlaGraphicNode;
  readonly ancestorSymbolChain: readonly string[];
  readonly authoredWorldTransform: AffineMatrix2D;
  readonly regionRef?: string;
}

export interface FlaGraphicAuthorPosePartPlacement {
  readonly partIndex: number;
  readonly selectionKey: string;
  readonly matchedBy: FlaGraphicAuthorPoseMatchBasis;
  readonly matchedReferenceOrigin: FlaGraphicAuthorPoseOrigin;
  readonly matchedReferenceLabel: string;
  readonly referenceDrawOrderRank: number;
  readonly restTransform: CharacterPartTransform;
  readonly sourceRestTransform: CharacterPartTransform;
}

export type FlaGraphicAuthorPoseSkipReason =
  | 'no-reference'
  | 'missing-source-identity'
  | 'ambiguous-source-identity'
  | 'ambiguous-reference-identity'
  | 'unmatched'
  | 'non-invertible-transform';

export interface FlaGraphicAuthorPoseResolution {
  readonly totalPartCount: number;
  readonly matchedCount: number;
  readonly matchedOrigin: FlaGraphicAuthorPoseOrigin | null;
  readonly matchedReferenceLabel: string | null;
  readonly placementsByPartIndex: ReadonlyMap<number, FlaGraphicAuthorPosePartPlacement>;
  readonly skippedReasons: ReadonlyMap<number, FlaGraphicAuthorPoseSkipReason>;
}

interface CandidatePoseDescriptor {
  readonly kind: FlaGraphicAuthorPoseNode['kind'];
  readonly opaqueKind?: FlaGraphicAuthorPoseNode['opaqueKind'];
  readonly sourceAddress?: string;
  readonly symbolRef?: string;
  readonly nestedDefinitionId?: string;
  readonly bitmapRef?: string;
  readonly sourceRef?: string;
  readonly regionRef?: string;
  readonly descendantProvenance: readonly string[];
  readonly ancestorSymbolChain: readonly string[];
  readonly authoredWorldTransform: AffineMatrix2D;
  readonly singleLeafChild?: {
    readonly primaryKey: string;
    readonly chainKey: string;
    readonly authoredWorldTransform: AffineMatrix2D;
    readonly matchBasis: FlaGraphicAuthorPoseMatchBasis;
  };
}

function isFiniteAffineMatrix(matrix: AffineMatrix2D): boolean {
  return (
    Number.isFinite(matrix.a) &&
    Number.isFinite(matrix.b) &&
    Number.isFinite(matrix.c) &&
    Number.isFinite(matrix.d) &&
    Number.isFinite(matrix.tx) &&
    Number.isFinite(matrix.ty)
  );
}

function isWithinSchemaBounds(matrix: AffineMatrix2D): boolean {
  return (
    Math.abs(matrix.a) <= MAX_POSE_VALUE &&
    Math.abs(matrix.b) <= MAX_POSE_VALUE &&
    Math.abs(matrix.c) <= MAX_POSE_VALUE &&
    Math.abs(matrix.d) <= MAX_POSE_VALUE &&
    Math.abs(matrix.tx) <= MAX_POSE_VALUE &&
    Math.abs(matrix.ty) <= MAX_POSE_VALUE
  );
}

function invertSafeMatrix(matrix: AffineMatrix2D): AffineMatrix2D | null {
  if (!isFiniteAffineMatrix(matrix)) return null;
  return invertAffineMatrix(matrix);
}

function isNearIdentityTransform(matrix: AffineMatrix2D, epsilon = 1e-3): boolean {
  return (
    Math.abs(matrix.a - 1) <= epsilon &&
    Math.abs(matrix.b) <= epsilon &&
    Math.abs(matrix.c) <= epsilon &&
    Math.abs(matrix.d - 1) <= epsilon &&
    Math.abs(matrix.tx) <= epsilon &&
    Math.abs(matrix.ty) <= epsilon
  );
}

function primaryProvenanceToken(node: {
  readonly kind: FlaGraphicAuthorPoseNode['kind'];
  readonly opaqueKind?: FlaGraphicAuthorPoseNode['opaqueKind'];
  readonly symbolRef?: string;
  readonly bitmapRef?: string;
  readonly sourceRef?: string;
  readonly regionRef?: string;
}): string | null {
  if (node.kind === 'symbol' && node.symbolRef) {
    return `symbol:${node.symbolRef}`;
  }
  if (node.kind === 'bitmap' && node.bitmapRef) {
    return `bitmap:${node.bitmapRef}`;
  }
  if (node.kind === 'opaque' && node.sourceRef) {
    if (node.regionRef) {
      return `shape-region:${node.opaqueKind ?? 'shape'}:${node.sourceRef}:${node.regionRef}`;
    }
    return `opaque:${node.opaqueKind ?? 'unknown'}:${node.sourceRef}`;
  }
  return null;
}

function collectEvaluatedDescendantProvenance(
  node: EvaluatedFlaGraphicNode,
): { readonly tokens: readonly string[]; readonly hasSourcelessLeaf: boolean } {
  if (node.source.type === 'symbol') {
    return { tokens: [`symbol:${node.source.symbolRef}`], hasSourcelessLeaf: false };
  }
  if (node.source.type === 'bitmap') {
    return { tokens: [`bitmap:${node.source.bitmapRef}`], hasSourcelessLeaf: false };
  }
  if (node.source.type === 'opaque') {
    if (!node.source.sourceRef) {
      return { tokens: [], hasSourcelessLeaf: true };
    }
    if (node.regionRef) {
      return {
        tokens: [`shape-region:${node.source.opaqueKind}:${node.source.sourceRef}:${node.regionRef}`],
        hasSourcelessLeaf: false,
      };
    }
    return {
      tokens: [`opaque:${node.source.opaqueKind}:${node.source.sourceRef}`],
      hasSourcelessLeaf: false,
    };
  }
  const tokens: string[] = [];
  let hasSourcelessLeaf = false;
  for (const child of node.children) {
    const childResult = collectEvaluatedDescendantProvenance(child);
    tokens.push(...childResult.tokens);
    if (childResult.hasSourcelessLeaf) hasSourcelessLeaf = true;
  }
  return { tokens: tokens.sort(), hasSourcelessLeaf };
}

function findSingleProvenanceLeafInEvaluated(
  node: EvaluatedFlaGraphicNode,
  parentAuthoredWorld: AffineMatrix2D,
  ancestorSymbolChain: readonly string[],
): {
  readonly authoredWorldTransform: AffineMatrix2D;
  readonly token: string;
  readonly chainKey: string;
  readonly matchBasis: FlaGraphicAuthorPoseMatchBasis;
} | null {
  let cursor: EvaluatedFlaGraphicNode = node;
  let world = parentAuthoredWorld;
  while (cursor.source.type === 'group') {
    if (cursor.children.length !== 1) return null;
    cursor = cursor.children[0]!;
    world = multiplyAffineMatrices(world, cursor.authoredLocalTransform);
  }
  const kind = cursor.source.type;
  const opaqueKind = cursor.source.type === 'opaque' ? cursor.source.opaqueKind : undefined;
  const token = primaryProvenanceToken({
    kind,
    opaqueKind,
    symbolRef: cursor.source.type === 'symbol' ? cursor.source.symbolRef : undefined,
    bitmapRef: cursor.source.type === 'bitmap' ? cursor.source.bitmapRef : undefined,
    sourceRef: cursor.source.type === 'opaque' ? cursor.source.sourceRef : undefined,
    regionRef: cursor.regionRef,
  });
  if (!token) return null;
  const matchBasis: FlaGraphicAuthorPoseMatchBasis =
    kind === 'symbol'
      ? 'unique-symbol-ref'
      : kind === 'bitmap'
        ? 'unique-bitmap-ref'
        : 'unique-shape-ref';
  return {
    authoredWorldTransform: world,
    token,
    chainKey: `${ancestorSymbolChain.join('>')}|${token}`,
    matchBasis,
  };
}

/**
 * Extracts flattened authored-pose nodes from evaluated Graphic layers while
 * accumulating parent authored world matrices without applying viewBox offsets.
 */
export function extractFlaAuthorPoseNodesFromLayers(
  layers: readonly EvaluatedFlaGraphicLayer[],
): readonly FlaGraphicAuthorPoseNode[] {
  const result: FlaGraphicAuthorPoseNode[] = [];
  let drawOrderRank = 0;

  const visit = (
    nodes: readonly EvaluatedFlaGraphicNode[],
    parentAuthoredWorld: AffineMatrix2D,
    ancestorSymbolChain: readonly string[],
  ): void => {
    for (const node of nodes) {
      const authoredWorldTransform = multiplyAffineMatrices(
        parentAuthoredWorld,
        node.authoredLocalTransform,
      );
      const currentRank = drawOrderRank;
      drawOrderRank += 1;

      const source = node.source;
      const provenance = collectEvaluatedDescendantProvenance(node);
      if (source.type === 'symbol') {
        result.push({
          kind: 'symbol',
          ...(source.sourceAddress ? { sourceAddress: source.sourceAddress } : {}),
          symbolRef: source.symbolRef,
          ...(source.nestedDefinitionId
            ? { nestedDefinitionId: source.nestedDefinitionId }
            : {}),
          ancestorSymbolChain,
          authoredWorldTransform,
          drawOrderRank: currentRank,
        });
        if (node.children.length > 0) {
          visit(node.children, authoredWorldTransform, [
            ...ancestorSymbolChain,
            `symbol:${source.symbolRef}`,
          ]);
        }
      } else if (source.type === 'bitmap') {
        result.push({
          kind: 'bitmap',
          ...(source.sourceAddress ? { sourceAddress: source.sourceAddress } : {}),
          bitmapRef: source.bitmapRef,
          ancestorSymbolChain,
          authoredWorldTransform,
          drawOrderRank: currentRank,
        });
      } else if (source.type === 'opaque') {
        result.push({
          kind: 'opaque',
          opaqueKind: source.opaqueKind,
          ...(source.sourceAddress ? { sourceAddress: source.sourceAddress } : {}),
          ...(source.sourceRef ? { sourceRef: source.sourceRef } : {}),
          ...(node.regionRef ? { regionRef: node.regionRef } : {}),
          ancestorSymbolChain,
          authoredWorldTransform,
          drawOrderRank: currentRank,
        });
      } else if (source.type === 'group') {
        result.push({
          kind: 'group',
          ...(source.sourceAddress ? { sourceAddress: source.sourceAddress } : {}),
          groupId: source.groupId,
          ...(!provenance.hasSourcelessLeaf && provenance.tokens.length > 0
            ? { descendantProvenance: provenance.tokens }
            : {}),
          ancestorSymbolChain,
          authoredWorldTransform,
          drawOrderRank: currentRank,
        });
        if (node.children.length > 0) {
          visit(node.children, authoredWorldTransform, ancestorSymbolChain);
        }
      }
    }
  };

  for (const layer of layers) {
    visit(layer.nodes, IDENTITY_TRANSFORM, []);
  }
  return result;
}

/**
 * Extracts bounded candidate author poses from other frames saved on the same
 * `FlaGraphicDefinition.structure` (other than `sourceFrameOrdinal`).
 */
export function extractFlaAuthorPoseReferencesFromDefinition(
  definition: FlaGraphicDefinition,
  sourceFrameOrdinal: number,
  maxFrames = 16,
): readonly FlaGraphicAuthorPoseReference[] {
  if (!definition.structure) return [];
  const references: FlaGraphicAuthorPoseReference[] = [];
  for (const frame of definition.structure.frames) {
    if (frame.ordinal === sourceFrameOrdinal) continue;
    if (references.length >= maxFrames) break;
    const evaluated = evaluateFlaGraphicVisual({
      definition,
      frameOrdinal: frame.ordinal,
      mode: 'definition',
    });
    if (!evaluated?.layers) continue;
    const nodes = extractFlaAuthorPoseNodesFromLayers(evaluated.layers);
    if (nodes.length === 0) continue;
    references.push({
      origin: 'definition-frame',
      sourceLabel: `${definition.name} 第 ${frame.ordinal + 1} 帧`,
      referenceFrameOrdinal: frame.ordinal,
      referenceSymbolRef: definition.source.targetName,
      nodes,
    });
  }
  return references;
}

/**
 * Computes the `CharacterPart` source/rest transform placing a Graphic subtree
 * Part from its authored source coordinates `sourceAuthoredWorld` to
 * `referenceAuthoredWorld` around `definitionAnchor`. Returns `null` if any
 * required matrix is singular/non-finite or exceeds schema bounds.
 */
export function computeFlaAuthorPosePartRestTransform(input: {
  readonly sourceRootTransform: CharacterPartTransform;
  readonly definitionAnchor: { readonly x: number; readonly y: number };
  readonly sourceAuthoredWorld: AffineMatrix2D;
  readonly referenceAuthoredWorld: AffineMatrix2D;
}): CharacterPartTransform | null {
  const invRoot = invertSafeMatrix(input.sourceRootTransform);
  const invSourceWorld = invertSafeMatrix(input.sourceAuthoredWorld);
  const invRefCheck = invertSafeMatrix(input.referenceAuthoredWorld);
  if (!invRoot || !invSourceWorld || !invRefCheck) {
    return null;
  }

  const toGraphicWorld: AffineMatrix2D = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: input.definitionAnchor.x,
    ty: input.definitionAnchor.y,
  };
  const fromGraphicWorld: AffineMatrix2D = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: -input.definitionAnchor.x,
    ty: -input.definitionAnchor.y,
  };

  // M = inv(sourceRoot) * T(-anchor) * W_ref * inv(W_src) * T(+anchor)
  const deltaWorld = multiplyAffineMatrices(input.referenceAuthoredWorld, invSourceWorld);
  const inSourceSpace = multiplyAffineMatrices(
    fromGraphicWorld,
    multiplyAffineMatrices(deltaWorld, toGraphicWorld),
  );
  const restTransform = multiplyAffineMatrices(invRoot, inSourceSpace);
  if (
    !isFiniteAffineMatrix(restTransform) ||
    !isWithinSchemaBounds(restTransform)
  ) {
    return null;
  }
  const parsed = CharacterPartTransformV22Schema.safeParse(restTransform);
  return parsed.success ? parsed.data : null;
}

function buildSourcePartDescriptor(
  candidate: FlaGraphicAuthorPosePartCandidate,
): {
  readonly descriptor: CandidatePoseDescriptor;
  readonly hasIdentity: boolean;
} {
  const source = candidate.node.source;
  const provenance = collectEvaluatedDescendantProvenance(candidate.node);
  const regionRef = candidate.regionRef ?? candidate.node.regionRef;
  const singleLeaf =
    source.type === 'group'
      ? findSingleProvenanceLeafInEvaluated(
          candidate.node,
          candidate.authoredWorldTransform,
          candidate.ancestorSymbolChain,
        )
      : null;

  const hasLeafIdentity =
    source.type === 'symbol' ||
    source.type === 'bitmap' ||
    (source.type === 'opaque' && Boolean(source.sourceRef));
  const hasGroupIdentity =
    source.type === 'group' &&
    !provenance.hasSourcelessLeaf &&
    provenance.tokens.length > 0;

  return {
    hasIdentity: hasLeafIdentity || hasGroupIdentity,
    descriptor: {
      kind: source.type,
      ...(source.type === 'opaque' ? { opaqueKind: source.opaqueKind } : {}),
      ...(source.sourceAddress ? { sourceAddress: source.sourceAddress } : {}),
      ...(source.type === 'symbol' ? { symbolRef: source.symbolRef } : {}),
      ...(source.type === 'symbol' && source.nestedDefinitionId
        ? { nestedDefinitionId: source.nestedDefinitionId }
        : {}),
      ...(source.type === 'bitmap' ? { bitmapRef: source.bitmapRef } : {}),
      ...(source.type === 'opaque' && source.sourceRef
        ? { sourceRef: source.sourceRef }
        : {}),
      ...(regionRef ? { regionRef } : {}),
      descendantProvenance: provenance.tokens,
      ancestorSymbolChain: candidate.ancestorSymbolChain,
      authoredWorldTransform: candidate.authoredWorldTransform,
      ...(singleLeaf
        ? {
            singleLeafChild: {
              primaryKey: singleLeaf.token,
              chainKey: singleLeaf.chainKey,
              authoredWorldTransform: singleLeaf.authoredWorldTransform,
              matchBasis: singleLeaf.matchBasis,
            },
          }
        : {}),
    },
  };
}

function incrementCount(map: Map<string, number>, key: string | null): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function indexUnique<T>(
  items: readonly T[],
  keyFn: (item: T) => string | null,
): {
  readonly uniqueByKey: ReadonlyMap<string, T>;
  readonly ambiguousKeys: ReadonlySet<string>;
} {
  const counts = new Map<string, number>();
  const firstByKey = new Map<string, T>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    incrementCount(counts, key);
    if (!firstByKey.has(key)) firstByKey.set(key, item);
  }
  const uniqueByKey = new Map<string, T>();
  const ambiguousKeys = new Set<string>();
  for (const [key, count] of counts) {
    if (count === 1) {
      uniqueByKey.set(key, firstByKey.get(key)!);
    } else if (count > 1) {
      ambiguousKeys.add(key);
    }
  }
  return { uniqueByKey, ambiguousKeys };
}

function sourceAddressKey(item: {
  readonly kind: FlaGraphicAuthorPoseNode['kind'];
  readonly opaqueKind?: FlaGraphicAuthorPoseNode['opaqueKind'];
  readonly sourceAddress?: string;
  readonly symbolRef?: string;
  readonly bitmapRef?: string;
  readonly sourceRef?: string;
  readonly regionRef?: string;
  readonly descendantProvenance?: readonly string[];
}): string | null {
  if (!item.sourceAddress) return null;
  if (item.kind === 'symbol' && item.symbolRef) {
    return `${item.sourceAddress}|symbol:${item.symbolRef}`;
  }
  if (item.kind === 'bitmap' && item.bitmapRef) {
    return `${item.sourceAddress}|bitmap:${item.bitmapRef}`;
  }
  if (item.kind === 'opaque' && item.sourceRef) {
    const region = item.regionRef ? `:${item.regionRef}` : '';
    return `${item.sourceAddress}|opaque:${item.opaqueKind ?? 'shape'}:${item.sourceRef}${region}`;
  }
  if (item.kind === 'group' && item.descendantProvenance?.length) {
    return `${item.sourceAddress}|group:${item.descendantProvenance.join('+')}`;
  }
  return null;
}

function chainIdentityKey(item: {
  readonly kind: FlaGraphicAuthorPoseNode['kind'];
  readonly opaqueKind?: FlaGraphicAuthorPoseNode['opaqueKind'];
  readonly symbolRef?: string;
  readonly bitmapRef?: string;
  readonly sourceRef?: string;
  readonly regionRef?: string;
  readonly ancestorSymbolChain: readonly string[];
}): string | null {
  if (item.ancestorSymbolChain.length === 0) return null;
  const primary = primaryProvenanceToken(item);
  if (!primary) return null;
  return `${item.ancestorSymbolChain.join('>')}|${primary}`;
}

function groupProvenanceKey(item: {
  readonly kind: FlaGraphicAuthorPoseNode['kind'];
  readonly descendantProvenance?: readonly string[];
}): string | null {
  if (item.kind !== 'group' || !item.descendantProvenance?.length) return null;
  return `group:${item.descendantProvenance.join('+')}`;
}

interface EvaluatedReferenceMatchResult {
  readonly reference: FlaGraphicAuthorPoseReference;
  readonly placements: readonly FlaGraphicAuthorPosePartPlacement[];
  readonly skippedReasons: ReadonlyMap<number, FlaGraphicAuthorPoseSkipReason>;
  readonly changedPartCount: number;
}

function matchCandidatesAgainstReference(input: {
  readonly sourceParts: readonly FlaGraphicAuthorPosePartCandidate[];
  readonly reference: FlaGraphicAuthorPoseReference;
  readonly sourceRootTransform: CharacterPartTransform;
  readonly definitionAnchor: { readonly x: number; readonly y: number };
}): EvaluatedReferenceMatchResult {
  const sourceEntries = input.sourceParts.map((candidate) => ({
    candidate,
    ...buildSourcePartDescriptor(candidate),
  }));

  const srcAddrIndex = indexUnique(sourceEntries, (entry) =>
    entry.hasIdentity ? sourceAddressKey(entry.descriptor) : null,
  );
  const srcChainIndex = indexUnique(sourceEntries, (entry) =>
    entry.hasIdentity ? chainIdentityKey(entry.descriptor) : null,
  );
  const srcPrimaryIndex = indexUnique(sourceEntries, (entry) =>
    entry.hasIdentity ? primaryProvenanceToken(entry.descriptor) : null,
  );
  const srcGroupIndex = indexUnique(sourceEntries, (entry) =>
    entry.hasIdentity ? groupProvenanceKey(entry.descriptor) : null,
  );

  // Also count how many source parts claim a leaf token (including unwrapped single-leaf groups)
  // so unwrapped matching cannot pair with a duplicate leaf present elsewhere in source.
  const srcAllLeafTokenCounts = new Map<string, number>();
  for (const entry of sourceEntries) {
    if (!entry.hasIdentity) continue;
    const direct = primaryProvenanceToken(entry.descriptor);
    if (direct) incrementCount(srcAllLeafTokenCounts, direct);
    else if (entry.descriptor.singleLeafChild) {
      incrementCount(srcAllLeafTokenCounts, entry.descriptor.singleLeafChild.primaryKey);
    }
  }

  const refNodes = input.reference.nodes;
  const refAddrIndex = indexUnique(refNodes, sourceAddressKey);
  const refChainIndex = indexUnique(refNodes, chainIdentityKey);
  const refPrimaryIndex = indexUnique(refNodes, primaryProvenanceToken);
  const refGroupIndex = indexUnique(refNodes, groupProvenanceKey);

  const placements: FlaGraphicAuthorPosePartPlacement[] = [];
  const skippedReasons = new Map<number, FlaGraphicAuthorPoseSkipReason>();
  const usedRefNodes = new Set<FlaGraphicAuthorPoseNode>();
  let changedPartCount = 0;

  for (const entry of sourceEntries) {
    const partIndex = entry.candidate.partIndex;
    if (!entry.hasIdentity) {
      skippedReasons.set(partIndex, 'missing-source-identity');
      continue;
    }

    const desc = entry.descriptor;
    let matchedRef: FlaGraphicAuthorPoseNode | null = null;
    let matchedBy: FlaGraphicAuthorPosePartPlacement['matchedBy'] | null = null;
    let effectiveSourceWorld = desc.authoredWorldTransform;
    let rejection: FlaGraphicAuthorPoseSkipReason = 'unmatched';

    // Tier 1: Exact sourceAddress + verified identity
    const addrKey = sourceAddressKey(desc);
    if (addrKey) {
      if (srcAddrIndex.ambiguousKeys.has(addrKey)) {
        rejection = 'ambiguous-source-identity';
      } else if (refAddrIndex.ambiguousKeys.has(addrKey)) {
        rejection = 'ambiguous-reference-identity';
      } else if (srcAddrIndex.uniqueByKey.has(addrKey) && refAddrIndex.uniqueByKey.has(addrKey)) {
        matchedRef = refAddrIndex.uniqueByKey.get(addrKey)!;
        matchedBy = 'source-address';
      }
    }

    // Tier 2: Traceable ancestor Symbol chain + primary leaf identity
    if (!matchedRef && rejection === 'unmatched') {
      const cKey = chainIdentityKey(desc);
      if (cKey) {
        if (srcChainIndex.ambiguousKeys.has(cKey)) {
          rejection = 'ambiguous-source-identity';
        } else if (refChainIndex.ambiguousKeys.has(cKey)) {
          rejection = 'ambiguous-reference-identity';
        } else if (srcChainIndex.uniqueByKey.has(cKey) && refChainIndex.uniqueByKey.has(cKey)) {
          matchedRef = refChainIndex.uniqueByKey.get(cKey)!;
          matchedBy = 'ancestor-symbol-chain';
        }
      }
    }

    // Tier 3: Global unique primary identity (symbolRef / bitmapRef / shape sourceRef)
    if (!matchedRef && rejection === 'unmatched') {
      const pKey = primaryProvenanceToken(desc);
      if (pKey) {
        if (srcPrimaryIndex.ambiguousKeys.has(pKey) || (srcAllLeafTokenCounts.get(pKey) ?? 0) > 1) {
          rejection = 'ambiguous-source-identity';
        } else if (refPrimaryIndex.ambiguousKeys.has(pKey)) {
          rejection = 'ambiguous-reference-identity';
        } else if (srcPrimaryIndex.uniqueByKey.has(pKey) && refPrimaryIndex.uniqueByKey.has(pKey)) {
          matchedRef = refPrimaryIndex.uniqueByKey.get(pKey)!;
          matchedBy =
            desc.kind === 'symbol'
              ? 'unique-symbol-ref'
              : desc.kind === 'bitmap'
                ? 'unique-bitmap-ref'
                : 'unique-shape-ref';
        }
      }
    }

    // Tier 4: Group with unique non-empty descendant provenance multiset
    if (!matchedRef && rejection === 'unmatched' && desc.kind === 'group') {
      const gKey = groupProvenanceKey(desc);
      if (gKey) {
        if (srcGroupIndex.ambiguousKeys.has(gKey)) {
          rejection = 'ambiguous-source-identity';
        } else if (refGroupIndex.ambiguousKeys.has(gKey)) {
          rejection = 'ambiguous-reference-identity';
        } else if (srcGroupIndex.uniqueByKey.has(gKey) && refGroupIndex.uniqueByKey.has(gKey)) {
          matchedRef = refGroupIndex.uniqueByKey.get(gKey)!;
          matchedBy = 'unique-group-provenance';
        } else if (desc.singleLeafChild) {
          const leafKey = desc.singleLeafChild.primaryKey;
          if ((srcAllLeafTokenCounts.get(leafKey) ?? 0) > 1) {
            rejection = 'ambiguous-source-identity';
          } else if (refPrimaryIndex.ambiguousKeys.has(leafKey)) {
            rejection = 'ambiguous-reference-identity';
          } else if (refPrimaryIndex.uniqueByKey.has(leafKey)) {
            matchedRef = refPrimaryIndex.uniqueByKey.get(leafKey)!;
            matchedBy = desc.singleLeafChild.matchBasis;
            effectiveSourceWorld = desc.singleLeafChild.authoredWorldTransform;
          }
        }
      }
    }

    if (!matchedRef || !matchedBy) {
      skippedReasons.set(partIndex, rejection);
      continue;
    }
    if (usedRefNodes.has(matchedRef)) {
      skippedReasons.set(partIndex, 'ambiguous-reference-identity');
      continue;
    }

    const restTransform = computeFlaAuthorPosePartRestTransform({
      sourceRootTransform: input.sourceRootTransform,
      definitionAnchor: input.definitionAnchor,
      sourceAuthoredWorld: effectiveSourceWorld,
      referenceAuthoredWorld: matchedRef.authoredWorldTransform,
    });
    if (!restTransform) {
      skippedReasons.set(partIndex, 'non-invertible-transform');
      continue;
    }

    usedRefNodes.add(matchedRef);
    if (!isNearIdentityTransform(restTransform)) {
      changedPartCount += 1;
    }
    placements.push({
      partIndex,
      selectionKey: entry.candidate.selectionKey,
      matchedBy,
      matchedReferenceOrigin: input.reference.origin,
      matchedReferenceLabel: input.reference.sourceLabel,
      referenceDrawOrderRank: matchedRef.drawOrderRank,
      restTransform,
      sourceRestTransform: restTransform,
    });
  }

  return {
    reference: input.reference,
    placements,
    skippedReasons,
    changedPartCount,
  };
}

function originPriorityRank(origin: FlaGraphicAuthorPoseOrigin): number {
  if (origin === 'definition-frame') return 0;
  if (origin === 'sibling-graphic') return 1;
  return 2;
}

/**
 * Resolves verified V2-A Author Pose placements for evaluated Graphic subtree
 * parts from intra-definition frames and/or bounded same-FLA references.
 * Never pairs ambiguous/duplicate symbols, sourceless nodes, or singular matrices.
 */
export function resolveFlaGraphicAuthorPosePlacements(input: {
  readonly sourceParts: readonly FlaGraphicAuthorPosePartCandidate[];
  readonly references: readonly FlaGraphicAuthorPoseReference[];
  readonly sourceRootTransform: CharacterPartTransform;
  readonly definitionAnchor: { readonly x: number; readonly y: number };
}): FlaGraphicAuthorPoseResolution {
  const totalPartCount = input.sourceParts.length;
  if (totalPartCount === 0 || input.references.length === 0) {
    const skippedReasons = new Map<number, FlaGraphicAuthorPoseSkipReason>();
    for (const part of input.sourceParts) {
      skippedReasons.set(part.partIndex, 'no-reference');
    }
    return {
      totalPartCount,
      matchedCount: 0,
      matchedOrigin: null,
      matchedReferenceLabel: null,
      placementsByPartIndex: new Map(),
      skippedReasons,
    };
  }

  const evaluated = input.references.map((reference) =>
    matchCandidatesAgainstReference({
      sourceParts: input.sourceParts,
      reference,
      sourceRootTransform: input.sourceRootTransform,
      definitionAnchor: input.definitionAnchor,
    }),
  );

  // Require at least 2 trusted part matches OR 1+ changed part when total >= 2;
  // prefer references that actually move parts out of scattered coordinates
  // over identical-pose duplicates (changedPartCount === 0).
  const usable = evaluated.filter((item) => item.placements.length > 0);
  if (usable.length === 0) {
    // Preserve informative skip reasons from the reference that had the richest diagnostics.
    const bestDiagnostic = evaluated[0];
    return {
      totalPartCount,
      matchedCount: 0,
      matchedOrigin: null,
      matchedReferenceLabel: null,
      placementsByPartIndex: new Map(),
      skippedReasons: bestDiagnostic?.skippedReasons ?? new Map(),
    };
  }

  const minRequiredForPose = Math.min(2, totalPartCount);
  const qualified = usable.filter(
    (item) => item.placements.length >= minRequiredForPose && item.changedPartCount > 0,
  );
  const pool = qualified.length > 0
    ? qualified
    : usable.filter((item) => item.changedPartCount > 0);

  if (pool.length === 0) {
    const skippedReasons = new Map<number, FlaGraphicAuthorPoseSkipReason>();
    for (const part of input.sourceParts) {
      skippedReasons.set(part.partIndex, 'no-reference');
    }
    return {
      totalPartCount,
      matchedCount: 0,
      matchedOrigin: null,
      matchedReferenceLabel: null,
      placementsByPartIndex: new Map(),
      skippedReasons,
    };
  }

  pool.sort((left, right) => {
    if (right.placements.length !== left.placements.length) {
      return right.placements.length - left.placements.length;
    }
    if (right.changedPartCount !== left.changedPartCount) {
      return right.changedPartCount - left.changedPartCount;
    }
    return originPriorityRank(left.reference.origin) - originPriorityRank(right.reference.origin);
  });

  const winner = pool[0]!;
  const placementsByPartIndex = new Map<number, FlaGraphicAuthorPosePartPlacement>();
  for (const placement of winner.placements) {
    placementsByPartIndex.set(placement.partIndex, placement);
  }
  return {
    totalPartCount,
    matchedCount: placementsByPartIndex.size,
    matchedOrigin: winner.reference.origin,
    matchedReferenceLabel: winner.reference.sourceLabel,
    placementsByPartIndex,
    skippedReasons: winner.skippedReasons,
  };
}
