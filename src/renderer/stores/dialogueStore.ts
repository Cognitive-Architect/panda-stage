import {
  DialogueService,
  type ArrangeDialogueInput,
  type MoveDialogueInput,
  type Project,
  type ResizeDialogueInput,
  type SetDialogueTimingInput,
} from '../../domain';
import {
  EditorProjectStore,
  editorProjectStore,
} from './EditorProjectStore';
import { shotStore } from './shotStore';
import { timelineUiStore } from '../features/timeline/timelineUiStore';
import { dialogueSelectionStore } from './dialogueSelectionStore';

export interface CurrentShotSelection {
  getCurrentShotId: () => string | null;
}

export interface TimelineUiPointTime {
  getSnapshot: () => { currentTimeMs: number };
}

/**
 * Renderer-side owner for dialogue authoring. It pulls the current shot from the
 * ShotStore, reads the Timeline playhead as a plain point-time at commit, calls
 * the domain `DialogueService`, and funnels every mutation through
 * `EditorProjectStore.updateProject` so each action becomes exactly one History
 * command. It never mutates the project object directly and never imports the
 * Timeline store into the domain layer.
 */
export class DialogueStore {
  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly shotSelection: CurrentShotSelection,
    private readonly service: DialogueService,
    private readonly timelineUi: TimelineUiPointTime,
    private readonly dialogueSelection: {
      select: (dialogueId: string) => void;
    },
  ) {}

  create(characterId: string, text: string): string {
    const { project, shotId } = this.context();
    const pointTimeMs = this.timelineUi.getSnapshot().currentTimeMs;
    const next = this.service.create(project, {
      shotId,
      characterId,
      text,
      pointTimeMs,
    });
    this.editorStore.updateProject(next, 'Add dialogue');
    const shot = next.shots.find((candidate) => candidate.id === shotId)!;
    const created = shot.dialogues[shot.dialogues.length - 1]!;
    this.dialogueSelection.select(created.id);
    return created.id;
  }

  /**
   * Commits a batch of resolved lines as a single History command. The point-time
   * is captured once at commit, so one Undo reverts the entire batch.
   */
  createMany(
    lines: ReadonlyArray<{ characterId: string; text: string }>,
  ): void {
    if (lines.length === 0) return;
    const { project, shotId } = this.context();
    const pointTimeMs = this.timelineUi.getSnapshot().currentTimeMs;
    const next = this.service.createMany(project, {
      shotId,
      pointTimeMs,
      lines,
    });
    if (next !== project) {
      this.editorStore.updateProject(next, 'Paste dialogues');
    }
  }

  update(
    dialogueId: string,
    input: {
      characterId?: string;
      text?: string;
    },
  ): void {
    const { project, shotId } = this.context();
    const next = this.service.update(project, {
      shotId,
      dialogueId,
      ...input,
    });
    if (next !== project) {
      this.editorStore.updateProject(next, 'Edit dialogue');
    }
  }

  setTiming(dialogueId: string, startMs: number, endMs: number): void {
    const { project, shotId } = this.context();
    const input: SetDialogueTimingInput = {
      shotId,
      dialogueId,
      startMs,
      endMs,
    };
    const next = this.service.setTiming(project, input);
    if (next !== project) {
      this.editorStore.updateProject(next, 'Set dialogue timing');
    }
  }

  arrange(dialogueId: string, frameSpanMs: number): void {
    const { project, shotId } = this.context();
    const input: ArrangeDialogueInput = {
      shotId,
      dialogueId,
      frameSpanMs,
    };
    const next = this.service.arrange(project, input);
    if (next !== project) {
      this.editorStore.updateProject(next, 'Arrange dialogue');
    }
  }

  move(dialogueId: string, deltaMs: number): void {
    const { project, shotId } = this.context();
    const input: MoveDialogueInput = { shotId, dialogueId, deltaMs };
    const next = this.service.move(project, input);
    if (next !== project) this.editorStore.updateProject(next, 'Move dialogue');
  }

  resize(
    dialogueId: string,
    edge: ResizeDialogueInput['edge'],
    timeMs: number,
  ): void {
    const { project, shotId } = this.context();
    const input: ResizeDialogueInput = { shotId, dialogueId, edge, timeMs };
    const next = this.service.resize(project, input);
    if (next !== project) {
      this.editorStore.updateProject(next, 'Resize dialogue');
    }
  }

  remove(dialogueId: string): void {
    const { project, shotId } = this.context();
    const next = this.service.remove(project, shotId, dialogueId);
    if (next !== project) {
      this.editorStore.updateProject(next, 'Delete dialogue');
    }
  }

  private context(): {
    project: Project;
    projectRoot: string;
    shotId: string;
  } {
    const snapshot = this.editorStore.getSnapshot();
    const shotId = this.shotSelection.getCurrentShotId();
    if (!snapshot || !shotId) {
      throw new Error('请先打开项目并选择镜头。');
    }
    return {
      project: snapshot.project,
      projectRoot: snapshot.projectRoot,
      shotId,
    };
  }
}

export const dialogueStore = new DialogueStore(
  editorProjectStore,
  shotStore,
  new DialogueService(),
  timelineUiStore,
  dialogueSelectionStore,
);
