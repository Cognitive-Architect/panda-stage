import { z } from 'zod';
import { multiplyAffineMatrices, type AffineMatrix2D } from '../../shared/affine-matrix';

/**
 * Persisted, source-backed object tree of an FLA Graphic Definition (STRUCT-04-E1).
 *
 * The per-frame SVG assets remain the display cache and fallback; this tree is
 * the structural fact. Every transform is parent-local (never a world matrix),
 * sibling order is authored back-to-front draw order, and Symbol instances keep
 * a shared reference to their source library item instead of being copied.
 */
export const FLA_GRAPHIC_STRUCTURE_MAX_NODES = 20_000;
export const FLA_GRAPHIC_STRUCTURE_MAX_DEPTH = 64;
export const FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES = 8 * 1024 * 1024;
export const FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES_PER_PATH = 512 * 1024;
export const FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATHS_PER_SHAPE = 256;

export const FLA_GRAPHIC_STRUCTURE_MASK_PATH_PATTERN = /^[MLQCZ0-9.,+\-\s]+$/u;
const maskPathTextEncoder = new TextEncoder();

const FiniteNumber = z.number().finite();

export const FlaStructureMatrixSchema = z
  .object({
    a: FiniteNumber,
    b: FiniteNumber,
    c: FiniteNumber,
    d: FiniteNumber,
    tx: FiniteNumber,
    ty: FiniteNumber,
  })
  .strict();

const SourceTextSchema = z.string().trim().min(1).max(1_000);

