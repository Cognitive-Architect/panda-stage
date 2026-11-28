import {
  invertAffineMatrix,
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../shared/affine-matrix';
import { characterBonePoseClipDeltas, resolveCharacterBoneTree } from './character-bone-pose';
import type { EvaluatedCharacterBonePose } from './character-bone-pose';
import type {
  EvaluatedFlaGraphicLayer,
  EvaluatedFlaGraphicNode,
  EvaluatedFlaGraphicVisual,
} from './evaluate-fla-graphic';
import {
  computeFlaShapeRegionBounds,
  type FlaEditableShapeRegion,
  type FlaEditableStroke,
  type FlaVectorPathCommand,
} from './fla-shape-vector';
import {
  CHARACTER_VECTOR_SKIN_MAX_INFLUENCES,
  type CharacterBone,
  type CharacterVectorSkin,
} from './models/character';

/**
 * Minimal two-Bone vector path skinning (#1459, parent #1447 R-D/R05).
 *
 * Ported algorithm (not code) from AniCraft `crates/doc/src/skin.rs` and
 * `crates/doc/src/weights.rs` at commit `aa74ed7` (MIT OR Apache-2.0):
 * - every `MoveTo`/`LineTo`/`QuadTo`/`CubicTo` end is an anchor;
 * - automatic weight = inverse fourth power of the anchor's distance to the
 *   Bone segment, strongest influences kept, normalized to sum 1;
 * - linear blend skinning of the bone matrices (`world * inverse(restWorld)`);
 * - a cubic's outgoing handle follows the previous anchor, its incoming handle
 *   follows its own anchor, a quadratic's control follows the mean of both;
 * - identity at rest is returned bit for bit (no geometry drift).
 *
 * Coordinate ownership:
 * - `clipDeltas` are the #1455 Character-space Bone deltas conjugated into one
 *   Character Clip's center-local space (`characterBonePoseClipDeltas`).
 * - `posedClipTransform` is the evaluated Part `imageTransform` (Part source
 *   space -> Clip space).
 * - `restCharacterTransform` is the frozen Clip basis `baseTransform` (Part
 *   source space -> Character space at the authored rest pose).
 * - Automatic weights are measured in Character rest space; the deformation is
 *   applied by conjugating the Clip-space delta with the exact region -> Clip
 *   mapping the renderer uses, so a rest pose is the identity transform.
 *
 * No rest geometry is persisted: rest is the FLA definition's authored region
 * plus the Bone tree rest world transforms. Nothing here mutates its input, so
 * every frame is recomputed from rest and the current pose.
 */

/** Distance below this counts as this (px) so an anchor on a Bone has a finite weight. */
export const CHARACTER_VECTOR_SKIN_NEAR_DISTANCE = 0.5;
/** Anchors whose share falls below this after normalizing are dropped. */
export const CHARACTER_VECTOR_SKIN_FAINT_WEIGHT = 0.01;
/** Hard safety caps for one skinned Part visual (AniCraft MAX_SKIN_POINTS is 20k). */
export const CHARACTER_VECTOR_SKIN_MAX_ANCHORS = 20_000;
export const CHARACTER_VECTOR_SKIN_MAX_POINTS = 40_000;

export interface VectorSkinPoint {
  readonly x: number;
  readonly y: number;
}

/** One Bone as drawn: its rest joint and its rest end in Character space. */
export interface VectorSkinBoneSegment {
  readonly boneId: string;
  readonly head: VectorSkinPoint;
  readonly tail: VectorSkinPoint;
}

export interface VectorSkinInfluence {
  readonly boneId: string;
  readonly weight: number;
}

export type CharacterVectorSkinFallbackCode =
  | 'missing-bone'
  | 'missing-part'
  | 'not-vector-content'
  | 'mixed-content'
  | 'clip-path'
  | 'non-solid-style'
  | 'too-many-anchors'
  | 'degenerate-transform';

export interface VectorSkinDeformationSuccess {
  readonly ok: true;
  /** The deformed visual, or the untouched input visual when the pose is at rest. */
  readonly visual: EvaluatedFlaGraphicVisual;
  readonly deformed: boolean;
  /** Anchors that received a non-empty binding. */
  readonly anchorCount: number;
  /** Every path point (anchors plus curve controls) the skin inspected. */
  readonly pointCount: number;
}

export type VectorSkinDeformationResult =
  | VectorSkinDeformationSuccess
  | { readonly ok: false; readonly code: CharacterVectorSkinFallbackCode };

const IDENTITY: AffineMatrix2D = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

export function isIdentityAffineMatrix(matrix: AffineMatrix2D): boolean {
  return matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 &&
    matrix.tx === 0 && matrix.ty === 0;
}

export function applyVectorSkinPoint(
  matrix: AffineMatrix2D,
  point: VectorSkinPoint,
): VectorSkinPoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

function translate(x: number, y: number): AffineMatrix2D {
  return { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y };
}

/** Squared distance from `point` to segment `a`-`b`; `a` itself for a zero-length Bone. */
export function vectorSkinSegmentDistanceSquared(
  point: VectorSkinPoint,
  a: VectorSkinPoint,
  b: VectorSkinPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) {
    const px = point.x - a.x;
    const py = point.y - a.y;
    return px * px + py * py;
  }
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const px = point.x - (a.x + t * dx);
  const py = point.y - (a.y + t * dy);
  return px * px + py * py;
}

