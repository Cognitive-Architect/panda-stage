import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Issue 109 adaptive resource workspace contract', () => {
  it('defines a docked wide layout and a viewport-contained narrow drawer', () => {
    const styles = readSource('src/renderer/styles.css');

    expect(styles).toMatch(
      /\.editor-body\s*\{[\s\S]*?minmax\(320px, 360px\)[\s\S]*?minmax\(160px, 180px\)/u,
    );
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*1100px\)[\s\S]*?minmax\(52px, 56px\)[\s\S]*?minmax\(140px, 160px\)/u,
    );
    expect(styles).toContain('.resource-activity-surface');
    expect(styles).toContain('width: min(360px, calc(100vw - 24px));');
    expect(styles).toContain('.resource-activity-body');
    expect(styles).toMatch(
      /\.resource-activity-panel\s+\.asset-category-tabs\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/u,
    );
  });

  it('keeps drawer navigation and primary actions in UI-only state', () => {
    const dock = readSource('src/renderer/shell/ResourceActivityDock.tsx');

    expect(dock).toContain("useState<ResourceActivity>('shots')");
    expect(dock).toContain('data-testid="resource-workspace-handle"');
    expect(dock).toContain('data-testid="resource-activity-close"');
    expect(dock).toContain("event.key === 'Escape'");
    expect(dock).toContain("activity === activeActivity");
    expect(dock).toContain('data-testid="resource-primary-action"');
    expect(dock).toContain('onViewChange={setShotView}');
    expect(dock).toContain('onViewChange={setAssetView}');
    expect(dock).toContain('onViewChange={setCharacterView}');
    expect(dock).not.toContain('editorProjectStore');
    expect(dock).not.toContain('updateProject');
  });

  it('gives each resource module an explicit non-stacked subview path', () => {
    const shots = readSource('src/renderer/features/shots/ShotManager.tsx');
    const shotCreate = readSource(
      'src/renderer/features/shots/ShotCreateForm.tsx',
    );
    const assets = readSource('src/renderer/features/assets/AssetLibrary.tsx');
    const characters = readSource(
      'src/renderer/features/characters/CharacterManager.tsx',
    );
    const characterList = readSource(
      'src/renderer/features/characters/CharacterList.tsx',
    );
    const characterEditor = readSource(
      'src/renderer/features/characters/CharacterEditor.tsx',
    );

    expect(shots).toContain("export type ShotWorkspaceView = 'list' | 'create'");
    expect(shots).toContain('showCreateForm={false}');
    expect(shots).toContain('<ShotCreateForm');
    expect(shotCreate).toContain('data-testid="shot-create-view"');
    expect(assets).toContain("export type AssetWorkspaceView = 'browser' | 'details'");
    expect(assets).toContain("onViewChange('details')");
    expect(assets).toContain('data-testid="asset-details-view"');
    expect(characters).toContain("| 'create'");
    expect(characters).toContain("| 'detail'");
    expect(characters).toContain("| 'expression'");
    expect(characters).toContain('mode="list"');
    expect(characters).toContain('mode="create"');
    expect(characterList).toContain("export type CharacterListMode = 'legacy' | 'list' | 'create'");
    expect(characterEditor).toContain("export type CharacterEditorView = 'full' | 'detail' | 'expression'");
    expect(characterEditor).toContain('character-expression-summary');
    expect(characterEditor).toContain('character-name-edit-row');
  });
});
