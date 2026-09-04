import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isTimedDialogue } from '../../src/renderer/features/dialogue/DialogueSheet';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #339 portrait Timeline subtitle task surface', () => {
  it('uses one Timeline owner with presentation-only lane density', () => {
    const timeline = source(
      'src/renderer/features/timeline/TimelineDock.tsx',
    );
    const right = source('src/renderer/shell/RightWorkspace.tsx');

    expect(timeline).toContain('timelineUiStore.seek');
    expect(timeline).toContain('<DialogueClip');
    expect(timeline).not.toContain('<DialogueSheet');
    expect(right).toContain('<DialogueSheet');
    expect(timeline).toContain('data-audio-state=');
    expect(timeline).toContain('laneLabelWidth');
    expect(timeline).toContain('--timeline-lane-label-width');
    expect(timeline).toContain('aria-label={ui.expanded ?');
    expect(timeline).not.toContain('updateProject');
  });

  it('derives the three subtitle states from the existing selection and timing values', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(isTimedDialogue({ startMs: 0, endMs: 1 })).toBe(true);
    expect(isTimedDialogue({ startMs: 240, endMs: 240 })).toBe(false);
    expect(sheet).toContain('selectedTimedDialogue');
    expect(sheet).toContain('untimedDialogues');
    expect(sheet).toContain('data-subtitle-state={subtitleState}');
    expect(sheet).toContain('data-testid="timeline-subtitle-queue"');
    expect(sheet).toContain('data-testid="timeline-subtitle-empty"');
    expect(sheet).toContain('这些台词还没有安排到时间轴上。');
    expect(sheet).not.toContain('其他字幕工具');
    expect(sheet).not.toContain('className="dialogue-list"');
    expect(sheet).not.toContain('寻找最近空位');
  });

  it('keeps the existing dialogue editing, authoring and arrangement owners reachable', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const inspector = source(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
    );

    expect(sheet).toContain('<DialogueInspector');
    expect(sheet).toContain('presentation="timeline"');
    expect(sheet).toContain('dialogueSelectionStore.toggle');
    expect(sheet).toContain('dialogueStore.arrange');
    expect(sheet).toContain('DialogueBatchPaste');
    expect(sheet).toContain('new DialogueAuthoringDraft');
    expect(sheet).toContain('data-testid="dialogue-authoring-open"');
    expect(sheet).toContain('data-testid="dialogue-authoring-tab-batch"');
    expect(sheet).toContain('data-testid="dialogue-add"');
    expect(inspector).toContain("'properties'");
    expect(inspector).toContain("'inspector'");
    expect(inspector).toContain('dialogueStore.update');
    expect(inspector).toContain('dialogueStore.setTiming');
    expect(inspector).toContain('dialogue-inspector-audio-section');
    expect(inspector).toContain('dialogue-inspector-delete');
  });

  it('scopes the flatter portrait hierarchy and compact empty audio lane', () => {
    const styles = source('src/renderer/styles.css');
    const portraitScope =
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']";
    const issue339 = styles.slice(styles.indexOf('/* Issue #339:'));

    expect(issue339).toContain(portraitScope);
    expect(issue339).toContain('.timeline-audio-lane.is-empty');
    expect(issue339).toContain('.timeline-audio-lane.has-clips');
    expect(issue339).toContain('.dialogue-untimed-queue');
    expect(styles).toContain('.dialogue-authoring-shell');
    expect(issue339).toContain('.timeline-subtitle-empty');
    expect(issue339).toContain('border: 0;');
  });
});
