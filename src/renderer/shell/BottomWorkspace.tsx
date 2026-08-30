import { useEffect, useRef } from 'react';
import { HistoryControls } from '../features/editor/HistoryControls';
import { TimelineDock } from '../features/timeline/TimelineDock';
import {
  clampTimelineHeight,
  getTimelineHeightBounds,
  getTimelineHeightFromPointer,
  TIMELINE_EXPANDED_MIN_HEIGHT,
  TIMELINE_RESIZE_KEYBOARD_STEP,
  timelineUiStore,
  useTimelineUi,
  type TimelineHeightBounds,
} from '../features/timeline/timelineUiStore';
import type { EditorShellLayoutMode } from './adaptiveEditorShell';

/**
 * The formal editor bottom owner. Stage 3-C keeps the history behavior intact;
 * Day 26 adds the Timeline Shell as a second, UI-only product surface. Issue
 * #368 keeps the single HistoryControls owner in the top project bar, leaving
 * this region Timeline-first in the production EditorShell.
 *
 * Issue #197 mirrors the one existing Timeline expand state
 * (`timelineUiStore.expanded`) onto `data-timeline-expanded` so the bottom
 * height contract can actually shrink when the ruler is collapsed and the
 * freed vertical space returns to the central Canvas. Reading that store is
 * presentation-only: no project snapshot, dirty flag, revision or History is
 * touched, and no second collapse state is introduced here.
 */
export interface BottomWorkspaceProps {
  hidden?: boolean;
  presentation?: EditorShellLayoutMode;
  resizable?: boolean;
  showHistoryControls?: boolean;
}

interface TimelineResizePointer {
  pointerId: number;
  startY: number;
  startHeight: number;
  maxHeight: number;
}

function readLiveTimelineHeightBounds(
  workspace: HTMLElement,
): TimelineHeightBounds | null {
  const editorLayout = workspace.closest<HTMLElement>('.editor-layout');
  const editorBody = editorLayout?.querySelector<HTMLElement>(
    '[data-testid="editor-body"]',
  );
  if (!editorBody) return null;

  const editorBodyHeight = editorBody.getBoundingClientRect().height;
  const currentBottomHeight = workspace.getBoundingClientRect().height;
  if (!(editorBodyHeight > 0) || !(currentBottomHeight > 0)) return null;

  return getTimelineHeightBounds(editorBodyHeight, currentBottomHeight);
}

export function BottomWorkspace({
  hidden = false,
  presentation = 'landscape',
  resizable = false,
  showHistoryControls = presentation !== 'landscape',
}: BottomWorkspaceProps = {}): React.JSX.Element {
  const ui = useTimelineUi();
  const { expanded } = ui;
  const workspaceRef = useRef<HTMLElement>(null);
  const resizePointerRef = useRef<TimelineResizePointer | null>(null);

  useEffect(() => {
    timelineUiStore.setResizing(false);
    if (!resizable) return;

    const workspace = workspaceRef.current;
    const editorLayout = workspace?.closest<HTMLElement>('.editor-layout');
    const editorBody = editorLayout?.querySelector<HTMLElement>(
      '[data-testid="editor-body"]',
    );
    if (!workspace || !editorLayout || !editorBody) return;

    const updateHeightBounds = (): void => {
      const bounds = readLiveTimelineHeightBounds(workspace);
      if (bounds) timelineUiStore.setHeightMax(bounds.maxHeight);
    };

    updateHeightBounds();
    window.addEventListener('resize', updateHeightBounds);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateHeightBounds);
    observer?.observe(editorLayout);
    observer?.observe(editorBody);
    observer?.observe(workspace);

    return () => {
      window.removeEventListener('resize', updateHeightBounds);
      observer?.disconnect();
      resizePointerRef.current = null;
      timelineUiStore.setResizing(false);
    };
  }, [resizable]);

  const handleResizePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    if (
      !resizable ||
      !ui.expanded ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }

    event.preventDefault();
    const liveBounds = workspaceRef.current
      ? readLiveTimelineHeightBounds(workspaceRef.current)
      : null;
    if (liveBounds) timelineUiStore.setHeightMax(liveBounds.maxHeight);
    const snapshot = timelineUiStore.getSnapshot();
    const maxHeight = liveBounds?.maxHeight ?? snapshot.expandedHeightMaxPx;
    const startHeight = clampTimelineHeight(
      snapshot.expandedHeightPx,
      TIMELINE_EXPANDED_MIN_HEIGHT,
      maxHeight,
    );
    timelineUiStore.setHeight(startHeight);
    resizePointerRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight,
      maxHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    timelineUiStore.setResizing(true);
  };

  const handleResizePointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ): void => {
    const drag = resizePointerRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    timelineUiStore.setHeight(
      getTimelineHeightFromPointer(
        drag.startHeight,
        drag.startY,
        event.clientY,
        drag.maxHeight,
      ),
    );
  };

  const finishResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = resizePointerRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizePointerRef.current = null;
    timelineUiStore.setResizing(false);
  };

  const handleResizeKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    let nextHeight: number | null = null;
    if (event.key === 'ArrowUp') {
      nextHeight = ui.expandedHeightPx + TIMELINE_RESIZE_KEYBOARD_STEP;
    } else if (event.key === 'ArrowDown') {
      nextHeight = ui.expandedHeightPx - TIMELINE_RESIZE_KEYBOARD_STEP;
    } else if (event.key === 'Home') {
      nextHeight = TIMELINE_EXPANDED_MIN_HEIGHT;
    } else if (event.key === 'End') {
      nextHeight = ui.expandedHeightMaxPx;
    }
    if (nextHeight === null) return;

    event.preventDefault();
    timelineUiStore.setHeight(nextHeight);
  };

  return (
    <section
      aria-label="Bottom workspace"
      className="bottom-workspace"
      data-presentation={presentation}
      data-resizable={resizable ? 'true' : 'false'}
      data-timeline-resizing={ui.resizing ? 'true' : 'false'}
      data-testid="bottom-workspace"
      data-timeline-expanded={expanded ? 'true' : 'false'}
      hidden={hidden}
      ref={workspaceRef}
      style={
        {
          '--timeline-expanded-height': `${ui.expandedHeightPx}px`,
          '--timeline-expanded-max-height': `${ui.expandedHeightMaxPx}px`,
        } as React.CSSProperties
      }
    >
      {resizable && ui.expanded ? (
        <div
          aria-label="调整时间轴高度"
          aria-orientation="vertical"
          aria-valuemax={ui.expandedHeightMaxPx}
          aria-valuemin={TIMELINE_EXPANDED_MIN_HEIGHT}
          aria-valuenow={ui.expandedHeightPx}
          aria-valuetext={`${ui.expandedHeightPx}px`}
          className="timeline-resize-handle"
          data-resizing={ui.resizing ? 'true' : 'false'}
          data-testid="timeline-resize-handle"
          role="separator"
          tabIndex={0}
          onKeyDown={handleResizeKeyDown}
          onPointerCancel={finishResize}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResize}
        >
          <span className="timeline-resize-grip" aria-hidden="true" />
        </div>
      ) : null}
      <TimelineDock presentation={presentation} />
      {showHistoryControls ? <HistoryControls presentation="bottom" /> : null}
    </section>
  );
}
