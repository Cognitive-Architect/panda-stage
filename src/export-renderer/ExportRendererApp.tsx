import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import {
  evaluateShotAtTime,
  evaluateSpeakerFocusCamera,
  mapProjectTime,
  prepareSpeakerFocusCamera,
  type Project,
} from '../domain';
import type {
  ExportLoadFormalRequest,
  ExportLoadProbeRequest,
  ExportRenderFrameRequest,
} from '../shared/export-types';
import {
  EXPORT_DRAW_MODE_QUERY_PARAM,
  EXPORT_FRAME_TIMING_QUERY_PARAM,
  parseExportDrawMode,
} from '../shared/export-draw-mode';
import {
  EXPORT_PNG_MODE_QUERY_PARAM,
  parseExportPngMode,
} from '../shared/export-png-mode';
import {
  PROBE_CHARACTER_ASSET_ID,
  PROBE_CHARACTER_LAYER_ID,
  PROBE_PROJECT,
  PROBE_SHOT,
  PROBE_SUBTITLE_CUES,
} from '../shared/probe/probe-project';
import { buildDialogueSubtitleCues } from '../shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../shared/preview/subtitle-engine';
import { CanvasStage } from '../renderer/stage/CanvasStage';
import { PROBE_ASSET_URLS } from '../renderer/stage/probe-assets';
import {
  projectProductPreviewMouth,
  resolveProductPreviewSubtitleStyle,
} from '../renderer/shell/productPreviewModel';
import {
  isExactExportFrameDrawn,
  isExactExportFrameReady,
  readExportStageReadiness,
} from './export-frame-readiness';
import { captureExportStageCanvas } from './stage-capture';
import { WorkerPngEncoder } from './worker-png-encoder';

const exportStageDrawMode = parseExportDrawMode(
  new URLSearchParams(window.location.search).get(EXPORT_DRAW_MODE_QUERY_PARAM),
) ?? 'legacy-raf';
const exportFrameTimingEnabled =
  new URLSearchParams(window.location.search).get(
    EXPORT_FRAME_TIMING_QUERY_PARAM,
  ) === 'true';
const exportPngMode =
  parseExportPngMode(
    new URLSearchParams(window.location.search).get(
      EXPORT_PNG_MODE_QUERY_PARAM,
    ),
  ) ?? 'legacy-blob';

if (exportStageDrawMode === 'explicit-sync') {
  // This hidden renderer has its own Chromium process; editor Preview retains
  // Konva's normal automatic and rAF-scheduled drawing behavior.
  Konva.autoDrawEnabled = false;
}

