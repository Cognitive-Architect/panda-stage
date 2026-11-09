import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

function source(path: string): string {
  if (path === 'src/renderer/styles.css') return readOrderedStylesheetSource();
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('EF-02 align/distribute UI contract', () => {
  it('reaches the page from the existing Tools drawer without a second shell', () => {
    const drawer = source('src/renderer/shell/ProjectToolsDrawer.tsx');
    const right = source('src/renderer/shell/RightWorkspace.tsx');

    expect(right).toContain('<ProjectToolsDrawer');
    expect(drawer).toContain("'align'");
    expect(drawer).toContain('对齐与均分');
    expect(drawer).toContain('data-testid="project-tools-align"');
    expect(drawer).toContain('data-testid="project-tools-align-view"');
    expect(drawer).toContain('<LayerAlignPanel');
    // The drawer stays a presentation launcher: it never commits Project data.
    expect(drawer).not.toContain('updateProject');
    expect(drawer).not.toContain('applyLayoutTransforms');
  });

  it('keeps the panel one flat column: checklist, actions, one primary button', () => {
    const panel = source('src/renderer/features/layout/LayerAlignPanel.tsx');

    expect(panel).toContain('data-testid="layer-align-panel"');
    expect(panel).toContain('data-testid="layer-align-apply"');
    expect(panel).toContain('应用排列');
    expect(panel).toContain('LAYOUT_ALIGN_ACTIONS.map');
    expect(panel).toContain('data-testid="layer-align-reference"');
    expect(panel).toContain('layerLayoutPreviewStore.show');
    expect(panel).toContain('layerLayoutPreviewStore.clear');
    expect(panel).toContain('layerStore.applyLayoutTransforms');
    // The local selection set never rewrites the global canvas selection.
    expect(panel).not.toContain('selectionStore.select');
    expect(panel).not.toContain('editorProjectStore.updateProject');
    expect(panel).not.toContain('new LayerStore');
  });

  it('renders candidates through the shared canvas model, not a second stage', () => {
    const stage = source('src/renderer/features/canvas/CanvasStage.tsx');
    const model = source(
      'src/renderer/features/canvas/editorTemporalCanvasModel.ts',
    );

    expect(model).toContain('CanvasTransformOverride');
    expect(model).toContain('positionOverrides');
    expect(stage).toContain('useLayerLayoutPreview');
    expect(stage).toContain(
      'positionOverrides: quickLayoutPositionOverrides',
    );
    expect(stage).toContain('layerLayoutTransformOverrides');
    expect(stage).not.toContain('layerLayoutPreviewStore.show');
    // Equal Height needs scale through the same evaluated-layer seam.
    expect(model).toContain('scaleX:');
    expect(model).toContain('scaleY:');
  });

  it('registers the align stylesheet once', () => {
    const entry = readFileSync('src/renderer/styles.css', 'utf8').replace(
      /\r\n/gu,
      '\n',
    );
    const imports =
      entry.match(/s18-02--layer-align-distribute\.css/gu) ?? [];

    expect(imports).toHaveLength(1);
    expect(source('src/renderer/styles.css')).toContain('.layer-align-apply');
    expect(
      source(
        'src/renderer/styles/shell/tools/s18-02--layer-align-distribute.css',
      ),
    ).toContain('.layer-align-actions');
  });
});
