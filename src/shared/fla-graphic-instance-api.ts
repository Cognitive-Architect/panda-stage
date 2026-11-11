import { z } from 'zod';
import { ProjectSchema } from '../domain';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const FlaGraphicInstanceCommitRequestSchema = z.object({
  format: z.literal('fla-graphic-instance-commit'),
  version: z.literal(1),
  requestId: z.uuid(),
  projectRoot: FileSystemPathSchema,
  projectId: z.uuid(),
  baseRevision: z.number().int().nonnegative(),
  openInstanceId: z.number().int().positive(),
  shotId: z.uuid(),
  startTimeMs: z.number().finite().nonnegative(),
  plan: z.object({
    sessionId: z.uuid(),
    planId: z.uuid(),
    generation: z.number().int().positive(),
    poseIdentity: Sha256Schema,
    unitId: z.string().regex(/^part-[a-z0-9-]{8,160}$/u),
  }).strict(),
}).strict();

export const FlaGraphicInstanceCommitErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'PROJECT_NOT_TRACKED',
  'STALE_PROJECT_REVISION',
  'STALE_PLAN',
  'UNSUPPORTED_SOURCE',
  'FRAME_RENDER_FAILED',
  'ASSET_COMMIT_FAILED',
  'ROLLBACK_FAILED',
  'COMMIT_BUSY',
  'SHOT_NOT_FOUND',
  'TRANSFORM_UNSUPPORTED',
]);

export const FlaGraphicInstanceCommitResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    status: z.literal('completed'),
    requestId: z.uuid(),
    project: ProjectSchema,
    projectRoot: FileSystemPathSchema,
    projectId: z.uuid(),
    openInstanceId: z.number().int().positive(),
    baseRevision: z.number().int().nonnegative(),
    savedRevision: z.number().int().nonnegative(),
    projectChanged: z.boolean(),
    animationId: z.uuid(),
    layerId: z.uuid(),
  }).strict().refine(
    (result) => result.project.id === result.projectId &&
      (result.projectChanged
        ? result.savedRevision === result.baseRevision + 1
        : result.savedRevision === result.baseRevision),
    'The saved Project identity and revision must match the commit receipt.',
  ),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: FlaGraphicInstanceCommitErrorCodeSchema,
      message: z.string().trim().min(1).max(1_000),
      requestId: z.uuid().optional(),
      projectRoot: FileSystemPathSchema,
      currentProject: ProjectSchema.optional(),
      currentRevision: z.number().int().nonnegative().optional(),
      openInstanceId: z.number().int().positive().optional(),
    }).strict(),
  }).strict(),
]);

export type FlaGraphicInstanceCommitRequest = z.infer<typeof FlaGraphicInstanceCommitRequestSchema>;
export type FlaGraphicInstanceCommitErrorCode = z.infer<typeof FlaGraphicInstanceCommitErrorCodeSchema>;
export type FlaGraphicInstanceCommitResponse = z.infer<typeof FlaGraphicInstanceCommitResponseSchema>;
