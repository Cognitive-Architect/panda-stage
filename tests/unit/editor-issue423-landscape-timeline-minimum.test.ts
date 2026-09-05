import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TIMELINE_BOTTOM_WORKSPACE_BORDER_HEIGHT,
  TIMELINE_EXPANDED_CORE_MIN_HEIGHT,
  TIMELINE_EXPANDED_DEFAULT_HEIGHT,
  TIMELINE_EXPANDED_MIN_HEIGHT,
  TIMELINE_RULER_SCROLL_HEIGHT,
  TIMELINE_TOOLBAR_HEIGHT,
} from '../../src/renderer/features/timeline/timelineUiStore';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #423 Cloud Touch landscape Timeline minimum composition', () => {
  it('keeps the fixed core while Issue #431 removes the compact tray contribution', () => {
    expect(TIMELINE_EXPANDED_CORE_MIN_HEIGHT).toBe(
      TIMELINE_TOOLBAR_HEIGHT + TIMELINE_RULER_SCROLL_HEIGHT,
    );
    expect(TIMELINE_EXPANDED_MIN_HEIGHT).toBe(
      TIMELINE_EXPANDED_CORE_MIN_HEIGHT +
        TIMELINE_BOTTOM_WORKSPACE_BORDER_HEIGHT,
    );
    expect(TIMELINE_EXPANDED_MIN_HEIGHT).toBe(162);
    expect(TIMELINE_EXPANDED_MIN_HEIGHT).toBeLessThan(240);
    expect(TIMELINE_EXPANDED_DEFAULT_HEIGHT).toBeGreaterThan(
      TIMELINE_EXPANDED_MIN_HEIGHT,
    );
  });

  it('keeps the inherited R1 height owner without a removed tray density state', () => {
    const bottom = source('src/renderer/shell/BottomWorkspace.tsx');

    expect(bottom).toContain('TIMELINE_EXPANDED_MIN_HEIGHT');
    expect(bottom).not.toContain('TIMELINE_TASK_TRAY_COMPACT_MAX_EXPANDED_HEIGHT');
    expect(bottom).not.toContain('data-timeline-task-tray-density');
    expect(bottom).not.toContain('taskTrayDensity');
    expect(bottom).not.toContain('useState');
  });

  it('does not retain the obsolete landscape Task Tray CSS reservation', () => {
    const styles = source('src/renderer/styles.css');

    expect(styles.lastIndexOf('/* Issue #423:')).toBe(-1);
    expect(styles).toContain('/* Issue #431 P-04:');
  });
});
