import type {
  ExecuteHistoryOptions,
  HistoryCoalescing,
  HistoryCommand,
} from './HistoryCommand';

interface HistoryEntry {
  readonly command: HistoryCommand;
  readonly coalescing?: HistoryCoalescing;
}

export interface HistorySnapshot {
  readonly undoCount: number;
  readonly redoCount: number;
  readonly nextUndoLabel: string | null;
  readonly nextRedoLabel: string | null;
}

type Listener = () => void;

export class HistoryStore {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<Listener>();
  private snapshot: HistorySnapshot = {
    undoCount: 0,
    redoCount: 0,
    nextUndoLabel: null,
    nextRedoLabel: null,
  };

  constructor(readonly maxDepth = 50) {
    if (!Number.isInteger(maxDepth) || maxDepth < 20) {
      throw new Error('History depth must be an integer of at least 20.');
    }
  }

  readonly getSnapshot = (): HistorySnapshot => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  execute(
    command: HistoryCommand,
    options: ExecuteHistoryOptions = {},
  ): void {
    command.redo();
    const previous = this.undoStack.at(-1);
    const merged =
      previous &&
      options.coalescing &&
      this.sameGesture(previous.coalescing, options.coalescing)
        ? previous.command.mergeWith?.(command) ?? null
        : null;
    if (merged) {
      this.undoStack[this.undoStack.length - 1] = {
        command: merged,
        coalescing: options.coalescing,
      };
    } else {
      this.undoStack.push({
        command,
        coalescing: options.coalescing,
      });
      if (this.undoStack.length > this.maxDepth) {
        this.undoStack.splice(0, this.undoStack.length - this.maxDepth);
      }
    }
    this.redoStack.length = 0;
    this.emit();
  }

  undo(): boolean {
    const entry = this.undoStack.at(-1);
    if (!entry) return false;
    entry.command.undo();
    this.undoStack.pop();
    this.redoStack.push(entry);
    this.emit();
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.at(-1);
    if (!entry) return false;
    entry.command.redo();
    this.redoStack.pop();
    this.undoStack.push(entry);
    this.emit();
    return true;
  }

  clear(): void {
    if (this.undoStack.length === 0 && this.redoStack.length === 0) {
      return;
    }
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }

  private sameGesture(
    left: HistoryCoalescing | undefined,
    right: HistoryCoalescing,
  ): boolean {
    return (
      left?.key === right.key && left.gestureId === right.gestureId
    );
  }

  private emit(): void {
    this.snapshot = {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      nextUndoLabel: this.undoStack.at(-1)?.command.label ?? null,
      nextRedoLabel: this.redoStack.at(-1)?.command.label ?? null,
    };
    for (const listener of this.listeners) listener();
  }
}
