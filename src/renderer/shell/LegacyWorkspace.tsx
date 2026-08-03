import { ActionPresetPanel } from '../features/actions/ActionPresetPanel';

export function LegacyWorkspace(): React.JSX.Element {
  return (
    <div
      aria-label="Legacy editor workspace"
      className="legacy-workspace"
      data-testid="legacy-workspace-scroll"
      id="legacy-workspace"
    >
      <section
        aria-label="Action presets"
        className="day25-action-shell"
      >
        <ActionPresetPanel />
      </section>
    </div>
  );
}
