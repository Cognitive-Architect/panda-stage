/**
 * Issue #162 — editor ActionPreset preview store (transient, no project writes).
 *
 * These are behavioural unit tests over the pure store + model helpers. They run
 * in the repository's `node` vitest environment and drive the clock via an
 * injected ManualClock, so no real animation frame is required. They prove:
 *   T1  bounded lifecycle (start -> advance -> end -> cleanup)
 *   T2  preview adds ZERO revision/history/dirty/serialized-project changes
 *   T3  editor preview frame equals evaluateShotAtTime at the same timeMs
 *   T4  replacement / replay semantics
 *   T5  identity isolation logic (layer/shot/project switch stops the preview)
 *   T6  no timer / rAF leak after finish or stop
 */
import { describe, expect, it } from 'vitest';
import {
  applyPresetEvents,
  createPresetEvents,
  evaluateShotAtTime,
} from '../../../../src/domain';
import {
  editorProjectStore,
  type EditorProjectSnapshot,
} from '../../../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../../../src/renderer/stores/shotStore';
import {
  EditorActionPreviewStore,
  type PreviewClock,
} from '../../../../src/renderer/features/actions/editorActionPreviewStore';
import {
  evaluatePreviewFrame,
  isPreviewIdentityMatch,
  previewWindowFromEvents,
} from '../../../../src/renderer/features/actions/editorActionPreviewModel';
import { buildProject, IDS } from '../../domain/testProject';

/** Deterministic clock the test fully controls. */
class ManualClock implements PreviewClock {
  t = 0;
  private cb: ((now: number) => void) | null = null;
  now(): number {
    return this.t;
  }
  requestFrame(callback: (now: number) => void): number {
    this.cb = callback;
    return 1;
  }
  cancelFrame(): void {
    this.cb = null;
  }
  /** Advance time and fire exactly one pending frame. */
  advance(ms: number): void {
    this.t += ms;
    const cb = this.cb;
    this.cb = null;
    if (cb) cb(this.t);
  }
  get pending(): boolean {
    return this.cb !== null;
  }
}

function openProject(): EditorProjectSnapshot {
  editorProjectStore.open('preview-test.pandastage', buildProject());
  shotStore.select(IDS.shot);
  return editorProjectStore.getSnapshot()!;
}