/**
 * Automatic influences for one anchor in Character rest space: `1 / max(d, 0.5)^4`
 * relative to the nearest Bone, strongest kept, faint ones dropped, normalized to
 * sum 1. Returns an empty list when no Bone is usable.
 */
export function autoVectorSkinInfluences(
  segments: readonly VectorSkinBoneSegment[],
  point: VectorSkinPoint,
): readonly VectorSkinInfluence[] {
  const raw = segments.flatMap((segment) => {
    const distance = Math.sqrt(vectorSkinSegmentDistanceSquared(point, segment.head, segment.tail));
    const safeDistance = Math.max(CHARACTER_VECTOR_SKIN_NEAR_DISTANCE, distance);
    const weight = 1 / (safeDistance * safeDistance * safeDistance * safeDistance);
    return Number.isFinite(weight) && weight > 0 ? [{ boneId: segment.boneId, weight }] : [];
  });
  return normalizeVectorSkinInfluences(raw);
}

/**
 * Keeps positive finite weights (one per Bone, strongest first), keeps the
 * configured number of influences, drops faint shares and normalizes to 1.
 */
export function normalizeVectorSkinInfluences(
  influences: readonly VectorSkinInfluence[],
): readonly VectorSkinInfluence[] {
  const seen = new Set<string>();
  const kept: VectorSkinInfluence[] = [];
  let nearest = 0;
  for (const influence of influences) {
    if (!Number.isFinite(influence.weight) || influence.weight <= 0) continue;
    if (seen.has(influence.boneId)) continue;
    seen.add(influence.boneId);
    nearest = Math.max(nearest, influence.weight);
    kept.push({ boneId: influence.boneId, weight: influence.weight });
  }
  if (kept.length === 0 || nearest <= 0) return [];
  // Normalize relative to the nearest influence first so far-away shapes stay finite.
  const relative = kept
    .map((influence) => ({ boneId: influence.boneId, weight: influence.weight / nearest }))
    .sort((left, right) => right.weight - left.weight)
    .slice(0, CHARACTER_VECTOR_SKIN_MAX_INFLUENCES);
  const keptAgain = relative.filter((influence) => influence.weight >= CHARACTER_VECTOR_SKIN_FAINT_WEIGHT);
  const chosen = keptAgain.length > 0 ? keptAgain : relative.slice(0, 1);
  const total = chosen.reduce((sum, influence) => sum + influence.weight, 0);
  if (!(total > 0) || !Number.isFinite(total)) return [];
  return chosen.map((influence) => ({ boneId: influence.boneId, weight: influence.weight / total }));
}

/**
 * Deterministic per-anchor weight resolution. A matching persisted override wins;
 * otherwise the inverse-fourth-power automatic binding is used. Pure: identical
 * inputs always yield identical numbers.
 */
export function resolveVectorSkinWeights(input: {
  readonly point: VectorSkinPoint;
  readonly segments: readonly VectorSkinBoneSegment[];
  readonly overrides?: ReadonlyMap<string, readonly VectorSkinInfluence[]>;
  readonly anchorKey?: string;
}): readonly VectorSkinInfluence[] {
  const boneIds = new Set(input.segments.map(({ boneId }) => boneId));
  const override = input.anchorKey ? input.overrides?.get(input.anchorKey) : undefined;
  if (override && override.length > 0) {
    const sanitized = override.filter(({ boneId, weight }) =>
      boneIds.has(boneId) && Number.isFinite(weight) && weight > 0);
    const normalized = normalizeVectorSkinInfluences(
      sanitized.map(({ boneId, weight }) => ({ boneId, weight })),
    );
    if (normalized.length > 0) return normalized;
  }
  return autoVectorSkinInfluences(input.segments, input.point);
}

