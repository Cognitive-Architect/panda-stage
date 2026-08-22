/**
 * V2-R1 Static Snapshot API.
 *
 * Issue #287 R1-A (Panda-owned render-target + frame selection contract).
 *
 * This file is deliberately Panda-owned. It must not import the pinned
 * fla-viewer parser, Electron, Node, DOM types, or any browser object.
 * The renderer-side render adapter (src/renderer/fla-import/fla-static-snapshot-render.ts)
 * and the Main-side render session (src/main/services/fla-static-snapshot-render-session.ts)
 * are the only places where upstream FLA values are translated into these
 * serializable structures.
 *
 * Design rules (per R1-A, R1-D, R1-E, R1-F):
 *
 * 1. R1 does NOT over-load FlaRasterSelectionIntent or fla-raster-commit.
 *    Direct-raster import (V1/V1.5) and rendered-snapshot import (V2-R1)
 *    are different contracts on different format/version discriminants.
 *
 * 2. R1 does NOT add Animate semantic objects to the Project schema.
 *    R1 only produces one ordinary Panda ImageAsset per confirmed
 *    snapshot, exactly like the existing raster commit.
 *
 * 3. The render target identifier and the preview requestId are both
 *    stable across the review session so a commit MUST pin a specific
 *    confirmed preview (STALE_PREVIEW guard).
 *
 * 4. selectedFrameIndex is optional; when omitted, the renderer treats
 *    it as 0. The commit path requires it to be explicitly set so a
 *    successful preview cannot be silently re-targeted.
 *
 * 5. Unsupported / unknown targets are carried in the catalog with
 *    previewSupported:false and an explicit reason; they are never
 *    silently promoted to "supported".
 */

import { z } from 'zod';
import { ImageAssetSchema, ProjectSchema } from '../domain';
import { FLA_IMPORT_LIMITS } from './fla-import-api';

// ---- R1-specific budgets (per Issue #287 R1-B and R0 spike evidence) ----
export const FLA_STATIC_SNAPSHOT_LIMITS = {
  maxRenderableTargetsPerFile: 64,
  maxSnapshotBytes: FLA_IMPORT_LIMITS.maxSingleEntryBytes, // 64 MiB
  previewWallTimeMs: 30_000,
  firstPreviewReservedMs: 5_000, // cold-spawn reservation; R0 measured ~28s
  maxOutputWidth: FLA_IMPORT_LIMITS.maxImageWidth, // 4,096
  maxOutputHeight: FLA_IMPORT_LIMITS.maxImageHeight, // 4,096
  maxOutputPixels: FLA_IMPORT_LIMITS.maxImagePixels, // 16,777,216
} as const;

// ---- R1 render-target identity / shape ----
export const FlaRenderTargetKindSchema = z.enum([
  'scene',           // main scene timeline
  'timeline',        // named timeline (e.g. action timeline)
  'graphic-symbol',  // LIBRARY graphic symbol
  'unknown',         // explicitly distinguishable from supported
]);

export const FlaRenderTargetIdSchema = z.string().regex(
  /^fla-render-target-[a-z0-9-]{8,160}$/u,
);

const FlaCompatibilityStatusListSchema = z.array(
  z.enum(['exact', 'degraded', 'unsupported', 'unknown', 'not-present']),
).max(16);

export const FlaRenderTargetSchema = z
  .object({
    renderTargetId: FlaRenderTargetIdSchema,
    kind: FlaRenderTargetKindSchema,
    // Beginner-readable name. Never DOMTimeline / DOMLayer / DOMFrame / XFL
    // / Edge / MovieClip internals.
    userLabel: z.string().trim().min(1).max(500),
    // Diagnostic-only optional fields. They are NEVER user-facing labels.
    sourceLibraryItemName: z.string().trim().min(1).max(500).optional(),
    sourceTimelineIndex: z.number().int().nonnegative().max(10_000).optional(),
    sourceSymbolName: z.string().trim().min(1).max(500).optional(),
    // Bounded integer.
    frameCount: z.number().int().positive().max(100_000),
    // Optional; defaults to 0. Commit requires it to be set explicitly.
    selectedFrameIndex: z.number().int().nonnegative().optional(),
    // Compatibility / warning state for this target (the existing V1
    // status vocabulary; a future R2 may extend).
    compatibility: FlaCompatibilityStatusListSchema,
  })
  .strict()
  .refine(
    (target) => target.selectedFrameIndex === undefined ||
                target.selectedFrameIndex < target.frameCount,
    'selectedFrameIndex must be < frameCount',
  );

