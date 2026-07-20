import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PreviewPlaybackEngine,
  type PreviewPlaybackSnapshot,
} from './preview-playback-engine';
import { createWebAudioRuntime } from './web-audio-runtime';

export type PreviewControllerStatus =
  | 'loading'
  | 'stopped'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface PreviewControllerSnapshot {
  status: PreviewControllerStatus;
  timeMs: number;
  durationMs: number;
  activeSourceCount: number;
  sourceStartCount: number;
  sourceStopCount: number;
  clockKind: 'audio-context';
  clockState: string;
  error: string | null;
}

const initialSnapshot = (durationMs: number): PreviewControllerSnapshot => ({
  status: 'loading',
  timeMs: 0,
  durationMs,
  activeSourceCount: 0,
  sourceStartCount: 0,
  sourceStopCount: 0,
  clockKind: 'audio-context',
  clockState: 'initializing',
  error: null,
});

function fromEngine(
  snapshot: PreviewPlaybackSnapshot,
): PreviewControllerSnapshot {
  return { ...snapshot, error: null };
}

export function usePreviewController(
  audioUrl: string,
  durationMs: number,
): PreviewControllerSnapshot & {
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  replay: () => Promise<void>;
} {
  const engineRef = useRef<PreviewPlaybackEngine | null>(null);
  const [snapshot, setSnapshot] = useState(() => initialSnapshot(durationMs));

  useEffect(() => {
    let disposed = false;

    const update = (next: PreviewPlaybackSnapshot): void => {
      if (!disposed) {
        setSnapshot(fromEngine(next));
      }
    };

    void createWebAudioRuntime(audioUrl)
      .then((runtime) => {
        if (disposed) {
          return runtime.close();
        }
        const engine = new PreviewPlaybackEngine(runtime, durationMs, update);
        engineRef.current = engine;
        update(engine.snapshot());
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSnapshot({
            ...initialSnapshot(durationMs),
            status: 'error',
            clockState: 'failed',
            error: error instanceof Error ? error.message : '预览音频加载失败。',
          });
        }
      });

    return () => {
      disposed = true;
      const engine = engineRef.current;
      engineRef.current = null;
      if (engine) {
        void engine.destroy();
      }
    };
  }, [audioUrl, durationMs]);

  useEffect(() => {
    if (snapshot.status !== 'playing') {
      return;
    }

    let animationFrame = 0;
    const tick = (): void => {
      const next = engineRef.current?.snapshot();
      if (!next) {
        return;
      }
      setSnapshot(fromEngine(next));
      if (next.status === 'playing') {
        animationFrame = window.requestAnimationFrame(tick);
      }
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [snapshot.status]);

  const fail = useCallback(
    (error: unknown): void => {
      setSnapshot((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : '预览控制失败。',
      }));
    },
    [],
  );

  const play = useCallback(async (): Promise<void> => {
    try {
      await engineRef.current?.play();
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  const pause = useCallback((): void => {
    engineRef.current?.pause();
  }, []);

  const stop = useCallback((): void => {
    engineRef.current?.stop();
  }, []);

  const replay = useCallback(async (): Promise<void> => {
    try {
      await engineRef.current?.replay();
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  return { ...snapshot, play, pause, stop, replay };
}
