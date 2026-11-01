import { z } from 'zod';
import { ProjectSchema } from '../domain';
import { FlaRenderTargetIdSchema } from './fla-static-snapshot-api';
import { FLA_PART_PREVIEW_LIMITS } from './fla-part-preview-api';

const ProjectRootSchema = z.string().trim().min(1).max(32_767);
const IdSchema = z.string().trim().min(1).max(200);
const UuidSchema = z.uuid();
const RevisionSchema = z.number().int().nonnegative();

export const FlaCharacterCreateConfirmationSchema = z.object({
  confirmed: z.literal(true),
  capability: z.literal('EDITABLE_PARTS_READY'),
  planId: UuidSchema,
  sessionId: UuidSchema,
  requestId: UuidSchema,
  generation: z.number().int().positive().max(2_147_483_647),
  poseIdentity: z.string().regex(/^[a-f0-9]{64}$/u),
  target: z.object({
    renderTargetId: FlaRenderTargetIdSchema,
    selectedFrameIndex: z.number().int().nonnegative().max(100_000),
  }).strict(),
}).strict();

const FlaCharacterCreateBatchIdentitySchema = z.object({
  planId: UuidSchema,
  sessionId: UuidSchema,
  requestId: UuidSchema,
  generation: z.number().int().positive().max(2_147_483_647),
  rawSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  normalizedSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  poseIdentity: z.string().regex(/^[a-f0-9]{64}$/u),
  target: z.object({
    renderTargetId: FlaRenderTargetIdSchema,
    sceneIndex: z.number().int().nonnegative().max(10_000),
    selectedFrameIndex: z.number().int().nonnegative().max(100_000),
  }).strict(),
}).strict();

export const FlaCharacterCreateRequestSchema = z.object({
  format: z.literal('panda-fla-character-create'),
  version: z.literal(1),
  operationId: UuidSchema,
  projectRoot: ProjectRootSchema,
  projectId: IdSchema,
  baseRevision: RevisionSchema,
  openInstanceId: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  confirmation: FlaCharacterCreateConfirmationSchema,
}).strict();

export const FlaCharacterCreateErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'PLAN_EXPIRED',
  'UNSUPPORTED_CAPABILITY',
  'STALE_PROJECT',
  'OPERATION_ID_CONFLICT',
  'OPERATION_IN_PROGRESS',
  'DUPLICATE_CHARACTER_NAME',
  'COMMIT_FAILED',
  'RECOVERY_REQUIRED',
]);
export type FlaCharacterCreateErrorCode = z.infer<typeof FlaCharacterCreateErrorCodeSchema>;

const FlaCharacterCreateAssetResultSchema = z.object({
  occurrenceId: z.string().regex(/^occ-[a-f0-9]{24,64}$/u),
  partId: IdSchema,
  assetId: IdSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  relativePath: z.string().trim().min(1).max(32_767),
  status: z.enum(['created', 'reused']),
}).strict();

export const FlaCharacterCreateResultIdentitySchema = z.object({
  operationId: UuidSchema,
  projectRoot: ProjectRootSchema,
  projectId: IdSchema,
  openInstanceId: z.number().int().positive(),
  baseRevision: RevisionSchema,
  savedRevision: RevisionSchema,
  characterId: IdSchema,
  voiceProfileId: IdSchema,
  identity: FlaCharacterCreateBatchIdentitySchema,
  assets: z.array(FlaCharacterCreateAssetResultSchema)
    .min(2)
    .max(FLA_PART_PREVIEW_LIMITS.maxParts),
  createdAssetCount: z.number().int().nonnegative(),
  reusedAssetCount: z.number().int().nonnegative(),
}).strict();

export const FlaCharacterCreateResultSchema = FlaCharacterCreateResultIdentitySchema.extend({
  project: ProjectSchema,
}).strict().superRefine((result, context) => {
  if (result.project.id !== result.projectId) {
    context.addIssue({ code: 'custom', path: ['project', 'id'], message: 'Result Project ID does not match.' });
  }
  if (result.savedRevision !== result.baseRevision + 1) {
    context.addIssue({ code: 'custom', path: ['savedRevision'], message: 'Character creation must save exactly one Project revision.' });
  }
  if (result.assets.length !== result.createdAssetCount + result.reusedAssetCount) {
    context.addIssue({ code: 'custom', path: ['assets'], message: 'Asset outcome counts do not match the Part results.' });
  }
});

export const FlaCharacterCreateResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    status: z.literal('COMMITTED'),
    result: FlaCharacterCreateResultSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    status: z.literal('ERROR'),
    operationId: UuidSchema.optional(),
    error: z.object({
      code: FlaCharacterCreateErrorCodeSchema,
      message: z.string().trim().min(1).max(1_000),
    }).strict(),
  }).strict(),
]);

export const FlaCharacterCreateStatusRequestSchema = z.object({
  format: z.literal('panda-fla-character-create-status'),
  version: z.literal(1),
  operationId: UuidSchema,
  projectRoot: ProjectRootSchema,
  projectId: IdSchema,
}).strict();

export const FlaCharacterCreateStatusResponseSchema = z.discriminatedUnion('status', [
  z.object({
    ok: z.literal(true),
    status: z.literal('COMMITTED'),
    result: FlaCharacterCreateResultSchema,
  }).strict(),
  z.object({
    ok: z.literal(true),
    status: z.enum(['NOT_FOUND', 'IN_PROGRESS', 'RECOVERY_REQUIRED']),
    operationId: UuidSchema,
    message: z.string().trim().min(1).max(1_000).optional(),
  }).strict(),
  z.object({
    ok: z.literal(true),
    status: z.literal('FAILED'),
    operationId: UuidSchema,
    error: z.object({
      code: FlaCharacterCreateErrorCodeSchema,
      message: z.string().trim().min(1).max(1_000),
    }).strict(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    status: z.literal('ERROR'),
    error: z.object({
      code: FlaCharacterCreateErrorCodeSchema,
      message: z.string().trim().min(1).max(1_000),
    }).strict(),
  }).strict(),
]);

export type FlaCharacterCreateConfirmation = z.infer<typeof FlaCharacterCreateConfirmationSchema>;
export type FlaCharacterCreateRequest = z.infer<typeof FlaCharacterCreateRequestSchema>;
export type FlaCharacterCreateResult = z.infer<typeof FlaCharacterCreateResultSchema>;
export type FlaCharacterCreateResponse = z.infer<typeof FlaCharacterCreateResponseSchema>;
export type FlaCharacterCreateStatusRequest = z.infer<typeof FlaCharacterCreateStatusRequestSchema>;
export type FlaCharacterCreateStatusResponse = z.infer<typeof FlaCharacterCreateStatusResponseSchema>;
