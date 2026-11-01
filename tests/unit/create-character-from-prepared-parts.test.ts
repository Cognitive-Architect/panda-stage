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
import { createCharacterFromPreparedParts } from '../../src/renderer/features/fla-import/createCharacterFromPreparedParts';

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
  const acceptSavedProjectCommand = vi.fn();
  const releaseProjectOperationLease = vi.fn();
  const store = {
    getSnapshot: () => snapshot,
    getProjectInstanceId: () => openInstanceId,
    acquireProjectOperationLease: vi.fn(() => lease),
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
    preview,
    result,
    store,
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
});
