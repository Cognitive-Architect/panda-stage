import { ArrowLeft, Bomb, Ghost, LayoutGrid, Maximize2, ScanLine, Sparkles, Spline } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { DecorativeIcon } from '../ui';
import { canvasViewportStore } from '../stores/canvasViewportStore';
import type { CanvasViewportMode, Project } from '../../domain';
import { AfterimagePanel } from '../features/tools/AfterimagePanel';
import { CurveMotionPanel } from '../features/tools/CurveMotionPanel';
import { GridArrayPanel } from '../features/tools/GridArrayPanel';
import { RadialBurstPanel } from '../features/tools/RadialBurstPanel';
import { LegacyWorkspace } from './LegacyWorkspace';
import { DesktopAutomationCard } from './DesktopAutomationCard';

export interface ProjectToolsDrawerProps {
  onClose(): void;
  onPreview?(project: Project): void;
}

type ProjectToolsView =
  | 'home'
  | 'action-presets'
  | 'grid-array'
  | 'curve-motion'
  | 'afterimage'
  | 'radial-burst';

interface ViewModeOption {
  mode: CanvasViewportMode;
  label: string;
  testId: string;
  icon: typeof Maximize2;
}

const VIEW_MODE_OPTIONS: readonly ViewModeOption[] = [
  { mode: 'fit', label: '适应窗口', testId: 'canvas-mode-fit', icon: Maximize2 },
  { mode: 'actual', label: '实际尺寸', testId: 'canvas-mode-actual', icon: ScanLine },
] as const;

/**
 * Project Tools is a presentation-level launcher. The ActionPreset business
 * owner remains unchanged; this component only composes its focused
 * presentation and local navigation state.
 */
export function ProjectToolsDrawer({
  onClose,
  onPreview,
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
          {view !== 'home' ? (
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
          <h2 id="project-tools-heading">
            {view === 'grid-array' ? (
              '排兵布阵'
            ) : view === 'curve-motion' ? (
              '曲线运动'
            ) : view === 'afterimage' ? (
              '残影'
            ) : view === 'radial-burst' ? (
              '径向爆炸'
            ) : (
              <>{view === 'action-presets' ? '动作预设' : '工具'}</>
            )}
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
          <section
            aria-labelledby="project-tools-view-mode-heading"
            className="project-tools-view-mode-card"
            data-testid="project-tools-view-mode-card"
          >
            <div className="project-tools-view-mode-heading">
              <h3 id="project-tools-view-mode-heading">画布</h3>
            </div>
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
              <h3 id="project-tools-action-preset-heading">动作预设</h3>
            </div>
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
          <section
            aria-labelledby="project-tools-grid-array-heading"
            className="project-tools-action-preset-card"
            data-testid="project-tools-grid-array-card"
          >
            <div className="project-tools-action-preset-heading">
              <h3 id="project-tools-grid-array-heading">排兵布阵</h3>
            </div>
            <button
              className="project-tools-action-preset-launcher"
              data-project-tools-action="grid-array"
              data-testid="project-tools-grid-array"
              onClick={() => setView('grid-array')}
              type="button"
            >
              <DecorativeIcon icon={LayoutGrid} size={18} />
              <span>打开排兵布阵</span>
            </button>
          </section>
          <section
            aria-labelledby="project-tools-curve-motion-heading"
            className="project-tools-action-preset-card"
            data-testid="project-tools-curve-motion-card"
          >
            <div className="project-tools-action-preset-heading">
              <h3 id="project-tools-curve-motion-heading">曲线运动</h3>
            </div>
            <button
              className="project-tools-action-preset-launcher"
              data-project-tools-action="curve-motion"
              data-testid="project-tools-curve-motion"
              onClick={() => setView('curve-motion')}
              type="button"
            >
              <DecorativeIcon icon={Spline} size={18} />
              <span>打开曲线运动</span>
            </button>
          </section>
          <section
            aria-labelledby="project-tools-afterimage-heading"
            className="project-tools-action-preset-card"
            data-testid="project-tools-afterimage-card"
          >
            <div className="project-tools-action-preset-heading">
              <h3 id="project-tools-afterimage-heading">残影</h3>
            </div>
            <button
              className="project-tools-action-preset-launcher"
              data-project-tools-action="afterimage"
              data-testid="project-tools-afterimage"
              onClick={() => setView('afterimage')}
              type="button"
            >
              <DecorativeIcon icon={Ghost} size={18} />
              <span>打开残影</span>
            </button>
          </section>
          <section
            aria-labelledby="project-tools-radial-burst-heading"
            className="project-tools-action-preset-card"
            data-testid="project-tools-radial-burst-card"
          >
            <div className="project-tools-action-preset-heading">
              <h3 id="project-tools-radial-burst-heading">径向爆炸</h3>
            </div>
            <button
              className="project-tools-action-preset-launcher"
              data-project-tools-action="radial-burst"
              data-testid="project-tools-radial-burst"
              onClick={() => setView('radial-burst')}
              type="button"
            >
              <DecorativeIcon icon={Bomb} size={18} />
              <span>打开径向爆炸</span>
            </button>
          </section>
          <DesktopAutomationCard />
        </div>
      ) : view === 'action-presets' ? (
        <section
          aria-label="动作预设"
          className="project-tools-action-presets-view"
          data-testid="project-tools-action-presets-view"
        >
          <LegacyWorkspace onPreview={onPreview} />
        </section>
      ) : view === 'grid-array' ? (
        <section
          aria-label="排兵布阵"
          className="project-tools-grid-array-view"
          data-testid="project-tools-grid-array-view"
        >
          <GridArrayPanel onCancel={() => setView('home')} />
        </section>
      ) : view === 'curve-motion' ? (
        <section
          aria-label="曲线运动"
          className="project-tools-grid-array-view"
          data-testid="project-tools-curve-motion-view"
        >
          <CurveMotionPanel onCancel={() => setView('home')} />
        </section>
      ) : view === 'afterimage' ? (
        <section
          aria-label="残影"
          className="project-tools-grid-array-view"
          data-testid="project-tools-afterimage-view"
        >
          <AfterimagePanel onCancel={() => setView('home')} />
        </section>
      ) : (
        <section
          aria-label="径向爆炸"
          className="project-tools-grid-array-view"
          data-testid="project-tools-radial-burst-view"
        >
          <RadialBurstPanel onCancel={() => setView('home')} />
        </section>
      )}
    </section>
  );
}
