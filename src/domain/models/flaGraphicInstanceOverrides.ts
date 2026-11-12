import { z } from 'zod';
import type { AffineMatrix2D } from '../../shared/affine-matrix';
import {
  FLA_GRAPHIC_STRUCTURE_MAX_DEPTH,
  FLA_GRAPHIC_STRUCTURE_MAX_NODES,
  FlaStructureMatrixSchema,
  type FlaGraphicStructure,
  type FlaGraphicStructureNode,
} from './flaGraphicStructure';

const FrameOrdinalKeySchema = z.string().regex(/^(0|[1-9]\d*)$/u);
const NodePathKeySchema = z.string().min(3).max(FLA_GRAPHIC_STRUCTURE_MAX_DEPTH * 1_004 + 2);

/**
 * Sparse, per-Layer-instance local transform overrides. The outer key is the
 * frame ordinal and the inner key is the JSON-encoded complete stable node
 * path; values contain only the node-local matrix.
 */
export const FlaGraphicInstanceTransformOverridesSchema = z
  .record(
    FrameOrdinalKeySchema,
    z.record(NodePathKeySchema, FlaStructureMatrixSchema),
  )
  .superRefine((overrides, context) => {
    if (Object.keys(overrides).length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Graphic transform overrides must remain sparse.',
      });
    }
    let entryCount = 0;
    for (const [frameKey, frameOverrides] of Object.entries(overrides)) {
      if (!Number.isSafeInteger(Number(frameKey))) {
        context.addIssue({
          code: 'custom',
          path: [frameKey],
          message: 'Graphic override frame ordinals must be safe integers.',
        });
      }
      if (Object.keys(frameOverrides).length === 0) {
        context.addIssue({
          code: 'custom',
          path: [frameKey],
          message: 'Graphic override frames must not be empty.',
        });
      }
      for (const pathKey of Object.keys(frameOverrides)) {
        entryCount += 1;
        if (!parseFlaGraphicNodePathKey(pathKey)) {
          context.addIssue({
            code: 'custom',
            path: [frameKey, pathKey],
            message: 'Graphic overrides require a canonical complete node path.',
          });
        }
      }
    }
    if (entryCount > FLA_GRAPHIC_STRUCTURE_MAX_NODES) {
      context.addIssue({
        code: 'custom',
        message: 'A Layer cannot contain more Graphic overrides than the structure node limit.',
      });
    }
  });

export type FlaGraphicInstanceTransformOverrides = z.infer<
  typeof FlaGraphicInstanceTransformOverridesSchema
>;

export function flaGraphicInstanceNodePathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

function parseFlaGraphicNodePathKey(key: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.length > FLA_GRAPHIC_STRUCTURE_MAX_DEPTH ||
      !parsed.every(
        (part) =>
          typeof part === 'string' &&
          part.trim().length > 0 &&
          part.trim().length <= 1_000 &&
          part === part.trim(),
      ) ||
      JSON.stringify(parsed) !== key
    ) {
      return null;
    }
    return parsed as string[];
  } catch {
    return null;
  }
}

function getFrameOverrides(
  overrides: FlaGraphicInstanceTransformOverrides | undefined,
  frameOrdinal: number,
): Readonly<Record<string, AffineMatrix2D>> | undefined {
  if (!Number.isSafeInteger(frameOrdinal) || frameOrdinal < 0) return undefined;
  return overrides?.[String(frameOrdinal)];
}

export function getFlaGraphicInstanceTransformOverride(
  overrides: FlaGraphicInstanceTransformOverrides | undefined,
  frameOrdinal: number,
  nodePath: readonly string[],
): AffineMatrix2D | undefined {
  if (nodePath.length === 0) return undefined;
  return getFrameOverrides(overrides, frameOrdinal)?.[
    flaGraphicInstanceNodePathKey(nodePath)
  ];
}

/** Pure seam: authored Definition matrix plus this Layer's sparse override. */
export function evaluateFlaGraphicInstanceTransform(
  authoredLocalTransform: AffineMatrix2D,
  overrides: FlaGraphicInstanceTransformOverrides | undefined,
  frameOrdinal: number,
  nodePath: readonly string[],
): AffineMatrix2D {
  return getFlaGraphicInstanceTransformOverride(
    overrides,
    frameOrdinal,
    nodePath,
  ) ?? authoredLocalTransform;
}

export function findFlaGraphicStructureNodeAtPath(
  structure: FlaGraphicStructure,
  frameOrdinal: number,
  nodePath: readonly string[],
): FlaGraphicStructureNode | null {
  if (nodePath.length === 0) return null;
  const frame = structure.frames.find((candidate) => candidate.ordinal === frameOrdinal);
  if (!frame) return null;
  let nodes: readonly FlaGraphicStructureNode[] = frame.layers.flatMap(
    (layer) => layer.nodes,
  );
  let current: FlaGraphicStructureNode | undefined;
  for (const nodeId of nodePath) {
    current = nodes.find((node) => node.id === nodeId);
    if (!current) return null;
    nodes = current.type === 'group' || current.type === 'symbol'
      ? current.children
      : [];
  }
  return current ?? null;
}

