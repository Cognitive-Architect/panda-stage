/**
 * FLA V2-R2 Frame Sequence API.
 *
 * Issue #294 R2-A. This file is deliberately Panda-owned. It must
 * not import the pinned fla-viewer parser, Electron, Node, DOM
 * types, or any browser object. The renderer-side adapter
 * (src/renderer/fla-import/fla-frame-sequence-render.ts) and the
 * Main-side sequence service
 * (src/main/services/fla-frame-sequence-service.ts) are the only
 * places where upstream FLA values or ephemeral state are translated
 * into these serializable structures.
 *
 * Design rules (per #294 R2-A, R2-B, R2-D, R2-F, R2-G):
 *
 * 1. R2 reuses R1's render target identity, render budget, and
 *    preview shape. R2 does NOT introduce a parallel snapshot
 *    contract.
 *
 * 2. R2 does NOT over-load R1's preview/commit/cancel. The
 *    discriminants are 'fla-frame-sequence-render' and
 *    'fla-frame-sequence-commit' (vs R1's 'fla-static-snapshot-*').
 *    R2 commit MUST pin a specific confirmedSequenceRequestId so a
 *    successful sequence cannot be silently re-targeted.
 *
 * 3. The range is **inclusive** on both ends: a range with
 *    startFrameIndex=0 and endFrameIndex=N produces frames
 *    [0, 1, ..., N], which is N+1 frames. The R2-A refine
 *    `startFrameIndex <= endFrameIndex` enforces this; the
 *    `+1 frame count <= MAX_SEQUENCE_FRAMES` cap is enforced
 *    in the schema so the request never reaches the renderer
 *    with an over-cap range.
 *
 * 4. The first R2 slice is contiguous `step = 1` only. Every-Nth,
 *    keyframe, "all-timelines" exports are explicitly non-goals
 *    for #294.
 *
 * 5. R2 emits ordinary Panda ImageAssets at commit time. It does
 *    NOT add Animate Timeline/Frame/Layer objects to Project
 *    schema. The sequence manifest is ephemeral Main-side state.
 *
 * 6. R2 preserves the R1 security boundary: sandbox=true,
 *    contextIsolation=true, nodeIntegration=false, no arbitrary
 *    renderer FS / network, ActionScript never executed.
 */

import { z } from 'zod';
import { ImageAssetSchema, ProjectSchema } from '../domain';
import {
  FlaRenderTargetIdSchema,
  FlaStaticSnapshotPreviewErrorCodeSchema,
  FlaStaticSnapshotPreviewSuccessSchema,
} from './fla-static-snapshot-api';

