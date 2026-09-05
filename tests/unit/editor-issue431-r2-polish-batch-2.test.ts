import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TIMELINE_BOTTOM_WORKSPACE_BORDER_HEIGHT,
  TIMELINE_EXPANDED_CORE_MIN_HEIGHT,
  TIMELINE_EXPANDED_MIN_HEIGHT,
} from '../../src/renderer/features/timeline/timelineUiStore';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #431 R2 Subtitle Workspace polish P-04 / P-05 / P-06', () => {
  it('P-04: removes the obsolete bottom Task Tray presentation reservation only', () => {
    const timeline = source('src/renderer/features/timeline/TimelineDock.tsx');
    const bottom = source('src/renderer/shell/BottomWorkspace.tsx');
    const timelineUi = source(
      'src/renderer/features/timeline/timelineUiStore.ts',
    );
    const styles = source('src/renderer/styles.css');
    const issue431Start = styles.indexOf('/* Issue #431 P-04:');
    const issue431 = styles.slice(issue431Start);

    expect(timeline).not.toContain('timeline-task-tray');
    expect(bottom).not.toContain('data-timeline-task-tray-density');
    expect(issue431Start).toBeGreaterThanOrEqual(0);
    expect(issue431).not.toContain('.timeline-task-tray');
    expect(timelineUi).toContain(
      'expandedHeightPx: TIMELINE_EXPANDED_MIN_HEIGHT',
    );
    expect(timelineUi).not.toContain('TIMELINE_TASK_TRAY_');
    expect(TIMELINE_EXPANDED_MIN_HEIGHT).toBe(
      TIMELINE_EXPANDED_CORE_MIN_HEIGHT +
        TIMELINE_BOTTOM_WORKSPACE_BORDER_HEIGHT,
    );
    expect(TIMELINE_EXPANDED_MIN_HEIGHT).toBe(162);

    // P-04 must not move or reshape the Timeline's real core.
    expect(timeline).toContain('data-timeline-layer="toolbar"');
    expect(timeline).toContain('data-timeline-layer="ruler"');
    expect(timeline).toContain('data-track-kind="subtitle"');
    expect(timeline).toContain('data-track-kind="audio"');
    expect(timeline).toContain('data-testid="timeline-collapse"');
    expect(bottom).toContain('<TimelineDock presentation={presentation} />');
  });

  it('P-05: gives AUTHORING one stable scroll body and one shared content gutter', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const styles = source('src/renderer/styles.css');

    expect(sheet).toContain('data-testid="dialogue-authoring-scroll-body"');
    expect(styles).toContain('--subtitle-drawer-content-gutter: 12px;');
    expect(styles).toContain('.dialogue-authoring-scroll-body');
    expect(styles).toContain('scrollbar-gutter: stable;');
    expect(styles).toMatch(
      /\.dialogue-authoring-secondary-nav[\s\S]*?margin-inline: var\(--subtitle-drawer-content-gutter\);/u,
    );
    expect(styles).toMatch(
      /\.dialogue-authoring-tabs[\s\S]*?margin: 0 var\(--subtitle-drawer-content-gutter\);/u,
    );
    expect(styles).toMatch(
      /\.dialogue-authoring-mode[\s\S]*?margin-inline: var\(--subtitle-drawer-content-gutter\);/u,
    );
    expect(styles).toMatch(
      /\.dialogue-authoring-tabs[\s\S]*?width: auto;/u,
    );
    expect(styles).toMatch(
      /\.dialogue-authoring-footer[\s\S]*?padding-inline: 0;/u,
    );
  });

  it('P-06: compacts only the right-workspace single textarea helper and counter', () => {
    const sheet = source('src/renderer/features/dialogue/DialogueSheet.tsx');
    const styles = source('src/renderer/styles.css');

    expect(sheet).toContain('dialogue-authoring-textarea-shell');
    expect(sheet).toContain('data-testid="dialogue-add-text-count"');
    expect(sheet).toMatch(
      /rightWorkspace\s*\?\s*'普通 Enter 换行，Ctrl\/Cmd \+ Enter 提交'\s*:\s*'请输入台词内容…'/u,
    );
    expect(sheet).not.toContain("rightWorkspace ? '在这里输入对白'");
    expect(sheet).toContain("id=\"dialogue-add-text-message\"");
    expect(sheet).toContain('singleTouched.text && singleErrors.text');
    expect(styles).toContain('.dialogue-authoring-textarea-count');
    expect(styles).toContain('position: absolute;');
    expect(styles).toContain('padding: 10px 70px 28px 12px;');

    // Business limits and keyboard semantics remain the incumbent ones.
    expect(sheet).toContain('DIALOGUE_AUTHORING_TEXT_MAX_LENGTH');
    expect(sheet).toContain("event.key === 'Enter'");
    expect(sheet).toContain('(event.ctrlKey || event.metaKey)');
    expect(sheet).toContain('handleAdd();');
  });
});
