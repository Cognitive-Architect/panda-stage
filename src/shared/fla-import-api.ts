import { z } from 'zod';

/**
 * Issue #251 Slice 1 contract.
 *
 * This file is deliberately Panda-owned.  It must not import the pinned
 * fla-viewer parser, Electron, Node, DOM types, or any browser object.  The
 * adapter is the only place where upstream parser values are translated into
 * these serializable structures.
 */

export const FLA_PARSER_COMMIT =
  '048000ccab67469980b8dedd1fc2b65a02d2b164';
export const FLA_PARSER_ENTRYPOINT = 'FLAParser.parse';
export const FLA_PARSER_PACKAGE = 'lifeart/fla-viewer';

export const FLA_IMPORT_LIMITS = {
  maxSourceBytes: 256 * 1024 * 1024,
  maxZipEntries: 20_000,
  maxExpandedArchiveBytes: 1024 * 1024 * 1024,
  maxSingleEntryBytes: 64 * 1024 * 1024,
  maxXmlBytes: 32 * 1024 * 1024,
  maxMediaCount: 2_048,
  maxImageWidth: 4_096,
  maxImageHeight: 4_096,
  maxImagePixels: 16_777_216,
  maxTotalDecodedPixels: 128_000_000,
  maxTotalDecodedRgbaBytes: 512 * 1024 * 1024,
  parserWallTimeMs: 30_000,
  noProgressWatchdogMs: 5_000,
  cancelGraceMs: 2_000,
  maxRecursionDepth: 64,
} as const;

export const FlaImportErrorCodeSchema = z.enum([
  'UNSUPPORTED_FLA_CONTAINER',
  'ARCHIVE_LIMIT_EXCEEDED',
  'MALFORMED_ARCHIVE',
  'MALFORMED_XFL',
  'XML_LIMIT_EXCEEDED',
  'PARSER_TIMEOUT',
  'PARSER_CRASH',
  'MEDIA_LIMIT_EXCEEDED',
  'MEDIA_DECODE_FAILED',
  'UNSUPPORTED_FEATURE_PRESENT',
  'USER_CANCELLED',
]);

export const FlaSourceFormatSchema = z.enum(['png', 'jpeg', 'jpg', 'unknown']);

export const FlaMediaIdSchema = z.string().regex(
  /^fla-media-[a-z0-9-]{8,160}$/u,
);

