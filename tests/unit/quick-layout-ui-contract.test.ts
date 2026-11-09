import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

function source(path: string): string {
  if (path === 'src/renderer/styles.css') return readOrderedStylesheetSource();
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('AUTO-01 Quick Layout UI contract', () => {
  it('reaches Quick Layout from the existing Tools drawer without a second shell', () => {
    const drawer = source('src/renderer/shell/ProjectToolsDrawer.tsx');
    const right = source('src/renderer/shell/RightWorkspace.tsx');

    expect(right).toContain('<ProjectToolsDrawer');
    expect(drawer).toContain("'quick-layout'");
    expect(drawer).toContain('data-testid="project-tools-quick-layout"');
    expect(drawer).toContain('data-testid="project-tools-quick-layout-view"');
    expect(drawer).toContain('<QuickCharacterLayoutPanel');
    expect(drawer).toContain('data-testid="project-tools-back"');
    // The drawer stays a presentation launcher: it never commits Project data.
    expect(drawer).not.toContain('updateProject');
    expect(drawer).not.toContain('HistoryControls');
  });

  it('keeps the panel single-slot, icon-swapped, and preview driven', () => {
    const panel = source(
      'src/renderer/features/layout/QuickCharacterLayoutPanel.tsx',
    );

    expect(panel).toContain('quick-layout-${slot}');
    expect(panel).toContain("renderSelect('left'");
    expect(panel).toContain("renderSelect('right'");
    expect(panel).toContain('data-testid="quick-layout-swap"');
    expect(panel).toContain('aria-label="交换左右"');
    expect(panel).toContain('data-testid="quick-layout-apply"');
    expect(panel).toContain('应用站位');
    expect(panel).toContain('quickLayoutPreviewStore.show');
    expect(panel).toContain('quickLayoutPreviewStore.clear');
    expect(panel).toContain('layerStore.updatePositions');
    // Quick Layout never reaches for the formal store directly.
    expect(panel).not.toContain('editorProjectStore.updateProject');
    expect(panel).not.toContain('new LayerStore');
  });

  it('renders candidates through the shared canvas model, not a second stage', () => {
    const stage = source('src/renderer/features/canvas/CanvasStage.tsx');
    const model = source(
      'src/renderer/features/canvas/editorTemporalCanvasModel.ts',
    );

    expect(model).toContain('positionOverrides');
    expect(stage).toContain('useQuickLayoutPreview');
    expect(stage).toContain('positionOverrides: quickLayoutPositionOverrides');
    expect(stage).not.toContain('quickLayoutPreviewStore.show');
  });

  it('registers the Quick Layout stylesheet once', () => {
    const entry = readFileSync('src/renderer/styles.css', 'utf8').replace(
      /\r\n/gu,
      '\n',
    );
    const imports =
      entry.match(/s18-01--quick-character-layout\.css/gu) ?? [];

    expect(imports).toHaveLength(1);
    expect(source('src/renderer/styles.css')).toContain('.quick-layout-apply');
    expect(
      source(
        'src/renderer/styles/shell/tools/s18-01--quick-character-layout.css',
      ),
    ).toContain('.quick-layout-select');
  });
});
