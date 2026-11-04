export type TargetClassification =
  | 'FULL_BODY_ACTION_CANDIDATE'
  | 'PARTIAL_ACTION_ONLY'
  | 'STATIC_OR_MULTIVIEW'
  | 'UNKNOWN_OR_UNSUPPORTED';

export type VisualReview = 'FULL_BODY' | 'PARTIAL_ONLY' | 'STATIC_MULTIVIEW' | 'UNKNOWN';

export interface TargetEvidenceInput {
  structuralDynamic?: boolean;
  frameContextChanged?: boolean;
  renderedFrameHashes?: readonly string[];
  visualReview?: VisualReview | null;
  sourceTraceable?: boolean;
  previewSupported?: boolean;
  unsupportedReason?: string | null;
}

export interface ClassificationResult {
  classification: TargetClassification;
  reason: string;
}

export interface FileEvidenceInput {
  classification: TargetClassification;
  reason: string;
}

export interface EnumeratedFile {
  absolutePath: string;
  relativePath: string;
}

export interface EnumerationIssue {
  relativePath: string;
  reason: string;
}

export interface EnumerationResult {
  root: string;
  rootRealPath: string;
  files: EnumeratedFile[];
  skipped: EnumerationIssue[];
  normalizedPathCollisions: Array<{ normalizedRelativePath: string; relativePaths: string[] }>;
  complete: boolean;
}

export interface VisualReviewRecord {
  sourceSha256: string;
  renderTargetId: string;
  coverage: VisualReview;
  notes?: string;
  reviewedAt?: string | null;
}

export interface InventoryManifest {
  files: Array<{
    sha256?: string | null;
    classification: TargetClassification;
    classificationReason: string;
    parserStatus: string;
    targets?: Array<{
      renderTargetId: string;
      classification: TargetClassification;
      classificationReason: string;
      structuralDynamic?: boolean;
      frameContextChanged?: boolean;
      previewSupported?: boolean;
      unsupportedReason?: string | null;
      s2?: { renderedFrameHashes?: string[] };
      visualReview?: { coverage: VisualReview; notes: string; reviewedAt: string | null };
    }>;
  }>;
  summary?: Record<string, unknown>;
  review?: { applied: boolean; matchedTargetCount: number; reviewedAt: string };
}

export const FILE_CLASSES: readonly TargetClassification[];
export function normalizePathKey(value: string): string;
export function isWithin(parentPath: string, childPath: string): boolean;
export function enumerateFlaFiles(rootPath: string): Promise<EnumerationResult>;
export function sampleFrameIndices(frameCount: number): number[];
export function classifyTargetEvidence(evidence: TargetEvidenceInput): ClassificationResult;
export function classifyFileEvidence(targets: readonly FileEvidenceInput[], parserStatus: string): ClassificationResult;
export function groupFilesBySha256(files: readonly { sha256?: string | null; relativePath: string }[]): Array<{ sha256: string; relativePaths: string[] }>;
export function tallyFileClasses(files: readonly { classification: TargetClassification }[]): Record<TargetClassification, number>;
export function applyVisualReviews(manifest: InventoryManifest, reviewRecords: readonly VisualReviewRecord[]): InventoryManifest;
export function refreshSummary(manifest: InventoryManifest): Record<string, unknown>;
