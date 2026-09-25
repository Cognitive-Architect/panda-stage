import { describe, expect, it } from 'vitest';
import {
  PositionProjectService,
  type Point,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { PositionAuthoringSessionStore } from '../../src/renderer/stores/positionAuthoringSessionStore';
import { PositionStore } from '../../src/renderer/stores/positionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { ShotService } from '../../src/domain';
import { buildProject, IDS } from '../unit/domain/testProject';

class IntegrationTimeline {
  private readonly state = { currentTimeMs: 1_000 };

  getSnapshot = (): { currentTimeMs: number } => this.state;

  subscribe = (): (() => void) => () => undefined;
}

describe('PK-04 to PK-03 Position write integration', () => {
  it('keeps begin/draft read-only and commits one real Project/History mutation', () => {
    const editor = new EditorProjectStore();
    const shots = new ShotStore(editor, new ShotService());
    const selection = new LayerSelectionStore(editor, shots);
    const timeline = new IntegrationTimeline();
    const positionStore = new PositionStore(
      editor,
      new PositionProjectService({
        now: () => new Date('2026-09-21T00:00:00.000Z'),
      }),
    );
    const authoring = new PositionAuthoringSessionStore({
      editorStore: editor,
      shotSelection: shots,
      layerSelection: selection,
      timeline,
      positionStore,
      createEventId: () => '72000000-0000-4000-8000-000000000001',
    });
    const project = buildProject();
    editor.open('D:\\pk-04-integration.pandastage', project);
    shots.select(IDS.shot);
    selection.select(IDS.layerAsset);

    const before = editor.getSnapshot()!;
    const beforeLayer = before.project.shots[0]!.layers.find(
      (layer) => layer.id === IDS.layerAsset,
    )!;
    const begin = authoring.begin();
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    begin.session.setDraft({ x: 700, y: 800 } satisfies Point);
    expect(editor.getSnapshot()).toBe(before);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });

    const commit = begin.session.commit();
    expect(commit.status).toBe('committed');
    expect(editor.getSnapshot()!.revision).toBe(1);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    expect(
      editor.getSnapshot()!.project.shots[0]!.timelineEvents,
    ).toEqual([
      expect.objectContaining({
        type: 'move',
        layerId: IDS.layerAsset,
        startMs: 0,
        endMs: 1_000,
        from: { x: 500, y: 600 },
        to: { x: 700, y: 800 },
      }),
    ]);
    expect(
      editor.getSnapshot()!.project.shots[0]!.layers.find(
        (layer) => layer.id === IDS.layerAsset,
      ),
    ).toEqual(beforeLayer);

    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project).toEqual(before.project);
    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.timelineEvents).toHaveLength(1);

    authoring.dispose();
    selection.dispose();
    shots.dispose();
  });
});
