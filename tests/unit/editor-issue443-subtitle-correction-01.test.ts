import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function sliceSection(haystack: string, startMarker: string, endMarker?: string): string {
  const start = haystack.indexOf(startMarker);
  if (start < 0) throw new Error(`start not found: ${startMarker}`);
  if (!endMarker) return haystack.slice(start);
  const end = haystack.indexOf(endMarker, start);
  return haystack.slice(start, end < 0 ? undefined : end);
}

describe('Issue #443 Subtitle UI Correction 01 — pending list inline selection', () => {
  const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
  const actionRow = sliceSection(
    sheet,
    'data-testid="dialogue-untimed-action-strip"',
    'queueError?.dialogueId === dialogue.id',
  );

  it('renders the persistent beginner-friendly heading on both Timeline and Right Workspace', () => {
    // # 01-A. Persistent list heading. The heading stays visible after
    // selecting a pending subtitle so the user never feels they left the
    // basket.
    expect(sheet).toContain('未加入时间轴');
    expect(sheet).not.toContain('待安排字幕 {'); // legacy "待安排字幕 {N}条" form
    expect(sheet).not.toContain('6条字幕');
    expect(sheet).not.toContain('待上轴');
    // The pending count is preserved for downstream consumers.
    expect(sheet).toContain('data-testid="dialogue-untimed-count"');
  });

  it('keeps the pending list as ONE continuous basket — no list-collapse on selection', () => {
    // # 01-B. Selecting a card must NOT enter a visible subpage. The list
    // stays visible; the selected card gets an inline action row.
    expect(sheet).toContain(
      'const displayedUntimedDialogues = untimedDialogues;',
    );
    expect(sheet).not.toContain(
      'unifiedTaskTray && !rightWorkspace && selectedUntimedDialogue',
    );
  });

  it('removes the visible "返回待安排字幕" subpage affordance for the pending list', () => {
    // # 01-B. There is nothing to "return" from. The legacy header
    // back-to-pending-list button is gone; the timed Properties inspector
    // keeps its own back affordance, which is a different flow.
    const untimedHeaderReturn = /unifiedTaskTray\s*&&\s*selectedUntimedDialogue[\s\S]{0,400}返回待安排字幕/u;
    expect(sheet).not.toMatch(untimedHeaderReturn);
  });

  it('does NOT surface the Timeline 当前播放头 on the selected pending card', () => {
    // # 01-C. Subtitle Workspace = what has not been added / what can be
    // arranged. Timeline = when content happens. The selected card must
    // not present the playhead as a control row.
    expect(actionRow).not.toContain('当前播放头');
    expect(actionRow).not.toContain('data-testid="dialogue-untimed-playhead"');
    expect(actionRow).not.toContain('dialogue-untimed-action-meta');
  });

  it('removes the repeated drag-grip "可拖动" text label and the selected ✓ chrome', () => {
    // # 01-D. Normal cards: grip only, no repeated "可拖动" label.
    // # 01-E. remove the redundant visible selected ✓ checkmark.
    expect(sheet).not.toContain('dialogue-untimed-affordance-label');
    expect(sheet).not.toContain('>可拖动<');
    expect(sheet).not.toMatch(
      /rightWorkspace[\s\S]{0,400}'✓'/u,
    );
    // The affordance is still semantic — keeps `data-affordance` for
    // CSS/test targeting — but always renders the grip icon in
    // rightWorkspace, never a text label.
    const affordance = sliceSection(
      sheet,
      'className="dialogue-untimed-affordance"',
      '</span>',
    );
    expect(affordance).toMatch(/<GripVertical size=\{14\} \/>/u);
  });

  it('selected card is a modest inline expansion with the approved action row', () => {
    // # 01-E / # 01-F. Final target: 可手动拖入 + 自动加入. No
    // 取消选择 subpage affordance; selection is selection, not navigation.
    expect(actionRow).toContain('data-testid="dialogue-untimed-action-strip"');
    expect(actionRow).toContain('data-testid="dialogue-untimed-action-hint"');
    expect(actionRow).toContain('可手动拖入');
    expect(actionRow).toContain('data-testid="dialogue-untimed-arrange"');
    expect(actionRow).toContain('自动加入');
    expect(actionRow).not.toContain('data-testid="dialogue-untimed-cancel"');
    expect(actionRow).not.toContain('取消选择');
    expect(actionRow).not.toContain('安排一帧');
  });

  it('preserves the existing explicit drag semantics and the first-legal-gap auto-add', () => {
    // # 01-G. Visual correction must not merge the two behaviours.
    // 自动加入 still routes through the no-explicit-start / first-legal-gap
    // path; manual drag is preserved through the existing handlers.
    expect(sheet).toContain(
      'dialogueStore.arrange(dialogueId, integerFrameSpanMs())',
    );
    expect(sheet).toContain('data-testid="dialogue-untimed-arrange"');
    expect(sheet).toContain('onClick={() => handleArrange(dialogue.id)}');
    // Drag wiring (mouse/touch) remains routed through the existing
    // PendingTrayInteractionController + handlePendingTrayPointerDown.
    expect(sheet).toContain('PendingTrayInteractionController');
    expect(sheet).toContain('handlePendingTrayPointerDown');
    expect(sheet).toContain('handlePendingTrayPointerMove');
    expect(sheet).toContain('handlePendingTrayPointerUp');
    expect(sheet).toContain('handlePendingTrayClickCapture');
    expect(sheet).toContain('data-pending-card-select="true"');
    // The selected card is still the touch entry point — selecting a card
    // does not initiate drag.
    expect(sheet).toContain('onClick={() => handleSelectDialogue(dialogue.id)}');
  });

  it('selection alone causes no Project/History mutation and introduces no second owner', () => {
    // # 01-D + # Hard-stops. handleSelectDialogue only toggles the
    // selection store; it does not touch the Project, History, or the
    // Timeline. There is no new selection/store/Timeline owner.
    expect(sheet).toContain('dialogueSelectionStore.toggle(dialogueId);');
    expect(sheet).not.toContain('updateProject');
    expect(sheet).not.toContain('historyStore');
    expect(sheet).not.toContain('new DialogueStore');
    expect(sheet).not.toContain('new DialogueSelectionStore');
    expect(sheet).not.toContain('new PendingTray');
  });

  it('keeps the queue error feedback inline and the empty footer reachable', () => {
    // # 01-H. Touch / drag interaction. Selecting does not mutate;
    // 安排一帧 errors stay readable beside the selected card; the
    // + 新建字幕 footer remains reachable.
    expect(sheet).toContain('data-testid="dialogue-untimed-error"');
    expect(sheet).toContain('data-testid="dialogue-pending-queue-create"');
    expect(sheet).toContain('data-testid="dialogue-pending-queue-footer"');
    expect(sheet).toContain('handleOpenAuthoring(\'single\')');
  });

  it('hard-stops OUT-OF-SCOPE work from this Issue', () => {
    // # Hard-stops. Correction 02 / 03 work does NOT enter this slice.
    // No DialogueService / first-legal-gap / Timeline DnD semantic change.
    const service = source('src/domain/services/DialogueService.ts');
    expect(sheet).not.toContain('DialogueService changes');
    expect(sheet).not.toContain('first-legal-gap');
    // The existing arrangement API call signature is preserved (no new
    // explicit-start contract; the same integerFrameSpanMs() path is
    // reused as the no-explicit-start / first-legal-gap route).
    expect(sheet).toContain('integerFrameSpanMs()');
    expect(service).toContain('arrange(');
  });

  it('styles the inline action row locally and only touches the selected card surface', () => {
    const styles = source('src/renderer/styles.css');
    const start = styles.indexOf('/* Issue #443 Correction 01:');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = styles.slice(start);
    // Local additions scoped to the cloud-touch shell.
    expect(block).toContain('.dialogue-untimed-action-info');
    expect(block).toContain('.dialogue-untimed-action-hint');
    expect(block).toContain(
      "[data-editor-device-mode='cloud-touch']",
    );
    // No repo-wide CSS cleanup. The new block stays additive and scoped.
    expect(block).not.toMatch(/\.editor-layout\s*\{/u);
    expect(block).not.toMatch(/\.editor-body\s*\{/u);
    // Legacy drag-affordance label rule is removed alongside the markup
    // that referenced it; the affordance now relies on the grip icon
    // alone.
    expect(styles).not.toContain('.dialogue-untimed-cancel');
  });
});
