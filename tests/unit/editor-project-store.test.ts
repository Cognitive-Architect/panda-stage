import { describe, expect, it, vi } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('EditorProjectStore', () => {
  it('is the single dirty source for open, restore, edit, and manual save', () => {
    const store = new EditorProjectStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const formalProject = ProjectSchema.parse(exampleProject);

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

    store.markSaved(store.getSnapshot()!.project);
    expect(store.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 2,
    });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('rejects replacing the open project with a different identity', () => {
    const store = new EditorProjectStore();
    const project = ProjectSchema.parse(exampleProject);
    store.open('D:\\project.pandastage', project);

    expect(() =>
      store.restore({
        ...project,
        id: '99000000-0000-4000-8000-000000000001',
      }),
    ).toThrow('identity mismatch');
  });
});
