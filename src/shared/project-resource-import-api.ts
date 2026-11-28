import { z } from 'zod';
import {
  AssetSchema,
  CharacterSchema,
  ImageAssetUsageSchema,
  ProjectAnimationDefinitionSchema,
  ProjectSchema,
  VoiceProfileSchema,
} from '../domain';

const IdSchema = z.string().uuid();
const NonEmptyPathSchema = z.string().trim().min(1).max(4_096);
const NonNegativeIntSchema = z.number().int().nonnegative();

export const ProjectResourceImportItemKindSchema = z.enum([
  'character',
  'animation',
  'image',
]);
export type ProjectResourceImportItemKind = z.infer<
  typeof ProjectResourceImportItemKindSchema
>;

export const ProjectResourceImportSelectionSchema = z
  .object({
    kind: ProjectResourceImportItemKindSchema,
    id: IdSchema,
  })
  .strict();
export type ProjectResourceImportSelection = z.infer<
  typeof ProjectResourceImportSelectionSchema
>;

export const ProjectResourceImportOptionSchema = z
  .object({
    id: IdSchema,
    kind: ProjectResourceImportItemKindSchema,
    name: z.string().trim().min(1).max(300),
    mode: z.enum(['single-image', 'composite', 'adaptive-parts']).optional(),
    animationKind: z.enum(['fla-graphic', 'frame-sequence']).optional(),
    usage: ImageAssetUsageSchema.optional(),
    dependencyAssetCount: NonNegativeIntSchema,
    dependencyAnimationCount: NonNegativeIntSchema,
    hasNameConflict: z.boolean(),
    supported: z.boolean(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type ProjectResourceImportOption = z.infer<
  typeof ProjectResourceImportOptionSchema
>;

export const ProjectResourceImportNameConflictSchema = z
  .object({
    kind: z.enum(['character', 'animation']),
    sourceName: z.string().trim().min(1).max(300),
    resolvedName: z.string().trim().min(1).max(300),
  })
  .strict();

export const ProjectResourceImportReuseChoiceSchema = z
  .object({
    kind: z.enum(['character', 'animation']),
    sourceId: IdSchema,
    targetId: IdSchema,
  })
  .strict();
export type ProjectResourceImportReuseChoice = z.infer<
  typeof ProjectResourceImportReuseChoiceSchema
>;

export const ProjectResourceImportReusableDefinitionSchema = z
  .object({
    kind: z.enum(['character', 'animation']),
    sourceId: IdSchema,
    sourceName: z.string().trim().min(1).max(300),
    targetId: IdSchema,
    targetName: z.string().trim().min(1).max(300),
  })
  .strict();
export type ProjectResourceImportReusableDefinition = z.infer<
  typeof ProjectResourceImportReusableDefinitionSchema
>;

export const ProjectResourceImportReuseDiagnosticSchema = z
  .object({
    kind: z.enum(['character', 'animation']),
    sourceId: IdSchema,
    sourceName: z.string().trim().min(1).max(300),
    targetId: IdSchema.optional(),
    targetName: z.string().trim().min(1).max(300).optional(),
    code: z.enum([
      'TARGET_MODIFIED',
      'SOURCE_OR_DEPENDENCY_CHANGED',
      'INTERNAL_IDENTITY_AMBIGUOUS',
      'MULTIPLE_TARGET_CANDIDATES',
      'NAME_ONLY_MATCH',
      'DISK_ASSET_UNVERIFIED',
    ]),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type ProjectResourceImportReuseDiagnostic = z.infer<
  typeof ProjectResourceImportReuseDiagnosticSchema
>;

export const ProjectResourceImportErrorCodeSchema = z.enum([
  'PROJECT_RESOURCE_SOURCE_INVALID',
  'PROJECT_RESOURCE_SOURCE_EQUALS_TARGET',
  'PROJECT_RESOURCE_SELECTION_STALE',
  'PROJECT_RESOURCE_SELECTION_UNSUPPORTED',
  'PROJECT_RESOURCE_TARGET_STALE',
  'PROJECT_RESOURCE_ROLLBACK_FAILED',
  'PROJECT_RESOURCE_OPERATION_FAILED',
]);
export type ProjectResourceImportErrorCode = z.infer<
  typeof ProjectResourceImportErrorCodeSchema
>;

export const ProjectResourceImportErrorSchema = z
  .object({
    code: ProjectResourceImportErrorCodeSchema,
    message: z.string().trim().min(1).max(2_000),
    projectRoot: NonEmptyPathSchema,
    currentProject: ProjectSchema.optional(),
    currentRevision: NonNegativeIntSchema.optional(),
    residualPaths: z.array(NonEmptyPathSchema).max(500).optional(),
  })
  .strict();
export type ProjectResourceImportError = z.infer<
  typeof ProjectResourceImportErrorSchema
>;

export const ProjectResourceImportChooseRequestSchema = z
  .object({
    projectRoot: NonEmptyPathSchema,
    project: ProjectSchema,
    baseRevision: NonNegativeIntSchema,
    openInstanceId: NonNegativeIntSchema.optional(),
  })
  .strict();
export type ProjectResourceImportChooseRequest = z.infer<
  typeof ProjectResourceImportChooseRequestSchema
>;

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
      sourceToken: IdSchema,
      sourceProjectName: z.string().trim().min(1).max(300),
      items: z.array(ProjectResourceImportOptionSchema).max(2_000),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: ProjectResourceImportErrorSchema,
    })
    .strict(),
]);
export type ProjectResourceImportChooseResponse = z.infer<
  typeof ProjectResourceImportChooseResponseSchema
>;

export const ProjectResourceImportPreviewRequestSchema = z
  .object({
    projectRoot: NonEmptyPathSchema,
    project: ProjectSchema,
    baseRevision: NonNegativeIntSchema,
    openInstanceId: NonNegativeIntSchema.optional(),
    sourceToken: IdSchema,
    resources: z.array(ProjectResourceImportSelectionSchema).max(100),
    reuseIdenticalAssets: z.boolean().optional(),
    reuseDefinitions: z
      .array(ProjectResourceImportReuseChoiceSchema)
      .max(200)
      .optional(),
  })
  .strict();
export type ProjectResourceImportPreviewRequest = z.infer<
  typeof ProjectResourceImportPreviewRequestSchema
>;

export const ProjectResourceImportPreviewResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      selectedCount: NonNegativeIntSchema,
      characterCount: NonNegativeIntSchema,
      animationCount: NonNegativeIntSchema,
      assetCount: NonNegativeIntSchema,
      reusableAssetCount: NonNegativeIntSchema,
      newFileCount: NonNegativeIntSchema,
      reusedCharacterCount: NonNegativeIntSchema.optional(),
      reusedAnimationCount: NonNegativeIntSchema.optional(),
      reusableDefinitions: z
        .array(ProjectResourceImportReusableDefinitionSchema)
        .max(200)
        .optional(),
      reuseDiagnostics: z
        .array(ProjectResourceImportReuseDiagnosticSchema)
        .max(200)
        .optional(),
      nameConflicts: z.array(ProjectResourceImportNameConflictSchema).max(500),
      issues: z.array(z.string().trim().min(1).max(500)).max(200),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: ProjectResourceImportErrorSchema,
    })
    .strict(),
]);
export type ProjectResourceImportPreviewResponse = z.infer<
  typeof ProjectResourceImportPreviewResponseSchema
