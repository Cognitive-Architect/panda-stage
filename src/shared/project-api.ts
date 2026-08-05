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

export const ProjectOpenFolderRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
  })
  .strict();

export const ProjectOpenFolderResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.string().trim().min(1),
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

/**
 * Directory suffix that identifies a Panda Stage project root.
 *
 * Only the Main Process is allowed to append it: the Renderer submits the bare
 * project name and never assembles the final project root itself.
 */
export const PROJECT_ROOT_EXTENSION = '.pandastage';

/** Maximum length of the bare (extension-less) project directory name. */
export const PROJECT_NAME_MAX_LENGTH = 120;

/**
 * Reasons a bare project name cannot be turned into a project directory name.
 *
 * The codes are shared so the Renderer can render localized guidance and the
 * Main Process can reject the very same inputs without duplicating the rules.
 */
export const ProjectNameIssueCodeSchema = z.enum([
  'EMPTY',
  'TOO_LONG',
  'PATH_SEPARATOR',
  'RELATIVE_SEGMENT',
  'INVALID_CHARACTER',
  'RESERVED_DEVICE_NAME',
  'TRAILING_DOT_OR_SPACE',
  'REDUNDANT_EXTENSION',
]);

export type ProjectNameIssueCode = z.infer<typeof ProjectNameIssueCodeSchema>;

const PROJECT_NAME_PATH_SEPARATOR = /[\\/]/u;
// Windows forbids these characters in a path component; control characters and
// the colon are included because they can create alternate data streams.
// eslint-disable-next-line no-control-regex
const PROJECT_NAME_INVALID_CHARACTER = /[<>:"|?*\u0000-\u001f]/u;
const PROJECT_NAME_RESERVED_DEVICE =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

/**
 * Validates a bare project name against the Windows directory-name contract.
 *
 * @param rawProjectName - Untrimmed project name exactly as the user typed it.
 * @returns The first violated rule, or `null` when the name is safe to use as a
 *   single directory component.
 */
export function projectNameIssue(
  rawProjectName: string,
): ProjectNameIssueCode | null {
  const projectName = rawProjectName.trim();
  if (!projectName) return 'EMPTY';
  if (projectName.length > PROJECT_NAME_MAX_LENGTH) return 'TOO_LONG';
  if (PROJECT_NAME_PATH_SEPARATOR.test(projectName)) return 'PATH_SEPARATOR';
  if (projectName === '.' || projectName === '..') return 'RELATIVE_SEGMENT';
  if (PROJECT_NAME_INVALID_CHARACTER.test(projectName)) {
    return 'INVALID_CHARACTER';
  }
  if (PROJECT_NAME_RESERVED_DEVICE.test(projectName)) {
    return 'RESERVED_DEVICE_NAME';
  }
  if (/[. ]$/u.test(projectName)) return 'TRAILING_DOT_OR_SPACE';
  if (projectName.toLowerCase().endsWith(PROJECT_ROOT_EXTENSION)) {
    return 'REDUNDANT_EXTENSION';
  }
  return null;
}

export const ProjectNameSchema = z
  .string()
  .trim()
  .refine((value) => projectNameIssue(value) === null, {
    message: 'Project name is not a valid Windows directory component.',
  });

/**
 * Secure creation request: the Renderer submits only the parent directory, the
 * bare project name, and the project metadata. The Main Process performs the
 * path join, the duplicate check, and the disk write.
 */
export const ProjectCreateAtRequestSchema = z
  .object({
    parentDirectory: FileSystemPathSchema,
    projectName: ProjectNameSchema,
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
export type ProjectOpenFolderResponse = z.infer<
  typeof ProjectOpenFolderResponseSchema
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
export type ProjectCreateAtRequest = z.infer<
  typeof ProjectCreateAtRequestSchema
>;
export type ProjectOpenRequest = z.infer<typeof ProjectOpenRequestSchema>;
export type ProjectSaveRequest = z.infer<typeof ProjectSaveRequestSchema>;
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;
export type ProjectOperationError = z.infer<
  typeof ProjectOperationErrorSchema
>;
export type ProjectOperationResponse = z.infer<
  typeof ProjectOperationResponseSchema
>;
