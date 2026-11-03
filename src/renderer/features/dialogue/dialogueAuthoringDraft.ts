import { DIALOGUE_AUTHORING_TEXT_MAX_LENGTH } from './parseDialoguePaste';
import type { DialogueBatchAudioSelection } from './dialogueBatchPlan';

export { DIALOGUE_AUTHORING_TEXT_MAX_LENGTH } from './parseDialoguePaste';

type Listener = () => void;

export interface DialogueDraftIdentity {
  projectRoot: string;
  shotId: string | null;
}

export interface DialogueAuthoringDraftSnapshot {
  singleCharacterId: string;
  singleText: string;
  batchRaw: string;
  batchMapping: Record<number, string>;
  batchAudioSelections: Record<number, DialogueBatchAudioSelection>;
}

export interface SingleDialogueDraftErrors {
  speaker: string | null;
  text: string | null;
}

export function validateSingleDialogueDraft(
  draft: Pick<
    DialogueAuthoringDraftSnapshot,
    'singleCharacterId' | 'singleText'
  >,
  characterIds: readonly string[],
): SingleDialogueDraftErrors {
  const text = draft.singleText.trim();
  const speaker =
    draft.singleCharacterId === ''
      ? '请选择角色。'
      : !characterIds.includes(draft.singleCharacterId)
        ? '所选角色已不存在，请重新选择。'
        : null;
  const textError =
    text.length === 0
      ? '请输入台词内容。'
      : text.length > DIALOGUE_AUTHORING_TEXT_MAX_LENGTH
        ? `台词内容不能超过 ${DIALOGUE_AUTHORING_TEXT_MAX_LENGTH} 个字符。`
        : null;
  return { speaker, text: textError };
}

const EMPTY_DRAFT: DialogueAuthoringDraftSnapshot = {
  singleCharacterId: '',
  singleText: '',
  batchRaw: '',
  batchMapping: {},
  batchAudioSelections: {},
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
 * Transient, non-persisted scratch state for subtitle authoring inputs. The
 * Dialogue Sheet and the Tools > Auto Subtitles surface each own a separate
 * instance; neither is a project mutation or flows through History, save or
 * the schema.
 *
 * The draft is bound to a (projectRoot, shotId) identity. Switching project or
 * shot clears every field, so a Shot A draft can never be committed into Shot
 * B (DialogueStore.createMany reads the current shot at commit time). Each UI
 * owner keeps its own instance across presentation changes without allowing a
 * draft to cross project or shot boundaries.
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

  /** Close the whole shared authoring shell and discard every transient field. */
  clear(): void {
    this.set({ ...EMPTY_DRAFT });
  }

  setBatchRaw(value: string): void {
    const previousLines = this.snapshot.batchRaw.split(/\r?\n/u);
    const nextLines = value.split(/\r?\n/u);
    const batchMapping = { ...this.snapshot.batchMapping };
    const batchAudioSelections = { ...this.snapshot.batchAudioSelections };
    for (
      let index = 0;
      index < Math.max(previousLines.length, nextLines.length);
      index += 1
    ) {
      if (previousLines[index] === nextLines[index]) continue;
      delete batchMapping[index + 1];
      delete batchAudioSelections[index + 1];
    }
    this.set({
      ...this.snapshot,
      batchRaw: value,
      batchMapping,
      batchAudioSelections,
    });
  }

  setBatchMapping(lineNumber: number, characterId: string): void {
    const batchAudioSelections = { ...this.snapshot.batchAudioSelections };
    if (this.snapshot.batchMapping[lineNumber] !== characterId) {
      delete batchAudioSelections[lineNumber];
    }
    this.set({
      ...this.snapshot,
      batchMapping: { ...this.snapshot.batchMapping, [lineNumber]: characterId },
      batchAudioSelections,
    });
  }

  setBatchAudioSelection(
    lineNumber: number,
    selection: DialogueBatchAudioSelection,
  ): void {
    this.set({
      ...this.snapshot,
      batchAudioSelections: {
        ...this.snapshot.batchAudioSelections,
        [lineNumber]: selection,
      },
    });
  }

  clearBatchAudioSelection(lineNumber: number): void {
    const batchAudioSelections = { ...this.snapshot.batchAudioSelections };
    delete batchAudioSelections[lineNumber];
    this.set({ ...this.snapshot, batchAudioSelections });
  }

  private set(next: DialogueAuthoringDraftSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