/** One XFL mask dependency: the union of the listed shapes clips the node. */
export const FlaStructureClipPathSchema = z
  .object({
    shapes: z
      .array(
        z
          .object({
            shapeId: SourceTextSchema,
            /** Mask geometry placement in the Graphic symbol's coordinate space. */
            worldTransform: FlaStructureMatrixSchema,
            /** Transform relative to the clipped node's authored parent. */
            parentLocalTransform: FlaStructureMatrixSchema.optional(),
            /** Filled mask contours from the trusted FLA shape resolver. */
            pathData: z
              .array(
                z
                  .string()
                  .min(1)
                  .max(FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES_PER_PATH)
                  .refine(
                    (path) => maskPathTextEncoder.encode(path).byteLength <=
                      FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES_PER_PATH,
                    'Structured Graphic mask path exceeds its byte limit.',
                  )
                  .regex(FLA_GRAPHIC_STRUCTURE_MASK_PATH_PATTERN),
              )
              .max(FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATHS_PER_SHAPE)
              .optional(),
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict();

const NodeBase = {
  /** Stable node identity: the source address, or a deterministic path fallback. */
  id: SourceTextSchema,
  sourceAddress: SourceTextSchema.optional(),
  /** Index among siblings in authored back-to-front draw order. */
  drawOrder: z.number().int().nonnegative(),
  localTransform: FlaStructureMatrixSchema,
  clipPaths: z.array(FlaStructureClipPathSchema).max(64).optional(),
};

const RgbTransformSchema = z
  .object({
    multiplier: FiniteNumber.min(0).max(1),
    offset: FiniteNumber.min(0).max(255),
  })
  .strict();

export type FlaGraphicStructureNode =
  | {
      type: 'group';
      id: string;
      sourceAddress?: string;
      drawOrder: number;
      localTransform: z.infer<typeof FlaStructureMatrixSchema>;
      clipPaths?: z.infer<typeof FlaStructureClipPathSchema>[];
      groupId: string;
      children: FlaGraphicStructureNode[];
    }
  | {
      type: 'symbol';
      id: string;
      sourceAddress?: string;
      drawOrder: number;
      localTransform: z.infer<typeof FlaStructureMatrixSchema>;
      clipPaths?: z.infer<typeof FlaStructureClipPathSchema>[];
      /** Shared Symbol Definition reference (source library item name). */
      symbolRef: string;
      frameSelectionKey?: string;
      playbackMode?: string;
      firstFrame?: string;
      lastFrame?: string;
      synchronizedFirstFrame?: number;
      opacity?: number;
      rgbTransform?: z.infer<typeof RgbTransformSchema>;
      children: FlaGraphicStructureNode[];
    }
  | {
      type: 'bitmap';
      id: string;
      sourceAddress?: string;
      drawOrder: number;
      localTransform: z.infer<typeof FlaStructureMatrixSchema>;
      clipPaths?: z.infer<typeof FlaStructureClipPathSchema>[];
      /** Source media library item name; bytes stay in the source/media cache. */
      bitmapRef: string;
      /** Project asset ID fallback if bound, e.g. from generated or existing ImageAssets. */
      assetId?: string;
      /** Source provenance identifier in the project/FLA cache. */
      sourceBasename?: string;
    }
  | {
      type: 'opaque';
      id: string;
      sourceAddress?: string;
      drawOrder: number;
      localTransform: z.infer<typeof FlaStructureMatrixSchema>;
      clipPaths?: z.infer<typeof FlaStructureClipPathSchema>[];
      /** Why this subtree is read-only: its display comes from the frame SVG fallback. */
      opaqueKind: 'shape' | 'text' | 'filter' | 'symbol' | 'unknown';
      sourceRef?: string;
      reason?: string;
      /** Scope of fallback: 'subtree' (dedicated asset) or 'frame-crop' (shared frame cropped to viewBox). */
      fallbackScope?: 'subtree' | 'frame-crop';
      /** Fallback reference to a project asset (e.g. SVG frame asset ID). */
      fallbackAssetId?: string;
      /** Framing / viewBox bounds within the fallback asset to avoid full-frame duplication in future. */
      fallbackViewBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    };

export const FlaGraphicStructureNodeSchema: z.ZodType<FlaGraphicStructureNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        ...NodeBase,
        type: z.literal('group'),
        groupId: SourceTextSchema,
        children: z.array(FlaGraphicStructureNodeSchema).max(FLA_GRAPHIC_STRUCTURE_MAX_NODES),
      })
      .strict(),
    z
      .object({
        ...NodeBase,
        type: z.literal('symbol'),
        symbolRef: SourceTextSchema,
        frameSelectionKey: SourceTextSchema.optional(),
        playbackMode: SourceTextSchema.optional(),
        firstFrame: SourceTextSchema.optional(),
        lastFrame: SourceTextSchema.optional(),
        synchronizedFirstFrame: z.number().int().optional(),
        opacity: FiniteNumber.min(0).max(1).optional(),
        rgbTransform: RgbTransformSchema.optional(),
        children: z.array(FlaGraphicStructureNodeSchema).max(FLA_GRAPHIC_STRUCTURE_MAX_NODES),
      })
      .strict(),
    z
      .object({
        ...NodeBase,
        type: z.literal('bitmap'),
        bitmapRef: SourceTextSchema,
        assetId: SourceTextSchema.optional(),
        sourceBasename: SourceTextSchema.optional(),
      })
      .strict(),
    z
      .object({
        ...NodeBase,
        type: z.literal('opaque'),
        opaqueKind: z.enum(['shape', 'text', 'filter', 'symbol', 'unknown']),
        sourceRef: SourceTextSchema.optional(),
        reason: SourceTextSchema.optional(),
        fallbackScope: z.enum(['subtree', 'frame-crop']).optional(),
        fallbackAssetId: SourceTextSchema.optional(),
        fallbackViewBox: z
          .object({
            x: FiniteNumber,
            y: FiniteNumber,
            width: FiniteNumber.positive(),
            height: FiniteNumber.positive(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  ]),
);

export const FlaGraphicStructureLayerSchema = z
  .object({
    name: z.string().max(500),
    nodes: z.array(FlaGraphicStructureNodeSchema).max(FLA_GRAPHIC_STRUCTURE_MAX_NODES),
  })
  .strict();

export type FlaGraphicStructureLayer = z.infer<typeof FlaGraphicStructureLayerSchema>;

/** Structure captured for one Definition frame; the shape allows more frames later. */
export const FlaGraphicStructureFrameSchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    layers: z.array(FlaGraphicStructureLayerSchema).max(1_000),
  })
  .strict();

export type FlaGraphicStructureFrame = z.infer<typeof FlaGraphicStructureFrameSchema>;

export const FlaGraphicStructureSchema = z
  .object({
    version: z.literal(1),
    frames: z.array(FlaGraphicStructureFrameSchema).min(1).max(256),
  })
  .strict()
  .superRefine((structure, context) => {
    const seenIds = new Set<string>();
    let count = 0;
    let maskPathBytes = 0;
    const walk = (
      nodes: readonly FlaGraphicStructureNode[],
      path: (string | number)[],
      depth: number,
    ): void => {
      if (depth > FLA_GRAPHIC_STRUCTURE_MAX_DEPTH) {
        context.addIssue({ code: 'custom', path, message: 'Structure nesting is too deep.' });
        return;
      }
      nodes.forEach((node, index) => {
        count += 1;
        const nodePath = [...path, index];
        if (count > FLA_GRAPHIC_STRUCTURE_MAX_NODES) {
          if (count === FLA_GRAPHIC_STRUCTURE_MAX_NODES + 1) {
            context.addIssue({ code: 'custom', path: nodePath, message: 'Structure has too many nodes.' });
          }
          return;
        }
        if (node.drawOrder !== index) {
          context.addIssue({ code: 'custom', path: [...nodePath, 'drawOrder'], message: 'Node draw order must match its sibling index.' });
        }
        if (seenIds.has(node.id)) {
          context.addIssue({ code: 'custom', path: [...nodePath, 'id'], message: 'Structure node ids must be unique.' });
        }
        seenIds.add(node.id);
        for (const [clipIndex, clipPath] of (node.clipPaths ?? []).entries()) {
          for (const [shapeIndex, shape] of clipPath.shapes.entries()) {
            for (const [pathIndex, pathData] of (shape.pathData ?? []).entries()) {
              maskPathBytes += maskPathTextEncoder.encode(pathData).byteLength;
              if (maskPathBytes > FLA_GRAPHIC_STRUCTURE_MAX_MASK_PATH_BYTES) {
                context.addIssue({
                  code: 'custom',
                  path: [...nodePath, 'clipPaths', clipIndex, 'shapes', shapeIndex, 'pathData', pathIndex],
                  message: 'Structured Graphic mask geometry exceeds its byte budget.',
                });
                return;
              }
            }
          }
        }
        if (node.type === 'group' || node.type === 'symbol') {
          walk(node.children, [...nodePath, 'children'], depth + 1);
        }
      });
    };
    structure.frames.forEach((frame, frameIndex) => {
      if (frame.ordinal !== frameIndex) {
        context.addIssue({ code: 'custom', path: ['frames', frameIndex, 'ordinal'], message: 'Structure frame ordinals must be contiguous from zero.' });
      }
      frame.layers.forEach((layer, layerIndex) =>
        walk(layer.nodes, ['frames', frameIndex, 'layers', layerIndex, 'nodes'], 1));
    });
  });

export type FlaGraphicStructure = z.infer<typeof FlaGraphicStructureSchema>;

export interface ReconstructedFlaStructureNode {
  readonly node: FlaGraphicStructureNode;
  readonly layerIndex: number;
  /** Parent id, or null for a top-level node of its layer. */
  readonly parentId: string | null;
  /** Local transform composed through every ancestor. */
  readonly worldTransform: AffineMatrix2D;
}

/**
 * Read a persisted structure back as a flat, ordered (pre-order, back-to-front)
 * list with world matrices recomposed from the stored parent-local matrices.
 */
export function reconstructFlaGraphicStructure(
  structure: FlaGraphicStructure,
  frameOrdinal = 0,
): ReconstructedFlaStructureNode[] {
  const frame = structure.frames.find((candidate) => candidate.ordinal === frameOrdinal);
  if (!frame) return [];
  const result: ReconstructedFlaStructureNode[] = [];
  const identity: AffineMatrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const walk = (
    nodes: readonly FlaGraphicStructureNode[],
    layerIndex: number,
    parentId: string | null,
    parentWorld: AffineMatrix2D,
  ): void => {
    for (const node of nodes) {
      const worldTransform = multiplyAffineMatrices(parentWorld, node.localTransform);
      result.push({ node, layerIndex, parentId, worldTransform });
      if (node.type === 'group' || node.type === 'symbol') {
        walk(node.children, layerIndex, node.id, worldTransform);
      }
    }
  };
  frame.layers.forEach((layer, layerIndex) => walk(layer.nodes, layerIndex, null, identity));
  return result;
}

function canonicalizeStructureNode(node: FlaGraphicStructureNode): unknown {
  const base = {
    type: node.type,
    drawOrder: node.drawOrder,
    localTransform: {
      a: node.localTransform.a,
      b: node.localTransform.b,
      c: node.localTransform.c,
      d: node.localTransform.d,
      tx: node.localTransform.tx,
      ty: node.localTransform.ty,
    },
    ...(node.sourceAddress ? { sourceAddress: node.sourceAddress } : {}),
    ...(node.clipPaths ? { clipPaths: node.clipPaths } : {}),
  };
  if (node.type === 'group') {
    return {
      ...base,
      groupId: node.groupId,
      children: node.children.map(canonicalizeStructureNode),
    };
  }
  if (node.type === 'symbol') {
    return {
      ...base,
      symbolRef: node.symbolRef,
      playbackMode: node.playbackMode,
      firstFrame: node.firstFrame,
      lastFrame: node.lastFrame,
      synchronizedFirstFrame: node.synchronizedFirstFrame,
      frameSelectionKey: node.frameSelectionKey,
      opacity: node.opacity,
      rgbTransform: node.rgbTransform,
      children: node.children.map(canonicalizeStructureNode),
    };
  }
  if (node.type === 'bitmap') {
    return {
      ...base,
      bitmapRef: node.bitmapRef,
      sourceBasename: node.sourceBasename,
    };
  }
  if (node.type === 'opaque') {
    return {
      ...base,
      opaqueKind: node.opaqueKind,
      sourceRef: node.sourceRef,
      reason: node.reason,
      fallbackScope: node.fallbackScope,
      fallbackViewBox: node.fallbackViewBox,
    };
  }
  return base;
}

/**
 * Produce an authored/semantic projection of a structure, stripping out
 * project-bound storage IDs (such as image assetId and fallbackAssetId) and
 * transient runtime IDs so that identical authored definitions can be
 * compared and reused across different occurrences and commit runs.
 */
export function canonicalizeFlaGraphicStructure(structure: FlaGraphicStructure): unknown {
  return {
    version: structure.version,
    frames: structure.frames.map((frame) => ({
      ordinal: frame.ordinal,
      layers: frame.layers.map((layer) => ({
        name: layer.name,
        nodes: layer.nodes.map(canonicalizeStructureNode),
      })),
    })),
  };
}

/**
 * Compare two Graphic structures for authored/semantic equivalence, ignoring
 * storage-bound asset IDs while strictly preserving topology, transforms,
 * symbol playback semantics, and subtree bounds.
 */
export function sameAuthoredStructure(
  left: FlaGraphicStructure | undefined,
  right: FlaGraphicStructure | undefined,
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    JSON.stringify(canonicalizeFlaGraphicStructure(left)) ===
    JSON.stringify(canonicalizeFlaGraphicStructure(right))
  );
}
