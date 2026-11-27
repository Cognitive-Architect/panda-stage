import type {
  ProjectResourceImportApplyRequest,
  ProjectResourceImportApplyResponse,
  ProjectResourceImportSelection,
} from '../../../shared/project-resource-import-api';
import {
  editorProjectStore,
  type EditorProjectStore,
} from '../../stores/EditorProjectStore';

export interface ProjectResourceImportApi {
  apply(
    request: ProjectResourceImportApplyRequest,
  ): Promise<ProjectResourceImportApplyResponse>;
}

export type CrossProjectResourceImportCommitResult =
  | {
      ok: true;
      sourceProjectName: string;
      importedCharacterCount: number;
      importedAnimationCount: number;
      importedAssetCount: number;
      reusedAssetCount: number;
    }
  | {
      ok: false;
      message: string;
    };

export async function commitCrossProjectResourceImport(options: {
  sourceToken: string;
  resources: readonly ProjectResourceImportSelection[];
  reuseIdenticalAssets: boolean;
  api?: ProjectResourceImportApi;
  store?: EditorProjectStore;
}): Promise<CrossProjectResourceImportCommitResult> {
  const store = options.store ?? editorProjectStore;
  const api = options.api ?? window.pandaStage.projectResourceImport;
  const snapshot = store.getSnapshot();
  const openInstanceId = store.getProjectInstanceId();
  if (!snapshot || openInstanceId === null) {
    return { ok: false, message: '请先打开目标项目。' };
  }

  const lease = store.acquireProjectOperationLease({
    projectRoot: snapshot.projectRoot,
    projectId: snapshot.project.id,
    revision: snapshot.revision,
    openInstanceId,
  });

  try {
    const response = await api.apply({
      projectRoot: snapshot.projectRoot,
      project: snapshot.project,
      baseRevision: snapshot.revision,
      openInstanceId,
      sourceToken: options.sourceToken,
      resources: [...options.resources],
      reuseIdenticalAssets: options.reuseIdenticalAssets,
    });
    if (!response.ok) {
      return { ok: false, message: response.error.message };
    }
    if (
      response.projectRoot !== lease.projectRoot ||
      response.projectId !== lease.projectId ||
      response.baseRevision !== lease.revision
    ) {
      return {
        ok: false,
        message: '导入结果与当前打开的项目会话不匹配，请重试。',
      };
    }
    store.acceptSavedProjectCommand(
      lease,
      response.project,
      response.savedRevision,
      '从其他工程导入素材',
    );
    return {
      ok: true,
      sourceProjectName: response.sourceProjectName,
      importedCharacterCount: response.importedCharacters.length,
      importedAnimationCount: response.importedAnimations.length,
      importedAssetCount: response.importedAssets.length,
      reusedAssetCount: response.reusedAssetIds.length,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '跨项目导入失败。',
    };
  } finally {
    store.releaseProjectOperationLease(lease);
  }
}
