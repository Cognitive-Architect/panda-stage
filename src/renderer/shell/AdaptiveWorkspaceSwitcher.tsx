import { SegmentedTabs } from '../ui';
import type { EditorWorkspace } from './adaptiveEditorShell';

const WORKSPACE_OPTIONS = [
  { value: 'canvas', label: '画布' },
  { value: 'assets', label: 'Assets' },
  { value: 'properties', label: 'Properties' },
  { value: 'timeline', label: 'Timeline' },
] as const satisfies readonly { value: EditorWorkspace; label: string }[];

export interface AdaptiveWorkspaceSwitcherProps {
  value: EditorWorkspace;
  onChange(value: EditorWorkspace): void;
}

/**
 * Portrait's single-choice navigation. The controls stay mounted only as the
 * shell navigation; the selected workspace owner is controlled by EditorShell.
 */
export function AdaptiveWorkspaceSwitcher({
  value,
  onChange,
}: AdaptiveWorkspaceSwitcherProps): React.JSX.Element {
  return (
    <nav
      aria-label="Editor workspace"
      className="editor-portrait-workspace-switcher"
      data-testid="editor-portrait-workspace-switcher"
    >
      <SegmentedTabs
        aria-label="Editor workspace"
        className="editor-portrait-workspace-tabs"
        onChange={(nextValue) => onChange(nextValue as EditorWorkspace)}
        options={WORKSPACE_OPTIONS}
        value={value}
      />
    </nav>
  );
}
