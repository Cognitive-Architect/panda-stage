import {
  recognizePositionChain,
  type Layer,
  type PositionChainRecognition,
  type Shot,
} from '../../../domain';
import { useState } from 'react';
import { LockKeyhole, X } from 'lucide-react';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { IconButton } from '../../ui/Button';
import { PositionKeyMarker } from './PositionKeyMarker';
import { timeToPx } from './timeGeometry';

export interface PositionLaneProps {
  productPreviewOpen?: boolean;
  shot: Shot;
  layer: Layer;
  currentTimeMs: number;
  pixelsPerMs: number;
  trackWidth: number;
  snapshot: EditorProjectSnapshot;
}

/** The root Layer is the sole owner; background/locked selection has no lane. */
export function recognizeSelectedPositionLane(
  shot: Shot | null,
  layerId: string | null,
): { layer: Layer; recognition: PositionChainRecognition } | null {
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (!shot || !layer || layer.locked || shot.backgroundLayerId === layer.id) {
    return null;
  }
  return { layer, recognition: recognizePositionChain({ shot, layer }) };
}

/**
 * Local PK-06 error surface. It stays inside the Timeline DOM, so its pointer
 * input is isolated from the parent seek gesture, and dismissal is a real
 * reachable button instead of a clickable container.
 */
export function PositionLaneErrorNotice({ message, onDismiss }: {
  message: string;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div
      className="position-lane-error"
      data-testid="position-lane-error"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="position-lane-error-text" role="alert">{message}</span>
      <IconButton
        aria-label="关闭提示"
        className="position-lane-error-dismiss"
        icon={<X size={14} />}
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        variant="secondary"
      />
    </div>
  );
}

export function PositionLane({
  productPreviewOpen = false,
  shot,
  layer,
  currentTimeMs,
  pixelsPerMs,
  trackWidth,
  snapshot,
}: PositionLaneProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const recognition = recognizePositionChain({ shot, layer });
  const points = recognition.status === 'playback-only'
    ? []
    : recognition.chain.points;
  const finalPoint = points[points.length - 1];
  return (
    <div
      aria-label="人物位置"
      className="timeline-lane timeline-position-lane"
      data-position-state={recognition.status}
      data-testid="position-lane"
      role="group"
    >
      <span className="timeline-lane-label" data-track-label="position">
        <span className="timeline-lane-label-text">人物位置</span>
        {recognition.status === 'playback-only' ? (
          <LockKeyhole aria-label="只读" className="position-lane-lock" role="img" size={12} />
        ) : null}
      </span>
      <div className="timeline-lane-content position-lane-content" style={{ width: `${trackWidth}px` }}>
        {recognition.status === 'playback-only' ? (
          <span className="position-lane-readonly">旧动画 · 只读</span>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="position-chain-line"
              style={{ width: `${timeToPx(points.length > 1 ? finalPoint!.timeMs : shot.durationMs, pixelsPerMs)}px` }}
            />
            {points.map((point, index) => (
              <PositionKeyMarker
                productPreviewOpen={productPreviewOpen}
                current={point.timeMs === currentTimeMs}
                durationMs={shot.durationMs}
                key={point.timeMs}
                pixelsPerMs={pixelsPerMs}
                point={point}
                shotId={shot.id}
                layerId={layer.id}
                previousTimeMs={index > 0 ? points[index - 1]!.timeMs : null}
                nextTimeMs={points[index + 1]?.timeMs ?? null}
                snapshot={snapshot}
                onError={setError}
              />
            ))}
          </>
        )}
      </div>
      {error ? <PositionLaneErrorNotice message={error} onDismiss={() => setError(null)} /> : null}
    </div>
  );
}
