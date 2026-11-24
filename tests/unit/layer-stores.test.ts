import { asExpressionCharacter } from '../helpers/characterAssertions';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  LayerMotionService,
  LayerService,
  ProjectSchema,
  evaluateShotAtTime,
  migrateProject,
  recognizePositionChain,
  type Project,
  type TimelineEvent,
} from '../../src/domain';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { buildProjectWithAnimation, IDS } from './domain/testProject';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';

function harness(project: Project = migrateProject(exampleProject)) {
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

  it('undoes and redoes an animation instance with its start time and selection', () => {
    const input = harness(buildProjectWithAnimation());
    const shot = input.project.shots[0]!;
    const layer = input.layers.createFromAsset({
      version: 3,
      type: 'animation',
      animationId: IDS.animation,
      position: { x: 350, y: 260 },
      startTimeMs: 1_000,
    });

    expect(input.editor.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(input.selection.getSelectedLayerId()).toBe(layer.id);
    input.layers.updatePosition(layer.id, { x: 400, y: 280 });
    input.layers.updateTransform(layer.id, {
      x: 400,
      y: 280,
      scale: 1.2,
      rotationDeg: 0,
      opacity: 1,
      flipX: false,
    });
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.at(-1)).toMatchObject({
      startTimeMs: 1_000,
      x: 400,
      y: 280,
      scaleX: 1.2,
      scaleY: 1.2,
    });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.at(-1)).toMatchObject({
      x: 400,
      y: 280,
      scaleX: 1,
      scaleY: 1,
    });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.at(-1)).toMatchObject({
      x: 350,
      y: 260,
    });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers).not.toContainEqual(
      expect.objectContaining({ id: layer.id }),
    );
    expect(input.editor.redo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots.find(
      (candidate) => candidate.id === shot.id,
    )?.layers).toContainEqual(expect.objectContaining({
      id: layer.id,
      source: { kind: 'animation', animationId: IDS.animation },
      startTimeMs: 1_000,
      x: 350,
      y: 260,
    }));
    expect(input.selection.getSelectedLayerId()).toBe(layer.id);
    expect(input.editor.redo()).toBe(true);
    expect(input.editor.redo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.at(-1)).toMatchObject({
      x: 400,
      y: 280,
      scaleX: 1.2,
      scaleY: 1.2,
    });
  });

  it('keeps start, mode, copy, position, and delete edits independent in History', () => {
    const input = harness(buildProjectWithAnimation());
    const shotId = input.project.shots[0]!.id;
    const originalAnimations = input.project.animations;
    const originalAssets = input.project.assets;
    const first = input.layers.createFromAsset({
      version: 3,
      type: 'animation',
      animationId: IDS.animation,
      position: { x: 350, y: 260 },
      startTimeMs: 0,
    });
    input.layers.updateAnimationPlayback(first.id, { startTimeMs: 200 });
    input.layers.updateAnimationPlayback(first.id, { endBehavior: 'hide' });
    input.layers.updateAnimationPlayback(first.id, { mode: 'loop' });
    input.layers.updatePosition(first.id, { x: 360, y: 270 });
    const second = input.layers.duplicateAnimationLayer(first.id);
    input.layers.updateAnimationPlayback(second.id, { startTimeMs: 1_000 });
    input.layers.updateAnimationPlayback(second.id, { mode: 'once' });
    input.layers.updatePosition(second.id, { x: 420, y: 620 });

    const beforeDelete = input.editor.getSnapshot()!.project.shots.find(
      (candidate) => candidate.id === shotId,
    )!;
    expect(beforeDelete.layers.find((layer) => layer.id === first.id)).toMatchObject({
      startTimeMs: 200,
      animationPlayback: { mode: 'loop', endBehavior: 'hide' },
      x: 360,
      y: 270,
    });
    expect(beforeDelete.layers.find((layer) => layer.id === second.id)).toMatchObject({
      startTimeMs: 1_000,
      animationPlayback: { mode: 'once', endBehavior: 'hide' },
      x: 420,
      y: 620,
    });
    input.layers.deleteLayer(first.id);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.some(
      (layer) => layer.id === first.id,
    )).toBe(false);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.some(
      (layer) => layer.id === second.id,
    )).toBe(true);
    expect(input.editor.getSnapshot()!.project.animations).toEqual(originalAnimations);
    expect(input.editor.getSnapshot()!.project.assets).toEqual(originalAssets);

    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.some(
      (layer) => layer.id === first.id,
    )).toBe(true);
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === second.id,
    )).toMatchObject({ x: 384, y: 294 });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === second.id,
    )).toMatchObject({
      startTimeMs: 1_000,
      animationPlayback: { mode: 'loop', endBehavior: 'hide' },
      x: 384,
      y: 294,
    });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === second.id,
    )).toMatchObject({
      startTimeMs: 200,
      animationPlayback: { mode: 'loop', endBehavior: 'hide' },
      x: 384,
      y: 294,
    });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.some(
      (layer) => layer.id === second.id,
    )).toBe(false);
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === first.id,
    )).toMatchObject({ x: 350, y: 260 });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === first.id,
    )).toMatchObject({
      startTimeMs: 200,
      animationPlayback: { mode: 'once', endBehavior: 'hide' },
    });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === first.id,
    )).toMatchObject({
      startTimeMs: 200,
      animationPlayback: { mode: 'once', endBehavior: 'hold' },
    });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === first.id,
    )).toMatchObject({
      startTimeMs: 0,
      animationPlayback: { mode: 'once', endBehavior: 'hold' },
    });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.some(
      (layer) => layer.id === first.id,
    )).toBe(false);

    for (let index = 0; index < 10; index += 1) {
      expect(input.editor.redo()).toBe(true);
    }
    const redoneShot = input.editor.getSnapshot()!.project.shots[0]!;
    expect(redoneShot.layers.some((layer) => layer.id === first.id)).toBe(false);
    expect(redoneShot.layers.find((layer) => layer.id === second.id)).toMatchObject({
      source: { kind: 'animation', animationId: IDS.animation },
      startTimeMs: 1_000,
      animationPlayback: { mode: 'once', endBehavior: 'hide' },
      x: 420,
      y: 620,
    });
    expect(input.editor.getSnapshot()!.project.animations).toEqual(originalAnimations);
    expect(input.editor.getSnapshot()!.project.assets).toEqual(originalAssets);
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
    const character = asExpressionCharacter(input.project.characters[0]!);
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

  it('duplicates an FLA Graphic layer with v2 Clip in one History entry, supports Undo/Redo/selection, and rejects locked sources atomically', () => {
    const base = graphicFaceProject();
    const shotId = base.shots[0]!.id;
    const placed = new LayerService().createFromAnimation(base, shotId, {
      animationId: FACE_GRAPHIC_ID,
      position: { x: 500, y: 360 },
      startTimeMs: 0,
    });
    const motion = new LayerMotionService();
    let authored = motion.applyKeys(
      placed.project,
      { shotId, layerId: placed.layer.id, timeMs: 0 },
      { 'transform.offsetX': 0, 'transform.offsetY': 0 },
    );
    authored = motion.applyKeys(
      authored,
      { shotId, layerId: placed.layer.id, timeMs: 500 },
      { 'transform.offsetX': 120, 'transform.offsetY': -40 },
    );
    const moveEvent: TimelineEvent = {
      id: 'd2210000-0000-4000-8000-000000000900',
      type: 'move',
      layerId: placed.layer.id,
      startMs: 0,
      endMs: 500,
      from: { x: 500, y: 360 },
      to: { x: 620, y: 420 },
      easing: 'linear',
    };
    const opacityLow: TimelineEvent = {
      id: 'd2210000-0000-4000-8000-000000000901',
      type: 'opacity',
      layerId: placed.layer.id,
      startMs: 125,
      endMs: 625,
      from: 1,
      to: 0.25,
      easing: 'linear',
    };
    const opacityHigh: TimelineEvent = {
      id: 'd2210000-0000-4000-8000-000000000902',
      type: 'opacity',
      layerId: placed.layer.id,
      startMs: 125,
      endMs: 625,
      from: 1,
      to: 0.85,
      easing: 'linear',
    };
    authored = ProjectSchema.parse({
      ...authored,
      shots: authored.shots.map((shot) =>
        shot.id === shotId
          ? {
              ...shot,
              timelineEvents: [...shot.timelineEvents, moveEvent, opacityLow, opacityHigh],
            }
          : shot,
      ),
    });

    const input = harness(authored);
    const descendingIds = [
      'f2210000-0000-4000-8000-000000000099',
      'f2210000-0000-4000-8000-000000000009',
      'f2210000-0000-4000-8000-000000000008',
      'f2210000-0000-4000-8000-000000000007',
    ];
    let nextId = 0;
    const descendingLayerStore = new LayerStore(
      input.editor,
      input.shots,
      new LayerService({ createId: () => descendingIds[nextId++]! }),
      input.selection,
    );
    input.selection.select(placed.layer.id);

    const duplicated = descendingLayerStore.duplicateAnimationLayer(placed.layer.id);
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    expect(input.editor.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 1,
    });
    expect(input.selection.getSelectedLayerId()).toBe(duplicated.id);

    const afterDuplicate = input.editor.getSnapshot()!.project;
    expect(() => ProjectSchema.parse(afterDuplicate)).not.toThrow();
    const afterShot = afterDuplicate.shots[0]!;
    const dupLayer = afterShot.layers.find((l) => l.id === duplicated.id)!;
    expect(dupLayer.animationClip?.version).toBe(2);
    expect(dupLayer.animationClip?.targetBases[0]?.target.layerId).toBe(duplicated.id);
    expect(dupLayer.animationClip?.tracks.every((t) => t.target.layerId === duplicated.id)).toBe(true);
    const dupEvents = afterShot.timelineEvents.filter((e) => e.layerId === duplicated.id);
    expect(dupEvents).toHaveLength(3);
    expect(new Set(dupEvents.map((e) => e.id)).size).toBe(3);
    expect(dupEvents.find((e) => e.type === 'move')).toMatchObject({
      from: { x: 524, y: 384 },
      to: { x: 644, y: 444 },
    });
    expect(recognizePositionChain({ shot: afterShot, layer: dupLayer }).status).toBe('editable');
    const evalAfterDup = evaluateShotAtTime(afterShot, 500, afterDuplicate);
    expect(evalAfterDup.layers.find((l) => l.id === duplicated.id)!.x).toBeCloseTo(
      evalAfterDup.layers.find((l) => l.id === placed.layer.id)!.x + 24,
    );
    expect(evalAfterDup.layers.find((l) => l.id === duplicated.id)!.opacity).toBeCloseTo(
      evalAfterDup.layers.find((l) => l.id === placed.layer.id)!.opacity,
    );

    // Undo removes only the duplicated layer and its copied events.
    expect(input.editor.undo()).toBe(true);
    const afterUndo = input.editor.getSnapshot()!.project;
    expect(afterUndo).toEqual(authored);
    expect(afterUndo.shots[0]!.layers.some((l) => l.id === duplicated.id)).toBe(false);
    expect(afterUndo.shots[0]!.timelineEvents.some((e) => e.layerId === duplicated.id)).toBe(false);
    expect(input.selection.getSelectedLayerId()).toBeNull();

    // Redo restores the exact same duplicate ID, valid Clip ownership, event ordering, and selection.
    expect(input.editor.redo()).toBe(true);
    const afterRedo = input.editor.getSnapshot()!.project;
    expect(afterRedo).toEqual(afterDuplicate);
    expect(input.selection.getSelectedLayerId()).toBe(duplicated.id);
    const evalAfterRedo = evaluateShotAtTime(afterRedo.shots[0]!, 500, afterRedo);
    expect(evalAfterRedo.layers.find((l) => l.id === duplicated.id)!.opacity).toBeCloseTo(
      evalAfterRedo.layers.find((l) => l.id === placed.layer.id)!.opacity,
    );

    // Locked source leaves no partial layers, dangling events, or extra History entry.
    input.layers.setLocked(placed.layer.id, true);
    const beforeLocked = input.editor.getSnapshot()!;
    const historyBeforeLocked = input.editor.history.getSnapshot();
    expect(() => input.layers.duplicateAnimationLayer(placed.layer.id)).toThrow(
      expect.objectContaining({ code: 'LAYER_LOCKED' }),
    );
    expect(input.editor.getSnapshot()).toEqual(beforeLocked);
    expect(input.editor.history.getSnapshot()).toEqual(historyBeforeLocked);
    input.selection.dispose();
  });

  it('commits a 3x4 grid array in one History entry, keeps source selected, supports atomic Undo/Redo, and treats 1x1 as no-op (#1268 A01)', () => {
    const base = graphicFaceProject();
    const shotId = base.shots[0]!.id;
    const placed = new LayerService().createFromAnimation(base, shotId, {
      animationId: FACE_GRAPHIC_ID,
      position: { x: 400, y: 300 },
      startTimeMs: 0,
    });
    const motion = new LayerMotionService();
    let authored = motion.applyKeys(
      placed.project,
      { shotId, layerId: placed.layer.id, timeMs: 0 },
      { 'transform.offsetX': 0, 'transform.offsetY': 0 },
    );
    authored = motion.applyKeys(
      authored,
      { shotId, layerId: placed.layer.id, timeMs: 500 },
      { 'transform.offsetX': 60, 'transform.offsetY': -20 },
    );
    const opacityLow: TimelineEvent = {
      id: 'd2210000-0000-4000-8000-000000000951',
      type: 'opacity',
      layerId: placed.layer.id,
      startMs: 125,
      endMs: 625,
      from: 1,
      to: 0.2,
      easing: 'linear',
    };
    const opacityHigh: TimelineEvent = {
      id: 'd2210000-0000-4000-8000-000000000952',
      type: 'opacity',
      layerId: placed.layer.id,
      startMs: 125,
      endMs: 625,
      from: 1,
      to: 0.85,
      easing: 'linear',
    };
    authored = ProjectSchema.parse({
      ...authored,
      shots: authored.shots.map((s) =>
        s.id === shotId ? { ...s, timelineEvents: [...s.timelineEvents, opacityLow, opacityHigh] } : s,
      ),
    });

    const input = harness(authored);
    let seq = 99_999;
    const gridStore = new LayerStore(
      input.editor,
      input.shots,
      new LayerService({
        createId: () => `f2210000-0000-4000-8000-${String(seq--).padStart(12, '0')}`,
      }),
      input.selection,
    );
    input.selection.select(placed.layer.id);

    // 1x1 no-op produces zero History.
    expect(
      gridStore.duplicateAnimationLayerGrid(placed.layer.id, {
        rows: 1,
        cols: 1,
        spacingX: 100,
        spacingY: 80,
      }),
    ).toEqual([]);
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
    expect(input.editor.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });

    // Out-of-bounds fails without dirtying or recording History.
    expect(() =>
      gridStore.duplicateAnimationLayerGrid(placed.layer.id, {
        rows: 3,
        cols: 4,
        spacingX: 600,
        spacingY: 80,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_POSITION' }));
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);

    // Valid 3x4 generates 11 layers in one History entry and keeps source selected.
    const created = gridStore.duplicateAnimationLayerGrid(placed.layer.id, {
      rows: 3,
      cols: 4,
      spacingX: 100,
      spacingY: 80,
    });
    expect(created).toHaveLength(11);
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    expect(input.editor.getSnapshot()).toMatchObject({ dirty: true, revision: 1 });
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);

    const afterGrid = input.editor.getSnapshot()!.project;
    // Single Undo removes all 11 layers and their copied events cleanly.
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(authored);
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);

    // Single Redo restores exact same 11 IDs, positions, zIndex, Clip, and event priority.
    expect(input.editor.redo()).toBe(true);
    const afterRedo = input.editor.getSnapshot()!.project;
    expect(afterRedo).toEqual(afterGrid);
    const evalRedo = evaluateShotAtTime(afterRedo.shots[0]!, 500, afterRedo);
    const evalSrc = evalRedo.layers.find((l) => l.id === placed.layer.id)!;
    const evalLast = evalRedo.layers.find((l) => l.id === created.at(-1)!.id)!;
    expect(evalLast.x).toBeCloseTo(evalSrc.x + 300);
    expect(evalLast.y).toBeCloseTo(evalSrc.y + 160);
    expect(evalLast.opacity).toBeCloseTo(evalSrc.opacity);
    input.selection.dispose();
  });

  it('commits curve motion in one History entry, preserves selection, supports atomic Undo/Redo, and leaves state clean on conflict (#1269 A02)', () => {
    const base = graphicFaceProject();
    const shotId = base.shots[0]!.id;
    const placed = new LayerService().createFromAnimation(base, shotId, {
      animationId: FACE_GRAPHIC_ID,
      position: { x: 400, y: 300 },
      startTimeMs: 0,
    });
    const input = harness(placed.project);
    input.selection.select(placed.layer.id);

    // Invalid zero-length curve throws and leaves History/dirty/revision untouched.
    expect(() =>
      input.layers.applyCurveMotion(placed.layer.id, {
        startFrame: 0,
        endFrame: 24,
        p1: { x: 400, y: 300 },
        p2: { x: 400, y: 300 },
        p3: { x: 400, y: 300 },
        speedMode: 'constant',
      }),
    ).toThrow(/长度为 0/);
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
    expect(input.editor.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });

    // Valid curve commits once and retains source selection.
    input.layers.applyCurveMotion(placed.layer.id, {
      startFrame: 0,
      endFrame: 24,
      p1: { x: 450, y: 80 },
      p2: { x: 850, y: 80 },
      p3: { x: 900, y: 300 },
      speedMode: 'ease-in-out',
    });
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    expect(input.editor.getSnapshot()).toMatchObject({ dirty: true, revision: 1 });
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);

    const afterBake = input.editor.getSnapshot()!.project;
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(placed.project);
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);

    expect(input.editor.redo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(afterBake);
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);
    input.selection.dispose();
  });

  it('commits position afterimages in one History entry, restores exact zIndex/events on Undo/Redo, and leaves state clean on stationary rejection (#1271 A03)', () => {
    const base = graphicFaceProject();
    const shotId = base.shots[0]!.id;
    const placed = new LayerService().createFromAnimation(base, shotId, {
      animationId: FACE_GRAPHIC_ID,
      position: { x: 400, y: 300 },
      startTimeMs: 0,
    });
    const stationaryInput = harness(placed.project);
    stationaryInput.selection.select(placed.layer.id);
    expect(() =>
      stationaryInput.layers.generateAfterimages(placed.layer.id, {
        count: 4,
        delayFrames: 2,
        decay: 0.6,
        startFrame: 0,
        endFrame: 24,
      }),
    ).toThrow(/没有有效位移/);
    expect(stationaryInput.editor.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
    expect(stationaryInput.editor.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    stationaryInput.selection.dispose();

    const moving = new LayerMotionService().applyCurveMotion(placed.project, {
      shotId,
      layerId: placed.layer.id,
      startFrame: 0,
      endFrame: 24,
      p1: { x: 500, y: 150 },
      p2: { x: 750, y: 150 },
      p3: { x: 900, y: 300 },
      speedMode: 'constant',
    });
    const input = harness(moving);
    input.selection.select(placed.layer.id);
    const created = input.layers.generateAfterimages(placed.layer.id, {
      count: 4,
      delayFrames: 2,
      decay: 0.6,
      startFrame: 0,
      endFrame: 24,
    });
    expect(created).toHaveLength(4);
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    expect(input.editor.getSnapshot()).toMatchObject({ dirty: true, revision: 1 });
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);

    const afterGen = input.editor.getSnapshot()!.project;
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(moving);
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);

    expect(input.editor.redo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(afterGen);
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);
    input.selection.dispose();
  });

  it('commits radial burst in one History entry, preserves selection, restores exact IDs/values on Undo/Redo, and leaves state clean on invalid input (#1273 A04)', () => {
    const base = graphicFaceProject();
    const shotId = base.shots[0]!.id;
    const placed = new LayerService().createFromAnimation(base, shotId, {
      animationId: FACE_GRAPHIC_ID,
      position: { x: 960, y: 540 },
      startTimeMs: 0,
    });
    const input = harness(placed.project);
    input.selection.select(placed.layer.id);

    expect(() =>
      input.layers.generateRadialBurst(placed.layer.id, {
        count: 12,
        center: { x: 960, y: 540 },
        radius: 240,
        startAngleDeg: 0,
        maxRotationDeg: 180,
        startFrame: 0,
        durationFrames: 200, // exceeds shot
        staggerFrames: 1,
        seed: 42,
        fadeOut: true,
      }),
    ).toThrow(/超出当前镜头/);
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
    expect(input.editor.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });

    const created = input.layers.generateRadialBurst(placed.layer.id, {
      count: 6,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: 0,
      maxRotationDeg: 180,
      startFrame: 0,
      durationFrames: 12,
      staggerFrames: 1,
      seed: 42,
      fadeOut: true,
    });
    expect(created).toHaveLength(6);
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    expect(input.editor.getSnapshot()).toMatchObject({ dirty: true, revision: 1 });
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);

    const afterBurst = input.editor.getSnapshot()!.project;
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(placed.project);
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);

    expect(input.editor.redo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(afterBurst);
    expect(input.selection.getSelectedLayerId()).toBe(placed.layer.id);
    input.selection.dispose();
  });
});
