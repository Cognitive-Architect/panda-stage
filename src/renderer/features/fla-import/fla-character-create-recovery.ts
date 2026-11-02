import { z } from 'zod';
import type {
  FlaCharacterCreateErrorCode,
  FlaCharacterCreateOutcome,
  FlaCharacterCreateStatusRequest,
  FlaCharacterCreateStatusResponse,
} from '../../../shared/fla-character-create-api';

const STORAGE_KEY = 'panda-stage:fla-character-create:pending:v1';

const PendingFlaCharacterCreateCredentialSchema = z.object({
  version: z.literal(1),
  operationId: z.uuid(),
  projectRoot: z.string().trim().min(1).max(32_767),
  projectId: z.string().trim().min(1).max(200),
  openInstanceId: z.number().int().positive(),
  baseRevision: z.number().int().nonnegative(),
  planId: z.uuid(),
  poseIdentity: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export type PendingFlaCharacterCreateCredential = z.infer<
  typeof PendingFlaCharacterCreateCredentialSchema
>;

export type FlaCharacterCreateOperationState =
  | 'unknown'
  | 'in-progress'
  | 'safe-to-close'
  | 'terminal';

export type FlaCharacterCreateStatusDecisionKind =
  | 'committed'
  | 'committed-project-not-current'
  | 'failed'
  | 'not-found'
  | 'in-progress'
  | 'recovery-required'
  | 'conflict'
  | 'unknown';

export interface FlaCharacterCreateStatusDecision {
  kind: FlaCharacterCreateStatusDecisionKind;
  operationState: FlaCharacterCreateOperationState;
  canClose: boolean;
  canCreateAfterCredentialClear: boolean;
  shouldClearCredential: boolean;
  nextAction:
    | 'open-created-character'
    | 'reopen-project-center'
    | 'prepare-again'
    | 'query-status'
    | 'copy-and-query';
}

function statusDecision(
  kind: FlaCharacterCreateStatusDecisionKind,
  operationState: FlaCharacterCreateOperationState,
  canClose: boolean,
  canCreateAfterCredentialClear: boolean,
  shouldClearCredential: boolean,
  nextAction: FlaCharacterCreateStatusDecision['nextAction'],
): FlaCharacterCreateStatusDecision {
  return {
    kind,
    operationState,
    canClose,
    canCreateAfterCredentialClear,
    shouldClearCredential,
    nextAction,
  };
}

function unresolvedDecision(
  kind: 'recovery-required' | 'conflict' | 'unknown',
): FlaCharacterCreateStatusDecision {
  return statusDecision(kind, 'unknown', false, false, false, 'copy-and-query');
}

export function decideFlaCharacterCreateStatus(
  credential: PendingFlaCharacterCreateCredential,
  status: FlaCharacterCreateStatusResponse,
  options: { hasVerifiedReentryCredential?: boolean } = {},
): FlaCharacterCreateStatusDecision {
  if (
    'operationId' in status &&
    status.operationId !== undefined &&
    status.operationId !== credential.operationId
  ) {
    return unresolvedDecision('conflict');
  }

  if (!status.ok) {
    return decideFlaCharacterCreateQueryFailure(status.error.code);
  }

  switch (status.status) {
    case 'COMMITTED': {
      if (!matchesPendingFlaCharacterCreateOutcome(credential, status.result)) {
        return unresolvedDecision('conflict');
      }
      const reentryAvailable = options.hasVerifiedReentryCredential === true;
      if (!Object.prototype.hasOwnProperty.call(status.result, 'project')) {
        return statusDecision(
          'committed-project-not-current',
          reentryAvailable ? 'safe-to-close' : 'unknown',
          reentryAvailable,
          false,
          false,
          reentryAvailable ? 'reopen-project-center' : 'copy-and-query',
        );
      }
      return statusDecision(
        'committed',
        reentryAvailable ? 'safe-to-close' : 'unknown',
        reentryAvailable,
        false,
        false,
        reentryAvailable ? 'reopen-project-center' : 'copy-and-query',
      );
    }
    case 'IN_PROGRESS':
      return statusDecision('in-progress', 'in-progress', false, false, false, 'query-status');
    case 'RECOVERY_REQUIRED':
      // The current Main status contract does not return a verified journal
      // identity or an executable recovery route. A status string alone is
      // not evidence that leaving the operation is safe.
      return unresolvedDecision('recovery-required');
    case 'FAILED':
      if (status.error.code === 'OPERATION_IN_PROGRESS') {
        return statusDecision('in-progress', 'in-progress', false, false, false, 'query-status');
      }
      if (status.error.code === 'OPERATION_ID_CONFLICT') {
        return unresolvedDecision('conflict');
      }
      if (status.error.code === 'RECOVERY_REQUIRED') {
        return unresolvedDecision('recovery-required');
      }
      return statusDecision('failed', 'terminal', true, true, true, 'prepare-again');
    case 'NOT_FOUND':
      return statusDecision('not-found', 'terminal', true, true, true, 'prepare-again');
  }
}

export function decideFlaCharacterCreateCommittedOutcome(
  credential: PendingFlaCharacterCreateCredential,
  result: FlaCharacterCreateOutcome,
  currentSnapshot: {
    projectRoot: string;
    project: { id: string } & object;
    revision: number;
  } | null,
  hasVerifiedReentryCredential: boolean,
): FlaCharacterCreateStatusDecision {
  if (!matchesPendingFlaCharacterCreateOutcome(credential, result)) {
    return unresolvedDecision('conflict');
  }
  const snapshotIsCurrent = 'project' in result &&
    currentSnapshot?.projectRoot === result.projectRoot &&
    currentSnapshot.project.id === result.projectId &&
    currentSnapshot.revision === result.savedRevision &&
    JSON.stringify(currentSnapshot.project) === JSON.stringify(result.project);
  if (snapshotIsCurrent) {
    return statusDecision('committed', 'terminal', true, false, true, 'open-created-character');
  }
  return statusDecision(
    'committed-project-not-current',
    hasVerifiedReentryCredential ? 'safe-to-close' : 'unknown',
    hasVerifiedReentryCredential,
    false,
    false,
    hasVerifiedReentryCredential ? 'reopen-project-center' : 'copy-and-query',
  );
}

export function decideFlaCharacterCreateQueryFailure(
  code?: FlaCharacterCreateErrorCode,
): FlaCharacterCreateStatusDecision {
  if (code === 'OPERATION_IN_PROGRESS') {
    return statusDecision('in-progress', 'in-progress', false, false, false, 'query-status');
  }
  if (code === 'OPERATION_ID_CONFLICT') return unresolvedDecision('conflict');
  if (code === 'RECOVERY_REQUIRED') return unresolvedDecision('recovery-required');
  return unresolvedDecision('unknown');
}

export function shouldBlockFlaCharacterImportClose(
  phase: string,
  hasPendingOperation: boolean,
): boolean {
  return phase === 'committing' || hasPendingOperation;
}

export function isFlaCharacterOperationLocked(
  state: FlaCharacterCreateOperationState,
  hasPendingCredential: boolean,
): boolean {
  return state !== 'terminal' || hasPendingCredential;
}

export function samePendingFlaCharacterCreateCredential(
  left: PendingFlaCharacterCreateCredential,
  right: PendingFlaCharacterCreateCredential,
): boolean {
  return left.operationId === right.operationId &&
    left.projectRoot === right.projectRoot &&
    left.projectId === right.projectId &&
    left.openInstanceId === right.openInstanceId &&
    left.baseRevision === right.baseRevision &&
    left.planId === right.planId &&
    left.poseIdentity === right.poseIdentity;
}

export interface FlaCharacterNativeCloseDecisionInput {
  operationLocked: boolean;
  pendingRecord: PendingFlaCharacterCreateRecord;
  persistedRecord: PendingFlaCharacterCreateRecord;
  armedOperationId: string | null;
  operationState: FlaCharacterCreateOperationState;
  currentProject: { projectRoot: string; projectId: string; dirty: boolean } | null;
}

export interface FlaCharacterNativeCloseDecision {
  allowed: boolean;
  skipAutosave: boolean;
  reason: 'not-armed' | 'credential-mismatch' | 'project-mismatch' | 'dirty-project' | null;
}

export function decideFlaCharacterNativeClose(
  input: FlaCharacterNativeCloseDecisionInput,
): FlaCharacterNativeCloseDecision {
  const hasPersistedCredential =
    input.pendingRecord.kind !== 'none' || input.persistedRecord.kind !== 'none';
  if (!input.operationLocked && !hasPersistedCredential) {
    return { allowed: true, skipAutosave: false, reason: null };
  }
  if (
    input.operationState !== 'safe-to-close' ||
    !input.armedOperationId ||
    input.pendingRecord.kind !== 'valid' ||
    input.persistedRecord.kind !== 'valid' ||
    input.pendingRecord.credential.operationId !== input.armedOperationId
  ) {
    return { allowed: false, skipAutosave: false, reason: 'not-armed' };
  }
  if (!samePendingFlaCharacterCreateCredential(
    input.pendingRecord.credential,
    input.persistedRecord.credential,
  )) {
    return { allowed: false, skipAutosave: false, reason: 'credential-mismatch' };
  }

  const currentProject = input.currentProject;
  const sameProjectRoot = currentProject !== null &&
    currentProject.projectRoot === input.pendingRecord.credential.projectRoot;
  if (sameProjectRoot && currentProject.projectId !== input.pendingRecord.credential.projectId) {
    return { allowed: false, skipAutosave: false, reason: 'project-mismatch' };
  }
  const projectMatches = sameProjectRoot &&
    currentProject.projectId === input.pendingRecord.credential.projectId;
  if (projectMatches && currentProject.dirty) {
    return { allowed: false, skipAutosave: false, reason: 'dirty-project' };
  }
  return {
    allowed: true,
    skipAutosave: projectMatches,
    reason: null,
  };
}

export type PendingFlaCharacterCreateRecord =
  | { kind: 'none' }
  | { kind: 'valid'; credential: PendingFlaCharacterCreateCredential }
  | { kind: 'invalid' };

export interface FlaCharacterCreateStatusApi {
  getCharacterCreateStatus(
    request: FlaCharacterCreateStatusRequest,
  ): Promise<FlaCharacterCreateStatusResponse>;
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readPendingFlaCharacterCreateRecord(
  storage: Storage | null = browserStorage(),
): PendingFlaCharacterCreateRecord {
  if (!storage) return { kind: 'invalid' };
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { kind: 'invalid' };
  }
  if (raw === null) return { kind: 'none' };
  try {
    const credential = PendingFlaCharacterCreateCredentialSchema.parse(
      JSON.parse(raw),
    );
    return { kind: 'valid', credential };
  } catch {
    return { kind: 'invalid' };
  }
}

export function writePendingFlaCharacterCreateCredential(
  credential: PendingFlaCharacterCreateCredential,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const parsed = PendingFlaCharacterCreateCredentialSchema.safeParse(credential);
  if (!parsed.success) return false;
  const existing = readPendingFlaCharacterCreateRecord(storage);
  if (
    existing.kind === 'invalid' ||
    (existing.kind === 'valid' &&
      !samePendingFlaCharacterCreateCredential(
        existing.credential,
        parsed.data,
      ))
  ) {
    return false;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingFlaCharacterCreateCredential(
  credential: PendingFlaCharacterCreateCredential,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const current = readPendingFlaCharacterCreateRecord(storage);
  if (
    current.kind !== 'valid' ||
    !samePendingFlaCharacterCreateCredential(
      current.credential,
      credential,
    )
  ) {
    return false;
  }
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function matchesPendingFlaCharacterCreateOutcome(
  credential: PendingFlaCharacterCreateCredential,
  result: FlaCharacterCreateOutcome,
): boolean {
  return result.operationId === credential.operationId &&
    result.projectRoot === credential.projectRoot &&
    result.projectId === credential.projectId &&
    result.openInstanceId === credential.openInstanceId &&
    result.baseRevision === credential.baseRevision &&
    result.savedRevision === credential.baseRevision + 1 &&
    result.identity.planId === credential.planId &&
    result.identity.poseIdentity === credential.poseIdentity;
}

export async function queryPendingFlaCharacterCreateStatus(
  credential: PendingFlaCharacterCreateCredential,
  api: FlaCharacterCreateStatusApi,
): Promise<FlaCharacterCreateStatusResponse> {
  const status = await api.getCharacterCreateStatus({
    format: 'panda-fla-character-create-status',
    version: 1,
    operationId: credential.operationId,
    projectRoot: credential.projectRoot,
    projectId: credential.projectId,
  });
  if (status.ok && status.status !== 'COMMITTED') {
    if (status.operationId !== credential.operationId) {
      return {
        ok: false,
        status: 'ERROR',
        error: {
          code: 'OPERATION_ID_CONFLICT',
          message: 'The status receipt does not match the saved operation.',
        },
      };
    }
    return status;
  }
  if (
    status.ok &&
    status.status === 'COMMITTED' &&
    !matchesPendingFlaCharacterCreateOutcome(credential, status.result)
  ) {
    return {
      ok: false,
      status: 'ERROR',
      error: {
        code: 'OPERATION_ID_CONFLICT',
        message: 'The saved result does not match the saved operation identity.',
      },
    };
  }
  return status;
}
