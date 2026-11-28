import {
  multiplyAffineMatrices,
  type AffineMatrix2D,
} from '../../shared/affine-matrix';
import type { StageLayerRenderInstruction } from '../../shared/stage/layer-render-contract';
import type { CameraView } from '../camera-projection';
import { cameraLayerTransform } from '../camera-projection';
import {
  commandsToSvgPathD,
  transformCommands,
  type FlaVectorPathCommand,
} from '../fla-shape-vector';
import type {
  EvaluatedFlaGraphicNode,
  EvaluatedFlaGraphicVisual,
} from '../evaluate-fla-graphic';
import type { EvaluatedCoverageMask } from '../coverage-mask';
import type { FlaGraphicStructureNode } from '../models';
import type { LayerVisualParts } from './visualParts';
import { visualPartRenderTransform } from './visualParts';
import {
  coverageBoundsDisjoint,
  coverageContourBounds,
  coverageContourHasCurve,
  convertCoverageRegionToNonzero,
  type CoverageMaskBounds,
  type CoverageMaskFillRule,
  type CoverageMaskFillRuleIssueCode,
} from './coverageMaskFillRule';

/**
 * Coverage mask clip geometry for the Stage / Preview / Export renderers
 * (#1454, parent #1447 F07).
 *
 * The existing FLA `clipPaths` Canvas path paints mask coverage from filled
 * shape geometry and composites with `destination-in`. Author-level mask Layers
 * need the same coverage *semantics* without touching F07's existing internal
 * mask behaviour, so this module reuses the same vector command pipeline
 * (`transformCommands` + `commandsToSvgPathD`) and reports stage-space SVG path
 * data. `Konva` then clips the target Layer with exactly that coverage path.
 *
 * #1464 R3: coverage is collected recursively from the actual drawable
 * descendants (never from a Group/Symbol/Layer bounding box), with every region
 * normalized to a single winding by `coverageMaskFillRule.ts`. A mask that
 * resolves to no drawable filled geometry is a *valid empty* coverage (the
 * targets are clipped to nothing, matching the FLA `destination-in` semantics),
 * while geometry that cannot be represented is reported as typed, per-Layer
 * `unsupported` and only that mask degrades to unclipped output.
 *
 * #1469 F4 exactness boundary:
 * - Line-only (polygon) regions are normalized exactly by
 *   `coverageMaskFillRule.ts`; every merged region then has non-negative
 *   winding, so one `nonzero` clip is their exact union.
 * - Bézier regions are never converted from a polyline approximation. When the
 *   whole mask is a single authored region, or when same-rule regions have
 *   provably disjoint exact bounds, the authored curves are emitted unchanged
 *   with their authored fill rule/`nonzero` winding, which is exact by
 *   definition. Any other curve region that would need a fill-rule
 *   conversion/merge is reported as `unsupported-curve-fill-rule` and is
 *   degraded locally (other regions of the same mask, other masks, and other
 *   Layers keep working).
 * - No curve geometry is sampled anywhere in this decision path. The remaining
 *   approximations are outside the fill-rule decision: path data is serialized
 *   with 4-decimal coordinates (pre-existing vector pipeline) and a mask
 *   graphic's internal FLA `clipPaths` are not intersected with its coverage
 *   (pre-existing F07 boundary).
 *
 * Deliberately out of scope for F07: alpha/luminance masks, soft edges,
 * arbitrary mask nesting, text-node coverage, and bitmap texel alpha.
 */

export type CoverageMaskGeometryIssueCode =
  | CoverageMaskFillRuleIssueCode
  | 'unsupported-text'
  | 'unknown-bitmap-size'
  | 'graphic-not-ready'
  | 'unknown-layer-bounds'
  | 'degraded-graphic-node';

export interface CoverageMaskGeometryIssue {
  readonly code: CoverageMaskGeometryIssueCode;
  readonly maskLayerId: string;
  /** Evaluated FLA node path; empty for non-FLA Layer fallbacks. */
  readonly nodePath?: readonly string[];
  readonly regionRef?: string;
  /** Short English diagnostic detail; never shown as product copy. */
  readonly detail: string;
}

export interface CoverageMaskClipPath {
  /** SVG path data in stage (1920x1080 output) coordinates. */
  readonly d: string;
}

export type CoverageMaskGeometryStatus = 'resolved' | 'empty' | 'unsupported';

