import { z } from 'zod';
import { ProjectSchema } from '../domain';

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);
const RevisionSchema = z.number().int().nonnegative();

export const RECOVERY_SCHEMA_VERSION = 1 as const;
export const AUTOSAVE_INTERVAL_MS = 30_000 as const;

export const RecoveryErrorCodeSchema = z.enum([
  'RECOVERY_NOT_FOUND',
  'RECOVERY_INVALID',
  'RECOVERY_PROJECT_MISMATCH',
  'RECOVERY_WRITE_FAILED',
  'RECOVERY_READ_FAILED',
  'RECOVERY_CLEANUP_FAILED',
]);

export const RecoveryEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(RECOVERY_SCHEMA_VERSION),
    projectId: z.uuid(),
    savedAtMs: z.number().int().nonnegative(),
    project: ProjectSchema,
  })
  .strict()
  .superRefine((envelope, context) => {
    if (envelope.projectId !== envelope.project.id) {
      context.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'Recovery projectId must match project.id.',
      });
    }
  });

export const RecoveryCandidateSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    recoveryFilePath: FileSystemPathSchema,
    projectId: z.uuid(),
    savedAtMs: z.number().int().nonnegative(),
    project: ProjectSchema,
  })
  .strict();

export const AutosaveTrackRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    project: ProjectSchema,
    dirty: z.boolean(),
    revision: RevisionSchema,
  })
  .strict();

export const AutosaveUpdateRequestSchema = AutosaveTrackRequestSchema;

export const AutosaveStopRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
  })
  .strict();

export const RecoveryDetectRequestSchema = AutosaveStopRequestSchema;

export const RecoverySelectionRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    recoveryFilePath: FileSystemPathSchema,
  })
  .strict();

export const RecoveryErrorSchema = z
  .object({
    code: RecoveryErrorCodeSchema,
    message: z.string().trim().min(1),
    projectRoot: FileSystemPathSchema,
  })
  .strict();

export const RecoveryAcknowledgeResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), error: RecoveryErrorSchema }).strict(),
]);

export const RecoveryDetectResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      candidate: RecoveryCandidateSchema.nullable(),
    })
    .strict(),
  z.object({ ok: z.literal(false), error: RecoveryErrorSchema }).strict(),
]);

export const RecoveryRestoreResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      candidate: RecoveryCandidateSchema,
    })
    .strict(),
  z.object({ ok: z.literal(false), error: RecoveryErrorSchema }).strict(),
]);

export const RecoveryIgnoreResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      retained: z.literal(true),
    })
    .strict(),
  z.object({ ok: z.literal(false), error: RecoveryErrorSchema }).strict(),
]);

export const AutosaveErrorEventSchema = RecoveryErrorSchema;

export type RecoveryErrorCode = z.infer<typeof RecoveryErrorCodeSchema>;
export type RecoveryEnvelope = z.infer<typeof RecoveryEnvelopeSchema>;
export type RecoveryCandidate = z.infer<typeof RecoveryCandidateSchema>;
export type AutosaveTrackRequest = z.infer<
  typeof AutosaveTrackRequestSchema
>;
export type AutosaveUpdateRequest = z.infer<
  typeof AutosaveUpdateRequestSchema
>;
export type AutosaveStopRequest = z.infer<typeof AutosaveStopRequestSchema>;
export type RecoveryDetectRequest = z.infer<
  typeof RecoveryDetectRequestSchema
>;
export type RecoverySelectionRequest = z.infer<
  typeof RecoverySelectionRequestSchema
>;
export type RecoveryError = z.infer<typeof RecoveryErrorSchema>;
export type RecoveryAcknowledgeResponse = z.infer<
  typeof RecoveryAcknowledgeResponseSchema
>;
export type RecoveryDetectResponse = z.infer<
  typeof RecoveryDetectResponseSchema
>;
export type RecoveryRestoreResponse = z.infer<
  typeof RecoveryRestoreResponseSchema
>;
export type RecoveryIgnoreResponse = z.infer<
  typeof RecoveryIgnoreResponseSchema
>;
