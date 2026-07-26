import { useLayoutEffect, useRef, useState } from 'react';
import { calculateViewportTransform } from '../../domain';
import type { EvaluatedShot, Project } from '../../shared/domain';
import type { StageAssetUrlMap } from '../../shared/stage/render-model';
import { StageRenderer } from './StageRenderer';

interface CanvasStageProps {
  project: Project;
  evaluatedShot: EvaluatedShot;
  assetUrls: StageAssetUrlMap;
  caption: string | null;
  onReady?: () => void;
  onError?: (error: Error) => void;
  renderToken?: string | number;
}

export function CanvasStage(props: CanvasStageProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState(() =>
    calculateViewportTransform(
      { width: props.project.width, height: props.project.height },
      'fit',
      { width: props.project.width, height: props.project.height },
    ),
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateScale = (): void => {
      setTransform(
        calculateViewportTransform(
          {
            width: viewport.clientWidth,
            height: viewport.clientHeight,
          },
          'fit',
          {
            width: props.project.width,
            height: props.project.height,
          },
        ),
      );
    };
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    updateScale();
    return () => observer.disconnect();
  }, [props.project.width]);

  return (
    <div
      ref={viewportRef}
      className="stage-viewport"
      data-display-scale={transform.scale.toFixed(6)}
      data-testid="stage-viewport"
    >
      <div
        className="stage-scale"
        style={{
          left: transform.offsetX,
          top: transform.offsetY,
          transform: `scale(${transform.scale})`,
        }}
      >
        <StageRenderer {...props} />
      </div>
    </div>
  );
}