export interface CoverageMaskGeometryResolution {
  readonly status: CoverageMaskGeometryStatus;
  /** Paths for exactly one clip; see {@link fillRule}. */
  readonly paths: readonly CoverageMaskClipPath[];
  /**
   * Author fill rule required by `paths`. `nonzero` whenever any region was
   * normalized; the mask's authored `evenodd` rule only survives for a
   * single-region (or provably disjoint same-rule) curve mask.
   */
  readonly fillRule: CoverageMaskFillRule;
  readonly issues: readonly CoverageMaskGeometryIssue[];
}

export interface CoverageMaskClip {
  /** Mask Layer that supplies the coverage. */
  readonly maskLayerId: string;
  readonly paths: readonly CoverageMaskClipPath[];
  /** Fill rule the whole clip must be rendered with. */
  readonly fillRule: CoverageMaskFillRule;
  /** True for valid empty coverage: targets are clipped to nothing. */
  readonly empty: boolean;
  /** Typed local degradations; representable regions still clip. */
  readonly issues: readonly CoverageMaskGeometryIssue[];
}

export interface CoverageMaskRenderLayer {
  readonly evaluated: {
    readonly id: string;
    readonly parentSpace?: AffineMatrix2D;
    readonly effectiveDepth?: number;
    readonly effectiveCameraSpace?: 'world' | 'screen';
    readonly coverageMask?: EvaluatedCoverageMask;
  };
  /** Runtime visual parts; required for exact shape coverage. */
  readonly visual?: LayerVisualParts | null;
  readonly render: StageLayerRenderInstruction;
}

export interface CoverageMaskRenderModel {
  readonly width: number;
  readonly height: number;
  readonly layers: readonly CoverageMaskRenderLayer[];
}

export interface CoverageMaskClipMap {
  /** Target Layer id -> shared clip supplied by its mask Layer. */
  readonly clips: ReadonlyMap<string, CoverageMaskClip>;
  /** Mask Layers whose authored visual has no representable coverage geometry. */
  readonly unresolvedMaskLayerIds: ReadonlySet<string>;
  /** Mask Layers whose coverage is valid but resolves to nothing. */
  readonly emptyMaskLayerIds: ReadonlySet<string>;
  /** Typed local degradations across every mask Layer. */
  readonly issues: readonly CoverageMaskGeometryIssue[];
}

const IDENTITY: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function translate(x: number, y: number): AffineMatrix2D {
  return { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y };
}

/**
 * Mirrors `Konva.Node._getTransform` so coverage geometry lands exactly where
 * the renderer draws the mask Layer (translate -> rotate -> skew -> scale ->
 * offset translate).
 */
