import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getDialogueTaskTrayState,
  type DialogueAuthoringMode,
  type DialogueSelectionState,
} from '../../src/renderer/features/dialogue/DialogueSheet';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function state(
  authoringMode: DialogueAuthoringMode,
  selectedDialogueState: DialogueSelectionState,
  pendingCount: number,
): string {
  return getDialogueTaskTrayState({
    authoringMode,
    selectedDialogueState,
    pendingCount,
  });
}

describe('Issue #382 Cloud Touch landscape unified Task Tray', () => {
  it('derives all six states with authoring and selection precedence', () => {
    expect(state('none', 'none', 3)).toBe('pending');
    expect(state('none', 'untimed', 3)).toBe('untimed-selected');
    expect(state('none', 'timed', 3)).toBe('timed-selected');
    expect(state('single', 'timed', 3)).toBe('single-add');
    expect(state('batch', 'untimed', 3)).toBe('batch-paste');
    expect(state('none', 'none', 0)).toBe('empty');
    expect(state('none', 'timed', 0)).toBe('timed-selected');
  });

  it('renders authoring, timed, pending and empty as mutually exclusive bodies', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const timeline = source(
      'src/renderer/features/timeline/TimelineDock.tsx',
    );

    expect(sheet).toContain('data-task-tray-state={taskTrayState}');
    expect(sheet).toContain('dialogue-task-body-authoring');
    expect(sheet).toContain('dialogue-task-body-timed');
    expect(sheet).toContain('data-task-body={taskTrayState}');
    expect(sheet).toContain('dialogue-task-body-empty');
    expect(sheet).toContain("authoringMode !== 'none' ? null");
    expect(sheet).toContain('displayedUntimedDialogues.map');
    expect(sheet).toContain('focusDefaultTaskControl');
    expect(sheet).toContain('nextControl?.focus()');
    expect(sheet).toContain('candidate.getClientRects().length > 0');
    expect(sheet).toContain('window.setTimeout(() =>');
    expect(sheet).toContain('TASK_TRAY_FOCUS_DELAY_MS = 180');
    expect(timeline).toContain(
      "unifiedTaskTray={presentation === 'landscape'}",
    );
  });

  it('keeps Stage E derivation presentation-only and reuses existing owners', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(sheet).toContain('dialogueSelectionStore.toggle(dialogueId)');
    expect(sheet).toContain('new DialogueAuthoringDraft()');
    expect(sheet).toContain('dialogueStore.arrange(');
    expect(sheet).not.toContain('taskTrayStore');
    expect(sheet).not.toContain('updateProject');
    expect(sheet).not.toContain('HistoryStore');
  });

  it('bounds long task content within Cloud Touch landscape only', () => {
    const styles = source('src/renderer/styles.css');
    const start = styles.lastIndexOf('/* Issue #382:');
    const stageE = styles.slice(start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(stageE).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']",
    );
    expect(stageE).toContain('.dialogue-task-body-timed');
    expect(stageE).toContain('.dialogue-task-body-authoring');
    expect(stageE).toContain('overflow-y: auto;');
    expect(stageE).toContain('max-height: 148px;');
    expect(stageE).toContain(
      '@container stage-e-timeline (max-height: 220px)',
    );
    expect(stageE).toContain('flex: 0 0 44px;');
    expect(stageE).not.toContain("data-editor-shell-layout='portrait'");
    expect(stageE).not.toContain("data-editor-shell-layout='desktop'");
  });
});
