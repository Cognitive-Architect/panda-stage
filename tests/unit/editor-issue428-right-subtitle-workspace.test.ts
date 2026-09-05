import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #428 Right Subtitle Workspace R2', () => {
  it('mounts one transient placement coordinator across the sibling workspaces', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const placement = source(
      'src/renderer/features/timeline/PendingDialoguePlacement.tsx',
    );

    expect(shell.match(/<PendingDialoguePlacementProvider>/gu)).toHaveLength(1);
    expect(shell.indexOf('<PendingDialoguePlacementProvider>')).toBeLessThan(
      shell.indexOf('className="editor-body"'),
    );
    expect(shell.indexOf('</PendingDialoguePlacementProvider>')).toBeGreaterThan(
      shell.indexOf('<BottomWorkspace'),
    );
    expect(placement).toContain('createContext<PendingDialoguePlacementContextValue');
    expect(placement).toContain('dialogueStore.previewArrange(');
    expect(placement).toContain('dialogueStore.arrange(');
    expect(placement).toContain('integerFrameSpanMs()');
    expect(placement).toContain('active.projectRoot !==');
    expect(placement).toContain('active.shotId !== currentShotId');
    expect(placement).toContain("'any-direction'");
    expect(placement).not.toContain('updateProject');
    expect(placement).not.toContain('HistoryStore');
  });

  it('presents the existing DialogueSheet in the Right Workspace', () => {
    const right = source('src/renderer/shell/RightWorkspace.tsx');
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(right).toContain('<DialogueSheet');
    expect(right).toContain('presentation="right-workspace"');
    expect(right).toContain('pendingTrayInteraction={pendingPlacement.interaction}');
    expect(sheet).toContain("presentation?: 'timeline' | 'right-workspace'");
    expect(sheet).toContain("!rightWorkspace && selectedTimedDialogue");
    expect(sheet).toContain('创建后进入待安排队列，不会自动定时。');
    expect(sheet).toContain('data-testid="subtitle-workspace-empty-action"');
    expect(sheet).toContain('src="/subtitle-empty-state.png"');
    expect(sheet).toContain('aria-hidden="true"');
    // Issue #430 P-01 tightens the card grip to size 14 to better match the
    // "可拖动" affordance label; size 16 is the original default that was used
    // before this polish pass.
    expect(sheet).toMatch(/<GripVertical size=\{14\} \/>/u);
  });

  it('leaves only timeline chrome and tracks in the Bottom Workspace', () => {
    const timeline = source('src/renderer/features/timeline/TimelineDock.tsx');
    const bottom = source('src/renderer/shell/BottomWorkspace.tsx');

    expect(timeline).toContain('data-timeline-layer="toolbar"');
    expect(timeline).toContain('data-timeline-layer="ruler"');
    expect(timeline).toContain('data-track-kind="subtitle"');
    expect(timeline).toContain('data-track-kind="audio"');
    expect(timeline).toContain('registerDropTarget({ element, durationMs, pixelsPerMs })');
    expect(timeline).not.toContain('<DialogueSheet');
    expect(timeline).not.toContain('timeline-task-tray');
    expect(bottom).not.toContain('data-timeline-task-tray-density');
  });

  it('bounds the queue and authoring content inside the right surface', () => {
    const styles = source('src/renderer/styles.css');
    const start = styles.indexOf('/* Issue #428 R2:');
    const r2 = styles.slice(start, styles.indexOf('@media (max-width: 1050px)', start));

    expect(start).toBeGreaterThanOrEqual(0);
    expect(r2).toContain('.dialogue-sheet-right-workspace');
    expect(r2).toContain('.dialogue-untimed-queue');
    expect(r2).toContain('.dialogue-authoring-shell');
    expect(r2).toContain('overflow-y: auto;');
    expect(r2).toContain('overscroll-behavior: contain;');
    expect(r2).not.toContain('.editor-layout {');
    expect(r2).not.toContain('.editor-body {');
  });
});
