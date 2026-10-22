import { z } from 'zod';
import type { Project } from '../domain';

export const EXPORT_PREPARATION_SUPPORT_PROFILE_VERSION =
  'dl03-2026-10-22.1' as const;

export const EXPORT_PREPARATION_MAX_ASSETS = 512 as const;
export const EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES =
  64 * 1024 * 1024;
export const EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES =
  256 * 1024 * 1024;

export const EXPORT_PREPARATION_RENDER_SETTINGS = Object.freeze({
  width: 1_920,
  height: 1_080,
  fps: 24,
} as const);

export const EXPORT_PREPARATION_SUPPORT_PROFILE = Object.freeze({
  version: EXPORT_PREPARATION_SUPPORT_PROFILE_VERSION,
  shotCount: { minimum: 1, maximum: 1 },
  backgroundRequired: true,
  audio: 'supported' as const,
  cameraModes: ['static', 'speaker-focus'] as const,
  characterCompositions: ['whole-image', 'composite'] as const,
  imageMimeTypes: ['image/png', 'image/jpeg'] as const,
  audioMimeTypes: ['audio/mpeg', 'audio/wav'] as const,
  budgets: {
    maximumAssets: EXPORT_PREPARATION_MAX_ASSETS,
    maximumSingleAssetBytes: EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
    maximumTotalMediaBytes: EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES,
  },
});

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);
const ProjectIdSchema = z.uuid();
const OpenInstanceIdSchema = z.number().int().positive();
const RevisionSchema = z.number().int().nonnegative();

export const ExportPreparationCameraModeSchema = z.enum([
  'static',
  'speaker-focus',
]);

export const ExportPreparationSelectOutputRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    projectId: ProjectIdSchema,
    projectName: z.string().trim().min(1).max(500),
    openInstanceId: OpenInstanceIdSchema,
  })
  .strict();

export const ExportOutputTargetIdentitySchema = z
  .object({
    canonicalPath: FileSystemPathSchema,
    volumeId: z.string().min(1).max(80),
    fileId: z.string().min(1).max(80),
    sizeBytes: z.string().regex(/^\d+$/u),
    modifiedTimeNs: z.string().regex(/^\d+$/u),
    changedTimeNs: z.string().regex(/^\d+$/u),
  })
  .strict();

export const ExportPreparationIssueSchema = z
  .object({
    code: z.enum([
      'INVALID_PROJECT',
      'REQUIRED_MEDIA_UNAVAILABLE',
      'UNSUPPORTED_IN_CURRENT_EXPORT_SLICE',
      'PREPARATION_BUDGET_EXCEEDED',
      'OUTPUT_TARGET_CHANGED',
      'OUTPUT_TARGET_EXISTS',
      'OUTPUT_LOCATION_UNSUPPORTED',
      'PROJECT_SESSION_CHANGED',
      'PREPARATION_BUSY',
      'PREPARATION_FAILED',
    ]),
    location: z.string().trim().min(1).max(240),
    problem: z.string().trim().min(1).max(500),
    nextStep: z.string().trim().min(1).max(500),
  })
  .strict();

export const ExportPreparationSelectOutputResponseSchema = z.discriminatedUnion(
  'status',
  [
    z.object({ status: z.literal('cancelled') }).strict(),
    z
      .object({
        status: z.literal('selected'),
        selectionId: z.uuid(),
        fileName: z.string().trim().min(1).max(500),
        overwriteApproved: z.literal(false),
      })
      .strict(),
    z
      .object({
        status: z.literal('blocked'),
        issue: ExportPreparationIssueSchema,
      })
      .strict(),
  ],
);

export const ExportPreparationRequestSchema = z
  .object({
    selectionId: z.uuid(),
    attemptId: z.uuid(),
    projectRoot: FileSystemPathSchema,
    projectId: ProjectIdSchema,
    openInstanceId: OpenInstanceIdSchema,
    revision: RevisionSchema,
    dirty: z.boolean(),
    cameraMode: ExportPreparationCameraModeSchema,
    project: z.unknown(),
  })
  .strict();

const ExportPreparationSupportProfileSchema = z
  .object({
    version: z.literal(EXPORT_PREPARATION_SUPPORT_PROFILE_VERSION),
    shotCount: z
      .object({ minimum: z.literal(1), maximum: z.literal(1) })
      .strict(),
    backgroundRequired: z.literal(true),
    audio: z.literal('supported'),
    cameraModes: z.array(ExportPreparationCameraModeSchema).length(2),
    characterCompositions: z.array(z.enum(['whole-image', 'composite'])).length(
      2,
    ),
    imageMimeTypes: z.array(z.enum(['image/png', 'image/jpeg'])).length(2),
    audioMimeTypes: z.array(z.enum(['audio/mpeg', 'audio/wav'])).length(2),
    budgets: z
      .object({
        maximumAssets: z.literal(EXPORT_PREPARATION_MAX_ASSETS),
        maximumSingleAssetBytes: z.literal(
          EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
        ),
        maximumTotalMediaBytes: z.literal(
          EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES,
        ),
      })
      .strict(),
  })
  .strict();

