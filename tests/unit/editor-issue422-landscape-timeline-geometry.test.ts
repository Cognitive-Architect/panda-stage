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

describe('Issue #422 / #432 R3-A Cloud Touch landscape Timeline geometry', () => {
  it('keeps the accepted expanded floor usable and caps the resize range at 2×MIN', () => {
    expect(TIMELINE_EXPANDED_MIN_HEIGHT).toBe(162);
    expect(TIMELINE_EXPANDED_DEFAULT_HEIGHT).toBe(280);
    expect(TIMELINE_EXPANDED_DEFAULT_HEIGHT).toBeGreaterThanOrEqual(
      TIMELINE_EXPANDED_MIN_HEIGHT,
    );
    // Issue #432 R3-A: MAX = 2×MIN = 324px, the new product cap.
    expect(TIMELINE_EXPANDED_MAX_HEIGHT).toBe(324);
    expect(TIMELINE_EXPANDED_MAX_HEIGHT).toBe(
      TIMELINE_EXPANDED_MIN_HEIGHT * 2,
    );

    expect(getTimelineHeightBounds(400, 200, 312)).toEqual({
      minHeight: 162,
      maxHeight: 288,
    });
    expect(getTimelineHeightBounds(400, 200, 360)).toEqual({
      minHeight: 162,
      maxHeight: 240,
    });
    expect(getTimelineHeightBounds(300, 168)).toEqual({
      minHeight: 162,
      maxHeight: 228,
    });
    // R3 contract: a body large enough to allow 2×MIN gets capped at 2×MIN.
    expect(getTimelineHeightBounds(2000, 600)).toEqual({
      minHeight: 162,
      maxHeight: 324,
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

  it('grows real content lanes with the resize range and removes the fixed-height cavity', () => {
    const styles = source('src/renderer/styles.css');
    // Issue #422 + #432 R3-A: the umbrella comment now names both issues.
    const start = styles.lastIndexOf('/* Issue #422 + #432 R3-A:');
    const end = styles.indexOf('/* Issue #398:', start);
    const issue422 = styles.slice(start, end < 0 ? undefined : end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(issue422).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']",
    );
    expect(issue422).toContain("[data-timeline-expanded='true']");
    expect(issue422).toContain('min-height: var(--timeline-expanded-min-height');
    // R3-A: the JS-driven max-height fallback is 324, not the legacy 420.
    expect(issue422).toContain(
      'max-height: var(--timeline-expanded-max-height, 324px)',
    );
    expect(issue422).toMatch(
      /\.timeline-toolbar[\s\S]*?flex: 0 0 48px;[\s\S]*?min-height: 48px;/u,
    );
    // R3-A: ruler-scroll + track-stack + lanes + lanes are a flex column.
    // The ruler-scroll fills the available height; the inner track-stack
    // and lanes flex the remaining room; Subtitle and Audio lanes share
    // the available area 50/50 via equal flex values.
    expect(issue422).toMatch(
      /\.timeline-ruler-scroll[\s\S]*?flex: 1 1 0;[\s\S]*?min-height: 0;[\s\S]*?height: auto;/u,
    );
    expect(issue422).toMatch(
      /\.timeline-ruler-track[\s\S]*?display: flex;[\s\S]*?min-height: 0;[\s\S]*?flex-direction: column;/u,
    );
    expect(issue422).toMatch(
      /\.timeline-ruler[\s\S]*?flex: 0 0 28px;[\s\S]*?min-height: 28px;/u,
    );
    expect(issue422).toMatch(
      /\.timeline-track-stack[\s\S]*?flex: 1 1 0;[\s\S]*?min-height: 0;[\s\S]*?flex-direction: column;/u,
    );
    expect(issue422).toMatch(
      /\.timeline-lanes[\s\S]*?flex: 1 1 0;[\s\S]*?min-height: 0;[\s\S]*?flex-direction: column;/u,
    );
    expect(issue422).toMatch(
      /\.timeline-lane[\s\S]*?flex: 1 1 0;[\s\S]*?min-height: 0;[\s\S]*?height: auto;/u,
    );
    // R3 lane equality: both lanes inherit the same .timeline-lane flex
    // rule (flex: 1 1 0 + min-height: 0), so they share the available
    // lane area 50/50 at MIN/middle/MAX. The #422 block must not ship any
    // per-lane-type override (e.g. .timeline-subtitle-lane or
    // .timeline-audio-lane) that would unbalance them.
    expect(issue422).not.toMatch(/\.timeline-subtitle-lane[\s\S]*?\{/u);
    expect(issue422).not.toMatch(/\.timeline-audio-lane[\s\S]*?\{/u);
    expect(issue422).toContain('/* Issue #431 P-04:');
    expect(issue422).not.toContain('.timeline-task-tray');
    expect(issue422).not.toContain("data-editor-shell-layout='portrait'");
    expect(issue422).not.toContain("data-editor-shell-layout='desktop'");
  });
});
