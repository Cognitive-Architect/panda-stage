import {
  AlignStartVertical,
  ArrowLeft,
  Maximize2,
  ScanLine,
  Sparkles,
  Users,
} from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { DecorativeIcon } from '../ui';
import { canvasViewportStore } from '../stores/canvasViewportStore';
import type { CanvasViewportMode } from '../../domain';
import { LayerAlignPanel } from '../features/layout/LayerAlignPanel';
import { QuickCharacterLayoutPanel } from '../features/layout/QuickCharacterLayoutPanel';
import { LegacyWorkspace } from './LegacyWorkspace';

export interface ProjectToolsDrawerProps {
  onClose(): void;
}

type ProjectToolsView = 'home' | 'action-presets' | 'quick-layout' | 'align';

const VIEW_TITLES: Record<ProjectToolsView, string> = {
  home: '工具',
  'action-presets': '动作预设',
  'quick-layout': '快速布阵',
  align: '对齐与均分',
};

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
          <h2 id="project-tools-heading">{VIEW_TITLES[view]}</h2>
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
            aria-labelledby="project-tools-quick-layout-heading"
            className="project-tools-quick-layout-card"
            data-testid="project-tools-quick-layout-card"
          >
            <div className="project-tools-quick-layout-heading">
              <h3 id="project-tools-quick-layout-heading">快速布阵</h3>
            </div>
            <button
              className="project-tools-quick-layout-launcher"
              data-project-tools-action="quick-layout"
              data-testid="project-tools-quick-layout"
              onClick={() => setView('quick-layout')}
              type="button"
            >
              <DecorativeIcon icon={Users} size={18} />
              <span>打开快速布阵</span>
            </button>
          </section>
          <section
            aria-labelledby="project-tools-align-heading"
            className="project-tools-align-card"
            data-testid="project-tools-align-card"
          >
            <div className="project-tools-align-heading">
              <h3 id="project-tools-align-heading">对齐与均分</h3>
            </div>
            <button
              className="project-tools-align-launcher"
              data-project-tools-action="align"
              data-testid="project-tools-align"
              onClick={() => setView('align')}
              type="button"
            >
              <DecorativeIcon icon={AlignStartVertical} size={18} />
              <span>打开对齐与均分</span>
            </button>
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
        </div>
      ) : view === 'quick-layout' ? (
        <section
          aria-label="快速布阵"
          className="project-tools-quick-layout-view"
          data-testid="project-tools-quick-layout-view"
        >
          <QuickCharacterLayoutPanel />
        </section>
      ) : view === 'align' ? (
        <section
          aria-label="对齐与均分"
          className="project-tools-align-view"
          data-testid="project-tools-align-view"
        >
          <LayerAlignPanel />
        </section>
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
