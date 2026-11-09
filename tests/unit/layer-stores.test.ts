import { asExpressionCharacter } from '../helpers/characterAssertions';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  CharacterService,
  LayerService,
  migrateProject,
  type Project,
} from '../../src/domain';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { buildProject, buildProjectWithAnimation, IDS } from './domain/testProject';
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

  it('commits Part pose create, keyframe, and clear as one revision and reports the clear fallback', () => {
    const base = buildProject();
    const project = new CharacterService().createAdaptiveParts(base, {
      name: 'Layer store pose Character',
      parts: adaptivePartsFixture(IDS.assetChar),
    });
    const character = project.characters.at(-1)!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const placed = new LayerService().createFromAdaptiveCharacter(
      project,
      IDS.shot,
      character.id,
      { x: 700, y: 500 },
    );
    const input = harness(placed.project);
    input.selection.select(placed.layer.id);
    const created = input.layers.createPartPoseAnimation(placed.layer.id);
    const partId = created.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation!.tracks[0]!.partId;
    expect(input.editor.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });

    input.layers.setPartPoseKeyframe(placed.layer.id, partId, {
      timeMs: 1_000,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 45,
      scale: 1,
      easingToNext: 'linear',
    });
    expect(input.editor.getSnapshot()).toMatchObject({ revision: 2, dirty: true });
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 2, redoCount: 0 });

    const cleared = input.layers.clearPartPoseTrack(placed.layer.id, partId);
    expect(cleared).toMatchObject({
      changed: true,
      animationRemoved: true,
      fallback: 'current-character-defaults',
    });
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 3, redoCount: 0 });
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation).toBeUndefined();

    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation!.tracks[0]!.keys).toHaveLength(2);
    expect(input.editor.redo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation).toBeUndefined();
  });

  it('rejects a Part pose command after the selected instance changes', () => {
    const base = buildProject();
    const project = new CharacterService().createAdaptiveParts(base, {
      name: 'Selected pose Character',
      parts: adaptivePartsFixture(IDS.assetChar),
    });
    const character = project.characters.at(-1)!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const first = new LayerService().createFromAdaptiveCharacter(
      project,
      IDS.shot,
      character.id,
      { x: 700, y: 500 },
    );
    const second = new LayerService().createFromAdaptiveCharacter(
      first.project,
      IDS.shot,
      character.id,
      { x: 900, y: 500 },
    );
    const input = harness(second.project);
    input.selection.select(first.layer.id);
    input.layers.createPartPoseAnimation(first.layer.id);
    const partId = input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === first.layer.id,
    )!.poseAnimation!.tracks[0]!.partId;
    input.selection.select(second.layer.id);
    const before = input.editor.getSnapshot()!;

    expect(() =>
      input.layers.setPartPoseKeyframe(first.layer.id, partId, {
        timeMs: 1_000,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 45,
        scale: 1,
        easingToNext: 'linear',
      }),
    ).toThrow('no longer the selected Character Layer');
    expect(input.editor.getSnapshot()).toBe(before);
    expect(input.editor.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
    input.selection.dispose();
  });

  it('adds the first pose key atomically and permits safe pivot calibration on other Parts', () => {
    const base = buildProject();
    const project = new CharacterService().createAdaptiveParts(base, {
      name: 'Atomic pose Character',
      parts: adaptivePartsFixture(IDS.assetChar),
    });
    const character = project.characters.at(-1)!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const placed = new LayerService().createFromAdaptiveCharacter(
      project,
      IDS.shot,
      character.id,
      { x: 700, y: 500 },
    );
    const input = harness(placed.project);
    input.selection.select(placed.layer.id);

    const firstPart = character.parts[0]!;
    const firstPivot = {
      x: firstPart.imageMapping.sourceWidth / 2,
      y: firstPart.imageMapping.sourceHeight / 2,
    };
    input.layers.addPartPoseKeyframe(
      placed.layer.id,
      firstPart.partId,
      1_000,
      firstPivot,
    );
    expect(input.editor.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    let layer = input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (candidate) => candidate.id === placed.layer.id,
    )!;
    expect(layer.poseAnimation!.tracks.every(
      (track) => track.keys[0]!.timeMs === 0,
    )).toBe(true);
    expect(layer.poseAnimation!.tracks.find(
      (track) => track.partId === firstPart.partId,
    )).toMatchObject({
      pivotSource: firstPivot,
      keys: [
        { timeMs: 0, offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 1 },
        { timeMs: 1_000, offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 1 },
      ],
    });

    const secondPart = character.parts[1]!;
    const secondPivot = {
      x: secondPart.imageMapping.sourceWidth / 3,
      y: secondPart.imageMapping.sourceHeight / 3,
    };
    input.layers.setPartPosePivot(
      placed.layer.id,
      secondPart.partId,
      secondPivot,
    );
    expect(input.editor.getSnapshot()).toMatchObject({ revision: 2, dirty: true });
    expect(input.editor.history.getSnapshot()).toMatchObject({ undoCount: 2 });
    layer = input.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (candidate) => candidate.id === placed.layer.id,
    )!;
    expect(layer.poseAnimation!.tracks.find(
      (track) => track.partId === secondPart.partId,
    )).toMatchObject({ pivotSource: secondPivot, keys: [{ timeMs: 0 }] });

    const beforeNoopPivot = input.editor.getSnapshot();
    expect(input.layers.setPartPosePivot(
      placed.layer.id,
      secondPart.partId,
      secondPivot,
    )).toBe(beforeNoopPivot!.project);
    expect(input.editor.getSnapshot()).toBe(beforeNoopPivot);
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 2,
      redoCount: 0,
    });

    const beforeRejectedRecalibration = input.editor.getSnapshot();
    expect(() => input.layers.setPartPosePivot(
      placed.layer.id,
      firstPart.partId,
      { x: firstPivot.x / 2, y: firstPivot.y / 2 },
    )).toThrow('pivot is fixed after a pose is authored');
    expect(input.editor.getSnapshot()).toBe(beforeRejectedRecalibration);

    const zeroInput = harness(placed.project);
    zeroInput.selection.select(placed.layer.id);
    zeroInput.layers.addPartPoseKeyframe(
      placed.layer.id,
      secondPart.partId,
      0,
    );
    expect(zeroInput.editor.getSnapshot()).toMatchObject({
      revision: 1,
      dirty: true,
    });
    expect(zeroInput.editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    expect(zeroInput.editor.getSnapshot()!.project.shots[0]!.layers.find(
      (candidate) => candidate.id === placed.layer.id,
    )!.poseAnimation!.tracks.find(
      (track) => track.partId === secondPart.partId,
    )!.keys).toEqual([{
      timeMs: 0,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 0,
      scale: 1,
      easingToNext: 'linear',
    }]);
    input.selection.dispose();
    zeroInput.selection.dispose();
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

  it('commits one Character duplicate as a single History step and keeps both instances independent', () => {
    const input = harness(buildProject());
    const shot = input.project.shots[0]!;
    const source = shot.layers.find((layer) => layer.id === IDS.layerChar)!;
    let notifications = 0;
    input.editor.subscribe(() => {
      notifications += 1;
    });
    input.selection.select(source.id);

    const duplicate = input.layers.duplicateCharacterLayer(source.id);
    expect(notifications).toBe(1);
    expect(input.editor.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 1,
    });
    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.source).toEqual(source.source);
    expect(input.selection.getSelectedLayerId()).toBe(duplicate.id);

    input.layers.updatePosition(duplicate.id, { x: 900, y: 300 });
    input.layers.deleteLayer(source.id);
    const afterDelete = input.editor.getSnapshot()!.project.shots[0]!;
    expect(afterDelete.layers.find((layer) => layer.id === source.id)).toBeUndefined();
    expect(afterDelete.layers.find((layer) => layer.id === duplicate.id)).toMatchObject({
      x: 900,
      y: 300,
      source: source.source,
    });
    expect(afterDelete.timelineEvents).toEqual(shot.timelineEvents);
    expect(input.editor.getSnapshot()!.project.characters).toEqual(
      input.project.characters,
    );
    expect(input.editor.getSnapshot()!.project.assets).toEqual(
      input.project.assets,
    );

    expect(input.editor.undo()).toBe(true);
    expect(
      input.editor.getSnapshot()!.project.shots[0]!.layers.find(
        (layer) => layer.id === source.id,
      ),
    ).toEqual(source);
    expect(input.editor.undo()).toBe(true);
    expect(
      input.editor.getSnapshot()!.project.shots[0]!.layers.find(
        (layer) => layer.id === duplicate.id,
      ),
    ).toMatchObject({ x: source.x + 24, y: source.y + 24 });
    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers).toHaveLength(
      shot.layers.length,
    );
    expect(input.editor.getSnapshot()!.project).toEqual(input.project);

    expect(input.editor.redo()).toBe(true);
    expect(
      input.editor.getSnapshot()!.project.shots[0]!.layers.some(
        (layer) => layer.id === duplicate.id,
      ),
    ).toBe(true);
    expect(input.selection.getSelectedLayerId()).toBe(duplicate.id);
    input.selection.dispose();
  });

  it('does not create a Character duplicate for locked, hidden, or non-Character layers', () => {
    const input = harness(buildProject());
    const shot = input.project.shots[0]!;
    const source = shot.layers.find((layer) => layer.id === IDS.layerChar)!;
    const assetLayer = shot.layers.find((layer) => layer.id === IDS.layerAsset)!;

    expect(() => input.layers.duplicateCharacterLayer(assetLayer.id)).toThrow(
      expect.objectContaining({ code: 'CHARACTER_LAYER_REQUIRED' }),
    );
    input.layers.setLocked(source.id, true);
    expect(() => input.layers.duplicateCharacterLayer(source.id)).toThrow(
      expect.objectContaining({ code: 'LAYER_LOCKED' }),
    );
    const lockedRevision = input.editor.getSnapshot()!.revision;
    expect(input.editor.getSnapshot()!.project.shots[0]!.layers).toHaveLength(
      shot.layers.length,
    );
    expect(input.editor.getSnapshot()).toMatchObject({
      revision: lockedRevision,
    });
    input.selection.dispose();
  });
});
