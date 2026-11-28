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
  planMappedCharacterMotion,
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

interface MotionMappingTarget {
  project: Project;
  targetCharacterId: string;
  generatedActionId: string;
  targetPartId: string;
}

/**
 * Adds a second Adaptive Parts Character whose `motionMappings` entry maps one
 * action of the first Character onto its own generated action (#1469 F2).
 */
function addMotionMappingTarget(
  project: Project,
  source: { characterId: string; armId: string; actionId: string },
): MotionMappingTarget {
  const parts = adaptivePartsFixture(IDS.assetChar).slice(0, 2).map((part, index) => ({
    ...part,
    partId: randomUUID(),
    restTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 70, ty: 0 },
    sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 70, ty: 0 },
  }));
  const created = new CharacterService().createAdaptiveParts(project, {
    name: '映射目标',
    parts,
  });
  const target = created.characters.at(-1)!;
  const targetPartId = parts[0]!.partId;
  const generatedActionId = randomUUID();
  const next = ProjectSchema.parse({
    ...created,
    characters: created.characters.map((character) =>
      character.id !== target.id
        ? character
        : {
            ...character,
            actions: [
              {
                id: generatedActionId,
                name: '映射动作',
                kind: 'layered' as const,
                tracks: [
                  {
                    partId: targetPartId,
                    property: 'transform.rotationDeg' as const,
                    keys: [
                      { timeMs: 0, value: 0, interpolationToNext: 'linear' as const },
                      { timeMs: 1000, value: 20, interpolationToNext: 'linear' as const },
                    ],
                  },
                ],
              },
            ],
            motionMappings: [
              {
                sourceCharacterId: source.characterId,
                sourceActionId: source.actionId,
                generatedActionId,
                rules: [
                  {
                    sourcePartId: source.armId,
                    targetPartId,
                    mirror: false,
                    translationScale: 1,
                    pivotOffset: { x: 0, y: 0 },
                    properties: ['transform.rotationDeg' as const],
                  },
                ],
              },
            ],
          },
    ),
  });
  return { project: next, targetCharacterId: target.id, generatedActionId, targetPartId };
}

