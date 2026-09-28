import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DialogueService } from '../../../../src/domain';
import { syncTimelineRulerScroll } from '../../../../src/renderer/features/timeline/TimelineDock';
import { timelineUiStore } from '../../../../src/renderer/features/timeline/timelineUiStore';
import { editorProjectStore } from '../../../../src/renderer/stores/EditorProjectStore';
import { dialogueSelectionStore } from '../../../../src/renderer/stores/dialogueSelectionStore';
import { positionAuthoringSessionStore } from '../../../../src/renderer/stores/positionAuthoringSessionStore';
import { selectionStore } from '../../../../src/renderer/stores/selectionStore';
import { shotStore } from '../../../../src/renderer/stores/shotStore';
import { buildProject, IDS } from '../../domain/testProject';
import { readOrderedStylesheetSource } from '../../../helpers/read-stylesheet-source';

describe('Issue #637 Timeline return to start', () => {
  const returnAndMirrorScroll = (
    durationMs: number,
    rulerScroll: { scrollLeft: number },
  ): void => {
    timelineUiStore.returnToStart(durationMs);
    syncTimelineRulerScroll(rulerScroll, timelineUiStore.getSnapshot().scrollPx);
  };

  it('seeks through the Timeline owner, resets real scroll, and preserves editing context', () => {
    const project = buildProject();
    editorProjectStore.open('D:/r06-return-to-start.pandastage', project);
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerAsset);
    timelineUiStore.setExpanded(true);
    timelineUiStore.setZoom(4);
    timelineUiStore.seek(1_000, project.shots[0]!.durationMs);
    timelineUiStore.setScrollPx(350);
    const rulerScroll = { scrollLeft: 350 };
    const beforeProject = editorProjectStore.getSnapshot();
    const beforeHistory = editorProjectStore.history.getSnapshot();
    const beforeShot = shotStore.getCurrentShotId();
    const beforeSelection = selectionStore.getSelectedLayerId();

    returnAndMirrorScroll(project.shots[0]!.durationMs, rulerScroll);

    expect(timelineUiStore.getSnapshot()).toMatchObject({
      currentTimeMs: 0,
      scrollPx: 0,
      zoom: 4,
      expanded: true,
    });
    expect(rulerScroll.scrollLeft).toBe(0);
    expect(shotStore.getCurrentShotId()).toBe(beforeShot);
    expect(selectionStore.getSelectedLayerId()).toBe(beforeSelection);
    expect(editorProjectStore.getSnapshot()).toBe(beforeProject);
    expect(editorProjectStore.history.getSnapshot()).toBe(beforeHistory);
  });

  it('returns a scrolled viewport at 0 without manufacturing a time change', () => {
    const project = buildProject();
    editorProjectStore.open('D:/r06-base-time-scroll.pandastage', project);
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerAsset);
    timelineUiStore.seek(0, 3_000);
    timelineUiStore.setScrollPx(180);
    const begin = positionAuthoringSessionStore.begin();
    expect(begin.ok).toBe(false);
    if (!begin.ok) expect(begin.error.code).toBe('base-time');
    const rulerScroll = { scrollLeft: 180 };
    const beforeProject = editorProjectStore.getSnapshot();
    const beforeHistory = editorProjectStore.history.getSnapshot();
    const times: number[] = [];
    const unsubscribe = timelineUiStore.subscribe(() => {
      times.push(timelineUiStore.getSnapshot().currentTimeMs);
    });

    returnAndMirrorScroll(3_000, rulerScroll);
    unsubscribe();

    expect(rulerScroll.scrollLeft).toBe(0);
    expect(timelineUiStore.getSnapshot().scrollPx).toBe(0);
    expect(times).toEqual([0]); // scroll state only; seek(0) was a no-op
    expect(editorProjectStore.getSnapshot()).toBe(beforeProject);
    expect(editorProjectStore.history.getSnapshot()).toBe(beforeHistory);

    const alreadyReset = timelineUiStore.getSnapshot();
    rulerScroll.scrollLeft = 75; // DOM and store can temporarily disagree
    returnAndMirrorScroll(3_000, rulerScroll);
    expect(rulerScroll.scrollLeft).toBe(0);
    expect(timelineUiStore.getSnapshot()).toBe(alreadyReset);
  });

  it('keeps a nonzero-time Position draft usable across view-only Timeline updates', () => {
    const project = buildProject();
    editorProjectStore.open('D:/r06-view-only-position.pandastage', project);
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerAsset);
    timelineUiStore.seek(1_000, project.shots[0]!.durationMs);
    timelineUiStore.setScrollPx(180);
    const begin = positionAuthoringSessionStore.begin();
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.session.setDraft({ x: 700, y: 800 }).ok).toBe(true);
    const beforeProject = editorProjectStore.getSnapshot()!;
    const beforeHistory = editorProjectStore.history.getSnapshot();

    timelineUiStore.setScrollPx(0);
    timelineUiStore.setZoom(2);

    expect(begin.session.getSnapshot()?.draft).toEqual({ x: 700, y: 800 });
    expect(editorProjectStore.getSnapshot()).toBe(beforeProject);
    expect(editorProjectStore.history.getSnapshot()).toBe(beforeHistory);
    expect(begin.session.setDraft({ x: 710, y: 810 }).ok).toBe(true);
    expect(begin.session.commit().status).toBe('committed');
    expect(editorProjectStore.getSnapshot()!.revision).toBe(beforeProject.revision + 1);
  });

  it('preserves the selected dialogue when seeking back to zero', () => {
    const project = new DialogueService().create(buildProject(), {
      shotId: IDS.shot,
      characterId: IDS.character,
      text: 'Return-to-start selection',
      pointTimeMs: 1_000,
    });
    editorProjectStore.open('D:/r06-dialogue-selection.pandastage', project);
    shotStore.select(IDS.shot);
    const dialogueId = project.shots[0]!.dialogues[0]!.id;
    dialogueSelectionStore.select(dialogueId);
    timelineUiStore.seek(1_000, project.shots[0]!.durationMs);
    const beforeProject = editorProjectStore.getSnapshot();
    const beforeHistory = editorProjectStore.history.getSnapshot();

    returnAndMirrorScroll(project.shots[0]!.durationMs, { scrollLeft: 160 });

    expect(dialogueSelectionStore.getSelectedDialogueId()).toBe(dialogueId);
    expect(editorProjectStore.getSnapshot()).toBe(beforeProject);
    expect(editorProjectStore.history.getSnapshot()).toBe(beforeHistory);
  });

  it('invalidates an active Position authoring handle through the real seek chain', () => {
    const project = buildProject();
    editorProjectStore.open('D:/r06-position-stale.pandastage', project);
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerAsset);
    timelineUiStore.seek(1_000, project.shots[0]!.durationMs);
    const begin = positionAuthoringSessionStore.begin();
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const beforeProject = editorProjectStore.getSnapshot();
    const beforeHistory = editorProjectStore.history.getSnapshot();

    returnAndMirrorScroll(project.shots[0]!.durationMs, { scrollLeft: 100 });

    expect(begin.session.commit({ x: 700, y: 800 }).status).toBe('stale');
    expect(editorProjectStore.getSnapshot()).toBe(beforeProject);
    expect(editorProjectStore.history.getSnapshot()).toBe(beforeHistory);
  });

  it('exposes one touch-sized toolbar action beside the timecode', () => {
    const source = readFileSync('src/renderer/features/timeline/TimelineDock.tsx', 'utf8');
    const styles = readOrderedStylesheetSource();
    expect(source.indexOf('data-testid="timeline-return-to-start"'))
      .toBeGreaterThan(source.indexOf('data-testid="timeline-timecode"'));
    expect(source.indexOf('data-testid="timeline-return-to-start"'))
      .toBeLessThan(source.indexOf('className="timeline-zoom"'));
    expect(source).toContain('aria-label="回到起点"');
    expect(source).toContain('title="回到起点"');
    expect(source).toContain('onClick={() => timelineUiStore.returnToStart(durationMs)}');
    expect(source).toContain('syncTimelineRulerScroll(scrollRef.current, ui.scrollPx);');
    expect(styles).toContain('.timeline-toolbar .timeline-return-to-start');
    expect(styles).toContain('flex-basis: 44px;');
  });
});
