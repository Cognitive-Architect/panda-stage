import { ArrowLeft, Maximize2, ScanLine, Sparkles } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { DecorativeIcon } from '../ui';
import { ProjectRecoveryPanel } from '../features/recovery/ProjectRecoveryPanel';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { canvasViewportStore } from '../stores/canvasViewportStore';
import type { CanvasViewportMode } from '../../domain';
import { LegacyWorkspace } from './LegacyWorkspace';

export interface ProjectToolsDrawerProps {
  projectSnapshot: EditorProjectSnapshot;
  recentRefreshToken: number;
  onClose(): void;
  onOpenRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void>;
}

type ProjectToolsView = 'home' | 'action-presets';

interface ViewModeOption {
  mode: CanvasViewportMode;
  label: string;
  testId: string;
  icon: typeof Maximize2;
}

const VIEW_MODE_OPTIONS: readonly ViewModeOption[] = [
  { mode: 'fit', label: '适应窗口', testId: 'canvas-mode-fit', icon: Maximize2 },
  { mode: 'half', label: '50%', testId: 'canvas-mode-half', icon: ScanLine },
  { mode: 'actual', label: '实际尺寸', testId: 'canvas-mode-actual', icon: ScanLine },
] as const;

/**
 * Project Tools is a presentation-level launcher. Recent Projects and the
 * ActionPreset business owner remain the existing feature owners; this
 * component only composes their focused landscape presentation and local
 * navigation state.
 */
export function ProjectToolsDrawer({
  projectSnapshot,
  recentRefreshToken,
  onClose,
  onOpenRecentProject,
}: ProjectToolsDrawerProps): React.JSX.Element {
  const [view, setView] = useState<ProjectToolsView>('home');
  const viewportMode = useSyncExternalStore(
    canvasViewportStore.subscribe,
    canvasViewportStore.getSnapshot,
  ).mode;

  return (
    <section
      aria-labelledby="project-tools-heading"
      className="project-tools-drawer"
      data-project-tools-view={view}
      data-testid="project-tools-drawer"
    >
      <header className="project-tools-drawer-header">
        <div className="project-tools-drawer-heading">
          {view === 'action-presets' ? (
            <button
              aria-label="返回工具"
              className="project-tools-back"
              data-testid="project-tools-back"
              onClick={() => setView('home')}
              type="button"
            >
              <DecorativeIcon icon={ArrowLeft} size={18} />
              <span>工具</span>
            </button>
          ) : null}
          <p className="eyebrow">
            {view === 'action-presets' ? '编辑辅助' : '编辑器工作区'}
          </p>
          <h2 id="project-tools-heading">
            {view === 'action-presets' ? '动作预设' : '工具'}
          </h2>
        </div>
        <button
          aria-label="关闭工具"
          className="project-tools-close"
          data-testid="project-tools-close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </header>

      {view === 'home' ? (
        <div className="project-tools-home" data-testid="project-tools-home">
          <ProjectRecoveryPanel
            onOpenRecentProject={onOpenRecentProject}
            presentation="compact"
            projectSnapshot={projectSnapshot}
            recentRefreshToken={recentRefreshToken}
          />
          <section
            aria-labelledby="project-tools-view-mode-heading"
            className="project-tools-view-mode-card"
            data-testid="project-tools-view-mode-card"
          >
            <div className="project-tools-view-mode-heading">
              <div>
                <p className="eyebrow">画布显示</p>
                <h3 id="project-tools-view-mode-heading">视图</h3>
              </div>
            </div>
            <p>选择画布视口在窗口中的呈现方式</p>
            <div
              className="project-tools-view-mode-segmented"
              data-testid="project-tools-view-mode-segmented"
              role="group"
              aria-label="画布视口模式"
            >
              {VIEW_MODE_OPTIONS.map((option) => {
                const active = option.mode === viewportMode;
                return (
                  <button
                    aria-pressed={active}
                    className="ui-icon-label"
                    data-testid={option.testId}
                    key={option.mode}
                    onClick={() => canvasViewportStore.setMode(option.mode)}
                    type="button"
                  >
                    {option.icon === Maximize2 ? (
                      <Maximize2
                        aria-hidden="true"
                        className="ui-icon"
                        focusable="false"
                        size={16}
                      />
                    ) : null}
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <section
            aria-labelledby="project-tools-action-preset-heading"
            className="project-tools-action-preset-card"
            data-testid="project-tools-action-preset-card"
          >
            <div className="project-tools-action-preset-heading">
              <div>
                <p className="eyebrow">编辑辅助</p>
                <h3 id="project-tools-action-preset-heading">动作预设</h3>
              </div>
              <span className="project-tools-compatibility-badge">兼容</span>
            </div>
            <p>为当前选中的可编辑图层快速应用预设动作</p>
            <button
              className="project-tools-action-preset-launcher"
              data-project-tools-action="action-presets"
              data-testid="project-tools-action-presets"
              onClick={() => setView('action-presets')}
              type="button"
            >
              <DecorativeIcon icon={Sparkles} size={18} />
              <span>打开动作预设</span>
            </button>
          </section>
        </div>
      ) : (
        <section
          aria-label="动作预设"
          className="project-tools-action-presets-view"
          data-testid="project-tools-action-presets-view"
        >
          <LegacyWorkspace />
        </section>
      )}
    </section>
  );
}
