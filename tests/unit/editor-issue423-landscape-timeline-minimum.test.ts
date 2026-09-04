import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TIMELINE_BOTTOM_WORKSPACE_BORDER_HEIGHT,
  TIMELINE_EXPANDED_CORE_MIN_HEIGHT,
  TIMELINE_EXPANDED_DEFAULT_HEIGHT,
  TIMELINE_EXPANDED_MIN_HEIGHT,
  TIMELINE_RULER_SCROLL_HEIGHT,
  TIMELINE_TASK_TRAY_COMPACT_MAX_EXPANDED_HEIGHT,
  TIMELINE_TASK_TRAY_COMPACT_MIN_HEIGHT,
  TIMELINE_TASK_TRAY_NORMAL_MIN_HEIGHT,
  TIMELINE_TOOLBAR_HEIGHT,
} from '../../src/renderer/features/timeline/timelineUiStore';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #423 Cloud Touch landscape Timeline minimum composition', () => {
  it('derives the lower expanded floor from fixed core and compact tray geometry', () => {
    expect(TIMELINE_EXPANDED_CORE_MIN_HEIGHT).toBe(
      TIMELINE_TOOLBAR_HEIGHT + TIMELINE_RULER_SCROLL_HEIGHT,
    );
    expect(TIMELINE_EXPANDED_MIN_HEIGHT).toBe(
      TIMELINE_EXPANDED_CORE_MIN_HEIGHT +
        TIMELINE_TASK_TRAY_COMPACT_MIN_HEIGHT +
        TIMELINE_BOTTOM_WORKSPACE_BORDER_HEIGHT,
    );
    expect(TIMELINE_EXPANDED_MIN_HEIGHT).toBe(210);
    expect(TIMELINE_EXPANDED_MIN_HEIGHT).toBeLessThan(240);
    expect(TIMELINE_EXPANDED_DEFAULT_HEIGHT).toBeGreaterThan(
      TIMELINE_EXPANDED_MIN_HEIGHT,
    );
    expect(TIMELINE_TASK_TRAY_COMPACT_MAX_EXPANDED_HEIGHT).toBe(
      TIMELINE_EXPANDED_MIN_HEIGHT +
        TIMELINE_TASK_TRAY_NORMAL_MIN_HEIGHT -
        TIMELINE_TASK_TRAY_COMPACT_MIN_HEIGHT,
    );
  });

  it('derives Task Tray density from the single Timeline height owner', () => {
    const bottom = source('src/renderer/shell/BottomWorkspace.tsx');

    expect(bottom).toContain('TIMELINE_TASK_TRAY_COMPACT_MAX_EXPANDED_HEIGHT');
    expect(bottom).toContain('data-timeline-task-tray-density={taskTrayDensity}');
    expect(bottom).toContain('ui.expandedHeightPx <=');
    expect(bottom).not.toContain('useState');
  });

  it('compresses only the landscape Task Tray while keeping its header and scroll path', () => {
    const styles = source('src/renderer/styles.css');
    const start = styles.lastIndexOf('/* Issue #423:');
    const end = styles.indexOf('/* Issue #398:', start);
    const issue423 = styles.slice(start, end < 0 ? undefined : end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(issue423).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']",
    );
    expect(issue423).toContain(
      "[data-timeline-task-tray-density='compact']",
    );
    expect(issue423).toMatch(
      /\.timeline-task-tray[\s\S]*?min-height: 48px;[\s\S]*?overflow-y: auto;/u,
    );
    expect(issue423).toMatch(
      /> \.dialogue-sheet\.dialogue-sheet-timeline[\s\S]*?gap: 0;[\s\S]*?min-height: 48px;[\s\S]*?padding: 0 14px;/u,
    );
    expect(issue423).toMatch(
      /\.dialogue-sheet-header[\s\S]*?flex: 0 0 48px;[\s\S]*?min-height: 48px;[\s\S]*?padding: 0;[\s\S]*?border-bottom: 0;/u,
    );
    expect(issue423).not.toContain("data-editor-shell-layout='portrait'");
    expect(issue423).not.toContain("data-editor-shell-layout='desktop'");
  });
});
