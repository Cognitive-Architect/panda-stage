import { describe, expect, it } from 'vitest';
import { migrateProject } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { applyFlaAssetCommitResponse } from '../../src/renderer/features/assets/applyFlaAssetCommitResponse';
import { FlaAssetCommitResponseSchema } from '../../src/shared/fla-asset-commit-api';
import exampleProject from '../../demo-project/project-v1.example.json';

const project = migrateProject(exampleProject);
const imageAsset = {
  id: '00000000-0000-4000-8000-000000000257',
  kind: 'image' as const,
  name: 'a1',
  relativePath: 'assets/a1.png',
  mimeType: 'image/png',
  sha256: 'a'.repeat(64),
  width: 320,
  height: 240,
};
const savedProject = {
  ...project,
  assets: [...project.assets, imageAsset],
};

function importedResponse() {
  return FlaAssetCommitResponseSchema.parse({
    ok: true,
    status: 'completed',
    project: savedProject,
    baseRevision: 0,
    savedRevision: 1,
    projectChanged: true,
    results: [
      {
        mediaId: 'fla-media-contract-0001',
        sourceName: 'a1.jpg',
        sourceFormat: 'jpg',
        width: 320,
        height: 240,
        status: 'imported',
        sha256: 'a'.repeat(64),
        asset: imageAsset,
        duplicateOfAssetId: null,
        targetFileName: 'a1.png',
        renamed: false,
        message: 'Imported a1.jpg as a1.png.',
      },
    ],
    summary: {
      selectedCount: 1,
      importedCount: 1,
      duplicateCount: 0,
      renamedCount: 0,
    },
  });
}

describe('applyFlaAssetCommitResponse', () => {
  it('applies a successful batch as one saved revision with no history entries', () => {
    const store = new EditorProjectStore();
    store.open('D:\\project.pandastage', project);

    const outcome = applyFlaAssetCommitResponse(importedResponse(), store);
    const snapshot = store.getSnapshot();

    expect(outcome.applied).toBe(true);
    expect(outcome.results).toHaveLength(1);
    expect(snapshot).toMatchObject({
      dirty: false,
      revision: 1,
      project: { assets: expect.arrayContaining([imageAsset]) },
    });
    expect(store.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
  });

  it('does not mutate the editor for a duplicate-only acknowledgement', () => {
    const duplicateProject = savedProject;
    const store = new EditorProjectStore();
    store.open('D:\\project.pandastage', duplicateProject);
    const before = structuredClone(store.getSnapshot());

    const response = FlaAssetCommitResponseSchema.parse({
      ok: true,
      status: 'completed',
      project: duplicateProject,
      baseRevision: 0,
      savedRevision: 0,
      projectChanged: false,
      results: [
        {
          mediaId: 'fla-media-contract-0001',
          sourceName: 'a1.jpg',
          sourceFormat: 'jpg',
          width: 320,
          height: 240,
          status: 'duplicate',
          sha256: imageAsset.sha256,
          asset: imageAsset,
          duplicateOfAssetId: imageAsset.id,
          targetFileName: 'a1.png',
          renamed: false,
          message: 'Reused existing Asset a1.png.',
        },
      ],
      summary: {
        selectedCount: 1,
        importedCount: 0,
        duplicateCount: 1,
        renamedCount: 0,
      },
    });

    const outcome = applyFlaAssetCommitResponse(response, store);

    expect(outcome.applied).toBe(false);
    expect(store.getSnapshot()).toEqual(before);
  });
});
