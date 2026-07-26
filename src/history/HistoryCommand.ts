export interface HistoryCommand {
  readonly label: string;
  readonly projectId: string;
  undo(): void;
  redo(): void;
  mergeWith?(next: HistoryCommand): HistoryCommand | null;
}

export interface HistoryCoalescing {
  readonly key: string;
  readonly gestureId: string;
}

export interface ExecuteHistoryOptions {
  readonly coalescing?: HistoryCoalescing;
}
