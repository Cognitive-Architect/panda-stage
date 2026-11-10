import { describe, expect, it, vi } from 'vitest';
import {
  CharacterService,
  LayerService,
  PartPoseAnimationService,
  ProjectSchema,
  migrateProject,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './domain/testProject';

describe('EditorProjectStore', () => {
  it('exposes the last saved Project snapshot while newer edits remain dirty', () => {
    const store = new EditorProjectStore();
    const formalProject = migrateProject(exampleProject);
    store.open('D:\\project.pandastage', formalProject);

    store.updateProject({ ...formalProject, name: 'Unsaved edit' });
    expect(store.getSnapshot()).toMatchObject({ dirty: true });
    expect(store.getSavedProjectSnapshot()).toMatchObject({
      projectRoot: 'D:\\project.pandastage',
      project: { name: formalProject.name },
    });

    const savedEdit = { ...formalProject, name: 'Saved edit' };
    store.markSaved(savedEdit, 1);
    expect(store.getSavedProjectSnapshot()).toMatchObject({
      projectRoot: 'D:\\project.pandastage',
      project: { name: 'Saved edit' },
    });
  });

  it('is the single dirty source for open, restore, edit, and manual save', () => {
    const store = new EditorProjectStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const formalProject = migrateProject(exampleProject);

    store.open('D:\\project.pandastage', formalProject);
    expect(store.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });

    const recoveredProject = {
      ...formalProject,
      name: 'Recovered latest edit',
    };
    store.restore(recoveredProject);
    expect(store.getSnapshot()).toMatchObject({
      project: { name: 'Recovered latest edit' },
      dirty: true,
      revision: 1,
    });

    store.updateProject({
      ...recoveredProject,
      name: 'Edited again',
    });
    expect(store.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 2,
    });

    store.markSaved(store.getSnapshot()!.project, 2);
    expect(store.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 2,
    });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('increments a runtime project-instance identity only across open lifecycles', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);

    expect(store.getProjectInstanceId()).toBeNull();
    store.open('D:\\same-path.pandastage', project);
    const firstInstance = store.getProjectInstanceId();
    store.updateProject({ ...project, name: 'ordinary edit' });
    expect(store.getProjectInstanceId()).toBe(firstInstance);

    store.clear();
    expect(store.getProjectInstanceId()).toBeNull();
    store.open('D:\\same-path.pandastage', project);
    expect(store.getProjectInstanceId()).not.toBe(firstInstance);
  });

  it('marks the matching revision clean without moving revision backwards', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    store.open('D:\\project.pandastage', project);
    store.updateProject({ ...project, name: 'Revision 1' });
    store.updateProject({ ...project, name: 'Revision 2' });
    const savedProject = { ...project, name: 'Saved revision 2' };

    expect(store.markSaved(savedProject, 2)).toBe('current');
    expect(store.getSnapshot()).toMatchObject({
      project: { name: 'Saved revision 2' },
      dirty: false,
      revision: 2,
    });
  });

  it('keeps newer dirty edits when an older save acknowledgement arrives', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    store.open('D:\\project.pandastage', project);
    store.updateProject({ ...project, name: 'Revision 1' });
    const savedRevisionTwo = { ...project, name: 'Saved revision 2' };
    store.updateProject(savedRevisionTwo);
    store.updateProject({ ...project, name: 'Unsaved revision 3' });

    expect(store.markSaved(savedRevisionTwo, 2)).toBe('stale');
    expect(store.getSnapshot()).toMatchObject({
      project: { name: 'Unsaved revision 3' },
      dirty: true,
      revision: 3,
    });
  });

  it('rejects a save acknowledgement from a future revision', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    store.open('D:\\project.pandastage', project);
    store.updateProject({ ...project, name: 'Revision 1' });
    store.updateProject({ ...project, name: 'Revision 2' });
    const before = store.getSnapshot();

    expect(() => store.markSaved(project, 3)).toThrow(
      'Saved revision 3 is ahead of current editor revision 2.',
    );
    expect(store.getSnapshot()).toBe(before);
  });

  it('rejects replacing the open project with a different identity', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    store.open('D:\\project.pandastage', project);

    expect(() =>
      store.restore({
        ...project,
        id: '99000000-0000-4000-8000-000000000001',
      }),
    ).toThrow('identity mismatch');
  });

  it('cancels a command captured from a stale revision or reopened project session', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    const root = 'D:\\project.pandastage';
    store.open(root, project);
    const staleRevision = store.captureEditContext()!;
    store.updateProject({ ...project, name: 'Current revision' });
    const beforeRejectedWrite = store.getSnapshot();

    expect(() =>
      store.updateProjectAtContext(
        staleRevision,
        { ...project, name: 'Stale command' },
        'Stale command',
      ),
    ).toThrow('captured project session or revision is stale');
    expect(store.getSnapshot()).toBe(beforeRejectedWrite);
    expect(store.history.getSnapshot().undoCount).toBe(1);

    const staleSession = store.captureEditContext()!;
    store.open(root, project);
    expect(() =>
      store.updateProjectAtContext(
        staleSession,
        { ...project, name: 'Reopened stale command' },
        'Reopened stale command',
      ),
    ).toThrow('captured project session or revision is stale');
    expect(store.getSnapshot()).toMatchObject({
      project: { name: project.name },
      dirty: false,
      revision: 0,
    });
    expect(store.history.getSnapshot().undoCount).toBe(0);
  });

  it('checks asset references retained by both undo and redo project states', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    const character = project.characters[0]!;
    const assetId =
      character.mode === 'adaptive-parts'
        ? character.parts[0]!.assetId
        : character.baseAssetId;
    store.open('D:\\project.pandastage', project);
    expect(store.history.referencesAsset(assetId)).toBe(false);

    store.updateProject({ ...project, name: 'Project edit' }, 'Project edit');
    expect(store.history.referencesAsset(assetId)).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.history.referencesAsset(assetId)).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.history.referencesAsset(assetId)).toBe(true);

    store.open('D:\\project.pandastage', project);
    expect(store.history.referencesAsset(assetId)).toBe(false);
  });

  it('retains Part snapshot asset references while the current Project has cleared them', () => {
    const base = buildProject();
    const withCharacter = new CharacterService().createAdaptiveParts(base, {
      name: 'History pose Character',
      parts: adaptivePartsFixture(IDS.assetChar),
    });
    const character = withCharacter.characters.at(-1)!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const placed = new LayerService().createFromAdaptiveCharacter(
      withCharacter,
      IDS.shot,
      character.id,
      { x: 960, y: 540 },
    );
    const poses = new PartPoseAnimationService();
    const captured = poses.create(placed.project, {
      shotId: IDS.shot,
      layerId: placed.layer.id,
    });
    const assetId = captured.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation!.tracks[0]!.assetId;
    const cleared = poses.clearAnimation(captured, {
      shotId: IDS.shot,
      layerId: placed.layer.id,
    }).project;

    const store = new EditorProjectStore();
    store.open('D:\\history-pose.pandastage', captured);
    store.updateProject(cleared, 'Clear pose snapshot');
    expect(store.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation).toBeUndefined();
    expect(store.history.referencesAsset(assetId)).toBe(true);
    expect(store.history.referencesPoseSnapshotAsset(assetId)).toBe(true);

    expect(store.undo()).toBe(true);
    expect(store.history.referencesPoseSnapshotAsset(assetId)).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.history.referencesPoseSnapshotAsset(assetId)).toBe(true);

    store.open('D:\\history-pose.pandastage', cleared);
    expect(store.history.referencesAsset(assetId)).toBe(false);
    expect(store.history.referencesPoseSnapshotAsset(assetId)).toBe(false);
  });

  it('preserves History when a stale asset-delete acknowledgement conflicts with a newer reference', () => {
    const base = buildProject();
    const unusedAssetId = '10000000-0000-4000-8000-000000000099';
    const project = ProjectSchema.parse({
      ...base,
      assets: [
        ...base.assets,
        {
          id: unusedAssetId,
          kind: 'image',
          name: 'Unused image',
          relativePath: 'unused.png',
          mimeType: 'image/png',
          width: 640,
          height: 640,
          usage: 'uncategorized',
          keywords: [],
        },
      ],
    });
    const savedWithoutAsset = ProjectSchema.parse({
      ...project,
      assets: project.assets.filter((asset) => asset.id !== unusedAssetId),
    });
    const store = new EditorProjectStore();
    store.open('D:\\project.pandastage', project);
    const referenced = new LayerService().createFromAsset(project, IDS.shot, {
      version: 2,
      type: 'asset-image',
      assetId: unusedAssetId,
      position: { x: 420, y: 440 },
    }).project;
    store.updateProject(referenced, 'Reference image');
    const beforeRejectedDelete = store.getSnapshot();

    expect(() =>
      store.applyAssetDelete(savedWithoutAsset, unusedAssetId, 0, 1),
    ).toThrow('Newer editor changes reference the deleted asset');
    expect(store.getSnapshot()).toBe(beforeRejectedDelete);
    expect(store.history.getSnapshot().undoCount).toBe(1);
    expect(store.history.referencesAsset(unusedAssetId)).toBe(true);
  });

  it('commits an asset import at the matching base revision', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    store.open('D:\\project.pandastage', project);
    const imported = {
      id: '16000000-0000-4000-8000-000000000001',
      name: 'Imported',
      relativePath: 'assets/imported.png',
      mimeType: 'image/png',
      kind: 'image' as const,
      width: 16,
      height: 12,
      usage: 'uncategorized' as const,
      keywords: [],
    };
    const savedProject = ProjectSchema.parse({
      ...project,
      assets: [...project.assets, imported],
    });

    expect(store.applyAssetImport(savedProject, [imported], 0, 1)).toBe(
      'current',
    );
    expect(store.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 1,
      project: {
        assets: expect.arrayContaining([
          expect.objectContaining({ id: imported.id }),
        ]),
      },
    });
  });

  it('merges imported assets without losing newer editor changes', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    store.open('D:\\project.pandastage', project);
    const imported = {
      id: '16000000-0000-4000-8000-000000000001',
      name: 'Imported',
      relativePath: 'assets/imported.png',
      mimeType: 'image/png',
      kind: 'image' as const,
      width: 16,
      height: 12,
      usage: 'uncategorized' as const,
      keywords: [],
    };
    const savedProject = ProjectSchema.parse({
      ...project,
      assets: [...project.assets, imported],
    });
    store.updateProject({ ...project, name: 'Concurrent edit' });

    expect(store.applyAssetImport(savedProject, [imported], 0, 1)).toBe(
      'stale',
    );
    expect(store.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 2,
      project: {
        name: 'Concurrent edit',
        assets: expect.arrayContaining([
          expect.objectContaining({ id: imported.id }),
        ]),
      },
    });
  });

  it('records one already-saved Character command without clearing earlier undo history', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    const projectRoot = 'D:\\project.pandastage';
    store.open(projectRoot, project);
    store.updateProject({ ...project, name: 'Existing edit' }, 'Existing edit');
    const openInstanceId = store.getProjectInstanceId()!;
    const lease = store.acquireProjectOperationLease({
      projectRoot,
      projectId: project.id,
      revision: 1,
      openInstanceId,
    });
    const committed = ProjectSchema.parse({
      ...store.getSnapshot()!.project,
      name: 'Saved Character result',
    });

    expect(() => store.updateProject({ ...committed, name: 'blocked edit' })).toThrow('Project is busy');
    store.acceptSavedProjectCommand(lease, committed, 2, '导入角色');
    expect(store.getSnapshot()).toMatchObject({
      project: { name: 'Saved Character result' },
      dirty: false,
      revision: 2,
    });
    expect(store.getSavedProjectSnapshot()?.project.name).toBe('Saved Character result');
    expect(store.history.getSnapshot()).toMatchObject({
      undoCount: 2,
      redoCount: 0,
      nextUndoLabel: '导入角色',
    });
    expect(() => store.undo()).toThrow('Project is busy');
    store.releaseProjectOperationLease(lease);

    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      project: { name: 'Existing edit' },
      dirty: true,
      revision: 3,
    });
    expect(store.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 1,
      nextUndoLabel: 'Existing edit',
    });
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      project: { name: 'Saved Character result' },
      dirty: false,
      revision: 4,
    });
  });
});
