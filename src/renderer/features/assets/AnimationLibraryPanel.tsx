import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
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
  return `${(durationMs / 1_000).toFixed(2)} 秒`;
}

function blobUrl(bytes: Uint8Array, mimeType: string): string {
  return URL.createObjectURL(createAnimationImageBlob(bytes, mimeType));
}

interface AnimationCoverState {
  url: string | null;
  error: boolean;
  loading: boolean;
}

interface AnimationCoverReadResult {
  ok: boolean;
  mimeType?: string;
  bytes?: Uint8Array;
}

export function createAnimationCoverLoader(options: {
  read: () => Promise<AnimationCoverReadResult>;
  createUrl: (bytes: Uint8Array, mimeType: string) => string;
  revokeUrl: (url: string) => void;
  onStateChange: (state: AnimationCoverState) => void;
}): { setVisible: (visible: boolean) => void; dispose: () => void } {
  let visible = false;
  let disposed = false;
  let requestPending = false;
  let requestGeneration = 0;
  let coverUrl: string | null = null;

  const publish = (state: AnimationCoverState): void => {
    if (!disposed) options.onStateChange(state);
  };

  const load = (): void => {
    if (disposed || !visible || requestPending || coverUrl) return;
    requestPending = true;
    const generation = ++requestGeneration;
    publish({ url: null, error: false, loading: true });

    void options.read().then((response) => {
      requestPending = false;
      if (disposed) return;
      if (generation !== requestGeneration || !visible) {
        if (visible) load();
        return;
      }
      if (!response.ok || response.mimeType !== 'image/png' || !response.bytes) {
        publish({ url: null, error: true, loading: false });
        return;
      }
      coverUrl = options.createUrl(response.bytes, response.mimeType);
      publish({ url: coverUrl, error: false, loading: false });
    }).catch(() => {
      requestPending = false;
      if (disposed) return;
      if (generation !== requestGeneration || !visible) {
        if (visible) load();
        return;
      }
      publish({ url: null, error: true, loading: false });
    });
  };

  return {
    setVisible(nextVisible) {
      if (disposed || visible === nextVisible) return;
      visible = nextVisible;
      if (visible) {
        load();
        return;
      }
      requestGeneration += 1;
      if (coverUrl) options.revokeUrl(coverUrl);
      coverUrl = null;
      publish({ url: null, error: false, loading: false });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      visible = false;
      requestGeneration += 1;
      if (coverUrl) options.revokeUrl(coverUrl);
      coverUrl = null;
    },
  };
}

interface AnimationCardScrollPosition {
  element: HTMLElement;
  top: number;
  left: number;
}

export interface AnimationLibraryCardProps {
  animation: AnimationDefinition;
  project: Project;
  projectRoot: string;
}

