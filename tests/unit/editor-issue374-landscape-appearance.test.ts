import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #374 Cloud Touch landscape Appearance hierarchy', () => {
  it('routes only the landscape compact surface to the refined Appearance presentation', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const sections = source('src/renderer/shell/PortraitPropertiesSections.tsx');
    const background = source(
      'src/renderer/features/properties/LayerBackgroundControl.tsx',
    );

    expect(inspector).toContain(
      "presentation={landscapePresentation ? 'landscape' : 'portrait'}",
    );
    expect(sections).toContain("presentation = 'portrait'");
    expect(sections).toContain('presentation={presentation}');
    expect(background).toContain(
      "compact && presentation === 'landscape' ? (",
    );
    expect(background).toContain("data-presentation={presentation}");
  });

  it('puts current background state before capability-driven actions', () => {
    const background = source(
      'src/renderer/features/properties/LayerBackgroundControl.tsx',
    );
    const start = background.indexOf(
      "compact && presentation === 'landscape' ? (",
    );
    const end = background.indexOf(') : compact ? (', start);
    const landscape = background.slice(start, end);

    expect(landscape).toContain('<h3>对象外观</h3>');
    expect(landscape).toContain('<h3>画布背景</h3>');
    expect(landscape).toContain('<span>当前背景</span>');
    expect(landscape).toContain('data-testid="current-background-name"');
    expect(landscape).toContain('为当前镜头管理正式背景。');
    expect(landscape).toContain('data-testid="layer-background-guidance"');
    expect(landscape).toContain('model.canSet ? (');
    expect(landscape).toContain('model.canSelect ? (');
    expect(landscape).toContain('model.canFill ? (');
    expect(landscape).toContain('model.canClear ? (');
    expect(landscape).toContain('className="layer-background-primary"');
    expect(landscape).not.toContain('disabled={!model.can');

    const stateIndex = landscape.indexOf('data-testid="current-background-state"');
    const guidanceIndex = landscape.indexOf(
      'data-testid="layer-background-guidance"',
    );
    const actionsIndex = landscape.indexOf(
      '<div className="layer-background-actions">',
    );
    expect(stateIndex).toBeGreaterThanOrEqual(0);
    expect(guidanceIndex).toBeGreaterThan(stateIndex);
    expect(actionsIndex).toBeGreaterThan(guidanceIndex);
  });

  it('keeps the existing owners and scopes visual weight to landscape only', () => {
    const background = source(
      'src/renderer/features/properties/LayerBackgroundControl.tsx',
    );
    const styles = source('src/renderer/styles.css');
    const issue374 = styles.slice(styles.lastIndexOf('/* Issue #374:'));

    expect(background).toContain('getLayerBackgroundControlModel(');
    expect(background).toContain('selectionStore.selectBackground()');
    expect(background).toContain('layerStore.setBackground(selectedLayerId)');
    expect(background).toContain('layerStore.clearBackground()');
    expect(background).toContain('layerStore.fillBackground()');
    expect(issue374).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']",
    );
    expect(issue374).toContain('layer-background-control-landscape');
    expect(issue374).toContain('layer-background-current-state');
    expect(issue374).toContain('border-bottom: 1px solid var(--ui-color-separator);');
    expect(issue374).toContain("[data-testid='set-current-shot-background']:not(:disabled)");
    expect(issue374).not.toContain("data-editor-shell-layout='portrait'");
  });
});
