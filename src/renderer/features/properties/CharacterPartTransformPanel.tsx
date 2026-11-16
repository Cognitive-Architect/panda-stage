import { useLayoutEffect, useRef, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { CHARACTER_PART_MIN_SCALE, CHARACTER_PART_MAX_SCALE, NEUTRAL_CHARACTER_MOTION, isValidFrameTime, type CharacterMotionInput } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button, DecorativeIcon } from '../../ui';
import { CharacterMotionGesture } from '../canvas/characterMotionGesture';
import { timelineUiStore } from '../timeline/timelineUiStore';

// Match the existing compact Layer Transform's 10% / 15° increments.
const SCALE_STEP_PERCENT = 10;
const ROTATION_STEP_DEG = 15;
type Draft = { x: string; y: string; scale: string; rotation: string };
const neutralDraft: Draft = { x: '0', y: '0', scale: '100', rotation: '0' };

/** UI drafts only; Stage and every Inspector action share the same gesture/facade. */
export function CharacterPartTransformPanel({ input, locked, revision }: { input: CharacterMotionInput; locked: boolean; revision: number }) {
  const isCurrent = () => selectionStore.getSelectedLayerId() === input.layerId &&
    selectionStore.getSelectedCharacterPartId() === input.partId && shotStore.getCurrentShotId() === input.shotId &&
    timelineUiStore.getSnapshot().currentTimeMs === input.timeMs && timelineUiStore.getSnapshot().characterMotionAutoKey === input.autoKey;
  const readContext = () => {
    try { return { values: new CharacterMotionGesture(editorProjectStore, input, isCurrent).values, error: '' }; }
    catch { return { values: null, error: '默认姿势中已没有此部件，请开启自动关键帧编辑已有动画。' }; }
  };
  const [context, setContext] = useState(readContext);
  const draftForContext = (current: typeof context): Draft => {
    const values = current.values ?? NEUTRAL_CHARACTER_MOTION;
    return { x: String(values['transform.offsetX']), y: String(values['transform.offsetY']),
      scale: String(Number((values['transform.scaleX'] * 100).toFixed(3))), rotation: String(values['transform.rotationDeg']) };
  };
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
      const current = reset ? neutralDraft : { ...draftRef.current, ...override };
      if (Object.values(current).some(v => !v.trim() || !Number.isFinite(Number(v)))) throw new Error('请输入有效的变换数值。');
      if (edited.has('scale') && (Number(current.scale) < CHARACTER_PART_MIN_SCALE * 100 || Number(current.scale) > CHARACTER_PART_MAX_SCALE * 100)) {
        throw new Error(`缩放范围为 ${CHARACTER_PART_MIN_SCALE * 100}%～${CHARACTER_PART_MAX_SCALE * 100}%。`);
      }
      const session = gesture.current ?? new CharacterMotionGesture(editorProjectStore, input, isCurrent);
      gesture.current = null;
      const ratio = Number(current.scale) / 100 / session.values['transform.scaleX'];
      session.commit(reset ? NEUTRAL_CHARACTER_MOTION : {
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
      ? Math.max(CHARACTER_PART_MIN_SCALE * 100, Math.min(CHARACTER_PART_MAX_SCALE * 100, Number(value) + direction * SCALE_STEP_PERCENT))
      : Number(value) + direction * ROTATION_STEP_DEG;
    commit({ [key]: String(Number(next.toFixed(8))) });
  };
  const field = (key: keyof Draft, label: string) => <input inputMode="decimal" disabled={disabled} value={draft[key]} aria-label={label}
    title={locked ? '请先在角色整体中解锁图层。' : undefined}
    onFocus={() => { gesture.current ??= new CharacterMotionGesture(editorProjectStore, input, isCurrent); }}
    onChange={event => { fields.current.add(key); setDraftValue({ ...draftRef.current, [key]: event.target.value }); }}
    onBlur={event => { if (!(event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest('[data-character-motion-action]'))) commit(); }}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); fields.current.clear(); gesture.current = null; setDraftValue(draftForContext(context)); setError(context.error); event.currentTarget.blur(); }
    }} />;
  const actionPointerDown = (event: React.PointerEvent) => event.preventDefault();
  return <section className="layer-transform-panel character-part-transform" data-compact="true" data-testid="character-part-transform-panel" data-part-id={input.partId}>
    <form onSubmit={event => { event.preventDefault(); commit(); }} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit();
    }}>
      <div className="layer-transform-control-row layer-transform-position-row">
        <span className="layer-transform-control-label">位置</span>
        <label>X{field('x', '位置 X')}</label><label>Y{field('y', '位置 Y')}</label>
      </div>
      {([['scale', '缩放', '缩放 %', '%', '缩小缩放', '放大缩放'], ['rotation', '旋转', '旋转 °', '°', '减少旋转角度', '增加旋转角度']] as const).map(([key, label, fieldLabel, unit, decrease, increase]) =>
        <div key={key} className="layer-transform-control-row layer-transform-stepper-row">
          <span className="layer-transform-control-label">{label}</span>
          <div className="layer-transform-stepper" role="group" aria-label={label}>
            <button type="button" data-character-motion-action disabled={disabled} aria-label={decrease} onPointerDown={actionPointerDown} onClick={() => step(key, -1)}>−</button>
            <label className="layer-transform-stepper-value">{field(key, fieldLabel)}<span aria-hidden="true">{unit}</span></label>
            <button type="button" data-character-motion-action disabled={disabled} aria-label={increase} onPointerDown={actionPointerDown} onClick={() => step(key, 1)}>+</button>
          </div>
        </div>)}
      <div className="layer-transform-action-row" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
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
