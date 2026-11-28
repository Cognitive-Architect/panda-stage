import * as Menu from '@radix-ui/react-dropdown-menu';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  ACTION_PRESETS,
  type ActionPresetId,
  type CreatePresetEventsParams,
  type Project,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { MoreHorizontal } from 'lucide-react';
import { Button, DecorativeIcon, IconButton } from '../../ui';
import { actionPresetStore } from './actionPresetStore';
import { isSupportedLayerMotionLayer } from '../properties/layerTransformTemporalGuard';
import { UserMotionPresetControls } from './UserMotionPresetControls';
import { AnimationSegmentControls } from './AnimationSegmentControls';
import { ActionRecipeControls } from './ActionRecipeControls';
import { AudioMotionControls } from './AudioMotionControls';
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
export function ActionPresetPanel({ onPreview, compact = false, query = '', grid = false, viewToggle }: {
  onPreview?: (project: Project) => void;
  compact?: boolean;
  query?: string;
  grid?: boolean;
  viewToggle?: ReactNode;
}): React.JSX.Element {
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
  const [selection, setSelection] = useState<ActionPresetId | null>(null);
  const [context, setContext] = useState<ActionPresetId | null>(null);
  const [formTarget, setFormTarget] = useState('');
  const form = useRef<HTMLDivElement>(null);
  const target = JSON.stringify([editorProjectStore.getProjectInstanceId(), shotId, selectedLayerId]);
  const openPreset = (id: ActionPresetId) => {
    setFormTarget(target);
    setActivePresetId(id);
  };
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
    const character = project.characters.find(
      (candidate) => candidate.id === characterId,
    );
    if (!character || (character.mode === 'adaptive-parts' && !character.faceBinding)) {
      return [];
    }
    return (character.expressions ?? []).map((expression) => ({
          id: expression.id,
          name: expression.name,
        }));
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

  const activePreset = activePresetId && formTarget === target && !presetDisabled(activePresetId)
    ? presetById(activePresetId)
    : null;
  useEffect(() => {
    if (compact && activePreset) form.current?.scrollIntoView({ block: 'nearest' });
  }, [activePreset, compact]);
  const normalizedQuery = query.trim().toLowerCase();
  const presets = ACTION_PRESETS.filter(preset => preset.label.toLowerCase().includes(normalizedQuery));
  const inactiveReason = !layer || isBackground ? '选择一个可编辑图层' : isLocked ? '图层已锁定' : undefined;

  return (
    <section
      className="action-preset-panel"
      data-display={grid ? 'grid' : 'list'}
      data-compact={compact || undefined}
      data-testid="action-preset-panel"
      data-has-selection={String(Boolean(layer) && !isBackground)}
    >
      {compact ? inactiveReason && <span>{inactiveReason}</span> : <div>
        <p className="eyebrow">动作预设</p>
        <h3>动作预设</h3>
      </div>}
      {presets.length === 0 && <span>没有匹配的动作</span>}
      <div className="action-preset-content">
        <div className="action-preset-grid">
          {presets.map((preset) => compact ? (
            <Menu.Root key={preset.id} open={context === preset.id} onOpenChange={open => setContext(open ? preset.id : null)}>
              <div className="workbench-preset-row" onContextMenu={event => {
                event.preventDefault();
                setSelection(preset.id);
                setContext(preset.id);
              }}>
                <Button variant="secondary" data-testid={`preset-${preset.id}`} aria-pressed={selection === preset.id}
                  title={presetDisabled(preset.id) ? inactiveReason ?? '需要支持此动作的角色和表情' : preset.description}
                  onClick={() => setSelection(preset.id)}
                  onDoubleClick={() => { if (!presetDisabled(preset.id)) openPreset(preset.id); }}>
                  {preset.label}
                </Button>
                <Menu.Trigger asChild><IconButton variant="secondary" aria-label={preset.label + '的操作'}
                  title="动作操作" icon={<DecorativeIcon icon={MoreHorizontal} />} /></Menu.Trigger>
              </div>
              <Menu.Portal><Menu.Content className="workbench-menu">
                <Menu.Item disabled={presetDisabled(preset.id)} onSelect={() => openPreset(preset.id)}>应用动作…</Menu.Item>
              </Menu.Content></Menu.Portal>
            </Menu.Root>
          ) : (
            <button
              key={preset.id}
              type="button"
              data-preset-id={preset.id}
              data-testid={`preset-${preset.id}`}
              disabled={presetDisabled(preset.id)}
              title={inactiveReason ?? preset.description}
              onClick={() => openPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {activePreset ? (
          <div ref={form}>
            <PresetParameterForm
              characterExpressions={characterExpressions}
              onApply={(params) => apply(activePreset.id, params)}
              onCancel={() => setActivePresetId(null)}
              preset={activePreset}
            />
          </div>
        ) : null}
        {snapshot && shot && layer && isSupportedLayerMotionLayer(snapshot.project, shot, layer) ? (
          <UserMotionPresetControls key={JSON.stringify([editorProjectStore.getProjectInstanceId(), shot.id, layer.id])}
            snapshot={snapshot} shot={shot} layer={layer} onPreview={onPreview} />
        ) : null}
        {project && shot && (project.animations.length || project.animationSegments?.length) ? (
          <AnimationSegmentControls key={JSON.stringify([editorProjectStore.getProjectInstanceId(), shot.id])}
            project={project} shot={shot} layer={layer} onPreview={onPreview} />
        ) : null}
        {project && shot ? <ActionRecipeControls key={editorProjectStore.getProjectInstanceId()}
          project={project} shot={shot} layer={layer} onPreview={onPreview} /> : null}
        {project && shot && layer && isSupportedLayerMotionLayer(project, shot, layer) &&
          shot.audioClips.some(({ role }) => role === 'dialogue') ? (
            <AudioMotionControls key={JSON.stringify([editorProjectStore.getProjectInstanceId(), shot.id, layer.id])}
              shot={shot} layer={layer} onPreview={onPreview} />
          ) : null}
        <output data-testid="action-preset-status">{compact && status === '选择图层后应用动作预设。' ? '' : status}</output>
      </div>
      {compact && <div className="workbench-asset-footer">
        {viewToggle}
        <Button variant="primary" disabled={!selection || presetDisabled(selection) || !presets.some(preset => preset.id === selection)}
          onClick={() => { if (selection) openPreset(selection); }}>应用动作…</Button>
      </div>}
    </section>
  );
}
