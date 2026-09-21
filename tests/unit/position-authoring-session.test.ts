import { describe, expect, it } from 'vitest';
import {
  evaluateLayerMotionAtTime,
  PositionProjectService,
  ProjectSchema,
  type Point,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import {
  PositionAuthoringSessionStore,
  type PositionAuthoringTimelineSelection,
} from '../../src/renderer/stores/positionAuthoringSessionStore';
import { PositionStore } from '../../src/renderer/stores/positionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { ShotService } from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const BASE: Point = { x: 500, y: 600 };
const FIRST_KEY: Point = { x: 700, y: 800 };
const INSERTED: Point = { x: 800, y: 400 };
const APPENDED: Point = { x: 1_100, y: 300 };
const UPDATED: Point = { x: 1_200, y: 200 };

const MOVE_A = '70000000-0000-4000-8000-000000000001';
const MOVE_B = '70000000-0000-4000-8000-000000000002';
const SHAKE = '70000000-0000-4000-8000-000000000003';
const NEW_MOVE = '70000000-0000-4000-8000-000000000004';

function move(
  id: string,
  startMs: number,
  endMs: number,
  from: Point,
  to: Point,
) {
  return {
    id,
    type: 'move' as const,
    layerId: IDS.layerAsset,
    startMs,
    endMs,
    from,
    to,
    easing: 'linear' as const,
  };
}

function projectWithPositionChain(options: { withShake?: boolean } = {}): Project {
  const project = buildProject();
  const shot = project.shots[0]!;
  return ProjectSchema.parse({
    ...project,
    shots: [
      {
        ...shot,
        timelineEvents: options.withShake
          ? [
              move(MOVE_A, 0, 2_000, BASE, FIRST_KEY),
              {
                id: SHAKE,
                type: 'shake' as const,
                layerId: IDS.layerAsset,
                startMs: 1_000,
                endMs: 1_500,
                amplitudeX: 20,
                amplitudeY: 10,
                frequencyHz: 1,
              },
            ]
          : [
              move(MOVE_A, 0, 1_000, BASE, FIRST_KEY),
              move(MOVE_B, 1_000, 2_000, FIRST_KEY, APPENDED),
            ],
      },
    ],
  });
}

function projectWithPlaybackOnlyChain(): Project {
  const project = buildProject();
  const shot = project.shots[0]!;
  return ProjectSchema.parse({
    ...project,
    shots: [
      {
        ...shot,
        timelineEvents: [
          {
            ...move(MOVE_A, 0, 1_000, BASE, FIRST_KEY),
            easing: 'ease-in-out' as const,
          },
        ],
      },
    ],
  });
}

class TestTimeline implements PositionAuthoringTimelineSelection {
  private state: { currentTimeMs: number };
  private readonly listeners = new Set<() => void>();

  constructor(currentTimeMs: number) {
    this.state = { currentTimeMs };
  }

  getSnapshot = (): { currentTimeMs: number } => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setTime(currentTimeMs: number): void {
    if (this.state.currentTimeMs === currentTimeMs) return;
    this.state = { currentTimeMs };
    for (const listener of this.listeners) listener();
  }
}

interface Harness {
  readonly editor: EditorProjectStore;
  readonly shots: ShotStore;
  readonly selection: LayerSelectionStore;
  readonly timeline: TestTimeline;
  readonly positionStore: PositionStore;
  readonly authoring: PositionAuthoringSessionStore;
  dispose(): void;
}

function harness(
  project: Project = buildProject(),
  timeMs = 1_000,
): Harness {
  const editor = new EditorProjectStore();
  const shots = new ShotStore(editor, new ShotService());
  const selection = new LayerSelectionStore(editor, shots);
  const timeline = new TestTimeline(timeMs);
  const positionStore = new PositionStore(
    editor,
    new PositionProjectService({
      now: () => new Date('2026-09-21T00:00:00.000Z'),
    }),
  );
  let eventNumber = 0;
  const nextEventId = () =>
    `71000000-0000-4000-8000-${String(++eventNumber).padStart(12, '0')}`;
  const authoring = new PositionAuthoringSessionStore({
    editorStore: editor,
    shotSelection: shots,
    layerSelection: selection,
    timeline,
    positionStore,
    createEventId: nextEventId,
  });

  editor.open('D:\\pk-04.pandastage', project);
  shots.select(project.shots[0]!.id);
  selection.select(IDS.layerAsset);

  return {
    editor,
    shots,
    selection,
    timeline,
    positionStore,
    authoring,
    dispose: () => {
      authoring.dispose();
      selection.dispose();
      shots.dispose();
    },
  };
}

function positionEvents(project: Project): Project['shots'][number]['timelineEvents'] {
  return project.shots[0]!.timelineEvents.filter(
    (event) => event.type === 'move' && event.layerId === IDS.layerAsset,
  );
}

function expectNoProjectWrite(input: Harness, before = input.editor.getSnapshot()!) {
  expect(input.editor.getSnapshot()).toBe(before);
  expect(input.editor.getSnapshot()!.project).toBe(before.project);
  expect(input.editor.getSnapshot()).toMatchObject({
    dirty: before.dirty,
    revision: before.revision,
  });
  expect(input.editor.history.getSnapshot()).toMatchObject({
    undoCount: 0,
    redoCount: 0,
  });
}

describe('PK-04 Position authoring session', () => {
  it('begins read-only, drafts from main Position, and never samples Shake display coordinates', () => {
    const input = harness(projectWithPositionChain({ withShake: true }), 1_250);
    const before = input.editor.getSnapshot()!;
    const beforeJson = JSON.stringify(before.project);

    const result = input.authoring.begin();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot).toMatchObject({
      timeMs: 1_250,
      mainPosition: { x: 625, y: 725 },
      draft: { x: 625, y: 725 },
      hasExistingKey: false,
    });
    const display = evaluateLayerMotionAtTime(
      before.project.shots[0]!.layers[1]!,
      before.project.shots[0]!.timelineEvents,
      1_250,
    ).displayPosition;
    expect(display).toEqual({ x: 645, y: 735 });
    expect(result.snapshot.draft).not.toEqual(display);
    expect(JSON.stringify(before.project)).toBe(beforeJson);
    expectNoProjectWrite(input, before);

    result.session.setDraft({ x: 700, y: 800 });
    result.session.setDraft({ x: 750, y: 850 });
    result.session.setDraft({ x: 625, y: 725 });
    expect(JSON.stringify(input.editor.getSnapshot()!.project)).toBe(beforeJson);
    expectNoProjectWrite(input, before);

    result.session.exit();
    expect(input.authoring.getSnapshot()).toBeNull();
    input.dispose();
  });

  it('does not allocate a new event id when begin is read-only', () => {
    const input = harness(buildProject(), 1_000);
    let allocations = 0;
    const store = new PositionAuthoringSessionStore({
      editorStore: input.editor,
      shotSelection: input.shots,
      layerSelection: input.selection,
      timeline: input.timeline,
      positionStore: input.positionStore,
      createEventId: () => {
        allocations += 1;
        return NEW_MOVE;
      },
    });

    const result = store.begin();
    expect(result.ok).toBe(true);
    expect(allocations).toBe(0);
    if (result.ok) result.session.cancel();
    store.dispose();
    input.dispose();
  });

  it.each([
    ['0:00 Base', buildProject(), 0, 'base-time'],
    ['background Layer', buildProject(), 1_000, 'background-target'],
    ['locked Layer', ProjectSchema.parse({
      ...buildProject(),
      shots: [{
        ...buildProject().shots[0]!,
        layers: buildProject().shots[0]!.layers.map((layer) =>
          layer.id === IDS.layerAsset ? { ...layer, locked: true } : layer,
        ),
      }],
    }), 1_000, 'locked-target'],
    ['playback-only chain', projectWithPlaybackOnlyChain(), 1_000, 'playback-only'],
  ] as const)('rejects %s without writing the Project', (_label, project, timeMs, code) => {
    const input = harness(project, timeMs);
    if (code === 'background-target') {
      input.selection.selectBackground();
    }
    const before = input.editor.getSnapshot()!;
    const result = input.authoring.begin();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
    expectNoProjectWrite(input, before);
    input.dispose();
  });

  it('rejects missing selection, a closed Project, and an off-grid Shot end', () => {
    const missingSelection = harness(buildProject(), 1_000);
    missingSelection.selection.clear();
    const missingSelectionBefore = missingSelection.editor.getSnapshot()!;
    const missingSelectionResult = missingSelection.authoring.begin();
    expect(missingSelectionResult.ok).toBe(false);
    if (!missingSelectionResult.ok) {
      expect(missingSelectionResult.error.code).toBe('layer-not-selected');
    }
    expectNoProjectWrite(missingSelection, missingSelectionBefore);
    missingSelection.dispose();

    const closed = harness(buildProject(), 1_000);
    closed.editor.clear();
    const closedResult = closed.authoring.begin();
    expect(closedResult.ok).toBe(false);
    if (!closedResult.ok) {
      expect(closedResult.error.code).toBe('project-not-open');
    }
    closed.dispose();

    const offGridProject = ProjectSchema.parse({
      ...buildProject(),
      shots: [{ ...buildProject().shots[0]!, durationMs: 4_321 }],
    });
    const offGrid = harness(offGridProject, 4_321);
    const offGridBefore = offGrid.editor.getSnapshot()!;
    const offGridResult = offGrid.authoring.begin();
    expect(offGridResult.ok).toBe(false);
    if (!offGridResult.ok) {
      expect(offGridResult.error.code).toBe('invalid-time');
    }
    expectNoProjectWrite(offGrid, offGridBefore);
    offGrid.dispose();
  });

  it('keeps repeated drafts read-only, then commits one first key as one History unit', () => {
    const input = harness(buildProject(), 1_000);
    const before = input.editor.getSnapshot()!;
    const begin = input.authoring.begin();
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;

    begin.session.setDraft({ x: 600, y: 650 });
    begin.session.setDraft({ x: 650, y: 700 });
    begin.session.setDraft(FIRST_KEY);
    expectNoProjectWrite(input, before);

    const commit = begin.session.commit();
    expect(commit.status).toBe('committed');
    if (commit.status !== 'committed') return;
    expect(input.editor.getSnapshot()).toMatchObject({ dirty: true, revision: 1 });
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    expect(positionEvents(input.editor.getSnapshot()!.project)).toEqual([
      expect.objectContaining({
        startMs: 0,
        endMs: 1_000,
        from: BASE,
        to: FIRST_KEY,
      }),
    ]);
    expect(commit.snapshot.hasExistingKey).toBe(true);
    expect(begin.session.commit(UPDATED).status).toBe('stale');

    const secondCommit = commit.session.commit(UPDATED);
    expect(secondCommit.status).toBe('committed');
    expect(positionEvents(input.editor.getSnapshot()!.project)).toHaveLength(1);
    expect(positionEvents(input.editor.getSnapshot()!.project)[0]).toMatchObject({
      to: UPDATED,
    });
    expect(input.editor.getSnapshot()!.revision).toBe(2);
    expect(input.editor.history.getSnapshot().undoCount).toBe(2);
    input.dispose();
  });

  it('keeps enter/exit and same-position commits at zero writes', () => {
    const input = harness(projectWithPositionChain(), 1_000);
    const before = input.editor.getSnapshot()!;
    const begin = input.authoring.begin();
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.snapshot.draft).toEqual(FIRST_KEY);
    expect(begin.session.commit(FIRST_KEY).status).toBe('no-op');
    expectNoProjectWrite(input, before);
    begin.session.cancel();
    expect(input.authoring.getSnapshot()).toBeNull();
    input.dispose();
  });

  it('updates an existing key, inserts inside a tween, and appends after the last key', () => {
    const existing = harness(projectWithPositionChain(), 1_000);
    const existingBegin = existing.authoring.begin();
    expect(existingBegin.ok).toBe(true);
    if (existingBegin.ok) {
      const committed = existingBegin.session.commit(UPDATED);
      expect(committed.status).toBe('committed');
      expect(positionEvents(existing.editor.getSnapshot()!.project)).toHaveLength(2);
      expect(positionEvents(existing.editor.getSnapshot()!.project)[0]).toMatchObject({
        to: UPDATED,
      });
    }
    existing.dispose();

    const inserted = harness(projectWithPositionChain(), 500);
    const insertBegin = inserted.authoring.begin();
    expect(insertBegin.ok).toBe(true);
    if (insertBegin.ok) {
      expect(insertBegin.session.commit(INSERTED).status).toBe('committed');
      expect(positionEvents(inserted.editor.getSnapshot()!.project)).toHaveLength(3);
      expect(
        [...positionEvents(inserted.editor.getSnapshot()!.project)].sort(
          (left, right) => left.startMs - right.startMs,
        ),
      ).toEqual([
        expect.objectContaining({ startMs: 0, endMs: 500, to: INSERTED }),
        expect.objectContaining({ startMs: 500, endMs: 1_000, from: INSERTED }),
        expect.objectContaining({ startMs: 1_000, endMs: 2_000 }),
      ]);
    }
    inserted.dispose();

    const appended = harness(projectWithPositionChain(), 2_500);
    const appendBegin = appended.authoring.begin();
    expect(appendBegin.ok).toBe(true);
    if (appendBegin.ok) {
      expect(appendBegin.session.commit(UPDATED).status).toBe('committed');
      expect(positionEvents(appended.editor.getSnapshot()!.project)).toHaveLength(3);
      expect(positionEvents(appended.editor.getSnapshot()!.project).at(-1)).toMatchObject({
        startMs: 2_000,
        endMs: 2_500,
        to: UPDATED,
      });
    }
    appended.dispose();
  });

  it('rejects non-finite and out-of-canvas drafts without a Project write', () => {
    const input = harness(buildProject(), 1_000);
    const begin = input.authoring.begin();
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const before = input.editor.getSnapshot()!;

    begin.session.setDraft({ x: Number.NaN, y: 100 });
    expect(begin.session.commit().status).toBe('rejected');
    expectNoProjectWrite(input, before);
    begin.session.setDraft({ x: -1, y: 100 });
    expect(begin.session.commit().status).toBe('rejected');
    expectNoProjectWrite(input, before);
    input.dispose();
  });

  it('invalidates old callbacks when Timeline, selection, Shot, or Project context changes', () => {
    const timeChanged = harness(buildProject(), 1_000);
    const timeBegin = timeChanged.authoring.begin();
    expect(timeBegin.ok).toBe(true);
    if (timeBegin.ok) {
      timeBegin.session.setDraft(FIRST_KEY);
      const before = timeChanged.editor.getSnapshot()!;
      timeChanged.timeline.setTime(1_500);
      expect(timeBegin.session.commit().status).toBe('stale');
      expectNoProjectWrite(timeChanged, before);
    }
    timeChanged.dispose();

    const selectionChanged = harness(buildProject(), 1_000);
    const selectionBegin = selectionChanged.authoring.begin();
    expect(selectionBegin.ok).toBe(true);
    if (selectionBegin.ok) {
      const before = selectionChanged.editor.getSnapshot()!;
      selectionChanged.selection.select(IDS.layerChar);
      expect(selectionBegin.session.commit(FIRST_KEY).status).toBe('stale');
      expectNoProjectWrite(selectionChanged, before);
    }
    selectionChanged.dispose();

    const projectChanged = harness(buildProject(), 1_000);
    const projectBegin = projectChanged.authoring.begin();
    expect(projectBegin.ok).toBe(true);
    if (projectBegin.ok) {
      const before = projectChanged.editor.getSnapshot()!;
      projectChanged.editor.updateProject(
        ProjectSchema.parse({
          ...before.project,
          name: 'External mutation',
        }),
        'External mutation',
      );
      const afterExternal = projectChanged.editor.getSnapshot()!;
      expect(projectBegin.session.commit(FIRST_KEY).status).toBe('stale');
      expect(projectChanged.editor.getSnapshot()).toBe(afterExternal);
      expect(projectChanged.editor.history.getSnapshot().undoCount).toBe(1);
    }
    projectChanged.dispose();
  });

  it('invalidates on Shot switch, target deletion, locking, Undo, and same-path reopen', () => {
    const base = buildProject();
    const secondShot = structuredClone(base.shots[0]!);
    secondShot.id = '51000000-0000-4000-8000-000000000001';
    secondShot.name = 'Second shot';
    secondShot.layers = secondShot.layers.map((layer, index) => ({
      ...layer,
      id: `61000000-0000-4000-8000-00000000000${index + 1}`,
    }));
    secondShot.backgroundLayerId = secondShot.layers[0]!.id;
    const withSecondShot = ProjectSchema.parse({
      ...base,
      shots: [base.shots[0]!, secondShot],
    });
    const shotChanged = harness(withSecondShot, 1_000);
    const shotBegin = shotChanged.authoring.begin();
    expect(shotBegin.ok).toBe(true);
    if (shotBegin.ok) {
      const before = shotChanged.editor.getSnapshot()!;
      shotChanged.shots.select(secondShot.id);
      expect(shotBegin.session.commit(FIRST_KEY).status).toBe('stale');
      expectNoProjectWrite(shotChanged, before);
    }
    shotChanged.dispose();

    const deleted = harness(buildProject(), 1_000);
    const deletedBegin = deleted.authoring.begin();
    expect(deletedBegin.ok).toBe(true);
    if (deletedBegin.ok) {
      const before = deleted.editor.getSnapshot()!;
      deleted.editor.updateProject(
        ProjectSchema.parse({
          ...before.project,
          shots: [{
            ...before.project.shots[0]!,
            layers: before.project.shots[0]!.layers.filter(
              (layer) => layer.id !== IDS.layerAsset,
            ),
          }],
        }),
        'Delete target',
      );
      const afterDelete = deleted.editor.getSnapshot()!;
      expect(deletedBegin.session.commit(FIRST_KEY).status).toBe('stale');
      expect(deleted.editor.getSnapshot()).toBe(afterDelete);
    }
    deleted.dispose();

    const locked = harness(buildProject(), 1_000);
    const lockedBegin = locked.authoring.begin();
    expect(lockedBegin.ok).toBe(true);
    if (lockedBegin.ok) {
      const before = locked.editor.getSnapshot()!;
      locked.editor.updateProject(
        ProjectSchema.parse({
          ...before.project,
          shots: [{
            ...before.project.shots[0]!,
            layers: before.project.shots[0]!.layers.map((layer) =>
              layer.id === IDS.layerAsset ? { ...layer, locked: true } : layer,
            ),
          }],
        }),
        'Lock target',
      );
      const afterLock = locked.editor.getSnapshot()!;
      expect(lockedBegin.session.commit(FIRST_KEY).status).toBe('stale');
      expect(locked.editor.getSnapshot()).toBe(afterLock);
    }
    locked.dispose();

    const undo = harness(projectWithPositionChain(), 1_500);
    const undoBegin = undo.authoring.begin();
    expect(undoBegin.ok).toBe(true);
    if (undoBegin.ok) {
      undo.positionStore.updateKey(IDS.shot, IDS.layerAsset, {
        timeMs: 1_000,
        position: UPDATED,
      });
      expect(undo.editor.undo()).toBe(true);
      const afterUndo = undo.editor.getSnapshot()!;
      expect(undoBegin.session.commit(UPDATED).status).toBe('stale');
      expect(undo.editor.getSnapshot()).toBe(afterUndo);
    }
    undo.dispose();

    const reopened = harness(buildProject(), 1_000);
    const reopenBegin = reopened.authoring.begin();
    expect(reopenBegin.ok).toBe(true);
    if (reopenBegin.ok) {
      const before = reopened.editor.getSnapshot()!;
      reopened.editor.open('D:\\pk-04.pandastage', structuredClone(base));
      const afterReopen = reopened.editor.getSnapshot()!;
      expect(afterReopen.project.id).toBe(before.project.id);
      expect(afterReopen.projectRoot).toBe(before.projectRoot);
      expect(afterReopen.revision).toBe(0);
      expect(reopenBegin.session.commit(FIRST_KEY).status).toBe('stale');
      expect(reopened.editor.getSnapshot()).toBe(afterReopen);
    }
    reopened.dispose();
  });

  it('replaces session A with session B without allowing A callbacks to affect B', () => {
    const input = harness(buildProject(), 1_000);
    const first = input.authoring.begin();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = input.authoring.begin();
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const before = input.editor.getSnapshot()!;
    expect(first.session.commit(FIRST_KEY).status).toBe('stale');
    expect(input.authoring.getSnapshot()!.sessionId).toBe(
      second.snapshot.sessionId,
    );
    expectNoProjectWrite(input, before);
    expect(second.session.commit(FIRST_KEY).status).toBe('committed');
    input.dispose();
  });

  it('keeps authoring draft/session state out of Project data and save-shaped snapshots', () => {
    const input = harness(buildProject(), 1_000);
    const begin = input.authoring.begin();
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    begin.session.setDraft(UPDATED);
    const projectJson = JSON.stringify(input.editor.getSnapshot()!.project);
    expect(projectJson).not.toContain('authoring');
    expect(projectJson).not.toContain('draft');
    expect(projectJson).not.toContain('sessionId');
    expect(input.editor.getSnapshot()!.project.shots[0]!.timelineEvents).toEqual([]);
    input.dispose();
  });

  it('uses the existing Position write seam and preserves one undo unit per successful commit', () => {
    const input = harness(projectWithPositionChain(), 1_500);
    const before = input.editor.getSnapshot()!;
    const begin = input.authoring.begin();
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const result = begin.session.commit(UPDATED);
    expect(result.status).toBe('committed');
    expect(input.editor.getSnapshot()!.revision).toBe(before.revision + 1);
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(before.project);
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 1,
    });
    input.dispose();
  });
});
