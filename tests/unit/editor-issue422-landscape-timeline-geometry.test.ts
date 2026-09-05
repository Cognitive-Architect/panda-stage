import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getTimelineHeightBounds,
  TIMELINE_EXPANDED_DEFAULT_HEIGHT,
  TIMELINE_EXPANDED_MAX_HEIGHT,
  TIMELINE_EXPANDED_MIN_HEIGHT,
} from '../../src/renderer/features/timeline/timelineUiStore';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #422 Cloud Touch landscape Timeline geometry rebaseline', () => {
  it('keeps the expanded floor usable and derives max from the strongest body floor', () => {
    expect(TIMELINE_EXPANDED_MIN_HEIGHT).toBe(178);
    expect(TIMELINE_EXPANDED_DEFAULT_HEIGHT).toBe(280);
    expect(TIMELINE_EXPANDED_DEFAULT_HEIGHT).toBeGreaterThanOrEqual(
      TIMELINE_EXPANDED_MIN_HEIGHT,
    );
    expect(TIMELINE_EXPANDED_MAX_HEIGHT).toBe(420);

    expect(getTimelineHeightBounds(400, 200, 312)).toEqual({
      minHeight: 178,
      maxHeight: 288,
    });
    expect(getTimelineHeightBounds(400, 200, 360)).toEqual({
      minHeight: 178,
      maxHeight: 240,
    });
    expect(getTimelineHeightBounds(300, 168)).toEqual({
      minHeight: 178,
      maxHeight: 228,
    });
  });

  it('measures both landscape rails before applying the Timeline maximum', () => {
    const bottom = source('src/renderer/shell/BottomWorkspace.tsx');
    const timelineUi = source(
      'src/renderer/features/timeline/timelineUiStore.ts',
    );

    expect(bottom).toContain('readLandscapeLeftRailMinimumHeight');
    expect(bottom).toContain('readLandscapeRightRailMinimumHeight');
    expect(bottom).toContain('readEditorBodyMinimumHeight');
    expect(bottom).toContain('TIMELINE_MIN_CANVAS_HEIGHT');
    expect(bottom).toContain('readEditorBodyMinimumHeight(editorBody)');
    expect(bottom).toContain("'--timeline-expanded-min-height'");
    expect(timelineUi).toContain('editorBodyMinimumHeight');
    expect(timelineUi).toContain('editorBodyPreservingMaximum');
  });

  it('keeps the accepted core geometry after the obsolete Task Tray is removed', () => {
    const styles = source('src/renderer/styles.css');
    const start = styles.lastIndexOf('/* Issue #422:');
    const end = styles.indexOf('/* Issue #398:', start);
    const issue422 = styles.slice(start, end < 0 ? undefined : end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(issue422).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']",
    );
    expect(issue422).toContain("[data-timeline-expanded='true']");
    expect(issue422).toContain('min-height: var(--timeline-expanded-min-height');
    expect(issue422).toContain('max-height: var(--timeline-expanded-max-height');
    expect(issue422).toMatch(
      /\.timeline-toolbar[\s\S]*?flex: 0 0 48px;[\s\S]*?min-height: 48px;/u,
    );
    expect(issue422).toMatch(
      /\.timeline-ruler-scroll[\s\S]*?flex: 0 0 112px;[\s\S]*?height: 112px;[\s\S]*?min-height: 112px;/u,
    );
    expect(issue422).toMatch(
      /\.timeline-track-stack[\s\S]*?flex: 0 0 68px;[\s\S]*?height: 68px;[\s\S]*?min-height: 68px;/u,
    );
    expect(issue422).toMatch(
      /\.timeline-lane[\s\S]*?height: 34px;[\s\S]*?min-height: 34px;/u,
    );
    expect(issue422).toContain('/* Issue #431 P-04:');
    expect(issue422).not.toContain('.timeline-task-tray');
    expect(issue422).not.toContain("data-editor-shell-layout='portrait'");
    expect(issue422).not.toContain("data-editor-shell-layout='desktop'");
  });
});