function matricesEqual(left: AffineMatrix2D, right: AffineMatrix2D): boolean {
  const keys: (keyof AffineMatrix2D)[] = ['a', 'b', 'c', 'd', 'tx', 'ty'];
  return keys.every((key) => Math.abs(left[key] - right[key]) <= 1e-9);
}

/** Adds or removes one sparse entry, pruning it when it matches authored data. */
export function setFlaGraphicInstanceTransformOverride(
  overrides: FlaGraphicInstanceTransformOverrides | undefined,
  frameOrdinal: number,
  nodePath: readonly string[],
  authoredLocalTransform: AffineMatrix2D,
  localTransform: AffineMatrix2D,
): FlaGraphicInstanceTransformOverrides | undefined {
  if (
    !Number.isSafeInteger(frameOrdinal) ||
    frameOrdinal < 0 ||
    nodePath.length === 0 ||
    nodePath.length > FLA_GRAPHIC_STRUCTURE_MAX_DEPTH
  ) {
    return overrides;
  }
  const frameKey = String(frameOrdinal);
  const pathKey = flaGraphicInstanceNodePathKey(nodePath);
  const existingFrame = overrides?.[frameKey] ?? {};
  const current = existingFrame[pathKey];
  const shouldRemove = matricesEqual(authoredLocalTransform, localTransform);
  if (shouldRemove && current === undefined) return overrides;
  if (!shouldRemove && current && matricesEqual(current, localTransform)) {
    return overrides;
  }

  const nextFrame = { ...existingFrame };
  if (shouldRemove) delete nextFrame[pathKey];
  else nextFrame[pathKey] = { ...localTransform };

  const next = { ...(overrides ?? {}) };
  if (Object.keys(nextFrame).length === 0) delete next[frameKey];
  else next[frameKey] = nextFrame;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Copies nested records and matrices so duplicated Layers own independent values. */
export function cloneFlaGraphicInstanceTransformOverrides(
  overrides: FlaGraphicInstanceTransformOverrides | undefined,
): FlaGraphicInstanceTransformOverrides | undefined {
  if (!overrides) return undefined;
  return Object.fromEntries(
    Object.entries(overrides).map(([frameOrdinal, frameOverrides]) => [
      frameOrdinal,
      Object.fromEntries(
        Object.entries(frameOverrides).map(([pathKey, matrix]) => [
          pathKey,
          { ...matrix },
        ]),
      ),
    ]),
  );
}

function collectTransformablePaths(
  structure: FlaGraphicStructure,
): ReadonlyMap<string, ReadonlyMap<string, AffineMatrix2D>> {
  const pathsByFrame = new Map<string, Map<string, AffineMatrix2D>>();
  for (const frame of structure.frames) {
    const validPaths = new Map<string, AffineMatrix2D>();
    const visit = (
      nodes: readonly FlaGraphicStructureNode[],
      parentPath: readonly string[],
    ): void => {
      for (const node of nodes) {
        const path = [...parentPath, node.id];
        if (node.type !== 'opaque') {
          validPaths.set(flaGraphicInstanceNodePathKey(path), node.localTransform);
        }
        if (node.type === 'group' || node.type === 'symbol') {
          visit(node.children, path);
        }
      }
    };
    for (const layer of frame.layers) visit(layer.nodes, []);
    pathsByFrame.set(String(frame.ordinal), validPaths);
  }
  return pathsByFrame;
}

/** Drops stale, opaque, and authored-equal entries after a structure update. */
export function pruneFlaGraphicInstanceTransformOverrides(
  overrides: FlaGraphicInstanceTransformOverrides | undefined,
  structure: FlaGraphicStructure,
): FlaGraphicInstanceTransformOverrides | undefined {
  if (!overrides) return undefined;
  const validPathsByFrame = collectTransformablePaths(structure);
  let changed = false;
  const next: FlaGraphicInstanceTransformOverrides = {};
  for (const [frameOrdinal, frameOverrides] of Object.entries(overrides)) {
    const validPaths = validPathsByFrame.get(frameOrdinal);
    if (!validPaths) {
      changed = true;
      continue;
    }
    const kept: Record<string, AffineMatrix2D> = {};
    for (const [pathKey, matrix] of Object.entries(frameOverrides)) {
      const authored = validPaths.get(pathKey);
      if (!authored || matricesEqual(authored, matrix)) {
        changed = true;
        continue;
      }
      kept[pathKey] = matrix;
    }
    if (Object.keys(kept).length > 0) next[frameOrdinal] = kept;
    else if (Object.keys(frameOverrides).length > 0) changed = true;
  }
  if (!changed) return overrides;
  return Object.keys(next).length > 0 ? next : undefined;
}
