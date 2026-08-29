import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #360 landscape Shot drawer', () => {
  it('moves project utilities to a separate existing project-level entry', () => {
    const left = source('src/renderer/shell/LeftWorkspace.tsx');
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');

    expect(left).toContain(
      "auxiliaryContent={shellMode === 'landscape' ? undefined : projectUtilities}",
    );
    expect(left).toContain('<ProjectToolsDrawer');
    expect(dock).toContain('data-testid="resource-activity-rail-project-tools"');
    expect(dock).toContain('projectToolsContent');
    expect(dock).toContain('projectToolsOpen');
    expect(left).toContain('<ProjectRecoveryPanel');
    expect(left).toContain('<LegacyCompatibilityActivity');
    expect(dock).toContain('resource-activity-auxiliary');
    expect(dock).toContain(
      '!landscapePresentation && auxiliaryContent ? (',
    );
    expect(dock).not.toContain('resource-activity-secondary-tools');
  });

  it('keeps landscape selected actions and mutations on the existing Shot owner', () => {
    const manager = source('src/renderer/features/shots/ShotManager.tsx');
    const list = source('src/renderer/features/shots/ShotList.tsx');
    const item = source('src/renderer/features/shots/ShotListItem.tsx');
    const quickActions = source(
      'src/renderer/features/shots/ShotQuickActions.tsx',
    );
    const thumbnail = source(
      'src/renderer/features/shots/ShotThumbnailPlaceholder.tsx',
    );

    expect(manager).toContain('shotStore.select');
    expect(manager).toContain('shotStore.move');
    expect(manager).toContain('shotStore.rename');
    expect(manager).toContain('shotStore.setDuration');
    expect(manager).toContain('shotStore.duplicate');
    expect(manager).toContain('shotStore.remove');
    expect(manager).toContain('<ShotQuickActions');
    expect(list).toContain('selectedActions?: ReactNode');
    expect(list).toContain('compactDuration?: boolean');
    expect(item).toContain('className="shot-list-item-actions"');
    expect(item).toContain('formatCompactShotDuration');
    expect(quickActions).toContain('data-testid="shot-quick-rename"');
    expect(quickActions).toContain('data-testid="shot-quick-duration"');
    expect(quickActions).toContain('data-testid="shot-quick-more"');
    expect(quickActions).toContain('onRename(nameInput)');
    expect(quickActions).toContain('onSetDuration(durationMs)');
    expect(quickActions).toContain('onDuplicate');
    expect(quickActions).toContain('onRemove');
    expect(quickActions).not.toContain('已选镜头');
    expect(quickActions).not.toContain('shot-quick-edit-hint');
    expect(thumbnail).not.toContain('画布预览将在后续版本提供');
    expect(thumbnail).toContain('String(index + 1).padStart(2, \'0\')');
  });

  it('limits the visual delta to the landscape presentation', () => {
    const styles = source('src/renderer/styles.css');
    const scope = ".editor-layout[data-shell-mode='landscape']";

    expect(styles).toContain(`${scope}\n  .resource-activity-dock-landscape`);
    expect(styles).toContain(
      `${scope}\n  .resource-activity-dock[data-project-tools='true']`,
    );
    expect(styles).toContain('shot-list-item-selected');
    expect(styles).toContain('shot-quick-actions');
    expect(styles).toContain('shot-list-item-actions');
    expect(styles).not.toContain('border-left: 2px solid rgb(131 211 154 / 62%)');
    expect(styles).toContain('min-height: 44px;');
    expect(styles).toContain('writing-mode: vertical-rl;');
    expect(styles).not.toContain('.editor.layout[data-shell-mode=');
  });
});
