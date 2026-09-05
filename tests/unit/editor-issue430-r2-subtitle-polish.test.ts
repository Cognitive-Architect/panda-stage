import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #430 R2 Subtitle Workspace polish P-01 / P-02 / P-03', () => {
  it('P-01: replaces the right-rail DEFAULT_PENDING header copy', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const styles = source('src/renderer/styles.css');

    // The right-rail default header must use the formal subtitle drawer
    // header (icon + 字幕 + Close ×) and not show the redundant
    // "右侧工作区" eyebrow or the "这些台词还没有安排到时间轴上。"
    // queue intro.
    expect(sheet).toContain('dialogue-drawer-header');
    expect(sheet).toContain('MessageCircleMore');
    expect(sheet).toContain('dialogue-drawer-title');
    expect(sheet).not.toMatch(
      /rightWorkspace \? '右侧工作区'/u,
    );
    expect(sheet).not.toMatch(
      /rightWorkspace\s*\?\s*\(\s*<p[^>]*>\s*这些台词还没有安排到时间轴上/u,
    );

    // "待安排字幕 N 条" is promoted to the pending queue section heading.
    expect(sheet).toContain('dialogue-pending-queue-heading');
    expect(sheet).toContain('data-testid="dialogue-pending-queue-heading"');

    // "未定时" must not render on each card; the affordance reads "可拖动".
    expect(sheet).toMatch(
      /rightWorkspace\s*\?\s*null\s*:\s*\(\s*<span className="dialogue-untimed-status">\s*未定时/u,
    );
    expect(sheet).toContain('可拖动');
    expect(sheet).toContain('dialogue-untimed-affordance-label');

    // "+ 新建字幕" lives at the bottom of the queue, not in the header.
    expect(sheet).toContain('data-testid="dialogue-pending-queue-create"');
    expect(sheet).toContain('data-testid="dialogue-pending-queue-footer"');
    expect(styles).toContain('.dialogue-pending-queue-heading');
    expect(styles).toContain('.dialogue-pending-queue-create');
  });

  it('P-01: removes the DEFAULT_PENDING "右侧工作区" eyebrow + intro copy', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    // The right-rail eyebrow should no longer be '右侧工作区'.
    expect(sheet).not.toMatch(
      /rightWorkspace\s*\?\s*'右侧工作区'/u,
    );
    // The explanatory intro paragraph must not appear in the rightWorkspace
    // branch (it remains available for the portrait Timeline default).
    expect(sheet).not.toMatch(
      /rightWorkspace[\s\S]{0,200}这些台词还没有安排到时间轴上/u,
    );
  });

  it('P-02: shares the same formal drawer header in AUTHORING', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    // The authoring header renders the same identity strip (icon + 字幕)
    // and the close button is the only X in the right-rail authoring state.
    expect(sheet).toContain('dialogue-authoring-drawer-header');
    expect(sheet).toContain('data-testid="dialogue-authoring-secondary-nav"');
    expect(sheet).toContain('data-testid="dialogue-authoring-back"');
    expect(sheet).toContain('新建字幕');
    expect(sheet).not.toMatch(
      /rightWorkspace\s*\?\s*'右侧工作区'/u,
    );
    // The legacy "创建新的未定时字幕或批量导入。" copy is no longer shown
    // in the right-workspace authoring branch; it may still be present
    // for the portrait Timeline presentation.
    expect(sheet).not.toMatch(
      /rightWorkspace[\s\S]{0,200}创建新的未定时字幕或批量导入/u,
    );
  });

  it('P-02: segments 单条 / 批量 and ships dark form controls', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const styles = source('src/renderer/styles.css');

    // Segmented control: each tab carries data-active for the active styling,
    // and the visible batch label collapses to "批量" in the right workspace.
    expect(sheet).toContain('data-testid="dialogue-authoring-tabs"');
    expect(sheet).toContain('data-active={String(authoringMode === \'single\')}');
    expect(sheet).toContain('data-active={String(authoringMode === \'batch\')}');
    expect(sheet).toMatch(/rightWorkspace \? '批量' : '批量粘贴'/u);
    expect(styles).toContain('.dialogue-authoring-tabs');
    expect(styles).toContain(".dialogue-authoring-tab[data-active='true']");

    // Dark form controls: textarea + select live inside .dialogue-authoring-field
    // and pick up the right-workspace dark system.
    expect(sheet).toContain('dialogue-authoring-field');
    expect(sheet).toContain('dialogue-authoring-speaker-field');
    expect(sheet).toContain('dialogue-authoring-copy-field');
    expect(styles).toContain(
      '.dialogue-authoring-textarea-shell',
    );
    expect(styles).toContain(
      ".dialogue-sheet-right-workspace .dialogue-authoring-field > select",
    );
    expect(styles).toContain('rgb(8 18 12 / 80%)');

    // Single mode order: 角色 before 字幕内容.
    const singleGridIdx = sheet.indexOf('dialogue-authoring-single-grid');
    const speakerIdx = sheet.indexOf('dialogue-authoring-speaker-field');
    const copyIdx = sheet.indexOf('dialogue-authoring-copy-field');
    expect(singleGridIdx).toBeGreaterThan(-1);
    expect(speakerIdx).toBeGreaterThan(singleGridIdx);
    expect(copyIdx).toBeGreaterThan(speakerIdx);

    // Primary CTA is the 全宽 创建字幕 button.
    expect(sheet).toMatch(/rightWorkspace \? '创建字幕' : '新增字幕'/u);
    expect(sheet).toContain('创建后将进入待安排队列');
    expect(styles).toContain('.dialogue-authoring-submit');
  });

  it('P-02: downgrades the placement + audio fields without losing them', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    // The right-workspace authoring mode collapses placement + audio into a
    // single <details> "更多设置" block; the legacy fields still ship text
    // content so capability is preserved.
    expect(sheet).toContain('data-testid="dialogue-authoring-advanced"');
    expect(sheet).toContain('>更多设置</summary>');
    expect(sheet).toContain('dialogue-authoring-placement-field');
    expect(sheet).toContain('dialogue-authoring-audio-field');
    expect(sheet).toContain('创建后进入待安排队列，不会自动定时。');
    expect(sheet).toContain('暂无绑定音频');
  });

  it('P-03: keeps the pending card slot reserved while dragging', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const styles = source('src/renderer/styles.css');

    // When pendingDragDialogueId matches a card, the card body swaps to a
    // dashed placeholder so surrounding cards do not reflow during drag.
    expect(sheet).toContain('data-testid="dialogue-pending-card-placeholder"');
    expect(sheet).toContain('正在安排…');
    expect(sheet).toContain('is-pending-dragging');
    expect(styles).toContain('.dialogue-pending-card-placeholder');
    expect(styles).toContain('.dialogue-pending-card.is-pending-dragging');
  });

  it('P-03: leaves the existing cross-workspace placement provider untouched', () => {
    const placement = source(
      'src/renderer/features/timeline/PendingDialoguePlacement.tsx',
    );
    const timeline = source('src/renderer/features/timeline/TimelineDock.tsx');

    // The cross-workspace drag coordinator, drop marker and drop preview
    // contracts are not re-implemented; this batch only polishes the
    // right-rail presentation around them.
    expect(placement).toContain('PendingDialoguePlacementProvider');
    expect(placement).toContain('pending-dialogue-drag-ghost');
    expect(placement).toContain('dialogueStore.previewArrange(');
    expect(placement).toContain('dialogueStore.arrange(');
    expect(timeline).toContain('data-testid="pending-dialogue-drop-marker"');
    expect(timeline).toContain('data-testid="pending-dialogue-drop-preview"');
    expect(timeline).toContain('registerDropTarget({ element, durationMs, pixelsPerMs })');
  });

  it('stays inside PR #418 and only touches presentation / CSS for this batch', () => {
    const placement = source(
      'src/renderer/features/timeline/PendingDialoguePlacement.tsx',
    );
    const timeline = source('src/renderer/features/timeline/TimelineDock.tsx');
    const editorShell = source('src/renderer/shell/EditorShell.tsx');
    const rightWorkspace = source('src/renderer/shell/RightWorkspace.tsx');

    // No new drag-and-drop framework, no business-owner duplication. The
    // existing cross-workspace placement provider, drop marker and drop
    // preview contracts are reused as-is.
    expect(placement).not.toContain('HTML5NativeDrag');
    expect(placement).not.toContain('dnd-kit');
    expect(placement).not.toContain('react-dnd');
    expect(editorShell).not.toContain('new PendingDialoguePlacementProvider(');
    expect(rightWorkspace).not.toContain('new PendingDialoguePlacementProvider(');
    // Cross-workspace placement and Timeline geometry were not retargeted
    // by this batch.
    expect(placement).toContain('PendingDialoguePlacementProvider');
    expect(timeline).toContain('data-testid="pending-dialogue-drop-marker"');
    expect(timeline).toContain('data-testid="pending-dialogue-drop-preview"');
  });
});
