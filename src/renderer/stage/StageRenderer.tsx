import { useCallback, useEffect, useMemo, useState } from 'react';
import type Konva from 'konva';
import { Image as KonvaImage, Layer, Stage } from 'react-konva';
import type { EvaluatedShot, Project } from '../../domain';
import type { SubtitleStyle } from '../../domain';
import {
  buildStageRenderModel,
  type StageAssetUrlMap,
  type StageRenderLayer,
} from '../../shared/stage/render-model';
import { SubtitleRenderer } from '../features/subtitles/SubtitleRenderer';
import {
  configureKonvaScenePixelRatio,
  PREVIEW_CANVAS_PIXEL_RATIO,
} from './konva-pixel-ratio';

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

interface ImageLoadState {
  images: ReadonlyMap<string, HTMLImageElement>;
  error: Error | null;
}

function useStageImages(
  layers: readonly StageRenderLayer[],
  sourceKey: string,
  onError?: (error: Error) => void,
): ImageLoadState {
  const [state, setState] = useState<ImageLoadState>({
    images: new Map(),
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ images: new Map(), error: null });

    void Promise.all(
      layers.map(
        (layer) =>
          new Promise<[string, HTMLImageElement]>((resolve, reject) => {
            const image = new window.Image();
            image.onload = () => resolve([layer.id, image]);
            image.onerror = () =>
              reject(
                new Error(
                  `无法加载舞台素材“${layer.asset.name}”：${layer.sourceUrl}`,
                ),
              );
            image.src = layer.sourceUrl;
          }),
      ),
    )
      .then((entries) => {
        if (!cancelled) {
          setState({ images: new Map(entries), error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const loadError =
            error instanceof Error ? error : new Error('舞台素材加载失败。');
          setState({ images: new Map(), error: loadError });
          onError?.(loadError);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sourceKey, onError]);

  return state;
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
  const imageSourceKey = layers
    .map((layer) => `${layer.id}\u0000${layer.sourceUrl}`)
    .join('\u0001');
  const imageState = useStageImages(layers, imageSourceKey, onError);
  const error = modelResult.error ?? imageState.error;
  const ready =
    !error && layers.length > 0 && imageState.images.size === layers.length;

  useEffect(() => {
    if (!ready) {
      if (modelResult.error) {
        onError?.(modelResult.error);
      }
      return;
    }

    const frame = window.requestAnimationFrame(() => onReady?.());
    return () => window.cancelAnimationFrame(frame);
  }, [
    modelResult.error,
    modelResult.model?.timeMs,
    onError,
    onReady,
    ready,
    renderToken,
  ]);

  if (!modelResult.model || error) {
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
      data-logical-height={modelResult.model.height}
      data-logical-width={modelResult.model.width}
      data-caption-visible={String(Boolean(caption))}
      data-caption-text={caption ?? ''}
      data-layer-render-json={JSON.stringify(
        modelResult.model.layers.map((layer) => layer.render),
      )}
      data-render-contract="shared-stage-layer-v1"
      data-stage-ready={String(ready)}
      data-stage-time={modelResult.model.timeMs}
      data-testid="stage-renderer"
    >
      <Stage
        height={modelResult.model.height}
        listening={false}
        width={modelResult.model.width}
      >
        <Layer listening={false} ref={configurePreviewLayer}>
          {modelResult.model.layers.map((layer) => {
            const image = imageState.images.get(layer.id);
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
          <SubtitleRenderer text={caption} style={captionStyle} />
        </Layer>
      </Stage>
    </div>
  );
}
