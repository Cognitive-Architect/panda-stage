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
  convertCoverageRegionToNonzero,
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
 * normalized to a single `nonzero` winding by `coverageMaskFillRule.ts`. A mask
 * that resolves to no drawable filled geometry is a *valid empty* coverage (the
 * targets are clipped to nothing, matching the FLA `destination-in` semantics),
 * while geometry that cannot be represented is reported as typed, per-Layer
 * `unsupported` and only that mask degrades to unclipped output.
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
  /** Every region converted to a single non-negative `nonzero` winding. */
  readonly paths: readonly CoverageMaskClipPath[];
  readonly issues: readonly CoverageMaskGeometryIssue[];
}

export interface CoverageMaskClip {
  /** Mask Layer that supplies the coverage. */
  readonly maskLayerId: string;
  readonly paths: readonly CoverageMaskClipPath[];
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

interface CoverageCollection {
  readonly maskLayerId: string;
  readonly paths: CoverageMaskClipPath[];
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
      const converted = convertCoverageRegionToNonzero({
        fillRule: region.fill.fillRule,
        contours: region.contours.map((contour) =>
          transformCommands(contour.commands, viewMatrix)),
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
      const d = converted.contours
        .map((contour) => commandsToSvgPathD(contour))
        .join(' ')
        .trim();
      if (d) collection.paths.push({ d });
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
      collection.paths.push({
        d: positiveWindingRectPathD(nodeMatrix, 0, 0, size.width, size.height),
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
    paths: [],
    issues: [],
    sawUnsupported: false,
  };
}

function collectionStatus(collection: CoverageCollection): CoverageMaskGeometryStatus {
  if (collection.paths.length > 0) return 'resolved';
  // Geometry that exists but cannot be represented must never be mistaken for
  // an intentionally empty coverage (which clips the targets away).
  if (collection.sawUnsupported) return 'unsupported';
  return 'empty';
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
      return {
        status: collectionStatus(flaCollection),
        paths: flaCollection.paths,
        issues: flaCollection.issues,
      };
    }
    const bounds = visual.combinedLocalBounds;
    if (bounds.width > 0 && bounds.height > 0) {
      return {
        status: 'resolved',
        paths: [{
          d: rectPathD(stageMatrix, bounds.x, bounds.y, bounds.width, bounds.height),
        }],
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
