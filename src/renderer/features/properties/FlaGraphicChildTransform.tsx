import { useState } from 'react';
import Konva from 'konva';
import { FLA_STATIC_TEXT_LIMITS } from '../../../shared/fla-static-text';
import {
  findFlaShapeTweenTrackForTarget,
  listFlaShapeRegionVertices,
  resolveFlaGraphicInternalAuthoringState,
  resolveFlaGraphicTimelineTarget,
  unapplyFlaGraphicSubtreeViewBox,
  type EvaluatedFlaGraphicNode,
  type FlaShapeTweenEasing,
} from '../../../domain';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { useTimelineUi } from '../timeline/timelineUiStore';
import { getCachedFlaSvgAssetText } from '../canvas/canvasImageResources';
import { evaluateFlaGraphicProjectionVisual } from '../canvas/FlaGraphicStructureProjection';
import {
  getFlaGraphicNodeAtPath,
  flaGraphicNodeCanTransform,
  resolveFlaGraphicExitScopeTransition,
  resolveFlaGraphicNodeShapeInfo,
} from '../canvas/flaGraphicEditScope';
import { useStructuredGraphicSelection } from './useStructuredGraphicSelection';

export function FlaGraphicChildTransform(): React.JSX.Element | null {
  const {
    snapshot,
    target,
    scope,
    path,
    regionRef,
    vertexEditActive,
    selectedVertex,
  } = useStructuredGraphicSelection();
  const time = useTimelineUi();
  const [error, setError] = useState('');
  const [tweenDurationInput, setTweenDurationInput] = useState('1000');
  if (!target || !scope || !path?.length) return null;
  const node = getFlaGraphicNodeAtPath(
    target.frame,
    path,
    target.animation.structure,
    {
      shared: target.animation.flaGraphicSharedShapeOverrides,
      instance:
        scope.editMode === 'definition'
          ? undefined
          : target.layer.flaGraphicInstanceShapeOverrides,
    },
  );
  if (!node) return null;
  const editableText = scope.editMode === 'instance' && node.type === 'opaque' && node.opaqueKind === 'text'
    ? node.editableText
    : undefined;
  const textValue = editableText
    ? target.layer.flaGraphicInstanceTextOverrides?.[String(scope.frameOrdinal)]?.[JSON.stringify(path)] ??
      editableText.runs[0].characters
    : undefined;
  const internal = scope.editMode === 'definition' && Boolean(time.flaGraphicInternalContext?.timelineAuthoringActive);
  const internalTimeMs = internal ? time.flaGraphicInternalContext?.internalTimeMs ?? 0 : undefined;
  const visual = evaluateFlaGraphicProjectionVisual({
    definition: target.animation,
    frameOrdinal: scope.frameOrdinal,
    editMode: scope.editMode,
    internalTimeMs,
    timelineAuthoringActive: internal,
    instanceTransformOverrides: target.layer.flaGraphicInstanceTransformOverrides,
    instanceTextOverrides: target.layer.flaGraphicInstanceTextOverrides,
    instanceShapeOverrides:
      scope.editMode === 'definition'
        ? undefined
        : target.layer.flaGraphicInstanceShapeOverrides,
    draftMatrices: {},
  });
  const find = (nodes: readonly EvaluatedFlaGraphicNode[]): EvaluatedFlaGraphicNode | undefined => {
    for (const candidate of nodes) { if (JSON.stringify(candidate.path) === JSON.stringify(path)) return candidate; const child = find(candidate.children); if (child) return child; }
    return undefined;
  };
  const evaluatedMatrix = find(visual?.layers?.flatMap(layer => layer.nodes) ?? [])?.localTransform;
  const matrix = evaluatedMatrix ? unapplyFlaGraphicSubtreeViewBox(node, evaluatedMatrix) : node.localTransform;
  const decomposition = new Konva.Transform([matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]).decompose();
  const editable = !target.layer.locked && flaGraphicNodeCanTransform(node) && (!internal || resolveFlaGraphicInternalAuthoringState({
    structure: target.animation.structure, frameOrdinal: scope.frameOrdinal, nodePath: path, internalTimeMs: internalTimeMs ?? 0, timelineAuthoringActive: true,
  }).canEditTransform);

  const fallbackAssetId = node.type === 'opaque' ? node.fallbackAssetId : undefined;
  const fallbackAsset = fallbackAssetId
    ? snapshot?.project.assets.find(
        (candidate) => candidate.id === fallbackAssetId && candidate.kind === 'image',
      )
    : undefined;
  const svgText = fallbackAssetId
    ? getCachedFlaSvgAssetText(fallbackAssetId, fallbackAsset?.sha256)
    : undefined;
  const shapeEditInfo = resolveFlaGraphicNodeShapeInfo({
    target,
    editMode: scope.editMode,
    path,
    regionRef,
    svgText,
  });
  const activeRegion = shapeEditInfo?.activeRegion ?? null;
  const vertexHandles = activeRegion ? listFlaShapeRegionVertices(activeRegion) : [];
  const tweenStructure = target.animation.structure;
  const tweenTargetInfo =
    tweenStructure && activeRegion && !shapeEditInfo?.isExtractedSibling
      ? resolveFlaGraphicTimelineTarget(tweenStructure, scope.frameOrdinal, path)
      : null;
  const shapeTween = tweenStructure && activeRegion && tweenTargetInfo?.trackId
    ? findFlaShapeTweenTrackForTarget(tweenStructure.shapeTweenTracks, {
        nodeTrackId: tweenTargetInfo.trackId,
        ownerKind: tweenTargetInfo.ownerKind,
        ...(tweenTargetInfo.ownerSymbolDefId
          ? { ownerSymbolDefId: tweenTargetInfo.ownerSymbolDefId }
          : {}),
        regionRef: activeRegion.regionRef,
        sourceFrameOrdinal: scope.frameOrdinal,
        sourceNodePath: [...path],
      })
    : null;
  const tweenDurationMs = shapeTween
    ? shapeTween.endTimeMs - shapeTween.startTimeMs
    : 1000;
  const canCreateTween = Boolean(
    internal &&
      activeRegion &&
      !shapeEditInfo?.isExtractedSibling &&
      tweenTargetInfo?.trackId &&
      !shapeTween &&
      !target.layer.locked,
  );
  const activeVertex =
    (selectedVertex
      ? vertexHandles.find(
          (candidate) =>
            candidate.contourIndex === selectedVertex.contourIndex &&
            candidate.commandIndex === selectedVertex.commandIndex &&
            candidate.pointKind === selectedVertex.pointKind,
        )
      : undefined) ??
    vertexHandles[0] ??
    null;

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

  const handleColorChange = (color: string) => {
    if (!activeRegion || target.layer.locked) return;
    try {
      layerStore.updateFlaGraphicShapeRegionFillColor({
        layerId: target.layerId,
        frameOrdinal: scope.frameOrdinal,
        nodePath: path,
        regionRef: activeRegion.regionRef,
        mode: scope.editMode,
        color,
        svgText,
      });
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '填充色修改失败。');
    }
  };

  const handleVertexAxisCommit = (axis: 'x' | 'y', rawValue: string) => {
    if (!activeRegion || !activeVertex || target.layer.locked) return;
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) {
      setError('请输入有效的顶点坐标。');
      return;
    }
    const nextX = axis === 'x' ? numeric : activeVertex.x;
    const nextY = axis === 'y' ? numeric : activeVertex.y;
    if (Math.abs(nextX - activeVertex.x) < 1e-6 && Math.abs(nextY - activeVertex.y) < 1e-6) {
      return;
    }
    try {
      layerStore.moveFlaGraphicShapeRegionVertex({
        layerId: target.layerId,
        frameOrdinal: scope.frameOrdinal,
        nodePath: path,
        regionRef: activeRegion.regionRef,
        mode: scope.editMode,
        target: {
          contourIndex: activeVertex.contourIndex,
          commandIndex: activeVertex.commandIndex,
          pointKind: activeVertex.pointKind,
        },
        x: nextX,
        y: nextY,
        svgText,
        ...(internalTimeMs !== undefined ? { internalTimeMs } : {}),
      });
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '顶点坐标修改失败。');
    }
  };

  const resolveTweenDurationMs = (raw: string): number | null => {
    const duration = Math.round(Number(raw));
    if (!Number.isFinite(duration) || duration <= 0) {
      setError('补间时长必须为正整数毫秒。');
      return null;
    }
    return duration;
  };

  const handleCreateShapeTween = () => {
    if (!activeRegion || !internal) return;
    const durationMs = resolveTweenDurationMs(tweenDurationInput);
    if (durationMs === null) return;
    try {
      layerStore.createFlaGraphicShapeTween({
        layerId: target.layerId,
        frameOrdinal: scope.frameOrdinal,
        nodePath: path,
        regionRef: activeRegion.regionRef,
        mode: scope.editMode,
        svgText,
        startTimeMs: Math.max(0, Math.round(internalTimeMs ?? 0)),
        durationMs,
      });
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '创建形状补间失败。');
    }
  };

  const handleShapeTweenDurationCommit = (raw: string) => {
    if (!shapeTween) return;
    const durationMs = resolveTweenDurationMs(raw);
    if (durationMs === null) return;
    try {
      layerStore.updateFlaGraphicShapeTween({
        layerId: target.layerId,
        tweenId: shapeTween.tweenId,
        endTimeMs: shapeTween.startTimeMs + durationMs,
      });
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '修改补间时长失败。');
    }
  };

  const handleShapeTweenEasingChange = (easing: FlaShapeTweenEasing) => {
    if (!shapeTween) return;
    try {
      layerStore.updateFlaGraphicShapeTween({
        layerId: target.layerId,
        tweenId: shapeTween.tweenId,
        easing,
      });
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '修改补间缓动失败。');
    }
  };

  const handleDeleteShapeTween = () => {
    if (!shapeTween) return;
    try {
      layerStore.deleteFlaGraphicShapeTween({
        layerId: target.layerId,
        tweenId: shapeTween.tweenId,
      });
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '删除形状补间失败。');
    }
  };

  return <div className="fla-child-transform-wrap">
    {textValue !== undefined ? (
      <label>
        文字
        <textarea
          key={JSON.stringify([target.key, scope.frameOrdinal, path, textValue])}
          defaultValue={textValue}
          disabled={target.layer.locked}
          maxLength={FLA_STATIC_TEXT_LIMITS.maxCharsPerText}
          onBlur={event => {
            try {
              layerStore.updateFlaGraphicInstanceText(target.layerId, scope.frameOrdinal, path, event.currentTarget.value);
              setError('');
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : '替换文字失败。');
            }
          }}
        />
      </label>
    ) : null}
    <form className="fla-child-transform" data-testid="fla-child-transform" key={`${target.key}:${JSON.stringify(path)}:${JSON.stringify(matrix)}`}
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
    </form>
    {activeRegion && !target.layer.locked ? (
      <div className="fla-shape-vector-panel" data-testid="fla-shape-vector-panel">
        {shapeEditInfo?.hasUnrenderableResidue ? (
          <p className="fla-subtree-note">
            当前形状包含位图填充或受保护的复杂绘制残留，暂不支持拆区或内部矢量编辑；请选择更外层组合。
          </p>
        ) : (
          <div className="fla-shape-vector-row">
            {activeRegion.fill.kind === 'solid' && activeRegion.fill.color ? (
              <label className="fla-shape-color-field">
                <span>区域填充色</span>
                <input
                  aria-label="区域填充色"
                  data-testid="fla-shape-region-fill-color"
                  type="color"
                  value={activeRegion.fill.color}
                  onChange={(event) => handleColorChange(event.target.value)}
                />
              </label>
            ) : (
              <span className="fla-subtree-note">当前区域为非纯色填充，填充暂保持只读。</span>
            )}
            <button
              type="button"
              className="fla-subtree-stage-button"
              data-testid="fla-shape-vertex-edit-toggle"
              aria-pressed={vertexEditActive}
              disabled={activeRegion.fill.kind === 'preserved' || vertexHandles.length === 0}
              onClick={() => selectionStore.setFlaShapeVertexEditActive(!vertexEditActive)}
            >
              {vertexEditActive ? '完成路径顶点' : '编辑路径顶点'}
            </button>
          </div>
        )}
        {!shapeEditInfo?.hasUnrenderableResidue && internal && !shapeEditInfo?.isExtractedSibling && activeRegion ? (
          <div className="fla-shape-tween-row" data-testid="fla-shape-tween-row">
            {shapeTween ? (
              <>
                <output data-testid="fla-shape-tween-range">
                  形状补间 {shapeTween.startTimeMs}–{shapeTween.endTimeMs} ms
                </output>
                <label>
                  <span>时长</span>
                  <input
                    aria-label="形状补间时长"
                    data-testid="fla-shape-tween-duration"
                    key={`${shapeTween.tweenId}:${tweenDurationMs}`}
                    min={1}
                    step={1}
                    type="number"
                    defaultValue={tweenDurationMs}
                    onChange={(event) => setTweenDurationInput(event.currentTarget.value)}
                    onBlur={(event) => handleShapeTweenDurationCommit(event.currentTarget.value)}
                  />
                </label>
                <select
                  aria-label="形状补间缓动"
                  data-testid="fla-shape-tween-easing"
                  value={shapeTween.easing}
                  onChange={(event) =>
                    handleShapeTweenEasingChange(event.currentTarget.value as FlaShapeTweenEasing)
                  }
                >
                  <option value="linear">线性</option>
                  <option value="ease">平滑</option>
                  <option value="hold">保持</option>
                </select>
                <button
                  type="button"
                  className="fla-subtree-stage-button"
                  data-testid="fla-shape-tween-delete"
                  onClick={handleDeleteShapeTween}
                >
                  删除补间
                </button>
                <span className="fla-subtree-note">拖到补间起点或终点可直接编辑对应姿态</span>
              </>
            ) : tweenTargetInfo?.trackId ? (
              <>
                <label>
                  <span>时长</span>
                  <input
                    aria-label="形状补间时长"
                    data-testid="fla-shape-tween-duration"
                    min={1}
                    step={1}
                    type="number"
                    value={tweenDurationInput}
                    onChange={(event) => setTweenDurationInput(event.currentTarget.value)}
                  />
                </label>
                <button
                  type="button"
                  className="fla-subtree-stage-button"
                  data-testid="fla-shape-tween-create"
                  disabled={!canCreateTween}
                  onClick={handleCreateShapeTween}
                >
                  创建形状补间
                </button>
              </>
            ) : (
              <span className="fla-subtree-note">
                当前形状节点缺少稳定的跨帧身份，暂不支持形状补间。
              </span>
            )}
          </div>
        ) : null}
        {!shapeEditInfo?.hasUnrenderableResidue && vertexEditActive && activeVertex ? (
          <div className="fla-shape-vertex-fields" key={`${activeVertex.contourIndex}:${activeVertex.commandIndex}:${activeVertex.pointKind}:${activeVertex.x}:${activeVertex.y}`}>
            <label>
              <span>顶点 X</span>
              <input
                aria-label="顶点 X"
                data-testid="fla-shape-vertex-x"
                type="number"
                step="any"
                defaultValue={Number(activeVertex.x.toFixed(3))}
                onBlur={(event) => handleVertexAxisCommit('x', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>顶点 Y</span>
              <input
                aria-label="顶点 Y"
                data-testid="fla-shape-vertex-y"
                type="number"
                step="any"
                defaultValue={Number(activeVertex.y.toFixed(3))}
                onBlur={(event) => handleVertexAxisCommit('y', event.currentTarget.value)}
              />
            </label>
          </div>
        ) : null}
      </div>
    ) : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
