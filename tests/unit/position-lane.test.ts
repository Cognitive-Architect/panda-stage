import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PositionProjectService, ProjectSchema, type Project } from '../../src/domain';
import { seekPositionMarker } from '../../src/renderer/features/timeline/PositionKeyMarker';
import { PositionLane, recognizeSelectedPositionLane } from '../../src/renderer/features/timeline/PositionLane';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { PositionStore } from '../../src/renderer/stores/positionStore';
import { buildProject, IDS } from './domain/testProject';

function projectWithKeys(): Project {
  const base = buildProject();
  const root = base.shots[0]!.layers.find((layer) => layer.id === IDS.layerChar)!;
  return ProjectSchema.parse({
    ...base,
    shots: [{
      ...base.shots[0]!,
      timelineEvents: [
        { id: '90000000-0000-4000-8000-000000000701', type: 'move', layerId: root.id,
          startMs: 0, endMs: 1_000, from: { x: root.x, y: root.y },
          to: { x: 600, y: 650 }, easing: 'linear' },
        { id: '90000000-0000-4000-8000-000000000702', type: 'move', layerId: root.id,
          startMs: 1_000, endMs: 2_000, from: { x: 600, y: 650 },
          to: { x: 700, y: 700 }, easing: 'linear' },
      ],
    }],
  });
}

describe('Issue #647 PK-06 Position lane read and navigation', () => {
  it('shows only the selected editable root and its logical Base + Keys without a write', () => {
    const editor = new EditorProjectStore();
    editor.open('D:/pk06.pandastage', projectWithKeys());
    const before = editor.getSnapshot()!;
    const shot = before.project.shots[0]!;
    const selected = recognizeSelectedPositionLane(shot, IDS.layerChar);
    expect(selected?.recognition.status).toBe('editable');
    if (!selected || selected.recognition.status !== 'editable') return;
    expect(selected.recognition.chain.points.map((point) => point.timeMs))
      .toEqual([0, 1_000, 2_000]);
    const markup = renderToStaticMarkup(createElement(PositionLane, {
      shot, layer: selected.layer, currentTimeMs: 1_000,
      pixelsPerMs: 0.2, trackWidth: 600, snapshot: before,
    }));
    expect(markup).toContain('人物位置');
    expect(markup).toContain('data-testid="position-base-marker"');
    expect(markup.match(/data-testid="position-key-marker"/gu)).toHaveLength(2);
    expect(markup).toContain('aria-current="time"');
    expect(markup).toContain('left:200px');
    expect(markup).toContain('left:400px');
    expect(recognizeSelectedPositionLane(shot, null)).toBeNull();
    expect(recognizeSelectedPositionLane(shot, IDS.layerBg)).toBeNull();
    expect(recognizeSelectedPositionLane({
      ...shot,
      layers: shot.layers.map((layer) => layer.id === IDS.layerChar ? { ...layer, locked: true } : layer),
    }, IDS.layerChar)).toBeNull();
    expect(recognizeSelectedPositionLane(shot, IDS.layerAsset)?.recognition.status).toBe('none');
    expect(editor.getSnapshot()).toBe(before);
    expect(editor.history.getSnapshot().undoCount).toBe(0);
  });

  it('keeps legacy playback-only movement read-only and unmodified', () => {
    const project = projectWithKeys();
    const shot = {
      ...project.shots[0]!,
      timelineEvents: project.shots[0]!.timelineEvents.map((event) =>
        event.type === 'move' ? { ...event, easing: 'ease-in-out' as const } : event),
    };
    const before = JSON.stringify(shot);
    const selected = recognizeSelectedPositionLane(shot, IDS.layerChar);
    expect(selected?.recognition.status).toBe('playback-only');
    const editor = new EditorProjectStore();
    editor.open('D:/pk06-legacy.pandastage', project);
    const markup = renderToStaticMarkup(createElement(PositionLane, {
      shot, layer: selected!.layer, currentTimeMs: 0,
      pixelsPerMs: 0.2, trackWidth: 600, snapshot: editor.getSnapshot()!,
    }));
    expect(markup).toContain('旧动画 · 只读');
    expect(markup).not.toContain('position-key-marker');
    expect(markup).not.toContain('non-linear-easing');
    expect(JSON.stringify(shot)).toBe(before);
  });

  it('uses one playhead truth for click navigation without Project/History writes', () => {
    const editor = new EditorProjectStore();
    editor.open('D:/pk06-navigation.pandastage', projectWithKeys());
    const before = editor.getSnapshot()!;
    timelineUiStore.seek(0, 3_000);
    seekPositionMarker(1_000, 3_000);
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1_000);
    expect(editor.getSnapshot()).toBe(before);
    expect(editor.getSnapshot()).toMatchObject({ revision: 0, dirty: false });
    expect(editor.history.getSnapshot().undoCount).toBe(0);
  });

  it('renders a Hold as an ordinary non-Base key', () => {
    const editor = new EditorProjectStore();
    editor.open('D:/pk06-hold.pandastage', projectWithKeys());
    const position = new PositionStore(editor, new PositionProjectService());
    const shotId = editor.getSnapshot()!.project.shots[0]!.id;
    position.createHold(shotId, IDS.layerChar, {
      timeMs: 2_500,
      eventId: '90000000-0000-4000-8000-000000000703',
    });
    const snapshot = editor.getSnapshot()!;
    const selected = recognizeSelectedPositionLane(snapshot.project.shots[0]!, IDS.layerChar)!;
    expect(selected.recognition.status).toBe('editable');
    if (selected.recognition.status !== 'editable') return;
    expect(selected.recognition.chain.points.at(-1)).toMatchObject({ timeMs: 2_500, kind: 'key' });
    const markup = renderToStaticMarkup(createElement(PositionLane, {
      shot: snapshot.project.shots[0]!, layer: selected.layer,
      currentTimeMs: 2_500, pixelsPerMs: 0.2, trackWidth: 600, snapshot,
    }));
    expect(markup.match(/data-testid="position-key-marker"/gu)).toHaveLength(3);
    expect(markup.match(/data-testid="position-base-marker"/gu)).toHaveLength(1);
  });
});
