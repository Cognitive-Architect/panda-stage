import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #373 Cloud Touch landscape selected-object inspector', () => {
  it('projects the authoritative selection into one compact identity summary', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');

    expect(inspector).toContain(
      'data-testid="right-inspector-selection-summary"',
    );
    expect(inspector).toContain('getRightInspectorLayerSummary');
    expect(inspector).toContain('readThumbnail');
    expect(inspector).toContain('const selectionTypeLabel = compact');
    expect(inspector).toContain("? selection.state === 'background'");
    expect(inspector).toContain("? '背景'");
    expect(inspector).toContain('<strong>{selection.layer.name}</strong>');
    expect(inspector).toContain('<span>{selectionTypeLabel}</span>');
  });

  it('uses the same compact section owner for default-open Transform and collapsed lower sections', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const sections = source('src/renderer/shell/PortraitPropertiesSections.tsx');
    const transform = source(
      'src/renderer/features/properties/LayerTransformPanel.tsx',
    );
    const background = source(
      'src/renderer/features/properties/LayerBackgroundControl.tsx',
    );
    const order = source(
      'src/renderer/features/properties/LayerOrderControls.tsx',
    );

    expect(inspector).toContain(
      'const compactPresentation = compact === true || landscapePresentation;',
    );
    expect(inspector).toContain(
      '{!portraitEmptyState && compactPresentation ? (',
    );
    expect(inspector).toContain('<PortraitPropertiesSections');
    expect(sections).toContain('data-testid="right-inspector-transform-section"');
    expect(sections).toMatch(
      /right-inspector-transform-section[\s\S]*?open[\s\S]*?<summary>变换<\/summary>[\s\S]*?<LayerTransformPanel/u,
    );
    expect(sections).toMatch(
      /right-inspector-appearance-section[\s\S]*?<summary>外观<\/summary>[\s\S]*?<LayerBackgroundControl/u,
    );
    expect(sections).toMatch(
      /right-inspector-layer-section[\s\S]*?<summary>图层<\/summary>[\s\S]*?<LayerOrderControls/u,
    );
    expect(transform).toContain('updateScalePercentDraft(event.target.value)');
    expect(transform).toContain("updateDraft('rotationDeg', event.target.value)");
    expect(transform).toContain('adjustRotation(-1)');
    expect(transform).toContain('adjustRotation(1)');
    expect(transform).toContain('layer-transform-primary-action');
    expect(background).toContain('LayerOpacityControl');
    expect(order).toContain('layerStore.reorder');
    expect(order).toContain('layerStore.setLocked');
    expect(order).toContain('layerStore.deleteLayer');
  });

  it('keeps the B -> C -> B transition on the existing drawer and selection owners', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');

    expect(inspector).toContain(
      "const landscapeEmptyState =\n    landscapePresentation && !dialogueMode && selection.state === 'empty';",
    );
    expect(inspector).toContain(
      '<RightInspectorEmptyState presentation="landscape" />',
    );
    expect(inspector).toContain("data-selection-state={selection.state}");
    expect(inspector).toContain('const drawerOpen = requestedDrawerOpen ?? internalDrawerOpen;');
    expect(inspector).toContain('data-drawer-open={drawerOpen}');
    expect(inspector).toContain('onClick={() => setDrawerOpen(!drawerOpen)}');
    expect(inspector).toContain('selectionStore.getSelectedLayerId');
    expect(inspector).toContain('dialogueSelectionStore.getSelectedDialogueId');
    expect(inspector).not.toContain('new LayerSelectionStore');
    expect(inspector).not.toContain('editorProjectStore.update');
    expect(inspector).not.toContain('editorProjectStore.replace');
  });

  it('aligns the landscape header while retaining focus-return and the Stage A handle', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const styles = source('src/renderer/styles.css');
    const issue373 = styles.slice(styles.lastIndexOf('/* Issue #373:'));

    expect(inspector).toContain(
      '{(compact || landscapePresentation) &&\n      (!dialogueMode || landscapePresentation) ? (',
    );
    expect(inspector).toContain('data-testid="inspector-inline-close"');
    expect(inspector).toContain('railRef.current?.focus()');
    expect(inspector).toContain(
      '{!compact && !(landscapePresentation && dialogueMode) ? (',
    );
    expect(issue373).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']",
    );
    expect(issue373).toContain('right-inspector-heading');
    expect(issue373).toContain('display: flex;');
    expect(issue373).toContain('right-inspector-heading-close');
    expect(issue373).toContain('layer-transform-stepper');
    expect(issue373).toContain('layer-transform-primary-action');
    expect(issue373).toContain('min-height: 44px;');
  });
});
