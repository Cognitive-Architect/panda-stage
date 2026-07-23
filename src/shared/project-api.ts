import { z } from 'zod';
import { ProjectSchema } from '../domain';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);

export const ProjectErrorCodeSchema = z.enum([
  'INVALID_PROJECT_ROOT',
  'PROJECT_ALREADY_EXISTS',
  'PROJECT_NOT_FOUND',
  'INVALID_JSON',
  'UNSUPPORTED_VERSION',
  'INVALID_PROJECT',
  'PROJECT_ID_MISMATCH',
  'PROJECT_NOT_WRITABLE',
  'CREATE_FAILED',
  'OPEN_FAILED',
  'SAVE_FAILED',
]);

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
  })
  .strict();

export const ProjectDocumentSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    projectFilePath: FileSystemPathSchema,
    project: ProjectSchema,
    migrated: z.boolean(),
    sourceVersion: z.union([z.literal(0), z.literal(1)]),
  })
  .strict();

export const ProjectOperationErrorSchema = z
  .object({
    code: ProjectErrorCodeSchema,
    message: z.string().trim().min(1),
    projectRoot: FileSystemPathSchema,
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
