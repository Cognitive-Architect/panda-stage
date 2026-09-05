import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clampTimelineHeight,
  getTimelineHeightBounds,
  TIMELINE_EXPANDED_MAX_HEIGHT,
  TIMELINE_EXPANDED_MIN_HEIGHT,
  TimelineUiStore,
} from '../../src/renderer/features/timeline/timelineUiStore';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #432 R3 Timeline vertical resize and Subtitle Workspace height responsiveness', () => {
  describe('R3-A: Timeline vertical resize grows real content lanes', () => {
    it('caps the expanded height at exactly 2×MIN = 324 and clamps legacy stored heights', () => {
      expect(TIMELINE_EXPANDED_MAX_HEIGHT).toBe(324);
      expect(TIMELINE_EXPANDED_MAX_HEIGHT).toBe(
        TIMELINE_EXPANDED_MIN_HEIGHT * 2,
      );

      // Anything above 2×MIN is clamped to the new product cap.
      expect(clampTimelineHeight(420)).toBe(324);
      expect(clampTimelineHeight(999)).toBe(324);
      expect(clampTimelineHeight(325)).toBe(324);
      // Below MIN is clamped up; equal to MAX stays.
      expect(clampTimelineHeight(90)).toBe(TIMELINE_EXPANDED_MIN_HEIGHT);
      expect(clampTimelineHeight(162)).toBe(162);
      expect(clampTimelineHeight(324)).toBe(324);
    });

    it('keeps TimelineUiStore clamping in sync with the new product cap', () => {
      const store = new TimelineUiStore();
      try {
        store.setHeightMax(500);
        expect(store.getSnapshot().expandedHeightMaxPx).toBe(324);
        store.setHeight(420);
        expect(store.getSnapshot().expandedHeightPx).toBe(324);
        store.setHeight(180);
        expect(store.getSnapshot().expandedHeightPx).toBe(180);
        // Collapse and reopen preserves the last valid height.
        store.setExpanded(false);
        store.setExpanded(true);
        expect(store.getSnapshot().expandedHeightPx).toBe(180);
        expect(store.getSnapshot().expandedHeightMaxPx).toBe(324);
      } finally {
        store.dispose();
      }
    });

    it('still derives a finite Canvas-preserving bound for tight editor bodies', () => {
      expect(getTimelineHeightBounds(2000, 600)).toEqual({
        minHeight: 162,
        maxHeight: 324,
      });
      expect(getTimelineHeightBounds(700, 280).maxHeight).toBe(324);
      expect(getTimelineHeightBounds(300, 168).maxHeight).toBe(228);
      expect(getTimelineHeightBounds(80, 168).maxHeight).toBe(
        TIMELINE_EXPANDED_MIN_HEIGHT,
      );
    });

    it('rewrites the Cloud Touch landscape Timeline CSS as a flex column for the resize range', () => {
      const styles = source('src/renderer/styles.css');
      const start = styles.lastIndexOf('/* Issue #422 + #432 R3-A:');
      const end = styles.indexOf('/* Issue #398:', start);
      const block = styles.slice(start, end < 0 ? undefined : end);
      expect(start).toBeGreaterThanOrEqual(0);

      // Bottom-workspace uses the JS-driven min/max with the new MAX fallback.
      expect(block).toContain(
        "max-height: var(--timeline-expanded-max-height, 324px);",
      );
      expect(block).toContain(
        "min-height: var(--timeline-expanded-min-height, 162px);",
      );

      // Ruler-scroll flexes with the available height instead of a fixed
      // 112px reservation, so the resize range 162..324px grows real content.
      const rulerScrollRule = block.match(
        /\.timeline-ruler-scroll\s*\{[^}]*\}/u,
      );
      expect(rulerScrollRule).toBeTruthy();
      expect(rulerScrollRule?.[0]).toContain('flex: 1 1 0;');
      expect(rulerScrollRule?.[0]).toContain('min-height: 0;');
      expect(rulerScrollRule?.[0]).toContain('height: auto;');

      // Ruler-track is a flex column that hosts the ruler + track-stack.
      const rulerTrackRule = block.match(
        /\.timeline-ruler-track\s*\{[^}]*\}/u,
      );
      expect(rulerTrackRule).toBeTruthy();
      expect(rulerTrackRule?.[0]).toContain('display: flex;');
      expect(rulerTrackRule?.[0]).toContain('flex-direction: column;');
      expect(rulerTrackRule?.[0]).toContain('min-height: 0;');

      // The ruler is a 28px flex child at the top of the track-stack.
      const rulerRule = block.match(/\.timeline-ruler\s*\{[^}]*\}/u);
      expect(rulerRule).toBeTruthy();
      expect(rulerRule?.[0]).toContain('flex: 0 0 28px;');
      expect(rulerRule?.[0]).toContain('min-height: 28px;');

      // The track-stack is a real flex column container (replacing the
      // legacy display: contents reservation) that fills the rest.
      const trackStackRule = block.match(
        /\.timeline-track-stack\s*\{[^}]*\}/u,
      );
      expect(trackStackRule).toBeTruthy();
      expect(trackStackRule?.[0]).toContain('display: flex;');
      expect(trackStackRule?.[0]).toContain('flex: 1 1 0;');
      expect(trackStackRule?.[0]).toContain('min-height: 0;');
      expect(trackStackRule?.[0]).toContain('flex-direction: column;');

      // The lanes container is a flex column inside the track-stack.
      const lanesRule = block.match(/\.timeline-lanes\s*\{[^}]*\}/u);
      expect(lanesRule).toBeTruthy();
      expect(lanesRule?.[0]).toContain('flex: 1 1 0;');
      expect(lanesRule?.[0]).toContain('min-height: 0;');
      expect(lanesRule?.[0]).toContain('flex-direction: column;');

      // The lane base rule uses flex: 1 1 0 so Subtitle and Audio share
      // the available area 50/50 via equal flex values.
      const laneRule = block.match(/\.timeline-lane\s*\{[^}]*\}/u);
      expect(laneRule).toBeTruthy();
      expect(laneRule?.[0]).toContain('flex: 1 1 0;');
      expect(laneRule?.[0]).toContain('min-height: 0;');
      expect(laneRule?.[0]).toContain('height: auto;');
    });

    it('does not ship a per-lane-type override in the R3 block that would unbalance the lanes', () => {
      const styles = source('src/renderer/styles.css');
      const start = styles.lastIndexOf('/* Issue #422 + #432 R3-A:');
      const end = styles.indexOf('/* Issue #398:', start);
      const block = styles.slice(start, end < 0 ? undefined : end);

      // Both lanes must inherit the same .timeline-lane flex rule, so
      // the R3 block must not redefine .timeline-subtitle-lane or
      // .timeline-audio-lane independently.
      expect(block).not.toMatch(/\.timeline-subtitle-lane\s*\{/u);
      expect(block).not.toMatch(/\.timeline-audio-lane\s*\{/u);
    });

    it('preserves the legacy fallbacks and outer .bottom-workspace collapse contract', () => {
      const styles = source('src/renderer/styles.css');
      // The Issue #378 bottom-workspace height rule now uses the 324 fallback.
      const issue378Start = styles.lastIndexOf('/* Issue #378:');
      const issue378End = styles.indexOf('/* Issue #255:', issue378Start);
      const issue378 = styles.slice(
        issue378Start,
        issue378End === -1 ? undefined : issue378End,
      );
      expect(issue378).toContain(
        'max-height: var(--timeline-expanded-max-height, 324px);',
      );
      expect(issue378).toContain('height: 50px;');

      // The base .bottom-workspace contract from Issue 197 stays put.
      expect(styles).toMatch(
        /\.bottom-workspace\s*\{[\s\S]*?min-height:\s*132px;[\s\S]*?max-height:\s*168px;[\s\S]*?overflow:\s*hidden;/u,
      );
      expect(styles).toMatch(
        /\.bottom-workspace\[data-timeline-expanded='false'\]\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?max-height:\s*112px;/u,
      );
    });
  });

  describe('R3-B: Right Subtitle Workspace is height-responsive', () => {
    it('uses a flex column shell with stable header and flexible body', () => {
      const styles = source('src/renderer/styles.css');
      const start = styles.lastIndexOf('/* Issue #432 R3-B:');
      const end = styles.indexOf('/* Issue #405:', start);
      const block = styles.slice(start, end < 0 ? undefined : end);
      expect(start).toBeGreaterThanOrEqual(0);

      const sheetRule = block.match(
        /\.dialogue-sheet-right-workspace\s*\{[^}]*\}/u,
      );
      expect(sheetRule).toBeTruthy();
      expect(sheetRule?.[0]).toContain('display: flex;');
      expect(sheetRule?.[0]).toContain('min-height: 0;');
      expect(sheetRule?.[0]).toContain('overflow: hidden;');
      expect(sheetRule?.[0]).toContain('flex-direction: column;');
    });

    it('keeps the DEFAULT_PENDING queue as a flex column with stable heading and footer', () => {
      const styles = source('src/renderer/styles.css');
      const start = styles.lastIndexOf('/* Issue #432 R3-B:');
      const end = styles.indexOf('/* Issue #405:', start);
      const block = styles.slice(start, end < 0 ? undefined : end);

      const queueRule = block.match(
        /\.timeline-subtitle-queue\s*\{[^}]*\}/u,
      );
      expect(queueRule).toBeTruthy();
      expect(queueRule?.[0]).toContain('display: flex;');
      expect(queueRule?.[0]).toContain('min-height: 0;');
      expect(queueRule?.[0]).toContain('overflow: hidden;');
      expect(queueRule?.[0]).toContain('flex: 1 1 0;');
      expect(queueRule?.[0]).toContain('flex-direction: column;');

      // Heading is flex: 0 0 auto so it never compresses. The R3 block
      // groups the heading + intro + authoring heading into a single rule.
      const headingRule = block.match(
        /\.dialogue-pending-queue-heading[\s\S]*?flex: 0 0 auto;/u,
      );
      expect(headingRule).toBeTruthy();
      expect(headingRule?.[0]).toContain('.dialogue-pending-queue-heading');
      expect(headingRule?.[0]).toContain('flex: 0 0 auto;');

      // The pending list keeps its internal scroll owner so cards do not
      // continuously shrink to keep all items visible.
      expect(block).toContain('overscroll-behavior: contain;');
    });

    it('keeps the AUTHORING form footer reachable via sticky positioning inside the scroll-body', () => {
      const styles = source('src/renderer/styles.css');
      const start = styles.lastIndexOf('/* Issue #432 R3-B:');
      const end = styles.indexOf('/* Issue #405:', start);
      const block = styles.slice(start, end < 0 ? undefined : end);

      const shellRule = block.match(
        /\.dialogue-authoring-shell\s*\{[^}]*\}/u,
      );
      expect(shellRule).toBeTruthy();
      expect(shellRule?.[0]).toContain('display: flex;');
      expect(shellRule?.[0]).toContain('min-height: 0;');
      expect(shellRule?.[0]).toContain('overflow: hidden;');
      expect(shellRule?.[0]).toContain('flex: 1 1 0;');
      expect(shellRule?.[0]).toContain('flex-direction: column;');

      const headerRule = block.match(
        /\.dialogue-authoring-shell\s+>\s+\.dialogue-drawer-header\s*\{[^}]*\}/u,
      );
      expect(headerRule).toBeTruthy();
      expect(headerRule?.[0]).toContain('flex: 0 0 auto;');

      const scrollBodyRule = block.match(
        /\.dialogue-authoring-shell\s+>\s+\.dialogue-authoring-scroll-body\s*\{[^}]*\}/u,
      );
      expect(scrollBodyRule).toBeTruthy();
      expect(scrollBodyRule?.[0]).toContain('flex: 1 1 0;');
      expect(scrollBodyRule?.[0]).toContain('overflow-y: auto;');

      // Form footer is sticky so the primary CTA stays reachable.
      const footerRule = block.match(
        /\.dialogue-authoring-footer\s*\{[^}]*\}/u,
      );
      expect(footerRule).toBeTruthy();
      expect(footerRule?.[0]).toContain('position: sticky;');
      expect(footerRule?.[0]).toContain('bottom: -12px;');

      const submitRule = block.match(
        /\.dialogue-authoring-footer\s*>\s*\.dialogue-authoring-submit\s*\{[^}]*\}/u,
      );
      expect(submitRule).toBeTruthy();
      expect(submitRule?.[0]).toContain('width: 100%;');
    });

    it('does not introduce page-level editor vertical scrolling', () => {
      const styles = source('src/renderer/styles.css');

      // Editor body is bounded by overflow: hidden and min-height: 0.
      expect(styles).toMatch(
        /\.editor-body\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden;/u,
      );
      // Editor layout is bounded by overflow: hidden.
      expect(styles).toMatch(/\.editor-layout\s*\{[\s\S]*?overflow: hidden;/u);
      // Dialogue sheet right workspace has overflow: hidden so it cannot
      // reintroduce page-level scroll.
      const sheetRule = styles.match(
        /\.dialogue-sheet-right-workspace\s*\{[^}]*\}/u,
      );
      expect(sheetRule).toBeTruthy();
      expect(sheetRule?.[0]).toContain('overflow: hidden;');
    });

    it('keeps the existing R2 #428 right-rail slice free of editor / body outer selectors', () => {
      const styles = source('src/renderer/styles.css');
      const start = styles.indexOf('/* Issue #428 R2:');
      const r2 = styles.slice(
        start,
        styles.indexOf('@media (max-width: 1050px)', start),
      );
      expect(start).toBeGreaterThanOrEqual(0);
      expect(r2).toContain('.dialogue-sheet-right-workspace');
      expect(r2).toContain('.dialogue-untimed-queue');
      expect(r2).toContain('.dialogue-authoring-shell');
      expect(r2).toContain('overflow-y: auto;');
      expect(r2).toContain('overscroll-behavior: contain;');
      expect(r2).not.toContain('.editor-layout {');
      expect(r2).not.toContain('.editor-body {');
    });
  });
});
