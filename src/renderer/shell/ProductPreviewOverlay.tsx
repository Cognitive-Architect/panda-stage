/**
 * Stage 1B product preview overlay.
 *
 * Contract (Issue #76):
 *   - Reuses the **formal** evaluator (`evaluateShotAtTime`) and the **formal**
 *     renderer (`CanvasStage` -> `StageRenderer` -> `buildStageRenderModel`).
 *     No preview-only evaluation or drawing code exists here.
 *   - Strictly read-only. The overlay never writes the project, the revision,
 *     the dirty flag, the selection or the history. It receives the already
 *     loaded project as a prop and only *reads* it.
 *   - The only state it owns is its own playback clock (`timeMs`, `playing`)
 *     plus the asset URLs it needs to draw. Closing the overlay throws that
 *     state away; the editor is untouched.
 *   - No second project tree and no hidden DOM: the overlay is mounted only
 *     while open and unmounted on close.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluateShotAtTime, type Project } from '../../domain';
import { evaluateSubtitleAtTime } from '../../shared/preview/subtitle-engine';
import type { StageAssetUrlMap } from '../../shared/stage/render-model';
import { CanvasStage } from '../stage/CanvasStage';
import {
  advanceProductPreviewTime,
  buildProductPreviewCues,
  clampProductPreviewTime,
  formatProductPreviewTimecode,
  listProductPreviewAssetIds,
  listProductPreviewAudioClips,
  resolveProductPreviewShot,
  resolveProductPreviewSubtitleStyle,
} from './productPreviewModel';
import {
  AudioScheduler,
  toScheduledAudioClip,
} from '../features/preview/AudioScheduler';

export interface ProductPreviewOverlayProps {
  /** Project folder of the currently open project, used to read thumbnails. */
  projectRoot: string;
  /** The already loaded formal project. Treated as immutable input. */
  project: Project;
  /** Shot selected in the editor, or `null` when nothing is selected. */
  shotId: string | null;
  /** Closes the overlay and discards all preview-local playback state. */
  onClose(): void;
}

type AssetLoadStatus = 'loading' | 'ready' | 'error';

interface AssetLoadState {
  status: AssetLoadStatus;
  urls: StageAssetUrlMap;
  missingCount: number;
}

const INITIAL_ASSET_STATE: AssetLoadState = {
  status: 'loading',
  urls: {},
  missingCount: 0,
};

/**
 * Loads one data URL per image asset the shot can show. Read-only: it calls
 * the existing thumbnail read IPC and keeps the result in overlay-local state.
 */
function useProductPreviewAssets(
  projectRoot: string,
  project: Project,
  assetIds: readonly string[],
): AssetLoadState {
  const [state, setState] = useState<AssetLoadState>(INITIAL_ASSET_STATE);
  const assetKey = [...assetIds].sort().join('|');

  useEffect(() => {
    let active = true;
    setState(INITIAL_ASSET_STATE);
    if (assetIds.length === 0) {
      setState({ status: 'ready', urls: {}, missingCount: 0 });
      return () => {
        active = false;
      };
    }

    const requests = assetIds.map(async (assetId) => {
      const asset = project.assets.find(
        (candidate) => candidate.id === assetId,
      );
      if (!asset || asset.kind !== 'image' || !asset.sha256) {
        return [assetId, undefined] as const;
      }
      try {
        const response = await window.pandaStage.assets.readThumbnail({
          projectRoot,
          assetId,
          sha256: asset.sha256,
        });
        if (!response.ok || response.status !== 'ready') {
          return [assetId, undefined] as const;
        }
        return [assetId, response.dataUrl] as const;
      } catch {
        return [assetId, undefined] as const;
      }
    });

    void Promise.all(requests).then((entries) => {
      if (!active) return;
      const urls: Record<string, string | undefined> = {};
      let missingCount = 0;
      for (const [assetId, dataUrl] of entries) {
        if (dataUrl) {
          urls[assetId] = dataUrl;
        } else {
          missingCount += 1;
        }
      }
      setState({
        status: missingCount > 0 ? 'error' : 'ready',
        urls,
        missingCount,
      });
    });

    return () => {
      active = false;
    };
  }, [assetKey, project, projectRoot]);

  return state;
}

interface AudioLoadState {
  status: 'loading' | 'ready' | 'error';
  urls: Readonly<Record<string, string>>;
  missingCount: number;
}

