import { z } from 'zod';
import { ProjectSchema } from '../domain';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);
const RevisionSchema = z.number().int().nonnegative();

export const AssetReferenceSchema = z
  .object({
    kind: z.enum([
      'character-base',
      'character-expression',
      'shot-background',
      'shot-layer',
      'audio-clip',
      'dialogue-audio',
    ]),
    path: z.string().trim().min(1).max(500),
    label: z.string().trim().min(1).max(500),
  })
  .strict();

export const AssetDeleteRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    project: ProjectSchema,
    baseRevision: RevisionSchema,
    assetId: z.uuid(),
  })
  .strict();

export const AssetDeleteErrorCodeSchema = z.enum([
  'ASSET_DELETE_INVALID_REQUEST',
  'ASSET_DELETE_PROJECT_NOT_FOUND',
  'ASSET_DELETE_PROJECT_MISMATCH',
  'ASSET_DELETE_STALE_REVISION',
  'ASSET_DELETE_ASSET_NOT_FOUND',
  'ASSET_DELETE_REFERENCED',
  'ASSET_DELETE_FAILED',
  'ASSET_DELETE_ROLLBACK_FAILED',
]);

export const AssetDeleteResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      project: ProjectSchema,
      baseRevision: RevisionSchema,
      savedRevision: RevisionSchema,
      deletedAssetId: z.uuid(),
      cleanupResidualPaths: z.array(FileSystemPathSchema).max(2),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z
        .object({
          code: AssetDeleteErrorCodeSchema,
          message: z.string().trim().min(1).max(1_000),
          projectRoot: FileSystemPathSchema,
          assetId: z.string().trim().min(1).max(200),
          references: z.array(AssetReferenceSchema).max(1_000).optional(),
          currentProject: ProjectSchema.optional(),
          currentRevision: RevisionSchema.optional(),
          residualPaths: z.array(FileSystemPathSchema).max(2).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type AssetDeleteRequest = z.infer<
  typeof AssetDeleteRequestSchema
>;
export type AssetDeleteResponse = z.infer<
  typeof AssetDeleteResponseSchema
>;
export type AssetDeleteErrorCode = z.infer<
  typeof AssetDeleteErrorCodeSchema
>;
export type AssetReferenceDto = z.infer<typeof AssetReferenceSchema>;