export function konvaPoseAffineMatrix(pose: {
  readonly x: number;
  readonly y: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
  readonly skewX?: number;
  readonly skewY?: number;
}): AffineMatrix2D {
  let matrix: AffineMatrix2D = IDENTITY;
  const apply = (
    next: (value: AffineMatrix2D) => AffineMatrix2D,
  ): void => {
    matrix = next(matrix);
  };
  if (pose.x !== 0 || pose.y !== 0) {
    apply((value) => ({
      ...value,
      tx: value.tx + value.a * pose.x + value.c * pose.y,
      ty: value.ty + value.b * pose.x + value.d * pose.y,
    }));
  }
  if (pose.rotation !== 0) {
    const radians = (pose.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    apply((value) => ({
      a: value.a * cos + value.c * sin,
      b: value.b * cos + value.d * sin,
      c: value.a * -sin + value.c * cos,
      d: value.b * -sin + value.d * cos,
      tx: value.tx,
      ty: value.ty,
    }));
  }
  if ((pose.skewX ?? 0) !== 0 || (pose.skewY ?? 0) !== 0) {
    const skewX = pose.skewX ?? 0;
    const skewY = pose.skewY ?? 0;
    apply((value) => ({
      a: value.a + value.c * skewY,
      b: value.b + value.d * skewY,
      c: value.c + value.a * skewX,
      d: value.d + value.b * skewX,
      tx: value.tx,
      ty: value.ty,
    }));
  }
  if (pose.scaleX !== 1 || pose.scaleY !== 1) {
    apply((value) => ({
      ...value,
      a: value.a * pose.scaleX,
      b: value.b * pose.scaleX,
      c: value.c * pose.scaleY,
      d: value.d * pose.scaleY,
    }));
  }
  if (pose.offsetX !== 0 || pose.offsetY !== 0) {
    apply((value) => ({
      ...value,
      tx: value.tx + value.a * -pose.offsetX + value.c * -pose.offsetY,
      ty: value.ty + value.b * -pose.offsetX + value.d * -pose.offsetY,
    }));
  }
  return matrix;
}

/**
 * Stage space root for one Layer: camera projection x inherited parent space x
 * Layer pose. The Layer pose intentionally excludes `offsetX/offsetY`: both
 * the editor `SelectableLayer` and the shared `StageRenderer` draw formal visual
 * parts from the Layer root, and each part's own placement carries its offset.
 */
function layerStageMatrix(
  layer: CoverageMaskRenderLayer,
  width: number,
  height: number,
  camera: CameraView | undefined,
): AffineMatrix2D | null {
  const projection = cameraLayerTransform(
    camera,
    width,
    height,
    layer.evaluated.effectiveDepth ?? 0,
    layer.evaluated.effectiveCameraSpace ?? 'world',
  );
  if (!projection) return null;
  return multiplyAffineMatrices(
    multiplyAffineMatrices(
      konvaPoseAffineMatrix({
        x: projection.x,
        y: projection.y,
        offsetX: projection.offsetX,
        offsetY: projection.offsetY,
        scaleX: projection.scaleX,
        scaleY: projection.scaleY,
        rotation: projection.rotation,
      }),
      layer.evaluated.parentSpace ?? IDENTITY,
    ),
    konvaPoseAffineMatrix({
      x: layer.render.x,
      y: layer.render.y,
      offsetX: 0,
      offsetY: 0,
      scaleX: layer.render.scaleX,
      scaleY: layer.render.scaleY,
      rotation: layer.render.rotationDeg,
    }),
  );
}

function rectCommandList(
  x: number,
  y: number,
  width: number,
  height: number,
  positiveArea: boolean,
): FlaVectorPathCommand[] {
  return positiveArea
    ? [
        { type: 'M', x, y },
        { type: 'L', x: x + width, y },
        { type: 'L', x: x + width, y: y + height },
        { type: 'L', x, y: y + height },
        { type: 'Z' },
      ]
    : [
        { type: 'M', x, y },
        { type: 'L', x, y: y + height },
        { type: 'L', x: x + width, y: y + height },
        { type: 'L', x: x + width, y },
        { type: 'Z' },
      ];
}

function rectPathD(
  matrix: AffineMatrix2D,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  return commandsToSvgPathD(transformCommands(rectCommandList(x, y, width, height, true), matrix));
}

/**
 * A filled rectangle leaf whose stage transform mirrors flips its winding sign.
 * The merged clip is a single `nonzero` path, so every region must keep a
 * non-negative winding; reversed input winding would cancel against positive
 * vector regions.
 */
function positiveWindingRectPathD(
  matrix: AffineMatrix2D,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return commandsToSvgPathD(
    transformCommands(rectCommandList(x, y, width, height, determinant >= 0), matrix),
  );
}

function graphicLeafRectSize(
  source: FlaGraphicStructureNode,
  imageSizes: ReadonlyMap<string, { readonly width: number; readonly height: number }> | undefined,
): { readonly width: number; readonly height: number } | null {
  if (source.type === 'bitmap') {
    const size = source.assetId ? imageSizes?.get(source.assetId) : undefined;
    return size && size.width > 0 && size.height > 0 ? size : null;
  }
  if (source.type === 'opaque') {
    const box = source.fallbackViewBox;
    return box && box.width > 0 && box.height > 0
      ? { width: box.width, height: box.height }
      : null;
  }
  return null;
}

/**
 * One drawable coverage path.
 *
 * `normalized` contributions were converted to a non-negative `nonzero`
 * winding (polygon regions, positive-winding bitmap rectangles), so they can
 * overlap each other and the authored curves below without cancellation.
 * Non-normalized contributions are authored Bézier regions emitted verbatim:
 * they are exact on their own (path + authored rule) and are only merged into a
 * shared clip when their exact bounds are provably disjoint from every other
 * kept contribution.
 */
interface CoverageContribution {
  readonly d: string;
  /** Exact for polygons, conservative for curves (control-point hull). */
  readonly bounds: CoverageMaskBounds;
  /** Fill rule that renders this contribution exactly. */
  readonly fillRule: CoverageMaskFillRule;
  readonly normalized: boolean;
  readonly nodePath?: readonly string[];
  readonly regionRef?: string;
}

interface CoverageCollection {
  readonly maskLayerId: string;
  readonly contributions: CoverageContribution[];
  readonly issues: CoverageMaskGeometryIssue[];
  /** A drawable leaf/region could not be represented faithfully. */
  sawUnsupported: boolean;
}

function pushIssue(
  collection: CoverageCollection,
  issue: Omit<CoverageMaskGeometryIssue, 'maskLayerId'>,
): void {
  collection.issues.push({ ...issue, maskLayerId: collection.maskLayerId });
}

function unionBounds(left: CoverageMaskBounds, right: CoverageMaskBounds): CoverageMaskBounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

function contoursBounds(
  contours: readonly (readonly FlaVectorPathCommand[])[],
): CoverageMaskBounds | null {
  let bounds: CoverageMaskBounds | null = null;
  for (const commands of contours) {
    const next = coverageContourBounds(commands);
    if (!next) continue;
    bounds = bounds ? unionBounds(bounds, next) : next;
  }
  return bounds;
}

function rectBounds(
  matrix: AffineMatrix2D,
  width: number,
  height: number,
): CoverageMaskBounds {
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map(({ x, y }) => ({
    x: matrix.a * x + matrix.c * y + matrix.tx,
    y: matrix.b * x + matrix.d * y + matrix.ty,
  }));
  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  };
}

