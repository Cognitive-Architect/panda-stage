import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  RightInspectorEmptyState,
  type RightInspectorEmptyStateProps,
} from '../../src/renderer/shell/RightInspector';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Issue #372 Cloud Touch landscape Properties Stage B', () => {
  it('renders one quiet, accessible empty state without future property shells', () => {
    const markup = renderToStaticMarkup(
      createElement(
        RightInspectorEmptyState as ComponentType<RightInspectorEmptyStateProps>,
        { presentation: 'landscape' },
      ),
    );

    expect(markup).toContain(
      'data-empty-state-presentation="landscape"',
    );
    expect(markup).toContain('data-selection-state="empty"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-labelledby="right-inspector-empty-state-title"');
    expect(markup).toContain('aria-describedby="right-inspector-empty-state-description"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('未选择对象');
    expect(markup).toContain(
      '点击画布中的角色、图片或其他可编辑对象，这里会显示位置、大小和图层设置。',
    );
    expect(markup).not.toContain('right-inspector-empty-state-capabilities');
    for (const section of [
      'right-inspector-transform-section',
      'right-inspector-appearance-section',
      'right-inspector-layer-section',
    ]) {
      expect(markup).not.toContain(section);
    }
    expect(markup).not.toContain('<summary>');
    expect(markup).not.toContain('<button');
  });

  it('keeps portrait copy/capability previews on the existing presentation path', () => {
    const markup = renderToStaticMarkup(
      createElement(RightInspectorEmptyState),
    );

    expect(markup).toContain('选择一个对象开始编辑');
    expect(markup).toContain('right-inspector-empty-state-capabilities');
    expect(markup).toContain('位置 / 缩放 / 旋转');
  });

  it('projects the authoritative empty selection into Stage B and leaves drawer state independent', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');

    expect(inspector).toContain(
      "const landscapeEmptyState =\n    landscapePresentation && !dialogueMode && selection.state === 'empty';",
    );
    expect(inspector).toContain(
      '<RightInspectorEmptyState presentation="landscape" />',
    );
    expect(inspector).toContain('{landscapeEmptyState ? null : (');
    expect(inspector).toContain(
      'const drawerOpen = requestedDrawerOpen ?? internalDrawerOpen;',
    );
    expect(inspector).toContain('data-drawer-open={drawerOpen}');
    expect(inspector).toContain('onClick={() => setDrawerOpen(!drawerOpen)}');
  });

  it('preserves the single inspector owner and non-mutation boundaries', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');

    expect(inspector.match(/<RightInspectorEmptyState/gu)).toHaveLength(2);
    expect(inspector.match(/<LayerTransformPanel/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerBackgroundControl/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerOrderControls/gu)).toHaveLength(1);
    expect(inspector).toContain('selectionStore.getSelectedLayerId');
    expect(inspector).toContain('editorProjectStore.getSnapshot');
    expect(inspector).not.toContain('editorProjectStore.update');
    expect(inspector).not.toContain('editorProjectStore.replace');
    expect(inspector).not.toContain('new LayerSelectionStore');
  });

  it('scopes Stage B styling to the landscape Cloud Touch surface', () => {
    const styles = source('src/renderer/styles.css');
    const stageB = styles.slice(styles.lastIndexOf('/* Issue #372:'));

    expect(stageB).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']",
    );
    expect(stageB).toContain('right-inspector-selection-empty-landscape');
    expect(stageB).toContain('background: transparent;');
    expect(stageB).toContain('text-align: center;');
    expect(stageB).toContain('font-size: 20px;');
  });
});
