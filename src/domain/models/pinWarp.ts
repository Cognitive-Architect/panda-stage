import { z } from 'zod';
import { FiniteNumberSchema } from './common';

/**
 * Pin-warp mesh bounds (#1460, R-D / R06 "小样" slice).
 *
 * The prototype deforms one bitmap Layer with dragged control pins between
 * authored poses. The mesh is a deterministic grid over the Layer's image
 * `localRect`; pins and mesh live on the Layer (never on a shared Definition),
 * in the same layer-local pixel space as `localRect` (origin at the image
 * center, +x right, +y down, 1 unit = 1 source image pixel).
 */
export const PIN_WARP_MIN_PINS = 2;
export const PIN_WARP_MAX_PINS = 32;
export const PIN_WARP_MIN_MESH_CELLS = 1;
export const PIN_WARP_MAX_MESH_CELLS = 24;
export const PIN_WARP_MAX_POSES = 64;
/** Sanity bound for authored coordinates; keeps persisted values finite/small. */
export const PIN_WARP_COORDINATE_LIMIT = 1_000_000;

const PinWarpCoordinateSchema = FiniteNumberSchema.min(
  -PIN_WARP_COORDINATE_LIMIT,
).max(PIN_WARP_COORDINATE_LIMIT);

export const PinWarpPointSchema = z.strictObject({
  x: PinWarpCoordinateSchema,
  y: PinWarpCoordinateSchema,
});
export type PinWarpPoint = z.infer<typeof PinWarpPointSchema>;

export const PinWarpMeshDensitySchema = z.strictObject({
  columns: z
    .number()
    .int()
    .min(PIN_WARP_MIN_MESH_CELLS)
    .max(PIN_WARP_MAX_MESH_CELLS),
  rows: z
    .number()
    .int()
    .min(PIN_WARP_MIN_MESH_CELLS)
    .max(PIN_WARP_MAX_MESH_CELLS),
});
export type PinWarpMeshDensity = z.infer<typeof PinWarpMeshDensitySchema>;

export const PinWarpPoseSchema = z.strictObject({
  /** Shot-local authored time; must be a project frame-grid time inside the Shot. */
  timeMs: FiniteNumberSchema.int().nonnegative(),
  pins: z.array(PinWarpPointSchema).max(PIN_WARP_MAX_PINS),
});
export type PinWarpPose = z.infer<typeof PinWarpPoseSchema>;

/**
 * Load-tolerant reader used by the persisted `Layer` schema. It validates shape,
 * bounds, and finiteness only: a structurally valid-but-semantically broken warp
 * (pin-count mismatch, unordered poses) must not make the whole project
 * unreadable. Authoring paths additionally parse {@link PinWarpAuthoringSchema},
 * and every evaluation returns an explicit invalid result so a broken warp
 * degrades to the ordinary un-warped image locally (never NaN, never a crash).
 */
export const PinWarpSchema = z.strictObject({
  mesh: PinWarpMeshDensitySchema,
  restPins: z.array(PinWarpPointSchema).max(PIN_WARP_MAX_PINS),
  poses: z.array(PinWarpPoseSchema).min(1).max(PIN_WARP_MAX_POSES),
});
export type PinWarp = z.infer<typeof PinWarpSchema>;

function pinsAreFinite(pins: readonly PinWarpPoint[]): boolean {
  return pins.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
}

/**
 * Strict authoring contract: every pose has exactly one pin per rest pin, pose
 * times are strictly ascending project frame-grid times, and pin counts/bounds
 * are sane. Services parse this before writing so invalid data cannot be
 * authored; the persisted reader stays tolerant for old/foreign files.
 */
export const PinWarpAuthoringSchema = PinWarpSchema.superRefine(
  (pinWarp, context) => {
    const { restPins, poses, mesh } = pinWarp;
    if (restPins.length < PIN_WARP_MIN_PINS) {
      context.addIssue({
        code: 'custom',
        path: ['restPins'],
        message: `控制点变形至少需要 ${PIN_WARP_MIN_PINS} 个控制点。`,
      });
    }
    if (mesh.columns < PIN_WARP_MIN_MESH_CELLS || mesh.rows < PIN_WARP_MIN_MESH_CELLS) {
      context.addIssue({
        code: 'custom',
        path: ['mesh'],
        message: '变形网格至少需要 1 行 1 列。',
      });
    }
    if (!pinsAreFinite(restPins)) {
      context.addIssue({
        code: 'custom',
        path: ['restPins'],
        message: '控制点坐标必须是有限数字。',
      });
    }
    let previousTimeMs = -1;
    for (const [poseIndex, pose] of poses.entries()) {
      if (pose.pins.length !== restPins.length) {
        context.addIssue({
          code: 'custom',
          path: ['poses', poseIndex, 'pins'],
          message: '每个姿态的控制点数量必须与初始控制点一致。',
        });
      }
      if (!pinsAreFinite(pose.pins)) {
        context.addIssue({
          code: 'custom',
          path: ['poses', poseIndex, 'pins'],
          message: '姿态控制点坐标必须是有限数字。',
        });
      }
      if (pose.timeMs <= previousTimeMs) {
        context.addIssue({
          code: 'custom',
          path: ['poses', poseIndex, 'timeMs'],
          message: '姿态时间必须严格递增。',
        });
      }
      previousTimeMs = pose.timeMs;
    }
  },
);