// ---- R1-A renderable target catalog (returned by inspection) ----
export const FlaRenderableTargetCatalogEntrySchema = z
  .object({
    target: FlaRenderTargetSchema,
    // Whether the user can actually preview this target right now. If
    // false, unsupportedReason is required.
    previewSupported: z.boolean(),
    unsupportedReason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()
  .refine(
    (entry) => entry.previewSupported || Boolean(entry.unsupportedReason),
    'unsupportedReason is required when previewSupported is false',
  );

export const FlaRenderableTargetCatalogSchema = z
  .object({
    ok: z.literal(true),
    sessionId: z.uuid(),
    entries: z
      .array(FlaRenderableTargetCatalogEntrySchema)
      .max(FLA_STATIC_SNAPSHOT_LIMITS.maxRenderableTargetsPerFile),
    // Beginner-facing summary line shown next to the catalog (Chinese in
    // V1/V1.5 review). The Main-side adapter may localize.
    summary: z.string().trim().min(1).max(1_000),
  })
  .strict();

// Renderer asks for the catalog by session id; Main returns either the
// catalog (success) or a typed failure. Kept minimal on purpose.
export const FlaRenderableTargetCatalogRequestSchema = z
  .object({
    format: z.literal('fla-static-snapshot-catalog'),
    version: z.literal(1),
    sessionId: z.uuid(),
  })
  .strict();

export const FlaRenderableTargetCatalogResponseSchema = z.union([
  FlaRenderableTargetCatalogSchema,
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: z.enum(['SESSION_NOT_FOUND', 'INVALID_REQUEST', 'UNKNOWN_ERROR']),
          message: z.string().trim().min(1).max(1_000),
        })
        .strict(),
    })
    .strict(),
]);
export type FlaRenderableTargetCatalogRequest = z.infer<
  typeof FlaRenderableTargetCatalogRequestSchema
>;
export type FlaRenderableTargetCatalogResponse = z.infer<
  typeof FlaRenderableTargetCatalogResponseSchema
>;

// ---- R1-B preview request (renderer -> main -> sandboxed browser window) ----
export const FlaStaticSnapshotPreviewRequestSchema = z
  .object({
    format: z.literal('fla-static-snapshot-preview'),
    version: z.literal(1),
    requestId: z.uuid(),
    // Identifies the underlying FLA inspection session (source bytes,
    // preflight, sha256, parser identity). Reused from V1/V1.5.
    sessionId: z.uuid(),
    target: FlaRenderTargetSchema,
  })
  .strict();

const EncodedPngBytesSchema = z
  .custom<Uint8Array>(
    (value) => value instanceof Uint8Array,
    'expected Uint8Array',
  )
  .refine(
    (value) =>
      value.byteLength > 0 &&
      value.byteLength <= FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes,
    `encoded PNG payload must be 1..${FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes} bytes`,
  );