/**
 * Recursively walks the evaluated FLA tree: a Group/Symbol is never replaced by
 * its bounding box, its drawable descendants supply the actual coverage with
 * their accumulated `worldTransform`.
 */
function appendNodeCoverage(
  collection: CoverageCollection,
  node: EvaluatedFlaGraphicNode,
  graphicToStage: AffineMatrix2D,
  imageSizes: ReadonlyMap<string, { readonly width: number; readonly height: number }> | undefined,
): void {
  if (!node.renderable) {
    // A degraded leaf does not paint, but its coverage is unknown rather than
    // provably empty, so the mask must degrade to unclipped instead.
    if (node.source.type !== 'group' && node.source.type !== 'symbol') {
      collection.sawUnsupported = true;
      pushIssue(collection, {
        code: 'degraded-graphic-node',
        nodePath: node.path,
        regionRef: node.regionRef,
        detail: 'evaluated FLA node is not renderable',
      });
    }
    return;
  }
  const nodeMatrix = multiplyAffineMatrices(graphicToStage, node.worldTransform);
  if (node.vectorVisual) {
    const base = node.vectorVisual.baseViewBox;
    const viewMatrix = multiplyAffineMatrices(nodeMatrix, translate(-base.x, -base.y));
    for (const region of node.vectorVisual.regions) {
      if (region.fill.opacity <= 0 || region.contours.length === 0) {
        // Drawable but not painted: a valid, empty coverage contribution.
        continue;
      }
      const contours = region.contours.map((contour) =>
        transformCommands(contour.commands, viewMatrix));
      if (contours.some((commands) => coverageContourHasCurve(commands))) {
        // #1469 F4: never claim a fill-rule equivalence from a flattened curve.
        // Keep the authored path + its authored rule exactly; whether it can
        // join a shared clip is decided once every contribution is known.
        const bounds = contoursBounds(contours);
        const d = contours.map((commands) => commandsToSvgPathD(commands)).join(' ').trim();
        if (d && bounds) {
          collection.contributions.push({
            d,
            bounds,
            fillRule: region.fill.fillRule,
            normalized: false,
            nodePath: node.path,
            regionRef: region.regionRef,
          });
        }
        continue;
      }
      const converted = convertCoverageRegionToNonzero({
        fillRule: region.fill.fillRule,
        contours,
      });
      if (!converted.ok) {
        collection.sawUnsupported = true;
        pushIssue(collection, {
          code: converted.code,
          nodePath: node.path,
          regionRef: region.regionRef,
          detail: converted.detail,
        });
        continue;
      }
      const bounds = contoursBounds(converted.contours);
      const d = converted.contours
        .map((contour) => commandsToSvgPathD(contour))
        .join(' ')
        .trim();
      if (d && bounds) {
        collection.contributions.push({
          d,
          bounds,
          fillRule: 'nonzero',
          normalized: true,
          nodePath: node.path,
          regionRef: region.regionRef,
        });
      }
    }
    // Residue strokes are not filled coverage; F07 masks only filled shapes.
  } else if (node.staticText) {
    // Text coverage needs font layout; text-based masks are out of F07 scope.
    collection.sawUnsupported = true;
    pushIssue(collection, {
      code: 'unsupported-text',
      nodePath: node.path,
      detail: 'text coverage requires font layout',
    });
  } else if (node.source.type === 'bitmap' || node.source.type === 'opaque') {
    const size = graphicLeafRectSize(node.source, imageSizes);
    if (size) {
      collection.contributions.push({
        d: positiveWindingRectPathD(nodeMatrix, 0, 0, size.width, size.height),
        bounds: rectBounds(nodeMatrix, size.width, size.height),
        fillRule: 'nonzero',
        normalized: true,
        nodePath: node.path,
      });
    } else {
      collection.sawUnsupported = true;
      pushIssue(collection, {
        code: 'unknown-bitmap-size',
        nodePath: node.path,
        detail: 'drawable bitmap/opaque leaf has no known texel size',
      });
    }
  }
  for (const child of node.children) {
    appendNodeCoverage(collection, child, graphicToStage, imageSizes);
  }
}

