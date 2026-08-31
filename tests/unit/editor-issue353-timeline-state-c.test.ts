import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getDialogueSheetState,
} from '../../src/renderer/features/dialogue/DialogueSheet';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #353 portrait Timeline State C', () => {
  it('enters State C only for a selected Timed dialogue with authoring tools closed', () => {
    expect(
      getDialogueSheetState({
        selectedDialogueState: 'timed',
        authoringMode: 'none',
      }),
    ).toBe('timeline-timed-selected');

    expect(
      getDialogueSheetState({
        selectedDialogueState: 'timed',
        authoringMode: 'batch',
      }),
    ).toBe('timeline-bulk-paste-open');

    expect(
      getDialogueSheetState({
        selectedDialogueState: 'timed',
        authoringMode: 'single',
      }),
    ).toBe('timeline-single-add-open');

    expect(
      getDialogueSheetState({
        selectedDialogueState: 'untimed',
        authoringMode: 'none',
      }),
    ).toBe('timeline-untimed-selected');
  });

  it('renders the precision editor in product priority order', () => {
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const start = inspector.indexOf('if (timelinePresentation)');
    const end = inspector.indexOf('if (landscapePresentation)', start);
    const timeline = inspector.slice(start, end);

    expect(timeline).toContain('当前字幕');
    expect(timeline).toContain('data-testid="dialogue-inspector-speaker-name"');
    expect(timeline).toContain('data-timed={String(timed)}');
    expect(timeline).toContain('data-testid="dialogue-inspector-copy-section"');
    expect(timeline).toContain('data-testid="dialogue-inspector-time-section"');
    expect(timeline).toContain('data-testid="dialogue-inspector-speaker-section"');
    expect(timeline).toContain('data-testid="dialogue-inspector-audio-section"');
    expect(timeline).toContain('data-testid="dialogue-inspector-delete"');

    expect(
      timeline.indexOf('data-testid="dialogue-inspector-copy-section"'),
    ).toBeLessThan(
      timeline.indexOf('data-testid="dialogue-inspector-time-section"'),
    );
    expect(
      timeline.indexOf('data-testid="dialogue-inspector-time-section"'),
    ).toBeLessThan(
      timeline.indexOf('data-testid="dialogue-inspector-speaker-section"'),
    );
    expect(
      timeline.indexOf('data-testid="dialogue-inspector-speaker-section"'),
    ).toBeLessThan(
      timeline.indexOf('data-testid="dialogue-inspector-audio-section"'),
    );
    expect(
      timeline.indexOf('data-testid="dialogue-inspector-audio-section"'),
    ).toBeLessThan(timeline.indexOf('data-testid="dialogue-inspector-delete"'));
  });

  it('keeps existing text, timing, speaker, audio and delete owners', () => {
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(inspector).toContain('dialogueStore.update');
    expect(inspector).toContain('dialogueStore.setTiming');
    expect(inspector).toContain('dialogueStore.remove');
    expect(inspector).toContain('data-testid="dialogue-inspector-apply-timing"');
    expect(inspector).toContain('disabled={!timingInputValid}');
    expect(inspector).toContain("error?.scope === 'timing'");
    expect(inspector).toContain("error?.scope === 'text'");
    expect(inspector).toContain("error?.scope === 'speaker'");
    expect(sheet).toContain(
      "const showTimedEditor = timelineState === 'timeline-timed-selected'",
    );
    expect(sheet).toContain('dialogueSelectionStore.toggle');
    expect(sheet).toContain('dialogueStore.arrange');
  });

  it('uses one flat portrait surface without an internal scroll owner', () => {
    const styles = source('src/renderer/styles.css');
    const issue353Start = styles.indexOf('/* Issue #353:');
    const issue353End = styles.indexOf('/* Issue #358:', issue353Start);
    const issue353 = styles.slice(
      issue353Start,
      issue353End < 0 ? undefined : issue353End,
    );
    const portraitScope =
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']";

    expect(issue353).toContain(portraitScope);
    expect(issue353).toContain('.dialogue-timeline-apply-timing');
    expect(issue353).toContain('.dialogue-inspector-timeline');
    expect(issue353).toContain('.dialogue-timing-footer');
    expect(issue353).toContain('.dialogue-editor-error');
    expect(issue353).toContain('.dialogue-delete');
    expect(issue353).not.toContain('overflow-y');
    expect(issue353).not.toContain('overflow: auto');
  });
});