>;

export const ProjectResourceImportApplyRequestSchema = z
  .object({
    projectRoot: NonEmptyPathSchema,
    project: ProjectSchema,
    baseRevision: NonNegativeIntSchema,
    openInstanceId: NonNegativeIntSchema.optional(),
    sourceToken: IdSchema,
    resources: z.array(ProjectResourceImportSelectionSchema).min(1).max(100),
    reuseIdenticalAssets: z.boolean().optional(),
    reuseDefinitions: z
      .array(ProjectResourceImportReuseChoiceSchema)
      .max(200)
      .optional(),
  })
  .strict();
export type ProjectResourceImportApplyRequest = z.infer<
  typeof ProjectResourceImportApplyRequestSchema
>;

export const ProjectResourceImportApplyResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      status: z.literal('completed'),
      projectRoot: NonEmptyPathSchema,
      projectId: IdSchema,
      openInstanceId: NonNegativeIntSchema.optional(),
      project: ProjectSchema,
      baseRevision: NonNegativeIntSchema,
      savedRevision: NonNegativeIntSchema,
      sourceProjectName: z.string().trim().min(1).max(300),
      importedAssets: z.array(AssetSchema),
      reusedAssetIds: z.array(IdSchema),
      importedAnimations: z.array(ProjectAnimationDefinitionSchema),
      reusedAnimationIds: z.array(IdSchema).optional(),
      importedCharacters: z.array(CharacterSchema),
      reusedCharacterIds: z.array(IdSchema).optional(),
      importedVoiceProfiles: z.array(VoiceProfileSchema),
      nameConflicts: z.array(ProjectResourceImportNameConflictSchema).max(500),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: ProjectResourceImportErrorSchema,
    })
    .strict(),
]);
export type ProjectResourceImportApplyResponse = z.infer<
  typeof ProjectResourceImportApplyResponseSchema
>;
