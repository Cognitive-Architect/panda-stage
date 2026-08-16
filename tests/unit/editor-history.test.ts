import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';

describe('EditorProjectStore history commands', () => {
  it('coalesces ten writes from one gesture into an exact before/final pair', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    store.open('D:\\history.pandastage', project);
    for (let index = 1; index <= 10; index += 1) {
      store.updateProject(
        {
          ...store.getSnapshot()!.project,
          name: `Gesture frame ${index}`,
        },
        'Move layer',
        {
          coalescing: {
            key: 'move:layer-1',
            gestureId: 'gesture-1',
          },
        },
      );
    }
    expect(store.history.getSnapshot().undoCount).toBe(1);
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      dirty: false,
      project: { name: project.name },
    });
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      dirty: true,
      project: { name: 'Gesture frame 10' },
    });
  });

  it('does not merge independent gestures and clears redo on a new edit', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    store.open('D:\\history.pandastage', project);
    for (const gestureId of ['gesture-1', 'gesture-2']) {
      store.updateProject(
        {
          ...store.getSnapshot()!.project,
          name: gestureId,
        },
        'Move layer',
        {
          coalescing: {
            key: 'move:layer-1',
            gestureId,
          },
        },
      );
    }
    expect(store.history.getSnapshot().undoCount).toBe(2);
    store.undo();
    expect(store.history.getSnapshot().redoCount).toBe(1);
    store.updateProject(
      { ...store.getSnapshot()!.project, name: 'New branch' },
      'Rename project',
    );
    expect(store.history.getSnapshot().redoCount).toBe(0);
  });

  it('keeps history after save and recalculates dirty against the saved value', () => {
    const store = new EditorProjectStore();
    const project = migrateProject(exampleProject);
    store.open('D:\\history.pandastage', project);
    store.updateProject({ ...project, name: 'Saved edit' });
    store.markSaved(store.getSnapshot()!.project, 1);
    expect(store.history.getSnapshot().undoCount).toBe(1);
    store.undo();
    expect(store.getSnapshot()!.dirty).toBe(true);
    store.redo();
    expect(store.getSnapshot()!.dirty).toBe(false);
  });
});
