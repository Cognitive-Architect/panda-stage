import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isHorizontalPendingTrayGesture,
} from '../../src/renderer/features/dialogue/DialogueSheet';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function issue380Styles(styles: string): string {
  const start = styles.lastIndexOf('/* Issue #380:');
  if (start < 0) throw new Error('Issue #380 styles are missing');
  return styles.slice(start);
}

describe('Issue #380 Cloud Touch landscape Pending Subtitle Tray', () => {
  const sheet = source(
    'src/renderer/features/dialogue/DialogueSheet.tsx',
  );
  const styles = issue380Styles(source('src/renderer/styles.css'));

  it('marks the existing DialogueSheet queue as the compact Pending Tray', () => {
    expect(sheet).toContain(
      'className="timeline-subtitle-queue timeline-pending-tray"',
    );
    expect(sheet).toContain('data-pending-count={untimedDialogues.length}');
    expect(sheet).toContain('data-pending-tray="true"');
    expect(sheet).toContain('data-testid="dialogue-pending-tray-list"');
    expect(sheet).toContain('aria-label="待安排字幕列表"');
    expect(sheet).toContain('data-pending-card="true"');
    expect(sheet).toContain('dialogue-pending-card-select');
    expect(sheet).toContain('data-testid="dialogue-untimed-count"');
    expect(sheet).toContain('data-testid="dialogue-authoring-open"');

    const header = sheet.indexOf('className={`dialogue-sheet-header');
    const tray = sheet.indexOf('timeline-pending-tray');
    expect(header).toBeGreaterThanOrEqual(0);
    expect(tray).toBeGreaterThan(header);
  });

  it('keeps cards in one compact horizontal row with readable scan content', () => {
    expect(styles).toContain('.dialogue-pending-tray-list');
    expect(styles).toMatch(
      /\.dialogue-pending-tray-list[\s\S]*?display: flex;[\s\S]*?overflow-x: auto;/u,
    );
    expect(styles).toContain('touch-action: pan-x;');
    expect(styles).toMatch(
      /\.dialogue-pending-card[\s\S]*?flex: 0 0 clamp\(200px, 24vw, 264px\);/u,
    );
    expect(styles).toContain('min-height: 76px;');
    expect(styles).toMatch(
      /\.dialogue-untimed-text[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/u,
    );
    expect(styles).toMatch(
      /\.dialogue-untimed-status[\s\S]*?display: none;/u,
    );
    expect(styles).not.toContain("data-editor-shell-layout='portrait'");
    expect(styles).not.toContain("data-editor-shell-layout='desktop'");
  });

  it('uses a tray-local horizontal gesture threshold without starting Stage D', () => {
    expect(isHorizontalPendingTrayGesture(0, 0, 7, 0)).toBe(false);
    expect(isHorizontalPendingTrayGesture(0, 0, 8, 1)).toBe(true);
    expect(isHorizontalPendingTrayGesture(0, 0, 20, 18)).toBe(true);
    expect(isHorizontalPendingTrayGesture(0, 0, 18, 20)).toBe(false);
    expect(sheet).toContain('onClickCapture={handlePendingTrayClickCapture}');
    expect(sheet).toContain('onPointerCancel={handlePendingTrayPointerCancel}');
    expect(sheet).toContain("data-editor-device-mode='cloud-touch'");
    expect(sheet).toContain("data-editor-shell-layout='landscape'");
    expect(sheet).not.toMatch(/dragGhost|dropTarget|draggable=/iu);
    expect(sheet).not.toContain('updateProject');
    expect(sheet).not.toContain('historyStore');
  });

  it('keeps the existing selection, fallback arrangement and authoring owners', () => {
    expect(sheet).toContain('handleSelectDialogue(dialogue.id)');
    expect(sheet).toContain('dialogueSelectionStore.toggle(dialogueId);');
    expect(sheet).toContain('data-testid="dialogue-untimed-arrange"');
    expect(sheet).toContain('dialogueStore.arrange(dialogueId, integerFrameSpanMs())');
    expect(sheet).toContain('data-testid="dialogue-authoring-open"');
    expect(sheet).toContain('data-testid="dialogue-authoring-shell"');
    expect(sheet).toContain('data-testid="timeline-subtitle-empty"');
  });

  it('keeps the empty state compact while leaving the add action in the header', () => {
    expect(styles).toMatch(
      /\.timeline-subtitle-empty[\s\S]*?min-height: 48px;[\s\S]*?border-top: 0;/u,
    );
    expect(styles).toMatch(
      /\.timeline-subtitle-empty[\s\S]*?span[\s\S]*?display: none;/u,
    );
    expect(sheet).toContain("handleOpenAuthoring('single')");
  });
});
