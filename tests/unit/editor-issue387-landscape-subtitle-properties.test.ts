import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

const LANDSCAPE_SCOPE =
  ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']";

function landscapeDialogueSource(dialogue: string): string {
  const start = dialogue.indexOf('if (landscapePresentation)');
  const end = dialogue.indexOf(
    '\n  return (\n    <>\n      <div className="right-inspector-heading">',
    start,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return dialogue.slice(start, end);
}

describe('Issue #387 landscape subtitle Properties polish', () => {
  it('keeps the subtitle route inside the single RightInspector owner', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(shell.match(/<RightInspector/gu)).toHaveLength(1);
    expect(inspector).toContain('dialogueSelectionStore.getSelectedDialogueId');
    expect(inspector).toContain('const dialogueMode');
    expect(inspector).toContain('data-inspector-mode={dialogueMode');
    expect(inspector).toContain('<DialogueInspector');
    expect(inspector).toContain("? 'landscape'");
    expect(dialogue).toContain(
      "export type DialogueInspectorLandscapePresentation = 'landscape'",
    );
    expect(dialogue).not.toContain('new DialogueSelectionStore');
    expect(dialogue).not.toContain('new DialogueAuthoringDraft');
    expect(dialogue).not.toContain('editorProjectStore.update');
  });

  it('orders the compact landscape hierarchy as identity, copy, timing, metadata, actions', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const landscape = landscapeDialogueSource(dialogue);

    for (const marker of [
      'dialogue-inspector-landscape-properties',
      'dialogue-properties-header',
      'dialogue-properties-identity',
      'dialogue-inspector-copy-section',
      'dialogue-inspector-time-section',
      'dialogue-inspector-speaker-section',
      'dialogue-inspector-audio-section',
      'dialogue-inspector-delete',
      'dialogue-inspector-status',
      'data-timed={String(timed)}',
    ]) {
      expect(landscape).toContain(marker);
    }

    const ordered = [
      'dialogue-properties-header',
      'dialogue-inspector-copy-section',
      'dialogue-inspector-time-section',
      'dialogue-inspector-speaker-section',
      'dialogue-inspector-audio-section',
      'dialogue-inspector-delete',
    ].map((marker) => landscape.indexOf(marker));
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(landscape).toContain(
      'className="dialogue-landscape-properties-textarea"',
    );
    expect(landscape).toContain(
      'className="dialogue-landscape-properties-speaker-select"',
    );
    expect(landscape).toContain(
      'className="dialogue-landscape-properties-time-input"',
    );
  });

  it('keeps timing, speaker, audio, and delete actions on existing owners', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const landscape = landscapeDialogueSource(dialogue);

    expect(dialogue).toContain('dialogueStore.setTiming(');
    expect(landscape).toContain('onClick={commitTiming}');
    expect(landscape).toContain('dialogueStore.update(dialogue.id');
    expect(landscape).toContain('dialogueStore.arrange(');
    expect(landscape).toContain('dialogueStore.remove(dialogue.id)');
    expect(landscape).toContain('formatTimecode(dialogue.startMs)');
    expect(landscape).toContain('formatTimecode(dialogue.endMs)');
    expect(landscape).toContain(
      'data-testid="dialogue-inspector-apply-timing"',
    );
    expect(landscape).toContain(
      'data-testid="dialogue-inspector-audio-summary"',
    );
    expect(landscape).not.toContain('updateProject');
    expect(landscape).not.toContain('HistoryStore');
    expect(landscape).not.toContain('previewCurrentSubtitle');
    expect(landscape).not.toContain('matchAudio');
    expect(landscape).not.toContain('lipSync');
  });

  it('bounds copy and keeps the narrow drawer as the one scroll owner', () => {
    const styles = source('src/renderer/styles.css');
    const stageC = styles.slice(styles.lastIndexOf('/* Issue #387:'));

    expect(stageC).toContain(LANDSCAPE_SCOPE);
    expect(stageC).toContain(
      '.right-inspector-drawer:has(> .dialogue-inspector-landscape-properties)',
    );
    expect(stageC).toContain('min-height: 88px;');
    expect(stageC).toContain('max-height: 136px;');
    expect(stageC).toContain('overflow-y: auto;');
    expect(stageC).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr));',
    );
    expect(stageC).toContain('min-height: 44px;');
    expect(stageC).toContain('dialogue-properties-actions');
    expect(stageC).toContain('rgb(124 46 37 / 28%)');
    expect(stageC).not.toContain("data-editor-shell-layout='portrait'");
    expect(stageC).not.toContain("data-editor-shell-layout='desktop'");
  });

  it('reads current shot/dialogue truth and preserves existing landscape regressions', () => {
    const inspector = source('src/renderer/shell/RightInspector.tsx');
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const styles = source('src/renderer/styles.css');

    expect(inspector).toContain('shotStore.getCurrentShotId');
    expect(inspector).toContain('dialogueSelectionStore.getSelectedDialogueId');
    expect(dialogue).toContain('shotStore.getCurrentShotId');
    expect(dialogue).toContain(
      'dialogue?.id, dialogue?.text, dialogue?.startMs, dialogue?.endMs',
    );
    expect(styles).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']",
    );
    expect(styles).toContain('.dialogue-inspector-properties');
    expect(styles).toContain(
      ".editor-layout[data-shell-mode='landscape']\n  .right-inspector-drawer",
    );
  });
});
