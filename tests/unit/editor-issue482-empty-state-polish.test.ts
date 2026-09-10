import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #482 empty-state copy and Subtitle fallback polish', () => {
  it('uses the approved creator-facing Timeline sentence only', () => {
    const timeline = source('src/renderer/features/timeline/TimelineDock.tsx');

    expect(timeline).toContain('新建镜头后，这里会显示时间轴。');
    expect(timeline).not.toContain('当前没有可定位的镜头或时长为 0。');
  });

  it('removes only the visible no-Shot fallback while retaining the guard', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');

    expect(sheet).toContain('if (!shot)');
    expect(sheet).toContain('return null;');
    expect(sheet).not.toContain('请选择一个镜头以编辑对白。');
  });

  it('keeps the normal Subtitle state compact, decorative, and actionable', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const styles = source('src/renderer/styles.css');

    expect(sheet).toContain('还没有字幕，先写一句吧。');
    expect(sheet).not.toContain('先写一句，之后再安排它什么时候出现。');
    expect(sheet).toContain('data-testid="subtitle-workspace-empty-art"');
    expect(sheet).toContain('aria-hidden="true"');
    expect(sheet).toContain('data-testid="subtitle-workspace-empty-action"');
    expect(styles).toContain('.subtitle-workspace-empty-art');
    expect(styles).toContain('pointer-events: none;');
    expect(styles).toContain('text-wrap: balance;');
  });
});
