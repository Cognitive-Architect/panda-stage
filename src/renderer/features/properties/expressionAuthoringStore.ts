import {
  deleteExpressionEvent,
  upsertExpressionEventAtTime,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { timelineUiStore } from '../timeline/timelineUiStore';

export interface ExpressionAuthoringResult {
  ok: boolean;
  changed: boolean;
  error?: string;
}

/** A stateless UI bridge into the existing Project and History owner. */
export class ExpressionAuthoringStore {
  private context(): {
    project: NonNullable<ReturnType<typeof editorProjectStore.getSnapshot>>['project'];
    shotId: string;
    layerId: string;
  } | null {
    const snapshot = editorProjectStore.getSnapshot();
    const shotId = shotStore.getCurrentShotId();
    const layerId = selectionStore.getSelectedLayerId();
    return snapshot && shotId && layerId
      ? { project: snapshot.project, shotId, layerId }
      : null;
  }

  setAtCurrentTime(expressionId: string): ExpressionAuthoringResult {
    const context = this.context();
    if (!context) return { ok: false, changed: false, error: '请先选择镜头中的角色。' };
    try {
      const next = upsertExpressionEventAtTime(
        context.project,
        context.shotId,
        context.layerId,
        expressionId,
        timelineUiStore.getSnapshot().currentTimeMs,
      );
      if (next === context.project) return { ok: true, changed: false };
      editorProjectStore.updateProject(next, '设置角色表情切换');
      return { ok: true, changed: true };
    } catch (error) {
      return {
        ok: false,
        changed: false,
        error: error instanceof Error ? error.message : '无法设置表情切换。',
      };
    }
  }

  delete(eventId: string): ExpressionAuthoringResult {
    const context = this.context();
    if (!context) return { ok: false, changed: false, error: '请先选择镜头中的角色。' };
    try {
      const next = deleteExpressionEvent(
        context.project,
        context.shotId,
        context.layerId,
        eventId,
      );
      editorProjectStore.updateProject(next, '删除角色表情切换');
      return { ok: true, changed: true };
    } catch (error) {
      return {
        ok: false,
        changed: false,
        error: error instanceof Error ? error.message : '无法删除表情切换。',
      };
    }
  }
}

export const expressionAuthoringStore = new ExpressionAuthoringStore();