// ---- R1-B preview response (main -> renderer) ----
export const FlaStaticSnapshotPreviewSuccessSchema = z
  .object({
    ok: z.literal(true),
    requestId: z.uuid(),
    // Echoed target identity so the renderer can detect stale results
    // without re-deriving the target from the original request.
    targetRenderTargetId: FlaRenderTargetIdSchema,
    targetSelectedFrameIndex: z.number().int().nonnegative(),
    width: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth),
    height: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight),
    pixelCount: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels),
    bytes: EncodedPngBytesSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    // Wall-clock time for THIS preview, in ms. R1-B requires this to
    // be honest (no estimates).
    wallClockMs: z.number().int().nonnegative(),
    // First preview of the session is the cold-spawn path; subsequent
    // previews can reuse the sandboxed renderer and should be much
    // cheaper. The renderer must report which case this was so
    // a single run cannot masquerade as both.
    isFirstPreviewForSession: z.boolean(),
    // ISO 8601 timestamp at the moment the PNG was emitted by the
    // sandboxed renderer. Used for debugging only, not for stale logic.
    startedAt: z.string().datetime(),
  })
  .strict();

export const FlaStaticSnapshotPreviewErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'SESSION_NOT_FOUND',
  'SOURCE_MISMATCH',
  'TARGET_UNSUPPORTED',       // target kind is not renderable in this build
  'TARGET_OUT_OF_RANGE',      // selectedFrameIndex invalid for current target
  'RENDER_TIMEOUT',           // R0 spike's 30s wall clock was hit
  'RENDER_CANCELLED',         // latest-request-wins cancellation
  'RENDERER_CRASH',           // sandboxed BrowserWindow crashed
  'RENDER_FAILED',            // generic render failure
  'BUDGET_EXCEEDED',          // output width/height/pixels/bytes exceeded
]);

export const FlaStaticSnapshotPreviewErrorSchema = z
  .object({
    code: FlaStaticSnapshotPreviewErrorCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    // Echoed when available so the renderer can correlate failures
    // without a second lookup.
    requestId: z.uuid().optional(),
  })
  .strict();

export const FlaStaticSnapshotPreviewResponseSchema = z.union([
  FlaStaticSnapshotPreviewSuccessSchema,
  z
    .object({
      ok: z.literal(false),
      error: FlaStaticSnapshotPreviewErrorSchema,
    })
    .strict(),
]);

// ---- R1-D stale-preview guard: the commit MUST pin a specific
//      confirmedPreviewRequestId. The Main process tracks the latest
//      accepted preview per session and rejects commits that pin
//      anything other than the latest. -----------------------------
// ---- R1-E commit request (renderer -> main) ----
export const FlaStaticSnapshotCommitRequestSchema = z
  .object({
    format: z.literal('fla-static-snapshot-commit'),
    version: z.literal(1),
    projectRoot: z.string().trim().min(1).max(32_767),
    project: ProjectSchema,
    baseRevision: z.number().int().nonnegative(),
    sessionId: z.uuid(),
    // The preview request that the user explicitly confirmed. The Main
    // process compares it against the latest accepted preview for the
    // session and rejects any non-latest preview with STALE_PREVIEW.
    confirmedPreviewRequestId: z.uuid(),
    source: z
      .object({
        basename: z.string().trim().min(1).max(260),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    target: FlaRenderTargetSchema,
    // The pre-confirmed preview metadata. The Main process verifies
    // these match the confirmedPreviewRequestId.
    preview: z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        width: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth),
        height: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight),
        byteLength: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes),
      })
      .strict(),
    confirmed: z.literal(true),
  })
  .strict()
  .refine(
    (request) => request.target.selectedFrameIndex !== undefined,
    'selectedFrameIndex must be set on the committed target',
  );

