import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type Konva from 'konva';
import { Group, Image as KonvaImage, Layer, Stage, Text } from 'react-konva';
import type { EvaluatedShot, Project } from '../../domain';
import type { SubtitleStyle } from '../../domain';
import {
  buildStageRenderModel,
  type StageAssetUrlMap,
  type StageRenderPart,
  type StageRenderLayer,
} from '../../shared/stage/render-model';
import { SubtitleRenderer } from '../features/subtitles/SubtitleRenderer';
import {
  configureKonvaScenePixelRatio,
  PREVIEW_CANVAS_PIXEL_RATIO,
} from './konva-pixel-ratio';
import {
  buildStageImageSourceKey,
  EMPTY_STAGE_IMAGE_RESOURCE_STATE,
  isStageFrameReady,
  StageImageResourceSession,
  type StageImageLayerSource,
  type StageImageResourceFailure,
  type StageImageResourceState,
} from './stageImageResourceSession';
import {
  commitStageVisualFrame,
  selectStageVisualFrame,
  type StageVisualFrame,
} from './stageVisualFrame';

interface StageRendererProps {
  project: Project;
  evaluatedShot: EvaluatedShot;
  assetUrls: StageAssetUrlMap;
  caption: string | null;
  captionStyle?: SubtitleStyle;
  onReady?: () => void;
  /** Fires when a complete drawable frame exists, including an intentional Preview fallback. */
  onDisplayReady?: () => void;
  onError?: (error: Error) => void;
  onImageResourceFailure?: (failure: StageImageResourceFailure) => void;
  renderToken?: string | number;
  /** Degraded Preview is drawable, but never exact-frame ready for Export. */
  degraded?: boolean;
}

function useStageImages(
  layers: readonly StageRenderLayer[],
  sourceKey: string,
): StageImageResourceState {
  const sessionRef = useRef<StageImageResourceSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new StageImageResourceSession();
  }
  const [state, setState] = useState<StageImageResourceState>(
    () => sessionRef.current?.getSnapshot() ?? EMPTY_STAGE_IMAGE_RESOURCE_STATE,
  );
  const layerSourcesRef = useRef<{
    key: string;
    layers: readonly StageImageLayerSource[];
  }>({ key: '', layers: [] });
  if (layerSourcesRef.current.key !== sourceKey) {
    layerSourcesRef.current = {
      key: sourceKey,
      layers: buildStagePartSources(layers),
    };
  }

  useEffect(() => {
    let session = sessionRef.current;
    if (!session || session.isDisposed()) {
      session = new StageImageResourceSession();
      sessionRef.current = session;
    }
    session.reconcile(layerSourcesRef.current.layers, (nextState) => {
      setState(nextState);
    });
  }, [sourceKey]);

  useEffect(() => {
    const session = sessionRef.current;
    return () => session?.dispose();
  }, []);

  return state;
}

function buildStagePartSources(
  layers: readonly StageRenderLayer[],
): StageImageLayerSource[] {
  return layers.flatMap((layer) =>
    layer.parts.map(({ id, asset, sourceUrl }) => ({
      id,
      assetId: asset.id,
      sourceUrl,
    })),
  );
}

interface StagePartImagesProps {
  parts: readonly StageRenderPart[];
  images: ReadonlyMap<string, HTMLImageElement>;
  composite: boolean;
}

