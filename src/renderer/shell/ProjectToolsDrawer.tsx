import {
  AlignStartVertical,
  ArrowLeft,
  Clapperboard,
  LayoutTemplate,
  ListFilter,
  Maximize2,
  MessageSquare,
  ScanLine,
  Sparkles,
  Users,
  Video,
} from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { DecorativeIcon } from '../ui';
import { BatchDialogueMovePanel } from '../features/dialogue/BatchDialogueMovePanel';
import { LayerAlignPanel } from '../features/layout/LayerAlignPanel';
import { QuickCharacterLayoutPanel } from '../features/layout/QuickCharacterLayoutPanel';
import { BatchTimelineEventPanel } from '../features/timeline/BatchTimelineEventPanel';
import { canvasViewportStore } from '../stores/canvasViewportStore';
import { MultiSceneDialoguePanel } from '../features/shots/MultiSceneDialoguePanel';
import { MultiScenePanel } from '../features/shots/MultiScenePanel';
import { MultiScenePerformancePanel } from '../features/shots/MultiScenePerformancePanel';
import type { CanvasViewportMode } from '../../domain';
import { ShotCameraPanel } from '../features/camera/ShotCameraPanel';
import { cameraToolStore } from '../features/camera/cameraToolStore';
import { LegacyWorkspace } from './LegacyWorkspace';

export interface ProjectToolsDrawerProps {
  onClose(): void;
}

type ProjectToolsView =
  | 'home'
  | 'action-presets'
  | 'camera'
  | 'quick-layout'
  | 'align'
  | 'batch-adjust'
  | 'multi-scene'
  | 'multi-scene-dialogue'
  | 'multi-scene-performance';

/** Batch Adjust keeps its two scopes side by side; 对白 stays the default. */
type BatchAdjustScope = 'dialogue' | 'action';

