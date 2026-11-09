import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { ShotService, migrateProject } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';

function setup() {
  let counter = 0;
  const editor = new EditorProjectStore();
  const service = new ShotService({
    createId: () =>
      `d3010000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-11-07T05:10:00.000Z'),
  });
  const store = new ShotStore(editor, service);
  editor.open('D:\\模板 项目.pandastage', migrateProject(exampleProject));
  return { editor, store };
}

describe('ShotStore template commands', () => {
  it('records one History command per saved template and undoes it in one step', () => {
    const { editor, store } = setup();
    const shotId = editor.getSnapshot()!.project.shots[0]!.id;

    store.saveAsTemplate(shotId, '客厅双人对话');
    const saved = editor.getSnapshot()!;
    expect(saved.project.shotTemplates).toHaveLength(1);
    expect(saved).toMatchObject({ dirty: true, revision: 1 });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 1 });

    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shotTemplates).toEqual([]);

    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project.shotTemplates).toHaveLength(1);
    expect(editor.getSnapshot()!.project.shotTemplates[0]!.name).toBe(
      '客厅双人对话',
    );
    store.dispose();
  });

  it('creates one Shot from a template in one revision and selects it', () => {
    const { editor, store } = setup();
    const shotId = editor.getSnapshot()!.project.shots[0]!.id;
    store.saveAsTemplate(shotId, '站位模板');
    const templateId = editor.getSnapshot()!.project.shotTemplates[0]!.id;
    const revisionBefore = editor.getSnapshot()!.revision;

    store.createFromTemplate(templateId, '镜头 6');
    const created = editor.getSnapshot()!;
    const newShot = created.project.shots.at(-1)!;

    expect(created.revision).toBe(revisionBefore + 1);
    expect(newShot.name).toBe('镜头 6');
    expect(store.getCurrentShotId()).toBe(newShot.id);
    expect(newShot.dialogues).toEqual([]);
    expect(newShot.audioClips).toEqual([]);

    expect(editor.undo()).toBe(true);
    expect(
      editor.getSnapshot()!.project.shots.some((shot) => shot.id === newShot.id),
    ).toBe(false);
    expect(store.getCurrentShotId()).not.toBe(newShot.id);

    expect(editor.redo()).toBe(true);
    expect(
      editor.getSnapshot()!.project.shots.some((shot) => shot.id === newShot.id),
    ).toBe(true);
    store.dispose();
  });

  it('deletes one template in one revision without touching instantiated Shots', () => {
    const { editor, store } = setup();
    const shotId = editor.getSnapshot()!.project.shots[0]!.id;
    store.saveAsTemplate(shotId, '站位模板');
    const templateId = editor.getSnapshot()!.project.shotTemplates[0]!.id;
    store.createFromTemplate(templateId, '镜头 6');
    const shotsBefore = JSON.stringify(
      editor.getSnapshot()!.project.shots,
    );
    const revisionBefore = editor.getSnapshot()!.revision;

    store.removeTemplate(templateId);
    const removed = editor.getSnapshot()!;
    expect(removed.project.shotTemplates).toEqual([]);
    expect(JSON.stringify(removed.project.shots)).toBe(shotsBefore);
    expect(removed.revision).toBe(revisionBefore + 1);

    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shotTemplates).toHaveLength(1);
    expect(JSON.stringify(editor.getSnapshot()!.project.shots)).toBe(
      shotsBefore,
    );
    store.dispose();
  });

  it('keeps a failed template command free of revision and History noise', () => {
    const { editor, store } = setup();
    const before = editor.getSnapshot()!;
    const shotId = before.project.shots[0]!.id;

    expect(() => store.saveAsTemplate(shotId, '   ')).toThrowError(
      /请输入模板名称/u,
    );
    expect(() =>
      store.createFromTemplate(
        '00000000-0000-4000-8000-000000000999',
        '镜头 6',
      ),
    ).toThrowError(/找不到镜头模板/u);

    expect(editor.getSnapshot()).toBe(before);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
    expect(editor.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    store.dispose();
  });
});
