import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getDialogueSheetState,
  isTimedDialogue,
} from '../../src/renderer/features/dialogue/DialogueSheet';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #352 Timeline State B selected untimed subtitle', () => {
  it('distinguishes untimed, timed and authoring states with explicit precedence', () => {
    expect(isTimedDialogue({ startMs: 0, endMs: 0 })).toBe(false);
    expect(isTimedDialogue({ startMs: 0, endMs: 1 })).toBe(true);
    expect(
      getDialogueSheetState({
        authoringMode: 'none',
        selectedDialogueState: 'none',
      }),
    ).toBe('timeline-default');
    expect(
      getDialogueSheetState({
        authoringMode: 'none',
        selectedDialogueState: 'untimed',
      }),
    ).toBe('timeline-untimed-selected');
    expect(
      getDialogueSheetState({
        authoringMode: 'none',
        selectedDialogueState: 'timed',
      }),
    ).toBe('timeline-timed-selected');
    expect(
      getDialogueSheetState({
        authoringMode: 'batch',
        selectedDialogueState: 'untimed',
      }),
    ).toBe('timeline-bulk-paste-open');
    expect(
      getDialogueSheetState({
        authoringMode: 'single',
        selectedDialogueState: 'untimed',
      }),
    ).toBe('timeline-single-add-open');
  });

  it('keeps State A as a browse surface and mounts actions only for the selected row', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const row = sheet.slice(sheet.indexOf('displayedUntimedDialogues.map'));

    expect(sheet).toContain("const showInlineActions = timelineState === 'timeline-untimed-selected'");
    expect(sheet).toContain('aria-pressed={selected}');
    expect(sheet).toContain('dialogue-untimed-affordance');
    expect(sheet).toContain('selected && showInlineActions');
    expect(sheet).toContain('data-testid="dialogue-untimed-action-strip"');
    expect(sheet).toContain('data-testid="dialogue-untimed-arrange"');
    expect(sheet).toContain('data-testid="dialogue-untimed-cancel"');
    expect(sheet).toContain('dialogueSelectionStore.clear()');
    expect(row.indexOf('data-testid="dialogue-untimed-arrange"')).toBeGreaterThan(
      row.indexOf('selected && showInlineActions'),
    );
    expect(sheet.indexOf('data-testid="dialogue-untimed-cancel"')).toBeLessThan(
      sheet.indexOf('displayedUntimedDialogues.map'),
    );
  });

  it('renders the live playhead and keeps arrangement errors beside the selected row', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(sheet).toContain('useTimelineUi');
    expect(sheet).toContain('formatTimecode(timelineUi.currentTimeMs)');
    expect(sheet).toContain('data-testid="dialogue-untimed-playhead"');
    expect(sheet).toContain('queueError?.dialogueId === dialogue.id');
    expect(sheet).toContain('data-testid="dialogue-untimed-error"');
    expect(sheet).toContain('dialogueStore.arrange(dialogueId, integerFrameSpanMs())');
  });

  it('styles the selected row as a compact, keyboard-usable inline action surface', () => {
    const styles = source('src/renderer/styles.css');
    const issue352 = styles.slice(
      styles.indexOf('/* Issue #352:'),
      styles.indexOf('/* Issue #368:'),
    );
    const portraitScope =
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']";

    expect(issue352).toContain(portraitScope);
    expect(issue352).toContain("data-active-workspace='timeline'");
    expect(issue352).toContain(".dialogue-untimed-item[data-selected='true']");
    expect(issue352).toContain('.dialogue-untimed-action-strip');
    expect(issue352).toContain('.dialogue-untimed-cancel');
    expect(issue352).toContain('min-height: 48px;');
    expect(issue352).toContain('outline: 2px solid var(--ui-color-focus-ring);');
    expect(issue352).not.toContain("data-editor-shell-layout='landscape'");
  });
});
