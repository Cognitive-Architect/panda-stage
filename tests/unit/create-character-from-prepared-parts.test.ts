import { describe, expect, it, vi } from 'vitest';
import type {
  FlaCharacterCreateOutcome,
  FlaCharacterCreateRequest,
  FlaCharacterCreateResponse,
  FlaCharacterCreateStatusRequest,
  FlaCharacterCreateStatusResponse,
} from '../../src/shared/fla-character-create-api';
import type { FlaPartPreviewResponse } from '../../src/shared/fla-part-preview-api';
import type {
  EditorProjectSnapshot,
  EditorProjectStore,
} from '../../src/renderer/stores/EditorProjectStore';
import {
  createCharacterFromPreparedParts,
  queryFlaCharacterCreateStatus,
} from '../../src/renderer/features/fla-import/createCharacterFromPreparedParts';

function createTestContext() {
  const operationId = crypto.randomUUID();
  const planId = crypto.randomUUID();
  const projectRoot = 'D:\\PandaStage-Acceptance\\F1-04-project';
  const projectId = 'project-f1-04';
  const openInstanceId = 41;
  const revision = 9;
  const poseIdentity = 'a'.repeat(64);
  const snapshot = {
    projectRoot,
    revision,
    dirty: false,
    project: { id: projectId },
  } as unknown as EditorProjectSnapshot;
  const lease = {
    projectRoot,
    projectId,
    revision,
    openInstanceId,
  };
  const acquireProjectOperationLease = vi.fn(() => lease);
  const acceptSavedProjectCommand = vi.fn();
  const releaseProjectOperationLease = vi.fn();
  const store = {
    getSnapshot: () => snapshot,
    getProjectInstanceId: () => openInstanceId,
    acquireProjectOperationLease,
    acceptSavedProjectCommand,
    releaseProjectOperationLease,
  } as unknown as EditorProjectStore;
  const preview = {
    ok: true,
    status: 'PREVIEW_READY',
    capability: 'EDITABLE_PARTS_READY',
    planId,
    sessionId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    generation: 1,
    poseIdentity,
    target: {
      renderTargetId: 'fla-render-target-scene0001',
      selectedFrameIndex: 0,
    },
  } as unknown as Extract<
    FlaPartPreviewResponse,
    { ok: true; status: 'PREVIEW_READY'; capability: 'EDITABLE_PARTS_READY' }
  >;
  const result = {
    operationId,
    projectRoot,
    projectId,
    openInstanceId,
    baseRevision: revision,
    savedRevision: revision + 1,
    characterId: 'character-f1-04',
    identity: { planId, poseIdentity },
  } as unknown as FlaCharacterCreateOutcome;
  return {
    operationId,
    projectRoot,
    projectId,
    revision,
    openInstanceId,
    snapshot,
    preview,
    result,
    store,
    acquireProjectOperationLease,
    acceptSavedProjectCommand,
    releaseProjectOperationLease,
  };
}

