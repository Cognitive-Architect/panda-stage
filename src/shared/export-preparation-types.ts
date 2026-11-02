import { z } from 'zod';
import type { Project } from '../domain';
import supportSource from './export-preparation-support-source.json';

export const EXPORT_PREPARATION_SUPPORT_PROFILE_VERSION = supportSource.version;
export const EXPORT_PREPARATION_WINDOWS_FORMAL_OUTPUT_MAX_PATH_CHARACTERS =
  supportSource.windowsFormalOutputMaxPathCharacters as 259;

export const EXPORT_PREPARATION_MAX_SHOTS =
  supportSource.profile.shotCount.maximum as 256;

export const EXPORT_PREPARATION_MAX_ASSETS =
  supportSource.profile.budgets.maximumAssets as 512;
export const EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES =
  supportSource.profile.budgets.maximumSingleAssetBytes as 67_108_864;
export const EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES =
  supportSource.profile.budgets.maximumTotalMediaBytes as 268_435_456;

export const EXPORT_PREPARATION_RENDER_SETTINGS = Object.freeze({
  ...supportSource.renderSettings,
});

export const EXPORT_PREPARATION_CAPABILITY_MATRIX = Object.freeze({
  ...supportSource.capabilityMatrix,
});

function exportSupported(status: string): boolean {
  return status === 'SUPPORTED_VERIFIED' || status === 'SUPPORTED_UNVERIFIED';
}

function supportedMimeTypes(mediaKind: 'image' | 'audio'): string[] {
  return [
    ...new Set(
      EXPORT_PREPARATION_CAPABILITY_MATRIX.entries
        .filter(
          (entry) =>
            entry.mediaKind === mediaKind &&
            exportSupported(entry.statuses.formalExport),
        )
        .flatMap((entry) => entry.mimeTypes),
    ),
  ];
}

const formalAudioSupported = EXPORT_PREPARATION_CAPABILITY_MATRIX.entries.some(
  (entry) =>
    entry.mediaKind === 'audio' &&
    exportSupported(entry.statuses.formalExport),
);

export const EXPORT_PREPARATION_SUPPORT_PROFILE = Object.freeze({
  version: EXPORT_PREPARATION_SUPPORT_PROFILE_VERSION,
  windowsFormalOutputMaxPathCharacters:
    EXPORT_PREPARATION_WINDOWS_FORMAL_OUTPUT_MAX_PATH_CHARACTERS,
  ...supportSource.profile,
  audio: (formalAudioSupported ? 'supported' : 'unsupported') as
    | 'supported'
    | 'unsupported',
  imageMimeTypes: supportedMimeTypes('image'),
  audioMimeTypes: supportedMimeTypes('audio'),
  capabilityMatrix: EXPORT_PREPARATION_CAPABILITY_MATRIX,
});

export function exportCapabilityStatusForMimeType(
  mimeType: string,
  layer: 'import' | 'shot' | 'preview' | 'formalExport' = 'formalExport',
): string {
  return (
    EXPORT_PREPARATION_CAPABILITY_MATRIX.entries.find((entry) =>
      entry.mimeTypes.includes(mimeType),
    )?.statuses[layer] ?? 'UNKNOWN'
  );
}

export function isFormalExportMimeTypeSupported(mimeType: string): boolean {
  return exportSupported(exportCapabilityStatusForMimeType(mimeType));
}

const FileSystemPathSchema = z.string().trim().min(1).max(32_767);
const ProjectIdSchema = z.uuid();
const OpenInstanceIdSchema = z.number().int().positive();
const RevisionSchema = z.number().int().nonnegative();

export const ExportPreparationCameraModeSchema = z.enum([
  'static',
  'speaker-focus',
]);

export const ExportPreparationSelectOutputRequestSchema = z
  .object({
    projectRoot: FileSystemPathSchema,
    projectId: ProjectIdSchema,
    projectName: z.string().trim().min(1).max(500),
    openInstanceId: OpenInstanceIdSchema,
    snapshotId: z.uuid().optional(),
  })
  .strict();

