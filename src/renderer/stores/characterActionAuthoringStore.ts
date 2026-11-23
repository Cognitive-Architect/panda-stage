import {
  deleteCharacterActionEvent,
  upsertCharacterActionEvent,
} from '../../domain';
import { editorProjectStore } from './EditorProjectStore';
import { selectionStore } from './selectionStore';
import { shotStore } from './shotStore';

export interface CharacterActionAuthoringResult {
  ok: boolean;
  changed: boolean;
  error?: string;
}

/** Stateless bridge into the existing Project and History owner. */
export class CharacterActionAuthoringStore {
  private context() {
    const snapshot = editorProjectStore.getSnapshot();
    const shotId = shotStore.getCurrentShotId();
    const layerId = selectionStore.getSelectedLayerId();
    return snapshot && shotId && layerId
      ? { project: snapshot.project, shotId, layerId }
      : null;
  }

  upsert(actionId: string, startMs: number, endMs: number, eventId?: string): CharacterActionAuthoringResult {
    const context = this.context();
    if (!context) return { ok: false, changed: false, error: '请选择镜头中的角色图层。' };
    try {
      const next = upsertCharacterActionEvent(context.project, context.shotId, context.layerId,
        { actionId, startMs, endMs, ...(eventId ? { eventId } : {}) });
      if (next === context.project) return { ok: true, changed: false };
      editorProjectStore.updateProject(next, '设置角色动作段');
      return { ok: true, changed: true };
    } catch (error) {
      return { ok: false, changed: false, error: error instanceof Error ? error.message : '无法设置角色动作段。' };
    }
  }

  delete(eventId: string): CharacterActionAuthoringResult {
    const context = this.context();
    if (!context) return { ok: false, changed: false, error: '请选择镜头中的角色图层。' };
    try {
      const next = deleteCharacterActionEvent(context.project, context.shotId, context.layerId, eventId);
      editorProjectStore.updateProject(next, '删除角色动作段');
      return { ok: true, changed: true };
    } catch (error) {
      return { ok: false, changed: false, error: error instanceof Error ? error.message : '无法删除角色动作段。' };
    }
  }
}

export const characterActionAuthoringStore = new CharacterActionAuthoringStore();
