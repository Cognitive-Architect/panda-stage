import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CharacterMotionService,
  CharacterService,
  LayerService,
  ProjectSchema,
  ShotService,
  buildImportedProjectCandidate,
  collectProjectResourceClosure,
  duplicateCharacterActionForInstance,
  evaluateShotAtTime,
  resolveLayerVisualParts,
  upsertCharacterActionEvent,
  type CharacterActionEvent,
  type LayeredCharacterAction,
  type Project,
} from '../../src/domain';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
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
}

/**
 * One Adaptive Parts Character with one shared layered action placed on two
 * independent Character Layers A/B of the same Shot (#1449).
 */
function instanceRig(): InstanceRig {
  const parts = adaptivePartsFixture(IDS.assetChar).slice(0, 3).map((part, index) => ({
    ...part,
    restTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 65, ty: 0 },
    sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 65, ty: 0 },
  }));
  const base = new CharacterService().createAdaptiveParts(buildProject(), {
    name: 'Instance scope rig',
    parts,
  });
  const characterId = base.characters.at(-1)!.id;
  const [armId] = parts.map((part) => part.partId) as [string, string, string];
  const first = new LayerService().createFromAdaptiveCharacter(base, IDS.shot, characterId, { x: 650, y: 450 });
  const second = new LayerService().createFromAdaptiveCharacter(first.project, IDS.shot, characterId, { x: 1400, y: 450 });
  let project = ProjectSchema.parse({
    ...second.project,
    characters: second.project.characters.map((character) => character.id !== characterId ? character : {
      ...character,
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
  return { project, characterId, layerA: first.layer.id, layerB: second.layer.id, armId };
}

function actionEvent(project: Project, layerId: string): CharacterActionEvent {
  const event = project.shots[0]!.timelineEvents.find(
    (candidate): candidate is CharacterActionEvent =>
      candidate.type === 'character-action' && candidate.layerId === layerId,
  );
  if (!event) throw new Error('Missing character-action event fixture.');
  return event;
}

function createCopyForA(rig: InstanceRig): Project {
  return duplicateCharacterActionForInstance(rig.project, {
    shotId: IDS.shot,
    layerId: rig.layerA,
    eventId: actionEvent(rig.project, rig.layerA).id,
  }, () => COPY_ID).project;
}

function partVisual(project: Project, layerId: string, partId: string, timeMs: number) {
  const shot = project.shots[0]!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project).layers.find((layer) => layer.id === layerId)!;
  return resolveLayerVisualParts(project, shot, evaluated, timeMs)
    .parts.find((part) => part.partId === `${layerId}:${partId}`)!;
}

function editCopy(project: Project, rig: InstanceRig): Project {
  return new CharacterMotionService().apply(project, {
    shotId: IDS.shot,
    layerId: rig.layerA,
    partId: rig.armId,
    timeMs: 500,
    autoKey: true,
  }, { 'transform.rotationDeg': 45 });
}

describe('instance-scoped action copy ownership (#1449)', () => {
  it('rejects binding another layer instance copy on the formal event write path', () => {
    const rig = instanceRig();
    const project = createCopyForA(rig);
    expect(() => upsertCharacterActionEvent(project, IDS.shot, rig.layerB, {
      actionId: COPY_ID, startMs: 1000, endMs: 2000,
    }, () => '71000000-0000-4000-8000-000000000014')).toThrow(/其他角色图层/);
    // The owning layer can still re-bind / retime its own copy.
    const retimed = upsertCharacterActionEvent(project, IDS.shot, rig.layerA, {
      actionId: COPY_ID, startMs: 100, endMs: 900, eventId: actionEvent(project, rig.layerA).id,
    }, () => '71000000-0000-4000-8000-000000000015');
    expect(actionEvent(retimed, rig.layerA)).toMatchObject({ actionId: COPY_ID, startMs: 100, endMs: 900 });
    // A shared action may still be bound on both layers.
    const shared = upsertCharacterActionEvent(project, IDS.shot, rig.layerB, {
      actionId: ACTION_ID, startMs: 100, endMs: 900, eventId: actionEvent(project, rig.layerB).id,
    }, () => '71000000-0000-4000-8000-000000000016');
    expect(actionEvent(shared, rig.layerB)).toMatchObject({ actionId: ACTION_ID, startMs: 100, endMs: 900 });
  });

  it('degrades a legacy foreign-copy reference to the shared origin action instead of sharing the private copy', () => {
    const rig = instanceRig();
    const owned = editCopy(createCopyForA(rig), rig);
    // Legacy corrupt data: layer B's event points at A's private copy.
    const legacy = ProjectSchema.parse({
      ...owned,
      shots: owned.shots.map((shot) => ({
        ...shot,
        timelineEvents: shot.timelineEvents.map((event) =>
          event.type === 'character-action' && event.layerId === rig.layerB
            ? { ...event, actionId: COPY_ID }
            : event),
      })),
    });
    const sharedPose = partVisual(owned, rig.layerB, rig.armId, 500);
    const privatePose = partVisual(owned, rig.layerA, rig.armId, 500);
    expect(privatePose).not.toEqual(sharedPose);
    // B keeps playing the shared action; A keeps its own edited copy.
    expect(partVisual(legacy, rig.layerB, rig.armId, 500)).toEqual(sharedPose);
    expect(partVisual(legacy, rig.layerA, rig.armId, 500)).toEqual(privatePose);
    expect(evaluateShotAtTime(legacy.shots[0]!, 500, legacy).layers
      .find((layer) => layer.id === rig.layerB)!.layeredCharacterAction?.action.id).toBe(ACTION_ID);
  });

  it('duplicating a Character Layer never inherits the source layer private copy', () => {
    const rig = instanceRig();
    const project = editCopy(createCopyForA(rig), rig);
    const duplicated = new LayerService().duplicateLayer(project, IDS.shot, rig.layerA);
    const duplicatedLayerId = duplicated.layer.id;
    const duplicatedEvent = duplicated.project.shots[0]!.timelineEvents.find(
      (event): event is CharacterActionEvent =>
        event.type === 'character-action' && event.layerId === duplicatedLayerId,
    )!;
    expect(duplicatedEvent.actionId).toBe(ACTION_ID);
    expect(duplicatedEvent.actionId).not.toBe(COPY_ID);
    // The source layer keeps its independent copy.
    expect(actionEvent(duplicated.project, rig.layerA).actionId).toBe(COPY_ID);
    const evaluated = evaluateShotAtTime(duplicated.project.shots[0]!, 500, duplicated.project)
      .layers.find((layer) => layer.id === duplicatedLayerId)!;
    expect(evaluated.layeredCharacterAction?.action.id).toBe(ACTION_ID);
  });

  it('duplicating a Shot never inherits the source layer private copy', () => {
    const rig = instanceRig();
    const project = editCopy(createCopyForA(rig), rig);
    const duplicated = new ShotService().duplicate(project, IDS.shot);
    const duplicatedShot = duplicated.shots[1]!;
    const sourceA = project.shots[0]!.layers.find((layer) => layer.id === rig.layerA)!;
    const duplicatedA = duplicatedShot.layers.find((layer) =>
      layer.source.kind === 'character' && layer.x === sourceA.x && layer.y === sourceA.y)!;
    const duplicatedEvent = duplicatedShot.timelineEvents.find(
      (event): event is CharacterActionEvent =>
        event.type === 'character-action' && event.layerId === duplicatedA.id,
    )!;
    expect(duplicatedEvent.actionId).toBe(ACTION_ID);
    expect(duplicatedEvent.actionId).not.toBe(COPY_ID);
    // The original Shot still binds the source layer's private copy.
    expect(actionEvent(duplicated, rig.layerA).actionId).toBe(COPY_ID);
  });

  it('cross-project import drops a private scope that cannot exist in the target project', () => {
    const rig = instanceRig();
    const project = editCopy(createCopyForA(rig), rig);
    const closure = collectProjectResourceClosure(project, [
      { kind: 'character', id: rig.characterId },
    ]);
    expect(closure.issues).toEqual([]);
    const plannedAssets = closure.assets.map((asset, index) => ({
      sourceAsset: asset,
      targetId: randomUUID(),
      reused: false,
      targetRelativePath: `assets/imported-${index}.png`,
      sha256: asset.sha256,
    }));
    const candidate = buildImportedProjectCandidate({
      targetProject: buildProject(),
      sourceProject: project,
      closure,
      plannedAssets,
      createId: randomUUID,
      updatedAtIso: '2026-11-28T00:00:00.000Z',
    });
    const imported = candidate.importedCharacters[0]!;
    if (imported.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts character.');
    const importedCopy = (imported.actions ?? []).find(
      (action): action is LayeredCharacterAction => 'kind' in action && action.name === '招手 副本',
    )!;
    expect(importedCopy).toBeDefined();
    // The source layer instance does not exist in the target project, so the
    // private scope must not survive as a dangling owner. The copy degrades to
    // an independent shared action and never points at another layer's copy.
    expect('instanceScope' in importedCopy).toBe(false);
    expect('originActionId' in importedCopy).toBe(false);
    expect(importedCopy.tracks[0]!.partId).toBe(imported.parts[0]!.partId);
    expect(imported.parts[0]!.partId).not.toBe(rig.armId);
    // The formal project still validates after the import.
    expect(() => ProjectSchema.parse(candidate.project)).not.toThrow();
  });
});
