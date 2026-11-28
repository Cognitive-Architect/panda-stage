import { z } from 'zod';

const IdSchema = z.string().uuid();

/**
 * Minimal cross-project import provenance stored optionally on imported
 * Animation and Character definitions.
 *
 * This metadata locates candidate target definitions and records exact
 * source -> target internal part/action identity correspondences so repeat
 * imports can evaluate reuse without scanning or hashing the whole project.
 * Compatibility is ALWAYS verified against live definitions and their actual
 * dependency closure before reuse is permitted.
 */
export const ResourceImportProvenanceSchema = z
  .object({
    sourceProjectId: IdSchema,
    sourceDefinitionId: IdSchema,
    /** Exact name assigned at import time so auto-numbered names remain distinguishable from user renames. */
    importedName: z.string().trim().min(1).max(300).optional(),
    /** Source -> target partId correspondence captured for adaptive-parts characters. */
    partIdMap: z.record(IdSchema, IdSchema).optional(),
    /** Source -> target actionId correspondence captured for characters with actions. */
    actionIdMap: z.record(IdSchema, IdSchema).optional(),
  })
  .strict();

export type ResourceImportProvenance = z.infer<
  typeof ResourceImportProvenanceSchema
>;
