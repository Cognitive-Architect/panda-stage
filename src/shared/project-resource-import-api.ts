import { z } from 'zod';
import {
  CharacterSchema,
  ImageAssetSchema,
  ProjectSchema,
  VoiceProfileSchema,
} from '../domain';
import { AssetImportProjectRequestSchema } from './asset-import-api';

export const ProjectResourceImportTargetSchema =
  AssetImportProjectRequestSchema;

const ResourceIdSchema = z.uuid();
const ImportSelectionTokenSchema = z.uuid();
const ResourceKindSchema = z.enum(['character', 'image']);
export const ProjectResourceImageUsageSchema = z.enum([
  'background',
  'prop',
]);

export const ProjectResourceImportOptionSchema = z.discriminatedUnion(
  'kind',
  [
    z
      .object({
        id: ResourceIdSchema,
        kind: z.literal('character'),
        name: z.string().trim().min(1).max(200),
        mode: z.enum(['single-image', 'composite', 'adaptive-parts']),
        dependencyCount: z.number().int().nonnegative(),
        supported: z.boolean(),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
    z
      .object({
        id: ResourceIdSchema,
        kind: z.literal('image'),
        name: z.string().trim().min(1).max(200),
        usage: ProjectResourceImageUsageSchema,
        dependencyCount: z.literal(1),
        supported: z.boolean(),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  ],
);

export const ProjectResourceImportChooseResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      status: z.literal('cancelled'),
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      status: z.literal('selected'),
      sourceToken: ImportSelectionTokenSchema,
      sourceProjectName: z.string().trim().min(1).max(200),
      items: z.array(ProjectResourceImportOptionSchema),
    })
    .strict(),
]);

export const ProjectResourceImportChooseRequestSchema =
  ProjectResourceImportTargetSchema;

export const ProjectResourceImportSelectionSchema = z
  .object({
    kind: ResourceKindSchema,
    id: ResourceIdSchema,
  })
  .strict();

export const ProjectResourceImportApplyRequestSchema =
  ProjectResourceImportTargetSchema.extend({
    sourceToken: ImportSelectionTokenSchema,
    resources: z
      .array(ProjectResourceImportSelectionSchema)
      .min(1)
      .max(100)
      .refine(
        (resources) =>
          new Set(resources.map(({ kind, id }) => `${kind}:${id}`)).size ===
          resources.length,
        { message: 'Resource selections must be unique.' },
      ),
  }).strict();

export const ProjectResourceImportErrorCodeSchema = z.enum([
  'PROJECT_RESOURCE_SOURCE_INVALID',
  'PROJECT_RESOURCE_SOURCE_EQUALS_TARGET',
  'PROJECT_RESOURCE_SELECTION_STALE',
  'PROJECT_RESOURCE_SELECTION_UNSUPPORTED',
  'PROJECT_RESOURCE_TARGET_STALE',
  'PROJECT_RESOURCE_ROLLBACK_FAILED',
  'PROJECT_RESOURCE_OPERATION_FAILED',
]);

export const ProjectResourceImportErrorSchema = z
  .object({
    code: ProjectResourceImportErrorCodeSchema,
    message: z.string().trim().min(1),
    projectRoot: z.string().trim().min(1).max(32_767),
    currentProject: ProjectSchema.optional(),
    currentRevision: z.number().int().nonnegative().optional(),
    residualPaths: z.array(z.string().trim().min(1).max(32_767)).max(500)
      .optional(),
  })
  .strict();

export const ProjectResourceImportFailureSchema = z
  .object({
    ok: z.literal(false),
    error: ProjectResourceImportErrorSchema,
  })
  .strict();

export const ProjectResourceImportResponseSchema = z.union([
  ProjectResourceImportChooseResponseSchema,
  z
    .object({
      ok: z.literal(true),
      status: z.literal('completed'),
      project: ProjectSchema,
      baseRevision: z.number().int().nonnegative(),
      savedRevision: z.number().int().nonnegative(),
      sourceProjectName: z.string().trim().min(1).max(200),
      importedAssets: z.array(ImageAssetSchema),
      importedCharacters: z.array(CharacterSchema),
      importedVoiceProfiles: z.array(VoiceProfileSchema),
    })
    .strict(),
  ProjectResourceImportFailureSchema,
]);

export type ProjectResourceImportTarget = z.infer<
  typeof ProjectResourceImportTargetSchema
>;
export type ProjectResourceImportOption = z.infer<
  typeof ProjectResourceImportOptionSchema
>;
export type ProjectResourceImportChooseResponse = z.infer<
  typeof ProjectResourceImportChooseResponseSchema
>;
export type ProjectResourceImportChooseRequest = z.infer<
  typeof ProjectResourceImportChooseRequestSchema
>;
export type ProjectResourceImportSelection = z.infer<
  typeof ProjectResourceImportSelectionSchema
>;
export type ProjectResourceImportApplyRequest = z.infer<
  typeof ProjectResourceImportApplyRequestSchema
>;
export type ProjectResourceImportResponse = z.infer<
  typeof ProjectResourceImportResponseSchema
>;
export type ProjectResourceImportErrorCode = z.infer<
  typeof ProjectResourceImportErrorCodeSchema
>;
