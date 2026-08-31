import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #384 Stage A Timed Task Tray polish', () => {
  it('adds one compact landscape context row without changing the state owner', () => {
    const sheet = source(
      'src/renderer/features/dialogue/DialogueSheet.tsx',
    );
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(sheet).toContain('dialogue-timed-task-context');
    expect(sheet).toContain('dialogue-timed-task-identity');
    expect(sheet).toContain('dialogue-timed-status-chip');
    expect(sheet).toContain('unifiedTaskTray && selectedTimedDialogue');
    expect(inspector).toContain(
      'dialogue-inspector-timeline dialogue-timed-editor',
    );
    expect(inspector).toContain('data-timed-editor-layout="two-column"');
    expect(inspector).not.toContain('new DialogueSelectionStore');
    expect(inspector).not.toContain('new DialogueAuthoringDraft');
  });

  it('keeps the existing Timed text, timing, speaker, audio and delete paths', () => {
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const timeline = inspector.slice(
      inspector.indexOf('if (timelinePresentation)'),
    );

    for (const marker of [
      'dialogue-timed-copy-section',
      'dialogue-timed-timing-section',
      'dialogue-timed-speaker-section',
      'dialogue-timed-audio-section',
      'dialogue-timed-actions',
      'dialogue-timed-textarea',
      'dialogue-timed-time-input',
      'dialogue-timed-apply-timing',
      'dialogue-timed-speaker-select',
      'dialogue-timed-delete',
    ]) {
      expect(timeline).toContain(marker);
    }
    expect(inspector).toContain('dialogueStore.update');
    expect(inspector).toContain('dialogueStore.setTiming');
    expect(inspector).toContain('dialogueStore.remove');
  });

  it('scopes the dark-field and hierarchy treatment to landscape only', () => {
    const styles = source('src/renderer/styles.css');
    const start = styles.lastIndexOf('/* Issue #384:');
    const stageA = styles.slice(start);
    const landscapeScope =
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']";

    expect(start).toBeGreaterThanOrEqual(0);
    expect(stageA).toContain(landscapeScope);
    expect(stageA).toContain('.dialogue-timed-task-context');
    expect(stageA).toContain('.dialogue-timed-status-chip');
    expect(stageA).toContain('grid-template-columns: minmax(0, 1.28fr)');
    expect(stageA).toContain('var(--ui-color-surface-work)');
    expect(stageA).toContain('var(--ui-color-selected-border)');
    expect(stageA).toContain('overflow-y: auto;');
    expect(stageA).not.toContain("data-editor-shell-layout='portrait'");
    expect(stageA).not.toContain("data-editor-shell-layout='desktop'");
  });
});
