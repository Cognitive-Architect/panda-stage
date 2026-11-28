import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ArrowDown, ArrowUp, Clapperboard, DiamondPlus, EyeOff, Lock, MoreHorizontal, Unlock } from 'lucide-react';
import {
  ACTION_PRESETS, layerCompositeKeyTimes, LayerMotionService, layerMotionValues, resolveTimelineFrameTime, userMotionPresetRange,
  type ActionPresetDefinition, type Layer, type Shot,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { DecorativeIcon, IconButton } from '../../ui';
import { actionPresetStore } from '../actions/actionPresetStore';
import { PresetParameterForm } from '../actions/PresetParameterForm';
import { isLayerOrderActionDisabled } from '../properties/LayerOrderControls';
import { isLayerMotionTransformEditableAtTime } from '../properties/layerTransformTemporalGuard';
import { timelineUiStore } from '../timeline/timelineUiStore';
import type { CanvasSelectionGeometry } from './useCanvasSelectionGeometry';

const motion = new LayerMotionService();

interface CanvasObjectToolbarProps {
  geometry: CanvasSelectionGeometry;
  viewport: { width: number; height: number };
  snapshot: EditorProjectSnapshot;
  instanceId: number | null;
  shot: Shot;
  layer: Layer;
  currentTimeMs: number;
}

export function CanvasObjectToolbar({ geometry, viewport, snapshot, instanceId, shot, layer, currentTimeMs }: CanvasObjectToolbarProps): React.JSX.Element {
  const [preset, setPreset] = useState<ActionPresetDefinition | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const presetOpener = useRef<HTMLElement | null>(null);
  const narrow = viewport.width < 280;
  const controls = layer.source.kind === 'control';
  const time = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const canKey = isLayerMotionTransformEditableAtTime(snapshot.project, shot.id, layer.id, time);
  const motionPresets = canKey ? snapshot.project.userMotionPresets ?? [] : [];
  const hasKey = canKey && layerCompositeKeyTimes(layer).includes(time);
  const source = layer.source;
  const character = source.kind === 'character' ? snapshot.project.characters.find(item => item.id === source.characterId) : undefined;
  const expressions = character && (character.mode !== 'adaptive-parts' || character.faceBinding) ? character.expressions ?? [] : [];
  const presets = layer.locked || controls ? [] : ACTION_PRESETS.filter(item =>
    (!item.requiresCharacter || Boolean(character)) && (item.id !== 'expression-switch' || expressions.length > 0));
  const hasActions = presets.length > 0 || motionPresets.length > 0;
  const order = shot.layers.filter(item => item.id !== shot.backgroundLayerId).sort((a, b) => a.zIndex - b.zIndex);
  const index = order.findIndex(item => item.id === layer.id);
  const upDisabled = isLayerOrderActionDisabled('forward', index, order.length, layer.locked);
  const downDisabled = isLayerOrderActionDisabled('backward', index, order.length, layer.locked);

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node || !preset) return;
    node.showModal();
    return () => {
      node.close();
      presetOpener.current?.focus({ preventScroll: true });
    };
  }, [preset]);

  const isCurrent = (): boolean => editorProjectStore.getSnapshot()?.revision === snapshot.revision &&
    editorProjectStore.getProjectInstanceId() === instanceId && shotStore.getCurrentShotId() === shot.id &&
    selectionStore.getSelectedLayerId() === layer.id;
  const execute = (command: () => void): void => {
    if (!isCurrent()) return;
    try { command(); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法修改当前图层。'); }
  };
  const addKey = () => execute(() => {
    const frame = resolveTimelineFrameTime(timelineUiStore.getSnapshot().currentTimeMs, shot.durationMs);
    if (!isLayerMotionTransformEditableAtTime(snapshot.project, shot.id, layer.id, frame) || layerCompositeKeyTimes(layer).includes(frame)) return;
    const target = { shotId: shot.id, layerId: layer.id, timeMs: frame };
    const pose = layerMotionValues(snapshot.project, target);
    const next = motion.pastePoseSnapshot(snapshot.project, target, pose);
    if (next !== snapshot.project) editorProjectStore.updateProject(next, '添加对象动作关键帧');
  });
  const lockLabel = layer.locked ? '解锁图层' : '锁定图层';
  const lock = () => execute(() => { layerStore.setLocked(layer.id, !layer.locked); });
  const reorder = (direction: 'forward' | 'backward') => execute(() => { layerStore.reorder(layer.id, direction); });
  const hide = () => execute(() => { layerStore.setVisible(layer.id, false); });
  const presetItems = <>
    {presets.map(item => <Menu.Item key={item.id} onSelect={() => setPreset(item)}>{item.label}…</Menu.Item>)}
    {presets.length > 0 && motionPresets.length > 0 && <Menu.Separator />}
    {motionPresets.map(item => {
      let available = true;
      try { userMotionPresetRange(item, time, shot.durationMs); } catch { available = false; }
      return <Menu.Item key={item.id} disabled={!available} onSelect={() => execute(() => {
        const frame = resolveTimelineFrameTime(timelineUiStore.getSnapshot().currentTimeMs, shot.durationMs);
        const next = motion.applyUserMotionPreset(snapshot.project, { shotId: shot.id, layerId: layer.id, timeMs: frame }, item.id);
        if (next !== snapshot.project) editorProjectStore.updateProject(next, '应用运动预设');
      })}>{item.name}</Menu.Item>;
    })}
  </>;
  const { bounds } = geometry;
  const width = Math.max(0, Math.min(viewport.width - 12, narrow ? 34 :
    8 + 28 * (1 + Number(canKey) + Number(hasActions) + (layer.locked ? 0 : 2 + Number(!controls)))));
  const left = Math.max(6, Math.min(viewport.width - width - 6, bounds.x + (bounds.width - width) / 2));
  const rotation = geometry.rotationHandle;
  const upperEdge = Math.min(bounds.y, rotation ? rotation.y - 8 : bounds.y);
  const bottom = bounds.y + bounds.height;
  const lowerEdge = Math.max(bottom, rotation ? rotation.y + 8 : bottom);
  const top = Math.max(6, Math.min(viewport.height - 40, upperEdge >= 46 ? upperEdge - 40 : lowerEdge + 6));
  const button = (label: string, icon: typeof Lock, handler: () => void, disabled = false) => (
    <IconButton aria-label={label} title={label} variant="secondary" icon={<DecorativeIcon icon={icon} size={15} />}
      onClick={handler} disabled={disabled} />
  );

  return <div role="group" aria-label="选中对象操作" className="canvas-object-toolbar"
    data-testid="canvas-object-toolbar" data-layer-id={layer.id} data-canvas-interactive-chrome="true"
    style={{ left, top, width }} onKeyDown={event => {
      if (event.key === 'Delete' || event.key === 'Backspace') event.stopPropagation();
    }}>
    {narrow ? <Menu.Root>
      <Menu.Trigger asChild><IconButton ref={node => { presetOpener.current = node; }} variant="secondary" aria-label="对象操作"
        title="对象操作" icon={<DecorativeIcon icon={MoreHorizontal} size={15} />} /></Menu.Trigger>
      <Menu.Portal><Menu.Content className="workbench-menu">
        {canKey && <Menu.Item disabled={hasKey} onSelect={addKey}>添加关键帧</Menu.Item>}
        {hasActions && <Menu.Sub><Menu.SubTrigger>添加动作</Menu.SubTrigger><Menu.Portal>
          <Menu.SubContent className="workbench-menu">{presetItems}</Menu.SubContent>
        </Menu.Portal></Menu.Sub>}
        {!layer.locked && <>
          <Menu.Item disabled={upDisabled} onSelect={() => reorder('forward')}>上移图层</Menu.Item>
          <Menu.Item disabled={downDisabled} onSelect={() => reorder('backward')}>下移图层</Menu.Item>
          {!controls && <Menu.Item onSelect={hide}>隐藏图层</Menu.Item>}
        </>}
        <Menu.Item onSelect={lock}>{lockLabel}</Menu.Item>
      </Menu.Content></Menu.Portal>
    </Menu.Root> : <>
      {canKey && button('添加关键帧', DiamondPlus, addKey, hasKey)}
      {hasActions && <Menu.Root>
        <Menu.Trigger asChild><IconButton ref={node => { presetOpener.current = node; }} variant="secondary" aria-label="添加动作"
          title="添加动作" icon={<DecorativeIcon icon={Clapperboard} size={15} />} /></Menu.Trigger>
        <Menu.Portal><Menu.Content className="workbench-menu">{presetItems}</Menu.Content></Menu.Portal>
      </Menu.Root>}
      {!layer.locked && <>
        {button('上移图层', ArrowUp, () => reorder('forward'), upDisabled)}
        {button('下移图层', ArrowDown, () => reorder('backward'), downDisabled)}
        {!controls && button('隐藏图层', EyeOff, hide)}
      </>}
      {button(lockLabel, layer.locked ? Unlock : Lock, lock)}
    </>}
    {error && <div className="canvas-object-toolbar-error" role="alert">{error}</div>}
    {preset && createPortal(<dialog ref={dialog} className="canvas-object-preset-dialog" aria-label={preset.label}
      onCancel={event => { event.preventDefault(); setPreset(null); }}>
      <PresetParameterForm preset={preset} characterExpressions={expressions}
        onCancel={() => setPreset(null)} onApply={params => {
          if (!isCurrent()) throw new Error('当前图层已改变，请重新选中对象。');
          const result = actionPresetStore.apply(preset.id, { ...params, startMs: timelineUiStore.getSnapshot().currentTimeMs });
          if (!result.ok) throw new Error(result.errors?.join('，') || '无法应用动作。');
          setPreset(null);
        }} />
    </dialog>, document.body)}
  </div>;
}