function appendGraphicCoverage(
  collection: CoverageCollection,
  graphic: EvaluatedFlaGraphicVisual,
  /** Graphic-canvas space -> stage space for this graphic instance. */
  graphicToStage: AffineMatrix2D,
  imageSizes: ReadonlyMap<string, { readonly width: number; readonly height: number }> | undefined,
): void {
  if (!graphic.layers) {
    collection.sawUnsupported = true;
    pushIssue(collection, {
      code: 'graphic-not-ready',
      detail: 'FLA graphic frame has no evaluated layers',
    });
    return;
  }
  for (const layer of graphic.layers) {
    for (const node of layer.nodes) {
      appendNodeCoverage(collection, node, graphicToStage, imageSizes);
    }
  }
}

function graphicCollection(
  maskLayerId: string,
): CoverageCollection {
  return {
    maskLayerId,
    contributions: [],
    issues: [],
    sawUnsupported: false,
  };
}

interface ResolvedCoverageCollection {
  readonly status: CoverageMaskGeometryStatus;
  readonly paths: CoverageMaskClipPath[];
  readonly fillRule: CoverageMaskFillRule;
  readonly issues: CoverageMaskGeometryIssue[];
}

/**
 * Decides the single clip rule and the merge-safe contribution set.
 *
 * Exactness rules (#1469 F4):
 * - A single contribution is emitted with its own authored path and rule.
 * - Multiple normalized (polygon/bitmap) contributions are all non-negative, so
 *   a `nonzero` clip is their union.
 * - An authored Bézier contribution is exact on its own, but its winding could
 *   cancel another contribution. It is kept only when its conservative exact
 *   bounds are disjoint from every other kept contribution: then no point is
 *   shared with anything else and the authored winding cannot combine.
 * - Multiple authored `evenodd` contributions can share one `evenodd` clip when
 *   they are pairwise disjoint (the clip parity is the XOR of disjoint sets,
 *   i.e. their union); otherwise they are degraded locally.
 * - Everything else is a typed `unsupported-curve-fill-rule` degradation; other
 *   representable regions of the same mask still clip.
 */