describe('editor action preview store', () => {
  it('T1: bounded lifecycle runs startMs -> endMs then stops with no leak', () => {
    const store = new EditorActionPreviewStore();
    const clock = new ManualClock();
    store.setClock(clock);

    expect(
      store.start({
        projectId: 'p',
        shotId: 's',
        layerId: 'l',
        startMs: 0,
        endMs: 1000,
      }),
    ).toBe(true);
    expect(store.getState().active).toBe(true);
    expect(store.getState().timeMs).toBe(0);

    clock.advance(400);
    expect(store.getState().timeMs).toBe(400);
    expect(store.getState().active).toBe(true);

    clock.advance(400);
    expect(store.getState().timeMs).toBe(800);

    clock.advance(400); // 1200 >= 1000 -> clamps to 1000 and ends
    expect(store.getState().timeMs).toBe(1000);
    expect(store.getState().active).toBe(false);
    expect(clock.pending).toBe(false);
  });

  it('T2: apply+preview yields exactly one revision (from apply); preview adds none', () => {
    const before = openProject();
    const revBefore = before.revision;

    // Apply a preset exactly as the bridge does (this is the only writer).
    const events = createPresetEvents(
      editorProjectStore.getSnapshot()!.project,
      IDS.shot,
      IDS.layerChar,
      'fade-in',
    );
    const next = applyPresetEvents(
      editorProjectStore.getSnapshot()!.project,
      IDS.shot,
      events,
    );
    editorProjectStore.updateProject(next, 'apply');
    const revAfterApply = editorProjectStore.getSnapshot()!.revision;
    expect(revAfterApply).toBe(revBefore + 1);

    // Run the preview over the new event window.
    const window = previewWindowFromEvents(events)!;
    const store = new EditorActionPreviewStore();
    const clock = new ManualClock();
    store.setClock(clock);
    store.start({
      projectId: editorProjectStore.getSnapshot()!.project.id,
      shotId: IDS.shot,
      layerId: IDS.layerChar,
      startMs: window.startMs,
      endMs: window.endMs,
    });
    clock.advance(100_000); // fast-forward past the end
    store.stop();

    const after = editorProjectStore.getSnapshot()!;
    expect(after.revision).toBe(revAfterApply); // preview added nothing
    expect(after.dirty).toBe(true); // only apply set dirty
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
  });

  it('T3: preview frame equals evaluateShotAtTime at the same timeMs', () => {
    const project = buildProject();
    const events = createPresetEvents(
      project,
      IDS.shot,
      IDS.layerChar,
      'move-to',
      { targetX: 1200, targetY: 300 },
    );
    const projectWithEvent = applyPresetEvents(project, IDS.shot, events);
    const shotWithEvent = projectWithEvent.shots[0]!;
    const t = 250;

    const preview = evaluatePreviewFrame(projectWithEvent, shotWithEvent, t);
    const direct = evaluateShotAtTime(shotWithEvent, t, projectWithEvent);
    expect(preview).toEqual(direct);

    const baseLayer = shotWithEvent.layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
    const previewLayer = preview.layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
    expect(previewLayer.x).not.toBe(baseLayer.x); // moved during preview
  });

  it('T4: a new preview replaces the old session; replay restarts the window', () => {
    const store = new EditorActionPreviewStore();
    const clock = new ManualClock();
    store.setClock(clock);

    expect(
      store.start({
        projectId: 'p',
        shotId: 's',
        layerId: 'l',
        startMs: 0,
        endMs: 1000,
      }),
    ).toBe(true);
    clock.advance(300);
    expect(store.getState().timeMs).toBe(300);

    // Replacement
    expect(
      store.start({
        projectId: 'p2',
        shotId: 's2',
        layerId: 'l2',
        startMs: 100,
        endMs: 500,
      }),
    ).toBe(true);
    expect(store.getState().timeMs).toBe(100); // reset to new start
    expect(store.getState().session?.layerId).toBe('l2');
    clock.advance(50);
    expect(store.getState().timeMs).toBe(150);

    // Finish first session (session retained for replay)
    clock.advance(100_000);
    expect(store.getState().active).toBe(false);
    expect(store.getState().session?.layerId).toBe('l2');

    // Replay
    store.replay();
    expect(store.getState().active).toBe(true);
    expect(store.getState().timeMs).toBe(100);
    clock.advance(100_000);
    expect(store.getState().timeMs).toBe(500);
    expect(store.getState().active).toBe(false);
  });

  it('T5: identity guard matches only the same project/shot/layer', () => {
    const session = {
      projectId: 'p',
      shotId: 's',
      layerId: 'l',
      startMs: 0,
      endMs: 100,
    };
    expect(
      isPreviewIdentityMatch(session, {
        projectId: 'p',
        shotId: 's',
        layerId: 'l',
      }),
    ).toBe(true);
    expect(
      isPreviewIdentityMatch(session, {
        projectId: 'p',
        shotId: 's',
        layerId: 'OTHER',
      }),
    ).toBe(false);
    expect(
      isPreviewIdentityMatch(session, {
        projectId: 'p',
        shotId: 'OTHER',
        layerId: 'l',
      }),
    ).toBe(false);
    expect(
      isPreviewIdentityMatch(session, {
        projectId: 'OTHER',
        shotId: 's',
        layerId: 'l',
      }),
    ).toBe(false);
    expect(
      isPreviewIdentityMatch(session, {
        projectId: null,
        shotId: null,
        layerId: null,
      }),
    ).toBe(false);
  });

  it('T6: no animation-frame / timer leak after finish or stop', () => {
    const store = new EditorActionPreviewStore();
    const clock = new ManualClock();
    store.setClock(clock);

    store.start({
      projectId: 'p',
      shotId: 's',
      layerId: 'l',
      startMs: 0,
      endMs: 1000,
    });
    expect(clock.pending).toBe(true);

    clock.advance(100_000); // finishes naturally
    expect(clock.pending).toBe(false);

    const afterFinish = store.getState();
    clock.advance(500); // no pending frame -> no effect
    expect(store.getState()).toBe(afterFinish);

    // stop also clears
    store.start({
      projectId: 'p',
      shotId: 's',
      layerId: 'l',
      startMs: 0,
      endMs: 1000,
    });
    expect(clock.pending).toBe(true);
    store.stop();
    expect(clock.pending).toBe(false);
    expect(store.getState().active).toBe(false);
  });

  it('previewWindowFromEvents covers exactly the added events', () => {
    const project = buildProject();
    const events = createPresetEvents(
      project,
      IDS.shot,
      IDS.layerChar,
      'move-to',
      { startMs: 200, durationMs: 400, targetX: 1200, targetY: 300 },
    );
    const window = previewWindowFromEvents(events)!;
    expect(window.startMs).toBe(200);
    expect(window.endMs).toBe(600);
    expect(previewWindowFromEvents([])).toBeNull();
  });
});
