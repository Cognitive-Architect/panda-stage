import { useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';
import {
  ACTION_PRESETS,
  type ActionPresetId,
  type CreatePresetEventsParams,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { actionPresetStore } from './actionPresetStore';
import { editorActionPreviewStore } from './editorActionPreviewStore';
import { useEditorActionPreview } from './useEditorActionPreview';
import { previewWindowFromEvents } from './editorActionPreviewModel';
import {
  PresetParameterForm,
  type ExpressionOption,
} from './PresetParameterForm';

function presetById(id: ActionPresetId) {
  return ACTION_PRESETS.find((preset) => preset.id === id)!;
}

/**
 * Day 25 action preset panel. Reads the current editor selection and exposes
 * the eight presets. Buttons disable when nothing is selected, the selection
 * is the background or a locked layer, or (for expression presets) the layer
 * is not a character. Application is delegated entirely to the bridge store,
 * which routes through history; this component never manipulates the stage.
 */
export function ActionPresetPanel(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
    editorProjectStore.getSnapshot,
  );
  const selectedLayerId = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
    selectionStore.getSelectedLayerId,
  );
  const shotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
    shotStore.getCurrentShotId,
  );
  const preview = useEditorActionPreview();

  useEffect(
    () => () => {
      // The formal owner is keyed by project root. Drop a retained Apply or
      // Replay session whenever that owner is replaced or closed.
      editorActionPreviewStore.stop();
    },
    [],
  );

  const project = snapshot?.project ?? null;
  const shot = project?.shots.find((candidate) => candidate.id === shotId) ?? null;
  const layer = shot?.layers.find((candidate) => candidate.id === selectedLayerId) ?? null;

  const [activePresetId, setActivePresetId] = useState<ActionPresetId | null>(
    null,
  );
  const [status, setStatus] = useState('选择图层后应用动作预设。');

  const isBackground = Boolean(
    layer && shot && shot.backgroundLayerId === layer.id,
  );
  const isLocked = Boolean(layer?.locked);
  const isCharacter = layer?.source.kind === 'character';

  const characterExpressions: readonly ExpressionOption[] = (() => {
    if (layer?.source.kind !== 'character' || !project) {
      return [];
    }
    const characterId = layer.source.characterId;
    return (
      project.characters
        .find((candidate) => candidate.id === characterId)
        ?.expressions.map((expression) => ({
          id: expression.id,
          name: expression.name,
        })) ?? []
    );
  })();

  const presetDisabled = (id: ActionPresetId): boolean => {
    if (!layer || isBackground || isLocked) {
      return true;
    }
    const preset = presetById(id);
    if (preset.requiresCharacter && !isCharacter) {
      return true;
    }
    if (id === 'expression-switch' && characterExpressions.length === 0) {
      return true;
    }
    return false;
  };

  const apply = (id: ActionPresetId, params: CreatePresetEventsParams): void => {
    const targetShotId = shotId;
    const targetLayerId = selectedLayerId;
    const beforeCount = shot?.timelineEvents.length ?? 0;
    const result = actionPresetStore.apply(id, params);
    if (!result.ok) {
      setStatus(result.errors?.join('；') ?? '应用失败。');
      return;
    }
    setStatus(`已应用：${presetById(id).label}`);
    setActivePresetId(null);
    // Trigger a bounded, transient editor preview of exactly the action that was
    // just written. This never touches the project, revision, dirty flag or
    // history — it only drives the preview clock over the new event window.
    triggerPreviewAfterApply(targetShotId, targetLayerId, beforeCount);
  };

  /**
   * Sizes the preview to the events the last apply added and starts it. Reads
   * the post-apply snapshot (apply is synchronous) and diffs the shot's
   * timeline events so only the newly added action is previewed.
   */
  function triggerPreviewAfterApply(
    targetShotId: string | null,
    targetLayerId: string | null,
    beforeCount: number,
  ): void {
    if (!targetShotId || !targetLayerId) return;
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot) return;
    const shot = snapshot.project.shots.find(
      (candidate) => candidate.id === targetShotId,
    );
    if (!shot) return;
    const newEvents = shot.timelineEvents.slice(beforeCount);
    const window = previewWindowFromEvents(newEvents);
    if (!window) return;
    const targetLayer = shot.layers.find(
      (candidate) => candidate.id === targetLayerId,
    );
    const hasExplicitPositionEvent = newEvents.some(
      (event) => event.type === 'move',
    );
    editorActionPreviewStore.start({
      projectId: snapshot.project.id,
      shotId: targetShotId,
      layerId: targetLayerId,
      startMs: window.startMs,
      endMs: window.endMs,
      eventIds: newEvents.map((event) => event.id),
      ...(targetLayer && !hasExplicitPositionEvent
        ? { positionBaseline: { x: targetLayer.x, y: targetLayer.y } }
        : {}),
    });
  }

  const activePreset = activePresetId ? presetById(activePresetId) : null;

  return (
    <section
      className="action-preset-panel"
      data-testid="action-preset-panel"
      data-has-selection={String(Boolean(layer) && !isBackground)}
    >
      <div>
        <p className="eyebrow">动作预设</p>
        <h3>动作预设</h3>
      </div>
      <div className="action-preset-grid">
        {ACTION_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            data-preset-id={preset.id}
            data-testid={`preset-${preset.id}`}
            disabled={presetDisabled(preset.id)}
            title={preset.description}
            onClick={() => setActivePresetId(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {activePreset ? (
        <PresetParameterForm
          characterExpressions={characterExpressions}
          onApply={(params) => apply(activePreset.id, params)}
          onCancel={() => setActivePresetId(null)}
          preset={activePreset}
        />
      ) : null}
      <output data-testid="action-preset-status">{status}</output>
      {preview.active ? (
        <span
          className="action-preset-previewing"
          data-testid="action-preset-previewing"
        >
          预览中…
        </span>
      ) : null}
      {!preview.active && preview.session ? (
        <button
          type="button"
          data-testid="action-preset-replay"
          onClick={() => editorActionPreviewStore.replay()}
        >
          重播动作
        </button>
      ) : null}
    </section>
  );
}
