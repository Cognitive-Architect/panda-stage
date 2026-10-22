import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  updateImageAssetAuthorMetadata,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProject, IDS } from './domain/testProject';

function projectWithSourceMetadata() {
  const project = buildProject();
  return ProjectSchema.parse({
    ...project,
    assets: project.assets.map((asset) =>
      asset.id === IDS.assetBg && asset.kind === 'image'
        ? {
            ...asset,
            sha256: 'a'.repeat(64),
            metadata: { status: 'ready', warnings: [] },
            flaSnapshot: {
              sourceBasename: 'doors.fla',
              sourceSha256: 'b'.repeat(64),
              targetName: 'DoorClosed',
              sourceLibraryItemName: 'DoorClosed',
              renderTargetId: 'target-door-closed',
              selectedFrameIndex: 2,
              previewSha256: 'c'.repeat(64),
            },
          }
        : asset,
    ),
  });
}

describe('image author metadata', () => {
  it('commits one atomic project edit and replays it as one undo/redo step', () => {
    const project = projectWithSourceMetadata();
    const original = project.assets.find((asset) => asset.id === IDS.assetBg)!;
    const store = new EditorProjectStore();
    store.open('D:\\asset-metadata.pandastage', project);

    const edited = updateImageAssetAuthorMetadata(
      project,
      IDS.assetBg,
      {
        name: '  木门·关闭  ',
        usage: 'prop',
        keywords: [' 门 ', '关闭', '门', '  '],
      },
      () => new Date('2026-10-22T04:00:00.000Z'),
    );
    store.updateProject(edited, 'Edit image asset details');

    const updatedAsset = store.getSnapshot()!.project.assets.find(
      (asset) => asset.id === IDS.assetBg,
    )!;
    expect(store.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(store.getSnapshot()!.project.updatedAt).toBe(
      '2026-10-22T04:00:00.000Z',
    );
    expect(store.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    expect(updatedAsset).toMatchObject({
      id: original.id,
      name: '木门·关闭',
      usage: 'prop',
      keywords: ['门', '关闭'],
      relativePath: original.relativePath,
      sha256: 'a'.repeat(64),
      metadata: { status: 'ready', warnings: [] },
      flaSnapshot: {
        sourceBasename: 'doors.fla',
        sourceSha256: 'b'.repeat(64),
        targetName: 'DoorClosed',
        sourceLibraryItemName: 'DoorClosed',
        renderTargetId: 'target-door-closed',
        selectedFrameIndex: 2,
        previewSha256: 'c'.repeat(64),
      },
    });
    expect(store.getSnapshot()!.project.characters).toEqual(project.characters);
    expect(store.getSnapshot()!.project.shots).toEqual(project.shots);

    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()!.project.assets.find(
      (asset) => asset.id === IDS.assetBg,
    )).toEqual(original);
    expect(store.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 1,
    });

    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()!.project.assets.find(
      (asset) => asset.id === IDS.assetBg,
    )).toEqual(updatedAsset);
    expect(store.getSnapshot()).toMatchObject({ revision: 3, dirty: true });
  });

  it('keeps no-op and invalid edits out of revision, dirty state, and history', () => {
    const project = buildProject();
    const store = new EditorProjectStore();
    store.open('D:\\asset-metadata.pandastage', project);

    store.updateProject(
      updateImageAssetAuthorMetadata(project, IDS.assetBg, {
        name: project.assets[0]!.name,
        usage: 'uncategorized',
        keywords: [],
      }),
      'Edit image asset details',
    );
    expect(store.getSnapshot()).toMatchObject({ revision: 0, dirty: false });
    expect(store.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });

    for (const metadata of [
      { name: '   ', usage: 'prop', keywords: [] },
      { name: 'x'.repeat(201), usage: 'prop', keywords: [] },
      { name: 'Door', usage: 'prop', keywords: Array.from({ length: 9 }, (_, index) => `k${index}`) },
      { name: 'Door', usage: 'prop', keywords: ['x'.repeat(33)] },
    ]) {
      expect(() =>
        updateImageAssetAuthorMetadata(
          project,
          IDS.assetBg,
          metadata as never,
        ),
      ).toThrow();
    }
    expect(store.getSnapshot()).toMatchObject({ revision: 0, dirty: false });
    expect(store.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
  });

  it('normalizes case-insensitive duplicate keywords without changing image identity', () => {
    const project = buildProject();
    const updated = updateImageAssetAuthorMetadata(
      project,
      IDS.assetBg,
      {
        name: '背景',
        usage: 'prop',
        keywords: ['Door', ' door ', '門', ' 門 '],
      },
      () => new Date('2026-10-22T04:00:00.000Z'),
    );
    const asset = updated.assets.find((candidate) => candidate.id === IDS.assetBg)!;

    expect(asset).toMatchObject({
      id: IDS.assetBg,
      relativePath: 'bg.png',
      usage: 'prop',
      keywords: ['Door', '門'],
    });
  });

  it('rejects editing audio metadata through the image authoring operation', () => {
    const project = ProjectSchema.parse({
      ...buildProject(),
      assets: [
        ...buildProject().assets,
        {
          id: '70000000-0000-4000-8000-000000000001',
          kind: 'audio',
          name: 'Room tone',
          relativePath: 'assets/room.wav',
          mimeType: 'audio/wav',
        },
      ],
    });
    expect(() =>
      updateImageAssetAuthorMetadata(
        project,
        '70000000-0000-4000-8000-000000000001',
        { name: 'Sound', usage: 'prop', keywords: [] },
      ),
    ).toThrow('Only image assets have an author-defined usage.');
  });
});
