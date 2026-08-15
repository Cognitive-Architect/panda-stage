type Listener = () => void;

export interface DialogueDraftIdentity {
  projectRoot: string;
  shotId: string | null;
}

export interface DialogueAuthoringDraftSnapshot {
  singleCharacterId: string;
  singleText: string;
  batchOpen: boolean;
  batchRaw: string;
  batchMapping: Record<number, string>;
}

const EMPTY_DRAFT: DialogueAuthoringDraftSnapshot = {
  singleCharacterId: '',
  singleText: '',
  batchOpen: false,
  batchRaw: '',
  batchMapping: {},
};

function identityChanged(
  previous: DialogueDraftIdentity | null,
  next: DialogueDraftIdentity,
): boolean {
  return (
    !previous ||
    previous.projectRoot !== next.projectRoot ||
    previous.shotId !== next.shotId
  );
}

/**
 * Transient, non-persisted scratch state for the Dialogue Sheet authoring
 * inputs (single-add form + batch paste). It is deliberately NOT a project
 * mutation and never flows through History, save or the schema: it is the
 * uncommitted UI draft.
 *
 * The draft is bound to a (projectRoot, shotId) identity. Switching project or
 * shot clears every field, so a Shot A draft can never be committed into Shot
 * B (DialogueStore.createMany reads the current shot at commit time). This is a
 * single-sheet scratch buffer created by the DialogueSheet, not a global draft
 * framework.
 */
export class DialogueAuthoringDraft {
  private identity: DialogueDraftIdentity | null = null;
  private snapshot: DialogueAuthoringDraftSnapshot = { ...EMPTY_DRAFT };
  private readonly listeners = new Set<Listener>();

  readonly getSnapshot = (): DialogueAuthoringDraftSnapshot => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Re-bind to an identity. When the identity differs from the current one, the
   * whole draft is cleared so stale inputs from another shot/project cannot
   * survive a switch. Returns true when a reset happened.
   */
  bindIdentity(next: DialogueDraftIdentity): boolean {
    if (!identityChanged(this.identity, next)) return false;
    this.identity = next;
    this.set({ ...EMPTY_DRAFT });
    return true;
  }

  setSingleCharacterId(value: string): void {
    this.set({ ...this.snapshot, singleCharacterId: value });
  }

  setSingleText(value: string): void {
    this.set({ ...this.snapshot, singleText: value });
  }

  /** Open the batch surface. Only flips batchOpen; the single-add draft and
   * the batch raw/mapping survive until the batch is closed or the identity
   * changes, so opening the batch never discards an in-progress single line. */
  openBatch(): void {
    this.set({ ...this.snapshot, batchOpen: true });
  }

  /** Close the batch surface and drop the raw text + manual mapping. */
  closeBatch(): void {
    this.set({
      ...this.snapshot,
      batchOpen: false,
      batchRaw: '',
      batchMapping: {},
    });
  }

  setBatchRaw(value: string): void {
    this.set({ ...this.snapshot, batchRaw: value });
  }

  setBatchMapping(lineNumber: number, characterId: string): void {
    this.set({
      ...this.snapshot,
      batchMapping: { ...this.snapshot.batchMapping, [lineNumber]: characterId },
    });
  }

  private set(next: DialogueAuthoringDraftSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