/** Rest head/end of every Bone in Character space, as drawn. */
export function vectorSkinBoneRestSegments(
  character: { readonly bones?: readonly CharacterBone[] },
  poses: ReadonlyMap<string, EvaluatedCharacterBonePose>,
): ReadonlyMap<string, VectorSkinBoneSegment> {
  const tree = resolveCharacterBoneTree(character);
  if (!tree.ok) return new Map();
  const segments = new Map<string, VectorSkinBoneSegment>();
  for (const boneId of tree.order) {
    const pose = poses.get(boneId);
    if (!pose) continue;
    const { a, b, tx, ty } = pose.restWorld;
    const length = tree.byId.get(boneId)?.length ?? 0;
    segments.set(boneId, {
      boneId,
      head: { x: tx, y: ty },
      // A Bone without an authored length binds as a point joint.
      tail: { x: tx + a * length, y: ty + b * length },
    });
  }
  return segments;
}

/** Character Clip-space Bone deltas for one evaluated pose map. */
export function vectorSkinClipDeltas(
  poses: ReadonlyMap<string, EvaluatedCharacterBonePose>,
  fixedCharacterCenter: { readonly x: number; readonly y: number },
): ReadonlyMap<string, AffineMatrix2D> {
  return characterBonePoseClipDeltas(poses, fixedCharacterCenter);
}

/** Persisted hand-authored overrides indexed by anchor key. */
export function vectorSkinAnchorWeightsMap(
  skin: CharacterVectorSkin,
): ReadonlyMap<string, readonly VectorSkinInfluence[]> {
  const map = new Map<string, readonly VectorSkinInfluence[]>();
  for (const entry of skin.anchorWeights ?? []) {
    map.set(entry.anchorKey, entry.weights.map(({ boneId, weight }) => ({ boneId, weight })));
  }
  return map;
}

/**
 * Drops skins whose Part or Bone disappeared (Part removal, Bone deletion) so
 * the Character stays formally valid without leaving a dangling binding.
 */
export function pruneCharacterVectorSkins(
  character: { readonly vectorSkins?: readonly CharacterVectorSkin[] },
  valid: { readonly partIds: ReadonlySet<string>; readonly boneIds: ReadonlySet<string> },
): { readonly skins: CharacterVectorSkin[]; readonly changed: boolean } {
  const skins = character.vectorSkins ?? [];
  const remaining = skins.filter((skin) =>
    valid.partIds.has(skin.partId) && skin.boneIds.every((boneId) => valid.boneIds.has(boneId)));
  return { skins: [...remaining], changed: remaining.length !== skins.length };
}

function isCurveCommand(command: FlaVectorPathCommand): boolean {
  return command.type === 'M' || command.type === 'L' || command.type === 'Q' || command.type === 'C';
}

interface VectorVisualScan {
  readonly leaves: readonly EvaluatedFlaGraphicNode[];
  readonly vectorLeafCount: number;
  readonly nonVectorLeafCount: number;
  readonly hasClipPath: boolean;
  readonly hasNonSolidFill: boolean;
  readonly anchorCount: number;
  readonly pointCount: number;
}