export const FlaSourceIRSchema = z
  .object({
    format: z.literal('fla'),
    basename: z.string().trim().min(1).max(260),
    byteLength: z.number().int().nonnegative().max(FLA_IMPORT_LIMITS.maxSourceBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    parser: z
      .object({
        package: z.literal(FLA_PARSER_PACKAGE),
        entrypoint: z.literal(FLA_PARSER_ENTRYPOINT),
        commit: z.literal(FLA_PARSER_COMMIT),
      })
      .strict(),
  })
  .strict();

export const FlaDocumentIRSchema = z
  .object({
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
    frameRate: z.number().finite().nonnegative(),
    backgroundColor: z.string().max(32),
  })
  .strict();

export const FlaAlphaInfoIRSchema = z
  .object({
    kind: z.enum(['opaque', 'transparent', 'mixed', 'unknown']),
    zeroAlphaPixels: z.number().int().nonnegative(),
    partialAlphaPixels: z.number().int().nonnegative(),
  })
  .strict();

const Uint8ArraySchema = z.custom<Uint8Array>(
  (value) => value instanceof Uint8Array,
  'expected Uint8Array',
);
const EncodedPngBytesSchema = Uint8ArraySchema.refine(
  (value) => value.byteLength <= FLA_IMPORT_LIMITS.maxSingleEntryBytes,
  `encoded PNG payload must be at most ${FLA_IMPORT_LIMITS.maxSingleEntryBytes} bytes`,
);

export const FlaEncodedImagePayloadIRSchema = z
  .object({
    mimeType: z.literal('image/png'),
    width: z.number().int().positive().max(FLA_IMPORT_LIMITS.maxImageWidth),
    height: z.number().int().positive().max(FLA_IMPORT_LIMITS.maxImageHeight),
    bytes: EncodedPngBytesSchema,
    alpha: FlaAlphaInfoIRSchema,
  })
  .strict();

export const FlaBitmapMediaIRSchema = z
  .object({
    id: FlaMediaIdSchema,
    name: z.string().trim().min(1).max(500),
    sourceReference: z.string().trim().min(1).max(32_767),
    bitmapDataReference: z.string().trim().min(1).max(32_767).nullable(),
    sourceFormat: FlaSourceFormatSchema,
    width: z.number().int().positive().max(FLA_IMPORT_LIMITS.maxImageWidth),
    height: z.number().int().positive().max(FLA_IMPORT_LIMITS.maxImageHeight),
    payload: FlaEncodedImagePayloadIRSchema,
  })
  .strict();

export const FlaMatrixIRSchema = z
  .object({
    a: z.number().finite(),
    b: z.number().finite(),
    c: z.number().finite(),
    d: z.number().finite(),
    tx: z.number().finite(),
    ty: z.number().finite(),
  })
  .strict();

export const FlaFrameInstanceIRSchema = z
  .object({
    id: z.string().regex(/^fla-instance-[a-z0-9-]{8,160}$/u),
    mediaId: z.string().regex(/^fla-media-[a-z0-9-]{8,160}$/u),
    sourceLibraryItemName: z.string().trim().min(1).max(500),
    matrix: FlaMatrixIRSchema,
  })
  .strict();

export const FlaFrameIRSchema = z
  .object({
    id: z.string().regex(/^fla-frame-[a-z0-9-]{8,160}$/u),
    sourceFrameIndex: z.number().int().nonnegative(),
    startFrame: z.number().int().nonnegative(),
    duration: z.number().int().positive(),
    instances: z.array(FlaFrameInstanceIRSchema).max(100_000),
  })
  .strict();

export const FlaLayerIRSchema = z
  .object({
    id: z.string().regex(/^fla-layer-[a-z0-9-]{8,160}$/u),
    name: z.string().max(500),
    sourceLayerIndex: z.number().int().nonnegative(),
    visible: z.boolean(),
    locked: z.boolean(),
    frames: z.array(FlaFrameIRSchema).max(100_000),
  })
  .strict();

export const FlaTimelineIRSchema = z
  .object({
    id: z.string().regex(/^fla-timeline-[a-z0-9-]{8,160}$/u),
    name: z.string().max(500),
    totalFrames: z.number().int().nonnegative(),
    layers: z.array(FlaLayerIRSchema).max(10_000),
  })
  .strict();

export const FlaCompatibilityEntryIRSchema = z
  .object({
    feature: z.string().trim().min(1).max(200),
    status: z.enum([
      'exact',
      'degraded',
      'unsupported',
      'unknown',
      'not-present',
    ]),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

/**
 * V1.5-B1 read-only structural summary.
 *
 * Inspection-only metadata derived from the same FLADocument that produced the
 * raster IR (media/timelines/compatibility).  It carries NO Project schema,
 * persists to NO Asset metadata, and creates NO Shots/Layers/Timeline objects.
 *
 * Counts reuse B0's proven definitions (see tests/helpers/fla-structural-probe.ts
 * and the B0 structural probe integration test).  Implementation must follow the
 * production parser source of truth via the adapter; the B0 helper stays in
 * tests/ evidence scope and is not duplicated as the production architecture.
 */
export const FlaStructuralSummaryIRSchema = z
  .object({
    sceneCount: z.number().int().nonnegative(),
    totalTimelineCount: z.number().int().nonnegative(),
    layerCount: z.number().int().nonnegative(),
    frameCount: z.number().int().nonnegative(),
    tweenCount: z.number().int().nonnegative(),
    symbolCount: z.number().int().nonnegative(),
    movieClipCount: z.number().int().nonnegative(),
    graphicCount: z.number().int().nonnegative(),
    buttonCount: z.number().int().nonnegative(),
  })
  .strict();

export const AnimationImportIRSchema = z
  .object({
    source: FlaSourceIRSchema,
    document: FlaDocumentIRSchema,
    media: z.array(FlaBitmapMediaIRSchema).max(FLA_IMPORT_LIMITS.maxMediaCount),
    timelines: z.array(FlaTimelineIRSchema).max(10_000),
    compatibility: z.array(FlaCompatibilityEntryIRSchema).max(10_000),
    summary: z
      .object({
        placedInstanceCount: z.number().int().nonnegative(),
        libraryOnlyMediaCount: z.number().int().nonnegative(),
      })
      .strict(),
    structure: FlaStructuralSummaryIRSchema.optional(),
  })
  .strict();

export const FlaImportErrorSchema = z
  .object({
    code: FlaImportErrorCodeSchema,
    message: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const FlaRecoveryClassifierStateSchema = z.enum([
  'STRICT_VALID',
  'RECOVERY_CANDIDATE',
  'REJECT',
  'AMBIGUOUS',
]);

/**
 * Ephemeral Main-owned inspection facts.  This is deliberately not Project
 * data and contains no archive offsets or source bytes.  It lets the product
 * and acceptance receipts distinguish strict inspection, recovery, validation
 * and parser outcomes without exposing the classifier's low-level measurements.
 */
export const FlaInspectionTraceSchema = z
  .object({
    ingestMode: z.enum(['strict', 'compatibility-recovered']),
    recoveryApplied: z.boolean(),
    originalStrictResult: z.enum(['pass', 'reject']),
    classifierState: FlaRecoveryClassifierStateSchema,
    recoveryAttempted: z.boolean(),
    postNormalizationStrictResult: z.enum(['not-run', 'pass', 'fail']),
    parserResult: z.enum(['not-run', 'success', 'failure']),
    originalSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    originalSourceByteLength: z.number().int().nonnegative().max(FLA_IMPORT_LIMITS.maxSourceBytes),
    classifierReasonCodes: z
      .array(z.string().regex(/^[A-Z0-9_]+$/u).max(120))
      .max(16)
      .optional(),
    recoveryReasonCode: z.string().regex(/^[A-Z0-9_]+$/u).max(120).optional(),
  })
  .strict();

/**
 * V1.5-A diagnostic category.  Three user-distinguishable states keep the
 * fail-closed V1 behavior while making rejections / empty results explainable:
 * `archive-malformed` (safety-rejected container), `no-importable-raster`
 * (valid file, nothing raster to import), and `unsupported-or-unknown` (a state
 * the contract can distinguish but is not a raster import).  A diagnostic is
 * observability only; it never changes the security decision.
 */
export const FlaDiagnosticCategorySchema = z.enum([
  'archive-malformed',
  'no-importable-raster',
  'unsupported-or-unknown',
]);

export const FlaDiagnosticSchema = z
  .object({
    category: FlaDiagnosticCategorySchema,
    // Beginner-facing copy.  Must never contain developer-only archive
    // internals such as hashes, offsets, centralDirectorySize, EOCD, the
    // parser package name, or internal paths.
    userMessage: z.string().trim().min(1).max(500),
    // Optional developer-only detail; surfaced only in logs / debug surfaces,
    // never in the primary user copy.
    developerNote: z.string().trim().max(1_000).optional(),
  })
  .strict();

export const FlaInspectionResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      sessionId: z.uuid(),
      ir: AnimationImportIRSchema,
      diagnostics: z.array(FlaDiagnosticSchema).max(16).optional(),
      trace: FlaInspectionTraceSchema.optional(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: FlaImportErrorSchema,
      diagnostics: z.array(FlaDiagnosticSchema).max(16).optional(),
      trace: FlaInspectionTraceSchema.optional(),
    })
    .strict(),
]);

export const FlaInspectRequestSchema = z
  .object({
    requestId: z.uuid(),
  })
  .strict();

/**
 * Main emits this narrow, ephemeral signal after the native chooser returns
 * an authoritative source path and immediately before inspection begins.
 * It intentionally carries no path, basename, bytes, or parser progress.
 */
export const FlaInspectionStartedSchema = z
  .object({
    requestId: z.uuid(),
  })
  .strict();

export const FlaCancelRequestSchema = z
  .object({
    requestId: z.uuid().optional(),
    sessionId: z.uuid().optional(),
  })
  .strict()
  .refine((request) => Boolean(request.requestId || request.sessionId), {
    message: 'requestId or sessionId is required',
  });

export const FlaCancelResponseSchema = z
  .object({
    accepted: z.boolean(),
  })
  .strict();

/**
 * Slice 2 handoff only.  This is a read-only intent; it is not an Asset or
 * Project mutation request and must not be sent to the normal import IPC.
 */
export const FlaRasterSelectionIntentSchema = z
  .object({
    format: z.literal('fla-raster-selection'),
    version: z.literal(1),
    sessionId: z.uuid(),
    source: z
      .object({
        basename: z.string().trim().min(1).max(260),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    selectedMediaIds: z
      .array(FlaMediaIdSchema)
      .max(FLA_IMPORT_LIMITS.maxMediaCount)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'selectedMediaIds must be unique',
      ),
    selectedCount: z.number().int().nonnegative().max(FLA_IMPORT_LIMITS.maxMediaCount),
  })
  .strict()
  .refine(
    (intent) => intent.selectedCount === intent.selectedMediaIds.length,
    'selectedCount must match selectedMediaIds.length',
  );

/** Internal worker messages. They still contain only Panda-owned values. */
export const FlaWorkerStartRequestSchema = z
  .object({
    sessionId: z.uuid(),
    source: z
      .object({
        basename: z.string().trim().min(1).max(260),
        byteLength: z.number().int().nonnegative().max(FLA_IMPORT_LIMITS.maxSourceBytes),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        bytes: Uint8ArraySchema,
        containsActionScript: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const FlaWorkerProgressSchema = z
  .object({
    sessionId: z.uuid(),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const FlaWorkerResultSchema = z
  .object({
    sessionId: z.uuid(),
    ir: AnimationImportIRSchema,
  })
  .strict();

export const FlaWorkerErrorSchema = z
  .object({
    sessionId: z.uuid(),
    error: FlaImportErrorSchema,
  })
  .strict();

export type FlaImportErrorCode = z.infer<typeof FlaImportErrorCodeSchema>;
export type FlaRecoveryClassifierState = z.infer<typeof FlaRecoveryClassifierStateSchema>;
export type FlaInspectionTrace = z.infer<typeof FlaInspectionTraceSchema>;
export type AnimationImportIR = z.infer<typeof AnimationImportIRSchema>;
export type FlaInspectionResponse = z.infer<typeof FlaInspectionResponseSchema>;
export type FlaInspectRequest = z.infer<typeof FlaInspectRequestSchema>;
export type FlaInspectionStarted = z.infer<typeof FlaInspectionStartedSchema>;
export type FlaCancelRequest = z.infer<typeof FlaCancelRequestSchema>;
export type FlaCancelResponse = z.infer<typeof FlaCancelResponseSchema>;
export type FlaCompatibilityStatus = AnimationImportIR['compatibility'][number]['status'];
export type FlaRasterSelectionIntent = z.infer<typeof FlaRasterSelectionIntentSchema>;
export type FlaWorkerStartRequest = z.infer<typeof FlaWorkerStartRequestSchema>;
export type FlaWorkerProgress = z.infer<typeof FlaWorkerProgressSchema>;
export type FlaWorkerResult = z.infer<typeof FlaWorkerResultSchema>;
export type FlaWorkerError = z.infer<typeof FlaWorkerErrorSchema>;
export type FlaDiagnosticCategory = z.infer<typeof FlaDiagnosticCategorySchema>;
export type FlaDiagnostic = z.infer<typeof FlaDiagnosticSchema>;
export type FlaStructuralSummary = z.infer<typeof FlaStructuralSummaryIRSchema>;
