import {
  TimelineEventBatchService,
  type BatchTimelineEdit,
  type BatchTimelineEditPlan,
  type Project,
} from '../../domain';
import {
  EditorProjectStore,
  editorProjectStore,
} from './EditorProjectStore';
import { shotStore } from './shotStore';

export interface CurrentShotSelection {
  getCurrentShotId: () => string | null;
}

/**
 * English History labels, matching the existing command naming used by the
 * Dialogue store. One batch is always exactly one command.
 */
const HISTORY_LABEL: Record<BatchTimelineEdit['action'], string> = {
  shift: 'Shift timeline events',
  'unify-duration': 'Unify timeline event duration',
};

/**
 * Stateless renderer adapter for the batch TimelineEvent editor. It owns no
 * Project, selection, or History state: EditorProjectStore stays the only
 * commit and undo owner, exactly like the AUTO-02 Dialogue batch move.
 */
export class TimelineBatchStore {
  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly shotSelection: CurrentShotSelection,
    private readonly service: TimelineEventBatchService,
  ) {}

  /** Read-only validation used by the Batch Adjust action preview. */
  plan(
    eventIds: readonly string[],
    edit: BatchTimelineEdit,
  ): BatchTimelineEditPlan {
    const { project, shotId } = this.context();
    return this.service.plan(project, { shotId, eventIds, edit });
  }

  /**
   * Applies one batch through the single renderer Project-write boundary. A
   * no-op returns the same Project reference, so revision, dirty and History
   * stay untouched.
   */
  apply(eventIds: readonly string[], edit: BatchTimelineEdit): void {
    const { project, shotId } = this.context();
    const next = this.service.apply(project, { shotId, eventIds, edit });
    if (next !== project) {
      this.editorStore.updateProject(next, HISTORY_LABEL[edit.action]);
    }
  }

  private context(): { project: Project; shotId: string } {
    const snapshot = this.editorStore.getSnapshot();
    const shotId = this.shotSelection.getCurrentShotId();
    if (!snapshot || !shotId) {
      throw new Error('请先打开项目并选择镜头。');
    }
    return { project: snapshot.project, shotId };
  }
}

export const timelineBatchStore = new TimelineBatchStore(
  editorProjectStore,
  shotStore,
  new TimelineEventBatchService(),
);
