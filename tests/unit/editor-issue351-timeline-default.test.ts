import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getDialogueSheetState,
  isTimedDialogue,
} from '../../src/renderer/features/dialogue/DialogueSheet';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #351 Timeline State A pending subtitles', () => {
  it('derives the explicit default state without changing timed semantics', () => {
    expect(isTimedDialogue({ startMs: 0, endMs: 1 })).toBe(true);
    expect(isTimedDialogue({ startMs: 240, endMs: 240 })).toBe(false);
    expect(
      getDialogueSheetState({
        authoringMode: 'none',
        selectedDialogueState: 'none',
      }),
    ).toBe('timeline-default');
    expect(
      getDialogueSheetState({
        authoringMode: 'batch',
        selectedDialogueState: 'none',
      }),
    ).toBe('timeline-bulk-paste-open');
    expect(
      getDialogueSheetState({
        authoringMode: 'none',
        selectedDialogueState: 'untimed',
      }),
    ).toBe('timeline-untimed-selected');
  });

  it('keeps the default work panel hierarchy and one unified authoring entry', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(sheet).toContain("'timeline-default'");
    expect(sheet).toContain('data-timeline-state={timelineState}');
    expect(sheet).toContain('data-state={timelineState}');
    expect(sheet).toContain('字幕任务');
    expect(sheet).toContain('待安排字幕');
    expect(sheet).toContain('data-testid="dialogue-untimed-count"');
    expect(sheet).toContain('这些台词还没有安排到时间轴上。');
    expect(sheet).toContain('data-testid="dialogue-authoring-open"');
    expect(sheet).toContain('<Plus');
    expect(sheet).toContain('data-testid="dialogue-authoring-tab-single"');
    expect(sheet).toContain('data-testid="dialogue-authoring-tab-batch"');
    expect(sheet).toContain('data-testid="dialogue-add"');
  });

  it('renders every pending row with speaker, copy, status and a selection affordance', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(sheet).toContain('data-testid="dialogue-untimed-item"');
    expect(sheet).toContain('dialogue-untimed-speaker');
    expect(sheet).toContain('dialogue-untimed-text');
    expect(sheet).toContain('dialogue-untimed-status');
    expect(sheet).toContain('handleSelectDialogue(dialogue.id)');
    expect(sheet).toContain('dialogue-untimed-affordance');
  });

  it('keeps the empty state and opens authoring explicitly from State A', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(sheet).toContain('暂无待安排字幕');
    expect(sheet).toContain('timeline-subtitle-empty');
    expect(sheet).toContain("authoringMode === 'none' ? (");
    expect(sheet).toContain("handleOpenAuthoring('single')");
    expect(sheet).not.toContain('<details');
  });

  it('limits the visual redesign to Cloud Touch portrait Timeline and preserves touch targets', () => {
    const styles = source('src/renderer/styles.css');
    const issue351 = styles.slice(styles.indexOf('/* Issue #351:'));
    const portraitScope =
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']";

    expect(issue351).toContain(portraitScope);
    expect(issue351).toContain("data-active-workspace='timeline'");
    expect(issue351).toContain('.dialogue-untimed-queue');
    expect(issue351).toContain('.dialogue-untimed-arrange');
    expect(issue351).toContain('min-height: 48px;');
    expect(issue351).toContain('grid-template-columns: minmax(60px, 0.45fr)');
    expect(issue351).not.toContain("data-editor-shell-layout='landscape'");
  });
});
