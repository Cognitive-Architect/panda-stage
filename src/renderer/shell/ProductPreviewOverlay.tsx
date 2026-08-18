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
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  projectProductPreviewMouth,
  resolveProductPreviewShot,
  resolveProductPreviewSubtitleStyle,
} from './productPreviewModel';
import { useProductPreviewAudio } from './productPreviewAudio';

export interface ProductPreviewOverlayProps {
  /** Project folder of the currently open project, used to read preview images. */
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
 * Loads one bounded original-image object URL per image asset the shot can
 * show. Asset Library thumbnails remain a separate lightweight path; Product
 * Preview uses the existing secure canvas-image IPC so a large stage is not
 * built by upscaling a 256px thumbnail.
 */
function useProductPreviewAssets(
  projectRoot: string,
  project: Project,
  assetIds: readonly string[],
): AssetLoadState {
  const [state, setState] = useState<AssetLoadState>(INITIAL_ASSET_STATE);
  const assetKey = [...assetIds]
    .map((assetId) => {
      const asset = project.assets.find((candidate) => candidate.id === assetId);
      return `${assetId}:${asset?.sha256 ?? 'missing'}`;
    })
    .sort()
    .join('|');

  useEffect(() => {
    let active = true;
    const objectUrls = new Set<string>();
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
        const response = await window.pandaStage.assets.readCanvasImage({
          projectRoot,
          assetId,
          sha256: asset.sha256,
        });
        if (!response.ok || response.status !== 'ready') {
          return [assetId, undefined] as const;
        }
        const objectUrl = URL.createObjectURL(
          new Blob([response.bytes], { type: response.mimeType }),
        );
        if (!active) {
          URL.revokeObjectURL(objectUrl);
          return [assetId, undefined] as const;
        }
        objectUrls.add(objectUrl);
        return [assetId, objectUrl] as const;
      } catch {
        return [assetId, undefined] as const;
      }
    });

    void Promise.all(requests).then((entries) => {
      if (!active) return;
      const urls: Record<string, string | undefined> = {};
      let missingCount = 0;
      for (const [assetId, objectUrl] of entries) {
        if (objectUrl) {
          urls[assetId] = objectUrl;
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
      for (const objectUrl of objectUrls) {
        URL.revokeObjectURL(objectUrl);
      }
      objectUrls.clear();
    };
  }, [assetIds, assetKey, project, projectRoot]);

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
  const [seekRevision, setSeekRevision] = useState(0);
  const assetIds = useMemo(
    () => (shot ? listProductPreviewAssetIds(project, shot) : []),
    [project, shot],
  );
  const assets = useProductPreviewAssets(projectRoot, project, assetIds);
  const cues = useMemo(
    () => (shot ? buildProductPreviewCues(shot) : []),
    [shot],
  );
  const durationMs = shot?.durationMs ?? 0;

  const replayPlayback = useCallback((): void => {
    if (durationMs <= 0) return;
    // The revision invalidates pending audio work and restarts the one
    // reusable audio element from the new master-clock position.
    setTimeMs(0);
    setSeekRevision((revision) => revision + 1);
    setPlaying(true);
  }, [durationMs]);

  useEffect(() => {
    // A shot switch resets the preview-local clock; nothing outside changes.
    setPlaying(false);
    setTimeMs(0);
    setSeekRevision((revision) => revision + 1);
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
          )
        : null,
    [project, shot, timeMs],
  );
  const activeCue = evaluatedShot
    ? evaluateSubtitleAtTime(cues, evaluatedShot.timeMs)
    : null;
  const audioWarning = useProductPreviewAudio({
    projectRoot,
    project,
    shot,
    activeDialogueId: activeCue?.id ?? null,
    timeMs: evaluatedShot?.timeMs ?? 0,
    playing,
    seekRevision,
  });
  const renderedShot = useMemo(
    () =>
      shot && evaluatedShot
        ? projectProductPreviewMouth(
            project,
            shot,
            evaluatedShot,
            activeCue?.id ?? null,
          )
        : evaluatedShot,
    [activeCue?.id, evaluatedShot, project, shot],
  );
  const caption = activeCue?.text ?? null;
  const captionStyle = resolveProductPreviewSubtitleStyle(project, activeCue);
  const atEnd = durationMs > 0 && timeMs >= durationMs;

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
        <button
          aria-label="关闭预览"
          className="product-preview-close task4-hit-target"
          data-task4-core="preview-close"
          data-testid="product-preview-close"
          onClick={onClose}
          title="关闭预览"
          type="button"
        >
          ×
        </button>

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
            <div className="product-preview-player">
              <div
                className="product-preview-stage"
                data-preview-image-source="bounded-original"
                data-preview-stage-fit="contain"
              >
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
                      有 {assets.missingCount} 个图片素材无法读取，请在项目素材库中重新导入或刷新后再试。
                    </span>
                  </div>
                ) : renderedShot ? (
                    <CanvasStage
                      assetUrls={assets.urls}
                      caption={caption}
                      captionStyle={captionStyle}
                      evaluatedShot={renderedShot}
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
                    aria-label={playing ? '暂停' : '播放'}
                    aria-pressed={playing}
                    className="product-preview-icon-button task4-hit-target"
                    data-task4-core={playing ? 'preview-pause' : 'preview-play'}
                    data-testid={
                      playing ? 'product-preview-pause' : 'product-preview-play'
                    }
                    disabled={durationMs <= 0 || (!playing && atEnd)}
                    onClick={() => setPlaying((current) => !current)}
                    title={playing ? '暂停' : '播放'}
                    type="button"
                  >
                    <span aria-hidden="true" className="product-preview-icon">
                      {playing ? '⏸' : '▶'}
                    </span>
                  </button>
                  <button
                    aria-label="重放"
                    className="product-preview-icon-button task4-hit-target"
                    data-task4-core="preview-replay"
                    data-testid="product-preview-replay"
                    disabled={durationMs <= 0}
                    onClick={replayPlayback}
                    title="重放"
                    type="button"
                  >
                    <span aria-hidden="true" className="product-preview-icon">
                      ↺
                    </span>
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
                    setSeekRevision((revision) => revision + 1);
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
            </div>

            {audioWarning ? (
              <p
                className="product-preview-hint product-preview-warning"
                data-testid="product-preview-audio-warning"
                role="status"
              >
                {audioWarning}
              </p>
            ) : null}

          </>
        )}
      </div>
    </div>
  );
}