function resolveCollection(collection: CoverageCollection): ResolvedCoverageCollection {
  const issues = [...collection.issues];
  let sawUnsupported = collection.sawUnsupported;
  const drop = (contribution: CoverageContribution, detail: string): void => {
    sawUnsupported = true;
    issues.push({
      code: 'unsupported-curve-fill-rule',
      maskLayerId: collection.maskLayerId,
      ...(contribution.nodePath ? { nodePath: contribution.nodePath } : {}),
      ...(contribution.regionRef ? { regionRef: contribution.regionRef } : {}),
      detail,
    });
  };

  const contributions = collection.contributions;
  let kept: CoverageContribution[];
  let fillRule: CoverageMaskFillRule;
  if (contributions.length === 0) {
    kept = [];
    fillRule = 'nonzero';
  } else if (contributions.length === 1) {
    kept = contributions;
    fillRule = contributions[0]!.fillRule;
  } else if (contributions.every((contribution) => contribution.fillRule === 'evenodd')) {
    // Every polygon region was normalized to `nonzero`, so this branch is a set
    // of authored Bézier evenodd regions. One evenodd clip is their exact XOR,
    // which equals their union while their exact bounds stay disjoint.
    kept = [];
    for (const contribution of contributions) {
      if (kept.some((other) => !coverageBoundsDisjoint(other.bounds, contribution.bounds))) {
        drop(contribution, 'overlapping evenodd curve coverage cannot share one clip');
      } else {
        kept.push(contribution);
      }
    }
    fillRule = 'evenodd';
  } else {
    // A single clip needs a homogeneous representation: authored evenodd curve
    // regions cannot be converted into a `nonzero` union, and normalized regions
    // cannot be re-rendered with `evenodd` without losing their overlaps.
    const usable: CoverageContribution[] = [];
    for (const contribution of contributions) {
      if (contribution.fillRule === 'evenodd') {
        drop(contribution, 'evenodd curve coverage cannot join a heterogeneous fill-rule clip');
      } else {
        usable.push(contribution);
      }
    }
    kept = usable.filter((contribution) => contribution.normalized);
    for (const contribution of usable) {
      if (contribution.normalized) continue;
      if (kept.some((other) => !coverageBoundsDisjoint(other.bounds, contribution.bounds))) {
        drop(contribution, 'curve coverage overlaps another region and cannot be merged into one nonzero winding');
      } else {
        kept.push(contribution);
      }
    }
    fillRule = 'nonzero';
  }

  const paths: CoverageMaskClipPath[] = kept.map((contribution) => ({ d: contribution.d }));
  const status: CoverageMaskGeometryStatus =
    paths.length > 0 ? 'resolved' : sawUnsupported ? 'unsupported' : 'empty';
  return { status, paths, fillRule, issues };
}

/**
 * FLA-backed coverage: the actual drawable descendants, recursively.
 * `null` means the Layer has no FLA graphic visual at all.
 */
function resolveFlaGraphicCoverage(input: {
  readonly maskLayerId: string;
  readonly visual: LayerVisualParts;
  readonly stageMatrix: AffineMatrix2D;
  readonly imageSizes: ReadonlyMap<string, { readonly width: number; readonly height: number }> | undefined;
}): CoverageCollection | null {
  const visual = input.visual;
  if (visual.flaGraphic) {
    const graphic = visual.flaGraphic;
    const collection = graphicCollection(input.maskLayerId);
    // `structuredVisual` rasters are placed directly under the Layer root at
    // `-anchor - canvas/2` in Layer-local coordinates.
    appendGraphicCoverage(
      collection,
      graphic,
      multiplyAffineMatrices(
        input.stageMatrix,
        translate(
          -graphic.anchor.x - graphic.canvas.width / 2,
          -graphic.anchor.y - graphic.canvas.height / 2,
        ),
      ),
      input.imageSizes,
    );
    return collection;
  }
  if (!visual.parts.some((part) => part.flaGraphic)) return null;
  const collection = graphicCollection(input.maskLayerId);
  for (const part of visual.parts) {
    if (!part.flaGraphic) continue;
    const graphic = part.flaGraphic;
    // A per-part Graphic raster is placed at `-anchor` inside the part pose.
    appendGraphicCoverage(
      collection,
      graphic,
      multiplyAffineMatrices(
        multiplyAffineMatrices(
          input.stageMatrix,
          konvaPoseAffineMatrix(visualPartRenderTransform(part)),
        ),
        translate(-graphic.anchor.x, -graphic.anchor.y),
      ),
      input.imageSizes,
    );
  }
  return collection;
}

/**
 * Builds the coverage geometry for one mask Layer in stage coordinates.
 * FLA-backed masks never fall back to a bounding box; Image/Character masks
 * without vector content keep their existing footprint fallback.
 */
