import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #482 empty-state copy and Subtitle fallback polish', () => {
  it('uses the approved creator-facing Timeline sentence only', () => {
    const timeline = source('src/renderer/features/timeline/TimelineDock.tsx');
    const verifier = source(
      'scripts/verify-issue207-neg002-empty-timeline.cjs',
    );

    expect(timeline).toContain('新建镜头后，这里会显示时间轴。');
    expect(timeline).not.toContain('当前没有可定位的镜头或时长为 0。');
    expect(verifier).toContain(
      "const EMPTY_TIMELINE_TEXT = '新建镜头后，这里会显示时间轴。';",
    );
    expect(verifier).not.toContain('当前没有可定位的镜头或时长为 0。');
  });

  it('keeps no-Shot safety while rendering dependency guidance without a CTA', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const start = sheet.indexOf('function SubtitleNoShotEmptyState');
    const end = sheet.indexOf('export function DialogueSheet');
    const noShotState = sheet.slice(start, end);

    expect(sheet).not.toContain('请选择一个镜头以编辑对白。');
    expect(sheet).toContain('const noCurrentShot = shot === undefined;');
    expect(sheet).toContain('rightWorkspace && noCurrentShot');
    expect(noShotState).toContain('data-testid="subtitle-no-shot-state"');
    expect(noShotState).toContain('data-testid="subtitle-no-shot-diagram"');
    expect(noShotState).toContain('data-testid="subtitle-no-shot-shot"');
    expect(noShotState).toContain('data-testid="subtitle-no-shot-subtitle"');
    expect(noShotState).toContain('data-testid="subtitle-no-shot-copy"');
    expect(noShotState).toContain('Clapperboard');
    expect(noShotState).toContain('MessageCircleMore');
    expect(noShotState).toContain('ArrowRight');
    expect(noShotState).toContain('先新建一个镜头吧。');
    expect(noShotState).not.toContain('<button');
    expect(noShotState).not.toContain('新建字幕');
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
    expect(styles).toContain('.subtitle-no-shot-diagram');
    expect(styles).toContain('.subtitle-no-shot-card-active');
    expect(styles).toContain('.subtitle-no-shot-card-muted');
  });
});
