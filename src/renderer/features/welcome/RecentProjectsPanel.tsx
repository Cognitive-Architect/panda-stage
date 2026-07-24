import { useEffect, useState } from 'react';
import type { RecentProjectEntry } from '../../../shared/recent-projects-api';

export interface RecentProjectsPanelProps {
  refreshToken: number;
  onOpenProject: (projectRoot: string) => Promise<void>;
}

export function RecentProjectsPanel({
  refreshToken,
  onOpenProject,
}: RecentProjectsPanelProps): React.JSX.Element {
  const [entries, setEntries] = useState<RecentProjectEntry[]>([]);
  const [busyRoot, setBusyRoot] = useState<string | null>(null);
  const [status, setStatus] = useState('正在读取最近项目…');

  useEffect(() => {
    let active = true;
    void window.pandaStage.recentProjects.list().then((response) => {
      if (!active) return;
      if (response.ok) {
        setEntries(response.entries);
        setStatus(
          response.entries.length === 0
            ? '还没有最近项目。'
            : '最近项目保存在应用配置中。',
        );
      } else {
        setStatus(response.error.message);
      }
    });
    return () => {
      active = false;
    };
  }, [refreshToken]);

  const openProject = async (entry: RecentProjectEntry): Promise<void> => {
    setBusyRoot(entry.projectRoot);
    try {
      await onOpenProject(entry.projectRoot);
      setStatus(`已打开“${entry.projectName}”。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '打开项目失败。');
    } finally {
      setBusyRoot(null);
    }
  };

  const removeProject = async (
    entry: RecentProjectEntry,
  ): Promise<void> => {
    setBusyRoot(entry.projectRoot);
    try {
      const response = await window.pandaStage.recentProjects.remove({
        projectRoot: entry.projectRoot,
      });
      if (!response.ok) throw new Error(response.error.message);
      setEntries(response.entries);
      setStatus(`已从最近项目中移除“${entry.projectName}”。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '移除记录失败。');
    } finally {
      setBusyRoot(null);
    }
  };

  const relocateProject = async (
    entry: RecentProjectEntry,
  ): Promise<void> => {
    setBusyRoot(entry.projectRoot);
    try {
      const response = await window.pandaStage.recentProjects.relocate({
        projectRoot: entry.projectRoot,
      });
      if (!response.ok) throw new Error(response.error.message);
      if (response.status === 'cancelled') {
        setStatus('已取消重新定位，原记录仍保留。');
        return;
      }
      setEntries(response.entries);
      await onOpenProject(response.document.projectRoot);
      setStatus(`已重新定位并打开“${entry.projectName}”。`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '重新定位项目失败。',
      );
    } finally {
      setBusyRoot(null);
    }
  };

  return (
    <section
      className="recent-projects-panel"
      aria-labelledby="recent-projects-heading"
    >
      <div className="recent-projects-heading">
        <div>
          <p className="eyebrow">Day 14 workspace</p>
          <h2 id="recent-projects-heading">最近项目</h2>
        </div>
        <span>{entries.length}/12</span>
      </div>
      {entries.length === 0 ? (
        <p className="recent-projects-empty">新建或打开项目后会显示在这里。</p>
      ) : (
        <ul className="recent-projects-list">
          {entries.map((entry) => (
            <li key={`${entry.projectId}:${entry.projectRoot}`}>
              <div>
                <strong>{entry.projectName}</strong>
                <span className="recent-project-path">{entry.projectRoot}</span>
                <span>
                  {entry.status === 'available' ? '可用' : '路径已失效'}
                  {' · '}
                  {new Date(entry.lastOpenedAt).toLocaleString()}
                </span>
              </div>
              <div className="recent-project-actions">
                <button
                  disabled={
                    busyRoot !== null || entry.status === 'missing'
                  }
                  onClick={() => void openProject(entry)}
                  type="button"
                >
                  打开
                </button>
                {entry.status === 'missing' ? (
                  <button
                    disabled={busyRoot !== null}
                    onClick={() => void relocateProject(entry)}
                    type="button"
                  >
                    重新定位
                  </button>
                ) : null}
                <button
                  disabled={busyRoot !== null}
                  onClick={() => void removeProject(entry)}
                  type="button"
                >
                  移除记录
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <output className="recent-projects-status">{status}</output>
    </section>
  );
}
