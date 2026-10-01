import { editorProjectStore, type EditorProjectStore } from './EditorProjectStore';
import { shotStore, type ShotStore } from './shotStore';
import { dialogueSelectionStore, type DialogueSelectionStore } from './dialogueSelectionStore';
import { selectionStore, type LayerSelectionStore } from './selectionStore';

/** Session-only standalone selection, never a Dialogue id or persisted Project field. */
export class AudioClipSelectionStore {
  private selectedId: string | null = null;
  private instanceId: number | null = null;
  private shotId: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribes: Array<() => void>;

  constructor(
    private readonly editor: EditorProjectStore,
    private readonly shots: Pick<ShotStore, 'getCurrentShotId' | 'subscribe'>,
    private readonly dialogues: Pick<DialogueSelectionStore, 'clear' | 'subscribe' | 'getSelectedDialogueId'>,
    private readonly layers: Pick<LayerSelectionStore, 'clear' | 'subscribe' | 'getSelectedLayerId'>,
  ) {
    this.unsubscribes = [
      editor.subscribe(() => this.reconcile()),
      shots.subscribe(() => this.reconcile()),
      dialogues.subscribe(() => { if (dialogues.getSelectedDialogueId() !== null) this.clear(); }),
      layers.subscribe(() => { if (layers.getSelectedLayerId() !== null) this.clear(); }),
    ];
  }

  readonly getSelectedAudioClipId = (): string | null => this.selectedId;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  select(clipId: string): void {
    const shotId = this.shots.getCurrentShotId();
    const shot = this.editor.getSnapshot()?.project.shots.find((candidate) => candidate.id === shotId);
    if (!shot?.audioClips.some((clip) => clip.id === clipId && (clip.role === 'bgm' || clip.role === 'sfx'))) {
      throw new Error('Select an existing standalone AudioClip in the current Shot.');
    }
    this.dialogues.clear();
    this.layers.clear();
    this.instanceId = this.editor.getProjectInstanceId();
    this.shotId = shotId;
    this.set(clipId);
  }

  clear(): void {
    this.instanceId = null;
    this.shotId = null;
    this.set(null);
  }

  dispose(): void {
    this.unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.listeners.clear();
  }

  private reconcile(): void {
    if (this.selectedId === null) return;
    const shot = this.editor.getSnapshot()?.project.shots.find((candidate) => candidate.id === this.shotId);
    if (this.editor.getProjectInstanceId() !== this.instanceId || this.shots.getCurrentShotId() !== this.shotId ||
      !shot?.audioClips.some((clip) => clip.id === this.selectedId && (clip.role === 'bgm' || clip.role === 'sfx'))) this.clear();
  }

  private set(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.listeners.forEach((listener) => listener());
  }
}

export const audioClipSelectionStore = new AudioClipSelectionStore(editorProjectStore, shotStore, dialogueSelectionStore, selectionStore);
