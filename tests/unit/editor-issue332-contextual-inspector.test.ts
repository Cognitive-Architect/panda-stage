import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #332 landscape contextual inspector', () => {
  it('keeps one right-inspector owner and one set of production panels', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const inspector = source('src/renderer/shell/RightInspector.tsx');

    expect(shell.match(/<RightInspector/gu)).toHaveLength(1);
    expect(inspector).toContain('dialogueSelectionStore');
    expect(inspector).toContain('const dialogueMode');
    expect(inspector).toContain('data-inspector-mode');
    expect(inspector).toContain('data-presentation=');
    expect(inspector).toContain("'properties'");
    expect(inspector).toContain('presentation={');
    expect(inspector).toContain("'landscape'");
    expect(inspector).toContain("'properties'");
    expect(inspector).toContain("'inspector'");
    expect(inspector.match(/<LayerTransformPanel/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerBackgroundControl/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerOrderControls/gu)).toHaveLength(1);
    expect(inspector).not.toContain('editorProjectStore.update');
    expect(inspector).not.toContain('history');
  });

  it('makes landscape Properties compact while preserving real transform actions', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const transform = source(
      'src/renderer/features/properties/LayerTransformPanel.tsx',
    );
    const order = source(
      'src/renderer/features/properties/LayerOrderControls.tsx',
    );

    expect(inspector).toContain('compactSections');
    expect(inspector).toContain(
      'data-testid="right-inspector-transform-section"',
    );
    expect(inspector).toContain(
      'data-testid="right-inspector-appearance-section"',
    );
    expect(inspector).toContain(
      'data-testid="right-inspector-layer-section"',
    );
    expect(transform).toContain('showResetTransform');
    expect(transform).toContain('data-testid="layer-transform-reset"');
    expect(transform).toContain('layerStore.updateTransform');
    expect(transform).toContain('PROJECT_WIDTH / 2');
    expect(transform).toContain('PROJECT_HEIGHT / 2');
    expect(transform).toContain('showLockControl');
    expect(order).toContain('showLockControl');
    expect(order).toContain('layerStore.setLocked');
  });

  it('keeps Subtitle mode on the existing dialogue state and timing contract', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(dialogue).toContain(
      "export type DialogueInspectorLandscapePresentation = 'landscape'",
    );
    expect(dialogue).toContain('dialogue-inspector-context-summary');
    expect(dialogue).toContain('dialogue-inspector-copy-section');
    expect(dialogue).toContain('dialogue-inspector-time-section');
    expect(dialogue).toContain('dialogue-inspector-audio-section');
    expect(dialogue).toContain('formatTimecode');
    expect(dialogue).toContain('normalizeManualDialogueTiming');
    expect(dialogue).toContain('dialogueStore.update');
    expect(dialogue).toContain('dialogueStore.setTiming');
    expect(dialogue).toContain('dialogueStore.remove');
    expect(dialogue).not.toContain('previewCurrentSubtitle');
    expect(dialogue).not.toContain('matchAudio');
    expect(dialogue).not.toContain('lipSync');
  });

  it('scopes the new visual hierarchy to landscape only', () => {
    const styles = source('src/renderer/styles.css');
    const issueBlock = styles.slice(styles.lastIndexOf('/* Issue #332:'));

    expect(issueBlock).toContain(
      ".editor-layout[data-shell-mode='landscape']",
    );
    expect(issueBlock).toContain('.right-inspector-compact-sections');
    expect(issueBlock).toContain('.dialogue-inspector-landscape');
    expect(issueBlock).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr));',
    );
    expect(issueBlock).not.toContain(
      "data-shell-mode='portrait'",
    );
  });
});