export const ExportOutputTargetIdentitySchema = z
  .object({
    canonicalPath: FileSystemPathSchema,
    volumeId: z.string().min(1).max(80),
    fileId: z.string().min(1).max(80),
    sizeBytes: z.string().regex(/^\d+$/u),
    modifiedTimeNs: z.string().regex(/^\d+$/u),
    changedTimeNs: z.string().regex(/^\d+$/u),
  })
  .strict();

export const ExportPreparationIssueSchema = z
  .object({
    code: z.enum([
      'INVALID_PROJECT',
      'REQUIRED_MEDIA_UNAVAILABLE',
      'UNSUPPORTED_IN_CURRENT_EXPORT_SLICE',
      'PREPARATION_BUDGET_EXCEEDED',
      'OUTPUT_TARGET_CHANGED',
      'OUTPUT_TARGET_EXISTS',
      'OUTPUT_LOCATION_UNSUPPORTED',
      'PROJECT_SESSION_CHANGED',
      'PREPARATION_BUSY',
      'PREPARATION_FAILED',
    ]),
    location: z.string().trim().min(1).max(240),
    problem: z.string().trim().min(1).max(500),
    nextStep: z.string().trim().min(1).max(500),
  })
  .strict();

export const ExportPreparationSelectOutputResponseSchema = z.discriminatedUnion(
  'status',
  [
    z.object({ status: z.literal('cancelled') }).strict(),
    z
      .object({
        status: z.literal('selected'),
        selectionId: z.uuid(),
        fileName: z.string().trim().min(1).max(500),
        overwriteApproved: z.literal(false),
      })
      .strict(),
    z
      .object({
        status: z.literal('blocked'),
        issue: ExportPreparationIssueSchema,
      })
      .strict(),
  ],
);

export const ExportPreparationRequestSchema = z
  .object({
    selectionId: z.uuid(),
    attemptId: z.uuid(),
    projectRoot: FileSystemPathSchema,
    projectId: ProjectIdSchema,
    openInstanceId: OpenInstanceIdSchema,
    revision: RevisionSchema,
    dirty: z.boolean(),
    cameraMode: ExportPreparationCameraModeSchema,
    project: z.unknown(),
  })
  .strict();

const ExportPreparationCapabilityStatusSchema = z.enum([
  'SUPPORTED_VERIFIED',
  'SUPPORTED_UNVERIFIED',
  'NOT_SUPPORTED',
  'UNKNOWN',
]);

const ExportPreparationCapabilityLayerSchema = z.enum([
  'import',
  'shot',
  'preview',
  'formalExport',
]);

