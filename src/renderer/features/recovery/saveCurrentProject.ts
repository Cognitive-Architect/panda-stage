import type {
  ProjectOperationResponse,
  ProjectSaveRequest,
} from '../../../shared/project-api';
import {
  EditorProjectStore,
  type SaveAcknowledgement,
} from '../../stores/EditorProjectStore';

export interface ProjectSaveApi {
  save(request: ProjectSaveRequest): Promise<ProjectOperationResponse>;
}

export type EditorProjectSaveResult =
  | {
      ok: true;
      value: Extract<ProjectOperationResponse, { ok: true }>['value'];
      savedRevision: number;
      acknowledgement: SaveAcknowledgement;
    }
  | {
      ok: false;
      error: Extract<ProjectOperationResponse, { ok: false }>['error'];
      savedRevision: number;
    };

export async function saveCurrentProject(
  api: ProjectSaveApi,
  store: EditorProjectStore,
): Promise<EditorProjectSaveResult> {
  const snapshot = store.getSnapshot();
  if (!snapshot) throw new Error('No project is open.');
  if (!snapshot.dirty) throw new Error('The current project is clean.');
  const savedRevision = snapshot.revision;
  const response = await api.save({
    projectRoot: snapshot.projectRoot,
    project: snapshot.project,
    revision: savedRevision,
  });
  if (!response.ok) {
    return {
      ...response,
      savedRevision,
    };
  }
  return {
    ...response,
    savedRevision,
    acknowledgement: store.markSaved(
      response.value.project,
      savedRevision,
    ),
  };
}
