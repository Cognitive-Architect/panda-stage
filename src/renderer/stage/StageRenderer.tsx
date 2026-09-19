import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type Konva from 'konva';
import { Image as KonvaImage, Layer, Stage, Text } from 'react-konva';
import type { EvaluatedShot, Project } from '../../domain';
import type { SubtitleStyle } from '../../domain';
import {
  buildStageRenderModel,
  type StageAssetUrlMap,
  type StageRenderLayer,
  type StageRenderModel,
} from '../../shared/stage/render-model';
import { SubtitleRenderer } from '../features/subtitles/SubtitleRenderer';
import {
  configureKonvaScenePixelRatio,
  PREVIEW_CANVAS_PIXEL_RATIO,
} from './konva-pixel-ratio';
import {
  buildStageImageSourceKey,
  EMPTY_STAGE_IMAGE_RESOURCE_STATE,
  StageImageResourceSession,
  type StageImageLayerSource,
  type StageImageResourceState,
} from './stageImageResourceSession';

interface StageRendererProps {
  project: Project;
  evaluatedShot: EvaluatedShot;
  assetUrls: StageAssetUrlMap;
  caption: string | null;
  captionStyle?: SubtitleStyle;
  onReady?: () => void;
  onError?: (error: Error) => void;
  renderToken?: string | number;
}

interface StageVisualFrame {
  model: StageRenderModel;
  caption: string | null;
  captionStyle?: SubtitleStyle;
}

function useStageImages(
  layers: readonly StageRenderLayer[],
  desiredFrame: StageVisualFrame | null,
  sourceKey: string,
): {
  state: StageImageResourceState;
  committedFrame: StageVisualFrame | null;
} {
  const sessionRef = useRef<StageImageResourceSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new StageImageResourceSession();
  }
  const [state, setState] = useState<StageImageResourceState>(
    () => sessionRef.current?.getSnapshot() ?? EMPTY_STAGE_IMAGE_RESOURCE_STATE,
  );
  const committedFrameRef = useRef<StageVisualFrame | null>(null);
  const desiredFrameRef = useRef<StageVisualFrame | null>(desiredFrame);
  desiredFrameRef.current = desiredFrame;
  const layerSourcesRef = useRef<{
    key: string;
    layers: readonly StageImageLayerSource[];
  }>({ key: '', layers: [] });
  if (layerSourcesRef.current.key !== sourceKey) {
    layerSourcesRef.current = {
      key: sourceKey,
      layers: layers.map(({ id, sourceUrl }) => ({ id, sourceUrl })),
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
      if (nextState.ready) {
        committedFrameRef.current = desiredFrameRef.current;
      }
    });
  }, [sourceKey]);

  useEffect(() => {
    const session = sessionRef.current;
    return () => session?.dispose();
  }, []);

  return {
    state,
    committedFrame: committedFrameRef.current,
  };
}

export function StageRenderer({
  project,
  evaluatedShot,
  assetUrls,
  caption,
  captionStyle,
  onReady,
  onError,
  renderToken,
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
  const imageSourceKey = buildStageImageSourceKey(layers);
  const desiredFrame = modelResult.model
    ? {
        model: modelResult.model,
        caption,
        captionStyle,
      }
    : null;
  const imageState = useStageImages(layers, desiredFrame, imageSourceKey);
  const error = modelResult.error ?? imageState.state.error;
  const desiredFrameReady =
    !error &&
    modelResult.model !== null &&
    imageState.state.ready &&
    imageState.state.desiredSourceKey === imageSourceKey;
  const ready = desiredFrameReady && layers.length > 0;
  const displayFrame =
    desiredFrameReady
      ? desiredFrame
      : imageState.committedFrame ?? desiredFrame;
  const displayModel = displayFrame?.model ?? modelResult.model;
  const displayCaption = displayFrame?.caption ?? caption;
  const displayCaptionStyle = displayFrame?.captionStyle ?? captionStyle;

  useEffect(() => {
    if (modelResult.error) {
      onError?.(modelResult.error);
      return;
    }
    if (imageState.state.error) {
      onError?.(imageState.state.error);
      return;
    }
    if (!ready) return;

    const frame = window.requestAnimationFrame(() => onReady?.());
    return () => window.cancelAnimationFrame(frame);
  }, [
    imageState.state.error,
    modelResult.error,
    modelResult.model?.timeMs,
    onError,
    onReady,
    ready,
    renderToken,
  ]);

  if (!modelResult.model || (error && !imageState.committedFrame)) {
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
      data-stage-ready={String(ready)}
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
            const image = imageState.state.images.get(layer.id);
            const render = layer.render;
            if (!image || !render.visible) {
              return null;
            }
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
