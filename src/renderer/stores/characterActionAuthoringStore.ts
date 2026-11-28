import {
  deleteCharacterActionEvent,
  duplicateCharacterActionForInstance,
  revertCharacterActionForInstance,
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

  /** Replace one segment's shared action with an independent, instance-scoped copy. */
  copyForInstance(eventId: string): CharacterActionAuthoringResult {
    const context = this.context();
    if (!context) return { ok: false, changed: false, error: '请选择镜头中的角色图层。' };
    try {
      const next = duplicateCharacterActionForInstance(context.project, {
        shotId: context.shotId,
        layerId: context.layerId,
        eventId,
      });
      if (next.project === context.project) return { ok: true, changed: false };
      editorProjectStore.updateProject(next.project, '复制角色动作副本');
      return { ok: true, changed: true };
    } catch (error) {
      return { ok: false, changed: false, error: error instanceof Error ? error.message : '无法复制角色动作副本。' };
    }
  }

  /** Point one segment back at its original shared action. */
  revertFromInstance(eventId: string): CharacterActionAuthoringResult {
    const context = this.context();
    if (!context) return { ok: false, changed: false, error: '请选择镜头中的角色图层。' };
    try {
      const next = revertCharacterActionForInstance(context.project, {
        shotId: context.shotId,
        layerId: context.layerId,
        eventId,
      });
      if (next === context.project) return { ok: true, changed: false };
      editorProjectStore.updateProject(next, '恢复共享角色动作');
      return { ok: true, changed: true };
    } catch (error) {
      return { ok: false, changed: false, error: error instanceof Error ? error.message : '无法恢复共享角色动作。' };
    }
  }
}

export const characterActionAuthoringStore = new CharacterActionAuthoringStore();
