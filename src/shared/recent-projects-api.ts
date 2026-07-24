import { z } from 'zod';
import { ProjectDocumentSchema } from './project-api';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);

export const RecentProjectStatusSchema = z.enum([
  'available',
  'missing',
]);

export const RecentProjectEntrySchema = z
  .object({
    projectId: z.uuid(),
    projectName: z.string().trim().min(1).max(200),
    projectRoot: FileSystemPathSchema,
    lastOpenedAt: z.iso.datetime(),
    status: RecentProjectStatusSchema,
  })
  .strict();

export const RecentProjectsErrorCodeSchema = z.enum([
  'RECENT_PROJECT_NOT_FOUND',
  'RECENT_PROJECT_MISMATCH',
  'RECENT_PROJECT_CONFIG_INVALID',
  'RECENT_PROJECT_CONFIG_FAILED',
  'RECENT_PROJECT_RELOCATE_FAILED',
]);

export const RecentProjectsErrorSchema = z
  .object({
    code: RecentProjectsErrorCodeSchema,
    message: z.string().trim().min(1),
    projectRoot: FileSystemPathSchema.nullable(),
  })
  .strict();

export const RecentProjectsListRequestSchema = z.object({}).strict();

export const RecentProjectsRemoveRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
  })
  .strict();

export const RecentProjectsRelocateRequestSchema =
  RecentProjectsRemoveRequestSchema;

export const RecentProjectsListResponseSchema = z.discriminatedUnion(
  'ok',
  [
    z
      .object({
        ok: z.literal(true),
        entries: z.array(RecentProjectEntrySchema),
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        error: RecentProjectsErrorSchema,
      })
      .strict(),
  ],
);

export const RecentProjectsRelocateResponseSchema = z.union([
    z
      .object({
        ok: z.literal(true),
        status: z.literal('relocated'),
        document: ProjectDocumentSchema,
        entries: z.array(RecentProjectEntrySchema),
      })
      .strict(),
    z
      .object({
        ok: z.literal(true),
        status: z.literal('cancelled'),
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        error: RecentProjectsErrorSchema,
      })
      .strict(),
]);

export type RecentProjectStatus = z.infer<
  typeof RecentProjectStatusSchema
>;
export type RecentProjectEntry = z.infer<
  typeof RecentProjectEntrySchema
>;
export type RecentProjectsErrorCode = z.infer<
  typeof RecentProjectsErrorCodeSchema
>;
export type RecentProjectsError = z.infer<
  typeof RecentProjectsErrorSchema
>;
export type RecentProjectsRemoveRequest = z.infer<
  typeof RecentProjectsRemoveRequestSchema
>;
export type RecentProjectsRelocateRequest = z.infer<
  typeof RecentProjectsRelocateRequestSchema
>;
export type RecentProjectsListResponse = z.infer<
  typeof RecentProjectsListResponseSchema
>;
export type RecentProjectsRelocateResponse = z.infer<
  typeof RecentProjectsRelocateResponseSchema
>;
