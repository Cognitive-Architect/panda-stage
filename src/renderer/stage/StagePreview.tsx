import { useMemo } from 'react';
import { evaluateShotAtTime } from '../../shared/domain';
import {
  PROBE_CHARACTER_LAYER_ID,
  PROBE_PROJECT,
  PROBE_SHOT,
  PROBE_SUBTITLE_CUES,
} from '../../shared/probe/probe-project';
import { evaluateSubtitleAtTime } from '../../shared/preview/subtitle-engine';
import { usePreviewController } from '../preview/use-preview-controller';
import { CanvasStage } from './CanvasStage';
import { PROBE_ASSET_URLS, PROBE_AUDIO_URL } from './probe-assets';

const statusLabels = {
  loading: '音频加载中',
  stopped: '已停止',
  playing: '播放中',
  paused: '已暂停',
  ended: '播放完成',
  error: '预览错误',
} as const;

export function StagePreview(): React.JSX.Element {
  const preview = usePreviewController(PROBE_AUDIO_URL, PROBE_SHOT.durationMs);
  const evaluatedShot = useMemo(
    () => evaluateShotAtTime(PROBE_SHOT, preview.timeMs),
    [preview.timeMs],
  );
  const subtitle = evaluateSubtitleAtTime(
    PROBE_SUBTITLE_CUES,
    preview.timeMs,
  );
  const character = evaluatedShot.layers.find(
    (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
  );
  const controlsUnavailable =
    preview.status === 'loading' || preview.status === 'error';

  return (
    <section
      className="preview-panel"
      aria-labelledby="preview-title"
      data-active-audio-sources={preview.activeSourceCount}
      data-audio-clock={preview.clockKind}
      data-audio-clock-state={preview.clockState}
      data-character-x={character?.x ?? ''}
      data-preview-status={preview.status}
      data-preview-time={preview.timeMs}
      data-source-start-count={preview.sourceStartCount}
      data-source-stop-count={preview.sourceStopCount}
      data-testid="preview-panel"
    >
      <div className="preview-heading">
        <div>
          <p className="eyebrow">AudioContext master clock</p>
          <h1 id="preview-title">音画同步预览探针</h1>
        </div>
        <div className="preview-status-group">
          <span className={`playback-status playback-status-${preview.status}`}>
            {statusLabels[preview.status]}
          </span>
          <span className="day-badge">Day 05</span>
        </div>
      </div>

      <CanvasStage
        assetUrls={PROBE_ASSET_URLS}
        caption={subtitle?.text ?? null}
        evaluatedShot={evaluatedShot}
        project={PROBE_PROJECT}
      />

      <div className="transport-bar">
        <div className="transport-controls" aria-label="预览播放控制">
          <button
            data-testid="preview-play"
            disabled={controlsUnavailable || preview.status === 'playing'}
            onClick={() => void preview.play()}
            type="button"
          >
            播放
          </button>
          <button
            data-testid="preview-pause"
            disabled={preview.status !== 'playing'}
            onClick={preview.pause}
            type="button"
          >
            暂停
          </button>
          <button
            data-testid="preview-stop"
            disabled={controlsUnavailable || preview.status === 'stopped'}
            onClick={preview.stop}
            type="button"
          >
            停止
          </button>
          <button
            data-testid="preview-replay"
            disabled={controlsUnavailable}
            onClick={() => void preview.replay()}
            type="button"
          >
            重播
          </button>
        </div>
        <div className="probe-metrics" aria-live="polite">
          <span>
            时间 <strong>{(preview.timeMs / 1_000).toFixed(2)}s</strong>
          </span>
          <span>
            角色 X <strong>{character?.x.toFixed(1) ?? '—'}</strong>
          </span>
          <span>
            主时钟 <strong>AudioContext</strong>
          </span>
          <span>
            音源 <strong>{preview.activeSourceCount}</strong>
          </span>
        </div>
      </div>

      {preview.error ? (
        <p className="preview-error" role="alert">
          {preview.error}
        </p>
      ) : null}
    </section>
  );
}
