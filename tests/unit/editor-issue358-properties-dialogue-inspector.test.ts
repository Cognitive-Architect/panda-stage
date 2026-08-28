import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #358 portrait Properties dialogue inspector', () => {
  it('routes portrait subtitle Properties through the existing single inspector owner', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(shell.match(/<RightInspector/gu)).toHaveLength(1);
    expect(inspector).toContain('dialogueSelectionStore');
    expect(inspector).toContain('dialogueMode');
    expect(inspector).toContain("'properties'");
    expect(inspector).toContain("'inspector'");
    expect(inspector).toContain('<DialogueInspector');
    expect(dialogue).toContain("| 'properties'");
    expect(dialogue).toContain('data-testid="dialogue-properties-header"');
    expect(dialogue).not.toContain('new DialogueSelectionStore');
    expect(dialogue).not.toContain('editorProjectStore.update');
  });

  it('keeps the approved precision hierarchy and authoritative mutation paths', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const properties = dialogue.slice(dialogue.indexOf('if (propertiesPresentation)'));

    for (const marker of [
      '字幕属性',
      'dialogue-properties-identity',
      'dialogue-inspector-copy-section',
      'dialogue-inspector-speaker-section',
      'dialogue-inspector-time-section',
      'dialogue-inspector-audio-section',
      'dialogue-inspector-apply-timing',
      'dialogue-inspector-delete',
      'MessageSquareText',
      'UserRound',
      'Clock3',
      'Volume2',
      'Trash2',
    ]) {
      expect(properties).toContain(marker);
    }

    expect(properties.indexOf('data-testid="dialogue-inspector-copy-section"')).toBeLessThan(
      properties.indexOf('data-testid="dialogue-inspector-speaker-section"'),
    );
    expect(properties.indexOf('data-testid="dialogue-inspector-speaker-section"')).toBeLessThan(
      properties.indexOf('data-testid="dialogue-inspector-time-section"'),
    );
    expect(properties.indexOf('data-testid="dialogue-inspector-time-section"')).toBeLessThan(
      properties.indexOf('data-testid="dialogue-inspector-audio-section"'),
    );
    expect(properties.indexOf('data-testid="dialogue-inspector-audio-section"')).toBeLessThan(
      properties.indexOf('data-testid="dialogue-inspector-delete"'),
    );
    expect(dialogue).toContain('dialogueStore.update');
    expect(dialogue).toContain('dialogueStore.setTiming');
    expect(dialogue).toContain('dialogueStore.arrange');
    expect(dialogue).toContain('dialogueStore.remove');
  });

  it('limits the visual recomposition to Cloud Touch portrait Properties', () => {
    const styles = source('src/renderer/styles.css');
    const issue358 = styles.slice(styles.lastIndexOf('/* Issue #358:'));

    expect(issue358).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']",
    );
    expect(issue358).toContain(
      ".editor-layout[data-active-workspace='properties']",
    );
    expect(issue358).toContain('.dialogue-inspector-properties');
    expect(issue358).toContain('var(--ui-color-surface-work)');
    expect(issue358).toContain('min-height: 48px;');
    expect(issue358).toContain('dialogue-properties-actions');
    expect(issue358).toContain('rgb(124 46 37 / 28%)');
    expect(issue358).not.toContain("data-editor-shell-layout='landscape'");
  });
});
