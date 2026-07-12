import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Stage, Layer } from 'react-konva';
import type Konva from 'konva';
import type {
  Project,
  RenderFrameRequest,
  RenderFrameResult,
} from '@shared/types';
import type { ShotFrame } from '@/domain/evaluators/timelineEvaluator';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '@shared/constants';
import { evaluateProjectAtTime } from '@/domain/evaluators/timelineEvaluator';
import { StageRenderer } from '@/domain/renderers/StageRenderer';

/**
 * Export Window Entry
 *
 * Receives project data once via export:start IPC.
 * Receives per-frame render:frame requests with only frameIndex + timeMs.
 * Supports two capture methods:
 *   A) notify frame-ready, let main process call capturePage()
 *   B) canvas.toBlob() → send binary back via IPC
 */

function ExportApp(): React.ReactElement {
  const [shotFrame, setShotFrame] = useState<ShotFrame | null>(null);
  const [assetMap, setAssetMap] = useState<Map<string, HTMLImageElement>>(
    new Map()
  );
  const [isReady, setIsReady] = useState(false);
  const stageRef = useRef<Konva.Stage | null>(null);
  const currentFrameRef = useRef<RenderFrameRequest | null>(null);
  const readySentRef = useRef(false);
  const projectRef = useRef<Project | null>(null);

  /**
   * Pre-load all image assets for the export window.
   * Uses crossOrigin to ensure canvas.toBlob() works without tainting.
   */
  const preloadAssets = useCallback(
    async (proj: Project): Promise<Map<string, HTMLImageElement>> => {
      const map = new Map<string, HTMLImageElement>();
      const imageAssets = proj.assets.filter((a) => a.type === 'image');
      await Promise.all(
        imageAssets.map(
          (asset) =>
            new Promise<void>((resolve, reject) => {
              const img = new window.Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => {
                map.set(asset.id, img);
                resolve();
              };
              img.onerror = () =>
                reject(new Error(`Failed to load asset: ${asset.name}`));
              const url = window.exportAPI.resolveAssetUrl(asset.relativePath);
              img.src = url;
            })
        )
      );
      return map;
    },
    []
  );

  /**
   * IPC listeners — registered once on mount.
   */
  useEffect(() => {
    window.exportAPI.onExportStart(async (proj) => {
      try {
        readySentRef.current = false;

        // 5. 等待 document.fonts.ready
        await document.fonts.ready;

        // 预加载所有图片
        const map = await preloadAssets(proj);

        // 保存项目数据
        projectRef.current = proj;
        setAssetMap(map);

        // 完成首次 Stage 绘制（timeMs = 0）
        const initialFrame = evaluateProjectAtTime(proj, 0);
        setShotFrame(initialFrame.shotFrame);
        setIsReady(true);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Export initialization failed';
        window.exportAPI.sendRenderError(message);
      }
    });

    window.exportAPI.onRenderFrame((req) => {
      const proj = projectRef.current;
      if (!proj) {
        window.exportAPI.sendRenderError('Project not loaded');
        return;
      }
      currentFrameRef.current = req;
      const frame = evaluateProjectAtTime(proj, req.timeMs);
      setShotFrame(frame.shotFrame);
    });

    window.exportAPI.onRenderCancel(() => {
      setShotFrame(null);
      currentFrameRef.current = null;
    });
  }, [preloadAssets]);

  /**
   * 方式 B: 通过 canvas.toBlob() 获取 PNG ArrayBuffer，发送回主进程
   */
  const captureFrameB = useCallback((req: RenderFrameRequest) => {
    // 立即清除，防止 onDraw 重复触发导致重复捕获
    currentFrameRef.current = null;

    const stage = stageRef.current;
    if (!stage) {
      window.exportAPI.sendRenderError('Stage not ready');
      return;
    }

    const container = stage.container();
    const canvas = container.querySelector(
      'canvas'
    ) as HTMLCanvasElement | null;
    if (!canvas) {
      window.exportAPI.sendRenderError('Canvas element not found');
      return;
    }

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          window.exportAPI.sendRenderError('Canvas toBlob failed');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const arrayBuffer = reader.result as ArrayBuffer;
          const buffer = new Uint8Array(arrayBuffer);
          const result: RenderFrameResult = {
            frameIndex: req.frameIndex,
            buffer,
            method: 'canvas',
          };
          window.exportAPI.sendRenderFrameDone(result);
        };
        reader.onerror = () => {
          window.exportAPI.sendRenderError('FileReader failed');
        };
        reader.readAsArrayBuffer(blob);
      },
      'image/png'
    );
  }, []);

  /**
   * 方式 A: 通知 frame-ready，等待主进程 capturePage()
   */
  const sendFrameReady = useCallback((frameIndex: number) => {
    window.exportAPI.sendFrameReady(frameIndex);
  }, []);

  /**
   * Konva Stage onDraw 回调。
   * 首次绘制完成后发送 render:ready。
   * 后续每次帧绘制完成后执行捕获（方式 B 直接捕获，方式 A 发送 frame-ready）。
   */
  const handleDraw = useCallback(() => {
    // 首次 ready
    if (isReady && !readySentRef.current) {
      readySentRef.current = true;
      window.exportAPI.sendRenderReady();
      return;
    }

    // 后续帧捕获
    const req = currentFrameRef.current;
    if (!req) return;

    // 方式 B: 直接通过 canvas 捕获
    captureFrameB(req);

    // 方式 A: 通知主进程 frame-ready
    // sendFrameReady(req.frameIndex);
    // 两种方式同时实现，通过测试最终选定一种。
    // 当前默认使用方式 B（直接捕获），方式 A 的代码保留用于对比测试。
  }, [isReady, captureFrameB, sendFrameReady]);

  return (
    <div
      style={{
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        overflow: 'hidden',
        backgroundColor: '#000000',
      }}
    >
      <Stage
        ref={stageRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onDraw={handleDraw}
      >
        <Layer>
          <StageRenderer
            shotFrame={shotFrame}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            assetMap={assetMap}
          />
        </Layer>
      </Stage>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found in export window');
}

const root = createRoot(container);
root.render(<ExportApp />);
