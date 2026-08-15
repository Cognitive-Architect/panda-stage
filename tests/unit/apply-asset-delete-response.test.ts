import { describe, expect, it } from 'vitest';
import { ProjectSchema, migrateProject } from '../../src/domain';
import { applyAssetDeleteResponse } from '../../src/renderer/features/assets/applyAssetDeleteResponse';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import {
  AssetDeleteResponseSchema,
  type AssetDeleteResponse,
} from '../../src/shared/asset-delete-api';
import exampleProject from '../../demo-project/project-v1.example.json';

const projectRoot = 'D:\\project.pandastage';
const unreferencedAssetId =
  '18000000-0000-4000-8000-000000000001';

function projectWithUnusedAsset() {
  return migrateProject({
    ...exampleProject,
    assets: [
      ...exampleProject.assets,
      {
        id: unreferencedAssetId,
        name: 'Unused',
        relativePath: 'assets/unused.png',
        mimeType: 'image/png',
        kind: 'image',
        width: 16,
        height: 12,
      },
    ],
  });
}

describe('applyAssetDeleteResponse', () => {
  it('keeps the Renderer store byte-equivalent when Main blocks a reference', () => {
    const store = new EditorProjectStore();
    const project = projectWithUnusedAsset();
    store.open(projectRoot, project);
    store.updateProject({ ...project, name: 'Keep this dirty edit' });
    const before = structuredClone(store.getSnapshot());
    const response: AssetDeleteResponse =
      AssetDeleteResponseSchema.parse({
        ok: false,
        error: {
          code: 'ASSET_DELETE_REFERENCED',
          message: '素材仍被引用。',
          projectRoot,
          assetId: unreferencedAssetId,
          references: [
            {
              kind: 'shot-layer',
              label: '镜头“Opening”的图层“Overlay”',
              path: 'shots[0].layers[1].source.assetId',
            },
          ],
        },
      });

    const outcome = applyAssetDeleteResponse(response, store);

    expect(outcome).toMatchObject({
      applied: false,
      status: '素材仍被引用。',
      references: [{ label: '镜头“Opening”的图层“Overlay”' }],
    });
    expect(store.getSnapshot()).toEqual(before);
  });

  it('merges a successful delete without losing a newer unrelated edit', () => {
    const store = new EditorProjectStore();
    const project = projectWithUnusedAsset();
    store.open(projectRoot, project);
    const savedProject = ProjectSchema.parse({
      ...project,
      assets: project.assets.filter(
        (asset) => asset.id !== unreferencedAssetId,
      ),
    });
    store.updateProject({ ...project, name: 'Newer unrelated edit' });

    const outcome = applyAssetDeleteResponse(
      AssetDeleteResponseSchema.parse({
        ok: true,
        project: savedProject,
        baseRevision: 0,
        savedRevision: 1,
        deletedAssetId: unreferencedAssetId,
        cleanupResidualPaths: [],
      }),
      store,
    );

    expect(outcome.applied).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 2,
      project: { name: 'Newer unrelated edit' },
    });
    expect(
      store
        .getSnapshot()!
        .project.assets.some(
          (asset) => asset.id === unreferencedAssetId,
        ),
    ).toBe(false);
  });
});
