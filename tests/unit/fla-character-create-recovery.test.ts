import { describe, expect, it, vi } from 'vitest';
import type {
  FlaCharacterCreateOutcome,
  FlaCharacterCreateStatusRequest,
} from '../../src/shared/fla-character-create-api';
import {
  clearPendingFlaCharacterCreateCredential,
  decideFlaCharacterCreateQueryFailure,
  decideFlaCharacterCreateCommittedOutcome,
  decideFlaCharacterCreateStatus,
  decideFlaCharacterNativeClose,
  isFlaCharacterOperationLocked,
  matchesPendingFlaCharacterCreateOutcome,
  queryPendingFlaCharacterCreateStatus,
  readPendingFlaCharacterCreateRecord,
  samePendingFlaCharacterCreateCredential,
  shouldBlockFlaCharacterImportClose,
  writePendingFlaCharacterCreateCredential,
  type PendingFlaCharacterCreateCredential,
} from '../../src/renderer/features/fla-import/fla-character-create-recovery';

const OPERATION_ID = '90800000-0000-4000-8000-000000000004';
const OTHER_OPERATION_ID = '90800000-0000-4000-8000-000000000005';
const PLAN_ID = '90800000-0000-4000-8000-000000000001';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

const credential: PendingFlaCharacterCreateCredential = {
  version: 1,
  operationId: OPERATION_ID,
  projectRoot: 'D:\\acceptance\\project.pandastage',
  projectId: 'project-recovery-test',
  openInstanceId: 17,
  baseRevision: 4,
  planId: PLAN_ID,
  poseIdentity: 'c'.repeat(64),
};

function committedOutcome(
  overrides: Record<string, unknown> = {},
): FlaCharacterCreateOutcome {
  return {
    operationId: credential.operationId,
    projectRoot: credential.projectRoot,
    projectId: credential.projectId,
    openInstanceId: credential.openInstanceId,
    baseRevision: credential.baseRevision,
    savedRevision: credential.baseRevision + 1,
    characterId: 'character-recovery-test',
    voiceProfileId: 'voice-profile-recovery-test',
    identity: {
      planId: credential.planId,
      sessionId: '90800000-0000-4000-8000-000000000002',
      requestId: '90800000-0000-4000-8000-000000000003',
      generation: 1,
      rawSourceSha256: 'a'.repeat(64),
      normalizedSourceSha256: 'b'.repeat(64),
      poseIdentity: credential.poseIdentity,
      target: {
        renderTargetId: 'fla-render-target-recovery-test',
        kind: 'scene',
        sceneIndex: 0,
        sourceLibraryItemName: null,
        selectedFrameIndex: 0,
      },
    },
    assets: [],
    createdAssetCount: 0,
    reusedAssetCount: 0,
    ...overrides,
  } as unknown as FlaCharacterCreateOutcome;
}

