import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getNextRightActivity } from '../../src/renderer/shell/RightWorkspace';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Issue #426 unified Right Workspace R1', () => {
  it('keeps the left landscape rail limited to the three resource activities', () => {
    const left = source('src/renderer/shell/LeftWorkspace.tsx');
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');

    expect(dock).toContain("{ id: 'shots', label: '镜头', icon: Clapperboard }");
    expect(dock).toContain("{ id: 'assets', label: '素材', icon: Images }");
    expect(dock).toContain("{ id: 'characters', label: '角色', icon: Smile }");
    expect(dock).not.toContain('project-tools');
    expect(dock).not.toContain('项目工具');
    expect(left).not.toContain('<ProjectToolsDrawer');
  });

  it('defines one right rail with the accepted labels and icon silhouettes', () => {
    const workspace = source('src/renderer/shell/RightWorkspace.tsx');

    expect(workspace).toContain("{ id: 'subtitles', label: '字幕', icon: MessageCircleMore }");
    expect(workspace).toContain("{ id: 'properties', label: '属性', icon: SlidersHorizontal }");
    expect(workspace).toContain("{ id: 'tools', label: '工具', icon: Wrench }");
    expect(workspace.match(/className="right-activity-rail"/gu)).toHaveLength(1);
    expect(workspace).toContain('data-testid="subtitle-workspace-placeholder"');
    expect(workspace).not.toContain('<DialogueSheet');
  });

  it('toggles the active surface and replaces it instead of stacking surfaces', () => {
    expect(getNextRightActivity(null, 'subtitles')).toBe('subtitles');
    expect(getNextRightActivity('subtitles', 'properties')).toBe('properties');
    expect(getNextRightActivity('properties', 'tools')).toBe('tools');
    expect(getNextRightActivity('tools', 'tools')).toBeNull();

    const workspace = source('src/renderer/shell/RightWorkspace.tsx');
    expect(workspace.match(/className="right-workspace-surface"/gu)).toHaveLength(1);
    expect(workspace).toContain("event.key === 'Escape' && activeActivity");
    expect(workspace).toContain('triggerRefs.current[previousActivity]?.focus()');
    expect(workspace).toContain('surfaceRef.current?.focus()');
  });

  it('keeps embedded Properties scrolling inside the docked surface', () => {
    const workspace = source('src/renderer/shell/RightWorkspace.tsx');
    const styles = source('src/renderer/styles.css');

    expect(workspace).toContain('data-active-activity={activeActivity}');
    expect(styles).toMatch(
      /\.right-workspace-surface\[data-active-activity='properties'\]\s*\{\s*overflow-y:\s*hidden;/u,
    );
    expect(styles).toMatch(
      /\.right-inspector-drawer-embedded\s*\{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/u,
    );
  });

  it('reuses the existing Properties and Tools owners in content mode', () => {
    const workspace = source('src/renderer/shell/RightWorkspace.tsx');
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const tools = source('src/renderer/shell/ProjectToolsDrawer.tsx');

    expect(workspace.match(/<RightInspector/gu)).toHaveLength(1);
    expect(workspace.match(/<ProjectToolsDrawer/gu)).toHaveLength(1);
    expect(inspector).toContain('embedded?: boolean');
    expect(inspector).toContain('data-presentation="embedded"');
    expect(inspector).toContain('right-inspector-drawer-open right-inspector-embedded');
    expect(tools).toContain("{view === 'action-presets' ? '动作预设' : '工具'}");
    expect(tools).toContain('aria-label="关闭工具"');
  });

  it('opens the unified properties activity before the canvas verifier edits properties', () => {
    const verifiers = [
      source('scripts/verify-day22.cjs'),
      source('scripts/verify-day23.cjs'),
      source('scripts/verify-day24.cjs'),
    ];

    for (const verifier of verifiers) {
      expect(verifier).toContain(
        "await selectRightActivity(window, 'properties');",
      );
      expect(verifier).toContain(
        '`?.dataset.activeActivity === ${JSON.stringify(activity)} && `',
      );
    }
    expect(verifiers[2]).not.toContain('inspector-rail-handle');
    expect(verifiers[2]).toContain(
      "if (details instanceof HTMLDetailsElement) details.open = true;",
    );

    const task2Verifier = source('scripts/verify-issue102-task2.cjs');
    expect(task2Verifier).toContain('right-activity-rail-properties');
    expect(task2Verifier).toContain("dataset.activeActivity === 'none'");
    expect(task2Verifier).not.toContain('inspector-rail-handle');

    for (const path of [
      'scripts/verify-issue102-task4.cjs',
      'scripts/verify-issue109-resource-workspace.cjs',
    ]) {
      const layoutVerifier = source(path);
      expect(layoutVerifier).toContain(
        "rightRail: box('[data-testid=\"right-activity-rail\"]')",
      );
      expect(layoutVerifier).not.toContain('inspector-rail-handle');
      expect(layoutVerifier).not.toContain('right-inspector-placeholder');
    }
    const resourceVerifier = source(
      'scripts/verify-issue109-resource-workspace.cjs',
    );
    expect(resourceVerifier).toContain(
      'sample.bottom.height >= 210 && sample.bottom.height <= 300',
    );
  });
});
