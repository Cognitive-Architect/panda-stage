import { describe, expect, it } from 'vitest';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { actionPresetStore } from '../../src/renderer/features/actions/actionPresetStore';
import { applyPresetEvents, createPresetEvents } from '../../src/domain';
import { buildProject, IDS } from '../unit/domain/testProject';

function timelineEventCount(): number {
  return editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents.length;
}

describe('T07 preset application through history', () => {
  it('apply -> undo -> redo round-trips and survives serialization', () => {
    editorProjectStore.open('integ.pandastage', buildProject());
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerChar);

    const events = createPresetEvents(
      editorProjectStore.getSnapshot()!.project,
      IDS.shot,
      IDS.layerChar,
      'fade-in',
    );
    const withEvents = applyPresetEvents(
      editorProjectStore.getSnapshot()!.project,
      IDS.shot,
      events,
    );
    editorProjectStore.updateProject(withEvents, '应用动作预设：淡入');

    expect(timelineEventCount()).toBe(1);

    // undo removes the event
    expect(editorProjectStore.history.undo()).toBe(true);
    expect(timelineEventCount()).toBe(0);

    // redo re-applies the event
    expect(editorProjectStore.history.redo()).toBe(true);
    expect(timelineEventCount()).toBe(1);

    // serialization survives
    const json = JSON.stringify(editorProjectStore.getSnapshot()!.project);
    const reparsed = JSON.parse(json);
    expect(reparsed.shots[0].timelineEvents.length).toBe(1);

    // A reopened project restores the persisted action event as clean state.
    editorProjectStore.open('reopened.pandastage', reparsed);
    expect(timelineEventCount()).toBe(1);
    expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
    expect(editorProjectStore.getSnapshot()!.dirty).toBe(false);
  });

  it('bridge apply routes through history (undo restores prior state)', () => {
    editorProjectStore.open('integ2.pandastage', buildProject());
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerChar);

    const result = actionPresetStore.apply('fade-in');
    expect(result.ok).toBe(true);
    expect(timelineEventCount()).toBe(1);

    editorProjectStore.history.undo();
    expect(timelineEventCount()).toBe(0);

    editorProjectStore.history.redo();
    expect(timelineEventCount()).toBe(1);
  });
});
