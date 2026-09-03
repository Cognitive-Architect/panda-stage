import { describe, expect, it } from 'vitest';
import { migrateProject, ProjectSchema } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { applyFlaFrameSequenceCommitResponse } from '../../src/renderer/features/assets/applyFlaFrameSequenceCommitResponse';
import { FlaFrameSequenceCommitResponseSchema } from '../../src/shared/fla-frame-sequence-api';
import exampleProject from '../../demo-project/project-v1.example.json';

const project = migrateProject(exampleProject);

const existingAsset = {
  id: '00000000-0000-4000-8000-000000000257',
  kind: 'image' as const,
  name: 'existing frame',
  relativePath: 'assets/existing-frame.png',
  mimeType: 'image/png',
  sha256: 'a'.repeat(64),
  width: 320,
  height: 240,
};

const importedAssetA = {
  id: '00000000-0000-4000-8000-000000000258',
  kind: 'image' as const,
  name: 'sequence frame 0000',
  relativePath: 'assets/sequence-frame-0000.png',
  mimeType: 'image/png',
  sha256: 'b'.repeat(64),
  width: 320,
  height: 240,
};

const importedAssetB = {
  id: '00000000-0000-4000-8000-000000000259',
  kind: 'image' as const,
  name: 'sequence frame 0001',
  relativePath: 'assets/sequence-frame-0001.png',
  mimeType: 'image/png',
  sha256: 'c'.repeat(64),
  width: 320,
  height: 240,
};

function item(
  frameIndex: number,
  asset: typeof existingAsset,
  status: 'imported' | 'duplicate',
) {
  return {
    frameIndex,
    sequenceOrdinal: frameIndex,
    assetId: asset.id,
    sourceName: 'walk.fla',
    width: asset.width,
    height: asset.height,
    sha256: asset.sha256,
    status,
    asset,
    duplicateOfAssetId: status === 'duplicate' ? asset.id : null,
    targetFileName: asset.relativePath.split('/').pop()!,
    renamed: false,
    message: status === 'duplicate' ? 'Reused existing asset.' : 'Imported frame.',
  };
}

function response({
  savedProject,
  baseRevision,
  savedRevision,
  items,
  projectChanged,
}: {
  savedProject: typeof project;
  baseRevision: number;
  savedRevision: number;
  items: ReturnType<typeof item>[];
  projectChanged: boolean;
}) {
  return FlaFrameSequenceCommitResponseSchema.parse({
    ok: true,
    status: 'completed',
    project: savedProject,
    baseRevision,
    savedRevision,
    projectChanged,
    result: {
      items,
      summary: {
        requestedFrameCount: items.length,
        importedCount: items.filter((entry) => entry.status === 'imported').length,
        duplicateCount: items.filter((entry) => entry.status === 'duplicate').length,
        renamedCount: 0,
        netNewImageAssetCount: items.filter((entry) => entry.status === 'imported').length,
      },
    },
  });
}

describe('applyFlaFrameSequenceCommitResponse', () => {
  it('applies two new ImageAssets and advances the store to savedRevision', () => {
    const store = new EditorProjectStore();
    store.open('D:\\sequence.pandastage', project);
    const savedProject = ProjectSchema.parse({
      ...project,
      assets: [...project.assets, importedAssetA, importedAssetB],
    });

    const outcome = applyFlaFrameSequenceCommitResponse(
      response({
        savedProject,
        baseRevision: 0,
        savedRevision: 1,
        items: [item(0, importedAssetA, 'imported'), item(1, importedAssetB, 'imported')],
        projectChanged: true,
      }),
      store,
    );

    expect(outcome.applied).toBe(true);
    expect(outcome.results).toHaveLength(2);
    expect(outcome.status).toContain('新增 2 帧');
    expect(store.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 1,
      project: {
        assets: expect.arrayContaining([
          expect.objectContaining({ id: importedAssetA.id }),
          expect.objectContaining({ id: importedAssetB.id }),
        ]),
      },
    });
    expect(store.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
  });

  it('adds only the imported asset while preserving deterministic duplicate mapping', () => {
    const initialProject = ProjectSchema.parse({
      ...project,
      assets: [...project.assets, existingAsset],
    });
    const savedProject = ProjectSchema.parse({
      ...initialProject,
      assets: [...initialProject.assets, importedAssetA],
    });
    const store = new EditorProjectStore();
    store.open('D:\\sequence.pandastage', initialProject);

    const outcome = applyFlaFrameSequenceCommitResponse(
      response({
        savedProject,
        baseRevision: 0,
        savedRevision: 1,
        items: [item(0, existingAsset, 'duplicate'), item(1, importedAssetA, 'imported')],
        projectChanged: true,
      }),
      store,
    );

    const snapshot = store.getSnapshot()!;
    expect(outcome.applied).toBe(true);
    expect(outcome.status).toContain('复用已有素材 1 帧');
    expect(outcome.results?.[0]).toMatchObject({
      frameIndex: 0,
      status: 'duplicate',
      assetId: existingAsset.id,
    });
    expect(snapshot.project.assets.filter((asset) => asset.id === existingAsset.id)).toHaveLength(1);
    expect(snapshot.project.assets.some((asset) => asset.id === importedAssetA.id)).toBe(true);
    expect(snapshot.dirty).toBe(false);
  });

  it('keeps duplicate-only commits truthful without fabricating assets or dirty state', () => {
    const initialProject = ProjectSchema.parse({
      ...project,
      assets: [...project.assets, existingAsset],
    });
    const store = new EditorProjectStore();
    store.open('D:\\sequence.pandastage', initialProject);

    const outcome = applyFlaFrameSequenceCommitResponse(
      response({
        savedProject: initialProject,
        baseRevision: 0,
        savedRevision: 1,
        items: [item(0, existingAsset, 'duplicate')],
        projectChanged: false,
      }),
      store,
    );

    const snapshot = store.getSnapshot()!;
    expect(outcome.applied).toBe(false);
    expect(outcome.status).toBe('帧序列已处理：复用已有素材 1 帧；共处理 1 帧。');
    expect(snapshot.dirty).toBe(false);
    expect(snapshot.revision).toBe(1);
    expect(snapshot.project.assets).toHaveLength(initialProject.assets.length);
    expect(snapshot.project.assets.some((asset) => asset.id === importedAssetA.id)).toBe(false);
  });

  it('lets a subsequent sequence commit use the refreshed saved revision', () => {
    const store = new EditorProjectStore();
    store.open('D:\\sequence.pandastage', project);
    const firstProject = ProjectSchema.parse({
      ...project,
      assets: [...project.assets, importedAssetA],
    });
    const secondProject = ProjectSchema.parse({
      ...firstProject,
      assets: [...firstProject.assets, importedAssetB],
    });

    applyFlaFrameSequenceCommitResponse(
      response({
        savedProject: firstProject,
        baseRevision: 0,
        savedRevision: 1,
        items: [item(0, importedAssetA, 'imported')],
        projectChanged: true,
      }),
      store,
    );
    expect(store.getSnapshot()?.revision).toBe(1);

    expect(() =>
      applyFlaFrameSequenceCommitResponse(
        response({
          savedProject: secondProject,
          baseRevision: 1,
          savedRevision: 2,
          items: [item(1, importedAssetB, 'imported')],
          projectChanged: true,
        }),
        store,
      ),
    ).not.toThrow();
    expect(store.getSnapshot()).toMatchObject({ revision: 2, dirty: false });
  });
});
