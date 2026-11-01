import { z } from 'zod';
import type {
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
