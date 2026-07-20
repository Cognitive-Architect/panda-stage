import { useState } from 'react';
import { StagePreview } from './stage/StagePreview';

export function App(): React.JSX.Element {
  const [pingStatus, setPingStatus] = useState<
    'idle' | 'pending' | 'pong' | 'error'
  >('idle');

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
      <StagePreview />
    </main>
  );
}
