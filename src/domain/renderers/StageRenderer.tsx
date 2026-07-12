import React, { useMemo } from 'react';
import { Image, Text } from 'react-konva';
import type { ShotFrame } from '@/domain/evaluators/timelineEvaluator';
import { SUBTITLE_SAFE_BOTTOM } from '@shared/constants';

export interface StageRendererProps {
  shotFrame: ShotFrame | null;
  width: number;
  height: number;
  assetMap: Map<string, HTMLImageElement>;
}

/**
 * Shared rendering component used by both the main window (CanvasStage)
 * and the hidden export window.
 *
 * Renders a single evaluated frame using React Konva:
 * - Background: fill the entire canvas (scaleMode: 'fill')
 * - Character layers: anchor at center, support x/y/scaleX/scaleY/rotation/flipX/opacity
 * - Subtitle: bottom safe area, centered, white text + black outline
 */
export function StageRenderer({
  shotFrame,
  width,
  height,
  assetMap,
}: StageRendererProps): React.ReactElement {
  const bgElement = useMemo(() => {
    if (!shotFrame?.backgroundAssetId) return null;
    const image = assetMap.get(shotFrame.backgroundAssetId);
    if (!image) return null;

    // scaleMode: 'fill' — cover the entire canvas, cropping excess
    const scaleX = width / image.width;
    const scaleY = height / image.height;
    const scale = Math.max(scaleX, scaleY);

    return (
      <Image
        x={width / 2}
        y={height / 2}
        width={image.width}
        height={image.height}
        scaleX={scale}
        scaleY={scale}
        image={image}
        offsetX={image.width / 2}
        offsetY={image.height / 2}
        listening={false}
        perfectDrawEnabled={false}
        shadowEnabled={false}
      />
    );
  }, [shotFrame?.backgroundAssetId, assetMap, width, height]);

  const layerElements = useMemo(() => {
    if (!shotFrame) return null;
    return shotFrame.layers.map((layer) => {
      const image = layer.assetId ? assetMap.get(layer.assetId) : undefined;
      if (!image || !layer.visible) return null;

      return (
        <Image
          key={layer.layerId}
          x={layer.x + layer.shakeOffsetX}
          y={layer.y + layer.shakeOffsetY}
          width={image.width}
          height={image.height}
          scaleX={layer.scaleX * (layer.flipX ? -1 : 1)}
          scaleY={layer.scaleY}
          rotation={layer.rotation}
          opacity={layer.opacity}
          image={image}
          offsetX={image.width / 2}
          offsetY={image.height / 2}
          listening={false}
          perfectDrawEnabled={false}
          shadowEnabled={false}
        />
      );
    });
  }, [shotFrame, assetMap]);

  const subtitleElement = useMemo(() => {
    if (!shotFrame?.currentSubtitle) return null;
    const { text, style } = shotFrame.currentSubtitle;

    return (
      <Text
        text={text}
        x={width / 2}
        y={height - SUBTITLE_SAFE_BOTTOM}
        fontSize={style.fontSize}
        fontFamily={style.fontFamily}
        fill={style.color}
        stroke={style.outlineColor}
        strokeWidth={style.outlineWidth}
        shadowBlur={style.shadowBlur}
        shadowColor="rgba(0,0,0,0.5)"
        align="center"
        width={width * 0.9}
        offsetX={(width * 0.9) / 2}
        listening={false}
      />
    );
  }, [shotFrame?.currentSubtitle, width, height]);

  return (
    <>
      {bgElement}
      {layerElements}
      {subtitleElement}
    </>
  );
}
