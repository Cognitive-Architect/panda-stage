import { z } from 'zod';
import { AssetSchema, ProjectSchema } from '../domain';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);
const RevisionSchema = z.number().int().nonnegative();

export function declaredMimeTypeForAssetPath(
  filePath: string,
): string | null {
  const normalized = filePath.trim().toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (
    normalized.endsWith('.jpg') ||
    normalized.endsWith('.jpeg')
  ) {
    return 'image/jpeg';
  }
  if (normalized.endsWith('.mp3')) return 'audio/mpeg';
  if (normalized.endsWith('.wav')) return 'audio/wav';
  return null;
}

export const AssetImportCandidateSchema = z
  .object({
    sourcePath: FileSystemPathSchema,
    declaredMimeType: z.string().trim().min(1).max(200),
  })
  .strict();

export const AssetImportProjectRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    project: ProjectSchema,
    baseRevision: RevisionSchema,
  })
  .strict();

export const AssetImportDroppedRequestSchema =
  AssetImportProjectRequestSchema.extend({
    candidates: z.array(AssetImportCandidateSchema).min(1).max(100),
  }).strict();

export const AssetImportResultStatusSchema = z.enum([
  'imported',
  'duplicate',
  'rejected',
  'failed',
]);

export const AssetImportResultCodeSchema = z.enum([
  'ASSET_IMPORT_UNSUPPORTED_TYPE',
  'ASSET_IMPORT_DECLARED_TYPE_MISMATCH',
  'ASSET_IMPORT_INVALID_CONTENT',
  'ASSET_IMPORT_SOURCE_UNREADABLE',
  'ASSET_IMPORT_COPY_FAILED',
  'ASSET_IMPORT_SAVE_FAILED',
]);

export const AssetImportResultSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(260),
    status: AssetImportResultStatusSchema,
    sha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
    asset: AssetSchema.nullable(),
    duplicateOfAssetId: z.uuid().nullable(),
    code: AssetImportResultCodeSchema.nullable(),
    message: z.string().trim().min(1),
  })
  .strict();

export const AssetImportErrorCodeSchema = z.enum([
  'ASSET_IMPORT_PROJECT_MISMATCH',
  'ASSET_IMPORT_PROJECT_INVALID',
  'ASSET_IMPORT_OPERATION_FAILED',
]);

export const AssetImportErrorSchema = z
  .object({
    code: AssetImportErrorCodeSchema,
    message: z.string().trim().min(1),
    projectRoot: FileSystemPathSchema,
  })
  .strict();

export const AssetImportResponseSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      status: z.literal('completed'),
      project: ProjectSchema,
      baseRevision: RevisionSchema,
      savedRevision: RevisionSchema,
      projectChanged: z.boolean(),
      results: z.array(AssetImportResultSchema).min(1),
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
      error: AssetImportErrorSchema,
    })
    .strict(),
]);

export type AssetImportCandidate = z.infer<
  typeof AssetImportCandidateSchema
>;
export type AssetImportProjectRequest = z.infer<
  typeof AssetImportProjectRequestSchema
>;
export type AssetImportDroppedRequest = z.infer<
  typeof AssetImportDroppedRequestSchema
>;
export type AssetImportResult = z.infer<typeof AssetImportResultSchema>;
export type AssetImportResultCode = z.infer<
  typeof AssetImportResultCodeSchema
>;
export type AssetImportResponse = z.infer<typeof AssetImportResponseSchema>;
