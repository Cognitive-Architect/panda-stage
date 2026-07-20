import { useEffect, useMemo, useState } from 'react';
import { Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva';
import type { EvaluatedShot, Project } from '../../shared/domain';
import {
  buildStageRenderModel,
  type StageAssetUrlMap,
  type StageRenderLayer,
} from '../../shared/stage/render-model';
import { STAGE_CAPTION_SAFE_AREA } from '../../shared/stage/layout';

interface StageRendererProps {
  project: Project;
  evaluatedShot: EvaluatedShot;
  assetUrls: StageAssetUrlMap;
  caption: string | null;
  onReady?: () => void;
  onError?: (error: Error) => void;
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
  onReady,
  onError,
}: StageRendererProps): React.JSX.Element {
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
  }, [modelResult.error, onError, onReady, ready]);

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
      data-stage-ready={String(ready)}
      data-stage-time={modelResult.model.timeMs}
      data-testid="stage-renderer"
    >
      <Stage
        height={modelResult.model.height}
        listening={false}
        width={modelResult.model.width}
      >
        <Layer listening={false}>
          {modelResult.model.layers.map((layer) => {
            const image = imageState.images.get(layer.id);
            if (!image || !layer.visible) {
              return null;
            }

            const width = layer.asset.width ?? image.naturalWidth;
            const height = layer.asset.height ?? image.naturalHeight;
            return (
              <KonvaImage
                key={layer.id}
                height={height}
                image={image}
                offsetX={width / 2}
                offsetY={height / 2}
                opacity={layer.opacity}
                rotation={layer.rotationDeg}
                scaleX={layer.scaleX}
                scaleY={layer.scaleY}
                width={width}
                x={layer.x}
                y={layer.y}
              />
            );
          })}
          {caption ? (
            <>
              <Rect
                cornerRadius={34}
                fill="rgba(10, 20, 17, 0.78)"
                height={STAGE_CAPTION_SAFE_AREA.height}
                width={STAGE_CAPTION_SAFE_AREA.width}
                x={STAGE_CAPTION_SAFE_AREA.x}
                y={STAGE_CAPTION_SAFE_AREA.y}
              />
              <Text
                align="center"
                fill="#fffdf6"
                fontFamily="Microsoft YaHei, Segoe UI, sans-serif"
                fontSize={44}
                height={
                  STAGE_CAPTION_SAFE_AREA.height -
                  STAGE_CAPTION_SAFE_AREA.verticalPadding * 2
                }
                lineHeight={1.35}
                text={caption}
                verticalAlign="middle"
                width={
                  STAGE_CAPTION_SAFE_AREA.width -
                  STAGE_CAPTION_SAFE_AREA.horizontalPadding * 2
                }
                x={
                  STAGE_CAPTION_SAFE_AREA.x +
                  STAGE_CAPTION_SAFE_AREA.horizontalPadding
                }
                y={
                  STAGE_CAPTION_SAFE_AREA.y +
                  STAGE_CAPTION_SAFE_AREA.verticalPadding
                }
              />
            </>
          ) : null}
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
