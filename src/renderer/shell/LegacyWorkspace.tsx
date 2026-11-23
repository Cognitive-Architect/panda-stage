import { ActionPresetPanel } from '../features/actions/ActionPresetPanel';
import type { Project } from '../../domain';

export function LegacyWorkspace({ onPreview }: { onPreview?: (project: Project) => void }): React.JSX.Element {
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
        <ActionPresetPanel onPreview={onPreview} />
      </section>
    </div>
  );
}
