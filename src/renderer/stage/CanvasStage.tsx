import { useLayoutEffect, useRef, useState } from 'react';
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
  const [displayScale, setDisplayScale] = useState(1);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateScale = (): void => {
      setDisplayScale(viewport.clientWidth / props.project.width);
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
      data-display-scale={displayScale.toFixed(6)}
      data-testid="stage-viewport"
    >
      <div
        className="stage-scale"
        style={{ transform: `scale(${displayScale})` }}
      >
        <StageRenderer {...props} />
      </div>
    </div>
  );
}