function importCharacters(
  sourceProject: Project,
  sourceCharacterIds: readonly string[],
  targetProject: Project = buildProject(),
) {
  const closure = collectProjectResourceClosure(
    sourceProject,
    sourceCharacterIds.map((id) => ({ kind: 'character' as const, id })),
  );
  expect(closure.issues).toEqual([]);
  const plannedAssets = closure.assets.map((asset, index) => ({
    sourceAsset: asset,
    targetId: randomUUID(),
    reused: false,
    targetRelativePath: `assets/imported-${index}.png`,
    sha256: asset.sha256,
  }));
  return buildImportedProjectCandidate({
    targetProject,
    sourceProject,
    closure,
    plannedAssets,
    createId: randomUUID,
    updatedAtIso: '2026-11-28T00:00:00.000Z',
  });
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

  it('cross-project import never promotes an instance-private copy into the target shared library', () => {
    const rig = instanceRig();
    const project = editCopy(createCopyForA(rig), rig);
    const sourceSnapshot = JSON.stringify(project);
    const sourceCharacter = project.characters.find((character) => character.id === rig.characterId)!;
    if (sourceCharacter.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts character.');
    const sourceActions = sourceCharacter.actions!;
    const sourceShared = sourceActions.find((action) => action.id === ACTION_ID)!;
    const sourcePrivate = sourceActions.find((action) => action.id === COPY_ID)!;
    // Fixture sanity: the private copy really carries a modified track that the
    // shared origin does not have.
    if (!('kind' in sourceShared) || !('kind' in sourcePrivate)) throw new Error('Expected layered actions.');
    expect(sourcePrivate.tracks[0]!.keys.map((key) => key.value)).not.toEqual(
      sourceShared.tracks[0]!.keys.map((key) => key.value),
    );

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
    // Importing never mutates the source project.
    expect(JSON.stringify(project)).toBe(sourceSnapshot);

    const imported = candidate.importedCharacters[0]!;
    if (imported.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts character.');
    const importedActions = imported.actions ?? [];
    // #1469 F2 / #1449: instance isolation is the default. Only the shared
    // action is imported; the private modified copy is never silently promoted
    // into the target project's shared action library.
    expect(importedActions.map((action) => action.name)).toEqual(['招手']);
    expect(importedActions.some((action) => 'instanceScope' in action)).toBe(false);
    expect(importedActions.some((action) => 'originActionId' in action)).toBe(false);
    const importedShared = importedActions.find(
      (action): action is LayeredCharacterAction => 'kind' in action && action.name === '招手',
    )!;
    // The shared action keeps its own authored tracks (no private edit leaks in).
    expect(importedShared.tracks[0]!.partId).toBe(imported.parts[0]!.partId);
    expect(importedShared.tracks[0]!.partId).not.toBe(rig.armId);
    expect(importedShared.tracks[0]!.keys.map((key) => key.value)).toEqual(
      sourceShared.tracks[0]!.keys.map((key) => key.value),
    );
    // The formal project still validates after the import.
    expect(() => ProjectSchema.parse(candidate.project)).not.toThrow();
  });

  it('cross-project import never infers private ownership from a same-id target layer', () => {
    const rig = instanceRig();
    const project = editCopy(createCopyForA(rig), rig);
    const targetBase = buildProject();
    // The target project happens to contain an unrelated Layer whose id equals
    // the source private copy's `instanceScope.layerId`. That is not proof of
    // ownership: the private owner cannot be re-created by a resource import.
    const targetProject = ProjectSchema.parse({
      ...targetBase,
      shots: targetBase.shots.map((shot) =>
        shot.id !== IDS.shot
          ? shot
          : {
              ...shot,
              layers: [...shot.layers, { ...shot.layers[1]!, id: rig.layerA }],
            },
      ),
    });
    const candidate = importCharacters(project, [rig.characterId], targetProject);
    const imported = candidate.importedCharacters[0]!;
    if (imported.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts character.');
    expect(imported.actions!.map((action) => action.name)).toEqual(['招手']);
    expect(imported.actions!.some((action) => 'instanceScope' in action)).toBe(false);
    expect(() => ProjectSchema.parse(candidate.project)).not.toThrow();
  });

  it('cross-project import remaps a reference to a private copy onto the imported shared origin', () => {
    const rig = instanceRig();
    const mapping = addMotionMappingTarget(editCopy(createCopyForA(rig), rig), {
      characterId: rig.characterId,
      armId: rig.armId,
      actionId: COPY_ID,
    });
    const candidate = importCharacters(mapping.project, [
      rig.characterId,
      mapping.targetCharacterId,
    ]);
    const importedSource = candidate.importedCharacters.find(
      (character) => character.name === 'Instance scope rig',
    )!;
    const importedTarget = candidate.importedCharacters.find(
      (character) => character.name === '映射目标',
    )!;
    if (importedSource.mode !== 'adaptive-parts' || importedTarget.mode !== 'adaptive-parts') {
      throw new Error('Expected adaptive-parts characters.');
    }
    const importedShared = importedSource.actions!.find(
      (action): action is LayeredCharacterAction => 'kind' in action && action.name === '招手',
    )!;
    // The private copy is absent from the imported shared library.
    expect(importedSource.actions!.some((action) => action.name === '招手 副本')).toBe(false);
    // The formal mapping reference is remapped to the imported shared origin.
    expect(importedTarget.motionMappings).toHaveLength(1);
    const remapped = importedTarget.motionMappings![0]!;
    expect(remapped.sourceCharacterId).toBe(importedSource.id);
    expect(remapped.sourceActionId).toBe(importedShared.id);
    expect(remapped.sourceActionId).not.toBe(COPY_ID);
    expect(remapped.generatedActionId).not.toBe(mapping.generatedActionId);
    expect(
      importedTarget.actions!.find((action) => action.id === remapped.generatedActionId)!.name,
    ).toBe('映射动作');
    expect(remapped.rules[0]!.sourcePartId).toBe(importedSource.parts[0]!.partId);
    expect(remapped.rules[0]!.targetPartId).toBe(importedTarget.parts[0]!.partId);

    // The formal consumer accepts the remapped mapping and reuses the imported
    // generated action instead of leaving a dangling sourceActionId.
    const layerId = randomUUID();
    const projectWithLayer = ProjectSchema.parse({
      ...candidate.project,
      shots: candidate.project.shots.map((shot) =>
        shot.id !== IDS.shot
          ? shot
          : {
              ...shot,
              layers: [
                ...shot.layers,
                {
                  id: layerId,
                  name: importedTarget.name,
                  source: { kind: 'character' as const, characterId: importedTarget.id },
                  x: 960,
                  y: 540,
                  scaleX: 1,
                  scaleY: 1,
                  flipX: false,
                  rotationDeg: 0,
                  anchor: 'center' as const,
                  opacity: 1,
                  zIndex: 1,
                  visible: true,
                  locked: false,
                },
              ],
            },
      ),
    });
    const run = planMappedCharacterMotion(projectWithLayer, IDS.shot, layerId, 0, {
      sourceCharacterId: remapped.sourceCharacterId,
      sourceActionId: remapped.sourceActionId,
      rules: remapped.rules,
    });
    expect(run.missingSourcePartIds).toEqual([]);
    const targetAfterRun = run.project.characters.find(
      (character) => character.id === importedTarget.id,
    )!;
    expect(targetAfterRun.actions).toHaveLength(1);
    expect(targetAfterRun.actions![0]!.id).toBe(remapped.generatedActionId);
  });

  it('cross-project import degrades references to a private copy whose shared origin is missing', () => {
    const rig = instanceRig();
    const withCopy = editCopy(createCopyForA(rig), rig);
    const sourceCharacter = withCopy.characters.find(
      (character) => character.id === rig.characterId,
    )!;
    if (sourceCharacter.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts character.');
    const privateCopy = sourceCharacter.actions!.find(
      (action): action is LayeredCharacterAction => 'kind' in action && action.id === COPY_ID,
    )!;
    // Legacy/corrupt data: the private copy's provenance points at an action
    // that does not exist, so no usable shared origin is importable.
    const dangling = ProjectSchema.parse({
      ...withCopy,
      characters: withCopy.characters.map((character) =>
        character.id !== rig.characterId
          ? character
          : {
              ...character,
              actions: [{ ...privateCopy, originActionId: randomUUID() }],
            },
      ),
      shots: withCopy.shots.map((shot) => ({
        ...shot,
        timelineEvents: shot.timelineEvents.filter((event) => event.type !== 'character-action'),
      })),
    });
    const mapping = addMotionMappingTarget(dangling, {
      characterId: rig.characterId,
      armId: rig.armId,
      actionId: COPY_ID,
    });
    const candidate = importCharacters(mapping.project, [
      rig.characterId,
      mapping.targetCharacterId,
    ]);
    const importedSource = candidate.importedCharacters.find(
      (character) => character.name === 'Instance scope rig',
    )!;
    const importedTarget = candidate.importedCharacters.find(
      (character) => character.name === '映射目标',
    )!;
    if (importedSource.mode !== 'adaptive-parts' || importedTarget.mode !== 'adaptive-parts') {
      throw new Error('Expected adaptive-parts characters.');
    }
    // Neither the private copy nor any dangling provenance is imported.
    expect(importedSource.actions).toBeUndefined();
    const serialized = JSON.stringify(candidate.project);
    expect(serialized).not.toContain('"originActionId"');
    expect(serialized).not.toContain('"instanceScope"');
    // The mapping referenced the dropped copy with no usable shared origin, so
    // the formal reference is degraded locally while the generated action
    // stays usable on its own.
    expect(importedTarget.motionMappings).toBeUndefined();
    expect(importedTarget.actions!.map((action) => action.name)).toEqual(['映射动作']);
    expect(() => ProjectSchema.parse(candidate.project)).not.toThrow();
  });
});