function scanVectorVisual(visual: EvaluatedFlaGraphicVisual): VectorVisualScan {
  const leaves: EvaluatedFlaGraphicNode[] = [];
  let vectorLeafCount = 0;
  let nonVectorLeafCount = 0;
  let hasClipPath = false;
  let hasNonSolidFill = false;
  let anchorCount = 0;
  let pointCount = 0;
  const visit = (nodes: readonly EvaluatedFlaGraphicNode[]): void => {
    for (const node of nodes) {
      if (!node.renderable) continue;
      if (node.clipPaths.length > 0) hasClipPath = true;
      if (node.children.length > 0) {
        visit(node.children);
        continue;
      }
      if (!node.vectorVisual) {
        nonVectorLeafCount += 1;
        continue;
      }
      leaves.push(node);
      vectorLeafCount += 1;
      for (const region of node.vectorVisual.regions) {
        if (region.fill.kind !== 'solid') hasNonSolidFill = true;
        for (const contour of region.contours) {
          for (const command of contour.commands) {
            if (!isCurveCommand(command)) continue;
            anchorCount += 1;
            pointCount += 1;
            if (command.type === 'Q') pointCount += 1;
            if (command.type === 'C') pointCount += 2;
          }
        }
        for (const stroke of region.strokes) {
          for (const command of stroke.commands) {
            if (!isCurveCommand(command)) continue;
            anchorCount += 1;
            pointCount += 1;
            if (command.type === 'Q') pointCount += 1;
            if (command.type === 'C') pointCount += 2;
          }
        }
      }
      for (const stroke of node.vectorVisual.residueStrokes ?? []) {
        for (const command of stroke.commands) {
          if (!isCurveCommand(command)) continue;
          anchorCount += 1;
          pointCount += 1;
          if (command.type === 'Q') pointCount += 1;
          if (command.type === 'C') pointCount += 2;
        }
      }
    }
  };
  for (const layer of visual.layers ?? []) visit(layer.nodes);
  return { leaves, vectorLeafCount, nonVectorLeafCount, hasClipPath, hasNonSolidFill, anchorCount, pointCount };
}

/** Style/content boundary of the first slice, mapped to one typed reason. */
export function vectorSkinStyleFallbackCode(
  scan: Pick<VectorVisualScan, 'vectorLeafCount' | 'nonVectorLeafCount' | 'hasClipPath' | 'hasNonSolidFill' | 'anchorCount' | 'pointCount'>,
): CharacterVectorSkinFallbackCode | null {
  if (scan.vectorLeafCount === 0) return 'not-vector-content';
  if (scan.hasClipPath) return 'clip-path';
  if (scan.hasNonSolidFill) return 'non-solid-style';
  if (scan.nonVectorLeafCount > 0) return 'mixed-content';
  if (scan.anchorCount > CHARACTER_VECTOR_SKIN_MAX_ANCHORS ||
    scan.pointCount > CHARACTER_VECTOR_SKIN_MAX_POINTS) return 'too-many-anchors';
  return null;
}

interface DeformedLeaf {
  readonly node: EvaluatedFlaGraphicNode;
  readonly anchorCount: number;
}

function averageMatrices(left: AffineMatrix2D, right: AffineMatrix2D): AffineMatrix2D {
  return {
    a: 0.5 * (left.a + right.a),
    b: 0.5 * (left.b + right.b),
    c: 0.5 * (left.c + right.c),
    d: 0.5 * (left.d + right.d),
    tx: 0.5 * (left.tx + right.tx),
    ty: 0.5 * (left.ty + right.ty),
  };
}

function blendClipDelta(
  weights: readonly VectorSkinInfluence[],
  clipDeltas: ReadonlyMap<string, AffineMatrix2D>,
): AffineMatrix2D | null {
  let moved = false;
  let total = 0;
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let tx = 0;
  let ty = 0;
  for (const { boneId, weight } of weights) {
    const delta = clipDeltas.get(boneId);
    if (!delta) continue;
    if (!isIdentityAffineMatrix(delta)) moved = true;
    a += weight * delta.a;
    b += weight * delta.b;
    c += weight * delta.c;
    d += weight * delta.d;
    tx += weight * delta.tx;
    ty += weight * delta.ty;
    total += weight;
  }
  if (!moved || !(total > 0)) return null;
  return { a: a / total, b: b / total, c: c / total, d: d / total, tx: tx / total, ty: ty / total };
}

/**
 * Deforms one evaluated Part visual with linear blend skinning. Returns a typed
 * fallback instead of drawing a wrong result for unsupported content styles.
 */
