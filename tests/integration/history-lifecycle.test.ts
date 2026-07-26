import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  LayerService,
  ProjectSchema,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { CharacterStore } from '../../src/renderer/stores/characterStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';

function harness() {
  const project = ProjectSchema.parse(exampleProject);
  const editor = new EditorProjectStore();
  editor.open('D:\\history-a.pandastage', project);
  const shotId = project.shots[0]!.id;
  return {
    project,
    editor,
    characters: new CharacterStore(editor, new CharacterService()),
    layers: new LayerStore(
      editor,
      { getCurrentShotId: () => shotId },
      new LayerService(),
    ),
  };
}

describe('Day 24 history lifecycle', () => {
  it('restores transform, order, delete, expression and dirty state', () => {
    const input = harness();
    const shot = input.project.shots[0]!;
    const layer = shot.layers[1]!;
    const character = input.project.characters[0]!;
    const expression = character.expressions[1]!;

    input.layers.updateTransform(layer.id, {
      x: 800,
      y: 450,
      scale: 1.25,
      rotationDeg: 90,
      opacity: 0.6,
      flipX: true,
    });
    input.layers.reorder(layer.id, 'front');
    input.characters.renameExpression(
      character.id,
      expression.id,
      'Day 24 expression',
    );
    input.layers.deleteLayer(layer.id);
    expect(input.editor.history.getSnapshot().undoCount).toBe(3);
    expect(
      input.editor.getSnapshot()!.project.shots[0]!.layers.some(
        (candidate) => candidate.id === layer.id,
      ),
    ).toBe(false);

    expect(input.editor.undo()).toBe(true);
    expect(
      input.editor.getSnapshot()!.project.shots[0]!.layers.some(
        (candidate) => candidate.id === layer.id,
      ),
    ).toBe(true);
    expect(input.editor.undo()).toBe(true);
    expect(
      input.editor.getSnapshot()!.project.characters[0]!.expressions[1]!
        .name,
    ).toBe(expression.name);
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()).toMatchObject({
      dirty: false,
      project: {
        shots: [
          {
            layers: expect.arrayContaining([
              expect.objectContaining({
                id: layer.id,
                x: layer.x,
                y: layer.y,
                flipX: layer.flipX,
              }),
            ]),
          },
        ],
      },
    });

    for (let index = 0; index < 3; index += 1) {
      expect(input.editor.redo()).toBe(true);
    }
    expect(
      input.editor.getSnapshot()!.project.shots[0]!.layers.some(
        (candidate) => candidate.id === layer.id,
      ),
    ).toBe(false);
  });

  it('does not bypass locked-layer writes and clears history on project open', () => {
    const input = harness();
    const layer = input.project.shots[0]!.layers[1]!;
    input.layers.setLocked(layer.id, true);
    const count = input.editor.history.getSnapshot().undoCount;
    expect(() =>
      input.layers.updatePosition(layer.id, { x: 123, y: 456 }),
    ).toThrow();
    expect(input.editor.history.getSnapshot().undoCount).toBe(count);

    const second = ProjectSchema.parse({
      ...input.project,
      id: 'd2400000-0000-4000-8000-000000000002',
      name: 'Second project',
    });
    input.editor.open('D:\\history-b.pandastage', second);
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
    expect(input.editor.undo()).toBe(false);
  });

  it('keeps editor history out of serialized project JSON', () => {
    const input = harness();
    const layer = input.project.shots[0]!.layers[1]!;
    input.layers.toggleFlipX(layer.id);
    const serialized = JSON.stringify(
      input.editor.getSnapshot()!.project,
    );
    expect(serialized).not.toContain('undoStack');
    expect(serialized).not.toContain('redoStack');
    expect(serialized).not.toContain('history');
  });
});
