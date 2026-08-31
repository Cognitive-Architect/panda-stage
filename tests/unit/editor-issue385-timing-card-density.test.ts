import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #385 Stage A.1 timing card density', () => {
  it('keeps Timing intrinsic and places role/audio in the secondary row', () => {
    const styles = source('src/renderer/styles.css');
    const stageA = styles.slice(styles.lastIndexOf('/* Issue #384:'));

    expect(stageA).toMatch(
      /> \.dialogue-timed-timing-section \{\s+grid-column: 2;\s+grid-row: 1;\s+align-self: start;/,
    );
    expect(stageA).toMatch(
      /> \.dialogue-timed-audio-section \{\s+grid-column: 2;\s+grid-row: 2;/,
    );
    expect(stageA).toMatch(
      /\.dialogue-timed-actions \{\s+display: flex;[\s\S]*?grid-row: 3;/,
    );
    expect(stageA).not.toContain('grid-row: 1 / span 3;');
    expect(stageA).toContain('align-items: start;');
  });

  it('keeps shallow Timed controls reachable through bounded scroll', () => {
    const styles = source('src/renderer/styles.css');
    const start = styles.lastIndexOf('/* Issue #385:');
    const corrective = styles.slice(start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(corrective).toContain(
      '@container stage-e-timeline (max-height: 220px)',
    );
    expect(corrective).toContain('.timeline-task-tray');
    expect(corrective).toContain('flex: 0 0 auto;');
    expect(corrective).toContain('.dialogue-task-body-timed');
    expect(corrective).toContain('display: block;');
    expect(corrective).toContain('max-height: 320px;');
    expect(corrective).toContain('overflow-y: auto;');
    expect(corrective).not.toContain("data-editor-shell-layout='portrait'");
    expect(corrective).not.toContain("data-editor-shell-layout='desktop'");
  });

  it('leaves existing Timed mutation and selection owners in place', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(sheet).toContain('dialogueSelectionStore.toggle(dialogueId)');
    expect(inspector).toContain('dialogueStore.update');
    expect(inspector).toContain('dialogueStore.setTiming');
    expect(inspector).toContain('dialogueStore.remove');
    expect(inspector).not.toContain('new DialogueSelectionStore');
    expect(inspector).not.toContain('new DialogueAuthoringDraft');
  });
});
