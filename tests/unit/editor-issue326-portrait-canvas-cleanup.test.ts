import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Issue #326 portrait Canvas cleanup', () => {
  it('renames only the top-level Canvas entry', () => {
    const switcher = source(
      'src/renderer/shell/AdaptiveWorkspaceSwitcher.tsx',
    );

    expect(switcher).toContain("{ value: 'canvas', label: '画布' }");
    expect(switcher).not.toContain("{ value: 'canvas', label: 'Canvas' }");
    for (const label of ['素材', 'Properties', 'Timeline']) {
      expect(switcher).toContain(`label: '${label}'`);
    }
  });

  it('keeps one Canvas and one Shot owner while placing Shots below portrait Canvas', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const canvasWorkspace = source('src/renderer/shell/CanvasWorkspace.tsx');
    const resourceDock = source('src/renderer/shell/ResourceActivityDock.tsx');

    expect(shell.match(/<CanvasWorkspace/gu)).toHaveLength(1);
    expect(shell.match(/<LeftWorkspace/gu)).toHaveLength(1);
    expect(shell).toContain(
      "setPortraitCanvasSurface(workspace === 'canvas' ? 'shots' : 'none')",
    );
    expect(shell).not.toContain('portrait-canvas-context-actions');
    expect(shell).not.toContain('portrait-open-properties');
    expect(canvasWorkspace).toContain('<CanvasStage showHeading={showHeading} />');
    expect(resourceDock).toContain('<ShotManager');
    expect(resourceDock).toContain('hideSectionLabels?: boolean');
    expect(resourceDock).toContain('hideSectionLabels = false');
    expect(resourceDock).toContain('hideSectionLabels ?');
    expect(resourceDock).toContain('<p className="eyebrow">编辑资源</p>');
    expect(resourceDock).toContain(
      '<h2 id="resource-activity-heading">{activeLabel}工作区</h2>',
    );
    expect(resourceDock).toContain(
      '<h2 id="resource-activity-heading">{activeLabel}</h2>',
    );
    const leftWorkspace = source('src/renderer/shell/LeftWorkspace.tsx');
    expect(leftWorkspace).toContain(
      "hideSectionLabels={shellMode === 'portrait'}",
    );
  });

  it('removes portrait-only Canvas headings without changing the landscape heading path', () => {
    const canvas = source('src/renderer/features/canvas/CanvasStage.tsx');
    const styles = source('src/renderer/styles.css');

    expect(canvas).toContain('showHeading?: boolean');
    expect(canvas).toContain("aria-label={showHeading ? undefined : '画布'}");
    expect(canvas).toContain('镜头画布');
    expect(canvas).toContain('shot ? shot.name : \'未选择镜头\'');
    expect(styles).not.toContain('portrait-canvas-context-actions');
    expect(styles).toContain(
      'grid-template-rows: max-content max-content;',
    );
    expect(styles).toContain('align-content: start;');
    expect(styles).toContain('height: min(48vh, 480px);');
  });
});
