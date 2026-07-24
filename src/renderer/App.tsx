import { useEffect, useState } from 'react';
import type { ExportJobUpdate } from '../shared/export-types';
import { StagePreview } from './stage/StagePreview';
import { ProjectRecoveryPanel } from './features/recovery/ProjectRecoveryPanel';

const GATE_PREVIEW_EVENT = 'panda-stage:gate-preview-time';

interface GatePreviewRequest {
  timeMs: number;
  token: string;
}

export function App(): React.JSX.Element {
  const [pingStatus, setPingStatus] = useState<
    'idle' | 'pending' | 'pong' | 'error'
  >('idle');
  const [projectDirectory, setProjectDirectory] = useState('');
  const [audioPath, setAudioPath] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [exportJob, setExportJob] = useState<ExportJobUpdate | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [gatePreviewRequest, setGatePreviewRequest] =
    useState<GatePreviewRequest | null>(null);

  useEffect(() => window.pandaStage.export.onUpdate(setExportJob), []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('gateA') !== '1') {
      return;
    }
    const receiveGatePreviewRequest = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      const timeMs =
        typeof detail === 'object' && detail !== null && 'timeMs' in detail
          ? detail.timeMs
          : null;
      const token =
        typeof detail === 'object' && detail !== null && 'token' in detail
          ? detail.token
          : null;
      if (
        !Number.isInteger(timeMs) ||
        typeof timeMs !== 'number' ||
        typeof token !== 'string' ||
        timeMs < 0 ||
        timeMs >= 3_000
      ) {
        throw new Error('Invalid Gate A preview-frame request.');
      }
      setGatePreviewRequest({
        timeMs,
        token,
      });
    };
    window.addEventListener(GATE_PREVIEW_EVENT, receiveGatePreviewRequest);
    return () =>
      window.removeEventListener(GATE_PREVIEW_EVENT, receiveGatePreviewRequest);
  }, []);

  const pingMainProcess = async (): Promise<void> => {
    setPingStatus('pending');
    try {
      const response = await window.pandaStage.app.ping();
      setPingStatus(response.message);
    } catch (error) {
      console.error('Main process ping failed.', error);
      setPingStatus('error');
    }
  };

  const startExport = async (): Promise<void> => {
    setExportError(null);
    try {
      const response = await window.pandaStage.export.startProbe({
        projectDirectory,
        audioPath,
        outputPath,
        durationMs: 3_000,
        fps: 24,
        audioStartMs: 400,
        overwrite: true,
      });
      setExportJob({
        jobId: response.jobId,
        status: response.status,
        phase: 'preparing',
        completedFrames: 0,
        totalFrames: 72,
        error: null,
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '无法开始导出。');
    }
  };

  const cancelExport = async (): Promise<void> => {
    if (!exportJob) return;
    try {
      await window.pandaStage.export.cancel(exportJob.jobId);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '无法取消导出。');
    }
  };

  const exportBusy =
    exportJob?.status === 'running' || exportJob?.status === 'cancelling';
  const exportCommitLocked = exportJob?.phase === 'committing';

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">熊</span>
          <div>
            <strong>Panda Stage</strong>
            <span>共享渲染架构探针</span>
          </div>
        </div>
        <div className="ipc-check">
          <button
            className="ping-button"
            data-testid="ping-button"
            disabled={pingStatus === 'pending'}
            onClick={() => void pingMainProcess()}
            type="button"
          >
            {pingStatus === 'pending' ? '通信中…' : '测试安全 IPC'}
          </button>
          <output className="ping-result" data-testid="ping-result">
            {pingStatus === 'idle' && '等待测试'}
            {pingStatus === 'pending' && '等待 Main Process 响应'}
            {pingStatus === 'pong' && 'pong'}
            {pingStatus === 'error' && '通信失败'}
          </output>
        </div>
      </header>
      <section className="export-probe" aria-label="完整导出探针">
        <h2>完整导出探针</h2>
        <label>
          项目目录
          <input
            onChange={(event) => setProjectDirectory(event.target.value)}
            placeholder="支持中文、空格与 Unicode 路径"
            value={projectDirectory}
          />
        </label>
        <label>
          WAV 音频路径
          <input
            onChange={(event) => setAudioPath(event.target.value)}
            value={audioPath}
          />
        </label>
        <label>
          MP4 输出路径
          <input
            onChange={(event) => setOutputPath(event.target.value)}
            value={outputPath}
          />
        </label>
        <div>
          <button
            disabled={exportBusy || !projectDirectory || !audioPath || !outputPath}
            onClick={() => void startExport()}
            type="button"
          >
            开始导出
          </button>
          <button
            disabled={!exportBusy || exportCommitLocked}
            onClick={() => void cancelExport()}
            type="button"
          >
            {exportCommitLocked
              ? '正在提交…'
              : exportJob?.status === 'cancelling'
                ? '正在取消…'
                : '取消导出'}
          </button>
        </div>
        <output data-testid="export-status">
          {exportJob
            ? `Job ${exportJob.jobId} · ${exportJob.status} · ${exportJob.phase} · ${exportJob.completedFrames}/${exportJob.totalFrames}`
            : '尚未开始导出'}
          {exportJob?.error ? ` · ${exportJob.error}` : ''}
          {exportError ? ` · ${exportError}` : ''}
        </output>
      </section>
      <ProjectRecoveryPanel />
      <StagePreview gatePreviewRequest={gatePreviewRequest} />
    </main>
  );
}
