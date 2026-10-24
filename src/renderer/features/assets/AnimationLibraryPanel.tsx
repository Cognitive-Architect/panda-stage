import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { AnimationDefinition, Project } from '../../../domain';
import {
  createAnimationPlaybackTimeline,
  markAnimationPlaybackFrameVisible,
  sampleAnimationPlaybackTimeline,
  type AnimationPlaybackTimeline,
} from './animationPlayback';
import { createAnimationImageBlob } from './animationImageBytes';

export interface AnimationLibraryPanelProps {
  animations: readonly AnimationDefinition[];
  project: Project;
  projectRoot: string;
  searchQuery: string;
}

function formatFps(fps: number): string {
  return Number.isInteger(fps)
    ? String(fps)
    : fps.toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '');
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(2)} 秒`;
}

function blobUrl(bytes: Uint8Array, mimeType: string): string {
  return URL.createObjectURL(createAnimationImageBlob(bytes, mimeType));
}

export function AnimationLibraryPanel({
  animations,
  project,
  projectRoot,
  searchQuery,
}: AnimationLibraryPanelProps): React.JSX.Element {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('zh-CN');
  const visibleAnimations = useMemo(
    () => animations.filter((animation) =>
      [animation.name, animation.source.basename, animation.source.targetName]
        .some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedQuery)),
    ),
    [animations, normalizedQuery],
  );
  const [selectedAnimationId, setSelectedAnimationId] = useState<string | null>(null);
  const selectedAnimation =
    visibleAnimations.find((animation) => animation.id === selectedAnimationId) ??
    visibleAnimations[0] ??
    null;

  if (visibleAnimations.length === 0) {
    return (
      <div className="animation-library-empty" data-testid="animation-library-empty">
        <strong>{normalizedQuery ? '没有匹配的动画' : '还没有已导入的动画'}</strong>
        <p>{normalizedQuery ? '清除搜索条件后再试。' : '从 FLA 导入 1–24 帧序列后，动画会显示在这里。'}</p>
      </div>
    );
  }

  return (
    <div className="animation-library-panel" data-testid="animation-library-panel">
      <nav className="animation-library-list" aria-label="项目动画">
        {visibleAnimations.map((animation) => (
          <button
            aria-pressed={selectedAnimation?.id === animation.id}
            className={selectedAnimation?.id === animation.id
              ? 'animation-library-item animation-library-item-selected'
              : 'animation-library-item'}
            data-animation-id={animation.id}
            data-testid="animation-library-item"
            key={animation.id}
            onClick={() => setSelectedAnimationId(animation.id)}
            type="button"
          >
            <strong>{animation.name}</strong>
            <span>{animation.source.targetName}</span>
            <small>{animation.frames.length} 帧 · {formatFps(animation.source.sourceFps)} fps</small>
          </button>
        ))}
      </nav>
      {selectedAnimation ? (
        <AnimationPreview
          animation={selectedAnimation}
          key={selectedAnimation.id}
          project={project}
          projectRoot={projectRoot}
        />
      ) : null}
    </div>
  );
}

interface AnimationPreviewProps {
  animation: AnimationDefinition;
  project: Project;
  projectRoot: string;
}

type FrameLoadResult = 'loaded' | 'stale' | 'error';

function AnimationPreview({
  animation,
  project,
  projectRoot,
}: AnimationPreviewProps): React.JSX.Element {
  const [frameIndex, setFrameIndex] = useState(0);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const frameIndexRef = useRef(0);
  const frameUrlRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const playingRef = useRef(false);
  const playbackTimelineRef = useRef<AnimationPlaybackTimeline | null>(null);
  const pendingFrameIndexRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameIndex = animation.frames.length - 1;

  const replaceFrameUrl = useCallback((nextUrl: string | null): void => {
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    frameUrlRef.current = nextUrl;
    setFrameUrl(nextUrl);
  }, []);

  const loadFrame = useCallback(async (
    requestedIndex: number,
    shouldApply?: () => boolean,
  ): Promise<FrameLoadResult> => {
    const requestId = ++loadRequestRef.current;
    const frame = animation.frames[requestedIndex];
    if (!frame) return 'error';
    setLoading(true);
    setError(null);
    try {
      const asset = project.assets.find((candidate) => candidate.id === frame.assetId);
      if (!asset || asset.kind !== 'image' || asset.sha256 !== frame.sha256) {
        throw new Error('项目中的帧图片缺失或哈希不匹配。');
      }
      const response = await window.pandaStage.assets.readCanvasImage({
        projectRoot,
        assetId: frame.assetId,
        sha256: frame.sha256,
      });
      if (requestId !== loadRequestRef.current) return 'stale';
      if (!response.ok) throw new Error(response.error.message);
      if (response.mimeType !== 'image/png') {
        throw new Error('帧图片格式无效。');
      }
      if (shouldApply && !shouldApply()) {
        setLoading(false);
        return 'stale';
      }
      const nextUrl = blobUrl(response.bytes, response.mimeType);
      replaceFrameUrl(nextUrl);
      frameIndexRef.current = requestedIndex;
      setFrameIndex(requestedIndex);
      setLoading(false);
      return 'loaded';
    } catch (loadError) {
      if (requestId !== loadRequestRef.current) return 'stale';
      replaceFrameUrl(null);
      setLoading(false);
      setError(
        `第 ${requestedIndex + 1} 帧缺失或损坏，预览已停止：${
          loadError instanceof Error ? loadError.message : String(loadError)
        }`,
      );
      return 'error';
    }
  }, [animation, project.assets, projectRoot, replaceFrameUrl]);

  useEffect(() => {
    playingRef.current = false;
    playbackTimelineRef.current = null;
    pendingFrameIndexRef.current = null;
    frameIndexRef.current = 0;
    setFrameIndex(0);
    setPlaying(false);
    replaceFrameUrl(null);
    void loadFrame(0);
    return () => {
      loadRequestRef.current += 1;
      playingRef.current = false;
      playbackTimelineRef.current = null;
      pendingFrameIndexRef.current = null;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
      frameUrlRef.current = null;
    };
  }, [loadFrame, replaceFrameUrl]);

  const startPlayback = useCallback((fromIndex: number): void => {
    playbackTimelineRef.current = createAnimationPlaybackTimeline(
      animation.source.sourceFps,
      animation.frames.length,
      performance.now(),
      fromIndex,
    );
    pendingFrameIndexRef.current = null;
    playingRef.current = true;
    setPlaying(true);
  }, [animation]);

  const pausePlayback = (): void => {
    playingRef.current = false;
    playbackTimelineRef.current = null;
    pendingFrameIndexRef.current = null;
    setPlaying(false);
  };

  const play = (): void => {
    if (loading || error) return;
    if (frameIndex >= lastFrameIndex) {
      void loadFrame(0).then((loaded) => {
        if (loaded === 'loaded') startPlayback(0);
      });
      return;
    }
    startPlayback(frameIndex);
  };

  const replay = (): void => {
    pausePlayback();
    void loadFrame(0).then((loaded) => {
      if (loaded === 'loaded') startPlayback(0);
    });
  };

  useEffect(() => {
    if (!playing) return undefined;
    let disposed = false;
    const stop = (): void => {
      playingRef.current = false;
      playbackTimelineRef.current = null;
      pendingFrameIndexRef.current = null;
      setPlaying(false);
    };
    const tick = (now: number): void => {
      if (disposed || !playingRef.current) return;
      const timeline = playbackTimelineRef.current;
      if (!timeline) {
        stop();
        return;
      }
      const sample = sampleAnimationPlaybackTimeline(timeline, now);
      if (sample.complete) {
        stop();
        return;
      }
      if (
        sample.frameIndex !== frameIndexRef.current &&
        pendingFrameIndexRef.current === null
      ) {
        const requestedIndex = sample.frameIndex;
        pendingFrameIndexRef.current = requestedIndex;
        void loadFrame(requestedIndex, () => {
          const currentTimeline = playbackTimelineRef.current;
          return playingRef.current && currentTimeline !== null &&
            sampleAnimationPlaybackTimeline(currentTimeline, performance.now()).frameIndex === requestedIndex;
        }).then((result) => {
          if (pendingFrameIndexRef.current === requestedIndex) {
            pendingFrameIndexRef.current = null;
          }
          if (!disposed && playingRef.current && result === 'error') stop();
        });
      }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    animationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      disposed = true;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [loadFrame, playing]);

  useEffect(() => {
    const timeline = playbackTimelineRef.current;
    if (playing && frameUrl && timeline) {
      markAnimationPlaybackFrameVisible(timeline, frameIndex, performance.now());
    }
  }, [frameIndex, frameUrl, playing]);

  const seek = (requestedIndex: number): void => {
    pausePlayback();
    void loadFrame(requestedIndex);
  };

  return (
    <section className="animation-preview" data-animation-id={animation.id} data-testid="animation-preview">
      <header className="animation-preview-header">
        <div>
          <strong>{animation.name}</strong>
          <span>{animation.source.targetName} · {animation.frames.length} 帧 · {formatDuration(animation.durationMs)}</span>
          <span title="动画暂不支持加入镜头或正式导出">仅支持素材库预览</span>
        </div>
        <small>{formatFps(animation.source.sourceFps)} fps</small>
      </header>
      <div
        aria-busy={loading}
        className="animation-preview-stage"
        data-frame-index={frameIndex}
        data-testid="animation-preview-stage"
      >
        {frameUrl ? (
          <div
            className="animation-preview-canvas"
            data-testid="animation-preview-canvas"
            style={{
              aspectRatio: `${animation.source.canvas.width} / ${animation.source.canvas.height}`,
              width: `min(100%, ${360 * animation.source.canvas.width / animation.source.canvas.height}px)`,
            }}
          >
            <img
              alt={`${animation.name}，第 ${frameIndex + 1} 帧`}
              src={frameUrl}
              style={{
                left: `${animation.frames[frameIndex]!.offset.x / animation.source.canvas.width * 100}%`,
                top: `${animation.frames[frameIndex]!.offset.y / animation.source.canvas.height * 100}%`,
                width: `${animation.frames[frameIndex]!.sourceViewport.width / animation.source.canvas.width * 100}%`,
                height: `${animation.frames[frameIndex]!.sourceViewport.height / animation.source.canvas.height * 100}%`,
              }}
            />
          </div>
        ) : loading ? (
          <span>正在读取第 {frameIndex + 1} 帧…</span>
        ) : (
          <span>帧图片不可用</span>
        )}
      </div>
      {error ? <p className="animation-preview-error" role="alert">{error}</p> : null}
      <div className="animation-preview-controls">
        <button
          aria-label={playing ? '暂停动画' : '播放动画'}
          data-testid="animation-preview-play"
          disabled={(loading && !frameUrl) || animation.frames.length === 0 || Boolean(error)}
          onClick={() => {
            if (playing) {
              pausePlayback();
            } else {
              play();
            }
          }}
          type="button"
        >
          {playing ? <Pause aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
          {playing ? '暂停' : '播放'}
        </button>
        <button
          aria-label="从头重播动画"
          data-testid="animation-preview-replay"
          disabled={loading && !frameUrl}
          onClick={replay}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={16} />
          重播
        </button>
        <label className="animation-preview-seek">
          <span>帧</span>
          <input
            aria-label="选择动画帧"
            data-testid="animation-preview-seek"
            max={lastFrameIndex}
            min={0}
            onChange={(event) => seek(Number(event.target.value))}
            type="range"
            value={frameIndex}
          />
          <output>{frameIndex + 1} / {animation.frames.length}</output>
        </label>
      </div>
    </section>
  );
}