// ---- R2 hard budgets (per #294 R2-B) ----
//
// Numbers are evidence-backed from R0 spike measurements
// (Draft CI #503 / run 32460457977) and from the R1 contract
// limits already pinned in FLA_STATIC_SNAPSHOT_LIMITS:
//   - maxSnapshotBytes 64 MiB (R1, R0 PNG payload cap)
//   - previewWallTimeMs 30,000 (R0 cold start measured 28,279 ms;
//     R1 single-preview wall = same)
//   - maxOutputWidth 4,096 / maxOutputHeight 4,096
//   - maxOutputPixels 16,777,216 (4,096 * 4,096)
//
// R2 derives per-frame limits from R1 and adds sequence-level caps.
// MAX_SEQUENCE_FRAMES is the only number that required a
// non-derived choice; #294 R2-B says "do not invent marketing
// numbers from one local machine". 24 is the number used in the
// #294 spec example (attack_0001..attack_0024) and is consistent
// with the 剑.fla structural fact that the symbol frameCount is 2;
// 24 is therefore a conservative 12x cap relative to the existing
// acceptance sample. The exact number is also the only one that
// R2-B explicitly anchors: "24 frames is the highest
// evidence-anchored number currently available for a
// contiguous range in this repo".
export const FLA_FRAME_SEQUENCE_LIMITS = {
  // R2-B: exact numeric value with evidence rationale. R0 evidence
  // is 2 frames in 剑.fla's graphic symbol. R2 first slice
  // explicitly accepts a contiguous range only, so 24 is well
  // within the existing per-preview wall-time budget at 30 s/frame
  // (24 * 30s = 12 minutes sequence wall clock).
  MAX_SEQUENCE_FRAMES: 24,
  // Inherits R1 per-frame limits verbatim. R2-B requires these
  // to remain enforced on the sequence path.
  MAX_FRAME_WIDTH: 4_096,
  MAX_FRAME_HEIGHT: 4_096,
  MAX_FRAME_PIXELS: 16_777_216,
  // R2-B: cumulative pixel budget = MAX_SEQUENCE_FRAMES * max frame pixels.
  // 24 * 16,777,216 = 402,653,184.
  MAX_SEQUENCE_TOTAL_PIXELS: 402_653_184,
  // R2-B: cumulative encoded-bytes budget = MAX_SEQUENCE_FRAMES * max snapshot bytes.
  // 24 * 64 MiB = 1.5 GiB. Bounds the Main-owned temporary sequence state.
  MAX_SEQUENCE_ENCODED_BYTES: 24 * 64 * 1024 * 1024,
  // R2-B: per-frame timeout inherits the R1 preview wall time.
  perFrameTimeoutMs: 30_000,
  // R2-B: sequence wall-clock timeout = MAX_SEQUENCE_FRAMES * perFrameTimeoutMs.
  // 24 * 30s = 720s = 12 minutes. This is the cumulative cap; a
  // single failed frame does NOT consume the whole budget; the
  // counter only advances while frames are actively rendering.
  sequenceTimeoutMs: 24 * 30_000,
  // R2-B: actual raster concurrency for the first R2 slice is
  // exactly 1. The Main process MUST NOT spin up parallel
  // BrowserWindow jobs to make performance acceptable.
  maxActualRasterConcurrency: 1,
} as const;

// ---- R2-A range contract ----
export const FlaFrameSequenceRangeSchema = z
  .object({
    // Stable Panda-owned identifier of the R1 render target.
    renderTargetId: FlaRenderTargetIdSchema,
    // Inclusive frame indices. 0-based. Must satisfy
    // 0 <= startFrameIndex <= endFrameIndex < target.frameCount.
    // The schema refines the structural relationship; the Main-side
    // service validates endFrameIndex < target.frameCount at the
    // service boundary because the target itself is not part of
    // this request (only its renderTargetId is).
    startFrameIndex: z.number().int().nonnegative(),
    endFrameIndex: z.number().int().nonnegative(),
  })
  .strict()
  // R2-A: inclusive range; reversed/empty are invalid.
  .refine(
    (range) => range.startFrameIndex <= range.endFrameIndex,
    'startFrameIndex must be <= endFrameIndex (inclusive range)',
  )
  // R2-B: hard cap on frame count is enforced at the schema
  // boundary so an over-cap range never reaches the renderer.
  .refine(
    (range) => (range.endFrameIndex - range.startFrameIndex + 1) <= FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES,
    `frame count (endFrameIndex - startFrameIndex + 1) exceeds MAX_SEQUENCE_FRAMES=${FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES}`,
  );

// ---- R2-A sequence render request ----
export const FlaFrameSequenceRequestSchema = z
  .object({
    format: z.literal('fla-frame-sequence-render'),
    version: z.literal(1),
    // Stable per-sequence identifier. R2-D uses this to track the
    // in-flight sequence and to reject late results after a
    // cancellation.
    requestId: z.uuid(),
    // Identifies the underlying FLA inspection session. Reused from R1.
    sessionId: z.uuid(),
    range: FlaFrameSequenceRangeSchema,
  })
  .strict();

// ---- R2-A per-frame result item (R2-C: stable per-frame identity) ----
export const FlaFrameSequenceItemSchema = z
  .object({
    // The absolute frame index in the underlying target timeline.
    // Stable across runs for the same (FLA, target). R2-F uses this
    // as the determinism anchor.
    frameIndex: z.number().int().nonnegative(),
    // The 0-based ordinal in THIS sequence. For a range [a..b],
    // the items are emitted as (frameIndex=a+ordinal, sequenceOrdinal=ordinal).
    // R2-F uses this for the zero-padded naming basis.
    sequenceOrdinal: z.number().int().nonnegative(),
    // R1 preview success shape, reused verbatim. The Renderer does
    // not need to know whether a preview came from R1 or R2.
    preview: FlaStaticSnapshotPreviewSuccessSchema,
  })
  .strict();

