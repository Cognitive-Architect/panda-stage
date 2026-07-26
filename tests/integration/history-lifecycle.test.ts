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
  const initial = ProjectSchema.parse(exampleProject);
  const shot = initial.shots[0]!;
  const ordinary = shot.layers[1]!;
  const project = ProjectSchema.parse({
    ...initial,
    shots: [
      {
        ...shot,
        layers: [
          ...shot.layers,
          {
            ...ordinary,
            id: 'd2400000-0000-4000-8000-000000000010',
            name: 'Second content layer',
            x: 1_200,
            zIndex: 2,
          },
        ],
      },
    ],
  });
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
    expect(input.editor.history.getSnapshot().undoCount).toBe(4);
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
    expect(
      input.editor.getSnapshot()!.project.shots[0]!.layers.map(
        ({ id, zIndex }) => ({ id, zIndex }),
      ),
    ).toEqual(
      input.project.shots[0]!.layers.map(({ id, zIndex }) => ({
        id,
        zIndex,
      })),
    );
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

    for (let index = 0; index < 4; index += 1) {
      expect(input.editor.redo()).toBe(true);
    }
    expect(
      input.editor.getSnapshot()!.project.shots[0]!.layers.some(
        (candidate) => candidate.id === layer.id,
      ),
    ).toBe(false);
  });

  it('replays a real two-content-layer z-order and enforces branch boundaries', () => {
    const input = harness();
    const shot = input.project.shots[0]!;
    const background = shot.layers[0]!;
    const layerA = shot.layers[1]!;
    const layerB = shot.layers[2]!;
    const order = () =>
      input.editor
        .getSnapshot()!
        .project.shots[0]!.layers.map(({ id, zIndex }) => ({
          id,
          zIndex,
        }));
    const initialOrder = order();

    input.layers.reorder(layerA.id, 'front');
    expect(order()).toEqual([
      { id: background.id, zIndex: 0 },
      { id: layerB.id, zIndex: 1 },
      { id: layerA.id, zIndex: 2 },
    ]);
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });

    expect(input.editor.undo()).toBe(true);
    expect(order()).toEqual(initialOrder);
    expect(input.editor.redo()).toBe(true);
    expect(order()).toEqual([
      { id: background.id, zIndex: 0 },
      { id: layerB.id, zIndex: 1 },
      { id: layerA.id, zIndex: 2 },
    ]);

    const beforeNoOp = input.editor.getSnapshot();
    input.layers.reorder(layerA.id, 'front');
    expect(input.editor.getSnapshot()).toBe(beforeNoOp);
    expect(input.editor.history.getSnapshot().undoCount).toBe(1);

    expect(input.editor.undo()).toBe(true);
    input.layers.reorder(layerB.id, 'back');
    expect(order()).toEqual([
      { id: background.id, zIndex: 0 },
      { id: layerB.id, zIndex: 1 },
      { id: layerA.id, zIndex: 2 },
    ]);
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });

    input.layers.setLocked(layerA.id, true);
    const historyBeforeLocked = input.editor.history.getSnapshot().undoCount;
    const projectBeforeLocked = input.editor.getSnapshot()!.project;
    expect(() => input.layers.reorder(layerA.id, 'back')).toThrow(
      expect.objectContaining({ code: 'LAYER_LOCKED' }),
    );
    expect(input.editor.getSnapshot()!.project).toBe(projectBeforeLocked);
    expect(input.editor.history.getSnapshot().undoCount).toBe(
      historyBeforeLocked,
    );
    expect(order().map(({ zIndex }) => zIndex)).toEqual([0, 1, 2]);
    expect(order()[0]!.id).toBe(background.id);
  });

  it('replays pending transform commands before flip and lock actions', () => {
    const flipInput = harness();
    const flipLayer = flipInput.project.shots[0]!.layers[1]!;
    const currentFlipLayer = () =>
      flipInput.editor
        .getSnapshot()!
        .project.shots[0]!.layers.find(
          (candidate) => candidate.id === flipLayer.id,
        )!;

    flipInput.layers.updateTransform(flipLayer.id, {
      x: 700,
      y: flipLayer.y,
      scale: flipLayer.scaleX,
      rotationDeg: flipLayer.rotationDeg,
      opacity: flipLayer.opacity,
      flipX: flipLayer.flipX,
    });
    flipInput.layers.toggleFlipX(flipLayer.id);
    expect(currentFlipLayer()).toMatchObject({ x: 700, flipX: true });
    expect(flipInput.editor.history.getSnapshot().undoCount).toBe(2);

    expect(flipInput.editor.undo()).toBe(true);
    expect(currentFlipLayer()).toMatchObject({
      x: 700,
      flipX: false,
    });
    expect(flipInput.editor.undo()).toBe(true);
    expect(currentFlipLayer()).toMatchObject({
      x: flipLayer.x,
      flipX: false,
    });
    expect(flipInput.editor.redo()).toBe(true);
    expect(flipInput.editor.redo()).toBe(true);
    expect(currentFlipLayer()).toMatchObject({ x: 700, flipX: true });

    const lockInput = harness();
    const lockLayer = lockInput.project.shots[0]!.layers[1]!;
    const currentLockLayer = () =>
      lockInput.editor
        .getSnapshot()!
        .project.shots[0]!.layers.find(
          (candidate) => candidate.id === lockLayer.id,
        )!;

    lockInput.layers.updateTransform(lockLayer.id, {
      x: lockLayer.x,
      y: lockLayer.y,
      scale: 1.2,
      rotationDeg: lockLayer.rotationDeg,
      opacity: lockLayer.opacity,
      flipX: lockLayer.flipX,
    });
    lockInput.layers.setLocked(lockLayer.id, true);
    expect(currentLockLayer()).toMatchObject({
      scaleX: 1.2,
      scaleY: 1.2,
      locked: true,
    });
    expect(lockInput.editor.history.getSnapshot().undoCount).toBe(2);

    expect(lockInput.editor.undo()).toBe(true);
    expect(currentLockLayer()).toMatchObject({
      scaleX: 1.2,
      scaleY: 1.2,
      locked: false,
    });
    expect(lockInput.editor.undo()).toBe(true);
    expect(currentLockLayer()).toMatchObject({
      scaleX: lockLayer.scaleX,
      scaleY: lockLayer.scaleY,
      locked: false,
    });
  });

  it('does not add a transform command for unchanged drafts before actions', () => {
    const input = harness();
    const layer = input.project.shots[0]!.layers[1]!;
    input.layers.updateTransform(layer.id, {
      x: layer.x,
      y: layer.y,
      scale: layer.scaleX,
      rotationDeg: layer.rotationDeg,
      opacity: layer.opacity,
      flipX: layer.flipX,
    });
    expect(input.editor.history.getSnapshot().undoCount).toBe(0);

    input.layers.toggleFlipX(layer.id);
    expect(input.editor.history.getSnapshot().undoCount).toBe(1);

    const lockInput = harness();
    const lockLayer = lockInput.project.shots[0]!.layers[1]!;
    lockInput.layers.updateTransform(lockLayer.id, {
      x: lockLayer.x,
      y: lockLayer.y,
      scale: lockLayer.scaleX,
      rotationDeg: lockLayer.rotationDeg,
      opacity: lockLayer.opacity,
      flipX: lockLayer.flipX,
    });
    lockInput.layers.setLocked(lockLayer.id, true);
    expect(lockInput.editor.history.getSnapshot().undoCount).toBe(1);
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
