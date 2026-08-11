/**
 * Issue #174 — stale position-event conflict at the ActionPreset preview
 * boundary.
 *
 * The preview must keep using the formal evaluator, but it may provide a
 * transient session baseline so historical overlapping position events do not
 * move a newly applied Scale/Shake preview off-canvas. The persisted project
 * and its event list must remain untouched.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPresetEvents,
  createPresetEvents,
  evaluateShotAtTime,
  type Project,
  type TimelineEvent,
} from '../../../../src/domain';
import {
  EditorActionPreviewStore,
  type PreviewClock,
} from '../../../../src/renderer/features/actions/editorActionPreviewStore';
import {
  evaluatePreviewFrame,
  type EditorActionPreviewSession,
} from '../../../../src/renderer/features/actions/editorActionPreviewModel';
import { buildProject, IDS } from '../../domain/testProject';

const STALE_POSITION_EVENTS: TimelineEvent[] = [
  {
    id: '70000000-0000-4000-8000-000000000001',
    layerId: IDS.layerChar,
    startMs: 0,
    endMs: 800,
    type: 'move',
    from: { x: -300, y: 600 },
    to: { x: 500, y: 600 },
    easing: 'ease-in-out',
  },
  {
    id: '70000000-0000-4000-8000-000000000002',
    layerId: IDS.layerChar,
    startMs: 0,
    endMs: 800,
    type: 'move',
    from: { x: -300, y: 600 },
    to: { x: -300, y: 600 },
    easing: 'ease-in-out',
  },
  {
    id: '70000000-0000-4000-8000-000000000003',
    layerId: IDS.layerChar,
    startMs: 0,
    endMs: 800,
    type: 'move',
    from: { x: -300, y: 600 },
    to: { x: -300, y: 600 },
    easing: 'ease-in-out',
  },
];

function staleProject(): Project {
  const project = buildProject();
  const shot = project.shots[0]!;
  shot.layers = shot.layers.map((layer) =>
    layer.id === IDS.layerChar
      ? { ...layer, x: 410, y: 628 }
      : layer,
  );
  shot.timelineEvents = STALE_POSITION_EVENTS.map((event) => ({ ...event }));
  return project;
}

function targetAt(project: Project, timeMs: number) {
  const shot = project.shots[0]!;
  return evaluateShotAtTime(shot, timeMs, project).layers.find(
    (layer) => layer.id === IDS.layerChar,
  )!;
}

function sessionFor(
  project: Project,
  eventIds: readonly string[],
  positionBaseline = { x: 410, y: 628 },
): EditorActionPreviewSession {
  return {
    projectId: project.id,
    shotId: IDS.shot,
    layerId: IDS.layerChar,
    startMs: 0,
    endMs: 800,
    eventIds,
    positionBaseline,
  };
}

describe('Issue #174 stale position events and ActionPreset preview baseline', () => {
  it('Scale Emphasis keeps the current editor position while scale changes', () => {
    const project = staleProject();
    const scaleEvents = createPresetEvents(
      project,
      IDS.shot,
      IDS.layerChar,
      'scale-emphasis',
      { scaleFactor: 2, durationMs: 800 },
      { createId: () => '71000000-0000-4000-8000-000000000001' },
    );
    const applied = applyPresetEvents(project, IDS.shot, scaleEvents);
    const shot = applied.shots[0]!;
    const session = sessionFor(applied, scaleEvents.map((event) => event.id));
    const beforePreview = JSON.stringify(applied);

    expect(targetAt(applied, 400).x).toBe(-300);
    const atStart = evaluatePreviewFrame(applied, shot, 0, session).layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
    const middle = evaluatePreviewFrame(applied, shot, 400, session).layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
    const atEnd = evaluatePreviewFrame(applied, shot, 800, session).layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;

    expect(atStart.x).toBe(410);
    expect(middle.x).toBe(410);
    expect(atEnd.x).toBe(410);
    expect(atStart.scaleX).toBe(0.5);
    expect(middle.scaleX).toBe(0.75);
    expect(atEnd.scaleX).toBe(1);
    expect(JSON.stringify(applied)).toBe(beforePreview);
    expect(shot.timelineEvents).toHaveLength(STALE_POSITION_EVENTS.length + 1);
  });

  it('Shake oscillates around the current editor position instead of stale x=-300', () => {
    const project = staleProject();
    const shakeEvents = createPresetEvents(
      project,
      IDS.shot,
      IDS.layerChar,
      'shake',
      { amplitudeX: 24, amplitudeY: 0, frequencyHz: 6, durationMs: 800 },
      { createId: () => '72000000-0000-4000-8000-000000000001' },
    );
    const applied = applyPresetEvents(project, IDS.shot, shakeEvents);
    const shot = applied.shots[0]!;
    const session = sessionFor(applied, shakeEvents.map((event) => event.id));
    const beforePreview = JSON.stringify(applied);

    const before = targetAt(applied, 50);
    const after = evaluatePreviewFrame(applied, shot, 50, session).layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
    const afterAtZero = evaluatePreviewFrame(
      applied,
      shot,
      0,
      session,
    ).layers.find((layer) => layer.id === IDS.layerChar)!;

    expect(before.x).toBeCloseTo(-277.1746436089163, 6);
    expect(afterAtZero.x).toBe(410);
    expect(after.x).toBeCloseTo(432.8253563910837, 6);
    expect(after.x).not.toBeCloseTo(before.x, 6);
    expect(JSON.stringify(applied)).toBe(beforePreview);
  });

  it('does not add the baseline to explicit left/right entrance previews', () => {
    const project = staleProject();
    const enterEvents = createPresetEvents(
      project,
      IDS.shot,
      IDS.layerChar,
      'enter-left',
      { durationMs: 800 },
      { createId: () => '73000000-0000-4000-8000-000000000001' },
    );
    const applied = applyPresetEvents(project, IDS.shot, enterEvents);
    const shot = applied.shots[0]!;
    const session = sessionFor(applied, enterEvents.map((event) => event.id));
    const atStart = evaluatePreviewFrame(
      applied,
      shot,
      0,
      { ...session, positionBaseline: undefined },
    ).layers.find((layer) => layer.id === IDS.layerChar)!;
    const atEnd = evaluatePreviewFrame(
      applied,
      shot,
      800,
      { ...session, positionBaseline: undefined },
    ).layers.find((layer) => layer.id === IDS.layerChar)!;

    expect(atStart.x).toBe(-300);
    expect(atEnd.x).toBe(410);
  });

  it('keeps the transient baseline through Apply -> finish -> Replay without project writes', () => {
    const project = staleProject();
    const scaleEvents = createPresetEvents(
      project,
      IDS.shot,
      IDS.layerChar,
      'scale-emphasis',
      { durationMs: 800 },
      { createId: () => '74000000-0000-4000-8000-000000000001' },
    );
    const applied = applyPresetEvents(project, IDS.shot, scaleEvents);
    const session = sessionFor(applied, scaleEvents.map((event) => event.id));
    const before = JSON.stringify(applied);
    const store = new EditorActionPreviewStore();
    const clock = new ManualClock();
    store.setClock(clock);

    expect(store.start(session)).toBe(true);
    clock.advance(1000);
    expect(store.getState().active).toBe(false);
    expect(store.getState().session?.positionBaseline).toEqual({
      x: 410,
      y: 628,
    });
    const replaySession = store.getState().session!;
    expect(
      evaluatePreviewFrame(
        applied,
        applied.shots[0]!,
        400,
        replaySession,
      ).layers.find((layer) => layer.id === IDS.layerChar)!.x,
    ).toBe(410);

    store.replay();
    expect(store.getState().active).toBe(true);
    expect(store.getState().timeMs).toBe(0);
    expect(JSON.stringify(applied)).toBe(before);
  });
});

class ManualClock implements PreviewClock {
  private nowMs = 0;
  private pending: ((now: number) => void) | null = null;

  now(): number {
    return this.nowMs;
  }

  requestFrame(callback: (now: number) => void): number {
    this.pending = callback;
    return 1;
  }

  cancelFrame(): void {
    this.pending = null;
  }

  advance(ms: number): void {
    this.nowMs += ms;
    const callback = this.pending;
    this.pending = null;
    callback?.(this.nowMs);
  }
}
