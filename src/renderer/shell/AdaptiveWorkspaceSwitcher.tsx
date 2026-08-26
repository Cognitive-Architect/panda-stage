import { SegmentedTabs } from '../ui';
import type { EditorWorkspace } from './adaptiveEditorShell';
import { Images, PanelTop, Rows3, SlidersHorizontal } from 'lucide-react';

const WORKSPACE_OPTIONS = [
  { value: 'canvas', label: '画布' },
  { value: 'assets', label: '素材' },
  { value: 'properties', label: '属性' },
  { value: 'timeline', label: '时间轴' },
] as const satisfies readonly { value: EditorWorkspace; label: string }[];

const WORKSPACE_ICONS = {
  assets: Images,
  canvas: PanelTop,
  properties: SlidersHorizontal,
  timeline: Rows3,
} as const;

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
        options={WORKSPACE_OPTIONS.map((option) => {
          const Icon = WORKSPACE_ICONS[option.value];
          return {
            ...option,
            label: (
              <>
                <Icon
                  aria-hidden="true"
                  className="ui-icon ui-icon-tab"
                  focusable="false"
                  size={20}
                />
                <span>{option.label}</span>
              </>
            ),
          };
        })}
        value={value}
      />
    </nav>
  );
}
