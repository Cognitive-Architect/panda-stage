import { describe, expect, it, vi } from 'vitest';
import type {
  FlaCharacterCreateOutcome,
  FlaCharacterCreateStatusRequest,
} from '../../src/shared/fla-character-create-api';
import {
  clearPendingFlaCharacterCreateCredential,
  matchesPendingFlaCharacterCreateOutcome,
  queryPendingFlaCharacterCreateStatus,
  readPendingFlaCharacterCreateRecord,
  samePendingFlaCharacterCreateCredential,
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
        sceneIndex: 0,
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
});
