import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluateShotAtTime } from '../shared/domain';
import type {
  ExportLoadProbeRequest,
  ExportRenderFrameRequest,
} from '../shared/export-types';
import {
  PROBE_PROJECT,
  PROBE_SHOT,
  PROBE_SUBTITLE_CUES,
} from '../shared/probe/probe-project';
import { evaluateSubtitleAtTime } from '../shared/preview/subtitle-engine';
import { CanvasStage } from '../renderer/stage/CanvasStage';
import { PROBE_ASSET_URLS } from '../renderer/stage/probe-assets';

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('隐藏舞台无法生成 PNG Blob。'));
        return;
      }
      void blob.arrayBuffer().then(
        (buffer) => resolve(new Uint8Array(buffer)),
        (error: unknown) => reject(error),
      );
    }, 'image/png');
  });
}

export function ExportRendererApp(): React.JSX.Element {
  const [durationMs, setDurationMs] = useState(PROBE_SHOT.durationMs);
  const [frameRequest, setFrameRequest] =
    useState<ExportRenderFrameRequest | null>(null);
  const readyAnnouncedRef = useRef(false);
  const stageReadyRef = useRef(false);
  const loadedJobIdRef = useRef<string | null>(null);
  const pendingLoadRef = useRef<ExportLoadProbeRequest | null>(null);
  const activeFrameRef = useRef<ExportRenderFrameRequest | null>(null);
  const captureInFlightRef = useRef(false);

  const shot = useMemo(
    () => ({ ...PROBE_SHOT, durationMs }),
    [durationMs],
  );
  const requestedTimeMs = frameRequest?.timeMs ?? 0;
  const evaluatedShot = useMemo(
    () => evaluateShotAtTime(shot, requestedTimeMs),
    [requestedTimeMs, shot],
  );
  const subtitle = evaluateSubtitleAtTime(
    PROBE_SUBTITLE_CUES,
    evaluatedShot.timeMs,
  );

  const acknowledgeLoad = useCallback((request: ExportLoadProbeRequest) => {
    window.pandaStageHidden.probeLoaded({
      jobId: request.jobId,
      acknowledged: true,
    });
  }, []);

  const failFrame = useCallback(
    (request: ExportRenderFrameRequest, error: unknown) => {
      activeFrameRef.current = null;
      captureInFlightRef.current = false;
      window.pandaStageHidden.frameFailed({
        jobId: request.jobId,
        frameIndex: request.frameIndex,
        timeMs: request.timeMs,
        error: error instanceof Error ? error.message : '隐藏帧渲染失败。',
      });
    },
    [],
  );

  useEffect(() => {
    const removeLoadListener = window.pandaStageHidden.onLoadProbe((request) => {
      loadedJobIdRef.current = request.jobId;
      setDurationMs(request.durationMs);
      if (stageReadyRef.current) {
        acknowledgeLoad(request);
      } else {
        pendingLoadRef.current = request;
      }
    });
    const removeFrameListener = window.pandaStageHidden.onRenderFrame(
      (request) => {
        if (loadedJobIdRef.current !== request.jobId) {
          failFrame(
            request,
            new Error(`隐藏窗口尚未加载 Job ${request.jobId}。`),
          );
          return;
        }
        if (activeFrameRef.current || captureInFlightRef.current) {
          window.pandaStageHidden.frameFailed({
            jobId: request.jobId,
            frameIndex: request.frameIndex,
            timeMs: request.timeMs,
            error: '隐藏窗口仍在处理上一帧。',
          });
          return;
        }
        activeFrameRef.current = request;
        setFrameRequest(request);
      },
    );

    return () => {
      removeLoadListener();
      removeFrameListener();
    };
  }, [acknowledgeLoad, failFrame]);

  const handleStageError = useCallback(
    (error: Error) => {
      const activeFrame = activeFrameRef.current;
      if (activeFrame) {
        failFrame(activeFrame, error);
      } else {
        console.error('Export renderer stage failed.', error);
      }
    },
    [failFrame],
  );

  const handleStageReady = useCallback(() => {
    stageReadyRef.current = true;

    if (!readyAnnouncedRef.current) {
      readyAnnouncedRef.current = true;
      void window.pandaStageHidden
        .ready()
        .then((response) => {
          document.documentElement.dataset.ready = String(
            response.acknowledged,
          );
        })
        .catch((error: unknown) => {
          readyAnnouncedRef.current = false;
          document.documentElement.dataset.ready = 'false';
          console.error('Export renderer ready handshake failed.', error);
        });
    }

    const pendingLoad = pendingLoadRef.current;
    if (pendingLoad) {
      pendingLoadRef.current = null;
      acknowledgeLoad(pendingLoad);
    }

    const activeFrame = activeFrameRef.current;
    if (!activeFrame || captureInFlightRef.current) {
      return;
    }
    captureInFlightRef.current = true;

    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="stage-renderer"] canvas',
    );
    if (!canvas) {
      failFrame(activeFrame, new Error('隐藏舞台 Canvas 不存在。'));
      return;
    }
    if (canvas.width !== 1_920 || canvas.height !== 1_080) {
      failFrame(
        activeFrame,
        new Error(`隐藏舞台尺寸错误：${canvas.width}x${canvas.height}。`),
      );
      return;
    }

    void canvasToPngBytes(canvas)
      .then((pngBytes) => {
        window.pandaStageHidden.frameReady({
          jobId: activeFrame.jobId,
          frameIndex: activeFrame.frameIndex,
          timeMs: activeFrame.timeMs,
          width: 1_920,
          height: 1_080,
          pngBytes,
        });
        activeFrameRef.current = null;
        captureInFlightRef.current = false;
      })
      .catch((error: unknown) => failFrame(activeFrame, error));
  }, [acknowledgeLoad, failFrame]);

  return (
    <main className="hidden-stage-shell">
      <CanvasStage
        assetUrls={PROBE_ASSET_URLS}
        caption={subtitle?.text ?? null}
        evaluatedShot={evaluatedShot}
        onError={handleStageError}
        onReady={handleStageReady}
        project={PROBE_PROJECT}
        renderToken={
          frameRequest
            ? `${frameRequest.jobId}:${frameRequest.frameIndex}`
            : 'initial'
        }
      />
    </main>
  );
}