// ---- R1-E commit response (main -> renderer) ----
export const FlaStaticSnapshotCommitResultSchema = z
  .object({
    assetId: z.uuid(),
    sourceName: z.string().trim().min(1).max(500),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    status: z.enum(['imported', 'duplicate']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    asset: ImageAssetSchema,
    duplicateOfAssetId: z.uuid().nullable(),
    targetFileName: z.string().trim().min(1).max(260),
    renamed: z.boolean(),
    message: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const FlaStaticSnapshotCommitErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'SESSION_NOT_FOUND',
  'SOURCE_MISMATCH',
  'STALE_PREVIEW',             // confirmedPreviewRequestId != latest accepted
  'TARGET_UNSUPPORTED',
  'TARGET_OUT_OF_RANGE',
  'STALE_PROJECT_REVISION',
  'IMPORT_COLLISION',
  'ASSET_COMMIT_FAILED',
  'ROLLBACK_FAILED',
  'JOURNAL_RECOVERY_FAILED',
  'COMMIT_BUSY',
  'BUDGET_EXCEEDED',
]);

export const FlaStaticSnapshotCommitErrorSchema = z
  .object({
    code: FlaStaticSnapshotCommitErrorCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    projectRoot: z.string().trim().min(1).max(32_767),
    currentProject: ProjectSchema.optional(),
    currentRevision: z.number().int().nonnegative().optional(),
    residualPaths: z
      .array(z.string().trim().min(1).max(260))
      .max(1024)
      .optional(),
  })
  .strict();

export const FlaStaticSnapshotCommitResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      status: z.literal('completed'),
      project: ProjectSchema,
      baseRevision: z.number().int().nonnegative(),
      savedRevision: z.number().int().nonnegative(),
      projectChanged: z.boolean(),
      result: FlaStaticSnapshotCommitResultSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: FlaStaticSnapshotCommitErrorSchema,
    })
    .strict(),
]);

// ---- R1 cancel request (per R1-B latest-request-wins) ----
export const FlaStaticSnapshotCancelRequestSchema = z
  .object({
    format: z.literal('fla-static-snapshot-cancel'),
    version: z.literal(1),
    // Cancelling without requestId cancels the latest in-flight preview
    // for the session.
    requestId: z.uuid().optional(),
    sessionId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (request) => Boolean(request.requestId || request.sessionId),
    'requestId or sessionId is required',
  );

export const FlaStaticSnapshotCancelResponseSchema = z
  .object({
    accepted: z.boolean(),
    cancelledRequestId: z.uuid().optional(),
  })
  .strict();

// ---- Type exports ----
export type FlaRenderTargetKind = z.infer<typeof FlaRenderTargetKindSchema>;
export type FlaRenderTarget = z.infer<typeof FlaRenderTargetSchema>;
export type FlaRenderableTargetCatalogEntry = z.infer<typeof FlaRenderableTargetCatalogEntrySchema>;
export type FlaRenderableTargetCatalog = z.infer<typeof FlaRenderableTargetCatalogSchema>;
export type FlaStaticSnapshotPreviewRequest = z.infer<typeof FlaStaticSnapshotPreviewRequestSchema>;
export type FlaStaticSnapshotPreviewSuccess = z.infer<typeof FlaStaticSnapshotPreviewSuccessSchema>;
export type FlaStaticSnapshotPreviewErrorCode = z.infer<typeof FlaStaticSnapshotPreviewErrorCodeSchema>;
export type FlaStaticSnapshotPreviewError = z.infer<typeof FlaStaticSnapshotPreviewErrorSchema>;
export type FlaStaticSnapshotPreviewResponse = z.infer<typeof FlaStaticSnapshotPreviewResponseSchema>;
export type FlaStaticSnapshotCommitRequest = z.infer<typeof FlaStaticSnapshotCommitRequestSchema>;
export type FlaStaticSnapshotCommitResult = z.infer<typeof FlaStaticSnapshotCommitResultSchema>;
export type FlaStaticSnapshotCommitErrorCode = z.infer<typeof FlaStaticSnapshotCommitErrorCodeSchema>;
export type FlaStaticSnapshotCommitError = z.infer<typeof FlaStaticSnapshotCommitErrorSchema>;
export type FlaStaticSnapshotCommitResponse = z.infer<typeof FlaStaticSnapshotCommitResponseSchema>;
export type FlaStaticSnapshotCancelRequest = z.infer<typeof FlaStaticSnapshotCancelRequestSchema>;
export type FlaStaticSnapshotCancelResponse = z.infer<typeof FlaStaticSnapshotCancelResponseSchema>;
