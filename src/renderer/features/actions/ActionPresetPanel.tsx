import { useState } from 'react';
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
    const result = actionPresetStore.apply(id, params);
    if (result.ok) {
      setStatus(`已应用：${presetById(id).label}`);
      setActivePresetId(null);
    } else {
      setStatus(result.errors?.join('；') ?? '应用失败。');
    }
  };

  const activePreset = activePresetId ? presetById(activePresetId) : null;

  return (
    <section
      className="action-preset-panel"
      data-testid="action-preset-panel"
      data-has-selection={String(Boolean(layer) && !isBackground)}
    >
      <div>
        <p className="eyebrow">Day 25 action presets</p>
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
    </section>
  );
}
