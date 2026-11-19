import { useLayoutEffect, useRef, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import {
  CHARACTER_NODE_MOTION_CAPABILITIES,
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  NEUTRAL_CHARACTER_MOTION,
  isValidFrameTime,
  type CharacterMotionValues,
  type CharacterNodeTransformCapabilities,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button, DecorativeIcon } from '../../ui';
import {
  CharacterMotionGesture,
  isCharacterNodeMotionInput,
  type CharacterMotionGestureInput,
} from '../canvas/characterMotionGesture';
import { timelineUiStore } from '../timeline/timelineUiStore';

// Match the existing compact Layer Transform's 10% / 15° increments.
const SCALE_STEP_PERCENT = 10;
const ROTATION_STEP_DEG = 15;
type Draft = { x: string; y: string; scale: string; rotation: string };

function draftFromValues(values: CharacterMotionValues): Draft {
  return {
    x: String(values['transform.offsetX']),
    y: String(values['transform.offsetY']),
    scale: String(Number((values['transform.scaleX'] * 100).toFixed(3))),
    rotation: String(values['transform.rotationDeg']),
  };
}

function formatScalePercent(scale: number): string {
  const pct = Number((scale * 100).toFixed(3));
  return String(pct);
}

/** UI drafts only; Stage and every Inspector action share the same gesture/facade. */
export function CharacterPartTransformPanel({
  input,
  capabilities = CHARACTER_NODE_MOTION_CAPABILITIES,
  locked,
  revision,
}: {
  input: CharacterMotionGestureInput;
  capabilities?: CharacterNodeTransformCapabilities;
  locked: boolean;
  revision: number;
}) {
  const targetId = isCharacterNodeMotionInput(input) ? input.nodeId : input.partId;
  const isCurrent = () =>
    selectionStore.getSelectedLayerId() === input.layerId &&
    shotStore.getCurrentShotId() === input.shotId &&
    timelineUiStore.getSnapshot().currentTimeMs === input.timeMs &&
    timelineUiStore.getSnapshot().characterMotionAutoKey === input.autoKey &&
    (isCharacterNodeMotionInput(input)
      ? selectionStore.getSelectedCharacterNodeId() === input.nodeId
      : selectionStore.getSelectedCharacterPartId() === input.partId);
  const readContext = () => {
    try {
      const session = new CharacterMotionGesture(editorProjectStore, input, isCurrent);
      return {
        values: session.values,
        minScale: session.minScale,
        maxScale: session.maxScale,
        resetValues: session.resetValues,
        error: '',
      };
    } catch {
      return {
        values: null,
        minScale: CHARACTER_PART_MIN_SCALE,
        maxScale: CHARACTER_PART_MAX_SCALE,
        resetValues: NEUTRAL_CHARACTER_MOTION,
        error: isCharacterNodeMotionInput(input)
          ? '无法读取当前节点变换。'
          : '默认姿势中已没有此部件，请开启自动关键帧编辑已有动画。',
      };
    }
  };
  const [context, setContext] = useState(readContext);
  const draftForContext = (current: typeof context): Draft =>
    draftFromValues(current.values ?? NEUTRAL_CHARACTER_MOTION);
  const [draft, setDraft] = useState(() => draftForContext(context));
  const draftRef = useRef(draft);
  const gesture = useRef<CharacterMotionGesture | null>(null);
  const fields = useRef(new Set<keyof Draft>());
  const seenRevision = useRef(revision);
  const [error, setError] = useState(context.error);
  const disabled = locked || !isValidFrameTime(input.timeMs) || !context.values;
  const setDraftValue = (next: Draft) => { draftRef.current = next; setDraft(next); };
  useLayoutEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    const next = readContext();
    gesture.current = null; fields.current.clear();
    setContext(next); setDraftValue(draftForContext(next)); setError(next.error);
  }, [revision]);

  const commit = (override: Partial<Draft> = {}, reset = false) => {
    if (disabled) return;
    const edited = new Set<keyof Draft>([...fields.current, ...Object.keys(override) as (keyof Draft)[]]);
    if (!edited.size && !reset) return;
    try {
      const session = gesture.current ?? new CharacterMotionGesture(editorProjectStore, input, isCurrent);
      gesture.current = null;
      const targetValues = session.resetValues;
      const current = reset ? draftFromValues(targetValues) : { ...draftRef.current, ...override };
      if (Object.values(current).some(v => !v.trim() || !Number.isFinite(Number(v)))) throw new Error('请输入有效的变换数值。');
      const minPercent = session.minScale * 100;
      const maxPercent = session.maxScale * 100;
      if (edited.has('scale') && (Number(current.scale) < minPercent - 1e-6 || Number(current.scale) > maxPercent + 1e-6)) {
        throw new Error(`缩放范围为 ${formatScalePercent(session.minScale)}%～${formatScalePercent(session.maxScale)}%。`);
      }
      const ratio = Number(current.scale) / 100 / session.values['transform.scaleX'];
      session.commit(reset ? targetValues : {
        ...(edited.has('x') ? { 'transform.offsetX': Number(current.x) } : {}),
        ...(edited.has('y') ? { 'transform.offsetY': Number(current.y) } : {}),
        ...(edited.has('rotation') ? { 'transform.rotationDeg': Number(current.rotation) } : {}),
        ...(edited.has('scale') ? { 'transform.scaleX': Number(current.scale) / 100, 'transform.scaleY': session.values['transform.scaleY'] * ratio } : {}),
      });
      fields.current.clear(); setDraftValue(current); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : '部件编辑失败。'); }
  };
  const step = (key: 'scale' | 'rotation', direction: -1 | 1) => {
    const value = draftRef.current[key];
    if (!value.trim() || !Number.isFinite(Number(value))) { setError('请输入有效的变换数值。'); return; }
    const next = key === 'scale'
      ? Math.max(context.minScale * 100, Math.min(context.maxScale * 100, Number(value) + direction * SCALE_STEP_PERCENT))
      : Number(value) + direction * ROTATION_STEP_DEG;
    commit({ [key]: String(Number(next.toFixed(8))) });
  };
  const field = (key: keyof Draft, label: string, fieldDisabled = false) => <input inputMode="decimal" disabled={disabled || fieldDisabled} value={draft[key]} aria-label={label}
    title={locked ? '请先在角色整体中解锁图层。' : undefined}
    onFocus={() => { gesture.current ??= new CharacterMotionGesture(editorProjectStore, input, isCurrent); }}
    onChange={event => { fields.current.add(key); setDraftValue({ ...draftRef.current, [key]: event.target.value }); }}
    onBlur={event => { if (!(event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest('[data-character-motion-action]'))) commit(); }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); fields.current.clear(); gesture.current = null; setDraftValue(draftForContext(context)); setError(context.error); event.currentTarget.blur(); }
    }} />;
  const actionPointerDown = (event: React.PointerEvent) => event.preventDefault();
  return <section className="layer-transform-panel character-part-transform" data-compact="true" data-testid="character-part-transform-panel" data-part-id={targetId}>
    <form onSubmit={event => { event.preventDefault(); commit(); }} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit();
    }}>
      <div className="layer-transform-control-row layer-transform-position-row">
        <span className="layer-transform-control-label">位置</span>
        <label>X{field('x', '位置 X', !capabilities.position)}</label><label>Y{field('y', '位置 Y', !capabilities.position)}</label>
      </div>
      {([
        ['scale', '缩放', '缩放 %', '%', '缩小缩放', '放大缩放', !capabilities.uniformScale],
        ['rotation', '旋转', '旋转 °', '°', '减少旋转角度', '增加旋转角度', !capabilities.rotation],
      ] as const).map(([key, label, fieldLabel, unit, decrease, increase, rowDisabled]) =>
        <div key={key} className="layer-transform-control-row layer-transform-stepper-row">
          <span className="layer-transform-control-label">{label}</span>
          <div className="layer-transform-stepper" role="group" aria-label={label}>
            <button type="button" data-character-motion-action disabled={disabled || rowDisabled} aria-label={decrease} onPointerDown={actionPointerDown} onClick={() => step(key, -1)}>−</button>
            <label className="layer-transform-stepper-value">{field(key, fieldLabel, rowDisabled)}<span aria-hidden="true">{unit}</span></label>
            <button type="button" data-character-motion-action disabled={disabled || rowDisabled} aria-label={increase} onPointerDown={actionPointerDown} onClick={() => step(key, 1)}>+</button>
          </div>
        </div>)}
      <div className="layer-transform-action-row" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', borderTop: 0, paddingTop: 0 }}>
        <Button type="button" data-character-motion-action variant="secondary" disabled={disabled} onPointerDown={actionPointerDown} onClick={() => commit({}, true)}>
          <span className="ui-icon-label"><DecorativeIcon icon={RotateCcw} size={16} /><span>重置变换</span></span>
        </Button>
        <Button type="submit" data-character-motion-action variant="primary" disabled={disabled} onPointerDown={actionPointerDown}>
          <span className="ui-icon-label"><DecorativeIcon icon={Check} size={16} /><span>应用变换</span></span>
        </Button>
      </div>
    </form>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
