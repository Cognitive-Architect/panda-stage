import type { FlaPartPreviewResponse } from '../../../shared/fla-part-preview-api';
import type {
  FlaCharacterCreateRequest,
  FlaCharacterCreateResponse,
  FlaCharacterCreateResult,
  FlaCharacterCreateStatusRequest,
  FlaCharacterCreateStatusResponse,
  FlaCharacterCreateOutcome,
  FlaCharacterCreateErrorCode,
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

export class FlaCharacterCreateOperationError extends Error {
  public constructor(
    message: string,
    public readonly code?: FlaCharacterCreateErrorCode,
  ) {
    super(message);
    this.name = 'FlaCharacterCreateOperationError';
  }
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

export interface QueryFlaCharacterCreateStatusOptions {
  operationId: string;
  preview: EditablePartPreview;
  baseSnapshot: EditorProjectSnapshot;
  openInstanceId: number;
  api: FlaCharacterCreateApi;
  store?: EditorProjectStore;
}

function matchesOperationIdentity(
  result: FlaCharacterCreateOutcome,
  operationId: string,
  snapshot: EditorProjectSnapshot,
  openInstanceId: number,
  preview: EditablePartPreview,
): boolean {
  return result.operationId === operationId &&
    result.projectRoot === snapshot.projectRoot &&
    result.projectId === snapshot.project.id &&
    result.openInstanceId === openInstanceId &&
    result.baseRevision === snapshot.revision &&
    result.savedRevision === snapshot.revision + 1 &&
    result.identity.planId === preview.planId &&
    result.identity.poseIdentity === preview.poseIdentity;
}

function withoutProjectSnapshot(
  status: Extract<FlaCharacterCreateStatusResponse, { status: 'COMMITTED' }>,
): Extract<FlaCharacterCreateStatusResponse, { status: 'COMMITTED' }> {
  if (!hasProjectSnapshot(status.result)) return status;
  const { project, ...identity } = status.result;
  void project;
  return { ...status, result: identity };
}

export async function queryFlaCharacterCreateStatus(
  options: QueryFlaCharacterCreateStatusOptions,
): Promise<FlaCharacterCreateStatusResponse> {
  const store = options.store ?? editorProjectStore;
  const { baseSnapshot, openInstanceId, operationId, preview } = options;
  const current = store.getSnapshot();
  let lease: ReturnType<EditorProjectStore['acquireProjectOperationLease']> | null = null;
  if (
    current &&
    current.projectRoot === baseSnapshot.projectRoot &&
    current.project.id === baseSnapshot.project.id &&
    current.revision === baseSnapshot.revision &&
    JSON.stringify(current.project) === JSON.stringify(baseSnapshot.project) &&
    store.getProjectInstanceId() === openInstanceId
  ) {
    try {
      lease = store.acquireProjectOperationLease({
        projectRoot: baseSnapshot.projectRoot,
        projectId: baseSnapshot.project.id,
        revision: baseSnapshot.revision,
        openInstanceId,
      });
    } catch {
      // Status remains useful when another operation or a changed snapshot
      // prevents safely applying the committed Project result.
    }
  }

  try {
    const status = await options.api.getCharacterCreateStatus({
      format: 'panda-fla-character-create-status',
      version: 1,
      operationId,
      projectRoot: baseSnapshot.projectRoot,
      projectId: baseSnapshot.project.id,
    });
    if (
      status.ok &&
      status.status !== 'COMMITTED' &&
      status.operationId !== operationId
    ) {
      throw new FlaCharacterCreateOperationError(
        'The status receipt does not match this operation.',
        'OPERATION_ID_CONFLICT',
      );
    }
    if (!status.ok || status.status !== 'COMMITTED') return status;
    if (!matchesOperationIdentity(
      status.result,
      operationId,
      baseSnapshot,
      openInstanceId,
      preview,
    )) {
      throw new FlaCharacterCreateOperationError(
        'The saved result does not match this Project, operation, or confirmed FLA plan.',
        'OPERATION_ID_CONFLICT',
      );
    }
    if (!hasProjectSnapshot(status.result)) return status;

    if (lease) {
      const currentProject = store.getSnapshot()?.project;
      if (currentProject && JSON.stringify(currentProject) !== JSON.stringify(status.result.project)) {
        store.acceptSavedProjectCommand(
          lease,
          status.result.project,
          status.result.savedRevision,
          '导入角色',
        );
        return status;
      }
      return withoutProjectSnapshot(status);
    }

    const currentAfterQuery = store.getSnapshot();
    if (
      currentAfterQuery &&
      currentAfterQuery.projectRoot === baseSnapshot.projectRoot &&
      currentAfterQuery.project.id === baseSnapshot.project.id &&
      currentAfterQuery.revision === status.result.savedRevision &&
      store.getProjectInstanceId() === openInstanceId &&
      JSON.stringify(currentAfterQuery.project) === JSON.stringify(status.result.project)
    ) {
      return status;
    }
    return withoutProjectSnapshot(status);
  } finally {
    if (lease) store.releaseProjectOperationLease(lease);
  }
}

export async function createCharacterFromPreparedParts(
  options: CreateCharacterFromPreparedPartsOptions,
): Promise<FlaCharacterCreateOutcome> {
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
        else throw new FlaCharacterCreateOperationError(
          status.message ?? 'The Character operation is still running; query its status before retrying.',
          'OPERATION_IN_PROGRESS',
        );
      } else if (status.ok && status.status === 'RECOVERY_REQUIRED') {
        throw new FlaCharacterCreateOperationError(
          status.message ?? 'The Character operation needs recovery before it can be retried.',
          'RECOVERY_REQUIRED',
        );
      } else if (status.ok && status.status === 'FAILED') {
        throw new FlaCharacterCreateOperationError(status.error.message, status.error.code);
      } else if (status.ok && status.status === 'NOT_FOUND') {
        const errorMessage = response && !response.ok
          ? response.error.message
          : 'The Main Process has no receipt for the confirmed Character operation.';
        throw new FlaCharacterCreateOperationError(
          errorMessage,
          response && !response.ok ? response.error.code : undefined,
        );
      } else {
        throw new FlaCharacterCreateOperationError(
          status.ok ? 'The Character operation status is unavailable.' : status.error.message,
          status.ok ? undefined : status.error.code,
        );
      }
    }

    if (!matchesOperationIdentity(
      result,
      operationId,
      snapshot,
      openInstanceId,
      options.preview,
    )) {
      throw new FlaCharacterCreateOperationError(
        'The Main Process result does not match this Project, operation, or confirmed FLA plan.',
        'OPERATION_ID_CONFLICT',
      );
    }

    if (!hasProjectSnapshot(result)) {
      // The commit is confirmed, but the renderer cannot safely accept an
      // identity-only receipt over its current Project snapshot. Return the
      // exact identity so the UI can report the saved Character without
      // retrying the commit or replacing newer renderer state.
      return result;
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