export function resolveCoverageMaskGeometry(input: {
  readonly layer: CoverageMaskRenderLayer;
  readonly width: number;
  readonly height: number;
  readonly camera?: CameraView;
  readonly imageSizes?: ReadonlyMap<
    string,
    { readonly width: number; readonly height: number }
  >;
}): CoverageMaskGeometryResolution {
  const maskLayerId = input.layer.evaluated.id;
  const stageMatrix = layerStageMatrix(
    input.layer,
    input.width,
    input.height,
    input.camera,
  );
  if (!stageMatrix) {
    return {
      status: 'unsupported',
      paths: [],
      fillRule: 'nonzero',
      issues: [{
        code: 'unknown-layer-bounds',
        maskLayerId,
        detail: 'layer has no projectable stage transform',
      }],
    };
  }
  const visual = input.layer.visual ?? null;
  if (visual) {
    const flaCollection = resolveFlaGraphicCoverage({
      maskLayerId,
      visual,
      stageMatrix,
      imageSizes: input.imageSizes,
    });
    if (flaCollection) {
      const resolved = resolveCollection(flaCollection);
      return {
        status: resolved.status,
        paths: resolved.paths,
        fillRule: resolved.fillRule,
        issues: resolved.issues,
      };
    }
    const bounds = visual.combinedLocalBounds;
    if (bounds.width > 0 && bounds.height > 0) {
      return {
        status: 'resolved',
        paths: [{
          d: rectPathD(stageMatrix, bounds.x, bounds.y, bounds.width, bounds.height),
        }],
        fillRule: 'nonzero',
        issues: [],
      };
    }
  }
  // Last-resort Layer footprint, so Image/Character mask Layers still have a
  // deterministic coverage region (the FLA coverage path treats bitmap leaves
  // as their texel rectangle too).
  const width = input.layer.render.width;
  const height = input.layer.render.height;
  if (!(width > 0) || !(height > 0)) {
    return {
      status: 'unsupported',
      paths: [],
      fillRule: 'nonzero',
      issues: [{
        code: 'unknown-layer-bounds',
        maskLayerId,
        detail: 'mask layer has no usable coverage bounds',
      }],
    };
  }
  return {
    status: 'resolved',
    paths: [{
      d: rectPathD(stageMatrix, -width / 2, -height / 2, width, height),
    }],
    fillRule: 'nonzero',
    issues: [],
  };
}

/**
 * Builds every target Layer -> coverage clip mapping for a render model. The
 * same mask geometry instance is shared by all of its targets so multiple
 * targets are clipped identically and in their existing draw order.
 */
export function buildCoverageMaskClips(
  model: CoverageMaskRenderModel,
  camera: CameraView | undefined,
  imageSizes?: ReadonlyMap<string, { readonly width: number; readonly height: number }>,
): CoverageMaskClipMap {
  const clips = new Map<string, CoverageMaskClip>();
  const unresolvedMaskLayerIds = new Set<string>();
  const emptyMaskLayerIds = new Set<string>();
  const issues: CoverageMaskGeometryIssue[] = [];
  const maskLayers = new Map(
    model.layers
      .filter((layer) => layer.evaluated.coverageMask?.role === 'mask-layer')
      .map((layer) => [layer.evaluated.id, layer]),
  );
  for (const maskLayer of maskLayers.values()) {
    const coverageMask = maskLayer.evaluated.coverageMask;
    if (!coverageMask || coverageMask.role !== 'mask-layer') continue;
    const geometry = resolveCoverageMaskGeometry({
      layer: maskLayer,
      width: model.width,
      height: model.height,
      ...(camera ? { camera } : {}),
      ...(imageSizes ? { imageSizes } : {}),
    });
    issues.push(...geometry.issues);
    if (geometry.status === 'unsupported') {
      unresolvedMaskLayerIds.add(maskLayer.evaluated.id);
      continue;
    }
    const clip: CoverageMaskClip = {
      maskLayerId: maskLayer.evaluated.id,
      paths: geometry.paths,
      fillRule: geometry.fillRule,
      empty: geometry.status === 'empty',
      issues: geometry.issues,
    };
    if (clip.empty) emptyMaskLayerIds.add(maskLayer.evaluated.id);
    for (const targetLayerId of coverageMask.targetLayerIds) {
      clips.set(targetLayerId, clip);
    }
  }
  return { clips, unresolvedMaskLayerIds, emptyMaskLayerIds, issues };
}

/** Layers that produce visible output; mask Layers are authoring-only. */
export function isDrawableStageLayer(layer: {
  readonly coverageMask?: EvaluatedCoverageMask;
}): boolean {
  return layer.coverageMask?.role !== 'mask-layer';
}
