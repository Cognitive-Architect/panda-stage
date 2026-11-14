import { useEffect, useMemo, useRef, useState } from 'react';
import { type EvaluatedFlaGraphicNode, evaluateShotAtTime, evaluateFlaGraphicVisual } from '../../../domain';
import { evaluateFlaGraphicProjectionVisual } from '../canvas/FlaGraphicStructureProjection';
import { renderFlaGraphicCanvas } from '../canvas/flaGraphicCanvasRenderer';
import { CanvasImageResourceSession, EMPTY_CANVAS_IMAGE_STATE } from '../canvas/canvasImageResources';
import { useTimelineUi } from '../timeline/timelineUiStore';
import { useStructuredGraphicSelection } from './useStructuredGraphicSelection';

export function FlaGraphicInspectorPreview(): React.JSX.Element | null {
  const { snapshot, target, scope, path } = useStructuredGraphicSelection();
  const time = useTimelineUi();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState(EMPTY_CANVAS_IMAGE_STATE);
  const session = useRef<CanvasImageResourceSession | null>(null);
  const visual = useMemo(() => {
    if (!target || !snapshot) return null;
    const shot = snapshot.project.shots.find(shot => shot.id === target.shotId);
    const playback = shot ? evaluateShotAtTime(shot, time.currentTimeMs, snapshot.project).layers.find(layer => layer.id === target.layerId) : null;
    return scope ? evaluateFlaGraphicProjectionVisual({ definition: target.animation, frameOrdinal: scope.frameOrdinal,
      editMode: scope.editMode, internalTimeMs: scope.editMode === 'definition' && time.flaGraphicInternalContext?.timelineAuthoringActive ? time.flaGraphicInternalContext.internalTimeMs : undefined,
      instanceTransformOverrides: target.layer.flaGraphicInstanceTransformOverrides, draftMatrices: {} })
      : evaluateFlaGraphicVisual({ definition: target.animation, frameOrdinal: playback?.animationFrame?.frameOrdinal ?? 0,
        internalTimeMs: playback?.animationFrame?.internalTimeMs, mode: 'instance', instanceTransformOverrides: target.layer.flaGraphicInstanceTransformOverrides });
  }, [target?.key, target?.layer, snapshot, scope, time.currentTimeMs, time.flaGraphicInternalContext]);
  useEffect(() => {
    const resourceSession = new CanvasImageResourceSession(); session.current = resourceSession;
    return () => { resourceSession.dispose(); if (session.current === resourceSession) session.current = null; };
  }, []);
  useEffect(() => {
    if (!snapshot || !target) return;
    const ids = new Set([...(visual?.resourceAssetIds ?? []), target.animation.frames.find(frame => frame.ordinal === visual?.frameOrdinal)?.assetId]);
    session.current?.reconcile({ contextKey: target.sessionKey, projectRoot: snapshot.projectRoot,
      assets: snapshot.project.assets.filter(asset => asset.kind === 'image' && ids.has(asset.id)) }, setImages);
  }, [snapshot, target?.key, visual]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    canvas.width = 660; canvas.height = 290;
    if (!visual) return;
    // Keep ancestor composites/clips while narrowing display to the selected occurrence.
    const focus = (nodes: readonly EvaluatedFlaGraphicNode[]): EvaluatedFlaGraphicNode[] => nodes.flatMap(node => {
      if (!scope || !path?.length || path.every((id, index) => node.path[index] === id)) return [node];
      if (node.path.every((id, index) => path[index] === id)) return [{ ...node, children: focus(node.children) }];
      return [];
    });
    const focused = scope && path?.length && visual.layers ? { ...visual, layers: visual.layers.map(layer => ({ ...layer, nodes: focus(layer.nodes) })) } : visual;
    const ready = visual.resourceAssetIds.every(id => images.images.has(id));
    const raster = ready ? renderFlaGraphicCanvas(focused, images.images, 1) : null;
    const fallbackId = target?.animation.frames.find(frame => frame.ordinal === visual.frameOrdinal)?.assetId;
    const source = raster?.canvas ?? (fallbackId ? images.images.get(fallbackId) : null);
    if (!source) return;
    let crop = { x: 0, y: 0, width: source.width, height: source.height };
    if (raster && scope && path?.length) {
      const pixels = raster.canvas.getContext('2d')?.getImageData(0, 0, source.width, source.height).data;
      if (pixels) {
        let left = source.width, top = source.height, right = -1, bottom = -1;
        for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
          if (pixels[(y * source.width + x) * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
        }
        if (right >= left) crop = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
      }
    }
    const scale = Math.min(620 / Math.max(1, crop.width), 250 / Math.max(1, crop.height));
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height,
      (660 - crop.width * scale) / 2, (290 - crop.height * scale) / 2, crop.width * scale, crop.height * scale);
  }, [visual, images, path, scope, target?.key]);
  const loading = Boolean(visual && visual.resourceAssetIds.some(id => !images.images.has(id)) && !images.images.has(target?.animation.frames.find(frame => frame.ordinal === visual.frameOrdinal)?.assetId ?? ''));
  return target ? <div className="fla-inspector-preview" aria-busy={loading} data-testid="fla-inspector-preview"><canvas ref={canvasRef} aria-label="元件预览" role="img" /></div> : null;
}