function StagePartImages({
  parts,
  images,
  composite,
}: StagePartImagesProps): React.JSX.Element {
  const visualRef = useRef<Konva.Group | null>(null);
  const orderedParts = [...parts].sort(
    (left, right) =>
      left.render.zIndex - right.render.zIndex ||
      left.drawOrder - right.drawOrder,
  );
  const complete = orderedParts.every((part) => images.has(part.id));
  useLayoutEffect(() => {
    const visual = visualRef.current;
    if (!visual) return;
    visual.clearCache();
    if (!composite || !complete || orderedParts.length < 2) return;
    const minX = Math.min(...orderedParts.map((part) => part.render.x));
    const minY = Math.min(...orderedParts.map((part) => part.render.y));
    const maxX = Math.max(
      ...orderedParts.map((part) => part.render.x + part.render.width),
    );
    const maxY = Math.max(
      ...orderedParts.map((part) => part.render.y + part.render.height),
    );
    if (maxX <= minX || maxY <= minY) return;
    // Flatten the Body + Face overlap before the owner opacity is applied by
    // the outer Group. This preserves one logical Character alpha.
    visual.cache({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
    visual.getLayer()?.batchDraw();
  }, [complete, composite, images, orderedParts]);

  return (
    <Group listening={false} ref={visualRef}>
      {complete
        ? orderedParts.map((part) => {
            const image = images.get(part.id);
            const render = part.render;
            if (!image || !render.visible) return null;
            return (
              <KonvaImage
                height={render.height}
                image={image}
                key={part.id}
                listening={false}
                opacity={1}
                rotation={render.rotationDeg}
                scaleX={render.scaleX}
                scaleY={render.scaleY}
                width={render.width}
                x={render.x}
                y={render.y}
              />
            );
          })
        : null}
    </Group>
  );
}

export function StageRenderer({
  project,
  evaluatedShot,
  assetUrls,
  caption,
  captionStyle,
  onReady,
  onDisplayReady,
  onError,
  onImageResourceFailure,
  renderToken,
  degraded = false,
}: StageRendererProps): React.JSX.Element {
  const configurePreviewLayer = useCallback((layer: Konva.Layer | null) => {
    if (layer) {
      configureKonvaScenePixelRatio(layer, PREVIEW_CANVAS_PIXEL_RATIO);
    }
  }, []);
  const modelResult = useMemo(() => {
    try {
      return {
        model: buildStageRenderModel(project, evaluatedShot, assetUrls),
        error: null,
      };
    } catch (error) {
      return {
        model: null,
        error: error instanceof Error ? error : new Error('舞台模型无效。'),
      };
    }
  }, [assetUrls, evaluatedShot, project]);
  const layers = modelResult.model?.layers ?? [];
  const imageSourceKey = buildStageImageSourceKey(buildStagePartSources(layers));
  const desiredFrame = modelResult.model
    ? {
        model: modelResult.model,
        caption,
        captionStyle,
      }
    : null;
  const imageState = useStageImages(layers, imageSourceKey);
  const error = modelResult.error ?? imageState.error;
  const ready = isStageFrameReady({
    error,
    hasModel: modelResult.model !== null,
    imageState,
    layerCount: layers.length,
    sourceKey: imageSourceKey,
  }) && !degraded;
  const displayReady = isStageFrameReady({
    error,
    hasModel: modelResult.model !== null,
    imageState,
    layerCount: layers.length,
    sourceKey: imageSourceKey,
  });
  const committedFrameRef = useRef<StageVisualFrame | null>(null);
  useLayoutEffect(() => {
    committedFrameRef.current = commitStageVisualFrame(
      committedFrameRef.current,
      desiredFrame,
      displayReady,
    );
  }, [desiredFrame, displayReady]);
  const displayFrame = selectStageVisualFrame(
    committedFrameRef.current,
    desiredFrame,
    ready,
  );
  const committedFrame = committedFrameRef.current;
  const displayModel = displayFrame?.model ?? modelResult.model;
  const displayCaption = displayFrame?.caption ?? caption;
  const displayCaptionStyle = displayFrame?.captionStyle ?? captionStyle;

  useEffect(() => {
    if (modelResult.error) {
      onError?.(modelResult.error);
      return;
    }
    if (imageState.failures.length > 0) {
      if (onImageResourceFailure) {
        imageState.failures.forEach(onImageResourceFailure);
      } else {
        imageState.failures.forEach((failure) => onError?.(failure.error));
      }
      return;
    }
    if (imageState.error) {
      onError?.(imageState.error);
      return;
    }
    if (!ready) return;

    const frame = window.requestAnimationFrame(() => onReady?.());
    return () => window.cancelAnimationFrame(frame);
  }, [
    imageState.error,
    imageState.failures,
    modelResult.error,
    modelResult.model?.timeMs,
    onError,
    onImageResourceFailure,
    onReady,
    ready,
    renderToken,
  ]);
  useEffect(() => {
    if (!displayReady) return;
    const frame = window.requestAnimationFrame(() => onDisplayReady?.());
    return () => window.cancelAnimationFrame(frame);
  }, [displayReady, onDisplayReady, renderToken]);

  if (!modelResult.model || (error && !committedFrame)) {
    return (
      <div className="stage-error" role="alert" data-testid="stage-error">
        <strong>舞台无法渲染</strong>
        <span>{error?.message ?? '未知错误'}</span>
      </div>
    );
  }

  return (
    <div
      className="stage-renderer"
      data-logical-height={displayModel!.height}
      data-logical-width={displayModel!.width}
      data-caption-visible={String(Boolean(displayCaption))}
      data-caption-text={displayCaption ?? ''}
      data-layer-render-json={JSON.stringify(
        displayModel!.layers.map((layer) => layer.render),
      )}
      data-render-contract="shared-stage-layer-v1"
      data-stage-error={String(Boolean(error))}
      data-stage-display-ready={String(displayReady)}
      data-stage-degraded={String(degraded)}
      data-stage-ready={String(ready)}
      data-stage-render-token={renderToken == null ? '' : String(renderToken)}
      data-stage-time={displayModel!.timeMs}
      data-testid="stage-renderer"
    >
      <Stage
        height={displayModel!.height}
        listening={false}
        width={displayModel!.width}
      >
        <Layer listening={false} ref={configurePreviewLayer}>
          {displayModel!.layers.map((layer) => {
            const render = layer.render;
            const primaryPart = layer.parts[0];
            if (!primaryPart || !render.visible) {
              return null;
            }
            const image = imageState.images.get(primaryPart.id);
            if (!image && !layer.visual) return null;
            if (render.isBackground || !layer.visual) {
              if (!image) return null;
              return (
                <KonvaImage
                  key={layer.id}
                  height={render.height}
                  image={image}
                  listening={render.listening}
                  offsetX={render.offsetX}
                  offsetY={render.offsetY}
                  opacity={render.opacity}
                  rotation={render.rotationDeg}
                  scaleX={render.scaleX}
                  scaleY={render.scaleY}
                  width={render.width}
                  x={render.x}
                  y={render.y}
                />
              );
            }
            return (
              <Group
                key={layer.id}
                listening={render.listening}
                opacity={render.opacity}
                rotation={render.rotationDeg}
                scaleX={render.scaleX}
                scaleY={render.scaleY}
                x={render.x}
                y={render.y}
              >
                <StagePartImages
                  composite={layer.visual.kind === 'composite-character'}
                  images={imageState.images}
                  parts={layer.parts}
                />
              </Group>
            );
          })}
          <SubtitleRenderer
            text={displayCaption}
            style={displayCaptionStyle}
          />
          <Text
            fill="rgba(16, 45, 34, 0.7)"
            fontFamily="Segoe UI, sans-serif"
            fontSize={24}
            text="PANDA STAGE · 1920 × 1080"
            x={42}
            y={36}
          />
        </Layer>
      </Stage>
    </div>
  );
}