export function AnimationLibraryCard({
  animation,
  project,
  projectRoot,
}: AnimationLibraryCardProps): React.JSX.Element {
  const [cover, setCover] = useState<AnimationCoverState>({ url: null, error: false, loading: false });
  const [open, setOpen] = useState(false);
  const coverStageRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const scrollPositionsRef = useRef<AnimationCardScrollPosition[]>([]);
  const windowScrollRef = useRef({ top: 0, left: 0 });
  const wasOpenRef = useRef(false);
  const firstFrame = animation.frames[0];

  useEffect(() => {
    setCover({ url: null, error: false, loading: false });
    if (!firstFrame) {
      setCover({ url: null, error: true, loading: false });
      return undefined;
    }
    const asset = project.assets.find((candidate) => candidate.id === firstFrame.assetId);
    if (!asset || asset.kind !== 'image' || asset.sha256 !== firstFrame.sha256) {
      setCover({ url: null, error: true, loading: false });
      return undefined;
    }
    const stage = coverStageRef.current;
    if (!stage) return undefined;
    const loader = createAnimationCoverLoader({
      read: () => window.pandaStage.assets.readCanvasImage({
        projectRoot,
        assetId: firstFrame.assetId,
        sha256: firstFrame.sha256,
      }),
      createUrl: blobUrl,
      revokeUrl: (url) => URL.revokeObjectURL(url),
      onStateChange: setCover,
    });
    const observer = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
          const entry = entries.find((candidate) => candidate.target === stage);
          if (entry) loader.setVisible(entry.isIntersecting);
        }, { rootMargin: '64px 0px' });
    if (observer) observer.observe(stage);
    else loader.setVisible(true);
    return () => {
      observer?.disconnect();
      loader.dispose();
    };
  }, [animation.id, firstFrame, project.assets, projectRoot]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      closeButtonRef.current?.focus();
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }
    if (!wasOpenRef.current) return undefined;
    wasOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      cardRef.current?.focus({ preventScroll: true });
      for (const position of scrollPositionsRef.current) {
        position.element.scrollTop = position.top;
        position.element.scrollLeft = position.left;
      }
      window.scrollTo(windowScrollRef.current.left, windowScrollRef.current.top);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const openPreview = (): void => {
    const card = cardRef.current;
    scrollPositionsRef.current = [];
    for (let element = card?.parentElement ?? null; element; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth) {
        scrollPositionsRef.current.push({
          element,
          top: element.scrollTop,
          left: element.scrollLeft,
        });
      }
    }
    windowScrollRef.current = { top: window.scrollY, left: window.scrollX };
    setOpen(true);
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled)',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const dialog = open ? (
    <div
      className="animation-preview-backdrop"
      data-testid="animation-preview-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        aria-labelledby={`animation-preview-title-${animation.id}`}
        aria-modal="true"
        className="animation-preview-dialog"
        data-testid="animation-preview-dialog"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <button
          aria-label="关闭动画预览"
          className="animation-preview-close"
          data-testid="animation-preview-close"
          onClick={() => setOpen(false)}
          ref={closeButtonRef}
          type="button"
        >
          <X aria-hidden="true" size={20} />
        </button>
        <AnimationPreview
          animation={animation}
          project={project}
          projectRoot={projectRoot}
          titleId={`animation-preview-title-${animation.id}`}
        />
      </div>
    </div>
  ) : null;

  return (
    <>
      <article
        aria-haspopup="dialog"
        aria-label={`${animation.name}，${animation.frames.length} 帧，${formatDuration(animation.durationMs)}，打开预览`}
        className="asset-card animation-library-card"
        data-animation-id={animation.id}
        data-asset-kind="animation"
        data-category="animation"
        data-testid="animation-library-card"
        onClick={openPreview}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPreview();
          }
        }}
        ref={cardRef}
        role="button"
        tabIndex={0}
      >
        <div className="asset-card-preview animation-library-card-preview">
          <div className="animation-library-cover-stage" data-cover-error={cover.error} ref={coverStageRef}>
            {cover.url && firstFrame ? (
              <div
                className="animation-library-cover-canvas"
                style={{
                  aspectRatio: `${animation.source.canvas.width} / ${animation.source.canvas.height}`,
                  width: `min(100%, ${320 * animation.source.canvas.width / animation.source.canvas.height}px)`,
                }}
              >
                <img
                  alt=""
                  className="animation-library-cover-image"
                  src={cover.url}
                  style={{
                    left: `${firstFrame.offset.x / animation.source.canvas.width * 100}%`,
                    top: `${firstFrame.offset.y / animation.source.canvas.height * 100}%`,
                    width: `${firstFrame.sourceViewport.width / animation.source.canvas.width * 100}%`,
                    height: `${firstFrame.sourceViewport.height / animation.source.canvas.height * 100}%`,
                  }}
                />
              </div>
            ) : cover.error ? <span>首帧暂不可用</span> : cover.loading ? <span>读取首帧…</span> : null}
          </div>
        </div>
        <span className="asset-card-type-badge asset-card-type-badge-animation">动画</span>
        <span className="asset-card-copy">
          <strong className="asset-card-name" title={animation.name}>{animation.name}</strong>
          <span className="asset-card-context">{animation.frames.length} 帧 · {formatDuration(animation.durationMs)}</span>
          <span className="asset-card-metadata">{formatFps(animation.source.sourceFps)} FPS</span>
        </span>
      </article>
      {dialog && typeof document !== 'undefined' ? createPortal(dialog, document.body) : null}
    </>
  );
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

  if (visibleAnimations.length === 0) {
    return (
      <div className="animation-library-empty" data-testid="animation-library-empty">
        <strong>{normalizedQuery ? '没有匹配的动画' : '还没有已导入的动画'}</strong>
        <p>{normalizedQuery ? '清除搜索条件后再试。' : '从 FLA 导入 1–24 帧序列后，动画会显示在这里。'}</p>
      </div>
    );
  }

  return (
    <div className="asset-grid" data-testid="animation-library-panel">
      {visibleAnimations.map((animation) => (
        <AnimationLibraryCard
          animation={animation}
          key={animation.id}
          project={project}
          projectRoot={projectRoot}
        />
      ))}
    </div>
  );
}

interface AnimationPreviewProps {
  animation: AnimationDefinition;
  project: Project;
  projectRoot: string;
  titleId: string;
}

type FrameLoadResult = 'loaded' | 'stale' | 'error';

export function AnimationPreview({
  animation,
  project,
  projectRoot,
  titleId,
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
          <strong id={titleId}>{animation.name}</strong>
        </div>
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
              width: `min(100%, ${640 * animation.source.canvas.width / animation.source.canvas.height}px)`,
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