describe('createCharacterFromPreparedParts recovery', () => {
  it('returns a committed identity-only receipt without replacing the renderer Project', async () => {
    const context = createTestContext();
    const createCharacterFromParts = vi.fn(async (request: FlaCharacterCreateRequest): Promise<FlaCharacterCreateResponse> => {
      expect(request.operationId).toBe(context.operationId);
      return {
        ok: true,
        status: 'COMMITTED',
        result: context.result,
      };
    });
    const getCharacterCreateStatus = vi.fn(async (request: FlaCharacterCreateStatusRequest): Promise<FlaCharacterCreateStatusResponse> => ({
      ok: true,
      status: 'NOT_FOUND',
      operationId: request.operationId,
    }));
    const ensureMainSnapshot = vi.fn(async () => undefined);

    const result = await createCharacterFromPreparedParts({
      preview: context.preview,
      name: 'Sample A',
      operationId: context.operationId,
      api: { createCharacterFromParts, getCharacterCreateStatus },
      store: context.store,
      ensureMainSnapshot,
    });

    expect(result.characterId).toBe('character-f1-04');
    expect(createCharacterFromParts).toHaveBeenCalledTimes(1);
    expect(createCharacterFromParts.mock.calls[0]?.[0].operationId).toBe(context.operationId);
    expect(ensureMainSnapshot).toHaveBeenCalledTimes(1);
    expect(context.acceptSavedProjectCommand).not.toHaveBeenCalled();
    expect(context.releaseProjectOperationLease).toHaveBeenCalledTimes(1);
  });

  it('recovers a lost commit reply by querying the same operationId once', async () => {
    const context = createTestContext();
    const createCharacterFromParts = vi.fn(async (request: FlaCharacterCreateRequest): Promise<FlaCharacterCreateResponse> => {
      expect(request.operationId).toBe(context.operationId);
      throw new Error('Renderer reply lost after Main commit.');
    });
    const getCharacterCreateStatus = vi.fn(async (request: FlaCharacterCreateStatusRequest): Promise<FlaCharacterCreateStatusResponse> => {
      expect(request.operationId).toBe(context.operationId);
      return {
        ok: true,
        status: 'COMMITTED',
        result: context.result,
      };
    });

    const result = await createCharacterFromPreparedParts({
      preview: context.preview,
      name: 'Sample A',
      operationId: context.operationId,
      api: { createCharacterFromParts, getCharacterCreateStatus },
      store: context.store,
    });

    expect(result.characterId).toBe('character-f1-04');
    expect(createCharacterFromParts).toHaveBeenCalledTimes(1);
    expect(getCharacterCreateStatus).toHaveBeenCalledTimes(1);
    expect(getCharacterCreateStatus.mock.calls[0]?.[0].operationId).toBe(context.operationId);
    expect(context.acceptSavedProjectCommand).not.toHaveBeenCalled();
  });

  it('queries the same operationId without resubmitting and leaves an in-progress result unresolved', async () => {
    const context = createTestContext();
    const createCharacterFromParts = vi.fn();
    const getCharacterCreateStatus = vi.fn(async (request: FlaCharacterCreateStatusRequest): Promise<FlaCharacterCreateStatusResponse> => ({
      ok: true,
      status: 'IN_PROGRESS',
      operationId: request.operationId,
      message: 'Still committing.',
    }));

    const status = await queryFlaCharacterCreateStatus({
      operationId: context.operationId,
      preview: context.preview,
      baseSnapshot: context.snapshot,
      openInstanceId: context.openInstanceId,
      api: { createCharacterFromParts, getCharacterCreateStatus },
      store: context.store,
    });

    expect(status).toMatchObject({ ok: true, status: 'IN_PROGRESS' });
    expect(createCharacterFromParts).not.toHaveBeenCalled();
    expect(getCharacterCreateStatus).toHaveBeenCalledTimes(1);
    expect(getCharacterCreateStatus.mock.calls[0]?.[0].operationId).toBe(context.operationId);
    expect(context.acceptSavedProjectCommand).not.toHaveBeenCalled();
    expect(context.releaseProjectOperationLease).toHaveBeenCalledTimes(1);
  });

  it('accepts a queried Project snapshot only while the captured identity and revision still match', async () => {
    const context = createTestContext();
    const project = { id: context.projectId, name: 'saved project' };
    const committedResult = {
      ...context.result,
      project,
    } as unknown as FlaCharacterCreateOutcome;
    const getCharacterCreateStatus = vi.fn(async (): Promise<FlaCharacterCreateStatusResponse> => ({
      ok: true,
      status: 'COMMITTED',
      result: committedResult,
    }));

    const status = await queryFlaCharacterCreateStatus({
      operationId: context.operationId,
      preview: context.preview,
      baseSnapshot: context.snapshot,
      openInstanceId: context.openInstanceId,
      api: { createCharacterFromParts: vi.fn(), getCharacterCreateStatus },
      store: context.store,
    });

    expect(status).toMatchObject({ ok: true, status: 'COMMITTED', result: { project } });
    expect(context.acceptSavedProjectCommand).toHaveBeenCalledWith(
      context.acquireProjectOperationLease.mock.results[0]?.value,
      project,
      context.revision + 1,
      '导入角色',
    );
    expect(context.releaseProjectOperationLease).toHaveBeenCalledTimes(1);
  });

  it('strips a stale committed snapshot and does not add it to History', async () => {
    const context = createTestContext();
    const project = { id: context.projectId, name: 'saved project' };
    const committedResult = {
      ...context.result,
      project,
    } as unknown as FlaCharacterCreateOutcome;
    const getSnapshot = vi.fn(() => ({
      ...context.snapshot,
      revision: context.revision + 1,
      project: { id: context.projectId, name: 'newer local project' },
    }));
    const acquireProjectOperationLease = vi.fn();
    const acceptSavedProjectCommand = vi.fn();
    const releaseProjectOperationLease = vi.fn();
    const staleStore = {
      getSnapshot,
      getProjectInstanceId: () => context.openInstanceId,
      acquireProjectOperationLease,
      acceptSavedProjectCommand,
      releaseProjectOperationLease,
    } as unknown as EditorProjectStore;

    const status = await queryFlaCharacterCreateStatus({
      operationId: context.operationId,
      preview: context.preview,
      baseSnapshot: context.snapshot,
      openInstanceId: context.openInstanceId,
      api: {
        createCharacterFromParts: vi.fn(),
        getCharacterCreateStatus: async () => ({
          ok: true,
          status: 'COMMITTED',
          result: committedResult,
        }),
      },
      store: staleStore,
    });

    expect(status).toMatchObject({ ok: true, status: 'COMMITTED' });
    expect(status.ok && status.status === 'COMMITTED' ? status.result : null)
      .not.toHaveProperty('project');
    expect(acquireProjectOperationLease).not.toHaveBeenCalled();
    expect(acceptSavedProjectCommand).not.toHaveBeenCalled();
    expect(releaseProjectOperationLease).not.toHaveBeenCalled();
  });
});
