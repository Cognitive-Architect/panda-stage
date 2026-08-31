import { MoreHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RecentProjectEntry } from '../../../shared/recent-projects-api';
import { DecorativeIcon } from '../../ui';

export type RecentProjectsPanelPresentation = 'default' | 'compact';

export interface RecentProjectsPanelProps {
  refreshToken: number;
  presentation?: RecentProjectsPanelPresentation;
  onOpenProject: (
    projectRoot: string,
    expectedProjectId: string,
  ) => Promise<void>;
}

export function RecentProjectsPanel({
  refreshToken,
  presentation = 'default',
  onOpenProject,
}: RecentProjectsPanelProps): React.JSX.Element {
  const [entries, setEntries] = useState<RecentProjectEntry[]>([]);
  const [busyRoot, setBusyRoot] = useState<string | null>(null);
  const [openMenuRoot, setOpenMenuRoot] = useState<string | null>(null);
  const [status, setStatus] = useState('正在读取最近项目…');

  useEffect(() => {
    let active = true;
    void window.pandaStage.recentProjects.list().then((response) => {
      if (!active) return;
      if (response.ok) {
        setEntries(response.entries);
        setOpenMenuRoot(null);
        setStatus(
          response.entries.length === 0
            ? '还没有最近项目。'
            : '最近项目已准备就绪。',
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
    setOpenMenuRoot(null);
    try {
      await onOpenProject(entry.projectRoot, entry.projectId);
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
      setOpenMenuRoot(null);
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
    setOpenMenuRoot(null);
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
      await onOpenProject(
        response.document.projectRoot,
        response.document.project.id,
      );
      setStatus(`已重新定位并打开“${entry.projectName}”。`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '重新定位项目失败。',
      );
    } finally {
      setBusyRoot(null);
    }
  };

  const compact = presentation === 'compact';

  return (
    <section
      className={`recent-projects-panel${
        compact ? ' recent-projects-panel-compact' : ''
      }`}
      aria-labelledby="recent-projects-heading"
      data-presentation={presentation}
      data-testid="recent-projects-panel"
    >
      <div className="recent-projects-heading">
        <div>
          <p className="eyebrow">项目入口</p>
          <h2 id="recent-projects-heading">最近项目</h2>
        </div>
        {!compact ? <span>{entries.length}/12</span> : null}
      </div>
      {!compact ? (
        <p className="recent-projects-safety-note">
          移除记录只会清理最近项目列表，不会删除磁盘项目。
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p className="recent-projects-empty">新建或打开项目后会显示在这里。</p>
      ) : (
        <ul
          className="recent-projects-list"
          data-testid="recent-projects-list"
        >
          {entries.map((entry) => (
            <li
              className="recent-project-card"
              data-project-status={entry.status}
              key={`${entry.projectId}:${entry.projectRoot}`}
            >
              <div>
                <strong>{entry.projectName}</strong>
                {compact ? (
                  <span
                    className="recent-project-meta"
                    data-testid="recent-project-status"
                  >
                    {entry.status === 'available'
                      ? '● 可用'
                      : entry.status === 'missing'
                        ? '⚠ 找不到项目'
                        : entry.status === 'mismatched'
                          ? '⚠ 项目身份不匹配'
                          : '⚠ 项目文件无效'}
                    {' · '}
                    {new Date(entry.lastOpenedAt).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                ) : (
                  <>
                    <span
                      className="recent-projects-path recent-project-path"
                      data-testid="recent-projects-path"
                      title={entry.projectRoot}
                    >
                      {entry.projectRoot}
                    </span>
                    <span className="recent-project-meta">
                      {entry.status === 'available'
                        ? '可用'
                        : entry.status === 'missing'
                          ? '路径已失效'
                          : entry.status === 'mismatched'
                            ? '项目身份不匹配'
                            : '项目文件无效'}
                      {' · '}
                      {new Date(entry.lastOpenedAt).toLocaleString()}
                    </span>
                  </>
                )}
              </div>
              <div
                className="recent-projects-actions recent-project-actions"
                data-testid="recent-projects-actions"
              >
                {!compact || entry.status === 'available' ? (
                  <button
                    className={`task4-hit-target${
                      entry.status === 'available'
                        ? ' recent-project-action-primary'
                        : ''
                    }`}
                    data-task4-core="recent-open"
                    disabled={
                      busyRoot !== null || entry.status !== 'available'
                    }
                    onClick={() => void openProject(entry)}
                    type="button"
                  >
                    打开
                  </button>
                ) : null}
                {entry.status !== 'available' ? (
                  <button
                    className={`task4-hit-target${
                      compact ? ' recent-project-action-primary' : ''
                    }`}
                    data-task4-core="recent-relocate"
                    disabled={busyRoot !== null}
                    onClick={() => void relocateProject(entry)}
                    type="button"
                  >
                    重新定位
                  </button>
                ) : null}
                {compact ? (
                  <button
                    aria-controls={`recent-project-maintenance-${entry.projectId}`}
                    aria-expanded={openMenuRoot === entry.projectRoot}
                    aria-label={`打开${entry.projectName}维护菜单`}
                    className="recent-project-more"
                    data-project-root={entry.projectRoot}
                    data-testid="recent-project-more"
                    onClick={() =>
                      setOpenMenuRoot((current) =>
                        current === entry.projectRoot ? null : entry.projectRoot,
                      )
                    }
                    type="button"
                  >
                    <DecorativeIcon icon={MoreHorizontal} size={20} />
                  </button>
                ) : (
                  <button
                    className="task4-hit-target"
                    data-task4-core="recent-remove"
                    disabled={busyRoot !== null}
                    onClick={() => void removeProject(entry)}
                    title="只移除最近项目记录，不删除磁盘项目"
                    type="button"
                  >
                    移除记录
                  </button>
                )}
              </div>
              {compact && openMenuRoot === entry.projectRoot ? (
                <div
                  className="recent-project-maintenance-menu"
                  data-testid="recent-project-maintenance-menu"
                  id={`recent-project-maintenance-${entry.projectId}`}
                  role="menu"
                >
                  <p>从最近项目移除，不会删除磁盘上的项目。</p>
                  <button
                    className="task4-hit-target"
                    data-task4-core="recent-remove"
                    disabled={busyRoot !== null}
                    onClick={() => void removeProject(entry)}
                    role="menuitem"
                    type="button"
                  >
                    从最近项目移除
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <output
        className="recent-projects-status"
        data-testid="recent-projects-status"
      >
        {status}
      </output>
    </section>
  );
}
