import { useEffect, useState } from 'react';
import type { DesktopAutomationStatus } from '../../shared/desktop-automation-api';
import { Button } from '../ui/Button';

const quotePowerShell = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export function DesktopAutomationCard(): React.JSX.Element {
  const [status, setStatus] = useState<DesktopAutomationStatus>();
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const bridge = window.pandaStage?.desktopAutomation;
    void bridge?.status().then(result => { if (alive) setStatus(result); }, () => { if (alive) setStatus(null); });
    if (!bridge) setStatus(null);
    return () => { alive = false; };
  }, []);

  const command = status ? `node ${quotePowerShell(status.cliFile)} --session-file ${quotePowerShell(status.sessionFile)} state` : '';
  return <section className="project-tools-action-preset-card" data-testid="desktop-automation-card">
    <div className="project-tools-action-preset-heading"><h3>桌面自动化</h3></div>
    {status ? <>
      <span role="status">本机已连接</span>
      <label className="animation-curve-fields">读取当前工程<input readOnly value={command} /></label>
      <Button onClick={() => {
        void navigator.clipboard.writeText(command).then(() => setError(''), () => setError('复制失败，请手动选中命令。'));
      }}>复制命令</Button>
    </> : status === null ? <p role="status">本机连接不可用</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