/** Single title owner: the header never re-derives a view's name. */
const VIEW_TITLES: Record<ProjectToolsView, string> = {
  home: '工具',
  'action-presets': '动作预设',
  camera: '运镜',
  'quick-layout': '快速布阵',
  align: '对齐与均分',
  'batch-adjust': '批量调整',
  'multi-scene': '多镜头布景',
  'multi-scene-dialogue': '多镜头对白',
  'multi-scene-performance': '表演编排',
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
  const [batchScope, setBatchScope] = useState<BatchAdjustScope>('dialogue');
  const viewportMode = useSyncExternalStore(
    canvasViewportStore.subscribe,
    canvasViewportStore.getSnapshot,
  ).mode;
  // Closing the drawer (button, Escape or activity switch) unmounts it. Only
  // the camera tool session state is cleared; Shot.camera stays persisted.
  useEffect(() => () => cameraToolStore.reset(), []);

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
              onClick={() => {
                cameraToolStore.reset();
                setView('home');
              }}
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
            aria-labelledby="project-tools-camera-heading"
            className="project-tools-action-preset-card"
            data-testid="project-tools-camera-card"
          >
            <div className="project-tools-action-preset-heading">
              <h3 id="project-tools-camera-heading">运镜</h3>
            </div>
            <button
              className="project-tools-action-preset-launcher"
              data-project-tools-action="camera"
              data-testid="project-tools-camera"
              onClick={() => setView('camera')}
              type="button"
            >
              <DecorativeIcon icon={Video} size={18} />
              <span>打开运镜</span>
            </button>
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
          <section
            aria-labelledby="project-tools-batch-adjust-heading"
            className="project-tools-action-preset-card"
            data-testid="project-tools-batch-adjust-card"
          >
            <div className="project-tools-action-preset-heading">
              <h3 id="project-tools-batch-adjust-heading">批量调整</h3>
            </div>
            <button
              className="project-tools-action-preset-launcher"
              data-project-tools-action="batch-adjust"
              data-testid="project-tools-batch-adjust"
              onClick={() => {
                // Re-entering always lands on the AUTO-02 default scope.
                setBatchScope('dialogue');
                setView('batch-adjust');
              }}
              type="button"
            >
              <DecorativeIcon icon={ListFilter} size={18} />
              <span>打开批量调整</span>
            </button>
          </section>
          <section
            aria-labelledby="project-tools-multi-scene-heading"
            className="project-tools-multi-scene-card"
            data-testid="project-tools-multi-scene-card"
          >
            <div className="project-tools-multi-scene-heading">
              <h3 id="project-tools-multi-scene-heading">多镜头布景</h3>
            </div>
            <button
              className="project-tools-multi-scene-launcher"
              data-project-tools-action="multi-scene"
              data-testid="project-tools-multi-scene"
              onClick={() => setView('multi-scene')}
              type="button"
            >
              <DecorativeIcon icon={LayoutTemplate} size={18} />
              <span>打开多镜头布景</span>
            </button>
          </section>
          <section
            aria-labelledby="project-tools-multi-scene-dialogue-heading"
            className="project-tools-multi-scene-dialogue-card"
            data-testid="project-tools-multi-scene-dialogue-card"
          >
            <div className="project-tools-multi-scene-dialogue-heading">
              <h3 id="project-tools-multi-scene-dialogue-heading">多镜头对白</h3>
            </div>
            <button
              className="project-tools-multi-scene-dialogue-launcher"
              data-project-tools-action="multi-scene-dialogue"
              data-testid="project-tools-multi-scene-dialogue"
              onClick={() => setView('multi-scene-dialogue')}
              type="button"
            >
              <DecorativeIcon icon={MessageSquare} size={18} />
              <span>打开多镜头对白</span>
            </button>
          </section>
          <section
            aria-labelledby="project-tools-multi-scene-performance-heading"
            className="project-tools-multi-scene-performance-card"
            data-testid="project-tools-multi-scene-performance-card"
          >
            <div className="project-tools-multi-scene-performance-heading">
              <h3 id="project-tools-multi-scene-performance-heading">表演编排</h3>
            </div>
            <button
              className="project-tools-multi-scene-performance-launcher"
              data-project-tools-action="multi-scene-performance"
              data-testid="project-tools-multi-scene-performance"
              onClick={() => setView('multi-scene-performance')}
              type="button"
            >
              <DecorativeIcon icon={Clapperboard} size={18} />
              <span>打开表演编排</span>
            </button>
          </section>
        </div>
      ) : view === 'camera' ? (
        <section
          aria-label="运镜"
          className="project-tools-action-presets-view"
          data-testid="project-tools-camera-view"
        >
          <ShotCameraPanel />
        </section>
      ) : view === 'action-presets' ? (
        <section
          aria-label="动作预设"
          className="project-tools-action-presets-view"
          data-testid="project-tools-action-presets-view"
        >
          <LegacyWorkspace />
        </section>
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
      ) : view === 'batch-adjust' ? (
        <section
          aria-label="批量调整"
          className="project-tools-batch-adjust-view"
          data-testid="project-tools-batch-adjust-view"
        >
          <div
            aria-label="批量调整对象"
            className="batch-adjust-scope"
            role="group"
          >
            <button
              aria-pressed={batchScope === 'dialogue'}
              className="batch-adjust-scope-option"
              data-testid="batch-adjust-scope-dialogue"
              onClick={() => setBatchScope('dialogue')}
              type="button"
            >
              对白
            </button>
            <button
              aria-pressed={batchScope === 'action'}
              className="batch-adjust-scope-option"
              data-testid="batch-adjust-scope-action"
              onClick={() => setBatchScope('action')}
              type="button"
            >
              动作
            </button>
          </div>
          {batchScope === 'dialogue' ? (
            <BatchDialogueMovePanel />
          ) : (
            <BatchTimelineEventPanel />
          )}
        </section>
      ) : view === 'multi-scene' ? (
        <section
          aria-label="多镜头布景"
          className="project-tools-multi-scene-view"
          data-testid="project-tools-multi-scene-view"
        >
          <MultiScenePanel />
        </section>
      ) : view === 'multi-scene-dialogue' ? (
        <section
          aria-label="多镜头对白"
          className="project-tools-multi-scene-dialogue-view"
          data-testid="project-tools-multi-scene-dialogue-view"
        >
          <MultiSceneDialoguePanel />
        </section>
      ) : (
        <section
          aria-label="表演编排"
          className="project-tools-multi-scene-performance-view"
          data-testid="project-tools-multi-scene-performance-view"
        >
          <MultiScenePerformancePanel />
        </section>
      )}
    </section>
  );
}
