import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CharacterMotionService,
  CharacterService,
  LayerService,
  ProjectSchema,
  characterArmTipOnStage,
  characterMotionValues,
  duplicateCharacterActionForInstance,
  evaluateShotAtTime,
  planCharacterArmIk,
  resolveLayerVisualParts,
  revertCharacterActionForInstance,
  saveCharacterArmChain,
  upsertCharacterActionEvent,
  type CharacterActionEvent,
  type LayeredCharacterAction,
  type Project,
} from '../../src/domain';
import { characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { ProjectService } from '../../src/main/services/ProjectService';
import { IDS, buildProject } from './domain/testProject';

const ACTION_ID = '71000000-0000-4000-8000-000000000010';
const COPY_ID = '71000000-0000-4000-8000-000000000011';
const EVENT_A = '71000000-0000-4000-8000-000000000012';
const EVENT_B = '71000000-0000-4000-8000-000000000013';

interface InstanceRig {
  project: Project;
  characterId: string;
  layerA: string;
  layerB: string;
  armId: string;
  foreArmId: string;
  facePartId: string;
}

/**
 * One Adaptive Parts Character with a shared layered wave action placed on two
 * independent Character Layers. The wave drives only the shoulder Part.
 */
function instanceRig(options: { withFaceBinding?: boolean } = {}): InstanceRig {
  const parts = adaptivePartsFixture(IDS.assetChar).slice(0, 3).map((part, index) => ({
    ...part,
    restTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 65, ty: 0 },
    sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 65, ty: 0 },
  }));
  const base = new CharacterService().createAdaptiveParts(buildProject(), {
    name: 'Instance action rig',
    parts,
  });
  const characterId = base.characters.at(-1)!.id;
  const [armId, foreArmId, facePartId] = parts.map((part) => part.partId) as [string, string, string];
  const first = new LayerService().createFromAdaptiveCharacter(base, IDS.shot, characterId, { x: 650, y: 450 });
  const second = new LayerService().createFromAdaptiveCharacter(first.project, IDS.shot, characterId, { x: 1400, y: 450 });
  let project = ProjectSchema.parse({
    ...second.project,
    characters: second.project.characters.map((character) => character.id !== characterId ? character : {
      ...character,
      ...(options.withFaceBinding ? {
        faceBinding: {
          targetPartId: facePartId,
          replacePartIds: [],
          anchorRect: { x: 0, y: 0, width: 10, height: 10 },
          placement: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0, flipX: false },
        },
      } : {}),
      actions: [{
        id: ACTION_ID,
        name: '招手',
        kind: 'layered' as const,
        tracks: [{
          partId: armId,
          property: 'transform.rotationDeg' as const,
          keys: [0, 1000].map((timeMs) => ({ timeMs, value: timeMs / 50, interpolationToNext: 'linear' as const })),
        }],
      }],
    }),
  });
  project = upsertCharacterActionEvent(project, IDS.shot, first.layer.id, {
    actionId: ACTION_ID, startMs: 0, endMs: 1000,
  }, () => EVENT_A);
  project = upsertCharacterActionEvent(project, IDS.shot, second.layer.id, {
    actionId: ACTION_ID, startMs: 0, endMs: 1000,
  }, () => EVENT_B);
  return {
    project,
    characterId,
    layerA: first.layer.id,
    layerB: second.layer.id,
    armId,
    foreArmId,
    facePartId,
  };
}

function actionEvent(project: Project, layerId: string): CharacterActionEvent {
  const event = project.shots[0]!.timelineEvents.find(
    (candidate): candidate is CharacterActionEvent =>
      candidate.type === 'character-action' && candidate.layerId === layerId,
  );
  if (!event) throw new Error('Missing action event fixture.');
  return event;
}

function layeredActions(project: Project, characterId: string): LayeredCharacterAction[] {
  const character = project.characters.find((candidate) => candidate.id === characterId)!;
  return (character.actions ?? []).filter(
    (action): action is LayeredCharacterAction => 'kind' in action,
  );
}

