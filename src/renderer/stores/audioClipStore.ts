import { AudioClipService, type Project, type StandaloneAudioRole } from '../../domain';
import { editorProjectStore, type EditorProjectStore } from './EditorProjectStore';
import { shotStore, type ShotStore } from './shotStore';
import { audioClipSelectionStore } from './audioClipSelectionStore';

/** The renderer authoring boundary: one Project snapshot and one History command per action. */
export class AudioClipStore {
  constructor(
    private readonly editor: EditorProjectStore,
    private readonly shots: Pick<ShotStore, 'getCurrentShotId'>,
    private readonly service: AudioClipService,
    private readonly selection: { select: (id: string) => void },
  ) {}

  create(assetId: string, role: StandaloneAudioRole, startMs: number): string {
    const { project, shotId } = this.context();
    const next = this.service.create(project, { shotId, assetId, role, startMs });
    this.editor.updateProject(next, 'Add standalone audio');
    const id = next.shots.find((shot) => shot.id === shotId)!.audioClips.at(-1)!.id;
    this.selection.select(id);
    return id;
  }

  move(clipId: string, startMs: number): void {
    const { project, shotId } = this.context();
    this.commit(project, this.service.move(project, { shotId, clipId, startMs }), 'Move standalone audio');
  }

  trimStart(clipId: string, startMs: number): void {
    const { project, shotId } = this.context();
    this.commit(project, this.service.trimStart(project, { shotId, clipId, startMs }), 'Trim standalone audio start');
  }

  trimEnd(clipId: string, endMs: number): void {
    const { project, shotId } = this.context();
    this.commit(project, this.service.trimEnd(project, { shotId, clipId, endMs }), 'Trim standalone audio end');
  }

  setVolume(clipId: string, volume: number): void {
    const { project, shotId } = this.context();
    this.commit(project, this.service.setVolume(project, { shotId, clipId, volume }), 'Change standalone audio gain');
  }

  remove(clipId: string): void {
    const { project, shotId } = this.context();
    this.commit(project, this.service.remove(project, { shotId, clipId }), 'Delete standalone audio');
  }

  private commit(project: Project, next: Project, label: string): void {
    if (next !== project) this.editor.updateProject(next, label);
  }

  private context(): { project: Project; shotId: string } {
    const project = this.editor.getSnapshot()?.project;
    const shotId = this.shots.getCurrentShotId();
    if (!project || !shotId) throw new Error('Open a Project and select a Shot before authoring audio.');
    return { project, shotId };
  }
}

export const audioClipStore = new AudioClipStore(editorProjectStore, shotStore, new AudioClipService(), audioClipSelectionStore);
