import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import { applyAssetImportResponse } from '../../src/renderer/features/assets/applyAssetImportResponse';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import {
  AssetImportResponseSchema,
  type AssetImportResponse,
} from '../../src/shared/asset-import-api';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('applyAssetImportResponse', () => {
  it('does not change dirty editor state for a stale response', () => {
    const store = new EditorProjectStore();
    const project = ProjectSchema.parse(exampleProject);
    store.open('D:\\project.pandastage', project);
    store.updateProject({ ...project, name: 'Newer unsaved edit' });
    const before = structuredClone(store.getSnapshot());
    const response: AssetImportResponse =
      AssetImportResponseSchema.parse({
        ok: false,
        error: {
          code: 'ASSET_IMPORT_STALE_REVISION',
          message:
            'Asset import is stale. Refresh the project snapshot and retry.',
          projectRoot: 'D:\\project.pandastage',
          currentProject: project,
          currentRevision: 0,
        },
      });

    const outcome = applyAssetImportResponse(response, store);

    expect(outcome.status).toContain('Refresh');
    expect(outcome.results).toBeNull();
    expect(store.getSnapshot()).toEqual(before);
    expect(store.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 1,
      project: { name: 'Newer unsaved edit' },
    });
  });

  it('preserves the store and shows exact residual paths for cleanup failure', () => {
    const store = new EditorProjectStore();
    const project = ProjectSchema.parse(exampleProject);
    store.open('D:\\project.pandastage', project);
    store.updateProject({ ...project, name: 'Keep this dirty edit' });
    const before = structuredClone(store.getSnapshot());
    const targetPath =
      'D:\\project.pandastage\\assets\\residual.png';
    const temporaryPath =
      'D:\\project.pandastage\\assets\\.asset-import.123.tmp';
    const response: AssetImportResponse =
      AssetImportResponseSchema.parse({
        ok: false,
        error: {
          code: 'ASSET_IMPORT_ROLLBACK_FAILED',
          message: 'Internal cleanup failed.',
          projectRoot: 'D:\\project.pandastage',
          residualPaths: [targetPath, temporaryPath],
        },
      });

    const outcome = applyAssetImportResponse(response, store);

    expect(outcome.status).toContain('导入清理未完成');
    expect(outcome.status).not.toContain('复制失败');
    expect(outcome.status).toContain(targetPath);
    expect(outcome.status).toContain(temporaryPath);
    expect(outcome.results).toBeNull();
    expect(store.getSnapshot()).toEqual(before);
  });
});
