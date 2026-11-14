import { useState } from 'react';
import Konva from 'konva';
import { resolveFlaGraphicInternalAuthoringState, type EvaluatedFlaGraphicNode } from '../../../domain';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { useTimelineUi } from '../timeline/timelineUiStore';
import { evaluateFlaGraphicProjectionVisual } from '../canvas/FlaGraphicStructureProjection';
import { getFlaGraphicNodeAtPath, flaGraphicNodeCanTransform, resolveFlaGraphicExitScopeTransition } from '../canvas/flaGraphicEditScope';
import { useStructuredGraphicSelection } from './useStructuredGraphicSelection';

export function FlaGraphicChildTransform(): React.JSX.Element | null {
  const { target, scope, path } = useStructuredGraphicSelection();
  const time = useTimelineUi();
  const [error, setError] = useState('');
  if (!target || !scope || !path?.length) return null;
  const node = getFlaGraphicNodeAtPath(target.frame, path, target.animation.structure);
  if (!node) return null;
  const internal = scope.editMode === 'definition' && Boolean(time.flaGraphicInternalContext?.timelineAuthoringActive);
  const internalTimeMs = internal ? time.flaGraphicInternalContext?.internalTimeMs ?? 0 : undefined;
  const visual = evaluateFlaGraphicProjectionVisual({ definition: target.animation, frameOrdinal: scope.frameOrdinal, editMode: scope.editMode,
    internalTimeMs, timelineAuthoringActive: internal, instanceTransformOverrides: target.layer.flaGraphicInstanceTransformOverrides, draftMatrices: {} });
  const find = (nodes: readonly EvaluatedFlaGraphicNode[]): EvaluatedFlaGraphicNode | undefined => {
    for (const candidate of nodes) { if (JSON.stringify(candidate.path) === JSON.stringify(path)) return candidate; const child = find(candidate.children); if (child) return child; }
    return undefined;
  };
  const matrix = find(visual?.layers?.flatMap(layer => layer.nodes) ?? [])?.localTransform ?? node.localTransform;
  const decomposition = new Konva.Transform([matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]).decompose();
  const editable = !target.layer.locked && flaGraphicNodeCanTransform(node) && (!internal || resolveFlaGraphicInternalAuthoringState({
    structure: target.animation.structure, frameOrdinal: scope.frameOrdinal, nodePath: path, internalTimeMs: internalTimeMs ?? 0, timelineAuthoringActive: true,
  }).canEditTransform);
  const commit = (form: HTMLFormElement) => {
    if (!editable) return;
    const values = new FormData(form);
    const originals = [decomposition.x, decomposition.y, decomposition.scaleX * 100, decomposition.scaleY * 100, decomposition.rotation];
    const numbers = ['x', 'y', 'scaleX', 'scaleY', 'rotation'].map((key, index) => {
      const raw = String(values.get(key) ?? '').trim();
      const number = raw ? Number(raw) : NaN;
      return number === Number(originals[index]!.toFixed(3)) ? originals[index]! : number;
    });
    if (!numbers.every(Number.isFinite)) { setError('请输入有效数值。'); return; }
    const [x, y, scaleX, scaleY, rotation] = numbers as [number, number, number, number, number];
    const transform = new Konva.Transform(); transform.translate(x, y); transform.rotate(rotation * Math.PI / 180);
    transform.skew(decomposition.skewX, decomposition.skewY); transform.scale(scaleX / 100, scaleY / 100);
    const [a, b, c, d, tx, ty] = transform.getMatrix() as [number, number, number, number, number, number];
    const next = { a, b, c, d, tx, ty };
    if (Object.keys(next).every(key => Math.abs(next[key as keyof typeof next] - matrix[key as keyof typeof matrix]) < 1e-9)) return;
    try {
      if (scope.editMode === 'instance') layerStore.updateFlaGraphicInstanceTransform(target.layerId, scope.frameOrdinal, path, next);
      else if (internal) layerStore.updateFlaGraphicTimelineKeyframeTransform(target.layerId, scope.frameOrdinal, path, internalTimeMs ?? 0, next);
      else layerStore.updateFlaGraphicSharedDefinitionTransform(target.layerId, scope.frameOrdinal, path, next);
      setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '变换失败。'); }
  };
  return <form className="fla-child-transform" data-testid="fla-child-transform" key={`${target.key}:${JSON.stringify(path)}:${JSON.stringify(matrix)}`}
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      const transition = resolveFlaGraphicExitScopeTransition(target.frame, scope.path, target.animation.structure);
      selectionStore.setStructuredEditScope(transition.nextScopePath ? { ...scope, path: transition.nextScopePath } : null);
      selectionStore.setSelectedStructuredNodePath(transition.nextSelectedNodePath);
    }}
    onSubmit={event => { event.preventDefault(); commit(event.currentTarget); }}
    onBlur={event => { if (event.target instanceof HTMLInputElement) commit(event.currentTarget); }}>
    <fieldset disabled={!editable}>
      {([['x', 'X', decomposition.x], ['y', 'Y', decomposition.y], ['scaleX', '缩放 X %', decomposition.scaleX * 100], ['scaleY', '缩放 Y %', decomposition.scaleY * 100], ['rotation', '旋转 °', decomposition.rotation]] as const).map(([name, label, value]) =>
        <label key={name}>{label}<input aria-label={label} name={name} type="number" step="any" defaultValue={Number(value.toFixed(3))} /></label>)}
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}
