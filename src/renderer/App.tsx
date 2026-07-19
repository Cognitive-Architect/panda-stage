import { useState } from 'react';
import { BOOTSTRAP_MESSAGE } from '../shared/bootstrap';

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
    <main className="bootstrap-shell">
      <section className="bootstrap-card" aria-labelledby="app-title">
        <div className="panda-mark" aria-hidden="true">
          <span className="panda-ear panda-ear-left" />
          <span className="panda-ear panda-ear-right" />
          <span className="panda-face">熊</span>
        </div>
        <p className="eyebrow">Desktop animation workspace</p>
        <h1 id="app-title">{BOOTSTRAP_MESSAGE}</h1>
        <p className="status-copy">
          Electron、React 与 TypeScript 工程基线已就绪。
        </p>
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
        <span className="status-badge">Day 03</span>
      </section>
    </main>
  );
}