describe('FLA Character create recovery credentials', () => {
  it('compares the complete persisted operation credential', () => {
    expect(samePendingFlaCharacterCreateCredential(credential, {
      ...credential,
    })).toBe(true);
    expect(samePendingFlaCharacterCreateCredential(credential, {
      ...credential,
      poseIdentity: 'd'.repeat(64),
    })).toBe(false);
  });

  it('round-trips one credential and only clears the matching operation ID', () => {
    const storage = new MemoryStorage();

    expect(writePendingFlaCharacterCreateCredential(credential, storage)).toBe(true);
    expect(readPendingFlaCharacterCreateRecord(storage)).toEqual({
      kind: 'valid',
      credential,
    });
    expect(clearPendingFlaCharacterCreateCredential({
      ...credential,
      operationId: OTHER_OPERATION_ID,
    }, storage)).toBe(false);
    expect(clearPendingFlaCharacterCreateCredential({
      ...credential,
      projectId: 'another-project',
    }, storage)).toBe(false);
    expect(clearPendingFlaCharacterCreateCredential(credential, storage)).toBe(true);
    expect(readPendingFlaCharacterCreateRecord(storage)).toEqual({ kind: 'none' });
  });

  it('does not overwrite a different, mismatched, or malformed pending credential', () => {
    const storage = new MemoryStorage();
    expect(writePendingFlaCharacterCreateCredential(credential, storage)).toBe(true);
    expect(writePendingFlaCharacterCreateCredential({
      ...credential,
      operationId: OTHER_OPERATION_ID,
    }, storage)).toBe(false);
    expect(writePendingFlaCharacterCreateCredential({
      ...credential,
      projectId: 'another-project',
    }, storage)).toBe(false);

    storage.setItem(
      'panda-stage:fla-character-create:pending:v1',
      '{not json',
    );
    expect(writePendingFlaCharacterCreateCredential(credential, storage)).toBe(false);
  });

  it('accepts only committed outcomes matching the full saved operation identity', () => {
    expect(matchesPendingFlaCharacterCreateOutcome(credential, committedOutcome())).toBe(true);
    expect(matchesPendingFlaCharacterCreateOutcome(
      credential,
      committedOutcome({ operationId: OTHER_OPERATION_ID }),
    )).toBe(false);
    expect(matchesPendingFlaCharacterCreateOutcome(
      credential,
      committedOutcome({ savedRevision: credential.baseRevision + 2 }),
    )).toBe(false);
    expect(matchesPendingFlaCharacterCreateOutcome(
      credential,
      committedOutcome({ identity: { planId: PLAN_ID, poseIdentity: 'd'.repeat(64) } }),
    )).toBe(false);
  });

  it('queries status with the persisted operation and project identity', async () => {
    const getCharacterCreateStatus = vi.fn(async (request: FlaCharacterCreateStatusRequest) => ({
      ok: true as const,
      status: 'NOT_FOUND' as const,
      operationId: request.operationId,
    }));

    const result = await queryPendingFlaCharacterCreateStatus(credential, {
      getCharacterCreateStatus,
    });

    expect(getCharacterCreateStatus).toHaveBeenCalledWith({
      format: 'panda-fla-character-create-status',
      version: 1,
      operationId: OPERATION_ID,
      projectRoot: credential.projectRoot,
      projectId: credential.projectId,
    });
    expect(result).toEqual({
      ok: true,
      status: 'NOT_FOUND',
      operationId: OPERATION_ID,
    });
  });

  it('turns mismatched status and committed results into operation conflicts', async () => {
    const mismatchedStatus = await queryPendingFlaCharacterCreateStatus(credential, {
      getCharacterCreateStatus: async () => ({
        ok: true,
        status: 'NOT_FOUND',
        operationId: OTHER_OPERATION_ID,
      }),
    });
    expect(mismatchedStatus).toMatchObject({
      ok: false,
      status: 'ERROR',
      error: { code: 'OPERATION_ID_CONFLICT' },
    });

    const mismatchedResult = await queryPendingFlaCharacterCreateStatus(credential, {
      getCharacterCreateStatus: async () => ({
        ok: true,
        status: 'COMMITTED',
        result: committedOutcome({ operationId: OTHER_OPERATION_ID }),
      }),
    });
    expect(mismatchedResult).toMatchObject({
      ok: false,
      status: 'ERROR',
      error: { code: 'OPERATION_ID_CONFLICT' },
    });
  });

  it('keeps conflicts, query errors, and unverified recovery-required results locked', () => {
    const conflict = decideFlaCharacterCreateStatus(credential, {
      ok: true,
      status: 'RECOVERY_REQUIRED',
      operationId: OTHER_OPERATION_ID,
    });
    const recoveryRequired = decideFlaCharacterCreateStatus(credential, {
      ok: true,
      status: 'RECOVERY_REQUIRED',
      operationId: OPERATION_ID,
      message: 'needs recovery',
    });
    const queryConflict = decideFlaCharacterCreateQueryFailure('OPERATION_ID_CONFLICT');
    const queryRecoveryError = decideFlaCharacterCreateQueryFailure('RECOVERY_REQUIRED');

    expect(conflict).toMatchObject({ kind: 'conflict', operationState: 'unknown', canClose: false });
    expect(recoveryRequired).toMatchObject({
      kind: 'recovery-required',
      operationState: 'unknown',
      canClose: false,
      shouldClearCredential: false,
    });
    expect(queryConflict.canClose).toBe(false);
    expect(queryConflict.operationState).toBe('unknown');
    expect(queryRecoveryError.canClose).toBe(false);
    expect(decideFlaCharacterCreateQueryFailure().operationState).toBe('unknown');
  });

  it('distinguishes in-progress, verified commit, identity-only reentry, failure, and not-found behavior', () => {
    const inProgress = decideFlaCharacterCreateStatus(credential, {
      ok: true,
      status: 'IN_PROGRESS',
      operationId: OPERATION_ID,
    });
    const identityOnly = decideFlaCharacterCreateStatus(credential, {
      ok: true,
      status: 'COMMITTED',
      result: committedOutcome(),
    });
    const identityOnlyWithReentry = decideFlaCharacterCreateStatus(credential, {
      ok: true,
      status: 'COMMITTED',
      result: committedOutcome(),
    }, { hasVerifiedReentryCredential: true });
    const mismatchedCommit = decideFlaCharacterCreateStatus(credential, {
      ok: true,
      status: 'COMMITTED',
      result: committedOutcome({ operationId: OTHER_OPERATION_ID }),
    });
    const failed = decideFlaCharacterCreateStatus(credential, {
      ok: true,
      status: 'FAILED',
      operationId: OPERATION_ID,
      error: { code: 'DUPLICATE_CHARACTER_NAME', message: 'duplicate' },
    });
    const notFound = decideFlaCharacterCreateStatus(credential, {
      ok: true,
      status: 'NOT_FOUND',
      operationId: OPERATION_ID,
    });

    expect(inProgress).toMatchObject({ kind: 'in-progress', operationState: 'in-progress', canClose: false });
    expect(identityOnly).toMatchObject({
      kind: 'committed-project-not-current',
      operationState: 'unknown',
      canClose: false,
      shouldClearCredential: false,
    });
    expect(identityOnlyWithReentry).toMatchObject({
      kind: 'committed-project-not-current',
      operationState: 'safe-to-close',
      canClose: true,
      nextAction: 'reopen-project-center',
    });
    expect(mismatchedCommit).toMatchObject({ kind: 'conflict', operationState: 'unknown', canClose: false });
    expect(failed).toMatchObject({
      kind: 'failed',
      operationState: 'terminal',
      shouldClearCredential: true,
      canCreateAfterCredentialClear: true,
    });
    expect(notFound).toMatchObject({
      kind: 'not-found',
      operationState: 'terminal',
      shouldClearCredential: true,
      canCreateAfterCredentialClear: true,
    });
  });

  it('keeps a committed result with a stale renderer snapshot pending for verified reentry', () => {
    const savedProject = { id: credential.projectId, characters: [{ id: 'new-character' }] };
    const result = committedOutcome({ project: savedProject });
    const staleSnapshot = {
      projectRoot: credential.projectRoot,
      project: { id: credential.projectId, characters: [] },
      revision: credential.baseRevision,
    };
    const currentSnapshot = {
      projectRoot: credential.projectRoot,
      project: savedProject,
      revision: credential.baseRevision + 1,
    };

    expect(decideFlaCharacterCreateCommittedOutcome(
      credential,
      result,
      staleSnapshot,
      true,
    )).toMatchObject({
      kind: 'committed-project-not-current',
      operationState: 'safe-to-close',
      canClose: true,
      shouldClearCredential: false,
      nextAction: 'reopen-project-center',
    });
    expect(decideFlaCharacterCreateCommittedOutcome(
      credential,
      result,
      staleSnapshot,
      false,
    )).toMatchObject({
      kind: 'committed-project-not-current',
      operationState: 'unknown',
      canClose: false,
      shouldClearCredential: false,
    });
    expect(decideFlaCharacterCreateCommittedOutcome(
      credential,
      result,
      currentSnapshot,
      true,
    )).toMatchObject({
      kind: 'committed',
      operationState: 'terminal',
      shouldClearCredential: true,
    });
  });

  it('locks Escape and drawer close while the create operation is pending', () => {
    expect(shouldBlockFlaCharacterImportClose('committing', false)).toBe(true);
    expect(shouldBlockFlaCharacterImportClose('error', true)).toBe(true);
    expect(shouldBlockFlaCharacterImportClose('preview-ready', false)).toBe(false);
    expect(isFlaCharacterOperationLocked('safe-to-close', true)).toBe(true);
    expect(isFlaCharacterOperationLocked('terminal', false)).toBe(false);
  });

  it('allows native close only for the armed, matching receipt and blocks stale dirty projects', () => {
    const validRecord = { kind: 'valid' as const, credential };
    const base = {
      operationLocked: true,
      pendingRecord: validRecord,
      persistedRecord: validRecord,
      armedOperationId: OPERATION_ID,
      operationState: 'safe-to-close' as const,
      currentProject: {
        projectRoot: credential.projectRoot,
        projectId: credential.projectId,
        dirty: false,
      },
    };

    expect(decideFlaCharacterNativeClose(base)).toEqual({
      allowed: true,
      skipAutosave: true,
      reason: null,
    });
    expect(decideFlaCharacterNativeClose({
      ...base,
      currentProject: { ...base.currentProject, dirty: true },
    })).toMatchObject({ allowed: false, reason: 'dirty-project', skipAutosave: false });
    expect(decideFlaCharacterNativeClose({
      ...base,
      currentProject: { ...base.currentProject, projectId: 'different-project' },
    })).toMatchObject({ allowed: false, reason: 'project-mismatch' });
    expect(decideFlaCharacterNativeClose({
      ...base,
      persistedRecord: { kind: 'valid', credential: { ...credential, poseIdentity: 'd'.repeat(64) } },
    })).toMatchObject({ allowed: false, reason: 'credential-mismatch' });
    expect(decideFlaCharacterNativeClose({
      ...base,
      armedOperationId: OTHER_OPERATION_ID,
    })).toMatchObject({ allowed: false, reason: 'not-armed' });
    expect(decideFlaCharacterNativeClose({
      ...base,
      operationState: 'unknown',
    })).toMatchObject({ allowed: false, reason: 'not-armed' });
  });
});
