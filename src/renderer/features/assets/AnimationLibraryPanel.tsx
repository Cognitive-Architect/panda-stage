import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import {
  collectFlaGraphicTimelineDurationMs,
  evaluateFlaGraphicVisual,
  type EvaluatedFlaGraphicVisual,
  type ProjectAnimationDefinition,
  type Project,
} from '../../../domain';
import {
  createAnimationPlaybackTimeline,
  markAnimationPlaybackFrameVisible,
  sampleAnimationPlaybackTimeline,
  type AnimationPlaybackTimeline,
} from './animationPlayback';
import { createAnimationImageBlob } from './animationImageBytes';
import { renderFlaGraphicCanvas } from '../canvas/flaGraphicCanvasRenderer';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import {
  writeAnimationDropContext,
  writeAssetDropPayload,
} from './AssetDropPayload';

export interface AnimationLibraryPanelProps {
  animations: readonly ProjectAnimationDefinition[];
  project: Project;
  projectRoot: string;
  searchQuery: string;
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1_000).toFixed(2)} 秒`;
}

function blobUrl(bytes: Uint8Array, mimeType: string): string {
  return URL.createObjectURL(createAnimationImageBlob(bytes, mimeType));
}

async function canvasPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('FLA Graphic preview could not be encoded.'));
    }, 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

async function decodeCanvasImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(
    new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }),
  );
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      if (image.complete && image.naturalWidth > 0) {
        resolve();
        return;
      }
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('FLA Graphic preview image could not be decoded.'));
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export interface FlaGraphicPreviewTimelineSpec {
  readonly hasInternalTimeline: boolean;
  readonly timelineDurationMs: number;
  readonly fps: number;
  readonly totalFrames: number;
  readonly sampleAtFrameIndex: (frameIndex: number) => {
    readonly frameOrdinal: number;
    readonly internalTimeMs: number | undefined;
  };
}

export function resolveFlaGraphicPreviewTimeline(
  animation: ProjectAnimationDefinition,
): FlaGraphicPreviewTimelineSpec {
  const fps = Math.max(1, animation.source.sourceFps || 24);
  const timelineDurationMs =
    'kind' in animation && animation.kind === 'fla-graphic' && animation.structure
      ? collectFlaGraphicTimelineDurationMs(
          animation.structure.timeline,
          animation.structure,
        )
      : 0;
  const hasInternalTimeline = timelineDurationMs > 0;
  const totalFrames = hasInternalTimeline
    ? Math.max(
        animation.frames.length,
        Math.floor((timelineDurationMs * fps) / 1_000) + 1,
      )
    : animation.frames.length;

  return {
    hasInternalTimeline,
    timelineDurationMs,
    fps,
    totalFrames,
    sampleAtFrameIndex(frameIndex: number) {
      const clampedIndex = Math.max(
        0,
        Math.min(frameIndex, Math.max(0, totalFrames - 1)),
      );
      const mappedFrameIndex = Math.min(
        clampedIndex,
        Math.max(0, animation.frames.length - 1),
      );
      const frameOrdinal = animation.frames[mappedFrameIndex]?.ordinal ?? 0;
      if (!hasInternalTimeline) {
        return { frameOrdinal, internalTimeMs: undefined };
      }
      const internalTimeMs =
        clampedIndex >= totalFrames - 1
          ? timelineDurationMs
          : Math.min(
              timelineDurationMs,
              Math.round((clampedIndex * 1_000) / fps),
            );
      return { frameOrdinal, internalTimeMs };
    },
  };
}

export function evaluateFlaGraphicDefinitionPreviewVisual(
  animation: Extract<ProjectAnimationDefinition, { kind: 'fla-graphic' }>,
  frameIndex: number,
): EvaluatedFlaGraphicVisual | null {
  const spec = resolveFlaGraphicPreviewTimeline(animation);
  const sample = spec.sampleAtFrameIndex(frameIndex);
  return evaluateFlaGraphicVisual({
    definition: animation,
    frameOrdinal: sample.frameOrdinal,
    mode: 'definition',
    internalTimeMs: sample.internalTimeMs,
  });
}

async function readFlaGraphicFramePreview(
  animation: Extract<ProjectAnimationDefinition, { kind: 'fla-graphic' }>,
  project: Project,
  projectRoot: string,
  frameOrdinal: number,
  internalTimeMs?: number,
): Promise<{ bytes: Uint8Array; mimeType: string; structured: boolean }> {
  const frame = animation.frames.find((candidate) => candidate.ordinal === frameOrdinal);
  if (!frame) throw new Error('The selected FLA Graphic frame is unavailable.');
  const visual = evaluateFlaGraphicVisual({
    definition: animation,
    frameOrdinal,
    mode: 'definition',
    internalTimeMs,
  });
  if (!visual?.structureFrame) {
    const frameAsset = project.assets.find((asset) => asset.id === frame.assetId);
    if (
      !frameAsset || frameAsset.kind !== 'image' ||
      frameAsset.sha256 !== frame.sha256
    ) {
      throw new Error('The selected FLA Graphic frame asset is missing or changed.');
    }
    const frameResponse = await window.pandaStage.assets.readCanvasImage({
      projectRoot,
      assetId: frameAsset.id,
      sha256: frame.sha256,
    });
    if (!frameResponse.ok) throw new Error(frameResponse.error.message);
    return {
      bytes: frameResponse.bytes,
      mimeType: frameResponse.mimeType,
      structured: false,
    };
  }

  const images = new Map<string, HTMLImageElement>();
  const imageEntries = await Promise.all(visual.resourceAssetIds.map(async (assetId) => {
    const asset = project.assets.find(
      (candidate) => candidate.id === assetId && candidate.kind === 'image',
    );
    if (!asset?.sha256) return null;
    try {
      const response = await window.pandaStage.assets.readCanvasImage({
        projectRoot,
        assetId: asset.id,
        sha256: asset.sha256,
      });
      if (!response.ok) return null;
      return [asset.id, await decodeCanvasImage(response.bytes, response.mimeType)] as const;
    } catch {
      return null;
    }
  }));
  for (const entry of imageEntries) {
    if (entry) images.set(entry[0], entry[1]);
  }
  const canvas = renderFlaGraphicCanvas(visual, images);
  if (!canvas) throw new Error('FLA Graphic structure could not be rendered.');
  return { bytes: await canvasPngBytes(canvas.canvas), mimeType: 'image/png', structured: true };
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
      if (
        !response.ok ||
        (response.mimeType !== 'image/png' && response.mimeType !== 'image/svg+xml') ||
        !response.bytes
      ) {
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
  animation: ProjectAnimationDefinition;
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
  const draggedCardRef = useRef(false);
  const firstFrame = animation.frames[0];
  const hasStructuredCover = Boolean(
    'kind' in animation && animation.kind === 'fla-graphic' &&
    firstFrame &&
    animation.structure?.frames.some((frame) => frame.ordinal === firstFrame.ordinal),
  );

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
      read: async () => {
        if ('kind' in animation && animation.kind === 'fla-graphic') {
          try {
            const preview = await readFlaGraphicFramePreview(
              animation,
              project,
              projectRoot,
              firstFrame.ordinal,
            );
            return { ok: true, mimeType: preview.mimeType, bytes: preview.bytes };
          } catch {
            return { ok: false };
          }
        }
        return window.pandaStage.assets.readCanvasImage({
          projectRoot,
          assetId: firstFrame.assetId,
          sha256: firstFrame.sha256,
        });
      },
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
  }, [animation, firstFrame, project, projectRoot]);

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
        draggable
        onClick={() => {
          if (draggedCardRef.current) {
            draggedCardRef.current = false;
            return;
          }
          openPreview();
        }}
        onDragStart={(event) => {
          draggedCardRef.current = true;
          event.dataTransfer.effectAllowed = 'copy';
          writeAssetDropPayload(event.dataTransfer, {
            version: 3,
            type: 'animation',
            animationId: animation.id,
          });
          const snapshot = editorProjectStore.getSnapshot();
          const shotId = shotStore.getCurrentShotId();
          const projectInstanceId =
            editorProjectStore.getProjectInstanceId();
          if (
            snapshot?.project.id === project.id &&
            snapshot.projectRoot === projectRoot &&
            snapshot.project.animations.some(
              (candidate) => candidate.id === animation.id,
            ) &&
            shotId &&
            snapshot.project.shots.some((candidate) => candidate.id === shotId) &&
            projectInstanceId !== null
          ) {
            writeAnimationDropContext(event.dataTransfer, {
              version: 1,
              animationId: animation.id,
              projectId: project.id,
              projectInstanceId,
              projectRevision: snapshot.revision,
              shotId,
            });
          }
        }}
        onDragEnd={() => {
          window.setTimeout(() => {
            draggedCardRef.current = false;
          }, 0);
        }}
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
                  draggable={false}
                  src={cover.url}
                  style={{
                    left: hasStructuredCover ? '0%' : `${firstFrame.offset.x / animation.source.canvas.width * 100}%`,
                    top: hasStructuredCover ? '0%' : `${firstFrame.offset.y / animation.source.canvas.height * 100}%`,
                    width: hasStructuredCover ? '100%' : `${firstFrame.sourceViewport.width / animation.source.canvas.width * 100}%`,
                    height: hasStructuredCover ? '100%' : `${firstFrame.sourceViewport.height / animation.source.canvas.height * 100}%`,
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
  animation: ProjectAnimationDefinition;
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
  const previewTimelineSpec = resolveFlaGraphicPreviewTimeline(animation);
  const animationFrameRef = useRef<number | null>(null);
  const totalPreviewFrames = previewTimelineSpec.totalFrames;
  const lastFrameIndex = Math.max(0, totalPreviewFrames - 1);

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
    const sample = resolveFlaGraphicPreviewTimeline(animation).sampleAtFrameIndex(
      requestedIndex,
    );
    const frame = animation.frames.find(
      (candidate) => candidate.ordinal === sample.frameOrdinal,
    ) ?? animation.frames[requestedIndex];
    if (!frame) return 'error';
    setLoading(true);
    setError(null);
    try {
      const asset = project.assets.find((candidate) => candidate.id === frame.assetId);
      if (!asset || asset.kind !== 'image' || asset.sha256 !== frame.sha256) {
        throw new Error('项目中的帧图片缺失或哈希不匹配。');
      }
      let previewBytes: Uint8Array;
      let previewMimeType: string;
      if ('kind' in animation && animation.kind === 'fla-graphic') {
        const preview = await readFlaGraphicFramePreview(
          animation,
          project,
          projectRoot,
          frame.ordinal,
          sample.internalTimeMs,
        );
        previewBytes = preview.bytes;
        previewMimeType = preview.mimeType;
      } else {
        const response = await window.pandaStage.assets.readCanvasImage({
          projectRoot,
          assetId: frame.assetId,
          sha256: frame.sha256,
        });
        if (!response.ok) throw new Error(response.error.message);
        previewBytes = response.bytes;
        previewMimeType = response.mimeType;
      }
      if (requestId !== loadRequestRef.current) return 'stale';
      if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(previewMimeType)) {
        throw new Error('Frame image MIME type is invalid.');
      }      if (shouldApply && !shouldApply()) {
        setLoading(false);
        return 'stale';
      }
      const nextUrl = blobUrl(previewBytes, previewMimeType);
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
    const spec = resolveFlaGraphicPreviewTimeline(animation);
    playbackTimelineRef.current = createAnimationPlaybackTimeline(
      spec.fps,
      spec.totalFrames,
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

  const displayedFrameIndex = Math.min(
    frameIndex,
    Math.max(0, animation.frames.length - 1),
  );
  const displayedFrame = animation.frames[displayedFrameIndex];
  const displayedFrameIsStructured = Boolean(
    'kind' in animation && animation.kind === 'fla-graphic' &&
    displayedFrame &&
    animation.structure?.frames.some(
      (candidate) => candidate.ordinal === displayedFrame.ordinal,
    ),
  );

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
                left: displayedFrameIsStructured ? '0%' : `${displayedFrame!.offset.x / animation.source.canvas.width * 100}%`,
                top: displayedFrameIsStructured ? '0%' : `${displayedFrame!.offset.y / animation.source.canvas.height * 100}%`,
                width: displayedFrameIsStructured ? '100%' : `${displayedFrame!.sourceViewport.width / animation.source.canvas.width * 100}%`,
                height: displayedFrameIsStructured ? '100%' : `${displayedFrame!.sourceViewport.height / animation.source.canvas.height * 100}%`,
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
          <output>{frameIndex + 1} / {totalPreviewFrames}</output>
        </label>
      </div>
    </section>
  );
}
