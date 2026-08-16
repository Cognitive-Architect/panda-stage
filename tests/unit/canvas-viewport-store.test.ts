import { describe, expect, it, vi } from 'vitest';
import { migrateProject } from '../../src/domain';
import { CanvasViewportStore } from '../../src/renderer/stores/canvasViewportStore';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('CanvasViewportStore', () => {
  it('keeps viewport state in the renderer session only', () => {
    const project = migrateProject(exampleProject);
    const editor = new EditorProjectStore();
    const editorListener = vi.fn();
    editor.open('D:\\project.pandastage', project);
    editor.subscribe(editorListener);
    const beforeProject = JSON.stringify(editor.getSnapshot()!.project);
    const beforeLayers = JSON.stringify(
      editor.getSnapshot()!.project.shots[0]!.layers,
    );

    const viewport = new CanvasViewportStore();
    viewport.setMode('actual');
    viewport.recordStagePoint({ x: 960, y: 540 });

    expect(viewport.getSnapshot()).toEqual({
      mode: 'actual',
      lastStagePoint: { x: 960, y: 540 },
    });
    expect(JSON.stringify(editor.getSnapshot()!.project)).toBe(
      beforeProject,
    );
    expect(
      JSON.stringify(editor.getSnapshot()!.project.shots[0]!.layers),
    ).toBe(beforeLayers);
    expect(editor.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });
    expect(editorListener).not.toHaveBeenCalled();
  });
});