function useProductPreviewAudio(
  projectRoot: string,
  clips: ReturnType<typeof listProductPreviewAudioClips>,
): AudioLoadState {
  const [state, setState] = useState<AudioLoadState>({
    status: 'ready',
    urls: {},
    missingCount: 0,
  });
  const clipKey = clips
    .map((entry) => `${entry.assetId}:${entry.sha256 ?? 'missing'}`)
    .sort()
    .join('|');

  useEffect(() => {
    let active = true;
    if (clips.length === 0) {
      setState({ status: 'ready', urls: {}, missingCount: 0 });
      return () => {
        active = false;
      };
    }
    setState({ status: 'loading', urls: {}, missingCount: 0 });
    const requests = clips.map(async (entry) => {
      if (!entry.sha256) return [entry.assetId, undefined] as const;
      try {
        const response = await window.pandaStage.assets.readAudio({
          projectRoot,
          assetId: entry.assetId,
          sha256: entry.sha256,
        });
        return [
          entry.assetId,
          response.ok && response.status === 'ready'
            ? response.dataUrl
            : undefined,
        ] as const;
      } catch {
        return [entry.assetId, undefined] as const;
      }
    });
    void Promise.all(requests).then((entries) => {
      if (!active) return;
      const urls: Record<string, string> = {};
      let missingCount = 0;
      for (const [assetId, url] of entries) {
        if (url) urls[assetId] = url;
        else missingCount += 1;
      }
      setState({
        status: missingCount > 0 ? 'error' : 'ready',
        urls,
        missingCount,
      });
    });
    return () => {
      active = false;
    };
  }, [clipKey, clips, projectRoot]);

  return state;
}

