import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #331 landscape resource drawers', () => {
  it('uses one ResourceActivityDock with a landscape rail and no nested activity tabs', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const left = source('src/renderer/shell/LeftWorkspace.tsx');

    expect(dock).toContain(
      "export type ResourceActivityPresentation = 'default' | 'landscape';",
    );
    expect(dock).toContain('presentation?: ResourceActivityPresentation');
    expect(dock).toContain('resource-activity-rail');
    expect(dock).toContain('data-testid="resource-activity-rail"');
    expect(dock).toContain('landscapePresentation ||');
    expect(dock).toContain('{hideLocalActivityTabs ? null : (');
    expect(dock).toContain('resource-activity-auxiliary');
    expect(dock).toContain(
      '!landscapePresentation && auxiliaryContent ? (',
    );
    expect(dock).not.toContain('resource-activity-secondary-tools');
    expect(left).toContain(
      "presentation={shellMode === 'landscape' ? 'landscape' : 'default'}",
    );
  });

  it('keeps Shot, Asset and Character behavior on their existing owners', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const shots = source('src/renderer/features/shots/ShotManager.tsx');
    const assets = source('src/renderer/features/assets/AssetLibrary.tsx');
    const characters = source(
      'src/renderer/features/characters/CharacterManager.tsx',
    );
    const characterList = source(
      'src/renderer/features/characters/CharacterList.tsx',
    );

    expect(dock).toContain('<ShotManager');
    expect(dock).toContain('<AssetLibrary');
    expect(dock).toContain('<CharacterManager');
    expect(dock).toContain(
      "landscapePresentation ? 'landscape' : 'default'",
    );
    expect(shots).toContain('shotStore.getCurrentShotId');
    expect(shots).toContain('shotStore.create');
    expect(shots).toContain('shotStore.select');
    expect(shots).toContain('presentation?: ShotManagerPresentation');
    expect(shots).toContain("presentation === 'landscape' ? null");
    expect(assets).toContain('selectAssetLibraryEntries');
    expect(assets).toContain('filterAssetLibraryEntries');
    expect(assets).toContain('onImportFla={openFlaReview}');
    expect(assets).toContain('if (!hideHeading) onViewChange(\'details\');');
    expect(characters).toContain('characterStore.create');
    expect(characters).toContain('hideHeading?: boolean');
    expect(characterList).toContain('showHeading?: boolean');
  });

  it('limits landscape changes to presentation and keeps navigation project-neutral', () => {
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const left = source('src/renderer/shell/LeftWorkspace.tsx');
    const styles = source('src/renderer/styles.css');
    const scope =
      ".editor-layout[data-shell-mode='landscape']\n  .resource-activity-dock-landscape";

    expect(styles).toContain(`${scope}\n  .resource-activity-rail`);
    expect(styles).toContain(`${scope}\n  .resource-activity-surface`);
    expect(styles).toContain('left: 64px;');
    expect(styles).toContain(`${scope}\n  .resource-activity-tabs`);
    expect(styles).toContain('display: none;');
    expect(styles).toContain(`${scope}\n  .resource-activity-body`);
    expect(styles).toContain('overflow: visible;');
    expect(styles).not.toContain('resource-activity-secondary-tools');
    expect(dock).not.toContain('updateProject');
    expect(left).not.toContain('editorProjectStore.updateProject');
  });
});
