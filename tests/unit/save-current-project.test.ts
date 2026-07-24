import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import { saveCurrentProject } from '../../src/renderer/features/recovery/saveCurrentProject';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import type { ProjectOperationResponse } from '../../src/shared/project-api';
import exampleProject from '../../demo-project/project-v1.example.json';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('saveCurrentProject', () => {
  it('acknowledges the request-time revision instead of a newer response-time revision', async () => {
    const store = new EditorProjectStore();
    const project = ProjectSchema.parse(exampleProject);
    store.open('D:\\project.pandastage', project);
    store.updateProject({ ...project, name: 'Revision 1' });
    const revisionTwo = { ...project, name: 'Revision 2' };
    store.updateProject(revisionTwo);
    const response = deferred<ProjectOperationResponse>();
    let requestedRevision: number | undefined;
    const saving = saveCurrentProject(
      {
        save: (request) => {
          requestedRevision = request.revision;
          return response.promise;
        },
      },
      store,
    );

    store.updateProject({ ...project, name: 'Revision 3' });
    response.resolve({
      ok: true,
      value: {
        projectRoot: 'D:\\project.pandastage',
        projectFilePath: 'D:\\project.pandastage\\project.json',
        project: revisionTwo,
        migrated: false,
        sourceVersion: 1,
      },
    });
    const result = await saving;

    expect(requestedRevision).toBe(2);
    expect(result).toMatchObject({
      ok: true,
      savedRevision: 2,
      acknowledgement: 'stale',
    });
    expect(store.getSnapshot()).toMatchObject({
      project: { name: 'Revision 3' },
      dirty: true,
      revision: 3,
    });
  });
});
