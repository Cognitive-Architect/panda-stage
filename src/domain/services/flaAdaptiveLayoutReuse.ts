import {
  invertAffineMatrix,
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../../shared/affine-matrix';
import {
  evaluateFlaGraphicVisual,
  type EvaluatedFlaGraphicNode,
} from '../evaluate-fla-graphic';
import { characterPartPlacementForReplacement, characterPartSourceBounds, type CharacterPartSourceBounds } from '../geometry/characterPartLayout';
import {
  CharacterPartTransformV22Schema,
  isFlaGraphicDefinition,
  resolveCharacterPartVisualSource,
  type AdaptivePartsCharacter,
  type CharacterPart,
  type CharacterPartTransform,
  type FlaGraphicDefinition,
  type Project,
} from '../models';
import type { FlaGraphicAssetDimensionLike } from '../fla-graphic-subtree';

const IDENTITY_TRANSFORM: Readonly<CharacterPartTransform> = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

const MAX_POSE_VALUE = 1_000_000;
const MAX_TEMPLATE_SCALE_RATIO = 4;
const MIN_TEMPLATE_SCALE_RATIO = 0.25;
const MAX_TEMPLATE_ASPECT_RATIO = 2;

export type FlaGraphicSavedLayoutMatchBasis =
  | 'same-definition-node-path'
  | 'same-definition-provenance'
  | 'shared-symbol-ref'
  | 'shared-bitmap-ref'
  | 'shared-source-ref'
  | 'shared-group-provenance';

export interface FlaGraphicLayoutTemplatePartPlacement {
  readonly partIndex: number;
  readonly matchedTemplatePartId: string;
  readonly matchedBy: FlaGraphicSavedLayoutMatchBasis;
  readonly restTransform: CharacterPartTransform;
  readonly sourceRestTransform: CharacterPartTransform;
}

export interface FlaGraphicLayoutTemplateAssessment {
  readonly templateCharacterId: string;
  readonly templateCharacterName: string;
  readonly sameDefinition: boolean;
  readonly sameSourceArchive: boolean;
  readonly matchedPartCount: number;
  readonly changedPartCount: number;
  readonly templatePartCount: number;
}

export type FlaGraphicSavedLayoutSkipReason =
  | 'no-template'
  | 'multiple-templates'
  | 'locked-by-author-pose'
  | 'missing-source-identity'
  | 'ambiguous-identity'
  | 'missing-bounds'
  | 'size-mismatch'
  | 'non-invertible-transform'
  | 'unmatched';

export interface FlaGraphicSavedLayoutResolution {
  readonly totalCandidateCount: number;
  readonly availableTemplates: readonly FlaGraphicLayoutTemplateAssessment[];
  readonly selectedTemplate: FlaGraphicLayoutTemplateAssessment | null;
  readonly matchedCount: number;
  readonly placementsByPartIndex: ReadonlyMap<number, FlaGraphicLayoutTemplatePartPlacement>;
  readonly skippedReasons: ReadonlyMap<number, FlaGraphicSavedLayoutSkipReason>;
}

interface NodeProvenanceTrace {
  readonly kind: 'group' | 'symbol' | 'bitmap' | 'opaque';
  readonly opaqueKind?: 'shape' | 'text' | 'filter' | 'symbol' | 'unknown';
  readonly nodePath: readonly string[];
  readonly regionRef?: string;
  readonly symbolRef?: string;
  readonly bitmapRef?: string;
  readonly sourceRef?: string;
  readonly ancestorSymbolChain: readonly string[];
  readonly descendantProvenance: readonly string[];
  readonly hasSourcelessLeaf: boolean;
}

function isFiniteAffine(matrix: AffineMatrix2D): boolean {
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

function isInvertibleFinite(matrix: AffineMatrix2D): boolean {
  return isFiniteAffine(matrix) && invertAffineMatrix(matrix) !== null;
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

function collectNodeDescendantProvenance(node: EvaluatedFlaGraphicNode): {
  readonly tokens: readonly string[];
  readonly hasSourcelessLeaf: boolean;
} {
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
    const res = collectNodeDescendantProvenance(child);
    tokens.push(...res.tokens);
    if (res.hasSourcelessLeaf) hasSourcelessLeaf = true;
  }
  return { tokens: tokens.sort(), hasSourcelessLeaf };
}

function findNodeTraceInEvaluated(
  layers: readonly { readonly nodes: readonly EvaluatedFlaGraphicNode[] }[],
  nodePath: readonly string[],
  regionRef?: string,
): NodeProvenanceTrace | null {
  const visit = (
    nodes: readonly EvaluatedFlaGraphicNode[],
    ancestorSymbolChain: readonly string[],
  ): NodeProvenanceTrace | null => {
    for (const node of nodes) {
      const samePath =
        node.path.length === nodePath.length &&
        node.path.every((seg, i) => seg === nodePath[i]);
      if (samePath) {
        const desc = collectNodeDescendantProvenance(node);
        return {
          kind: node.source.type,
          ...(node.source.type === 'opaque' ? { opaqueKind: node.source.opaqueKind } : {}),
          nodePath,
          ...(regionRef ?? node.regionRef ? { regionRef: regionRef ?? node.regionRef } : {}),
          ...(node.source.type === 'symbol' ? { symbolRef: node.source.symbolRef } : {}),
          ...(node.source.type === 'bitmap' ? { bitmapRef: node.source.bitmapRef } : {}),
          ...(node.source.type === 'opaque' && node.source.sourceRef
            ? { sourceRef: node.source.sourceRef }
            : {}),
          ancestorSymbolChain,
          descendantProvenance: desc.tokens,
          hasSourcelessLeaf: desc.hasSourcelessLeaf,
        };
      }
      if (node.children.length > 0) {
        const nextChain =
          node.source.type === 'symbol'
            ? [...ancestorSymbolChain, `symbol:${node.source.symbolRef}`]
            : ancestorSymbolChain;
        const hit = visit(node.children, nextChain);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const layer of layers) {
    const hit = visit(layer.nodes, []);
    if (hit) return hit;
  }
  return null;
}

function provenanceKeyForTrace(
  trace: NodeProvenanceTrace,
  allowArchiveLocalShapeRef: boolean,
): {
  readonly key: string | null;
  readonly basis: FlaGraphicSavedLayoutMatchBasis | null;
} {
  const chainPrefix = trace.ancestorSymbolChain.join('>');
  if (trace.kind === 'symbol' && trace.symbolRef) {
    return {
      key: `${chainPrefix}|symbol:${trace.symbolRef}`,
      basis: 'shared-symbol-ref',
    };
  }
  if (trace.kind === 'bitmap' && trace.bitmapRef) {
    return {
      key: `${chainPrefix}|bitmap:${trace.bitmapRef}`,
      basis: 'shared-bitmap-ref',
    };
  }
  if (trace.kind === 'opaque' && trace.sourceRef && allowArchiveLocalShapeRef) {
    const region = trace.regionRef ? `:${trace.regionRef}` : '';
    return {
      key: `${chainPrefix}|opaque:${trace.opaqueKind ?? 'shape'}:${trace.sourceRef}${region}`,
      basis: 'shared-source-ref',
    };
  }
  if (
    trace.kind === 'group' &&
    !trace.hasSourcelessLeaf &&
    trace.descendantProvenance.length > 0
  ) {
    const hasNonShapeOnly = trace.descendantProvenance.some(
      (token) => token.startsWith('symbol:') || token.startsWith('bitmap:'),
    );
    if (!allowArchiveLocalShapeRef && !hasNonShapeOnly) {
      return { key: null, basis: null };
    }
    return {
      key: `${chainPrefix}|group:${trace.descendantProvenance.join('+')}`,
      basis: 'shared-group-provenance',
    };
  }
  return { key: null, basis: null };
}

function sameNodePathKey(nodePath: readonly string[], regionRef?: string): string {
  return regionRef ? `${nodePath.join('\u0000')}#${regionRef}` : nodePath.join('\u0000');
}

function indexUniqueMap<T>(
  items: readonly T[],
  keyOf: (item: T) => string | null,
): {
  readonly unique: ReadonlyMap<string, T>;
  readonly ambiguous: ReadonlySet<string>;
} {
  const counts = new Map<string, number>();
  const first = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!first.has(key)) first.set(key, item);
  }
  const unique = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const [key, count] of counts) {
    if (count === 1) unique.set(key, first.get(key)!);
    else ambiguous.add(key);
  }
  return { unique, ambiguous };
}

function boundsCompatibleForTemplate(
  targetBounds: CharacterPartSourceBounds,
  templateBounds: CharacterPartSourceBounds,
  templatePose: AffineMatrix2D,
): boolean {
  const sx = Math.hypot(templatePose.a, templatePose.b);
  const sy = Math.hypot(templatePose.c, templatePose.d);
  const tplVisualW = templateBounds.width * sx;
  const tplVisualH = templateBounds.height * sy;
  if (
    !Number.isFinite(tplVisualW) ||
    !Number.isFinite(tplVisualH) ||
    tplVisualW <= 1e-3 ||
    tplVisualH <= 1e-3
  ) {
    return false;
  }
  const ratioW = tplVisualW / targetBounds.width;
  const ratioH = tplVisualH / targetBounds.height;
  if (
    !Number.isFinite(ratioW) ||
    !Number.isFinite(ratioH) ||
    ratioW > MAX_TEMPLATE_SCALE_RATIO ||
    ratioH > MAX_TEMPLATE_SCALE_RATIO ||
    ratioW < MIN_TEMPLATE_SCALE_RATIO ||
    ratioH < MIN_TEMPLATE_SCALE_RATIO
  ) {
    return false;
  }
  const aspectDistortion = Math.max(ratioW / ratioH, ratioH / ratioW);
  return Number.isFinite(aspectDistortion) && aspectDistortion <= MAX_TEMPLATE_ASPECT_RATIO;
}

function transformPoint2D(
  m: AffineMatrix2D,
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  return {
    x: m.a * x + m.c * y + m.tx,
    y: m.b * x + m.d * y + m.ty,
  };
}

function computeTemplateAlignedPartTransform(input: {
  readonly targetSourceRootTransform: CharacterPartTransform;
  readonly targetBounds: CharacterPartSourceBounds;
  readonly templateSourceRootTransform: CharacterPartTransform;
  readonly templateRestTransform: CharacterPartTransform;
  readonly templateBounds: CharacterPartSourceBounds;
  readonly anchorOffset: { readonly x: number; readonly y: number };
}): CharacterPartTransform | null {
  const invTargetRoot = invertAffineMatrix(input.targetSourceRootTransform);
  const invTemplateRoot = invertAffineMatrix(input.templateSourceRootTransform);
  const invTemplateRest = invertAffineMatrix(input.templateRestTransform);
  if (!invTargetRoot || !invTemplateRoot || !invTemplateRest) return null;

  const tplPose = multiplyAffineMatrices(
    input.templateSourceRootTransform,
    input.templateRestTransform,
  );
  if (!isInvertibleFinite(tplPose)) return null;

  const isUprightUniform =
    Math.abs(tplPose.b) < 1e-5 &&
    Math.abs(tplPose.c) < 1e-5 &&
    tplPose.a > 0 &&
    tplPose.d > 0 &&
    Math.abs(tplPose.a - tplPose.d) < 1e-3;

  let desiredPose: AffineMatrix2D;
  if (isUprightUniform) {
    // Delegate standard upright/scaled placement directly to the formal replacement helper.
    const replaced = characterPartPlacementForReplacement({
      sourceRootTransform: input.templateSourceRootTransform,
      oldRestTransform: input.templateRestTransform,
      oldBounds: input.templateBounds,
      newBounds: input.targetBounds,
    });
    const basePose = multiplyAffineMatrices(
      input.templateSourceRootTransform,
      replaced.restTransform,
    );
    desiredPose = {
      ...basePose,
      tx: basePose.tx + input.anchorOffset.x,
      ty: basePose.ty + input.anchorOffset.y,
    };
  } else {
    // Preserve template rotation, reflection/mirror, or anisotropic scale while
    // mapping target bounds center onto the template's visual center.
    const tplCenter = transformPoint2D(
      tplPose,
      input.templateBounds.x + input.templateBounds.width / 2,
      input.templateBounds.y + input.templateBounds.height / 2,
    );
    const widthScaleAdjust =
      input.targetBounds.width > 0 ? input.templateBounds.width / input.targetBounds.width : 1;
    const heightScaleAdjust =
      input.targetBounds.height > 0 ? input.templateBounds.height / input.targetBounds.height : 1;
    const uniformAdjust = (widthScaleAdjust + heightScaleAdjust) / 2;
    const a = tplPose.a * uniformAdjust;
    const b = tplPose.b * uniformAdjust;
    const c = tplPose.c * uniformAdjust;
    const d = tplPose.d * uniformAdjust;
    const newCenterX = input.targetBounds.x + input.targetBounds.width / 2;
    const newCenterY = input.targetBounds.y + input.targetBounds.height / 2;
    const targetCenterX = tplCenter.x + input.anchorOffset.x;
    const targetCenterY = tplCenter.y + input.anchorOffset.y;
    desiredPose = {
      a,
      b,
      c,
      d,
      tx: targetCenterX - (a * newCenterX + c * newCenterY),
      ty: targetCenterY - (b * newCenterX + d * newCenterY),
    };
  }

  const restTransform = multiplyAffineMatrices(invTargetRoot, desiredPose);
  if (!isFiniteAffine(restTransform) || !isWithinSchemaBounds(restTransform)) {
    return null;
  }
  const parsed = CharacterPartTransformV22Schema.safeParse(restTransform);
  return parsed.success ? parsed.data : null;
}

interface TargetPartDescriptor {
  readonly partIndex: number;
  readonly part: Pick<CharacterPart, 'partId' | 'visualSource' | 'restTransform' | 'sourceRestTransform'>;
  readonly bounds: CharacterPartSourceBounds | null;
  readonly trace: NodeProvenanceTrace | null;
  readonly lockedByAuthorPose: boolean;
}

interface TemplatePartDescriptor {
  readonly part: CharacterPart;
  readonly definition: FlaGraphicDefinition;
  readonly sameDefinition: boolean;
  readonly sameSourceArchive: boolean;
  readonly bounds: CharacterPartSourceBounds | null;
  readonly trace: NodeProvenanceTrace | null;
}

function boundingCenterOfPoints(
  points: readonly { readonly x: number; readonly y: number }[],
): { readonly x: number; readonly y: number } | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

interface EvaluatedTemplateCandidate {
  readonly assessment: FlaGraphicLayoutTemplateAssessment;
  readonly placementsByPartIndex: Map<number, FlaGraphicLayoutTemplatePartPlacement>;
  readonly skippedReasons: Map<number, FlaGraphicSavedLayoutSkipReason>;
}

function evaluateTemplateCharacter(input: {
  readonly template: AdaptivePartsCharacter;
  readonly targetDefinition: FlaGraphicDefinition;
  readonly targetDescriptors: readonly TargetPartDescriptor[];
  readonly targetSourceRootTransform: CharacterPartTransform;
  readonly animations: Project['animations'];
  readonly assets: readonly FlaGraphicAssetDimensionLike[];
}): EvaluatedTemplateCandidate | null {
  if (!isInvertibleFinite(input.template.sourceRootTransform)) {
    return null;
  }
  // Cache evaluated Graphic visuals per template definition frame.
  const evaluatedCache = new Map<string, ReturnType<typeof evaluateFlaGraphicVisual>>();
  const templateParts: TemplatePartDescriptor[] = [];

  for (const part of input.template.parts) {
    const visualSource = resolveCharacterPartVisualSource(part);
    if (visualSource.kind !== 'fla-graphic' || !visualSource.nodePath?.length) continue;
    const def = input.animations.find(
      (candidate): candidate is FlaGraphicDefinition =>
        isFlaGraphicDefinition(candidate) && candidate.id === visualSource.animationId,
    );
    if (!def || !def.structure) continue;
    const frameOrd = visualSource.poseFrameOrdinal ?? def.frames[0]?.ordinal ?? 0;
    const cacheKey = `${def.id}:${frameOrd}`;
    let evaluated = evaluatedCache.get(cacheKey);
    if (evaluated === undefined) {
      evaluated = evaluateFlaGraphicVisual({
        definition: def,
        frameOrdinal: frameOrd,
        mode: 'instance',
      });
      evaluatedCache.set(cacheKey, evaluated);
    }
    const trace = evaluated?.layers
      ? findNodeTraceInEvaluated(evaluated.layers, visualSource.nodePath, visualSource.regionRef)
      : null;
    const bounds = characterPartSourceBounds(part, input.animations, input.assets);
    const sameDefinition = def.id === input.targetDefinition.id;
    const sameSourceArchive = def.source.sha256 === input.targetDefinition.source.sha256;
    // Never automatically reuse saved layouts across different FLA archives without verified same-definition or same-SHA provenance.
    if (!sameDefinition && !sameSourceArchive) {
      continue;
    }
    templateParts.push({
      part,
      definition: def,
      sameDefinition,
      sameSourceArchive,
      bounds,
      trace,
    });
  }

  if (templateParts.length < 2) return null;

  const allowSameArchiveShapes = templateParts.some((item) => item.sameSourceArchive);

  // Build uniqueness indices across ALL target parts (including A-locked parts!) so we never
  // ambiguously pair a duplicate part with the remaining copy after A locked the other.
  const tgtNodePathIdx = indexUniqueMap(input.targetDescriptors, (item) =>
    item.trace ? sameNodePathKey(item.trace.nodePath, item.trace.regionRef) : null,
  );
  const tgtProvIdx = indexUniqueMap(input.targetDescriptors, (item) =>
    item.trace ? provenanceKeyForTrace(item.trace, allowSameArchiveShapes).key : null,
  );

  const tplNodePathIdx = indexUniqueMap(templateParts, (item) =>
    item.sameDefinition && item.trace
      ? sameNodePathKey(item.trace.nodePath, item.trace.regionRef)
      : null,
  );
  const tplProvIdx = indexUniqueMap(templateParts, (item) =>
    item.trace ? provenanceKeyForTrace(item.trace, item.sameSourceArchive).key : null,
  );

  interface PairedPart {
    readonly target: TargetPartDescriptor;
    readonly template: TemplatePartDescriptor;
    readonly matchedBy: FlaGraphicSavedLayoutMatchBasis;
  }

  const pairs: PairedPart[] = [];
  const skippedReasons = new Map<number, FlaGraphicSavedLayoutSkipReason>();
  const usedTemplatePartIds = new Set<string>();

  for (const tgt of input.targetDescriptors) {
    if (!tgt.trace) {
      if (!tgt.lockedByAuthorPose) {
        skippedReasons.set(tgt.partIndex, 'missing-source-identity');
      }
      continue;
    }

    let matchedTpl: TemplatePartDescriptor | null = null;
    let matchedBy: FlaGraphicSavedLayoutMatchBasis | null = null;
    let rejection: FlaGraphicSavedLayoutSkipReason = 'unmatched';

    const pathKey = sameNodePathKey(tgt.trace.nodePath, tgt.trace.regionRef);
    if (tplNodePathIdx.unique.has(pathKey) || tplNodePathIdx.ambiguous.has(pathKey)) {
      if (tgtNodePathIdx.ambiguous.has(pathKey) || tplNodePathIdx.ambiguous.has(pathKey)) {
        rejection = 'ambiguous-identity';
      } else if (tgtNodePathIdx.unique.has(pathKey) && tplNodePathIdx.unique.has(pathKey)) {
        matchedTpl = tplNodePathIdx.unique.get(pathKey)!;
        matchedBy = 'same-definition-node-path';
      }
    }

    if (!matchedTpl && rejection === 'unmatched') {
      const prov = provenanceKeyForTrace(tgt.trace, allowSameArchiveShapes);
      if (!prov.key || !prov.basis) {
        rejection = 'missing-source-identity';
      } else if (tgtProvIdx.ambiguous.has(prov.key) || tplProvIdx.ambiguous.has(prov.key)) {
        rejection = 'ambiguous-identity';
      } else if (tgtProvIdx.unique.has(prov.key) && tplProvIdx.unique.has(prov.key)) {
        const candidateTpl = tplProvIdx.unique.get(prov.key)!;
        matchedTpl = candidateTpl;
        matchedBy = candidateTpl.sameDefinition
          ? 'same-definition-provenance'
          : prov.basis;
      }
    }

    if (!matchedTpl || !matchedBy || usedTemplatePartIds.has(matchedTpl.part.partId)) {
      if (!tgt.lockedByAuthorPose) {
        skippedReasons.set(tgt.partIndex, rejection);
      }
      continue;
    }

    if (!tgt.bounds || !matchedTpl.bounds) {
      if (!tgt.lockedByAuthorPose) {
        skippedReasons.set(tgt.partIndex, 'missing-bounds');
      }
      continue;
    }

    if (!isInvertibleFinite(matchedTpl.part.restTransform)) {
      if (!tgt.lockedByAuthorPose) {
        skippedReasons.set(tgt.partIndex, 'non-invertible-transform');
      }
      continue;
    }

    const tplPose = multiplyAffineMatrices(
      input.template.sourceRootTransform,
      matchedTpl.part.restTransform,
    );
    if (!isInvertibleFinite(tplPose)) {
      if (!tgt.lockedByAuthorPose) {
        skippedReasons.set(tgt.partIndex, 'non-invertible-transform');
      }
      continue;
    }

    if (!boundsCompatibleForTemplate(tgt.bounds, matchedTpl.bounds, tplPose)) {
      if (!tgt.lockedByAuthorPose) {
        skippedReasons.set(tgt.partIndex, 'size-mismatch');
      }
      continue;
    }

    usedTemplatePartIds.add(matchedTpl.part.partId);
    pairs.push({ target: tgt, template: matchedTpl, matchedBy });
  }

  // Compute alignment offset between template's character space and target's coordinate space:
  // 1) If V2-A already placed any overlapping paired parts, match A's skeleton frame.
  // 2) Else if template uses a different Graphic Definition, align template visual center onto target scattered center
  //    so unmatched target parts stay nearby instead of drifting to an unrelated document origin.
  // 3) For pure same-definition layout without A-locked anchors, keep exact zero offset when template already
  //    lives in target definition's coordinate frame.
  const overlappingAnchors = pairs.filter((pair) => pair.target.lockedByAuthorPose);
  let anchorOffset = { x: 0, y: 0 };

  if (overlappingAnchors.length > 0) {
    const deltas = overlappingAnchors.map((pair) => {
      const aPose = multiplyAffineMatrices(
        input.targetSourceRootTransform,
        pair.target.part.restTransform,
      );
      const tPose = multiplyAffineMatrices(
        input.template.sourceRootTransform,
        pair.template.part.restTransform,
      );
      const aCenter = transformPoint2D(
        aPose,
        pair.target.bounds!.x + pair.target.bounds!.width / 2,
        pair.target.bounds!.y + pair.target.bounds!.height / 2,
      );
      const tCenter = transformPoint2D(
        tPose,
        pair.template.bounds!.x + pair.template.bounds!.width / 2,
        pair.template.bounds!.y + pair.template.bounds!.height / 2,
      );
      return { x: aCenter.x - tCenter.x, y: aCenter.y - tCenter.y };
    });
    anchorOffset = {
      x: deltas.reduce((s, d) => s + d.x, 0) / deltas.length,
      y: deltas.reduce((s, d) => s + d.y, 0) / deltas.length,
    };
  } else {
    const anyUnlockedDifferentDef = pairs.some(
      (pair) => !pair.target.lockedByAuthorPose && !pair.template.sameDefinition,
    );
    if (anyUnlockedDifferentDef) {
      const targetCenters = pairs
        .filter((pair) => !pair.target.lockedByAuthorPose && pair.target.bounds)
        .map((pair) => {
          const b = pair.target.bounds!;
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        });
      const tplCenters = pairs
        .filter((pair) => !pair.target.lockedByAuthorPose && pair.template.bounds)
        .map((pair) => {
          const tPose = multiplyAffineMatrices(
            input.template.sourceRootTransform,
            pair.template.part.restTransform,
          );
          const b = pair.template.bounds!;
          return transformPoint2D(tPose, b.x + b.width / 2, b.y + b.height / 2);
        });
      const tgtCenter = boundingCenterOfPoints(targetCenters);
      const tplCenter = boundingCenterOfPoints(tplCenters);
      if (tgtCenter && tplCenter) {
        anchorOffset = {
          x: tgtCenter.x - tplCenter.x,
          y: tgtCenter.y - tplCenter.y,
        };
      }
    }
  }

  const placementsByPartIndex = new Map<number, FlaGraphicLayoutTemplatePartPlacement>();
  let changedPartCount = 0;

  for (const pair of pairs) {
    if (pair.target.lockedByAuthorPose) {
      skippedReasons.set(pair.target.partIndex, 'locked-by-author-pose');
      continue;
    }
    const restTransform = computeTemplateAlignedPartTransform({
      targetSourceRootTransform: input.targetSourceRootTransform,
      targetBounds: pair.target.bounds!,
      templateSourceRootTransform: input.template.sourceRootTransform,
      templateRestTransform: pair.template.part.restTransform,
      templateBounds: pair.template.bounds!,
      anchorOffset,
    });
    if (!restTransform) {
      skippedReasons.set(pair.target.partIndex, 'non-invertible-transform');
      continue;
    }
    if (!isNearIdentityTransform(restTransform)) {
      changedPartCount += 1;
    }
    placementsByPartIndex.set(pair.target.partIndex, {
      partIndex: pair.target.partIndex,
      matchedTemplatePartId: pair.template.part.partId,
      matchedBy: pair.matchedBy,
      restTransform,
      sourceRestTransform: restTransform,
    });
  }

  if (placementsByPartIndex.size === 0 || changedPartCount === 0) {
    return null;
  }

  return {
    assessment: {
      templateCharacterId: input.template.id,
      templateCharacterName: input.template.name,
      sameDefinition: templateParts.some((item) => item.sameDefinition),
      sameSourceArchive: allowSameArchiveShapes,
      matchedPartCount: placementsByPartIndex.size,
      changedPartCount,
      templatePartCount: input.template.parts.length,
    },
    placementsByPartIndex,
    skippedReasons,
  };
}

/**
 * Resolves deterministic V2-B saved-character / template layout placements for
 * AdaptiveParts created from an FLA Graphic when parts were not already placed
 * by V2-A author poses. Never overwrites `lockedPartIndices`.
 */
export function resolveFlaGraphicSavedLayoutPlacements(input: {
  readonly project: Pick<Project, 'assets' | 'animations' | 'characters'>;
  readonly definition: FlaGraphicDefinition;
  readonly frameOrdinal: number;
  readonly parts: readonly Pick<CharacterPart, 'partId' | 'visualSource' | 'restTransform' | 'sourceRestTransform'>[];
  readonly lockedPartIndices?: ReadonlySet<number>;
  readonly excludeCharacterId?: string;
  readonly preferredTemplateCharacterId?: string;
  readonly targetSourceRootTransform?: CharacterPartTransform;
}): FlaGraphicSavedLayoutResolution {
  const lockedSet = input.lockedPartIndices ?? new Set<number>();
  const unlockedCount = input.parts.filter((_, index) => !lockedSet.has(index)).length;
  const animations = input.project.animations.some((a) => a.id === input.definition.id)
    ? input.project.animations
    : [...input.project.animations, input.definition];

  if (input.parts.length === 0 || unlockedCount === 0) {
    return {
      totalCandidateCount: unlockedCount,
      availableTemplates: [],
      selectedTemplate: null,
      matchedCount: 0,
      placementsByPartIndex: new Map(),
      skippedReasons: new Map(),
    };
  }

  const targetSourceRootTransform = input.targetSourceRootTransform ?? IDENTITY_TRANSFORM;
  if (!isInvertibleFinite(targetSourceRootTransform)) {
    const skippedReasons = new Map<number, FlaGraphicSavedLayoutSkipReason>();
    input.parts.forEach((_, idx) => {
      if (!lockedSet.has(idx)) skippedReasons.set(idx, 'non-invertible-transform');
    });
    return {
      totalCandidateCount: unlockedCount,
      availableTemplates: [],
      selectedTemplate: null,
      matchedCount: 0,
      placementsByPartIndex: new Map(),
      skippedReasons,
    };
  }

  const evaluatedTarget = input.definition.structure
    ? evaluateFlaGraphicVisual({
        definition: input.definition,
        frameOrdinal: input.frameOrdinal,
        mode: 'instance',
      })
    : null;

  const targetDescriptors: TargetPartDescriptor[] = input.parts.map((part, partIndex) => {
    const vs = resolveCharacterPartVisualSource(part);
    const trace =
      vs.kind === 'fla-graphic' && vs.nodePath?.length && evaluatedTarget?.layers
        ? findNodeTraceInEvaluated(evaluatedTarget.layers, vs.nodePath, vs.regionRef)
        : null;
    const bounds = characterPartSourceBounds(part, animations, input.project.assets);
    return {
      partIndex,
      part,
      bounds,
      trace,
      lockedByAuthorPose: lockedSet.has(partIndex),
    };
  });

  const minRequired = unlockedCount >= 2 ? 2 : 1;
  const candidates: EvaluatedTemplateCandidate[] = [];

  for (const candidate of input.project.characters) {
    if (candidate.mode !== 'adaptive-parts') continue;
    if (candidate.id === input.excludeCharacterId) continue;
    if (candidate.parts.length < 2) continue;

    const evaluated = evaluateTemplateCharacter({
      template: candidate,
      targetDefinition: input.definition,
      targetDescriptors,
      targetSourceRootTransform,
      animations,
      assets: input.project.assets,
    });
    if (evaluated && evaluated.placementsByPartIndex.size >= minRequired) {
      candidates.push(evaluated);
    }
  }

  if (candidates.length === 0) {
    const skippedReasons = new Map<number, FlaGraphicSavedLayoutSkipReason>();
    input.parts.forEach((_, idx) => {
      skippedReasons.set(idx, lockedSet.has(idx) ? 'locked-by-author-pose' : 'no-template');
    });
    return {
      totalCandidateCount: unlockedCount,
      availableTemplates: [],
      selectedTemplate: null,
      matchedCount: 0,
      placementsByPartIndex: new Map(),
      skippedReasons,
    };
  }

  candidates.sort((left, right) => {
    if (right.assessment.matchedPartCount !== left.assessment.matchedPartCount) {
      return right.assessment.matchedPartCount - left.assessment.matchedPartCount;
    }
    if (left.assessment.sameDefinition !== right.assessment.sameDefinition) {
      return left.assessment.sameDefinition ? -1 : 1;
    }
    if (left.assessment.sameSourceArchive !== right.assessment.sameSourceArchive) {
      return left.assessment.sameSourceArchive ? -1 : 1;
    }
    return right.assessment.changedPartCount - left.assessment.changedPartCount;
  });

  const selectUnambiguousWinner = (): EvaluatedTemplateCandidate | null => {
    if (candidates.length === 1) {
      return candidates[0]!;
    }
    const sameDefCandidates = candidates.filter((item) => item.assessment.sameDefinition);
    if (sameDefCandidates.length === 1) {
      const winner = sameDefCandidates[0]!;
      const maxOtherMatched = Math.max(
        ...candidates
          .filter((item) => item !== winner)
          .map((item) => item.assessment.matchedPartCount),
      );
      if (winner.assessment.matchedPartCount >= maxOtherMatched) {
        return winner;
      }
    }
    return null;
  };

  const selected = input.preferredTemplateCharacterId
    ? (candidates.find(
        (item) => item.assessment.templateCharacterId === input.preferredTemplateCharacterId,
      ) ?? null)
    : selectUnambiguousWinner();

  if (!selected) {
    const skippedReasons = new Map<number, FlaGraphicSavedLayoutSkipReason>();
    input.parts.forEach((_, idx) => {
      skippedReasons.set(
        idx,
        lockedSet.has(idx)
          ? 'locked-by-author-pose'
          : input.preferredTemplateCharacterId
            ? 'no-template'
            : 'multiple-templates',
      );
    });
    return {
      totalCandidateCount: unlockedCount,
      availableTemplates: candidates.map((item) => item.assessment),
      selectedTemplate: null,
      matchedCount: 0,
      placementsByPartIndex: new Map(),
      skippedReasons,
    };
  }

  return {
    totalCandidateCount: unlockedCount,
    availableTemplates: candidates.map((item) => item.assessment),
    selectedTemplate: selected.assessment,
    matchedCount: selected.placementsByPartIndex.size,
    placementsByPartIndex: selected.placementsByPartIndex,
    skippedReasons: selected.skippedReasons,
  };
}
