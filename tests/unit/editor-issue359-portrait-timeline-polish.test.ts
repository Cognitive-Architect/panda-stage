import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #359 portrait Timeline polish', () => {
  it('uses restrained Lucide treatment on Timeline semantics while retaining labels', () => {
    const timeline = source(
      'src/renderer/features/timeline/TimelineDock.tsx',
    );
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    for (const icon of [
      'ChevronDown',
      'ChevronUp',
      'Clock3',
      'MessageSquareText',
      'Volume2',
      'ZoomIn',
      'ZoomOut',
    ]) {
      expect(timeline).toContain(`<${icon}`);
    }
    expect(timeline).toContain('timeline-lane-label-text');
    expect(timeline).toContain('data-testid="timeline-zoom-in"');
    expect(timeline).toContain('data-testid="timeline-zoom-out"');
    expect(timeline).toContain('data-testid="timeline-collapse"');
    expect(sheet).toContain('<ArrowLeft');
    expect(sheet).toContain('<Plus');
    expect(sheet).toContain('data-testid="dialogue-authoring-open"');
  });

  it('toggles the existing dialogue selection only for a genuine click', () => {
    const clip = source('src/renderer/features/timeline/DialogueClip.tsx');
    const gesture = source(
      'src/renderer/features/timeline/dialogueGesture.ts',
    );
    const selectionStore = source(
      'src/renderer/stores/dialogueSelectionStore.ts',
    );
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(clip).toContain('dialogueSelectionStore.select(dialogue.id);');
    expect(clip).toContain('dialogueSelectionStore.toggle(dialogue.id);');
    expect(clip).toContain('shouldClearDialogueSelectionOnClick');
    expect(clip).toContain('hasDialogueGestureMoved');
    expect(clip).toContain('didMove');
    expect(clip).toContain('markPointerClickHandled');
    expect(gesture).toContain('DIALOGUE_DRAG_THRESHOLD_PX');
    expect(selectionStore).toContain('toggle(dialogueId: string)');
    expect(sheet).toContain('dialogueSelectionStore.toggle(dialogueId);');
    expect(clip).not.toMatch(
      /onClick=\{\(event\) => \{[\s\S]*?dialogueSelectionStore\.select\(dialogue\.id\)/u,
    );
  });

  it('keeps timed geometry intact and scopes compact rows to portrait Timeline', () => {
    const clip = source('src/renderer/features/timeline/DialogueClip.tsx');
    const timeline = source(
      'src/renderer/features/timeline/TimelineDock.tsx',
    );
    const styles = source('src/renderer/styles.css');
    const issue359 = styles.slice(styles.indexOf('/* Issue #359:'));
    const portraitScope =
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='portrait']";

    expect(clip).toContain('timeToPx(displayedEndMs - displayedStartMs');
    expect(timeline).toContain('data-duration={durationMs}');
    expect(issue359).toContain(portraitScope);
    expect(issue359).toContain("data-active-workspace='timeline'");
    expect(issue359).toContain("min-height: 56px;");
    expect(issue359).toContain("min-height: 60px;");
    expect(issue359).toContain('text-overflow: ellipsis;');
    expect(issue359).not.toContain("data-editor-shell-layout='landscape'");
  });
});
