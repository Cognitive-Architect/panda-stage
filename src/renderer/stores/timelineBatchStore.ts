import {
  TimelineEventBatchService,
  type BatchBoundaryMode,
  type BatchLayerMotionSpanRef,
  type BatchTimelineEdit,
  type BatchTimelineEditPlan,
  type CrossTypeBatchShiftPlan,
  type InsertTimeGapPlan,
  type Project,
  type SharedAudioClipPolicy,
} from '../../domain';
import {
  EditorProjectStore,
  editorProjectStore,
} from './EditorProjectStore';
import { shotStore } from './shotStore';

export interface CurrentShotSelection {
  getCurrentShotId: () => string | null;
}

const HISTORY_LABEL: Record<BatchTimelineEdit['action'], string> = {
  shift: 'Shift timeline events',
  'unify-duration': 'Unify timeline event duration',
};

/**
 * Stateless renderer adapter for WF-07 batch time editing (action segments,
 * LayerMotion keyframe spans, and cross-type shift with timed dialogues).
 * Owns no Project, selection, or History state; every mutation commits once
 * through EditorProjectStore.updateProject.
 */
export class TimelineBatchStore {
  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly shotSelection: CurrentShotSelection,
    private readonly service: TimelineEventBatchService,
  ) {}

  plan(
    input: {
      readonly eventIds?: readonly string[];
      readonly layerMotionSpans?: readonly BatchLayerMotionSpanRef[];
      readonly edit: BatchTimelineEdit;
      readonly boundaryMode?: BatchBoundaryMode;
    },
  ): BatchTimelineEditPlan {
    const { project, shotId } = this.context();
    return this.service.plan(project, { shotId, ...input });
  }

  apply(
    input: {
      readonly eventIds?: readonly string[];
      readonly layerMotionSpans?: readonly BatchLayerMotionSpanRef[];
      readonly edit: BatchTimelineEdit;
      readonly boundaryMode?: BatchBoundaryMode;
    },
  ): void {
    const { project, shotId } = this.context();
    const next = this.service.apply(project, { shotId, ...input });
    if (next !== project) {
      this.editorStore.updateProject(next, HISTORY_LABEL[input.edit.action]);
    }
  }

  planInsertGap(input: {
    readonly atMs: number;
    readonly durationMs: number;
    readonly layerIds?: readonly string[];
    readonly sharedClipPolicy?: SharedAudioClipPolicy;
  }): InsertTimeGapPlan {
    const { project, shotId } = this.context();
    return this.service.planInsertGap(project, { shotId, ...input });
  }

  applyInsertGap(input: {
    readonly atMs: number;
    readonly durationMs: number;
    readonly layerIds?: readonly string[];
    readonly sharedClipPolicy?: SharedAudioClipPolicy;
  }): void {
    const { project, shotId } = this.context();
    const next = this.service.applyInsertGap(project, { shotId, ...input });
    if (next !== project) {
      this.editorStore.updateProject(next, 'Insert timeline gap');
    }
  }

  planCrossTypeShift(input: {
    readonly dialogueIds?: readonly string[];
    readonly eventIds?: readonly string[];
    readonly layerMotionSpans?: readonly BatchLayerMotionSpanRef[];
    readonly deltaMs: number;
    readonly sharedClipPolicy?: SharedAudioClipPolicy;
    readonly boundaryMode?: BatchBoundaryMode;
  }): CrossTypeBatchShiftPlan {
    const { project, shotId } = this.context();
    return this.service.planCrossTypeShift(project, { shotId, ...input });
  }

  applyCrossTypeShift(input: {
    readonly dialogueIds?: readonly string[];
    readonly eventIds?: readonly string[];
    readonly layerMotionSpans?: readonly BatchLayerMotionSpanRef[];
    readonly deltaMs: number;
    readonly sharedClipPolicy?: SharedAudioClipPolicy;
    readonly boundaryMode?: BatchBoundaryMode;
  }): void {
    const { project, shotId } = this.context();
    const next = this.service.applyCrossTypeShift(project, { shotId, ...input });
    if (next !== project) {
      this.editorStore.updateProject(next, 'Batch shift timeline items');
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
