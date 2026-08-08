import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Stage 2-B left workspace composition contract', () => {
  it('owns project recovery and one mutually exclusive resource activity', () => {
    const left = readSource('src/renderer/shell/LeftWorkspace.tsx');
    const dock = readSource('src/renderer/shell/ResourceActivityDock.tsx');
    const recovery = readSource(
      'src/renderer/features/recovery/ProjectRecoveryPanel.tsx',
    );

    expect(left).toContain('className="left-workspace"');
    expect(left).toContain('data-testid="left-workspace-scroll"');
    expect(left).toContain('<ProjectRecoveryPanel');
    expect(left).toContain('<ResourceActivityDock');
    expect(dock).toContain("useState<ResourceActivity>('shots')");
    expect(dock).toContain('data-testid="resource-activity-tabs"');
    expect(dock).toContain("{ id: 'shots', label: '镜头' }");
    expect(dock).toContain("{ id: 'assets', label: '素材' }");
    expect(dock).toContain("{ id: 'characters', label: '角色' }");
    expect(dock).toContain('<ShotManager');
    expect(dock).toContain('<AssetLibrary');
    expect(dock).toContain('<CharacterManager');
    expect(dock).not.toContain('editorProjectStore');
    expect(recovery).toContain('<RecentProjectsPanel');
    expect(recovery).not.toContain('<ShotManager');
    expect(recovery).not.toContain('<AssetLibrary');
    expect(recovery).not.toContain('<CharacterManager');
    expect(recovery).not.toContain('<CanvasStage');
  });

  it('keeps the central canvas separate and preserves the legacy workspace shell', () => {
    const left = readSource('src/renderer/shell/LeftWorkspace.tsx');
    const shell = readSource('src/renderer/shell/EditorShell.tsx');
    const legacy = readSource('src/renderer/shell/LegacyWorkspace.tsx');
    const canvas = readSource('src/renderer/shell/CanvasWorkspace.tsx');
    const compatibility = readSource(
      'src/renderer/shell/LegacyCompatibilityActivity.tsx',
    );
    const styles = readSource('src/renderer/styles.css');

    expect(shell).toContain('<LeftWorkspace');
    expect(shell).not.toContain('left-workspace-placeholder');
    expect(shell).toContain('<CanvasWorkspace');
    expect(left).toContain('key={`resource:${projectSnapshot.projectRoot}`}');
    expect(left).toContain(
      'key={`compatibility:${projectSnapshot.projectRoot}`}',
    );
    expect(legacy.match(/<CanvasStage/gu) ?? []).toHaveLength(0);
    expect(legacy).not.toContain('<ActionPresetPanel');
    expect(legacy).toContain('data-testid="legacy-workspace-empty"');
    expect(legacy).not.toContain('<ProjectRecoveryPanel');
    expect(canvas.match(/<CanvasStage/gu)).toHaveLength(1);
    expect(compatibility).toContain('data-testid="legacy-compatibility-toggle"');
    expect(compatibility).toContain('{active ? <LegacyWorkspace');
    expect(styles).toMatch(
      /\.left-workspace\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.left-workspace\s*\{[\s\S]*?overflow-x:\s*hidden;/u,
    );
    expect(styles).toMatch(
      /\.canvas-workspace\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
  });
});
