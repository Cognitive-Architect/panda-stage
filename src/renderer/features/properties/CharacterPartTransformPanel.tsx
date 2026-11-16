import { useRef, useState } from 'react';
import { CHARACTER_PART_MIN_SCALE, CHARACTER_PART_MAX_SCALE, NEUTRAL_CHARACTER_MOTION, isValidFrameTime, type CharacterMotionInput } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Field } from '../../ui';
import { CharacterMotionGesture } from '../canvas/characterMotionGesture';
import { timelineUiStore } from '../timeline/timelineUiStore';

/** A local draft; the same gesture/facade as Stage owns the sole Project commit. */
export function CharacterPartTransformPanel({ input, locked }: { input: CharacterMotionInput; locked: boolean }) {
  const isCurrent = () => selectionStore.getSelectedLayerId() === input.layerId &&
    selectionStore.getSelectedCharacterPartId() === input.partId && shotStore.getCurrentShotId() === input.shotId &&
    timelineUiStore.getSnapshot().currentTimeMs === input.timeMs && timelineUiStore.getSnapshot().characterMotionAutoKey === input.autoKey;
  const gesture = useRef<CharacterMotionGesture | null>(null);
  const [initialContext] = useState(() => {
    try { return { values: new CharacterMotionGesture(editorProjectStore, input, isCurrent).values, error: '' }; }
    catch { return { values: null, error: '默认姿势中已没有此部件，请开启自动关键帧编辑已有动画。' }; }
  });
  const initial = initialContext.values ?? NEUTRAL_CHARACTER_MOTION;
  const [draft, setDraft] = useState({ x: String(initial['transform.offsetX']), y: String(initial['transform.offsetY']),
    scale: String(Number((initial['transform.scaleX'] * 100).toFixed(3))), rotation: String(initial['transform.rotationDeg']) });
  const draftRef = useRef(draft);
  const changed = useRef(false);
  const fields = useRef(new Set<keyof typeof draft>());
  const [error, setError] = useState(initialContext.error);
  const disabled = locked || !isValidFrameTime(input.timeMs) || !initialContext.values;
  const commit = () => {
    if (!changed.current || disabled) return;
    try {
      const current = draftRef.current;
      if (Object.values(current).some(v => !v.trim() || !Number.isFinite(Number(v)))) throw new Error('请输入有效的变换数值。');
      if (fields.current.has('scale') && (Number(current.scale) < CHARACTER_PART_MIN_SCALE * 100 || Number(current.scale) > CHARACTER_PART_MAX_SCALE * 100)) {
        throw new Error(`缩放范围为 ${CHARACTER_PART_MIN_SCALE * 100}%～${CHARACTER_PART_MAX_SCALE * 100}%。`);
      }
      const session = gesture.current ?? new CharacterMotionGesture(editorProjectStore, input, isCurrent);
      gesture.current = null;
      const ratio = Number(current.scale) / 100 / session.values['transform.scaleX'];
      session.commit({ ...(fields.current.has('x') ? { 'transform.offsetX': Number(current.x) } : {}),
        ...(fields.current.has('y') ? { 'transform.offsetY': Number(current.y) } : {}),
        ...(fields.current.has('rotation') ? { 'transform.rotationDeg': Number(current.rotation) } : {}),
        ...(fields.current.has('scale') ? { 'transform.scaleX': Number(current.scale) / 100, 'transform.scaleY': session.values['transform.scaleY'] * ratio } : {}) });
      changed.current = false; fields.current.clear(); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : '部件编辑失败。'); }
  };
  return <section className="character-part-transform" data-testid="character-part-transform-panel" data-part-id={input.partId}>
    <h3>变换</h3>
    <form onSubmit={event => { event.preventDefault(); commit(); }} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit();
    }}>
      {([['x', '位置 X'], ['y', '位置 Y'], ['scale', '缩放 %'], ['rotation', '旋转 °']] as const).map(([key, label]) =>
        <Field key={key} label={label}><input inputMode="decimal" disabled={disabled} value={draft[key]} aria-label={label} title={locked ? '请先在角色整体中解锁图层。' : undefined}
          onFocus={() => { gesture.current ??= new CharacterMotionGesture(editorProjectStore, input, isCurrent); }}
          onChange={event => { const next = { ...draftRef.current, [key]: event.target.value }; draftRef.current = next; changed.current = true; fields.current.add(key); setDraft(next); }}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); commit(); }
            if (event.key === 'Escape') { event.preventDefault(); changed.current = false; fields.current.clear(); gesture.current = null; const reset = { x: String(initial['transform.offsetX']), y: String(initial['transform.offsetY']), scale: String(initial['transform.scaleX'] * 100), rotation: String(initial['transform.rotationDeg']) }; draftRef.current = reset; setDraft(reset); setError(''); event.currentTarget.blur(); }
          }}
        /></Field>)}
    </form>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
