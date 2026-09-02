import type { ReactNode } from 'react';
import type { AnimationImportIR } from '../../shared/fla-import-api';
import { FlaStageF1Notice, getFlaStageF1Warnings } from './FlaStageF';

export type FlaRenderWorkbenchMode = 'snapshot' | 'sequence';

interface FlaRenderWorkbenchProps {
  mode: FlaRenderWorkbenchMode;
  sourceBasename: string;
  compatibility: ReadonlyArray<AnimationImportIR['compatibility'][number]>;
  onModeChange: (mode: FlaRenderWorkbenchMode) => void;
  children: ReactNode;
}

/**
 * Shared presentation shell for the zero-raster R1/R2 siblings.
 *
 * The shell owns only presentation state: the active tab is not a second
 * render/commit owner. The mounted child continues to own its existing R1 or
 * R2 state machine and IPC contract.
 */
export function FlaRenderWorkbench({
  mode,
  sourceBasename,
  compatibility,
  onModeChange,
  children,
}: FlaRenderWorkbenchProps): React.JSX.Element {
  const snapshotActive = mode === 'snapshot';
  const hasStageF1Warning = getFlaStageF1Warnings(compatibility).length > 0;

  return (
    <section
      aria-label="FLA 渲染工作台"
      className="fla-render-workbench"
      data-stage-f1={hasStageF1Warning ? 'true' : 'false'}
      data-render-mode={mode}
      data-testid="fla-render-workbench"
    >
      <header className="fla-render-workbench-header" data-testid="fla-render-workbench-header">
        <div>
          <h3>FLA 渲染工作台</h3>
          <p className="fla-render-workbench-source" data-testid="fla-render-workbench-source">
            <strong title={sourceBasename}>{sourceBasename}</strong>
            <span> · 只读</span>
          </p>
        </div>
      </header>

      <FlaStageF1Notice compatibility={compatibility} />

      <div
        aria-label="渲染方式"
        className="fla-render-mode-tabs"
        data-testid="fla-render-mode-tabs"
        role="tablist"
      >
        <button
          aria-controls="fla-render-workbench-panel"
          aria-selected={snapshotActive}
          className={`fla-render-mode-tab${snapshotActive ? ' is-active' : ''}`}
          data-testid="fla-render-mode-snapshot"
          id="fla-render-mode-tab-snapshot"
          onClick={() => onModeChange('snapshot')}
          role="tab"
          type="button"
        >
          单帧
          <span>Static Snapshot</span>
        </button>
        <button
          aria-controls="fla-render-workbench-panel"
          aria-selected={!snapshotActive}
          className={`fla-render-mode-tab${snapshotActive ? '' : ' is-active'}`}
          data-testid="fla-render-mode-sequence"
          id="fla-render-mode-tab-sequence"
          onClick={() => onModeChange('sequence')}
          role="tab"
          type="button"
        >
          帧序列
          <span>Frame Sequence</span>
        </button>
      </div>

      <div
        aria-labelledby={snapshotActive ? 'fla-render-mode-tab-snapshot' : 'fla-render-mode-tab-sequence'}
        className="fla-render-workbench-panel-slot"
        data-testid="fla-render-workbench-panel"
        id="fla-render-workbench-panel"
        role="tabpanel"
      >
        {children}
      </div>
    </section>
  );
}
