import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateShotAtTime } from '../../shared/domain';
import {
  PROBE_CAPTION,
  PROBE_CHARACTER_LAYER_ID,
  PROBE_PREVIEW_TIME_MS,
  PROBE_PROJECT,
  PROBE_SHOT,
} from '../../shared/probe/probe-project';
import { CanvasStage } from './CanvasStage';
import { PROBE_ASSET_URLS } from './probe-assets';

type PlaybackState = 'paused' | 'playing';

export function StagePreview(): React.JSX.Element {
  const [timeMs, setTimeMs] = useState(PROBE_PREVIEW_TIME_MS);
  const [playback, setPlayback] = useState<PlaybackState>('paused');
  const timeRef = useRef(timeMs);

  useEffect(() => {
    timeRef.current = timeMs;
  }, [timeMs]);

  useEffect(() => {
    if (playback !== 'playing') {
      return;
    }

    const startAtMs = performance.now() - timeRef.current;
    let animationFrame = 0;
    const tick = (nowMs: number): void => {
      const nextTimeMs = Math.min(
        PROBE_SHOT.durationMs,
        Math.floor(nowMs - startAtMs),
      );
      setTimeMs(nextTimeMs);
      if (nextTimeMs >= PROBE_SHOT.durationMs) {
        setPlayback('paused');
        return;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [playback]);

  const evaluatedShot = useMemo(
    () => evaluateShotAtTime(PROBE_SHOT, timeMs),
    [timeMs],
  );
  const character = evaluatedShot.layers.find(
    (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
  );

  const play = (): void => {
    if (timeRef.current >= PROBE_SHOT.durationMs) {
      setTimeMs(0);
      timeRef.current = 0;
    }
    setPlayback('playing');
  };

  const replay = (): void => {
    timeRef.current = 0;
    setTimeMs(0);
    setPlayback('playing');
  };

  return (
    <section className="preview-panel" aria-labelledby="preview-title">
      <div className="preview-heading">
        <div>
          <p className="eyebrow">Shared renderer probe</p>
          <h1 id="preview-title">固定坐标舞台预览</h1>
        </div>
        <span className="day-badge">Day 04</span>
      </div>

      <CanvasStage
        assetUrls={PROBE_ASSET_URLS}
        caption={PROBE_CAPTION}
        evaluatedShot={evaluatedShot}
        project={PROBE_PROJECT}
      />

      <div className="transport-bar">
        <div className="transport-controls" aria-label="预览播放控制">
          <button onClick={play} type="button" disabled={playback === 'playing'}>
            播放
          </button>
          <button
            onClick={() => setPlayback('paused')}
            type="button"
            disabled={playback === 'paused'}
          >
            暂停
          </button>
          <button onClick={replay} type="button">
            重播
          </button>
        </div>
        <div className="probe-metrics" aria-live="polite">
          <span>
            时间 <strong>{(timeMs / 1_000).toFixed(2)}s</strong>
          </span>
          <span>
            角色 X <strong>{character?.x.toFixed(1) ?? '—'}</strong>
          </span>
          <span>
            逻辑画布 <strong>1920 × 1080</strong>
          </span>
        </div>
      </div>
    </section>
  );
}
