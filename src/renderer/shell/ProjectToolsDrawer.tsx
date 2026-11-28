import type { CurveMotionStageDraft } from '../features/canvas/CurveMotionStageOverlay';
import { ArrowLeft, Bomb, Ghost, LayoutGrid, Sparkles, Spline } from 'lucide-react';
import { useState } from 'react';
import { DecorativeIcon } from '../ui';
import type { Project } from '../../domain';
import { AfterimagePanel } from '../features/tools/AfterimagePanel';
import { BackgroundTilesPanel } from '../features/tools/BackgroundTilesPanel';
import { GraphicBakePanel } from '../features/tools/GraphicBakePanel';
import { CurveMotionPanel } from '../features/tools/CurveMotionPanel';
import { GridArrayPanel } from '../features/tools/GridArrayPanel';
import { RadialBurstPanel } from '../features/tools/RadialBurstPanel';
import { LegacyWorkspace } from './LegacyWorkspace';
import { DesktopAutomationCard } from './DesktopAutomationCard';

export interface ProjectToolsDrawerProps {
  onClose(): void;
  onPreview?(project: Project): void;
  onCurveMotionDraft?(draft: CurveMotionStageDraft | null): void;
}

type ProjectToolsView =
  | 'home'
  | 'action-presets'
  | 'grid-array'
  | 'curve-motion'
  | 'background-tiles'
  | 'orbit-flight'
  | 'converging-flight'
  | 'diffusion-ghost'
  | 'afterimage'
  | 'radial-burst';

/**
 * Project Tools is a presentation-level launcher. The ActionPreset business
 * owner remains unchanged; this component only composes its focused
 * presentation and local navigation state.
 */
export function ProjectToolsDrawer({
  onClose,
  onPreview,
  onCurveMotionDraft,
}: ProjectToolsDrawerProps): React.JSX.Element {
  const [view, setView] = useState<ProjectToolsView>('home');

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
            ) : view === 'background-tiles' ? (
              '背景铺排 / 循环'
            ) : view === 'orbit-flight' ? (
              '环绕飞行'
            ) : view === 'converging-flight' ? (
              '万剑归宗'
            ) : view === 'diffusion-ghost' ? (
              '扩散虚影'
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
          <section className="project-tools-action-preset-card" aria-labelledby="project-tools-background-tiles-heading">
            <div className="project-tools-action-preset-heading">
              <h3 id="project-tools-background-tiles-heading">背景铺排 / 循环</h3>
            </div>
            <button className="project-tools-action-preset-launcher" data-testid="project-tools-background-tiles" onClick={() => setView('background-tiles')} type="button">
              <DecorativeIcon icon={LayoutGrid} size={18} />
              <span>打开背景铺排 / 循环</span>
            </button>
          </section>
          <section className="project-tools-action-preset-card" aria-labelledby="project-tools-orbit-flight-heading">
            <div className="project-tools-action-preset-heading">
              <h3 id="project-tools-orbit-flight-heading">环绕飞行</h3>
            </div>
            <button className="project-tools-action-preset-launcher" data-testid="project-tools-orbit-flight" onClick={() => setView('orbit-flight')} type="button">
              <DecorativeIcon icon={Spline} size={18} />
              <span>打开环绕飞行</span>
            </button>
          </section>
          <section className="project-tools-action-preset-card" aria-labelledby="project-tools-converging-flight-heading">
            <div className="project-tools-action-preset-heading">
              <h3 id="project-tools-converging-flight-heading">万剑归宗</h3>
            </div>
            <button className="project-tools-action-preset-launcher" data-testid="project-tools-converging-flight" onClick={() => setView('converging-flight')} type="button">
              <DecorativeIcon icon={Spline} size={18} />
              <span>打开万剑归宗</span>
            </button>
          </section>
          <section className="project-tools-action-preset-card" aria-labelledby="project-tools-diffusion-ghost-heading">
            <div className="project-tools-action-preset-heading">
              <h3 id="project-tools-diffusion-ghost-heading">扩散虚影</h3>
            </div>
            <button className="project-tools-action-preset-launcher" data-testid="project-tools-diffusion-ghost" onClick={() => setView('diffusion-ghost')} type="button">
              <DecorativeIcon icon={Ghost} size={18} />
              <span>打开扩散虚影</span>
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
      ) : view === 'background-tiles' ? (
        <section aria-label="背景铺排 / 循环" className="project-tools-grid-array-view">
          <BackgroundTilesPanel onCancel={() => setView('home')} />
        </section>
      ) : view === 'orbit-flight' || view === 'converging-flight' || view === 'diffusion-ghost' ? (
        <section className="project-tools-grid-array-view">
          <GraphicBakePanel mode={view} onCancel={() => setView('home')} />
        </section>
      ) : view === 'curve-motion' ? (
        <section
          aria-label="曲线运动"
          className="project-tools-grid-array-view"
          data-testid="project-tools-curve-motion-view"
        >
          <CurveMotionPanel onStageDraft={onCurveMotionDraft} onCancel={() => setView('home')} />
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