export function ProductPreviewOverlay({
  projectRoot,
  project,
  shotId,
  onClose,
}: ProductPreviewOverlayProps): React.JSX.Element {
  const shot = useMemo(
    () => resolveProductPreviewShot(project, shotId),
    [project, shotId],
  );
  // Playback position and transport flag: the ONLY temporal state in the app
  // that belongs to the preview. Both die with the overlay.
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const assetIds = useMemo(
    () => (shot ? listProductPreviewAssetIds(project, shot) : []),
    [project, shot],
  );
  const assets = useProductPreviewAssets(projectRoot, project, assetIds);
  const audioEntries = useMemo(
    () => (shot ? listProductPreviewAudioClips(project, shot) : []),
    [project, shot],
  );
  const audioState = useProductPreviewAudio(projectRoot, audioEntries);
  const scheduledAudio = useMemo(
    () =>
      audioEntries.flatMap((entry) => {
        const url = audioState.urls[entry.assetId];
        return url ? [toScheduledAudioClip(entry, url)] : [];
      }),
    [audioEntries, audioState.urls],
  );
  const audioSchedulerRef = useRef<AudioScheduler | null>(null);
  const cues = useMemo(
    () => (shot ? buildProductPreviewCues(shot) : []),
    [shot],
  );
  const durationMs = shot?.durationMs ?? 0;

  const stopPlayback = useCallback((): void => {
    setPlaying(false);
    setTimeMs(0);
  }, []);

  useEffect(() => {
    // A shot switch resets the preview-local clock; nothing outside changes.
    setPlaying(false);
    setTimeMs(0);
  }, [shot?.id]);

  useEffect(() => {
    if (!playing || durationMs <= 0) {
      return;
    }
    let frame = 0;
    let previous = window.performance.now();
    const tick = (now: number): void => {
      const delta = now - previous;
      previous = now;
      setTimeMs((current) => {
        const step = advanceProductPreviewTime(current, delta, durationMs);
        if (step.ended) {
          setPlaying(false);
        }
        return step.timeMs;
      });
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationMs, playing]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const evaluatedShot = useMemo(
    () =>
      shot
        ? evaluateShotAtTime(
            shot,
            clampProductPreviewTime(timeMs, shot.durationMs),
            project,
            { includeMouthMotion: true },
          )
        : null,
    [project, shot, timeMs],
  );
  const activeCue = evaluatedShot
    ? evaluateSubtitleAtTime(cues, evaluatedShot.timeMs)
    : null;
  const caption = activeCue?.text ?? null;
  const captionStyle = resolveProductPreviewSubtitleStyle(project, activeCue);
  const atEnd = durationMs > 0 && timeMs >= durationMs;

  useEffect(() => {
    const scheduler = new AudioScheduler(scheduledAudio);
    audioSchedulerRef.current = scheduler;
    return () => {
      if (audioSchedulerRef.current === scheduler) {
        audioSchedulerRef.current = null;
      }
      scheduler.destroy();
    };
  }, [scheduledAudio]);

  useEffect(() => {
    audioSchedulerRef.current?.sync(timeMs, playing);
  }, [playing, timeMs]);

  return (
    <div
      aria-label="产品预览"
      aria-modal="true"
      className="product-preview-overlay"
      data-preview-playing={String(playing)}
      data-preview-shot-id={shot?.id ?? ''}
      data-preview-time={evaluatedShot?.timeMs ?? 0}
      data-testid="product-preview-overlay"
      role="dialog"
    >
      <div className="product-preview-frame">
        <header className="product-preview-header">
          <div>
            <p className="eyebrow">产品预览</p>
            <h2>{shot ? shot.name : project.name}</h2>
          </div>
          <button
            className="product-preview-close task4-hit-target"
            data-task4-core="preview-close"
            data-testid="product-preview-close"
            onClick={onClose}
            type="button"
          >
            关闭预览
          </button>
        </header>

        {shot === null ? (
          <div
            className="product-preview-empty"
            data-testid="product-preview-empty"
          >
            <strong>当前项目还没有可预览的镜头</strong>
            <span>请先在镜头管理中创建一个镜头，然后再打开产品预览。</span>
          </div>
        ) : (
          <>
            <div className="product-preview-stage">
              {assets.status === 'loading' ? (
                <div
                  className="product-preview-message"
                  data-testid="product-preview-loading"
                >
                  <strong>预览素材加载中</strong>
                  <span>正在读取当前镜头需要的图片素材。</span>
                </div>
              ) : assets.status === 'error' ? (
                <div
                  className="product-preview-message product-preview-warning"
                  data-testid="product-preview-asset-warning"
                >
                  <strong>部分素材无法预览</strong>
                  <span>
                    有 {assets.missingCount} 个图片素材缺少可用缩略图，请在项目素材库中重新导入或刷新后再试。
                  </span>
                </div>
              ) : evaluatedShot ? (
                <CanvasStage
                  assetUrls={assets.urls}
                  caption={caption}
                  captionStyle={captionStyle}
                  evaluatedShot={evaluatedShot}
                  project={project}
                />
              ) : null}
            </div>

            <div className="product-preview-transport">
              <div
                aria-label="产品预览播放控制"
                className="product-preview-controls"
              >
                <button
                  className="task4-hit-target"
                  data-task4-core="preview-play"
                  data-testid="product-preview-play"
                  disabled={playing || atEnd || durationMs <= 0}
                  onClick={() => setPlaying(true)}
                  type="button"
                >
                  播放
                </button>
                <button
                  className="task4-hit-target"
                  data-task4-core="preview-pause"
                  data-testid="product-preview-pause"
                  disabled={!playing}
                  onClick={() => setPlaying(false)}
                  type="button"
                >
                  暂停
                </button>
                <button
                  className="task4-hit-target"
                  data-task4-core="preview-stop"
                  data-testid="product-preview-stop"
                  disabled={!playing && timeMs === 0}
                  onClick={stopPlayback}
                  type="button"
                >
                  停止
                </button>
              </div>
              <input
                aria-label="产品预览进度"
                className="product-preview-scrubber"
                data-testid="product-preview-scrubber"
                max={durationMs}
                min={0}
                onChange={(event) => {
                  setPlaying(false);
                  setTimeMs(
                    clampProductPreviewTime(
                      Number(event.target.value),
                      durationMs,
                    ),
                  );
                }}
                step={10}
                type="range"
                value={timeMs}
              />
              <span
                className="product-preview-timecode"
                data-testid="product-preview-timecode"
              >
                {formatProductPreviewTimecode(timeMs)} /{' '}
                {formatProductPreviewTimecode(durationMs)}
              </span>
            </div>

            <p
              className="product-preview-hint"
              data-testid="product-preview-hint"
            >
              预览只读：播放进度不会修改项目内容，也不会产生未保存更改。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
