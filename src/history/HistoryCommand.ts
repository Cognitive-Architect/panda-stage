export interface HistoryCommand {
  readonly label: string;
  readonly projectId: string;
  undo(): void;
  redo(): void;
  mergeWith?(next: HistoryCommand): HistoryCommand | null;
}

/**
 * Session-only effects for a project history replay. These callbacks never
 * enter the persisted Project snapshot and must not mutate project history.
 */
export interface HistoryReplayEffects {
  readonly afterUndo?: () => void;
  readonly afterRedo?: () => void;
}

export interface HistoryCoalescing {
  readonly key: string;
  readonly gestureId: string;
}

export interface ExecuteHistoryOptions {
  readonly coalescing?: HistoryCoalescing;
}
