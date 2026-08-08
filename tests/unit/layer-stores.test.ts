import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  LayerService,
  ProjectSchema,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';

function harness() {
  const project = ProjectSchema.parse(exampleProject);
  const editor = new EditorProjectStore();
  editor.open('D:\\day22.pandastage', project);
  const listeners = new Set<() => void>();
  let shotId = project.shots[0]!.id;
  const shots = {
    getCurrentShotId: () => shotId,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select: (nextShotId: string) => {
      shotId = nextShotId;
      listeners.forEach((listener) => listener());
    },
  };
  let id = 0;
  const service = new LayerService({
    createId: () =>
      `d2210000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => new Date('2026-07-26T01:30:00.000Z'),
  });
  const selection = new LayerSelectionStore(editor, shots);
  return {
    project,
    editor,
    shots,
    layers: new LayerStore(editor, shots, service, selection),
    selection,
  };
}

describe('Day 22 layer stores', () => {
  it('keeps selection unique and session-only, clears on blank and shot changes', () => {
    const input = harness();
    const shot = input.project.shots[0]!;
    const background = shot.layers[0]!;
    const ordinary = shot.layers[1]!;

    input.selection.select(ordinary.id);
    expect(input.selection.getSelectedLayerId()).toBe(ordinary.id);
    expect(input.editor.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });
    expect(JSON.stringify(input.editor.getSnapshot()!.project)).not.toContain(
      'selectedLayerId',
    );

    input.selection.select(background.id);
    expect(input.selection.getSelectedLayerId()).toBeNull();
    input.selection.selectBackground();
    expect(input.selection.getSelectedLayerId()).toBe(background.id);
    expect(input.editor.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });
    input.selection.clear();
    expect(input.selection.getSelectedLayerId()).toBeNull();
    input.selection.select(ordinary.id);
    input.selection.clear();
    expect(input.selection.getSelectedLayerId()).toBeNull();
    input.selection.select(ordinary.id);
    input.shots.select('d2210000-0000-4000-8000-000000000099');
    expect(input.selection.getSelectedLayerId()).toBeNull();
    input.shots.select(shot.id);
    input.selection.selectBackground();
    input.editor.open('D:\\other-project.pandastage', input.project);
    expect(input.selection.getSelectedLayerId()).toBeNull();
    input.selection.dispose();
  });

  it('commits create and drag-end position exactly once each', () => {
    const input = harness();
    let notifications = 0;
    input.editor.subscribe(() => {
      notifications += 1;
    });

    const layer = input.layers.createFromAsset({
      version: 2,
      assetId: input.project.assets[0]!.id,
      type: 'asset-image',
      position: { x: 100, y: 200 },
    });
    expect(notifications).toBe(1);
    expect(input.editor.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 1,
    });

    input.layers.updatePosition(layer.id, { x: 300, y: 400 });
    expect(notifications).toBe(2);
    expect(input.editor.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 2,
    });

    input.layers.updatePosition(layer.id, { x: 300, y: 400 });
    expect(notifications).toBe(2);
  });

  it('restores Create layer selection on redo without duplicating the layer', () => {
    const input = harness();
    const shot = input.project.shots[0]!;
    const asset = input.project.assets.find(
      (candidate) => candidate.kind === 'image',
    )!;
    const layer = input.layers.createFromAsset({
      version: 2,
      assetId: asset.id,
      type: 'asset-image',
      position: { x: 100, y: 200 },
    });

    expect(input.selection.getSelectedLayerId()).toBe(layer.id);
    expect(
      input.editor.getSnapshot()!.project.shots[0]!.layers.filter(
        (candidate) => candidate.id === layer.id,
      ),
    ).toHaveLength(1);
    expect(input.editor.getSnapshot()).toMatchObject({ revision: 1 });
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });

    expect(input.editor.undo()).toBe(true);
    expect(
      input.editor.getSnapshot()!.project.shots[0]!.layers.some(
        (candidate) => candidate.id === layer.id,
      ),
    ).toBe(false);
    expect(input.selection.getSelectedLayerId()).toBeNull();
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 1,
    });

    const revisionAfterUndo = input.editor.getSnapshot()!.revision;
    expect(input.editor.redo()).toBe(true);
    const redoneShot = input.editor.getSnapshot()!.project.shots.find(
      (candidate) => candidate.id === shot.id,
    )!;
    expect(
      redoneShot.layers.filter((candidate) => candidate.id === layer.id),
    ).toHaveLength(1);
    expect(input.selection.getSelectedLayerId()).toBe(layer.id);
    expect(input.editor.getSnapshot()).toMatchObject({
      revision: revisionAfterUndo + 1,
    });
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
  });

  it('does not restore Create layer selection after the shot context changes', () => {
    const input = harness();
    const asset = input.project.assets.find(
      (candidate) => candidate.kind === 'image',
    )!;
    const layer = input.layers.createFromAsset({
      version: 2,
      assetId: asset.id,
      type: 'asset-image',
      position: { x: 100, y: 200 },
    });

    expect(input.editor.undo()).toBe(true);
    input.shots.select('d2210000-0000-4000-8000-000000000099');
    expect(input.editor.redo()).toBe(true);
    expect(input.selection.getSelectedLayerId()).toBeNull();
    expect(
      input.editor
        .getSnapshot()!
        .project.shots[0]!.layers.some((candidate) => candidate.id === layer.id),
    ).toBe(true);
  });

  it('keeps replay effects session-only and prevents effect-bearing commands from coalescing', () => {
    const input = harness();
    const coalescing = { key: 'project-name', gestureId: 'gesture-1' };
    let undoEffects = 0;
    let redoEffects = 0;
    const first = input.editor.getSnapshot()!.project;

    input.editor.updateProject(
      { ...first, name: 'First name' },
      'First edit',
      { coalescing },
      {
        afterUndo: () => {
          undoEffects += 1;
        },
        afterRedo: () => {
          redoEffects += 1;
        },
      },
    );
    const second = input.editor.getSnapshot()!.project;
    input.editor.updateProject(
      { ...second, name: 'Second name' },
      'Second edit',
      { coalescing },
      {
        afterUndo: () => {
          undoEffects += 1;
        },
        afterRedo: () => {
          redoEffects += 1;
        },
      },
    );

    expect(redoEffects).toBe(2);
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 2,
      redoCount: 0,
    });
    expect(JSON.stringify(input.editor.getSnapshot())).not.toContain(
      'afterRedo',
    );
    expect(JSON.stringify(input.editor.history.getSnapshot())).not.toContain(
      'afterRedo',
    );

    expect(input.editor.undo()).toBe(true);
    expect(undoEffects).toBe(1);
    expect(input.editor.undo()).toBe(true);
    expect(undoEffects).toBe(2);
  });

  it.each([
    {
      label: 'unknown character',
      characterId:
        'd2250000-0000-4000-8000-000000000001',
      expressionId: null,
      mismatchAsset: false,
    },
    {
      label: 'foreign expression',
      characterId: null,
      expressionId:
        'd2250000-0000-4000-8000-000000000002',
      mismatchAsset: false,
    },
    {
      label: 'mismatched asset',
      characterId: null,
      expressionId: null,
      mismatchAsset: true,
    },
  ])('does not mutate renderer state for $label', ({
    characterId,
    expressionId,
    mismatchAsset,
  }) => {
    const input = harness();
    const character = input.project.characters[0]!;
    const expression = character.expressions[0]!;
    const assetId = mismatchAsset
      ? input.project.assets.find(
          (asset) =>
            asset.kind === 'image' &&
            asset.id !== expression.assetId,
        )!.id
      : expression.assetId;
    let notifications = 0;
    input.editor.subscribe(() => {
      notifications += 1;
    });

    expect(() =>
      input.layers.createFromAsset({
        version: 2,
        type: 'character-expression',
        assetId,
        characterId: characterId ?? character.id,
        expressionId: expressionId ?? expression.id,
        position: { x: 100, y: 200 },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CHARACTER_IDENTITY_MISMATCH',
      }),
    );
    expect(input.editor.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });
    expect(notifications).toBe(0);
    expect(input.editor.getSnapshot()!.project).toEqual(input.project);
  });

  it('commits transform/order once and clears selection after deletion', () => {
    const input = harness();
    const shot = input.project.shots[0]!;
    const layer = shot.layers[1]!;
    let notifications = 0;
    input.editor.subscribe(() => {
      notifications += 1;
    });
    input.selection.select(layer.id);

    input.layers.updateTransform(layer.id, {
      x: 700,
      y: 400,
      scale: 1.5,
      rotationDeg: 390,
      opacity: 0.8,
      flipX: true,
    });
    expect(notifications).toBe(1);
    expect(input.editor.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 1,
    });

    input.layers.reorder(layer.id, 'front');
    expect(notifications).toBe(1);
    input.layers.deleteLayer(layer.id);
    expect(notifications).toBe(2);
    expect(input.selection.getSelectedLayerId()).toBeNull();
    expect(input.editor.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 2,
    });
    expect(
      input.editor.getSnapshot()!.project.shots[0]!.layers
        .some((candidate) => candidate.id === layer.id),
    ).toBe(false);
    input.selection.dispose();
  });
});