export function evaluateVectorSkinDeformation(input: {
  readonly visual: EvaluatedFlaGraphicVisual;
  readonly posedClipTransform: AffineMatrix2D;
  readonly restCharacterTransform: AffineMatrix2D;
  readonly clipDeltas: ReadonlyMap<string, AffineMatrix2D>;
  readonly skin: CharacterVectorSkin;
  readonly boneSegments: ReadonlyMap<string, VectorSkinBoneSegment>;
  readonly overrides?: ReadonlyMap<string, readonly VectorSkinInfluence[]>;
}): VectorSkinDeformationResult {
  const { skin, visual } = input;
  const segments: VectorSkinBoneSegment[] = [];
  for (const boneId of skin.boneIds) {
    const segment = input.boneSegments.get(boneId);
    if (!segment) return { ok: false, code: 'missing-bone' };
    segments.push(segment);
  }
  const scan = scanVectorVisual(visual);
  const styleFallback = vectorSkinStyleFallbackCode(scan);
  if (styleFallback) return { ok: false, code: styleFallback };
  const base = {
    ok: true as const,
    anchorCount: scan.anchorCount,
    pointCount: scan.pointCount,
  };
  const animated = skin.boneIds.some((boneId) => {
    const delta = input.clipDeltas.get(boneId);
    return delta !== undefined && !isIdentityAffineMatrix(delta);
  });
  // Rest exactness: an unchanged pose returns the exact authored visual object.
  if (!animated) return { ...base, visual, deformed: false };

  const anchor = visual.anchor;
  const deformedLeaves = new Map<EvaluatedFlaGraphicNode, DeformedLeaf>();
  for (const node of scan.leaves) {
    const leaf = deformVectorLeaf({
      node,
      anchor,
      posedClipTransform: input.posedClipTransform,
      restCharacterTransform: input.restCharacterTransform,
      clipDeltas: input.clipDeltas,
      segments,
      overrides: input.overrides,
    });
    if (!leaf) return { ok: false, code: 'degenerate-transform' };
    deformedLeaves.set(node, leaf);
  }
  if (deformedLeaves.size === 0) return { ...base, visual, deformed: false };
  const mapNode = (node: EvaluatedFlaGraphicNode): EvaluatedFlaGraphicNode => {
    const deformed = deformedLeaves.get(node);
    if (deformed) return deformed.node;
    if (node.children.length === 0) return node;
    let changed = false;
    const children = node.children.map((child) => {
      const next = mapNode(child);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, children } : node;
  };
  let changedVisual = false;
  const layers: EvaluatedFlaGraphicLayer[] = (visual.layers ?? []).map((layer) => {
    let changed = false;
    const nodes = layer.nodes.map((node) => {
      const next = mapNode(node);
      if (next !== node) changed = true;
      return next;
    });
    if (!changed) return layer;
    changedVisual = true;
    return { ...layer, nodes };
  });
  if (!changedVisual) return { ...base, visual, deformed: false };
  return { ...base, visual: { ...visual, layers }, deformed: true };
}

interface DeformLeafInput {
  readonly node: EvaluatedFlaGraphicNode;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly posedClipTransform: AffineMatrix2D;
  readonly restCharacterTransform: AffineMatrix2D;
  readonly clipDeltas: ReadonlyMap<string, AffineMatrix2D>;
  readonly segments: readonly VectorSkinBoneSegment[];
  readonly overrides?: ReadonlyMap<string, readonly VectorSkinInfluence[]>;
}

function deformVectorLeaf(input: DeformLeafInput): DeformedLeaf | null {
  const vectorVisual = input.node.vectorVisual;
  if (!vectorVisual) return { node: input.node, anchorCount: 0 };
  const world = input.node.worldTransform;
  // Exact region -> Clip mapping the renderer uses: partImageTransform *
  // translate(-anchor) * nodeWorldTransform * translate(-baseViewBox).
  const regionToClip = multiplyAffineMatrices(
    input.posedClipTransform,
    multiplyAffineMatrices(
      translate(-input.anchor.x, -input.anchor.y),
      multiplyAffineMatrices(world, translate(-vectorVisual.baseViewBox.x, -vectorVisual.baseViewBox.y)),
    ),
  );
  const clipToRegion = invertAffineMatrix(regionToClip);
  if (!clipToRegion) return null;
  const anchorMatrix = (point: VectorSkinPoint, anchorKey: string): AffineMatrix2D | null => {
    // Part source space point as shipped to the Part transform.
    const source = applyVectorSkinPoint(world, {
      x: point.x - vectorVisual.baseViewBox.x,
      y: point.y - vectorVisual.baseViewBox.y,
    });
    const sourceAnchored = {
      x: source.x - input.anchor.x,
      y: source.y - input.anchor.y,
    };
    const restPoint = applyVectorSkinPoint(input.restCharacterTransform, sourceAnchored);
    const weights = resolveVectorSkinWeights({
      point: restPoint,
      segments: input.segments,
      ...(input.overrides ? { overrides: input.overrides } : {}),
      anchorKey,
    });
    const delta = blendClipDelta(weights, input.clipDeltas);
    if (!delta) return IDENTITY;
    return multiplyAffineMatrices(clipToRegion, multiplyAffineMatrices(delta, regionToClip));
  };
  let anchorCount = 0;
  const deformContours = (region: FlaEditableShapeRegion, regionIndex: number) => {
    const contours = region.contours.map((contour, contourIndex) => {
      let previous: AffineMatrix2D | null = null;
      let anchorIndex = 0;
      const commands = contour.commands.map((command): FlaVectorPathCommand => {
        if (command.type === 'Z') return command;
        const anchorKey = `${regionIndex}:${contourIndex}:${anchorIndex}`;
        anchorIndex += 1;
        anchorCount += 1;
        const current = anchorMatrix({ x: command.x, y: command.y }, anchorKey);
        if (!current) return command;
        const next = transformVectorCommand(command, current, previous);
        previous = current;
        return next;
      });
      return { closed: contour.closed, commands };
    });
    const strokes = region.strokes.map((stroke, strokeIndex) =>
      deformStroke(stroke, anchorKeyPrefix(`~${regionIndex}:${strokeIndex}`), anchorMatrix, () => {
        anchorCount += 1;
      }));
    return {
      ...region,
      contours,
      strokes,
      bounds: computeFlaShapeRegionBounds({ contours, strokes }),
    };
  };
  const regions = vectorVisual.regions.map((region, regionIndex) =>
    deformContours(region, regionIndex));
  const residueStrokes = vectorVisual.residueStrokes?.map((stroke, strokeIndex) =>
    deformStroke(stroke, anchorKeyPrefix(`!${strokeIndex}`), anchorMatrix, () => {
      anchorCount += 1;
    }));
  const nextVectorVisual = {
    ...vectorVisual,
    regions,
    ...(residueStrokes ? { residueStrokes } : {}),
  };
  return {
    node: { ...input.node, vectorVisual: nextVectorVisual },
    anchorCount,
  };
}

/**
 * Anchor key format for lazy weight overrides: `region:contour:anchor` for fill
 * contours, `~region:stroke:anchor` for region strokes, `!stroke:anchor` for
 * residue strokes. Keys never encode coordinates, so rest edits cannot drift.
 */
function anchorKeyPrefix(prefix: string): (anchorIndex: number) => string {
  return (anchorIndex) => `${prefix}:${anchorIndex}`;
}

function deformStroke(
  stroke: FlaEditableStroke,
  key: (anchorIndex: number) => string,
  anchorMatrix: (point: VectorSkinPoint, anchorKey: string) => AffineMatrix2D | null,
  onAnchor: () => void,
): FlaEditableStroke {
  let previous: AffineMatrix2D | null = null;
  let anchorIndex = 0;
  const commands = stroke.commands.map((command): FlaVectorPathCommand => {
    if (command.type === 'Z') return command;
    const current = anchorMatrix({ x: command.x, y: command.y }, key(anchorIndex));
    anchorIndex += 1;
    onAnchor();
    if (!current) return command;
    const next = transformVectorCommand(command, current, previous);
    previous = current;
    return next;
  });
  return { ...stroke, commands };
}

function transformVectorCommand(
  command: FlaVectorPathCommand,
  current: AffineMatrix2D,
  previous: AffineMatrix2D | null,
): FlaVectorPathCommand {
  const point = (value: VectorSkinPoint, matrix: AffineMatrix2D) => applyVectorSkinPoint(matrix, value);
  switch (command.type) {
    case 'M':
      return { type: 'M', ...point({ x: command.x, y: command.y }, current) };
    case 'L':
      return { type: 'L', ...point({ x: command.x, y: command.y }, current) };
    case 'Q': {
      const control = previous ? averageMatrices(previous, current) : current;
      const p = point({ x: command.x, y: command.y }, current);
      const c = point({ x: command.cx, y: command.cy }, control);
      return { type: 'Q', cx: c.x, cy: c.y, x: p.x, y: p.y };
    }
    case 'C': {
      const outgoing = previous ?? current;
      const p = point({ x: command.x, y: command.y }, current);
      const c1 = point({ x: command.c1x, y: command.c1y }, outgoing);
      const c2 = point({ x: command.c2x, y: command.c2y }, current);
      return { type: 'C', c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y, x: p.x, y: p.y };
    }
    case 'Z':
      return command;
  }
}