const ExportPreparationCapabilityMatrixSchema = z
  .object({
    version: z.literal(EXPORT_PREPARATION_SUPPORT_PROFILE_VERSION),
    visibleSummary: z.string().trim().min(1).max(500),
    layers: z
      .array(
        z
          .object({
            id: ExportPreparationCapabilityLayerSchema,
            label: z.string().trim().min(1).max(100),
          })
          .strict(),
      )
      .length(4),
    statuses: z
      .array(
        z
          .object({
            id: ExportPreparationCapabilityStatusSchema,
            label: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .length(4),
    entries: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(100),
            label: z.string().trim().min(1).max(200),
            mediaKind: z.enum([
              'image',
              'audio',
              'fla-sequence',
              'fla-special',
              'other',
            ]),
            formats: z.array(z.string().trim().min(1).max(120)).max(20),
            mimeTypes: z.array(z.string().trim().min(1).max(120)).max(20),
            statuses: z
              .object({
                import: ExportPreparationCapabilityStatusSchema,
                shot: ExportPreparationCapabilityStatusSchema,
                preview: ExportPreparationCapabilityStatusSchema,
                formalExport: ExportPreparationCapabilityStatusSchema,
              })
              .strict(),
            evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
            note: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

const ExportPreparationSupportProfileSchema = z
  .object({
    version: z.literal(EXPORT_PREPARATION_SUPPORT_PROFILE_VERSION),
    windowsFormalOutputMaxPathCharacters: z.literal(
      EXPORT_PREPARATION_WINDOWS_FORMAL_OUTPUT_MAX_PATH_CHARACTERS,
    ),
    shotCount: z
      .object({
        minimum: z.literal(1),
        maximum: z.literal(EXPORT_PREPARATION_MAX_SHOTS),
      })
      .strict(),
    backgroundRequired: z.literal(true),
    audio: z.enum(['supported', 'unsupported']),
    cameraModes: z.array(ExportPreparationCameraModeSchema).length(2),
    characterCompositions: z.array(z.enum(['whole-image', 'composite'])).length(
      2,
    ),
    imageMimeTypes: z.array(z.string().trim().min(1).max(120)).max(20),
    audioMimeTypes: z.array(z.string().trim().min(1).max(120)).max(20),
    budgets: z
      .object({
        maximumAssets: z.literal(EXPORT_PREPARATION_MAX_ASSETS),
        maximumSingleAssetBytes: z.literal(
          EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
        ),
        maximumTotalMediaBytes: z.literal(
          EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES,
        ),
      })
      .strict(),
    capabilityMatrix: ExportPreparationCapabilityMatrixSchema,
  })
  .strict()
  .superRefine((profile, context) => {
    const expectedImageMimeTypes = supportedMimeTypes('image');
    const expectedAudioMimeTypes = supportedMimeTypes('audio');
    if (
      JSON.stringify(profile.imageMimeTypes) !==
      JSON.stringify(expectedImageMimeTypes)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['imageMimeTypes'],
        message: 'Image MIME types must derive from the capability matrix.',
      });
    }
    if (
      JSON.stringify(profile.audioMimeTypes) !==
      JSON.stringify(expectedAudioMimeTypes)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['audioMimeTypes'],
        message: 'Audio MIME types must derive from the capability matrix.',
      });
    }
    if (
      profile.audio !==
      (expectedAudioMimeTypes.length > 0 ? 'supported' : 'unsupported')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['audio'],
        message: 'Audio support must derive from the capability matrix.',
      });
    }
  });

export const ExportPreparationMediaManifestEntrySchema = z
  .object({
    assetId: z.uuid(),
    kind: z.enum(['image', 'audio']),
    sourceRelativePath: z.string().trim().min(1).max(2_000),
    contentHandleId: z.uuid(),
    contentRelativePath: z.string().trim().min(1).max(500),
    mimeType: z.enum([
      'image/png',
      'image/jpeg',
      'audio/mpeg',
      'audio/wav',
    ]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    byteLength: z.number().int().positive().max(
      EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
    ),
    usages: z.array(z.string().trim().min(1).max(240)).min(1).max(200),
  })
  .strict();

export const ExportPreparationCandidateSchema = z
  .object({
    version: z.literal(1),
    snapshotId: z.uuid(),
    jobId: z.uuid(),
    attemptId: z.uuid(),
    projectId: ProjectIdSchema,
    projectName: z.string().trim().min(1).max(500),
    projectRoot: FileSystemPathSchema,
    openInstanceId: OpenInstanceIdSchema,
    revision: RevisionSchema,
    dirtyAtCapture: z.boolean(),
    capturedAt: z.string().datetime(),
    project: z.unknown(),
    renderSettings: z
      .object({
        width: z.literal(1_920),
        height: z.literal(1_080),
        fps: z.literal(24),
      })
      .strict(),
    cameraMode: ExportPreparationCameraModeSchema,
    supportProfileVersion: z.literal(
      EXPORT_PREPARATION_SUPPORT_PROFILE_VERSION,
    ),
    supportProfile: ExportPreparationSupportProfileSchema,
    outputIntent: z
      .object({
        selectionId: z.uuid(),
        targetPath: FileSystemPathSchema,
        fileName: z.string().trim().min(1).max(500),
        overwriteApproved: z.literal(false),
        targetIdentity: ExportOutputTargetIdentitySchema.nullable(),
      })
      .strict(),
    mediaManifest: z
      .array(ExportPreparationMediaManifestEntrySchema)
      .max(EXPORT_PREPARATION_MAX_ASSETS),
    totalMediaBytes: z
      .number()
      .int()
      .nonnegative()
      .max(EXPORT_PREPARATION_MAX_TOTAL_MEDIA_BYTES),
  })
  .strict();

export const ExportPreparationResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('PREPARATION_READY'),
      candidate: ExportPreparationCandidateSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('BLOCK'),
      attemptId: z.uuid(),
      diagnosticId: z.uuid(),
      issues: z.array(ExportPreparationIssueSchema).min(1).max(200),
    })
    .strict(),
  z
    .object({
      status: z.literal('CANCELLED'),
      attemptId: z.uuid(),
    })
    .strict(),
]);

