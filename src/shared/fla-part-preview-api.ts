import { z } from 'zod';
import { FLA_STATIC_SNAPSHOT_LIMITS, FlaRenderTargetIdSchema } from './fla-static-snapshot-api';

export const FLA_PART_PREVIEW_LIMITS = Object.freeze({
  maxParts: 24,
  maxOccurrenceDepth: 64,
  maxCompositionInputBytes: 32 * 1024 * 1024,
  maxTotalPngBytes: FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes,
  maxBatchWallTimeMs: 120_000,
  planLifetimeMs: 5 * 60_000,
});

export const FlaPartPreviewCapabilitySchema = z.enum([
  'EDITABLE_PARTS_READY',
  'WHOLE_IMAGE_ONLY',
  'UNSUPPORTED',
]);

export const FlaPartPreviewRequestSchema = z.object({
  format: z.literal('fla-part-preview'),
  version: z.literal(1),
  requestId: z.uuid(),
  sessionId: z.uuid(),
  generation: z.number().int().positive().max(2_147_483_647),
  target: z.object({
    renderTargetId: FlaRenderTargetIdSchema,
    selectedFrameIndex: z.number().int().nonnegative().max(100_000),
  }).strict(),
}).strict();

export const FlaPartPreviewCancelRequestSchema = z.object({
  format: z.literal('fla-part-preview-cancel'),
  version: z.literal(1),
  requestId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
  generation: z.number().int().positive().max(2_147_483_647).optional(),
}).strict().refine(
  (request) => Boolean(request.requestId || request.sessionId),
  'requestId or sessionId is required',
);

const FlaPartPreviewMatrixSchema = z.object({
  a: z.number().finite(),
  b: z.number().finite(),
  c: z.number().finite(),
  d: z.number().finite(),
  tx: z.number().finite(),
  ty: z.number().finite(),
}).strict();

const FlaPartPreviewFrameDependencySchema = z.object({
  contextPath: z.string().trim().min(1).max(2_000),
  layerIndex: z.number().int().nonnegative().max(100_000),
  elementIndex: z.number().int().nonnegative().max(100_000),
  sourceAddress: z.string().trim().min(1).max(1_000).nullable(),
  sourceSymbolId: z.string().trim().min(1).max(500).nullable(),
  parentFrameIndex: z.number().int().nonnegative().nullable(),
  parentFrameSpanStart: z.number().int().nonnegative().nullable(),
  parentSpanTweenType: z.string().trim().max(100).nullable(),
  playbackMode: z.string().trim().max(100).nullable(),
  firstFrame: z.string().trim().max(100).nullable(),
  lastFrame: z.string().trim().max(100).nullable(),
}).strict();

