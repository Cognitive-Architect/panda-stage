import { ActionPresetPanel } from '../features/actions/ActionPresetPanel';
import { CanvasStage } from '../features/canvas/CanvasStage';

export function LegacyWorkspace(): React.JSX.Element {
  return (
    <div
      aria-label="Legacy editor workspace"
      className="legacy-workspace"
      data-testid="legacy-workspace-scroll"
    >
      <section
        aria-label="Action presets"
        className="day25-action-shell"
      >
        <ActionPresetPanel />
      </section>
      <section
        aria-label="Legacy canvas workspace"
        className="day25-editor-shell"
      >
        <CanvasStage />
      </section>
    </div>
  );
}
