import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isHorizontalPendingTrayGesture,
  isPendingDialoguePlacementGesture,
  isPointInsidePendingDropTarget,
  mapPendingDropXToStartMs,
} from '../../src/renderer/features/timeline/pendingDialogueDrag';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function issue381Styles(styles: string): string {
  const start = styles.lastIndexOf('/* Issue #381:');
  if (start < 0) throw new Error('Issue #381 styles are missing');
  return styles.slice(start);
}

describe('Issue #381 Cloud Touch landscape Pending subtitle drag-to-place', () => {
  it('separates tray swipe, tap, and deliberate upward placement intent', () => {
    expect(isHorizontalPendingTrayGesture(0, 0, 7, 0)).toBe(false);
    expect(isHorizontalPendingTrayGesture(0, 0, 8, 1)).toBe(true);
    expect(isHorizontalPendingTrayGesture(0, 0, 20, 18)).toBe(true);
    expect(isPendingDialoguePlacementGesture(0, 0, 0, -9)).toBe(false);
    expect(isPendingDialoguePlacementGesture(0, 0, 0, -10)).toBe(true);
    expect(isPendingDialoguePlacementGesture(0, 0, 4, -12)).toBe(true);
    expect(isPendingDialoguePlacementGesture(0, 0, 12, -12)).toBe(false);
    expect(isPendingDialoguePlacementGesture(0, 0, 0, 10)).toBe(false);
  });

  it('maps client X through the existing lane geometry at zoom and scroll positions', () => {
    expect(mapPendingDropXToStartMs(100, 100, 0.2, 3000)).toBe(0);
    expect(mapPendingDropXToStartMs(200, 100, 0.2, 3000)).toBe(500);
    // A scrolled lane has a different client-space left edge, but the same
    // local X maps to the same Timeline time.
    expect(mapPendingDropXToStartMs(50, -150, 0.4, 3000)).toBe(500);
    expect(mapPendingDropXToStartMs(-100, 100, 0.2, 3000)).toBe(0);
    expect(mapPendingDropXToStartMs(9999, 100, 0.2, 3000)).toBe(3000);
  });

  it('uses only the Subtitle lane rectangle as the valid target geometry', () => {
    const rect = { left: 100, right: 700, top: 20, bottom: 54 };
    expect(isPointInsidePendingDropTarget(120, 30, rect)).toBe(true);
    expect(isPointInsidePendingDropTarget(120, 70, rect)).toBe(false);
    expect(isPointInsidePendingDropTarget(80, 30, rect)).toBe(false);
  });

  it('keeps the single Timeline/task/dialogue owners and commits only through arrange', () => {
    const timeline = source(
      'src/renderer/features/timeline/TimelineDock.tsx',
    );
    const sheet = source(
      'src/renderer/features/dialogue/DialogueSheet.tsx',
    );
    const store = source('src/renderer/stores/dialogueStore.ts');
    const service = source('src/domain/services/DialogueService.ts');

    expect(timeline).toContain('pendingTrayInteraction');
    expect(timeline).toContain('setPointerCapture(pointer.pointerId)');
    expect(timeline).toContain('pending-dialogue-drag-ghost');
    expect(timeline).toContain('pending-dialogue-drop-marker');
    expect(timeline).toContain('data-pending-drop-surface="subtitle"');
    expect(timeline).toContain("pendingDrag ? 'not-allowed' : undefined");
    expect(timeline).toContain('dialogueStore.previewArrange');
    expect(timeline).toContain('dialogueStore.arrange(');
    expect(timeline).toContain('integerFrameSpanMs()');
    expect(timeline).toContain('event.preventDefault()');
    expect(timeline).toContain('event.stopPropagation()');
    expect(timeline).toContain("event.key !== 'Escape'");
    expect(timeline).not.toContain('draggable=');
    expect(timeline).not.toContain('updateProject');
    expect(timeline).not.toContain('historyStore');

    expect(sheet).toContain('PendingTrayInteractionController');
    expect(sheet).toContain('data-pending-card-select="true"');
    expect(sheet).toContain('pendingTrayInteraction.onPointerMove(event)');
    expect(sheet).toContain('onPointerCancel={handlePendingTrayPointerCancel}');
    expect(store).toContain('previewArrange(');
    expect(store).toContain('getArrangementTiming');
    expect(service).toContain('startMs?: number');
    expect(service).toContain('getArrangementTiming(');
  });

  it('renders one transient ghost/preview and scopes all Stage D CSS to landscape', () => {
    const styles = issue381Styles(source('src/renderer/styles.css'));
    const landscapeScope =
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']";

    expect(styles).toContain(landscapeScope);
    expect(styles).toContain('.timeline-pending-drag-layer');
    expect(styles).toContain('.pending-dialogue-drag-ghost');
    expect(styles).toContain('pointer-events: none;');
    expect(styles).toContain("data-pending-drop-target='valid'");
    expect(styles).toContain("data-pending-drop-target='invalid'");
    expect(styles).toContain('.pending-dialogue-drop-preview');
    expect(styles).toContain('border: 1px dashed');
    expect(styles).not.toContain("data-editor-shell-layout='portrait'");
    expect(styles).not.toContain("data-editor-shell-layout='desktop'");
  });

  it('retains the fallback and keeps transient preview state out of Project/History', () => {
    const sheet = source(
      'src/renderer/features/dialogue/DialogueSheet.tsx',
    );
    const timeline = source(
      'src/renderer/features/timeline/TimelineDock.tsx',
    );

    expect(sheet).toContain('data-testid="dialogue-untimed-arrange"');
    expect(sheet).toContain(
      'dialogueStore.arrange(dialogueId, integerFrameSpanMs())',
    );
    expect(timeline).toContain('clearPendingDrag(!validDrop)');
    expect(timeline).toContain('if (!active || !validDrop');
    expect(timeline).toContain('sourceElement');
  });
});