export const ExportPreparationMediaManifestEntrySchema = z
  .object({
    assetId: z.uuid(),
    kind: z.enum(['image', 'audio']),
    sourceRelativePath: z.string().trim().min(1).max(2_000),
    contentHandleId: z.uuid(),
    contentRelativePath: z.string().trim().min(1).max(500),
    mimeType: z.enum([
      'image/png',
      'image/jpeg',
      'audio/mpeg',
      'audio/wav',
    ]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    byteLength: z.number().int().positive().max(
      EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
    ),
    usages: z.array(z.string().trim().min(1).max(240)).min(1).max(200),
  })
  .strict();

export const ExportPreparationCandidateSchema = z
  .object({
    version: z.literal(1),
    snapshotId: z.uuid(),
    jobId: z.uuid(),
    attemptId: z.uuid(),
    projectId: ProjectIdSchema,
    projectName: z.string().trim().min(1).max(500),
    projectRoot: FileSystemPathSchema,
    openInstanceId: OpenInstanceIdSchema,
    revision: RevisionSchema,
    dirtyAtCapture: z.boolean(),
    capturedAt: z.string().datetime(),
    project: z.unknown(),
    renderSettings: z
      .object({
        width: z.literal(1_920),
        height: z.literal(1_080),
        fps: z.literal(24),
      })
      .strict(),
    cameraMode: ExportPreparationCameraModeSchema,
    supportProfileVersion: z.literal(
      EXPORT_PREPARATION_SUPPORT_PROFILE_VERSION,
    ),
    supportProfile: ExportPreparationSupportProfileSchema,
    outputIntent: z
      .object({
        selectionId: z.uuid(),
        targetPath: FileSystemPathSchema,
        fileName: z.string().trim().min(1).max(500),
        overwriteApproved: z.literal(false),
        targetIdentity: ExportOutputTargetIdentitySchema.nullable(),
      })
      .strict(),
    mediaManifest: z
      .array(ExportPreparationMediaManifestEntrySchema)
      .max(EXPORT_PREPARATION_MAX_ASSETS),
    totalMediaBytes: z
      .number()
      .int()
      .nonnegative()
      .max(EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES),
  })
  .strict();

export const ExportPreparationResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('PREPARATION_READY'),
      candidate: ExportPreparationCandidateSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('BLOCK'),
      attemptId: z.uuid(),
      diagnosticId: z.uuid(),
      issues: z.array(ExportPreparationIssueSchema).min(1).max(200),
    })
    .strict(),
  z
    .object({
      status: z.literal('CANCELLED'),
      attemptId: z.uuid(),
    })
    .strict(),
]);

export const ExportPreparationCancelRequestSchema = z
  .object({ attemptId: z.uuid() })
  .strict();

export const ExportPreparationDiscardRequestSchema = z
  .object({
    selectionId: z.uuid().optional(),
    snapshotId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (request) =>
      Number(request.selectionId !== undefined) +
        Number(request.snapshotId !== undefined) ===
      1,
    'Exactly one selectionId or snapshotId is required.',
  );

export const ExportPreparationDiscardResponseSchema = z
  .object({ discarded: z.boolean() })
  .strict();

export const ExportPreparationCancelResponseSchema = z
  .object({ accepted: z.boolean() })
  .strict();

export type ExportOutputTargetIdentity = z.infer<
  typeof ExportOutputTargetIdentitySchema
>;

export type ExportPreparationCameraMode = z.infer<
  typeof ExportPreparationCameraModeSchema
>;
export type ExportPreparationSelectOutputRequest = z.infer<
  typeof ExportPreparationSelectOutputRequestSchema
>;
export type ExportPreparationSelectOutputResponse = z.infer<
  typeof ExportPreparationSelectOutputResponseSchema
>;
export type ExportPreparationRequest = Omit<
  z.infer<typeof ExportPreparationRequestSchema>,
  'project'
> & { project: Project };
export type ExportPreparationIssue = z.infer<
  typeof ExportPreparationIssueSchema
>;
export type ExportPreparationMediaManifestEntry = z.infer<
  typeof ExportPreparationMediaManifestEntrySchema
>;
export type ExportPreparationCandidate = Omit<
  z.infer<typeof ExportPreparationCandidateSchema>,
  'project'
> & { project: Project };
export type ExportPreparationResponse =
  | { status: 'PREPARATION_READY'; candidate: ExportPreparationCandidate }
  | {
      status: 'BLOCK';
      attemptId: string;
      diagnosticId: string;
      issues: ExportPreparationIssue[];
    }
  | { status: 'CANCELLED'; attemptId: string };
export type ExportPreparationCancelRequest = z.infer<
  typeof ExportPreparationCancelRequestSchema
>;
export type ExportPreparationDiscardRequest = z.infer<
  typeof ExportPreparationDiscardRequestSchema
>;
