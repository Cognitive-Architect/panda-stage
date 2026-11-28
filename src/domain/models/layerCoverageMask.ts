import { z } from 'zod';
import { IdSchema } from './common';

/**
 * Author-level coverage mask (#1454, parent #1447 F07).
 *
 * A Layer carrying `maskTargets` is a mask layer: its current visual coverage
 * clips every listed target Layer instead of being drawn as ordinary content.
 * The mask layer keeps its normal Layer transform and animation tracks, so the
 * coverage region can be animated like any other Layer.
 *
 * Compatibility guarantees:
 * - additive optional field; old projects stay valid and no schema bump occurs;
 * - the mask layer owns the relationship (single source of truth); the reverse
 *   target -> mask mapping is derived, never persisted;
 * - only coverage of ordinary vector/shape (or Layer footprint) content is
 *   modelled here. Alpha/luminance masks, soft edges, and nested masks are out
 *   of scope for F07.
 */
export const MAX_COVERAGE_MASK_TARGETS = 64;

export const LayerCoverageMaskTargetsSchema = z
  .array(IdSchema)
  .max(MAX_COVERAGE_MASK_TARGETS)
  .refine(
    (targetIds) => new Set(targetIds).size === targetIds.length,
    '遮罩目标图层不能重复。',
  );

export type LayerCoverageMaskTargets = z.infer<
  typeof LayerCoverageMaskTargetsSchema
>;