export const FlaPartPreviewUnitSchema = z.object({
  unitId: z.string().regex(/^part-[a-z0-9-]{8,160}$/u),
  occurrenceId: z.string().regex(/^occ-[a-f0-9]{24,64}$/u),
  sourceKind: z.enum(['graphic-symbol-occurrence', 'shape-occurrence', 'bitmap-occurrence', 'group-occurrence']),
  sourceSymbolId: z.string().trim().min(1).max(500).nullable(),
  sourceAddress: z.string().trim().min(1).max(1_000).nullable(),
  adapterIdentity: z.string().trim().min(1).max(500).nullable(),
  sourceContextPath: z.string().trim().min(1).max(2_000),
  occurrencePath: z.array(FlaPartPreviewFrameDependencySchema).max(FLA_PART_PREVIEW_LIMITS.maxOccurrenceDepth),
  sourceDefinitionFrameCount: z.number().int().positive().max(100_000).nullable(),
  selectedEffectiveChildFrameIndex: z.number().int().nonnegative().nullable(),
  selectedEffectiveChildFrameBasis: z.string().trim().min(1).max(1_000).nullable(),
  localTransform: FlaPartPreviewMatrixSchema,
  worldTransform: FlaPartPreviewMatrixSchema,
  determinant: z.number().finite(),
  visible: z.literal(true),
  layer: z.object({
    name: z.string().trim().min(1).max(500),
    sourceLayerIndex: z.number().int().nonnegative().max(100_000),
    visible: z.literal(true),
    maskLayerId: z.string().trim().min(1).max(1_000).nullable(),
    maskedBy: z.string().trim().min(1).max(1_000).nullable(),
  }).strict(),
  drawOrder: z.number().int().nonnegative().max(FLA_PART_PREVIEW_LIMITS.maxParts),
  composite: z.boolean(),
  compositeReason: z.string().trim().min(1).max(1_000).nullable(),
  maskDependencies: z.array(z.object({
    contextPath: z.string().trim().min(1).max(2_000),
    layerIndex: z.number().int().nonnegative().max(100_000),
    layerName: z.string().trim().min(1).max(500),
    maskLayerId: z.string().trim().min(1).max(1_000).nullable(),
    maskedBy: z.string().trim().min(1).max(1_000).nullable(),
    visible: z.boolean(),
  }).strict()).max(64),
  sourceFrame: z.object({
    parentFrameIndex: z.number().int().nonnegative().nullable(),
    parentFrameSpanStart: z.number().int().nonnegative().nullable(),
    parentSpanTweenType: z.string().trim().max(100).nullable(),
    playbackMode: z.string().trim().max(100).nullable(),
    firstFrame: z.string().trim().max(100).nullable(),
    lastFrame: z.string().trim().max(100).nullable(),
    effectiveChildFrameIndex: z.number().int().nonnegative().nullable(),
  }).strict(),
  stageMapping: z.object({
    coordinateSpace: z.literal('root-scene-stage-pixels'),
    stageOrigin: z.object({ x: z.literal(0), y: z.literal(0) }).strict(),
    crop: z.null(),
    outputScale: z.literal(1),
    transformApplication: z.literal('resolved-once-in-main; reassembly-uses-stage-identity'),
  }).strict(),
  traceability: z.enum(['source-address-and-parent-chain', 'adapter-identity-only']),
  untraceableReason: z.string().trim().min(1).max(1_000).nullable(),
}).strict();

export const FlaPartPlanSchema = z.object({
  format: z.literal('panda-fla-part-plan'),
  version: z.literal(1),
  planId: z.uuid(),
  sessionId: z.uuid(),
  requestId: z.uuid(),
  generation: z.number().int().positive(),
  expiresAt: z.string().datetime(),
  source: z.object({
    basename: z.string().trim().min(1).max(260),
    rawSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    normalizedSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict(),
  target: z.object({
    renderTargetId: FlaRenderTargetIdSchema,
    kind: z.literal('scene'),
    userLabel: z.string().trim().min(1).max(500),
    sceneIndex: z.number().int().nonnegative().max(10_000),
    frameCount: z.number().int().positive().max(100_000),
    selectedFrameIndex: z.number().int().nonnegative().max(100_000),
    frameSelectionBasis: z.literal('authored Scene frame selected through Main prepared source'),
  }).strict(),
  poseIdentity: z.string().regex(/^[a-f0-9]{64}$/u),
  stage: z.object({
    width: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth),
    height: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight),
    pixelCount: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels),
    coordinateSpace: z.literal('root-scene-stage-pixels'),
  }).strict(),
  capability: FlaPartPreviewCapabilitySchema,
  capabilityReason: z.string().trim().min(1).max(1_000).nullable(),
  units: z.array(FlaPartPreviewUnitSchema).max(FLA_PART_PREVIEW_LIMITS.maxParts),
}).strict().superRefine((plan, context) => {
  if (plan.target.selectedFrameIndex >= plan.target.frameCount) {
    context.addIssue({ code: 'custom', message: 'Selected frame is outside the declared frame range' });
  }
  if (plan.capability === 'EDITABLE_PARTS_READY' && plan.units.length < 2) {
    context.addIssue({ code: 'custom', message: 'Editable parts require at least two independent source units' });
  }
  if (plan.capability === 'EDITABLE_PARTS_READY' && plan.capabilityReason !== null) {
    context.addIssue({ code: 'custom', message: 'Editable parts cannot carry a fallback reason' });
  }
  if (plan.capability !== 'EDITABLE_PARTS_READY' && !plan.capabilityReason) {
    context.addIssue({ code: 'custom', message: 'Fallback plans require a reason' });
  }
  const occurrenceIds = new Set<string>();
  for (const unit of plan.units) {
    if (occurrenceIds.has(unit.occurrenceId)) {
      context.addIssue({ code: 'custom', message: 'Part occurrence identities must be unique' });
      break;
    }
    occurrenceIds.add(unit.occurrenceId);
  }
});

