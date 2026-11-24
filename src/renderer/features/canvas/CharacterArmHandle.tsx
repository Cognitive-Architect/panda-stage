import { useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { characterArmTipOnStage, planCharacterArmIk, type CharacterArmIkAddress } from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { AnimationCurveDraftDispatch } from '../timeline/AnimationCurveDraft';
import { useCharacterArmTool } from './CharacterArmTool';
import { canvasStagePointer } from './canvasStagePointer';
import './character-arm-handle.css';

type Point = ReturnType<typeof characterArmTipOnStage>;
interface Drag {
  pointerId: number;
  origin: Point;
  delta: Point;
  pendingPoint?: Point;
  frame?: number;
  seed?: number[];
  cleanup: () => void;
}

export function CharacterArmHandle({ snapshot, address }: { snapshot: EditorProjectSnapshot; address: CharacterArmIkAddress }): React.JSX.Element | null {
  const projectInstanceId = editorProjectStore.getProjectInstanceId();
  const { active } = useCharacterArmTool({ ...address, projectInstanceId });
  const dispatch = useContext(AnimationCurveDraftDispatch);
  const request = useRef<Drag | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [tipPreview, setTipPreview] = useState<Point>();
  const [error, setError] = useState('');
  const { layerId, shotId, timeMs } = address;
  const formalTip = useMemo(() => {
    if (!active) return undefined;
    try {
      return characterArmTipOnStage(snapshot.project, { layerId, shotId, timeMs });
    } catch {
      return undefined;
    }
  }, [active, layerId, shotId, timeMs, snapshot.project]);

  const clear = useCallback(() => {
    const drag = request.current;
    if (!drag) return;
    if (drag.frame !== undefined) cancelAnimationFrame(drag.frame);
    request.current = undefined;
    drag.cleanup();
    dispatch?.(null);
  }, [dispatch]);

  useEffect(() => () => clear(), [active, clear, layerId, projectInstanceId, shotId, snapshot.revision, timeMs]);

  function cancel(): void {
    clear();
    setTipPreview(undefined);
    setDragging(false);
  }

  useEffect(() => {
    if (!dragging) return;
    function cancelFromWindow(): void {
      clear();
      setTipPreview(undefined);
      setDragging(false);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelFromWindow();
      }
    }
    window.addEventListener('blur', cancelFromWindow);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('blur', cancelFromWindow);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [clear, dragging]);

  function start(event: PointerEvent<HTMLButtonElement>): void {
    if (!formalTip || !event.isPrimary || event.button !== 0 || request.current) return;
    const handle = event.currentTarget;
    const stage = handle.closest('[data-testid="project-canvas-stage"]');
    if (!stage) return;
    const point = canvasStagePointer(stage, event);
    if (!point) return;
    event.stopPropagation();
    event.preventDefault();
    const pointerId = event.pointerId;
    const onMove = (pointer: globalThis.PointerEvent) => move(pointer, stage);
    const onUp = (pointer: globalThis.PointerEvent) => finish(pointer, stage, true);
    const onCancel = (pointer: globalThis.PointerEvent) => finish(pointer, stage, false);
    request.current = { pointerId, origin: point, delta: { x: formalTip.x - point.x, y: formalTip.y - point.y }, cleanup: () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    } };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    handle.setPointerCapture(pointerId);
    setTipPreview(undefined);
    setDragging(true);
    setError('');
  }

  function move(event: globalThis.PointerEvent, stage: Element): void {
    const drag = request.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.pendingPoint = canvasStagePointer(stage, event);
    if (drag.frame !== undefined) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = undefined;
      const point = drag.pendingPoint;
      if (request.current !== drag || !point) return;
      try {
        const plan = planCharacterArmIk(snapshot.project, address, { x: point.x + drag.delta.x, y: point.y + drag.delta.y }, drag.seed);
        drag.seed = plan.jointAnglesDeg;
        setTipPreview(plan.tip);
        dispatch?.({ project: plan.project, projectInstanceId, revision: snapshot.revision, shotId, layerId, timeMs });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '无法预览手臂姿势。');
        cancel();
      }
    });
  }

  function finish(event: globalThis.PointerEvent, stage: Element, commit: boolean): void {
    const drag = request.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    try {
      const point = commit ? canvasStagePointer(stage, event) : undefined;
      if (point && Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) >= 1 &&
        editorProjectStore.getSnapshot() === snapshot && editorProjectStore.getProjectInstanceId() === projectInstanceId) {
        const result = planCharacterArmIk(snapshot.project, address, { x: point.x + drag.delta.x, y: point.y + drag.delta.y }, drag.seed);
        if (result.project !== snapshot.project) editorProjectStore.updateProject(result.project, '手臂摆姿势');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存手臂姿势。');
    } finally {
      cancel();
    }
  }

  if (!formalTip || !dispatch) return null;
  const tip = request.current ? tipPreview ?? formalTip : formalTip;
  return <div className="character-arm-handle" style={{ left: tip.x, top: tip.y }} data-canvas-interactive-chrome="true">
    <button type="button" aria-label="拖动手腕" title="拖动手腕" data-testid="character-arm-wrist" data-dragging={dragging}
      onPointerDown={start} onLostPointerCapture={event => {
        if (request.current?.pointerId === event.pointerId) cancel();
      }} />
    {error ? <span role="alert">{error}</span> : null}
  </div>;
}