function canvasToPngBytes(
  canvas: HTMLCanvasElement,
): Promise<Uint8Array<ArrayBuffer>> {
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
  const evidenceParameters = new URLSearchParams(window.location.search);
  const issue47FlipEvidence =
    evidenceParameters.get('issue47FlipEvidence') === 'true';
  const issue47FlipX =
    evidenceParameters.get('issue47FlipX') === 'true';
  const issue573ExactFrameProbe =
    evidenceParameters.get('issue573ExactFrameProbe') === 'true';
  const probeProject = useMemo(() => {
    if (!issue47FlipEvidence) return PROBE_PROJECT;
    const characterLayer = PROBE_SHOT.layers.find(
      (layer) => layer.id === PROBE_CHARACTER_LAYER_ID,
    );
    if (!characterLayer) {
      throw new Error('Issue #47 probe character layer is missing.');
    }
    return {
      ...PROBE_PROJECT,
      shots: [
        {
          ...PROBE_SHOT,
          name: 'Issue #47 production flip probe',
          backgroundLayerId: null,
          layers: [
            {
              ...characterLayer,
              x: PROBE_PROJECT.width / 2,
              y: PROBE_PROJECT.height / 2,
              flipX: issue47FlipX,
            },
          ],
          timelineEvents: [],
        },
      ],
    };
  }, [issue47FlipEvidence, issue47FlipX]);
  const [formalRequest, setFormalRequest] =
    useState<ExportLoadFormalRequest | null>(null);
  const [formalAssetUrls, setFormalAssetUrls] = useState<
    Readonly<Record<string, string>>
  >({});
  const project: Project = formalRequest?.project ?? probeProject;
  const [probeDurationMs, setProbeDurationMs] = useState(PROBE_SHOT.durationMs);
  const [frameRequest, setFrameRequest] =
    useState<ExportRenderFrameRequest | null>(null);
  const requestedTimeMs = frameRequest?.timeMs ?? 0;
  const formalPosition = formalRequest
    ? mapProjectTime(project, requestedTimeMs)
    : null;
  const projectShot = formalPosition?.shot ?? project.shots[0];
  if (!projectShot) {
    throw new Error('Export renderer Project must contain a Shot.');
  }
  const readyAnnouncedRef = useRef(false);
  const stageReadyRef = useRef(false);
  const loadedJobIdRef = useRef<string | null>(null);
  const loadedFormalProjectRef = useRef<Project | null>(null);
  const pendingLoadRef = useRef<ExportLoadProbeRequest | null>(null);
  const pendingFormalLoadRef = useRef<ExportLoadFormalRequest | null>(null);
  const activeFrameRef = useRef<ExportRenderFrameRequest | null>(null);
  const activeFrameStartedAtRef = useRef<number | null>(null);
  const captureInFlightRef = useRef(false);
  const cancelledJobIdsRef = useRef(new Set<string>());
  const workerPngEncoderRef = useRef<WorkerPngEncoder | null>(null);

  const shot = useMemo(
    () => formalRequest
      ? projectShot
      : { ...projectShot, durationMs: probeDurationMs },
    [formalRequest, probeDurationMs, projectShot],
  );
  const shotLocalTimeMs = formalRequest
    ? formalPosition?.shotLocalTimeMs ?? 0
    : requestedTimeMs;
  useEffect(() => {
    if (!formalRequest) {
      setFormalAssetUrls({});
      return undefined;
    }
    const urls: Record<string, string> = {};
    for (const entry of formalRequest.media) {
      urls[entry.assetId] = URL.createObjectURL(
        new Blob([entry.bytes], { type: entry.mimeType }),
      );
    }
    setFormalAssetUrls(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [formalRequest]);
  const exportAssetUrls = useMemo(() => {
    if (formalRequest) return formalAssetUrls;
    if (!issue573ExactFrameProbe) return PROBE_ASSET_URLS;
    const characterUrl = PROBE_ASSET_URLS[PROBE_CHARACTER_ASSET_ID];
    if (!characterUrl) return PROBE_ASSET_URLS;
    const frame = requestedTimeMs >= 500 ? 'b' : 'a';
    return {
      ...PROBE_ASSET_URLS,
      [PROBE_CHARACTER_ASSET_ID]: `${characterUrl}?issue573-frame=${frame}`,
    };
  }, [formalAssetUrls, formalRequest, issue573ExactFrameProbe, requestedTimeMs]);
  const evaluatedBaseShot = useMemo(
    () => evaluateShotAtTime(shot, shotLocalTimeMs, project),
    [shotLocalTimeMs, shot, project],
  );
  const subtitleCues = useMemo(
    () => formalRequest ? buildDialogueSubtitleCues(shot.dialogues) : PROBE_SUBTITLE_CUES,
    [formalRequest, shot.dialogues],
  );
  const subtitle = evaluateSubtitleAtTime(subtitleCues, evaluatedBaseShot.timeMs);
  const evaluatedShot = useMemo(
    () => formalRequest
      ? projectProductPreviewMouth(
          project,
          shot,
          evaluatedBaseShot,
          subtitle?.id ?? null,
        )
      : evaluatedBaseShot,
    [evaluatedBaseShot, formalRequest, project, shot, subtitle?.id],
  );
  const cameraPlan = useMemo(
    () =>
      formalRequest?.cameraMode === 'speaker-focus'
        ? prepareSpeakerFocusCamera(project, shot)
        : null,
    [formalRequest?.cameraMode, project, shot],
  );
  const camera = cameraPlan
    ? evaluateSpeakerFocusCamera(cameraPlan, evaluatedShot.timeMs)
    : undefined;
  const captionStyle = formalRequest
    ? resolveProductPreviewSubtitleStyle(project, subtitle)
    : undefined;

  const acknowledgeLoad = useCallback((request: ExportLoadProbeRequest) => {
    window.pandaStageHidden.probeLoaded({
      jobId: request.jobId,
      acknowledged: true,
    });
  }, []);

  const acknowledgeFormalLoad = useCallback((request: ExportLoadFormalRequest) => {
    window.pandaStageHidden.formalLoaded({
      jobId: request.jobId,
      acknowledged: true,
    });
  }, []);

  const failFrame = useCallback(
    (request: ExportRenderFrameRequest, error: unknown) => {
      activeFrameRef.current = null;
      activeFrameStartedAtRef.current = null;
      captureInFlightRef.current = false;
      window.pandaStageHidden.frameFailed({
        jobId: request.jobId,
        frameIndex: request.frameIndex,
        timeMs: request.timeMs,
        ...(request.shotId === undefined
          ? {}
          : {
              shotId: request.shotId,
              shotLocalTimeMs: request.shotLocalTimeMs,
            }),
        error: error instanceof Error ? error.message : '隐藏帧渲染失败。',
      });
    },
    [],
  );

  useEffect(() => {
    const removeLoadListener = window.pandaStageHidden.onLoadProbe((request) => {
      workerPngEncoderRef.current?.close('PNG encoder released for probe export.');
      workerPngEncoderRef.current = null;
      cancelledJobIdsRef.current.delete(request.jobId);
      loadedJobIdRef.current = request.jobId;
      loadedFormalProjectRef.current = null;
      pendingFormalLoadRef.current = null;
      setFormalRequest(null);
      setProbeDurationMs(request.durationMs);
      if (stageReadyRef.current) {
        acknowledgeLoad(request);
      } else {
        pendingLoadRef.current = request;
      }
    });
    const removeFormalLoadListener = window.pandaStageHidden.onLoadFormal(
      (request) => {
        workerPngEncoderRef.current?.close('PNG encoder replaced for formal export.');
        workerPngEncoderRef.current =
          exportPngMode === 'worker-png'
            ? new WorkerPngEncoder({ jobId: request.jobId })
            : null;
        console.info(
          'PANDA_STAGE_O2_JOB_MODE ' +
            JSON.stringify({
              jobId: request.jobId,
              drawMode: exportStageDrawMode,
              pngMode: exportPngMode,
            }),
        );
        cancelledJobIdsRef.current.delete(request.jobId);
        loadedJobIdRef.current = request.jobId;
        loadedFormalProjectRef.current = request.project;
        pendingLoadRef.current = null;
        pendingFormalLoadRef.current = request;
        stageReadyRef.current = false;
        setFrameRequest(null);
        setFormalRequest(request);
      },
    );
    const removeFrameListener = window.pandaStageHidden.onRenderFrame(
      (request) => {
        if (cancelledJobIdsRef.current.has(request.jobId)) {
          return;
        }
        if (loadedJobIdRef.current !== request.jobId) {
          failFrame(
            request,
            new Error(`隐藏窗口尚未加载 Job ${request.jobId}。`),
          );
          return;
        }
        const formalProject = loadedFormalProjectRef.current;
        if (formalProject) {
          const position = mapProjectTime(formalProject, request.timeMs);
          if (
            !position.shot ||
            request.shotId !== position.shot.id ||
            request.shotLocalTimeMs !== position.shotLocalTimeMs
          ) {
            failFrame(
              request,
              new Error('Formal export frame did not match the Project Shot map.'),
            );
            return;
          }
        } else if (
          request.shotId !== undefined ||
          request.shotLocalTimeMs !== undefined
        ) {
          failFrame(request, new Error('Probe frame included formal Shot identity.'));
          return;
        }
        if (activeFrameRef.current || captureInFlightRef.current) {
          window.pandaStageHidden.frameFailed({
            jobId: request.jobId,
            frameIndex: request.frameIndex,
            timeMs: request.timeMs,
            ...(request.shotId === undefined
              ? {}
              : {
                  shotId: request.shotId,
                  shotLocalTimeMs: request.shotLocalTimeMs,
                }),
            error: '隐藏窗口仍在处理上一帧。',
          });
          return;
        }
        activeFrameRef.current = request;
        activeFrameStartedAtRef.current = performance.now();
        stageReadyRef.current = false;
        setFrameRequest(request);
      },
    );
    const removeCancelListener = window.pandaStageHidden.onCancelExport(
      ({ jobId }) => {
        cancelledJobIdsRef.current.add(jobId);
        const cancellingLoadedJob = loadedJobIdRef.current === jobId;
        if (cancellingLoadedJob) {
          workerPngEncoderRef.current?.close(
            `Export Job ${jobId}: PNG encoding cancelled.`,
          );
          workerPngEncoderRef.current = null;
          loadedFormalProjectRef.current = null;
          setFormalRequest(null);
        }
        if (loadedJobIdRef.current === jobId) {
          loadedJobIdRef.current = null;
        }
        if (pendingLoadRef.current?.jobId === jobId) {
          pendingLoadRef.current = null;
        }
        if (pendingFormalLoadRef.current?.jobId === jobId) {
          pendingFormalLoadRef.current = null;
        }
        if (activeFrameRef.current?.jobId === jobId) {
          activeFrameRef.current = null;
          activeFrameStartedAtRef.current = null;
          captureInFlightRef.current = false;
          setFrameRequest(null);
        }
      },
    );
    const closeEncoderOnPageHide = () => {
      workerPngEncoderRef.current?.close('Hidden export page is closing.');
      workerPngEncoderRef.current = null;
    };
    window.addEventListener('pagehide', closeEncoderOnPageHide, { once: true });

    return () => {
      window.removeEventListener('pagehide', closeEncoderOnPageHide);
      workerPngEncoderRef.current?.close('Hidden export renderer unmounted.');
      workerPngEncoderRef.current = null;
      removeLoadListener();
      removeFormalLoadListener();
      removeFrameListener();
      removeCancelListener();
    };
  }, [acknowledgeFormalLoad, acknowledgeLoad, failFrame]);

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

  const handleStageReady = useCallback((stageInstance: Konva.Stage) => {
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
    const pendingFormalLoad = pendingFormalLoadRef.current;
    if (pendingFormalLoad) {
      pendingFormalLoadRef.current = null;
      acknowledgeFormalLoad(pendingFormalLoad);
    }

    const activeFrame = activeFrameRef.current;
    if (!activeFrame || captureInFlightRef.current) {
      return;
    }
    captureInFlightRef.current = true;

    const stage = document.querySelector<HTMLElement>(
      '[data-testid="stage-renderer"]',
    );
    if (!stage) {
      failFrame(activeFrame, new Error('Hidden stage element not found.'));
      return;
    }
    const readiness = readExportStageReadiness(stage);
    const exactFrameReady = isExactExportFrameReady(readiness, activeFrame);
    const layerCount = stageInstance.getLayers().length;
    const exactFrameDrawn =
      exportStageDrawMode !== 'explicit-sync' ||
      (isExactExportFrameDrawn(readiness, activeFrame) &&
        Number(stage.dataset.stageDrawnLayerCount) === layerCount);
    if (!exactFrameReady || !exactFrameDrawn) {
      captureInFlightRef.current = false;
      return;
    }
    if (layerCount === 0) {
      failFrame(activeFrame, new Error('Hidden export Stage has no output layers.'));
      return;
    }
    // Capture the already drawn output canvas, compositing all layers when needed.
    const stageCaptureStartedAt = performance.now();
    const stageCapture = captureExportStageCanvas(stageInstance);
    const canvas = stageCapture.canvas;
    const stageCaptureMs = performance.now() - stageCaptureStartedAt;
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

    const pngEncodingStartedAt = performance.now();
    const activePngMode = formalRequest ? exportPngMode : 'legacy-blob';
    const pngEncoder =
      activePngMode === 'worker-png' ? workerPngEncoderRef.current : null;
    if (activePngMode === 'worker-png' && !pngEncoder) {
      failFrame(activeFrame, new Error('PNG Worker encoder was not initialized for this formal Job.'));
      return;
    }
    const encoding = pngEncoder
      ? pngEncoder.encode(canvas, activeFrame).then((result) => ({
          pngBytes: result.pngBytes,
          timing: result.timing,
        }))
      : canvasToPngBytes(canvas).then((pngBytes) => ({
          pngBytes,
          timing: null,
        }));
    void encoding
      .then(({ pngBytes, timing }) => {
        if (
          cancelledJobIdsRef.current.has(activeFrame.jobId) ||
          activeFrameRef.current !== activeFrame
        ) {
          return;
        }
        if (exportFrameTimingEnabled) {
          const stageDuration = (key: string): number | null => {
            const value = Number(stage.dataset[key]);
            return Number.isFinite(value) ? value : null;
          };
          console.info(
            'PANDA_STAGE_O1_FRAME ' +
              JSON.stringify({
                jobId: activeFrame.jobId,
                frameIndex: activeFrame.frameIndex,
                timeMs: activeFrame.timeMs,
                shotId: activeFrame.shotId ?? null,
                shotLocalTimeMs: activeFrame.shotLocalTimeMs ?? null,
                drawMode: exportStageDrawMode,
                readyGateMs: stageDuration('stageReadyWaitMs'),
                fontWaitMs: stageDuration('stageFontWaitMs'),
                synchronousDrawMs: stageDuration('stageDrawDurationMs'),
                stageCaptureMs,
                captureStrategy: stageCapture.strategy,
                pngMode: activePngMode,
                pngEncodeMs: timing?.workerEncodeMs ?? performance.now() - pngEncodingStartedAt,
                pngSnapshotMs: timing?.snapshotMs ?? null,
                pngTransferDispatchMs: timing?.transferDispatchMs ?? null,
                workerDrawMs: timing?.workerDrawMs ?? null,
                workerConvertToBlobMs: timing?.convertToBlobMs ?? null,
                workerArrayBufferMs: timing?.arrayBufferMs ?? null,
                workerEncodeMs: timing?.workerEncodeMs ?? null,
                workerReturnMs: timing?.workerReturnMs ?? null,
                workerRoundTripMs: timing?.workerRoundTripMs ?? null,
                requestToPngMs:
                  activeFrameStartedAtRef.current === null
                    ? null
                    : performance.now() - activeFrameStartedAtRef.current,
              }),
          );
        }
        window.pandaStageHidden.frameReady({
          jobId: activeFrame.jobId,
          frameIndex: activeFrame.frameIndex,
          timeMs: activeFrame.timeMs,
          ...(activeFrame.shotId === undefined
            ? {}
            : {
                shotId: activeFrame.shotId,
                shotLocalTimeMs: activeFrame.shotLocalTimeMs,
              }),
          width: 1_920,
          height: 1_080,
          pngBytes,
        });
        activeFrameRef.current = null;
        activeFrameStartedAtRef.current = null;
        captureInFlightRef.current = false;
      })
      .catch((error: unknown) => {
        if (activeFrameRef.current === activeFrame) failFrame(activeFrame, error);
      });
  }, [acknowledgeFormalLoad, acknowledgeLoad, failFrame, formalRequest]);

  return (
    <main className="hidden-stage-shell">
      <CanvasStage
        assetUrls={exportAssetUrls}
        caption={subtitle?.text ?? null}
        evaluatedShot={evaluatedShot}
        camera={camera}
        captionStyle={captionStyle}
        showStageLabel={false}
        drawMode={exportStageDrawMode}
        onError={handleStageError}
        onReady={handleStageReady}
        project={project}
        renderToken={
          frameRequest
            ? `${frameRequest.jobId}:${frameRequest.frameIndex}`
            : 'initial'
        }
      />
    </main>
  );
}
