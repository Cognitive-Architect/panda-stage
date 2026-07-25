import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { ProjectSchema, ShotService } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';

function setup() {
  let counter = 0;
  const editor = new EditorProjectStore();
  const service = new ShotService({
    createId: () =>
      `d2020000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  });
  const store = new ShotStore(editor, service);
  editor.open(
    'D:\\镜头 项目.pandastage',
    ProjectSchema.parse(exampleProject),
  );
  return { editor, store };
}

describe('ShotStore', () => {
  it('keeps current selection session-only and marks every model mutation dirty', () => {
    const { editor, store } = setup();
    const originalId = editor.getSnapshot()!.project.shots[0]!.id;
    expect(store.getCurrentShotId()).toBe(originalId);
    store.duplicate(originalId);
    const copyId = store.getCurrentShotId();
    expect(copyId).not.toBe(originalId);
    expect(editor.getSnapshot()).toMatchObject({ dirty: true, revision: 1 });

    store.move(copyId!, 0);
    expect(store.getCurrentShotId()).toBe(copyId);
    expect(editor.getSnapshot()!.project.shots[0]!.id).toBe(copyId);
    expect(
      JSON.stringify(editor.getSnapshot()!.project),
    ).not.toContain('currentShot');
    store.dispose();
  });

  it('selects the next stable neighbor, then previous, then null when removing the current shot', () => {
    const { editor, store } = setup();
    const firstId = store.getCurrentShotId()!;
    store.duplicate(firstId);
    const secondId = store.getCurrentShotId()!;
    store.select(firstId);
    store.remove(firstId);
    expect(store.getCurrentShotId()).toBe(secondId);
    store.remove(secondId);
    expect(store.getCurrentShotId()).toBeNull();
    expect(editor.getSnapshot()!.project.shots).toEqual([]);
    store.dispose();
  });

  it('reconciles stale selection to the first shot when another project is opened', () => {
    const { editor, store } = setup();
    store.select(editor.getSnapshot()!.project.shots[0]!.id);
    const empty = ProjectSchema.parse({
      ...exampleProject,
      id: 'd2020000-0000-4000-8000-000000000099',
      shots: [],
    });
    editor.open('D:\\empty.pandastage', empty);
    expect(store.getCurrentShotId()).toBeNull();
    store.create({ name: 'First', durationMs: 500 });
    expect(store.getCurrentShotId()).toBe(
      editor.getSnapshot()!.project.shots[0]!.id,
    );
    store.dispose();
  });
});