const FlaPartPreviewPngSchema = z.object({
  width: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth),
  height: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight),
  pixelCount: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  byteLength: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes),
  bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'expected Uint8Array')
    .refine((value) => value.byteLength > 0 && value.byteLength <= FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes),
}).strict().refine((image) => image.byteLength === image.bytes.byteLength, 'byteLength does not match PNG payload');

const FlaPartPreviewMetricsSchema = z.object({
  preparedSourceCacheHit: z.boolean(),
  sourcePreparationCountForRequest: z.union([z.literal(0), z.literal(1)]),
  displayListResolveCount: z.number().int().nonnegative().max(FLA_PART_PREVIEW_LIMITS.maxParts + 1),
  rasterCount: z.number().int().nonnegative().max(FLA_PART_PREVIEW_LIMITS.maxParts + 2),
  unitCount: z.number().int().nonnegative().max(FLA_PART_PREVIEW_LIMITS.maxParts),
  totalPngBytes: z.number().int().nonnegative().max(FLA_PART_PREVIEW_LIMITS.maxTotalPngBytes),
  elapsedMs: z.number().nonnegative().max(FLA_PART_PREVIEW_LIMITS.maxBatchWallTimeMs),
}).strict();

export const FlaPartPreviewErrorCodeSchema = z.enum([
    'INVALID_REQUEST',
    'SESSION_NOT_FOUND',
    'TARGET_NOT_FOUND',
    'STALE_GENERATION',
    'PLAN_EXPIRED',
    'UNSUPPORTED_SOURCE',
    'BUDGET_EXCEEDED',
    'RENDER_CANCELLED',
    'RENDER_TIMEOUT',
    'RENDER_FAILED',
  ]);

const FlaPartPreviewErrorSchema = z.object({
  code: FlaPartPreviewErrorCodeSchema,
  message: z.string().trim().min(1).max(1_000),
}).strict();

const FlaPartPreviewBaseResponseSchema = z.object({
  requestId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
  generation: z.number().int().positive().optional(),
}).strict();

const FlaPartPreviewEditableReadySchema = FlaPartPreviewBaseResponseSchema.extend({
  ok: z.literal(true),
  status: z.literal('PREVIEW_READY'),
  capability: z.literal('EDITABLE_PARTS_READY'),
  planId: z.uuid(),
  poseIdentity: z.string().regex(/^[a-f0-9]{64}$/u),
  target: z.object({
    renderTargetId: FlaRenderTargetIdSchema,
    userLabel: z.string().trim().min(1).max(500),
    frameCount: z.number().int().positive().max(100_000),
    selectedFrameIndex: z.number().int().nonnegative().max(100_000),
  }).strict(),
  stage: z.object({
    width: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth),
    height: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight),
    pixelCount: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels),
  }).strict(),
  nativePreview: FlaPartPreviewPngSchema,
  partPreviews: z.array(z.object({
    unitId: z.string().regex(/^part-[a-z0-9-]{8,160}$/u),
    occurrenceId: z.string().regex(/^occ-[a-f0-9]{24,64}$/u),
    drawOrder: z.number().int().nonnegative().max(FLA_PART_PREVIEW_LIMITS.maxParts),
    image: FlaPartPreviewPngSchema,
  }).strict()).min(2).max(FLA_PART_PREVIEW_LIMITS.maxParts),
  reassembledPreview: FlaPartPreviewPngSchema,
  metrics: FlaPartPreviewMetricsSchema,
}).strict().superRefine((response, context) => {
  const total = response.nativePreview.byteLength + response.reassembledPreview.byteLength +
    response.partPreviews.reduce((sum, part) => sum + part.image.byteLength, 0);
  if (total > FLA_PART_PREVIEW_LIMITS.maxTotalPngBytes) {
    context.addIssue({ code: 'custom', message: 'Batch PNG output exceeds the total byte budget' });
  }
  if (response.target.selectedFrameIndex >= response.target.frameCount ||
      response.stage.pixelCount !== response.stage.width * response.stage.height) {
    context.addIssue({ code: 'custom', message: 'Target frame or stage dimensions are invalid' });
  }
  if (response.partPreviews.some((part, index) => part.drawOrder !== index)) {
    context.addIssue({ code: 'custom', message: 'Preview images are not in painter order' });
  }
});

