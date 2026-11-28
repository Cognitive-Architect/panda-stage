import {
  editorProjectStore,
  type EditorProjectStore,
} from './EditorProjectStore';
import type { Shot } from '../../domain';
import { shotStore, type ShotStore } from './shotStore';
import { selectionStore, type LayerSelectionStore } from './selectionStore';

type Listener = () => void;

interface SelectionContext {
  projectId: string;
  projectRoot: string;
  shotId: string;
}

/**
 * Tracks the currently selected dialogue within the active shot. Selection is
 * bound to a (projectRoot, projectId, shotId) identity so it invalidates on
 * project / shot switches, and it is mutually exclusive with the layer
 * selection managed by `LayerSelectionStore`: selecting a dialogue clears the
 * layer selection, and selecting a layer clears the dialogue selection. This
 * keeps the single RightInspector from ever presenting two "current objects".
 */
const EMPTY_DIALOGUE_SELECTION: readonly string[] = [];

export class DialogueSelectionStore {
  private selectedDialogueId: string | null = null;
  private selectedDialogueIds: readonly string[] = EMPTY_DIALOGUE_SELECTION;
  private selectedContext: SelectionContext | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribeEditor: () => void;
  private readonly unsubscribeShot: () => void;
  private readonly unsubscribeLayer: () => void;

  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly currentShot: Pick<
      ShotStore,
      'getCurrentShotId' | 'subscribe'
    >,
    private readonly layerSelection: LayerSelectionStore,
  ) {
    this.unsubscribeEditor = editorStore.subscribe(() =>
      this.reconcileSelection(),
    );
    this.unsubscribeShot = currentShot.subscribe(() =>
      this.reconcileSelection(),
    );
    this.unsubscribeLayer = layerSelection.subscribe(() => {
      if (layerSelection.getSelectedLayerId() !== null) this.clear();
    });
  }

  readonly getSelectedDialogueId = (): string | null =>
    this.selectedDialogueId;

  /** Temporary session-only multi-selection of dialogues in the active shot. */
  readonly getSelectedDialogueIds = (): readonly string[] =>
    this.selectedDialogueIds;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  select(dialogueId: string): void {
    const context = this.currentContext();
    const dialogue = context?.shot.dialogues.find(
      (candidate) => candidate.id === dialogueId,
    );
    if (!context || !dialogue) {
      throw new Error(`找不到当前镜头中的对白：${dialogueId}`);
    }
    this.setSelectionState(dialogue.id, [dialogue.id], context);
    // Selecting a dialogue dismisses any layer/background selection.
    this.layerSelection.clear();
  }

  /** Toggle one existing dialogue without introducing another selection owner. */
  toggle(dialogueId: string): void {
    if (
      this.selectedDialogueId === dialogueId &&
      this.selectedDialogueIds.length <= 1
    ) {
      this.clear();
      return;
    }
    this.select(dialogueId);
  }

  /** Ctrl/Cmd+Click: add or remove one dialogue in the temporary multi-selection. */
  toggleInSelection(dialogueId: string): void {
    const context = this.currentContext();
    const dialogue = context?.shot.dialogues.find(
      (candidate) => candidate.id === dialogueId,
    );
    if (!context || !dialogue) {
      throw new Error(`找不到当前镜头中的对白：${dialogueId}`);
    }
    const existing = this.isSameContext(context) ? this.selectedDialogueIds : [];
    const nextIds = existing.includes(dialogue.id)
      ? existing.filter((id) => id !== dialogue.id)
      : [...existing, dialogue.id];
    if (nextIds.length === 0) {
      this.clear();
      return;
    }
    const primary = nextIds.includes(dialogue.id)
      ? dialogue.id
      : nextIds[nextIds.length - 1]!;
    this.setSelectionState(primary, nextIds, context);
    this.layerSelection.clear();
  }

  /** Shift+Click: select a contiguous time-ordered range from primary to target. */
  selectRange(dialogueId: string): void {
    const context = this.currentContext();
    const target = context?.shot.dialogues.find(
      (candidate) => candidate.id === dialogueId,
    );
    if (!context || !target) {
      throw new Error(`找不到当前镜头中的对白：${dialogueId}`);
    }
    if (
      !this.selectedDialogueId ||
      !this.isSameContext(context) ||
      !context.shot.dialogues.some((d) => d.id === this.selectedDialogueId)
    ) {
      this.select(dialogueId);
      return;
    }
    const ordered = [...context.shot.dialogues].sort(
      (left, right) =>
        left.startMs - right.startMs ||
        left.endMs - right.endMs ||
        left.id.localeCompare(right.id),
    );
    const anchorIndex = ordered.findIndex(
      (candidate) => candidate.id === this.selectedDialogueId,
    );
    const targetIndex = ordered.findIndex(
      (candidate) => candidate.id === target.id,
    );
    if (anchorIndex < 0 || targetIndex < 0) {
      this.select(dialogueId);
      return;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const rangeIds = ordered.slice(start, end + 1).map((item) => item.id);
    this.setSelectionState(target.id, rangeIds, context);
    this.layerSelection.clear();
  }

  /** Replace temporary multi-selection with a validated list of dialogue IDs. */
  setSelection(dialogueIds: readonly string[]): void {
    const unique = [...new Set(dialogueIds)];
    if (unique.length === 0) {
      this.clear();
      return;
    }
    const context = this.currentContext();
    if (!context) {
      this.clear();
      return;
    }
    const validSet = new Set(context.shot.dialogues.map((d) => d.id));
    const validIds = unique.filter((id) => validSet.has(id));
    if (validIds.length === 0) {
      this.clear();
      return;
    }
    const primary =
      this.selectedDialogueId && validIds.includes(this.selectedDialogueId)
        ? this.selectedDialogueId
        : validIds[validIds.length - 1]!;
    this.setSelectionState(primary, validIds, context);
    this.layerSelection.clear();
  }

  clear(): void {
    this.setSelectionState(null, EMPTY_DIALOGUE_SELECTION, null);
  }

  dispose(): void {
    this.unsubscribeEditor();
    this.unsubscribeShot();
    this.unsubscribeLayer();
    this.listeners.clear();
  }

  private isSameContext(context: SelectionContext): boolean {
    return (
      this.selectedContext !== null &&
      this.selectedContext.projectId === context.projectId &&
      this.selectedContext.projectRoot === context.projectRoot &&
      this.selectedContext.shotId === context.shotId
    );
  }

  private currentContext(): (SelectionContext & { shot: Shot }) | null {
    const snapshot = this.editorStore.getSnapshot();
    const shotId = this.currentShot.getCurrentShotId();
    const shot = snapshot?.project.shots.find(
      (candidate) => candidate.id === shotId,
    );
    if (!snapshot || !shot) return null;
    return {
      projectId: snapshot.project.id,
      projectRoot: snapshot.projectRoot,
      shotId: shot.id,
      shot,
    };
  }

  private reconcileSelection(): void {
    if (this.selectedDialogueIds.length === 0 || !this.selectedContext) return;
    const context = this.currentContext();
    if (!context || !this.isSameContext(context)) {
      this.setSelectionState(null, EMPTY_DIALOGUE_SELECTION, null);
      return;
    }
    const existingIds = new Set(context.shot.dialogues.map((d) => d.id));
    const remaining = this.selectedDialogueIds.filter((id) =>
      existingIds.has(id),
    );
    if (remaining.length === 0) {
      this.setSelectionState(null, EMPTY_DIALOGUE_SELECTION, null);
      return;
    }
    const primary =
      this.selectedDialogueId && existingIds.has(this.selectedDialogueId)
        ? this.selectedDialogueId
        : remaining[remaining.length - 1]!;
    if (
      primary !== this.selectedDialogueId ||
      remaining.length !== this.selectedDialogueIds.length
    ) {
      this.setSelectionState(primary, remaining, context);
    }
  }

  private setSelectionState(
    dialogueId: string | null,
    dialogueIds: readonly string[],
    context: SelectionContext | null,
  ): void {
    const sameList =
      dialogueIds.length === this.selectedDialogueIds.length &&
      dialogueIds.every((id, index) => id === this.selectedDialogueIds[index]);
    if (dialogueId === this.selectedDialogueId && sameList) return;
    this.selectedDialogueId = dialogueId;
    this.selectedDialogueIds =
      dialogueIds.length === 0 ? EMPTY_DIALOGUE_SELECTION : dialogueIds;
    this.selectedContext = context;
    for (const listener of this.listeners) listener();
  }
}

export const dialogueSelectionStore = new DialogueSelectionStore(
  editorProjectStore,
  shotStore,
  selectionStore,
);
