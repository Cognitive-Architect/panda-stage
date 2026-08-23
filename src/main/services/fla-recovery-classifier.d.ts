export type FlaRecoveryState =
  | 'STRICT_VALID'
  | 'RECOVERY_CANDIDATE'
  | 'REJECT'
  | 'AMBIGUOUS';

export interface FlaRecoveryBudgets {
  readonly maxSourceBytes: number;
  readonly maxZipEntries: number;
  readonly maxExpandedArchiveBytes: number;
  readonly maxSingleEntryBytes: number;
  readonly maxCentralDirectoryBytes: number;
  readonly maxExactDuplicateLocalRecords: number;
  readonly supportedCompressionMethods: readonly number[];
}

export interface FlaRecoveryMeasurements {
  byteLength: number;
  eocdOffset: number | null;
  eocdCandidateCount: number;
  exactEocdCandidateCount: number;
  eocdCommentLength: number | null;
  diskNumber: number | null;
  centralDirectoryDiskNumber: number | null;
  entriesOnDisk: number | null;
  totalEntries: number | null;
  declaredCentralDirectoryOffset: number | null;
  declaredCentralDirectorySize: number | null;
  actualCentralDirectoryStart: number | null;
  actualCentralDirectoryEnd: number | null;
  actualCentralDirectorySize: number | null;
  centralDirectoryDeltaBytes: number | null;
  centralDirectoryRecordCount: number;
  recordContinuity: boolean;
  localHeaderOffsets: number[];
  localOnlyRecordCount: number;
  exactDuplicateLocalRecordCount: number;
  encryptedEntryCount: number;
  compressionMethods: number[];
  zip64Indicator: boolean;
  trailingBytes: number | null;
  domDocumentPresent: boolean;
}

export interface FlaRecoveryPreconditions {
  classicZipXfl: boolean;
  uniqueEocd: boolean;
  singleDisk: boolean;
  nonEncrypted: boolean;
  supportedCompression: boolean;
  resourcesWithinBudget: boolean;
  centralRecordsComplete: boolean;
  uniqueActualCentralBoundary: boolean;
  eocdOffsetConsistent: boolean;
  localHeadersInsideSource: boolean;
  localCentralMetadataConsistent: boolean;
  noOverlappingRanges: boolean;
  noHiddenPayload: boolean;
  noZip64: boolean;
  noPathTraversal: boolean;
  onlyDeclarationMetadataInconsistent: boolean;
}

export interface FlaRecoveryClassification {
  state: FlaRecoveryState;
  reasonCodes: string[];
  measured: FlaRecoveryMeasurements;
  preconditions: FlaRecoveryPreconditions;
  sourceSha256: string;
}

export interface FlaRecoveryNormalizationNotApplied {
  applied: false;
  reason: string;
}

export interface FlaRecoveryNormalizationApplied {
  applied: true;
  bytes: Uint8Array;
  field: 'EOCD.centralDirectorySize';
  offset: number;
  from: number | null;
  to: number;
  deltaBytes: number | null;
  mode: 'in-memory-only';
  originalBytesWritten: false;
}

export type FlaRecoveryNormalization =
  | FlaRecoveryNormalizationNotApplied
  | FlaRecoveryNormalizationApplied;

export declare const DEFAULT_C2_BUDGETS: FlaRecoveryBudgets;
export declare const STATES: Readonly<{
  STRICT_VALID: 'STRICT_VALID';
  RECOVERY_CANDIDATE: 'RECOVERY_CANDIDATE';
  REJECT: 'REJECT';
  AMBIGUOUS: 'AMBIGUOUS';
}>;
export declare function findEocdCandidates(bytes: Uint8Array): readonly {
  offset: number;
  commentLength: number;
  end: number;
  endsAtInput: boolean;
}[];
export declare function classifyForFlaRecovery(
  input: Uint8Array,
  customBudgets?: Partial<FlaRecoveryBudgets>,
): FlaRecoveryClassification;
export declare function normalizeRecoveryCandidate(
  input: Uint8Array,
  classification: FlaRecoveryClassification,
): FlaRecoveryNormalization;
export declare function sha256(bytes: Uint8Array): string;
