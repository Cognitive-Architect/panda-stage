import { describe, expect, it } from 'vitest';
import { ProjectOperationCoordinator } from '../../src/main/services/ProjectOperationCoordinator';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ProjectOperationCoordinator', () => {
  it('serializes the same project root without globally blocking another root', async () => {
    const coordinator = new ProjectOperationCoordinator();
    const releaseFirst = deferred();
    const firstEntered = deferred();
    const order: string[] = [];

    const first = coordinator.runExclusive(
      'D:\\projects\\a.pandastage',
      async () => {
        order.push('a:first:start');
        firstEntered.resolve();
        await releaseFirst.promise;
        order.push('a:first:end');
      },
    );
    await firstEntered.promise;
    const second = coordinator.runExclusive(
      'D:\\projects\\a.pandastage',
      async () => {
        order.push('a:second');
      },
    );
    await coordinator.runExclusive(
      'D:\\projects\\b.pandastage',
      async () => {
        order.push('b');
      },
    );

    expect(order).toEqual(['a:first:start', 'b']);
    expect(coordinator.queuedProjectCount()).toBe(1);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual([
      'a:first:start',
      'b',
      'a:first:end',
      'a:second',
    ]);
    expect(coordinator.queuedProjectCount()).toBe(0);
  });
});