// ---- R2-A sequence success ----
export const FlaFrameSequenceSuccessSchema = z
  .object({
    ok: z.literal(true),
    requestId: z.uuid(),
    renderTargetId: FlaRenderTargetIdSchema,
    // Ordered list of completed frames. The list length equals the
    // requested frame count if all frames succeed. R2-D: a cancelled
    // or partial-failure sequence returns ok=false with the
    // completedFrameCount in the error; this list is then empty
    // (the Main process cleans up partial outputs and the error is
    // the only thing the UI sees).
    items: z
      .array(FlaFrameSequenceItemSchema)
      .max(FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES),
    // Cumulative wall-clock time for the whole sequence, in ms.
    // R2-B: this is the per-sequence budget the orchestrator
    // enforces against sequenceTimeoutMs.
    sequenceTotalMs: z.number().int().nonnegative(),
    // Number of frames that were cancelled (>= 0). For a fully
    // successful sequence this is 0.
    cancelledFrames: z.number().int().nonnegative(),
    // R2-C: pixel accounting — the Main service MUST verify this
    // equals the sum of item.preview.pixelCount and refuse to
    // accept a sequence that exceeds MAX_SEQUENCE_TOTAL_PIXELS.
    totalPixelCount: z.number().int().nonnegative(),
  })
  .strict();

// ---- R2-A sequence error ----
export const FlaFrameSequenceErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'SESSION_NOT_FOUND',
  'SOURCE_MISMATCH',
  'TARGET_UNSUPPORTED',
  'RANGE_OUT_OF_BOUNDS',
  'RANGE_EMPTY',
  'RANGE_TOO_LARGE',
  'BUDGET_EXCEEDED',          // cumulative pixel / encoded / wall-time cap
  'SEQUENCE_TIMEOUT',         // sequenceTimeoutMs hit
  'SEQUENCE_CANCELLED',       // explicit cancel
  'RENDERER_CRASH',           // sandboxed BrowserWindow crashed
  'PARTIAL_FAILURE',          // one or more frames failed; nothing committed
  'RENDER_FAILED',            // generic
  'STALE_REVISION',           // R2-D latest-request-wins
]);
// Re-export R1 preview error codes for cross-references in tests /
// future UI surface. R2 does not introduce a parallel enum.
export { FlaStaticSnapshotPreviewErrorCodeSchema };

export const FlaFrameSequenceErrorSchema = z
  .object({
    code: FlaFrameSequenceErrorCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    requestId: z.uuid().optional(),
    // R2-D: when a sequence is cancelled or partially fails, the
    // UI needs to know how many frames were already produced
    // before the failure so it can show the user a clear
    // "3 of 12 frames rendered before cancellation" state.
    completedFrameCount: z.number().int().nonnegative().max(FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES).optional(),
  })
  .strict();

export const FlaFrameSequenceResponseSchema = z.union([
  FlaFrameSequenceSuccessSchema,
  z
    .object({ ok: z.literal(false), error: FlaFrameSequenceErrorSchema })
    .strict(),
]);

// ---- R2-D stale-sequence guard: the commit MUST pin a specific
//      confirmedSequenceRequestId. The Main service tracks the
//      latest completed sequence for the session and rejects any
//      non-latest sequence with STALE_SEQUENCE. ----------------------------