function visualParts(project: Project, layerId: string, timeMs: number) {
  const shot = project.shots[0]!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project).layers.find((layer) => layer.id === layerId)!;
  return resolveLayerVisualParts(project, shot, evaluated, timeMs).parts;
}

function partVisual(project: Project, layerId: string, partId: string, timeMs: number) {
  return visualParts(project, layerId, timeMs).find((part) => part.partId === `${layerId}:${partId}`)!;
}

function copyForA(rig: InstanceRig, project = rig.project) {
  const event = actionEvent(project, rig.layerA);
  return duplicateCharacterActionForInstance(project, {
    shotId: IDS.shot,
    layerId: rig.layerA,
    eventId: event.id,
  }, () => COPY_ID);
}

describe('instance-scoped editable action copy (#1449)', () => {
  it('creates a new action, repoints only that event and leaves the source plus other layers intact', () => {
    const rig = instanceRig();
    const before = rig.project;
    const sourceAction = layeredActions(before, rig.characterId)[0]!;
    const result = copyForA(rig);

    expect(result.actionId).toBe(COPY_ID);
    expect(result.project).not.toBe(before);
    expect(result.project.shots[0]!.layers).toEqual(before.shots[0]!.layers);
    const character = result.project.characters.find((candidate) => candidate.id === rig.characterId)!;
    const actions = character.actions ?? [];
    expect(actions).toHaveLength(2);
    expect(actions.find((action) => action.id === ACTION_ID)).toEqual(sourceAction);
    const copy = layeredActions(result.project, rig.characterId).find((action) => action.id === COPY_ID)!;
    expect(copy).toMatchObject({
      kind: 'layered',
      originActionId: ACTION_ID,
      instanceScope: { layerId: rig.layerA },
    });
    expect(copy.name).toBe('招手 副本');
    expect(copy.tracks).toEqual(sourceAction.tracks);
    expect(actionEvent(result.project, rig.layerA).actionId).toBe(COPY_ID);
    expect(actionEvent(result.project, rig.layerB).actionId).toBe(ACTION_ID);
    // The original project snapshot is never mutated.
    expect(before.shots[0]!.timelineEvents.find((event) => event.id === EVENT_A)).toMatchObject({ actionId: ACTION_ID });

    // Duplicating the same already-copied segment is idempotent.
    const again = duplicateCharacterActionForInstance(result.project, {
      shotId: IDS.shot,
      layerId: rig.layerA,
      eventId: eventAId(result.project, rig),
    }, () => '71000000-0000-4000-8000-000000000099');
    expect(again.project).toBe(result.project);
    expect(again.actionId).toBe(COPY_ID);
  });

  it('rejects a baked full-image action with a clear message', () => {
    const fixture = characterPartAnimationFixture();
    const bakedActionId = '71000000-0000-4000-8000-000000000031';
    const bakedProject = ProjectSchema.parse({
      ...fixture.project,
      characters: fixture.project.characters.map((character) => character.id !== fixture.characterId ? character : {
        ...character,
        actions: [{
          id: bakedActionId,
          name: '整图挥手',
          animationId: fixture.project.animations[0]!.id,
          placement: { offsetX: 0, offsetY: 0, scale: 1 },
        }],
      }),
    });
    const withEvent = upsertCharacterActionEvent(bakedProject, IDS.shot, fixture.layerId, {
      actionId: bakedActionId, startMs: 0, endMs: 500,
    }, () => '71000000-0000-4000-8000-000000000032');
    const event = actionEvent(withEvent, fixture.layerId);
    expect(() => duplicateCharacterActionForInstance(withEvent, {
      shotId: IDS.shot,
      layerId: fixture.layerId,
      eventId: event.id,
    })).toThrow(/整图动作不支持局部修改/);
  });

  it('lets only the copied layer diverge across three edited frames, and persists that playback data', async () => {
    const rig = instanceRig();
    const copy = copyForA(rig);
    const editTimes = [250, 500, 750] as const;
    const beforeB = new Map(editTimes.map((timeMs) => [timeMs, partVisual(copy.project, rig.layerB, rig.armId, timeMs)]));
    const beforeA = new Map(editTimes.map((timeMs) => [timeMs, partVisual(copy.project, rig.layerA, rig.armId, timeMs)]));
    const layerABefore = copy.project.shots[0]!.layers.find((layer) => layer.id === rig.layerA)!;
    const motion = new CharacterMotionService();
    let edited = copy.project;
    for (const [index, timeMs] of editTimes.entries()) {
      edited = motion.apply(edited, {
        shotId: IDS.shot,
        layerId: rig.layerA,
        partId: rig.armId,
        timeMs,
        autoKey: true,
      }, { 'transform.rotationDeg': [15, 45, 10][index]!, 'transform.offsetY': 30 });
    }

    expect(edited).not.toBe(copy.project);
    // Playback data changed: the layer clip stays untouched (no competing keys).
    expect(edited.shots[0]!.layers.find((layer) => layer.id === rig.layerA)).toEqual(layerABefore);
    expect(edited.shots[0]!.layers.find((layer) => layer.id === rig.layerB))
      .toEqual(copy.project.shots[0]!.layers.find((layer) => layer.id === rig.layerB));
    for (const timeMs of editTimes) {
      expect(partVisual(edited, rig.layerB, rig.armId, timeMs)).toEqual(beforeB.get(timeMs));
      expect(partVisual(edited, rig.layerA, rig.armId, timeMs)).not.toEqual(beforeA.get(timeMs));
      expect(characterMotionValues(edited, {
        shotId: IDS.shot, layerId: rig.layerA, partId: rig.armId, timeMs, autoKey: true,
      })['transform.offsetY']).toBe(30);
    }
    // The shared action definition was never mutated.
    expect(layeredActions(edited, rig.characterId).find((action) => action.id === ACTION_ID))
      .toEqual(layeredActions(rig.project, rig.characterId)[0]!);
    // Persisted JSON stays valid and round-trips.
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(edited)))).toEqual(edited);

    // Formal Save / Reopen keeps the instance copy and its playback data.
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'panda-1449-copy-'));
    try {
      const root = path.join(tempDir, 'instance-copy.pandastage');
      await mkdir(root);
      await writeFile(path.join(root, 'project.json'), JSON.stringify(edited));
      await new ProjectService().save(root, edited, 1);
      const reopened = (await new ProjectService().open(root)).project;
      expect(reopened).toEqual(edited);
      expect(partVisual(reopened, rig.layerA, rig.armId, 500)).toEqual(
        partVisual(edited, rig.layerA, rig.armId, 500),
      );
      expect(partVisual(reopened, rig.layerB, rig.armId, 500)).toEqual(beforeB.get(500));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('anchors edits in action-local time so retiming the segment preserves the pose', () => {
    const rig = instanceRig();
    const copy = copyForA(rig);
    const edited = new CharacterMotionService().apply(copy.project, {
      shotId: IDS.shot,
      layerId: rig.layerA,
      partId: rig.armId,
      timeMs: 500,
      autoKey: true,
    }, { 'transform.rotationDeg': 60 });
    const beforeMove = partVisual(edited, rig.layerA, rig.armId, 500);

    const moved = upsertCharacterActionEvent(edited, IDS.shot, rig.layerA, {
      actionId: COPY_ID,
      startMs: 500,
      endMs: 1500,
      eventId: actionEvent(edited, rig.layerA).id,
    });
    // Shot time 1500 maps to the same local time 1000? No: 1500 - 500 = 1000.
    // The authored frame was local 500, so the matching shot time is 1000.
    expect(actionEvent(moved, rig.layerA)).toMatchObject({ startMs: 500, endMs: 1500 });
    expect(partVisual(moved, rig.layerA, rig.armId, 1000)).toEqual(beforeMove);
    expect(partVisual(moved, rig.layerA, rig.armId, 0)).toEqual(
      partVisual(rig.project, rig.layerA, rig.armId, 0),
    );
    // Outside the retimed action segment the base pose returns.
    expect(partVisual(moved, rig.layerA, rig.armId, 2000)).toEqual(
      partVisual(rig.project, rig.layerA, rig.armId, 2000),
    );
  });

  it('never modifies face or mouth Parts from an instance copy', () => {
    const rig = instanceRig({ withFaceBinding: true });
    const copy = copyForA(rig);
    const beforeFaceA = partVisual(copy.project, rig.layerA, rig.facePartId, 500);
    const edited = new CharacterMotionService().apply(copy.project, {
      shotId: IDS.shot,
      layerId: rig.layerA,
      partId: rig.armId,
      timeMs: 500,
      autoKey: true,
    }, { 'transform.rotationDeg': 45 });
    expect(partVisual(edited, rig.layerA, rig.facePartId, 500)).toEqual(beforeFaceA);
    expect(() => new CharacterMotionService().apply(copy.project, {
      shotId: IDS.shot,
      layerId: rig.layerA,
      partId: rig.facePartId,
      timeMs: 500,
      autoKey: true,
    }, { 'transform.rotationDeg': 30 })).toThrow(/脸部和嘴型部件/);
  });

  it('restores the shared action reference on revert', () => {
    const rig = instanceRig();
    const copy = copyForA(rig);
    const edited = new CharacterMotionService().apply(copy.project, {
      shotId: IDS.shot,
      layerId: rig.layerA,
      partId: rig.armId,
      timeMs: 500,
      autoKey: true,
    }, { 'transform.rotationDeg': 45 });
    const reverted = revertCharacterActionForInstance(edited, {
      shotId: IDS.shot,
      layerId: rig.layerA,
      eventId: actionEvent(edited, rig.layerA).id,
    });
    expect(actionEvent(reverted, rig.layerA).actionId).toBe(ACTION_ID);
    const character = reverted.characters.find((candidate) => candidate.id === rig.characterId)!;
    expect(character.actions).toHaveLength(1);
    expect(character.actions![0]).toEqual(
      rig.project.characters.find((candidate) => candidate.id === rig.characterId)!.actions![0]!,
    );
    expect(partVisual(reverted, rig.layerA, rig.armId, 500).imageTransform).toEqual(
      partVisual(rig.project, rig.layerA, rig.armId, 500).imageTransform,
    );
    expect(partVisual(reverted, rig.layerA, rig.armId, 500).imageTransform).toEqual(
      partVisual(reverted, rig.layerB, rig.armId, 500).imageTransform,
    );
  });

  it('opens the existing arm IK tools only inside the instance copy', () => {
    const rig = instanceRig();
    const armChain = {
      segments: [
        { partId: rig.armId, joint: { x: 0, y: 0 }, minDeg: -180, maxDeg: 180 },
        { partId: rig.foreArmId, joint: { x: 65, y: 0 }, minDeg: 0, maxDeg: 145 },
      ],
      tip: { x: 120, y: 0 },
    };
    const address = { shotId: IDS.shot, layerId: rig.layerA, timeMs: 500 };
    let project = saveCharacterArmChain(rig.project, address, armChain);
    // Shared action still owns the arm.
    expect(() => planCharacterArmIk(project, address, { x: 0, y: 0 })).toThrow(/当前动作段控制该?骨链/);

    const copy = copyForA(rig, project);
    project = copy.project;
    const bBefore = partVisual(project, rig.layerB, rig.armId, 500);
    const neutral = characterArmTipOnStage(project, address);
    const goal = { x: neutral.x + 18, y: neutral.y + 22 };
    const plan = planCharacterArmIk(project, address, goal);
    expect(plan.project).not.toBe(project);
    // The edit is persisted on the instance copy, not on the layer clip.
    expect(plan.project.shots[0]!.layers.find((layer) => layer.id === rig.layerA)?.animationClip).toBeUndefined();
    const actual = characterArmTipOnStage(plan.project, address);
    expect(Math.hypot(actual.x - goal.x, actual.y - goal.y)).toBeLessThan(0.5);
    expect(partVisual(plan.project, rig.layerB, rig.armId, 500)).toEqual(bBefore);
  });
});

function eventAId(project: Project, rig: InstanceRig): string {
  return actionEvent(project, rig.layerA).id;
}
