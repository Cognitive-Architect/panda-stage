import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Issue #327 portrait shell and Shot header cleanup', () => {
  it('keeps the local Shot tabs out of the portrait Canvas Shot surface', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const shotManager = source(
      'src/renderer/features/shots/ShotManager.tsx',
    );

    expect(dock).toContain(
      "const hideLocalActivityTabs =\n    hideSectionLabels && activeActivity === 'shots';",
    );
    expect(dock).toContain('{hideLocalActivityTabs ? null : (');
    expect(dock).toContain('data-active-activity={activeActivity}');
    expect(dock).toContain('hideHeading={hideLocalActivityTabs}');
    expect(shotManager).toContain('hideHeading?: boolean');
    expect(shotManager).toContain('showHeading={!hideHeading}');
  });

  it('preserves the Shot primary action and accessible list semantics', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const list = source('src/renderer/features/shots/ShotList.tsx');

    expect(dock).toContain('data-testid="resource-primary-action"');
    expect(dock).toContain("label: '新建镜头'");
    expect(list).toContain('showHeading?: boolean');
    expect(list).toContain("aria-label={showHeading ? undefined : '镜头列表'}");
  });

  it('scopes flatter framing and Shot CTA treatment to Cloud Touch portrait', () => {
    const styles = source('src/renderer/styles.css').replaceAll('\r\n', '\n');
    const scope =
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']";

    expect(styles).toContain(`${scope}\n  .compact-project-bar`);
    expect(styles).toContain(`${scope}\n  .editor-portrait-workspace-switcher`);
    expect(styles).toContain(
      `${scope}\n  .resource-activity-dock[data-active-activity='shots']`,
    );
    expect(styles).toContain('border-bottom: 3px solid var(--ui-color-selected-border);');
    expect(styles).toContain('grid-column: 1 / -1;');
    expect(styles).toContain('clip: rect(0 0 0 0);');
  });
});
