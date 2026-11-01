import type { FlaPartPreviewResponse } from '../../../shared/fla-part-preview-api';
import type {
  FlaCharacterCreateRequest,
  FlaCharacterCreateResponse,
  FlaCharacterCreateResult,
  FlaCharacterCreateStatusRequest,
  FlaCharacterCreateStatusResponse,
  FlaCharacterCreateOutcome,
} from '../../../shared/fla-character-create-api';
import {
  EditorProjectStore,
  editorProjectStore,
  type EditorProjectSnapshot,
} from '../../stores/EditorProjectStore';

type EditablePartPreview = Extract<
  FlaPartPreviewResponse,
  { ok: true; status: 'PREVIEW_READY'; capability: 'EDITABLE_PARTS_READY' }
>;

function hasProjectSnapshot(result: FlaCharacterCreateOutcome): result is FlaCharacterCreateResult {
  return Object.prototype.hasOwnProperty.call(result, 'project');
}

export interface FlaCharacterCreateApi {
  createCharacterFromParts(request: FlaCharacterCreateRequest): Promise<FlaCharacterCreateResponse>;
  getCharacterCreateStatus(request: FlaCharacterCreateStatusRequest): Promise<FlaCharacterCreateStatusResponse>;
}

export interface CreateCharacterFromPreparedPartsOptions {
  preview: EditablePartPreview;
  name: string;
  api: FlaCharacterCreateApi;
  store?: EditorProjectStore;
  operationId?: string;
  ensureMainSnapshot?: (snapshot: EditorProjectSnapshot) => Promise<void>;
}

export async function createCharacterFromPreparedParts(
  options: CreateCharacterFromPreparedPartsOptions,
): Promise<FlaCharacterCreateResult> {
  const store = options.store ?? editorProjectStore;
  const snapshot = store.getSnapshot();
  const openInstanceId = store.getProjectInstanceId();
  if (!snapshot || openInstanceId === null) {
    throw new Error('Open a Project before creating a Character from FLA Parts.');
  }
  if (!options.preview.ok || options.preview.capability !== 'EDITABLE_PARTS_READY') {
    throw new Error('Only an explicitly confirmed editable FLA Part plan can create a Character.');
  }
  if (!options.preview.sessionId || !options.preview.requestId || !options.preview.generation) {
    throw new Error('The confirmed FLA Part preview is missing its session identity.');
  }
  const operationId = options.operationId ?? crypto.randomUUID();
  const lease = store.acquireProjectOperationLease({
    projectRoot: snapshot.projectRoot,
    projectId: snapshot.project.id,
    revision: snapshot.revision,
    openInstanceId,
  });
  const request: FlaCharacterCreateRequest = {
    format: 'panda-fla-character-create',
    version: 1,
    operationId,
    projectRoot: snapshot.projectRoot,
    projectId: snapshot.project.id,
    baseRevision: snapshot.revision,
    openInstanceId,
    name: options.name,
    confirmation: {
      confirmed: true,
      capability: 'EDITABLE_PARTS_READY',
      planId: options.preview.planId,
      sessionId: options.preview.sessionId,
      requestId: options.preview.requestId,
      generation: options.preview.generation,
      poseIdentity: options.preview.poseIdentity,
      target: {
        renderTargetId: options.preview.target.renderTargetId,
        selectedFrameIndex: options.preview.target.selectedFrameIndex,
      },
    },
  };
  const statusRequest: FlaCharacterCreateStatusRequest = {
    format: 'panda-fla-character-create-status',
    version: 1,
    operationId,
    projectRoot: snapshot.projectRoot,
    projectId: snapshot.project.id,
  };

  try {
    await options.ensureMainSnapshot?.(snapshot);
    const response = await options.api.createCharacterFromParts(request).catch(() => null);
    let result = response?.ok ? response.result : null;
    if (!result) {
      const status = await options.api.getCharacterCreateStatus(statusRequest);
      if (status.ok && status.status === 'COMMITTED') {
        result = status.result;
      } else if (status.ok && status.status === 'IN_PROGRESS') {
        const settled = await options.api.getCharacterCreateStatus(statusRequest);
        if (settled.ok && settled.status === 'COMMITTED') result = settled.result;
        else throw new Error(status.message ?? 'The Character operation is still running; query its status before retrying.');
      } else if (status.ok && status.status === 'RECOVERY_REQUIRED') {
        throw new Error(status.message ?? 'The Character operation needs recovery before it can be retried.');
      } else if (status.ok && status.status === 'FAILED') {
        throw new Error(status.error.message);
      } else if (status.ok && status.status === 'NOT_FOUND') {
        const errorMessage = response && !response.ok
          ? response.error.message
          : 'The Main Process has no receipt for the confirmed Character operation.';
        throw new Error(errorMessage);
      } else {
        throw new Error(status.ok ? 'The Character operation status is unavailable.' : status.error.message);
      }
    }

    if (!hasProjectSnapshot(result)) {
      throw new Error('This Character operation was already committed, but its saved Project snapshot is no longer current. Refresh the Project and inspect its Characters before retrying.');
    }

    if (
      result.projectRoot !== lease.projectRoot ||
      result.projectId !== lease.projectId ||
      result.openInstanceId !== lease.openInstanceId ||
      result.baseRevision !== lease.revision ||
      result.identity.planId !== options.preview.planId ||
      result.identity.poseIdentity !== options.preview.poseIdentity
    ) {
      throw new Error('The Main Process result does not match the confirmed Project and FLA Part plan.');
    }
    store.acceptSavedProjectCommand(lease, result.project, result.savedRevision, '导入角色');
    return result;
  } finally {
    store.releaseProjectOperationLease(lease);
  }
}