const FlaPartPreviewWholeImageReadySchema = FlaPartPreviewBaseResponseSchema.extend({
  ok: z.literal(true),
  status: z.literal('PREVIEW_READY'),
  capability: z.literal('WHOLE_IMAGE_ONLY'),
  reason: z.string().trim().min(1).max(1_000),
  planId: z.uuid(),
  poseIdentity: z.string().regex(/^[a-f0-9]{64}$/u),
  target: z.object({
    renderTargetId: FlaRenderTargetIdSchema,
    userLabel: z.string().trim().min(1).max(500),
    frameCount: z.number().int().positive().max(100_000),
    selectedFrameIndex: z.number().int().nonnegative().max(100_000),
  }).strict(),
  stage: z.object({
    width: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth),
    height: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight),
    pixelCount: z.number().int().positive().max(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels),
  }).strict(),
  nativePreview: FlaPartPreviewPngSchema,
  partPreviews: z.tuple([]),
  reassembledPreview: z.null(),
  metrics: FlaPartPreviewMetricsSchema,
}).strict().superRefine((response, context) => {
  if (response.target.selectedFrameIndex >= response.target.frameCount ||
      response.stage.pixelCount !== response.stage.width * response.stage.height) {
    context.addIssue({ code: 'custom', message: 'Target frame or stage dimensions are invalid' });
  }
});

const FlaPartPreviewUnsupportedSchema = FlaPartPreviewBaseResponseSchema.extend({
  ok: z.literal(false),
  status: z.literal('ERROR'),
  capability: z.literal('UNSUPPORTED'),
  error: FlaPartPreviewErrorSchema,
}).strict();

const FlaPartPreviewFailureSchema = FlaPartPreviewBaseResponseSchema.extend({
  ok: z.literal(false),
  status: z.enum(['CANCELLED', 'ERROR']),
  error: FlaPartPreviewErrorSchema,
}).strict();

export const FlaPartPreviewResponseSchema = z.union([
  FlaPartPreviewEditableReadySchema,
  FlaPartPreviewWholeImageReadySchema,
  FlaPartPreviewUnsupportedSchema,
  FlaPartPreviewFailureSchema,
]);

export const FlaPartPreviewCancelResponseSchema = z.object({
  accepted: z.boolean(),
  cancelledRequestId: z.uuid().optional(),
}).strict();

export type FlaPartPreviewRequest = z.infer<typeof FlaPartPreviewRequestSchema>;
export type FlaPartPreviewErrorCode = z.infer<typeof FlaPartPreviewErrorCodeSchema>;
export type FlaPartPreviewCancelRequest = z.infer<typeof FlaPartPreviewCancelRequestSchema>;
export type FlaPartPreviewUnit = z.infer<typeof FlaPartPreviewUnitSchema>;
export type FlaPartPlan = z.infer<typeof FlaPartPlanSchema>;
export type FlaPartPreviewResponse = z.infer<typeof FlaPartPreviewResponseSchema>;
export type FlaPartPreviewCancelResponse = z.infer<typeof FlaPartPreviewCancelResponseSchema>;
