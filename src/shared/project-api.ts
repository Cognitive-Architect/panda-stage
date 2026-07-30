import { z } from 'zod';
import { ProjectSchema } from '../domain';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);

export const ProjectErrorCodeSchema = z.enum([
  'INVALID_PROJECT_ROOT',
  'PROJECT_ALREADY_EXISTS',
  'PROJECT_NOT_FOUND',
  'PROJECT_FILE_NOT_FOUND',
  'INVALID_JSON',
  'UNSUPPORTED_VERSION',
  'INVALID_PROJECT',
  'PROJECT_ID_MISMATCH',
  'PROJECT_SAVE_STALE_REVISION',
  'PROJECT_NOT_WRITABLE',
  'CREATE_FAILED',
  'OPEN_FAILED',
  'SAVE_FAILED',
]);

export const ProjectChooseDirectoryRequestSchema = z.object({}).strict();

export const ProjectChooseDirectoryResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      status: z.literal('selected'),
      projectRoot: FileSystemPathSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      status: z.literal('cancelled'),
    })
    .strict(),
]);

export const ProjectSwitchGuardRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    project: ProjectSchema,
    dirty: z.literal(true),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const ProjectSwitchGuardOutcomeSchema = z.enum([
  'saved',
  'discarded',
  'cancelled',
  'save-failed',
  'discard-failed',
]);

export const ProjectSwitchGuardResponseSchema = z
  .object({
    outcome: ProjectSwitchGuardOutcomeSchema,
  })
  .strict();

export const ProjectCreateMetadataSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export const ProjectCreateRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    metadata: ProjectCreateMetadataSchema,
  })
  .strict();

export const ProjectOpenRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
  })
  .strict();

export const ProjectSaveRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    project: ProjectSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict();

export const ProjectDocumentSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    projectFilePath: FileSystemPathSchema,
    project: ProjectSchema,
    migrated: z.boolean(),
    sourceVersion: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
  })
  .strict();

export const ProjectOperationErrorSchema = z
  .object({
    code: ProjectErrorCodeSchema,
    message: z.string().trim().min(1),
    projectRoot: FileSystemPathSchema,
    currentProject: ProjectSchema.optional(),
    currentRevision: z.number().int().nonnegative().optional(),
  })
  .strict();

export const ProjectOperationResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      value: ProjectDocumentSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: ProjectOperationErrorSchema,
    })
    .strict(),
]);

export type ProjectErrorCode = z.infer<typeof ProjectErrorCodeSchema>;
export type ProjectChooseDirectoryResponse = z.infer<
  typeof ProjectChooseDirectoryResponseSchema
>;
export type ProjectSwitchGuardRequest = z.infer<
  typeof ProjectSwitchGuardRequestSchema
>;
export type ProjectSwitchGuardOutcome = z.infer<
  typeof ProjectSwitchGuardOutcomeSchema
>;
export type ProjectSwitchGuardResponse = z.infer<
  typeof ProjectSwitchGuardResponseSchema
>;
export type ProjectCreateMetadata = z.infer<
  typeof ProjectCreateMetadataSchema
>;
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequestSchema>;
export type ProjectOpenRequest = z.infer<typeof ProjectOpenRequestSchema>;
export type ProjectSaveRequest = z.infer<typeof ProjectSaveRequestSchema>;
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;
export type ProjectOperationError = z.infer<
  typeof ProjectOperationErrorSchema
>;
export type ProjectOperationResponse = z.infer<
  typeof ProjectOperationResponseSchema
>;
