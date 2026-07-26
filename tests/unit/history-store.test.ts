import { describe, expect, it, vi } from 'vitest';
import type { HistoryCommand } from '../../src/history/HistoryCommand';
import { HistoryStore } from '../../src/history/HistoryStore';

interface ValueCommand extends HistoryCommand {
  readonly afterValue: number;
}

function valueCommand(
  label: string,
  before: number,
  after: number,
  apply: (value: number) => void,
): ValueCommand {
  return {
    label,
    projectId: 'project-1',
    afterValue: after,
    undo: () => apply(before),
    redo: () => apply(after),
    mergeWith(next) {
      return next.projectId === this.projectId &&
        'afterValue' in next &&
        typeof next.afterValue === 'number'
        ? valueCommand(next.label, before, next.afterValue, apply)
        : null;
    },
  };
}

describe('HistoryStore', () => {
  it('executes, undoes, redoes, and safely ignores empty stacks', () => {
    const history = new HistoryStore();
    let value = 0;
    const apply = (next: number) => {
      value = next;
    };

    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
    history.execute(valueCommand('Move layer', 0, 1, apply));
    expect(value).toBe(1);
    expect(history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
      nextUndoLabel: 'Move layer',
    });
    expect(history.undo()).toBe(true);
    expect(value).toBe(0);
    expect(history.redo()).toBe(true);
    expect(value).toBe(1);
  });

  it('clears redo after a new branch and keeps at least twenty steps', () => {
    const history = new HistoryStore(20);
    let value = 0;
    const apply = (next: number) => {
      value = next;
    };
    for (let index = 1; index <= 25; index += 1) {
      history.execute(
        valueCommand(`Edit ${index}`, index - 1, index, apply),
      );
    }
    expect(history.getSnapshot().undoCount).toBe(20);
    for (let index = 0; index < 20; index += 1) {
      expect(history.undo()).toBe(true);
    }
    expect(value).toBe(5);
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(true);
    history.execute(valueCommand('New branch', 6, 100, apply));
    expect(history.getSnapshot().redoCount).toBe(0);
    expect(history.redo()).toBe(false);
    expect(value).toBe(100);
  });

  it('coalesces only an identical operation and gesture boundary', () => {
    const history = new HistoryStore();
    const apply = vi.fn();
    for (let index = 1; index <= 10; index += 1) {
      history.execute(
        valueCommand('Move layer', index - 1, index, apply),
        {
          coalescing: {
            key: 'move:layer-1',
            gestureId: 'pointer-gesture-1',
          },
        },
      );
    }
    expect(history.getSnapshot().undoCount).toBe(1);
    expect(history.undo()).toBe(true);
    expect(apply).toHaveBeenLastCalledWith(0);

    history.execute(valueCommand('Move layer', 0, 1, apply), {
      coalescing: {
        key: 'move:layer-1',
        gestureId: 'pointer-gesture-2',
      },
    });
    history.execute(valueCommand('Move layer', 1, 2, apply), {
      coalescing: {
        key: 'move:layer-1',
        gestureId: 'pointer-gesture-3',
      },
    });
    expect(history.getSnapshot().undoCount).toBe(2);
  });
});
