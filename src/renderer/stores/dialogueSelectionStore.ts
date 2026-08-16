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
export class DialogueSelectionStore {
  private selectedDialogueId: string | null = null;
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
    this.setSelectedDialogueId(dialogue.id, context);
    // Selecting a dialogue dismisses any layer/background selection.
    this.layerSelection.clear();
  }

  clear(): void {
    this.setSelectedDialogueId(null, null);
  }

  dispose(): void {
    this.unsubscribeEditor();
    this.unsubscribeShot();
    this.unsubscribeLayer();
    this.listeners.clear();
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
    if (!this.selectedDialogueId || !this.selectedContext) return;
    const context = this.currentContext();
    if (
      !context ||
      context.projectId !== this.selectedContext.projectId ||
      context.projectRoot !== this.selectedContext.projectRoot ||
      context.shotId !== this.selectedContext.shotId ||
      !context.shot.dialogues.some(
        (dialogue) => dialogue.id === this.selectedDialogueId,
      )
    ) {
      this.setSelectedDialogueId(null, null);
    }
  }

  private setSelectedDialogueId(
    dialogueId: string | null,
    context: SelectionContext | null,
  ): void {
    if (dialogueId === this.selectedDialogueId) return;
    this.selectedDialogueId = dialogueId;
    this.selectedContext = context;
    for (const listener of this.listeners) listener();
  }
}

export const dialogueSelectionStore = new DialogueSelectionStore(
  editorProjectStore,
  shotStore,
  selectionStore,
);
