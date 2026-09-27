import { useLayoutEffect, useRef, useState } from 'react';
import { calculateViewportTransform } from '../../domain';
import type { EvaluatedShot, Project, SubtitleStyle } from '../../domain';
import type { StageAssetUrlMap } from '../../shared/stage/render-model';
import { StageRenderer } from './StageRenderer';
import {
  previewDiagnosticNow,
  recordPreviewDuration,
} from './previewDiagnostics';
import type { StageImageResourceFailure } from './stageImageResourceSession';

interface CanvasStageProps {
  project: Project;
  evaluatedShot: EvaluatedShot;
  assetUrls: StageAssetUrlMap;
  caption: string | null;
  captionStyle?: SubtitleStyle;
  onReady?: () => void;
  onDisplayReady?: () => void;
  onError?: (error: Error) => void;
  onImageResourceFailure?: (failure: StageImageResourceFailure) => void;
  renderToken?: string | number;
  degraded?: boolean;
}

export function CanvasStage(props: CanvasStageProps): React.JSX.Element {
  const renderStartedAt = previewDiagnosticNow();
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

  useLayoutEffect(() => {
    recordPreviewDuration('canvas-stage-render-to-commit', renderStartedAt, {
      timeMs: props.evaluatedShot.timeMs,
    });
  });
  recordPreviewDuration('canvas-stage-render-pre-jsx', renderStartedAt, {
    timeMs: props.evaluatedShot.timeMs,
  });

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
