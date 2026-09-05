import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

const LANDSCAPE_SCOPE =
  ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']";

describe('Issue #386 Stage B subtitle authoring shell polish', () => {
  it('keeps Single Add and Batch Paste inside one shared shell and footer', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const batch = source(
      'src/renderer/features/dialogue/DialogueBatchPaste.tsx',
    );

    expect(sheet).toContain('data-testid="dialogue-authoring-shell"');
    expect(sheet).toContain('data-testid="dialogue-authoring-single-grid"');
    expect(sheet).toContain('data-testid="dialogue-authoring-tab-single"');
    expect(sheet).toContain('data-testid="dialogue-authoring-tab-batch"');
    expect(sheet).toContain('data-testid="dialogue-authoring-footer"');
    expect(batch).toContain('dialogue-authoring-mode dialogue-authoring-batch');
    expect(batch).toContain('data-testid="dialogue-authoring-footer"');
    expect(sheet.match(/new DialogueAuthoringDraft\(\)/gu)).toHaveLength(1);
    expect(batch).toContain('draft: DialogueAuthoringDraft');
    expect(batch).not.toContain('new DialogueAuthoringDraft');
  });

  it('gives Single Add a primary/content and secondary/context composition', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    // Issue #430 P-02 keeps the speaker/copy/placement/audio capability but
    // removes the legacy "card inside card" wrappers in the right-workspace
    // presentation. The portrait timeline presentation keeps the historical
    // section class names, so we assert on the data-testid hooks and the
    // capability-bearing field markers shared by both presentations.
    expect(sheet).toContain('dialogue-authoring-field');
    expect(sheet).toContain('dialogue-authoring-speaker-field');
    expect(sheet).toContain('dialogue-authoring-copy-field');
    expect(sheet).toContain('dialogue-authoring-placement-field');
    expect(sheet).toContain('data-testid="dialogue-authoring-playhead"');
    expect(sheet).toContain('data-testid="dialogue-authoring-audio"');
    expect(sheet).toContain('data-audio-state="unbound"');
    expect(sheet).toContain('data-testid="dialogue-authoring-audio-summary"');
    expect(sheet).toContain('暂无绑定音频');
  });

  it('uses the Stage A dark field grammar and bounds Batch feedback locally', () => {
    const styles = source('src/renderer/styles.css');
    const stageB = styles.slice(styles.lastIndexOf('/* Issue #386:'));

    expect(stageB).toContain(LANDSCAPE_SCOPE);
    expect(stageB).toContain(
      'grid-template-columns: minmax(0, 1.18fr) minmax(240px, 0.82fr);',
    );
    expect(stageB).toContain('var(--ui-color-surface-work)');
    expect(stageB).toContain('var(--ui-color-surface-panel)');
    expect(stageB).toContain('var(--ui-color-selected-border)');
    expect(stageB).toContain('min-height: var(--ui-touch-icon);');
    expect(stageB).toContain('dialogue-batch-input-section');
    expect(stageB).toContain('dialogue-batch-preview-section');
    expect(stageB).toContain('max-height: 184px;');
    expect(stageB).toContain('max-height: 132px;');
    expect(stageB).toContain('overflow-y: auto;');
    expect(stageB).not.toContain(
      "data-editor-shell-layout='portrait'",
    );
    expect(stageB).not.toContain("data-editor-shell-layout='desktop'");
  });

  it('keeps authoring controls reachable at shallow height without changing other tray states', () => {
    const styles = source('src/renderer/styles.css');
    const stageB = styles.slice(styles.lastIndexOf('/* Issue #386:'));

    expect(stageB).toContain('@container stage-e-timeline (max-height: 220px)');
    expect(stageB).toContain(
      ":has(> .dialogue-sheet[data-task-tray-state='single-add'])",
    );
    expect(stageB).toContain(
      ":has(> .dialogue-sheet[data-task-tray-state='batch-paste'])",
    );
    expect(stageB).toContain('.dialogue-task-body-authoring');
    expect(stageB).toContain('max-height: 320px;');
    expect(stageB).toContain('height: auto;');
    expect(stageB).toContain('display: inline-flex;');
    expect(stageB).toContain('display: grid;');
  });

  it('preserves the existing draft, parser, validation and mutation owners', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const batch = source(
      'src/renderer/features/dialogue/DialogueBatchPaste.tsx',
    );
    const draft = source(
      'src/renderer/features/dialogue/dialogueAuthoringDraft.ts',
    );

    expect(sheet).toContain('dialogueStore.create(');
    expect(sheet).toContain('dialogueSelectionStore.clear();');
    expect(sheet).toContain('draft.setSingleText(event.target.value);');
    expect(batch).toContain('parseDialoguePaste(');
    expect(batch).toContain('resolveDialoguePaste(');
    expect(batch.match(/dialogueStore\.createMany\(/gu)).toHaveLength(1);
    expect(batch).toContain('draft.setBatchRaw(event.target.value);');
    expect(draft).not.toContain('updateProject');
    expect(draft).not.toContain('HistoryStore');
    expect(sheet).not.toContain('new DialogueSelectionStore');
    expect(batch).not.toContain('updateProject');
  });
});