// ---- R2-G commit request: takes a completed sequence result and
//      commits the entire frame set as ordinary Panda ImageAssets
//      transactionally (no half-created Project truth on failure). ----
export const FlaFrameSequenceCommitRequestSchema = z
  .object({
    format: z.literal('fla-frame-sequence-commit'),
    version: z.literal(1),
    projectRoot: z.string().trim().min(1).max(32_767),
    project: ProjectSchema,
    baseRevision: z.number().int().nonnegative(),
    sessionId: z.uuid(),
    // The sequence that the user explicitly confirmed. The Main
    // process compares it against the latest completed sequence for
    // the session and rejects any non-latest sequence with
    // STALE_SEQUENCE.
    confirmedSequenceRequestId: z.uuid(),
    source: z
      .object({
        basename: z.string().trim().min(1).max(260),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    range: FlaFrameSequenceRangeSchema,
    // The pre-confirmed sequence metadata. The Main process verifies
    // these match the confirmedSequenceRequestId before commit.
    sequence: z
      .object({
        // Echoes the requestId of the sequence render that produced
        // these frames. Must match confirmedSequenceRequestId.
        requestId: z.uuid(),
        // Per-frame metadata aligned with the range; all arrays
        // must have the same length.
        sha256EachFrame: z.array(z.string().regex(/^[a-f0-9]{64}$/u)),
        widthEachFrame: z.array(z.number().int().positive().max(FLA_FRAME_SEQUENCE_LIMITS.MAX_FRAME_WIDTH)),
        heightEachFrame: z.array(z.number().int().positive().max(FLA_FRAME_SEQUENCE_LIMITS.MAX_FRAME_HEIGHT)),
        byteLengthEachFrame: z.array(z.number().int().positive().max(64 * 1024 * 1024)),
        // Per-frame targetRenderTargetId echoes (R1 preview success
        // carries it; we re-echo here so the commit can detect
        // cross-target / cross-frame confusions without re-loading
        // the R1 preview result).
        targetRenderTargetIdEachFrame: z.array(FlaRenderTargetIdSchema),
      })
      .strict()
      .refine(
        (s) =>
          s.sha256EachFrame.length === s.widthEachFrame.length &&
          s.widthEachFrame.length === s.heightEachFrame.length &&
          s.heightEachFrame.length === s.byteLengthEachFrame.length &&
          s.byteLengthEachFrame.length === s.targetRenderTargetIdEachFrame.length,
        'sequence pre-confirmed arrays must have equal length',
      ),
    confirmed: z.literal(true),
  })
  .strict()
  .refine(
    (request) => request.sequence.requestId === request.confirmedSequenceRequestId,
    'sequence.requestId must equal confirmedSequenceRequestId (R2-D stale guard)',
  );

// ---- R2-G commit result: deterministic requested-frame -> ImageAsset mapping ----
export const FlaFrameSequenceCommitItemSchema = z
  .object({
    frameIndex: z.number().int().nonnegative(),
    sequenceOrdinal: z.number().int().nonnegative(),
    assetId: z.uuid(),
    sourceName: z.string().trim().min(1).max(500),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    status: z.enum(['imported', 'duplicate']),
    asset: ImageAssetSchema,
    duplicateOfAssetId: z.uuid().nullable(),
    targetFileName: z.string().trim().min(1).max(260),
    renamed: z.boolean(),
    message: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export const FlaFrameSequenceCommitResultSchema = z
  .object({
    // Ordered by frameIndex ascending. R2-F: requested-frame ->
    // resulting/reused ImageAsset mapping is deterministic and
    // every entry carries its frame identity.
    items: z
      .array(FlaFrameSequenceCommitItemSchema)
      .max(FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES),
    summary: z
      .object({
        requestedFrameCount: z.number().int().positive().max(FLA_FRAME_SEQUENCE_LIMITS.MAX_SEQUENCE_FRAMES),
        importedCount: z.number().int().nonnegative(),
        duplicateCount: z.number().int().nonnegative(),
        renamedCount: z.number().int().nonnegative(),
        // R2-G: net new ImageAsset count. May be less than
        // requestedFrameCount if dedup reuses existing assets.
        netNewImageAssetCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const FlaFrameSequenceCommitErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'SESSION_NOT_FOUND',
  'SOURCE_MISMATCH',
  'STALE_SEQUENCE',          // confirmedSequenceRequestId != latest
  'TARGET_UNSUPPORTED',
  'RANGE_OUT_OF_BOUNDS',
  'STALE_PROJECT_REVISION',
  'IMPORT_COLLISION',         // R2-F collision-handling
  'ASSET_COMMIT_FAILED',
  'PARTIAL_FAILURE',          // R2-G: never leave half-created Project
  'ROLLBACK_FAILED',
  'JOURNAL_RECOVERY_FAILED',
  'COMMIT_BUSY',
  'BUDGET_EXCEEDED',
]);

export const FlaFrameSequenceCommitErrorSchema = z
  .object({
    code: FlaFrameSequenceCommitErrorCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    projectRoot: z.string().trim().min(1).max(32_767),
    currentProject: ProjectSchema.optional(),
    currentRevision: z.number().int().nonnegative().optional(),
    // R2-E: list of any residual temp paths that the cleanup
    // attempt could not remove. The UI uses this to report the
    // exact cleanup state.
    residualPaths: z.array(z.string().trim().min(1).max(260)).max(1024).optional(),
  })
  .strict();

export const FlaFrameSequenceCommitResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      status: z.literal('completed'),
      project: ProjectSchema,
      baseRevision: z.number().int().nonnegative(),
      savedRevision: z.number().int().nonnegative(),
      projectChanged: z.boolean(),
      result: FlaFrameSequenceCommitResultSchema,
    })
    .strict(),
  z
    .object({ ok: z.literal(false), error: FlaFrameSequenceCommitErrorSchema })
    .strict(),
]);

// ---- R2-D cancel request (latest-request-wins) ----
export const FlaFrameSequenceCancelRequestSchema = z
  .object({
    format: z.literal('fla-frame-sequence-cancel'),
    version: z.literal(1),
    // Cancelling without requestId cancels the latest in-flight
    // sequence for the session.
    requestId: z.uuid().optional(),
    sessionId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (request) => Boolean(request.requestId || request.sessionId),
    'requestId or sessionId is required',
  );

export const FlaFrameSequenceCancelResponseSchema = z
  .object({
    accepted: z.boolean(),
    cancelledRequestId: z.uuid().optional(),
    // R2-D: number of frames that were rendered before the cancel
    // landed. The UI can show "5 of 12 done, cancelled".
    completedFrameCount: z.number().int().nonnegative().optional(),
  })
  .strict();

// ---- Type exports ----
export type FlaFrameSequenceRange = z.infer<typeof FlaFrameSequenceRangeSchema>;
export type FlaFrameSequenceRequest = z.infer<typeof FlaFrameSequenceRequestSchema>;
export type FlaFrameSequenceItem = z.infer<typeof FlaFrameSequenceItemSchema>;
export type FlaFrameSequenceSuccess = z.infer<typeof FlaFrameSequenceSuccessSchema>;
export type FlaFrameSequenceErrorCode = z.infer<typeof FlaFrameSequenceErrorCodeSchema>;
export type FlaFrameSequenceError = z.infer<typeof FlaFrameSequenceErrorSchema>;
export type FlaFrameSequenceResponse = z.infer<typeof FlaFrameSequenceResponseSchema>;
export type FlaFrameSequenceCommitRequest = z.infer<typeof FlaFrameSequenceCommitRequestSchema>;
export type FlaFrameSequenceCommitItem = z.infer<typeof FlaFrameSequenceCommitItemSchema>;
export type FlaFrameSequenceCommitResult = z.infer<typeof FlaFrameSequenceCommitResultSchema>;
export type FlaFrameSequenceCommitErrorCode = z.infer<typeof FlaFrameSequenceCommitErrorCodeSchema>;
export type FlaFrameSequenceCommitError = z.infer<typeof FlaFrameSequenceCommitErrorSchema>;
export type FlaFrameSequenceCommitResponse = z.infer<typeof FlaFrameSequenceCommitResponseSchema>;
export type FlaFrameSequenceCancelRequest = z.infer<typeof FlaFrameSequenceCancelRequestSchema>;
export type FlaFrameSequenceCancelResponse = z.infer<typeof FlaFrameSequenceCancelResponseSchema>;