export const ExportPreparationCancelRequestSchema = z
  .object({ attemptId: z.uuid() })
  .strict();

export const ExportPreparationDiscardRequestSchema = z
  .object({
    selectionId: z.uuid().optional(),
    snapshotId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (request) =>
      Number(request.selectionId !== undefined) +
        Number(request.snapshotId !== undefined) ===
      1,
    'Exactly one selectionId or snapshotId is required.',
  );

export const ExportPreparationDiscardResponseSchema = z
  .object({ discarded: z.boolean() })
  .strict();

export const ExportPreparationSnapshotStatusRequestSchema = z
  .object({ snapshotId: z.uuid() })
  .strict();

export const ExportPreparationSnapshotStatusResponseSchema = z
  .object({
    available: z.boolean(),
    expiresAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const ExportPreparationCancelResponseSchema = z
  .object({ accepted: z.boolean() })
  .strict();

export type ExportOutputTargetIdentity = z.infer<
  typeof ExportOutputTargetIdentitySchema
>;

export type ExportPreparationCameraMode = z.infer<
  typeof ExportPreparationCameraModeSchema
>;
export type ExportPreparationSelectOutputRequest = z.infer<
  typeof ExportPreparationSelectOutputRequestSchema
>;
export type ExportPreparationSelectOutputResponse = z.infer<
  typeof ExportPreparationSelectOutputResponseSchema
>;
export type ExportPreparationRequest = Omit<
  z.infer<typeof ExportPreparationRequestSchema>,
  'project'
> & { project: Project };
export type ExportPreparationIssue = z.infer<
  typeof ExportPreparationIssueSchema
>;
export type ExportPreparationMediaManifestEntry = z.infer<
  typeof ExportPreparationMediaManifestEntrySchema
>;
export type ExportPreparationCandidate = Omit<
  z.infer<typeof ExportPreparationCandidateSchema>,
  'project'
> & { project: Project };
export type ExportPreparationResponse =
  | { status: 'PREPARATION_READY'; candidate: ExportPreparationCandidate }
  | {
      status: 'BLOCK';
      attemptId: string;
      diagnosticId: string;
      issues: ExportPreparationIssue[];
    }
  | { status: 'CANCELLED'; attemptId: string };
export type ExportPreparationCancelRequest = z.infer<
  typeof ExportPreparationCancelRequestSchema
>;
export type ExportPreparationDiscardRequest = z.infer<
  typeof ExportPreparationDiscardRequestSchema
>;
export type ExportPreparationSnapshotStatusRequest = z.infer<
  typeof ExportPreparationSnapshotStatusRequestSchema
>;
export type ExportPreparationSnapshotStatusResponse = z.infer<
  typeof ExportPreparationSnapshotStatusResponseSchema
>;
