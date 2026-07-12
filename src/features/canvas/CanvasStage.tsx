import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Stage, Layer } from 'react-konva';
import type { Project } from '@shared/types';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '@shared/constants';
import { evaluateProjectAtTime } from '@/domain/evaluators/timelineEvaluator';
import { StageRenderer } from '@/domain/renderers/StageRenderer';

export interface CanvasStageProps {
  project: Project;
  currentTimeMs: number;
}

/**
 * Main canvas component for the editor/preview window.
 *
 * Features:
 * - Evaluates the project at currentTimeMs using the shared timeline evaluator
 * - Loads required image assets on demand
 * - Scales the canvas to fit the container while preserving aspect ratio
 * - Reuses StageRenderer for consistent rendering between main and export windows
 */
export function CanvasStage({
  project,
  currentTimeMs,
}: CanvasStageProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [assetMap, setAssetMap] = useState<Map<string, HTMLImageElement>>(
    new Map()
  );

  // Track container size for responsive scaling
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Calculate fit scale preserving aspect ratio
  const scale = useMemo(() => {
    if (containerSize.width <= 0 || containerSize.height <= 0) return 1;
    return Math.min(
      containerSize.width / CANVAS_WIDTH,
      containerSize.height / CANVAS_HEIGHT
    );
  }, [containerSize]);

  const stageWidth = CANVAS_WIDTH * scale;
  const stageHeight = CANVAS_HEIGHT * scale;

  // Evaluate current frame from the timeline
  const projectFrame = useMemo(
    () => evaluateProjectAtTime(project, currentTimeMs),
    [project, currentTimeMs]
  );

  // Load all image assets referenced by the project
  useEffect(() => {
    let cancelled = false;

    const neededAssetIds = new Set<string>();
    for (const shot of project.shots) {
      if (shot.backgroundAssetId) {
        neededAssetIds.add(shot.backgroundAssetId);
      }
      for (const layer of shot.layers) {
        if (layer.type === 'image' && layer.assetId) {
          neededAssetIds.add(layer.assetId);
        }
        if (layer.type === 'character' && layer.characterId) {
          const char = project.characters.find(
            (c) => c.id === layer.characterId
          );
          if (char) {
            Object.values(char.expressions).forEach((id) =>
              neededAssetIds.add(id)
            );
            if (char.mouthOpenAssetId) {
              neededAssetIds.add(char.mouthOpenAssetId);
            }
          }
        }
      }
    }

    const loadAssets = async () => {
      const map = new Map<string, HTMLImageElement>();
      for (const id of neededAssetIds) {
        const asset = project.assets.find(
          (a) => a.id === id && a.type === 'image'
        );
        if (!asset) continue;
        try {
          const url = await window.electronAPI.asset.getUrl(asset.id);
          const img = new window.Image();
          img.src = url;
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () =>
              reject(new Error(`Failed to load ${asset.name}`));
          });
          if (!cancelled) {
            map.set(id, img);
          }
        } catch {
          // Skip assets that fail to load
        }
      }
      if (!cancelled) {
        setAssetMap(map);
      }
    };

    loadAssets();

    return () => {
      cancelled = true;
    };
  }, [project]);

  return (
    <div ref={containerRef} className="canvas-stage-container">
      <div
        className="canvas-stage-wrapper"
        style={{
          width: stageWidth,
          height: stageHeight,
        }}
      >
        <Stage width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
          <Layer>
            <StageRenderer
              shotFrame={projectFrame.shotFrame}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              assetMap={assetMap}
            />
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
