import {
  ACTION_PRESET_BY_ID,
  applyPresetEvents,
  createPresetEvents,
  validatePresetApplication,
  type ActionPresetId,
  type CreatePresetEventsParams,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';

export interface ApplyPresetResult {
  ok: boolean;
  errors?: string[];
}

/**
 * Bridge between the UI and the domain layer. It reads the current editor
 * selection, builds the preset events, validates them, and — only when valid —
 * appends them through `editorProjectStore.updateProject` so the change is
 * recorded by history (undo/redo for free). Invalid or locked selections are
 * rejected without producing a revision.
 */
export class ActionPresetStore {
  apply(
    presetId: ActionPresetId,
    params: CreatePresetEventsParams = {},
  ): ApplyPresetResult {
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot) {
      return { ok: false, errors: ['尚未打开项目。'] };
    }
    const shotId = shotStore.getCurrentShotId();
    if (!shotId) {
      return { ok: false, errors: ['请先选择一个镜头。'] };
    }
    const layerId = selectionStore.getSelectedLayerId();
    if (!layerId) {
      return { ok: false, errors: ['请先选择一个非背景图层。'] };
    }

    const project = snapshot.project;
    const shot = project.shots.find((candidate) => candidate.id === shotId);
    const layer = shot?.layers.find((candidate) => candidate.id === layerId);
    if (!shot || !layer) {
      return { ok: false, errors: ['当前镜头或图层已不存在。'] };
    }
    if (shot.backgroundLayerId === layerId) {
      return { ok: false, errors: ['背景图层不能应用动作预设。'] };
    }
    if (layer.locked) {
      return { ok: false, errors: ['该图层已锁定，无法应用动作预设。'] };
    }

    let events;
    try {
      events = createPresetEvents(project, shotId, layerId, presetId, params);
    } catch (error) {
      return {
        ok: false,
        errors: [error instanceof Error ? error.message : '无法生成事件。'],
      };
    }

    const validation = validatePresetApplication(
      project,
      shotId,
      layerId,
      events,
    );
    if (!validation.ok) {
      return validation;
    }

    const next = applyPresetEvents(project, shotId, events);
    editorProjectStore.updateProject(
      next,
      `应用动作预设：${ACTION_PRESET_BY_ID[presetId].label}`,
    );
    return { ok: true };
  }
}

export const actionPresetStore = new ActionPresetStore();
