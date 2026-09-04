import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clampTimelineHeight,
  getTimelineHeightBounds,
  getTimelineHeightFromPointer,
  TIMELINE_EXPANDED_DEFAULT_HEIGHT,
  TIMELINE_EXPANDED_MAX_HEIGHT,
  TIMELINE_EXPANDED_MIN_HEIGHT,
  TimelineUiStore,
} from '../../src/renderer/features/timeline/timelineUiStore';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #378 Cloud Touch landscape Timeline resize foundation', () => {
  it('derives a finite Canvas-preserving bound and clamps both directions', () => {
    expect(
      getTimelineHeightBounds(700, TIMELINE_EXPANDED_DEFAULT_HEIGHT),
    ).toEqual({
      minHeight: TIMELINE_EXPANDED_MIN_HEIGHT,
      maxHeight: TIMELINE_EXPANDED_MAX_HEIGHT,
    });
    expect(getTimelineHeightBounds(300, 168).maxHeight).toBe(228);
    expect(getTimelineHeightBounds(80, 168).maxHeight).toBe(
      TIMELINE_EXPANDED_MIN_HEIGHT,
    );

    expect(clampTimelineHeight(Number.NaN)).toBe(
      TIMELINE_EXPANDED_MIN_HEIGHT,
    );
    expect(clampTimelineHeight(999, 132, 360)).toBe(360);
    expect(clampTimelineHeight(90, 132, 360)).toBe(132);
    expect(getTimelineHeightFromPointer(200, 500, 400, 420)).toBe(300);
    expect(getTimelineHeightFromPointer(200, 500, 700, 420)).toBe(132);
    expect(getTimelineHeightFromPointer(200, 500, 0, 220)).toBe(220);
  });

  it('restores the last valid expanded height without creating a project mutation', () => {
    const store = new TimelineUiStore();
    try {
      const initial = store.getSnapshot();
      store.setHeightMax(360);
      store.setHeight(320);
      expect(store.getSnapshot().expandedHeightPx).toBe(320);

      store.setExpanded(false);
      store.setExpanded(true);

      expect(store.getSnapshot().expandedHeightPx).toBe(320);
      expect(store.getSnapshot().expandedHeightMaxPx).toBe(360);
      expect(store.getSnapshot().currentTimeMs).toBe(initial.currentTimeMs);
      expect(store.getSnapshot().scrollPx).toBe(initial.scrollPx);
      expect(store.getSnapshot().zoom).toBe(initial.zoom);
      expect(store.getSnapshot().resizing).toBe(false);
    } finally {
      store.dispose();
    }
  });

  it('mounts one scoped pointer/capture handle and preserves the incumbent owners', () => {
    const bottom = source('src/renderer/shell/BottomWorkspace.tsx');
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const timelineUi = source(
      'src/renderer/features/timeline/timelineUiStore.ts',
    );
    const styles = source('src/renderer/styles.css');
    const issue378Start = styles.lastIndexOf('/* Issue #378:');
    const issue378End = styles.indexOf('/* Issue #357:', issue378Start);
    const issue378 = styles.slice(
      issue378Start,
      issue378End === -1 ? undefined : issue378End,
    );

    expect(shell).toContain(
      'resizable={layoutMode === \'landscape\'}',
    );
    expect(bottom).toContain('data-testid="timeline-resize-handle"');
    expect(bottom).toContain('role="separator"');
    expect(bottom).toContain('aria-label="调整时间轴高度"');
    expect(bottom).toContain('setPointerCapture');
    expect(bottom).toContain('onPointerCancel={finishResize}');
    expect(bottom).toContain('timelineUiStore.setResizing(true)');
    expect(bottom).toContain('timelineUiStore.setResizing(false)');
    expect(bottom).toContain('getTimelineHeightFromPointer');
    expect(bottom).toContain('<TimelineDock presentation={presentation} />');
    expect(bottom.match(/<TimelineDock/gu)).toHaveLength(1);
    expect(bottom).not.toContain('useState');

    for (const sourceText of [bottom, timelineUi]) {
      expect(sourceText).not.toContain('updateProject');
      expect(sourceText).not.toContain('editorProjectStore');
      expect(sourceText).not.toContain('historyStore');
      expect(sourceText).not.toContain('project.json');
    }

    expect(issue378).toContain(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']",
    );
    expect(issue378).toContain('.bottom-workspace[data-resizable=\'true\']');
    expect(issue378).toContain('height: var(--timeline-expanded-height');
    expect(issue378).toContain('max-height: var(--timeline-expanded-max-height');
    expect(issue378).toContain('cursor: ns-resize;');
    expect(issue378).toContain('touch-action: none;');
    expect(issue378).toContain('min-height: 44px;');
    expect(issue378).not.toContain("data-editor-shell-layout='portrait'");
    expect(issue378).not.toContain("data-editor-shell-layout='desktop'");
  });

  it('keeps the base collapse contract outside the explicit resizable scope', () => {
    const styles = source('src/renderer/styles.css');
    expect(styles).toMatch(
      /\.bottom-workspace\s*\{[\s\S]*?min-height:\s*132px;[\s\S]*?max-height:\s*168px;[\s\S]*?overflow:\s*hidden;/u,
    );
    expect(styles).toMatch(
      /\.bottom-workspace\[data-timeline-expanded='false'\]\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?max-height:\s*112px;/u,
    );
  });
});
