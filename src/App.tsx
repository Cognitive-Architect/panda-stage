import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CanvasStage } from '@/features/canvas/CanvasStage';
import type { Project, ExportConfig, ExportProgress } from '@shared/types';
import { CANVAS_WIDTH, CANVAS_HEIGHT, FPS } from '@shared/constants';

/**
 * Create a minimal default project for M0.5 testing.
 */
function createDefaultProject(): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: 'M0.5 Test Project',
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fps: FPS,
    assets: [],
    characters: [],
    voiceProfiles: [],
    subtitleStyles: [
      {
        id: crypto.randomUUID(),
        name: 'Default',
        fontSize: 48,
        fontFamily: 'Noto Sans SC',
        color: '#FFFFFF',
        outlineColor: '#000000',
        outlineWidth: 2,
        shadowBlur: 4,
        maxLines: 2,
      },
    ],
    shots: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Main App component for M0.5.
 *
 * Simple UI for testing:
 * - Import assets
 * - Preview playback
 * - Export video
 * - Progress bar during export
 */
export default function App(): React.ReactElement {
  const [project, setProject] = useState<Project>(() => createDefaultProject());
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(
    null
  );
  const playRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const totalDuration = useMemo(
    () => project.shots.reduce((sum, s) => sum + s.durationMs, 0),
    [project]
  );

  // Playback loop using requestAnimationFrame
  useEffect(() => {
    if (isPlaying) {
      startTimeRef.current = performance.now() - currentTimeMs;
      const tick = () => {
        const elapsed = performance.now() - startTimeRef.current;
        if (elapsed >= totalDuration) {
          setIsPlaying(false);
          setCurrentTimeMs(totalDuration);
          return;
        }
        setCurrentTimeMs(elapsed);
        playRef.current = requestAnimationFrame(tick);
      };
      playRef.current = requestAnimationFrame(tick);
    } else {
      if (playRef.current !== null) {
        cancelAnimationFrame(playRef.current);
        playRef.current = null;
      }
    }
    return () => {
      if (playRef.current !== null) {
        cancelAnimationFrame(playRef.current);
      }
    };
  }, [isPlaying, totalDuration]);

  // Listen to export progress from main process
  useEffect(() => {
    const unsubscribe = window.electronAPI.export.onProgress((progress) => {
      setExportProgress(progress);
      if (
        progress.stage === 'complete' ||
        progress.stage === 'error' ||
        progress.stage === 'cancelled'
      ) {
        setTimeout(() => setExportProgress(null), 3000);
      }
    });
    return unsubscribe;
  }, []);

  const handleImport = useCallback(async () => {
    try {
      const result = await window.electronAPI.asset.import();
      if (result) {
        const { asset } = result;
        setProject((prev) => ({
          ...prev,
          assets: [...prev.assets, asset],
          updatedAt: new Date().toISOString(),
        }));
      }
    } catch {
      // Silently ignore import errors in M0.5 test UI
    }
  }, []);

  const handlePreview = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (currentTimeMs >= totalDuration) {
        setCurrentTimeMs(0);
      }
      setIsPlaying(true);
    }
  }, [isPlaying, currentTimeMs, totalDuration]);

  const handleExport = useCallback(async () => {
    if (totalDuration === 0) {
      alert('Project has no shots to export');
      return;
    }
    const config: ExportConfig = {
      project,
      outputPath: '',
      tempDir: '',
      fps: FPS,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    };
    try {
      await window.electronAPI.export.start(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      alert(message);
    }
  }, [project, totalDuration]);

  const handleCancelExport = useCallback(async () => {
    try {
      await window.electronAPI.export.cancel();
    } catch {
      // Silently ignore
    }
  }, []);

  const progressPercent =
    exportProgress && exportProgress.totalFrames > 0
      ? ((exportProgress.frameIndex ?? 0) / exportProgress.totalFrames) * 100
      : 0;

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Panda Stage M0.5</h1>
        <div className="toolbar">
          <button className="btn" onClick={handleImport}>
            导入素材
          </button>
          <button className="btn" onClick={handlePreview}>
            {isPlaying ? '暂停' : '预览'}
          </button>
          <button className="btn btn-primary" onClick={handleExport}>
            导出
          </button>
          {exportProgress?.stage === 'rendering' && (
            <button className="btn btn-danger" onClick={handleCancelExport}>
              取消
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        <CanvasStage project={project} currentTimeMs={currentTimeMs} />
      </main>

      {exportProgress && (
        <div className="progress-bar-container">
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="progress-text">
            {exportProgress.message} (
            {exportProgress.frameIndex ?? 0} / {exportProgress.totalFrames})
          </span>
        </div>
      )}
    </div>
  );
}

