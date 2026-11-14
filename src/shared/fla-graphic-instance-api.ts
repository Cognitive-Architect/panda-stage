import { z } from 'zod';
import { ProjectSchema } from '../domain';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const AffineMatrixSchema = z.object({
  a: z.number().finite(),
  b: z.number().finite(),
  c: z.number().finite(),
  d: z.number().finite(),
  tx: z.number().finite(),
  ty: z.number().finite(),
}).strict();

export const FlaGraphicGroupEditArtworkSchema = z.object({
  svg: z.string().min(1).max(2_000_000),
  viewBox: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive().max(100_000),
    height: z.number().finite().positive().max(100_000),
  }).strict(),
}).strict();

const FlaGraphicGroupEditArtworkPlacementSchema = z.object({
  artwork: FlaGraphicGroupEditArtworkSchema,
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
}).strict();

/** Read-only source-backed canvas data; child transforms remain session-only. */
export const FlaGraphicGroupEditPreviewSchema = z.object({
  version: z.literal(1),
  source: z.object({
    sha256: Sha256Schema,
    outerOccurrenceId: z.string().regex(/^occ-[a-f0-9]{24,64}$/u),
    outerSourceAddress: z.string().trim().min(1).max(1_000),
    graphicSymbolName: z.string().trim().min(1).max(500),
  }).strict(),
  frameIndex: z.literal(0),
  frameOrigin: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  frameCanvas: z.object({
    width: z.number().finite().positive().max(100_000),
    height: z.number().finite().positive().max(100_000),
  }).strict(),
  group: z.object({
    groupId: z.string().trim().min(1).max(500),
    sourceAddress: z.string().trim().min(1).max(1_000),
    worldTransform: AffineMatrixSchema,
    canvasTransform: AffineMatrixSchema,
    opacity: z.number().finite().min(0).max(1).optional(),
  }).strict(),
  background: FlaGraphicGroupEditArtworkPlacementSchema.nullable(),
  foreground: FlaGraphicGroupEditArtworkPlacementSchema.nullable(),
  children: z.array(z.object({
    sourceAddress: z.string().trim().min(1).max(1_000),
    parentGroupSourceAddress: z.string().trim().min(1).max(1_000),
    kind: z.enum(['shape', 'bitmap']),
    sourceIdentity: z.string().trim().min(1).max(500),
    localTransform: AffineMatrixSchema,
    worldTransform: AffineMatrixSchema,
    artwork: FlaGraphicGroupEditArtworkSchema,
  }).strict()).min(1).max(2),
}).strict();

export const FlaGraphicInstanceCommitRequestSchema = z.object({
  format: z.literal('fla-graphic-instance-commit'),
  version: z.literal(1),
  requestId: z.uuid(),
  projectRoot: FileSystemPathSchema,
  projectId: z.uuid(),
  baseRevision: z.number().int().nonnegative(),
  openInstanceId: z.number().int().positive(),
  shotId: z.uuid().optional(),
  startTimeMs: z.number().finite().nonnegative().default(0),
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
    layerId: z.uuid().nullable(),
    groupEditPreview: FlaGraphicGroupEditPreviewSchema.optional(),
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
export type FlaGraphicGroupEditArtwork = z.infer<typeof FlaGraphicGroupEditArtworkSchema>;
export type FlaGraphicGroupEditPreview = z.infer<typeof FlaGraphicGroupEditPreviewSchema>;
export type FlaGraphicInstanceCommitResponse = z.infer<typeof FlaGraphicInstanceCommitResponseSchema>;
