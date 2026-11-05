import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  PartPoseAnimationService,
  ProjectSchema,
  ShotService,
  evaluateShotAtTime,
  resolveLayerVisualParts,
  scanAssetReferences,
  transformPointByVisualPart,
  type Project,
} from '../../src/domain';
import {
  collectExportPreparationMedia,
  evaluateExportPreparationSupport,
} from '../../src/domain/export-preparation';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import {
  adaptivePartsFixture,
} from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from '../unit/domain/testProject';

const temporaryParents: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function evaluatedVisuals(project: Project, layerId: string) {
  const shot = project.shots.find((candidate) => candidate.id === IDS.shot)!;
  return [0, 250, 500, 750, 1_000].map((timeMs) => {
    const evaluated = evaluateShotAtTime(shot, timeMs, project).layers.find(
      (layer) => layer.id === layerId,
    )!;
    return resolveLayerVisualParts(project, shot, evaluated).parts.map(
      (part) => part.imageTransform,
    );
  });
}

function pivotPosition(
  project: Project,
  layerId: string,
  partId: string,
  timeMs: number,
) {
  const shot = project.shots.find((candidate) => candidate.id === IDS.shot)!;
  const layer = shot.layers.find((candidate) => candidate.id === layerId)!;
  const track = layer.poseAnimation!.tracks.find(
    (candidate) => candidate.partId === partId,
  )!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project).layers.find(
    (candidate) => candidate.id === layerId,
  )!;
  const visualPart = resolveLayerVisualParts(project, shot, evaluated).parts.find(
    (candidate) =>
      candidate.source.kind === 'adaptive-part' &&
      candidate.source.characterPartId === partId,
  )!;
  return transformPointByVisualPart(
    {
      x: (track.pivotSource.x - track.imageMapping.crop.x) *
        track.imageMapping.exportScale,
      y: (track.pivotSource.y - track.imageMapping.crop.y) *
        track.imageMapping.exportScale,
    },
    visualPart,
  );
}

function poseAtTime(
  project: Project,
  shotId: string,
  layerId: string,
  partId: string,
  timeMs: number,
) {
  const shot = project.shots.find((candidate) => candidate.id === shotId)!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project).layers.find(
    (layer) => layer.id === layerId,
  )!;
  return evaluated.partPoses!.find((pose) => pose.partId === partId)!;
}

function poseVisualSummary(
  project: Project,
  shotId: string,
  layerId: string,
  timeMs: number,
) {
  const shot = project.shots.find((candidate) => candidate.id === shotId)!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project).layers.find(
    (layer) => layer.id === layerId,
  )!;
  return resolveLayerVisualParts(project, shot, evaluated).parts.map((part) => ({
    partId:
      part.source.kind === 'adaptive-part'
        ? part.source.characterPartId
        : null,
    assetId: part.assetId,
    visible: part.visible,
    drawOrder: part.drawOrder,
    imageTransform: part.imageTransform,
  }));
}

describe('Part pose animation persistence', () => {
  it('records one history command, saves, reopens, and seeks to identical Part transforms', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-part-pose-'),
    );
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'Pose Animation.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, {
      name: 'Pose Animation',
    });
    let project = ProjectSchema.parse({
      ...buildProject(),
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
    });
    const sourceParts = adaptivePartsFixture(IDS.assetChar).map((part, index) =>
      index === 0
        ? {
            ...part,
            restTransform: { ...part.restTransform, b: 0.1, c: 0.25 },
            imageMapping: {
              ...part.imageMapping,
              sourceHeight: 800,
              crop: { x: 0, y: 80, width: 640, height: 640 },
            },
          }
        : part,
    );
    project = new CharacterService().createAdaptiveParts(project, {
      name: 'Pose Character',
      sourceRootTransform: {
        a: -1,
        b: 0.15,
        c: 0.25,
        d: 1,
        tx: 790,
        ty: 47.6,
      },
      parts: sourceParts,
    });
    const character = project.characters.at(-1)!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const placed = new LayerService().createFromAdaptiveCharacter(
      project,
      IDS.shot,
      character.id,
      { x: 960, y: 540 },
    );
    project = placed.project;
    await projectService.save(projectRoot, project, 1);

    const editor = new EditorProjectStore();
    editor.open(projectRoot, project);
    const poses = new PartPoseAnimationService();
    const partId = character.parts[0]!.partId;
    const pivotSource = { x: 320, y: 20 };
    const staticVisuals = evaluatedVisuals(project, placed.layer.id);
    const captured = poses.create(project, {
      shotId: IDS.shot,
      layerId: placed.layer.id,
      pivotSourceByPartId: { [partId]: pivotSource },
    });
    editor.updateProject(captured, 'Capture Part pose snapshot');
    const capturedSnapshot = editor.getSnapshot()!;
    expect(evaluatedVisuals(capturedSnapshot.project, placed.layer.id)).toEqual(
      staticVisuals,
    );
    const track = capturedSnapshot.project.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation!.tracks[0]!;
    expect(track.partId).toBe(partId);
    expect(track.pivotSource).toEqual(pivotSource);
    expect(track.pivotSource.y).toBeLessThan(track.imageMapping.crop.y);
    expect(track.keys[0]).toMatchObject({
      timeMs: 0,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 0,
      scale: 1,
    });
    const keyed = poses.setKeyframe(capturedSnapshot.project, {
      shotId: IDS.shot,
      layerId: placed.layer.id,
      partId: track.partId,
      keyframe: {
        timeMs: 1_000,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 270,
        scale: 1,
        easingToNext: 'linear',
      },
    });
    editor.updateProject(keyed, 'Set Part rotation keyframe');
    const nonNeutralBase = poses.setKeyframe(editor.getSnapshot()!.project, {
      shotId: IDS.shot,
      layerId: placed.layer.id,
      partId: track.partId,
      keyframe: {
        timeMs: 0,
        offsetX: 20,
        offsetY: -10,
        rotationDeg: 30,
        scale: 1.25,
        easingToNext: 'step',
      },
    });
    editor.updateProject(nonNeutralBase, 'Adjust protected 0 ms Part pose');
    expect(editor.getSnapshot()).toMatchObject({ revision: 3, dirty: true });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 3, redoCount: 0 });

    expect(editor.undo()).toBe(true);
    const undoneTrack = editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation!.tracks[0]!;
    expect(undoneTrack.keys[0]).toMatchObject({
      timeMs: 0,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 0,
      scale: 1,
    });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 2, redoCount: 1 });
    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()).toMatchObject({ revision: 5, dirty: true });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 3, redoCount: 0 });

    const committed = editor.getSnapshot()!.project;
    const committedSnapshot = editor.getSnapshot()!;
    const committedTrack = committed.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation!.tracks[0]!;
    expect(committed.schemaVersion).toBe(17);
    expect(committed.characters).toEqual(project.characters);
    expect(committedTrack.sourceRestTransform).toEqual(track.sourceRestTransform);
    expect(committedTrack.restTransform).toEqual(track.restTransform);
    expect(committedTrack.imageMapping).toEqual(track.imageMapping);
    expect(committedTrack.pivotSource).toEqual(track.pivotSource);
    expect(committedTrack.keys[0]).toMatchObject({
      timeMs: 0,
      offsetX: 20,
      offsetY: -10,
      rotationDeg: 30,
      scale: 1.25,
      easingToNext: 'step',
    });
    expect(committedTrack.keys[1]!.timeMs).toBe(1_000);
    const neutralPivot = pivotPosition(
      capturedSnapshot.project,
      placed.layer.id,
      track.partId,
      500,
    );
    const adjustedPivot = pivotPosition(committed, placed.layer.id, track.partId, 500);
    expect(adjustedPivot.x).toBeCloseTo(neutralPivot.x + 20, 8);
    expect(adjustedPivot.y).toBeCloseTo(neutralPivot.y - 10, 8);
    const zeroTimePose = evaluateShotAtTime(
      committed.shots[0]!,
      0,
      committed,
    ).layers.find((layer) => layer.id === placed.layer.id)!.partPoses!.find(
      (pose) => pose.partId === track.partId,
    )!;
    expect(zeroTimePose).toMatchObject({
      offsetX: 20,
      offsetY: -10,
      rotationDeg: 30,
      scale: 1.25,
    });
    const historyBeforeSeek = editor.history.getSnapshot();
    const beforeSave = evaluatedVisuals(committed, placed.layer.id);
    expect(editor.getSnapshot()).toBe(committedSnapshot);
    expect(editor.history.getSnapshot()).toEqual(historyBeforeSeek);
    expect(committedSnapshot).toMatchObject({ revision: 5, dirty: true });
    expect(evaluateExportPreparationSupport(committed, 'static').some(
      (issue) => issue.problem.includes('Part pose animation'),
    )).toBe(true);
    expect(evaluateExportPreparationSupport(buildProject(), 'static')).toEqual([]);

    await projectService.save(
      projectRoot,
      committed,
      editor.getSnapshot()!.revision,
    );
    const reopened = await projectService.open(projectRoot);
    expect(reopened.project.schemaVersion).toBe(committed.schemaVersion);
    expect(evaluatedVisuals(reopened.project, placed.layer.id)).toEqual(beforeSave);
    expect(pivotPosition(reopened.project, placed.layer.id, track.partId, 500)).toEqual(
      adjustedPivot,
    );
    expect(
      reopened.project.shots[0]!.layers.find((layer) => layer.id === placed.layer.id)!
        .poseAnimation!.tracks[0]!.keys[0],
    ).toMatchObject({ timeMs: 0, rotationDeg: 30, easingToNext: 'step' });
    const reopenedZeroTimePose = evaluateShotAtTime(
      reopened.project.shots[0]!,
      0,
      reopened.project,
    ).layers.find((layer) => layer.id === placed.layer.id)!.partPoses!.find(
      (pose) => pose.partId === track.partId,
    )!;
    expect(reopenedZeroTimePose).toMatchObject({
      offsetX: 20,
      offsetY: -10,
      rotationDeg: 30,
      scale: 1.25,
    });
    editor.clear();
  });

  it('isolates same-Character pose instances, deep-copies layers and Shots, and preserves snapshot resources through reopen', async () => {
    const parent = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-pose-instances-'),
    );
    temporaryParents.push(parent);
    const projectRoot = path.join(parent, 'Pose Instances.pandastage');
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, {
      name: 'Pose Instances',
    });
    const seed = buildProject();
    let project = ProjectSchema.parse({
      ...seed,
      id: created.project.id,
      name: created.project.name,
      createdAt: created.project.createdAt,
      updatedAt: created.project.updatedAt,
      characters: [],
      voiceProfiles: [],
      shots: seed.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.filter((layer) => layer.id === IDS.layerBg),
        backgroundLayerId: IDS.layerBg,
      })),
    });

    const characters = new CharacterService();
    const sourceParts = adaptivePartsFixture(IDS.assetChar).map(
      (part, index) => ({
        ...part,
        assetId: index === 0 ? IDS.assetChar : IDS.assetChar2,
        visible: index !== 0,
      }),
    );
    project = characters.createAdaptiveParts(project, {
      name: 'Shared Character',
      parts: sourceParts,
    });
    const character = project.characters.at(-1)!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }
    const partA = character.parts[0]!.partId;
    const partB = character.parts[1]!.partId;
    const layers = new LayerService();
    const shotAId = IDS.shot;
    const layerAResult = layers.createFromAdaptiveCharacter(
      project,
      shotAId,
      character.id,
      { x: 780, y: 500 },
    );
    project = layerAResult.project;
    const layerAId = layerAResult.layer.id;
    const layerBResult = layers.createFromAdaptiveCharacter(
      project,
      shotAId,
      character.id,
      { x: 1_140, y: 520 },
    );
    project = layerBResult.project;
    const layerBId = layerBResult.layer.id;

    const shots = new ShotService();
    project = shots.create(project, {
      name: 'Shot B',
      durationMs: 3_000,
    });
    const shotBId = project.shots.at(-1)!.id;
    const layerCResult = layers.createFromAdaptiveCharacter(
      project,
      shotBId,
      character.id,
      { x: 900, y: 600 },
    );
    project = layerCResult.project;
    const layerCId = layerCResult.layer.id;
    const staticLayerResult = layers.createFromAdaptiveCharacter(
      project,
      shotBId,
      character.id,
      { x: 1_250, y: 600 },
    );
    project = staticLayerResult.project;
    const staticLayerId = staticLayerResult.layer.id;
    await projectService.save(projectRoot, project, 1);

    const editor = new EditorProjectStore();
    editor.open(projectRoot, project);
    const poses = new PartPoseAnimationService();
    const commit = (next: Project, label: string) => {
      const beforeRevision = editor.getSnapshot()!.revision;
      editor.updateProject(next, label);
      expect(editor.getSnapshot()!.revision).toBe(beforeRevision + 1);
    };
    const capture = (
      shotId: string,
      layerId: string,
      pivotSource: { x: number; y: number },
      label: string,
    ) => {
      commit(
        poses.create(editor.getSnapshot()!.project, {
          shotId,
          layerId,
          pivotSourceByPartId: { [partA]: pivotSource },
        }),
        label,
      );
    };
    const setRotation = (
      shotId: string,
      layerId: string,
      partId: string,
      rotationDeg: number,
      label: string,
    ) => {
      commit(
        poses.setKeyframe(editor.getSnapshot()!.project, {
          shotId,
          layerId,
          partId,
          keyframe: {
            timeMs: 1_000,
            offsetX: 0,
            offsetY: 0,
            rotationDeg,
            scale: 1,
            easingToNext: 'linear',
          },
        }),
        label,
      );
    };

    capture(shotAId, layerAId, { x: 320, y: 180 }, 'Capture A snapshot');
    capture(shotAId, layerBId, { x: 80, y: 300 }, 'Capture B snapshot');
    capture(shotBId, layerCId, { x: 410, y: 260 }, 'Capture C snapshot');
    expect(editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === layerAId,
    )!.poseAnimation!.tracks[0]!.pivotSource).toEqual({ x: 320, y: 180 });
    expect(editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === layerBId,
    )!.poseAnimation!.tracks[0]!.pivotSource).toEqual({ x: 80, y: 300 });
    setRotation(shotAId, layerAId, partA, 40, 'Rotate instance A');
    expect(editor.undo()).toBe(true);
    expect(poseAtTime(editor.getSnapshot()!.project, shotAId, layerAId, partA, 1_000).rotationDeg).toBe(0);
    expect(poseAtTime(editor.getSnapshot()!.project, shotAId, layerBId, partA, 1_000).rotationDeg).toBe(0);
    expect(editor.redo()).toBe(true);
    expect(poseAtTime(editor.getSnapshot()!.project, shotAId, layerAId, partA, 1_000).rotationDeg).toBe(40);
    setRotation(shotAId, layerBId, partA, -35, 'Rotate instance B');
    setRotation(shotBId, layerCId, partB, 25, 'Rotate cross-shot instance C');

    const movedA = layers.updateTransform(
      editor.getSnapshot()!.project,
      shotAId,
      layerAId,
      {
        x: 860,
        y: 460,
        scale: 1.25,
        rotationDeg: 18,
        opacity: 1,
        flipX: true,
      },
    );
    commit(movedA, 'Transform instance A');
    const afterInstanceEdits = editor.getSnapshot()!.project;
    expect(poseAtTime(afterInstanceEdits, shotAId, layerAId, partA, 1_000).rotationDeg).toBe(40);
    expect(poseAtTime(afterInstanceEdits, shotAId, layerBId, partA, 1_000).rotationDeg).toBe(-35);
    expect(poseAtTime(afterInstanceEdits, shotBId, layerCId, partB, 1_000).rotationDeg).toBe(25);
    expect(afterInstanceEdits.shots[0]!.layers.find((layer) => layer.id === layerAId)!.x).toBe(860);
    expect(afterInstanceEdits.shots[0]!.layers.find((layer) => layer.id === layerAId)).toMatchObject({
      y: 460,
      scaleX: 1.25,
      scaleY: 1.25,
      rotationDeg: 18,
      flipX: true,
    });
    expect(afterInstanceEdits.shots[0]!.layers.find((layer) => layer.id === layerBId)!.x).toBe(1_140);
    expect(afterInstanceEdits.shots[0]!.layers.find((layer) => layer.id === layerBId)).toMatchObject({
      y: 520,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      flipX: false,
    });
    const beforeSeeks = editor.getSnapshot()!;
    const historyBeforeSeeks = editor.history.getSnapshot();
    const expectedRotations = new Map([
      [1_000, 40],
      [250, 10],
      [0, 0],
      [750, 30],
    ]);
    for (const timeMs of [1_000, 250, 0, 750, 1_000]) {
      const pose = poseAtTime(editor.getSnapshot()!.project, shotAId, layerAId, partA, timeMs);
      expect(pose.rotationDeg).toBe(expectedRotations.get(timeMs));
    }
    expect(editor.getSnapshot()).toBe(beforeSeeks);
    expect(editor.history.getSnapshot()).toEqual(historyBeforeSeeks);

    const duplicateLayerResult = layers.duplicateCharacterLayer(
      editor.getSnapshot()!.project,
      shotAId,
      layerAId,
    );
    const duplicateLayerId = duplicateLayerResult.layer.id;
    commit(duplicateLayerResult.project, 'Duplicate posed Character layer');
    expect(duplicateLayerId).not.toBe(layerAId);
    const duplicatePose = editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === duplicateLayerId,
    )!.poseAnimation!;
    const originalPose = editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === layerAId,
    )!.poseAnimation!;
    expect(duplicatePose).toEqual(originalPose);
    expect(duplicatePose).not.toBe(originalPose);
    expect(duplicatePose.tracks).not.toBe(originalPose.tracks);
    expect(duplicatePose.tracks[0]!.keys).not.toBe(originalPose.tracks[0]!.keys);
    expect(duplicatePose.tracks[0]!.restTransform).not.toBe(originalPose.tracks[0]!.restTransform);

    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.layers.some((layer) => layer.id === duplicateLayerId)).toBe(false);
    expect(poseAtTime(editor.getSnapshot()!.project, shotAId, layerAId, partA, 1_000).rotationDeg).toBe(40);
    expect(poseAtTime(editor.getSnapshot()!.project, shotAId, layerBId, partA, 1_000).rotationDeg).toBe(-35);
    expect(editor.redo()).toBe(true);

    const beforeShotDuplicate = editor.getSnapshot()!.project;
    const duplicatedProject = shots.duplicate(beforeShotDuplicate, shotAId);
    const duplicatedShot = duplicatedProject.shots.find(
      (shot) => !beforeShotDuplicate.shots.some((candidate) => candidate.id === shot.id),
    )!;
    commit(duplicatedProject, 'Duplicate posed Shot');
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots.some((shot) => shot.id === duplicatedShot.id)).toBe(false);
    expect(poseAtTime(editor.getSnapshot()!.project, shotAId, layerAId, partA, 1_000).rotationDeg).toBe(40);
    expect(editor.redo()).toBe(true);

    const copiedLayerA = duplicatedShot.layers.find(
      (layer) => layer.name === beforeShotDuplicate.shots.find((shot) => shot.id === shotAId)!.layers.find((layer) => layer.id === layerAId)!.name,
    )!;
    const currentOriginalA = editor.getSnapshot()!.project.shots.find((shot) => shot.id === shotAId)!.layers.find((layer) => layer.id === layerAId)!;
    const currentCopiedA = editor.getSnapshot()!.project.shots.find((shot) => shot.id === duplicatedShot.id)!.layers.find((layer) => layer.id === copiedLayerA.id)!;
    expect(currentCopiedA.poseAnimation).toEqual(currentOriginalA.poseAnimation);
    expect(currentCopiedA.poseAnimation).not.toBe(currentOriginalA.poseAnimation);
    expect(currentCopiedA.poseAnimation!.tracks[0]!.keys).not.toBe(currentOriginalA.poseAnimation!.tracks[0]!.keys);

    setRotation(shotAId, duplicateLayerId, partA, -50, 'Edit copied Layer pose');
    setRotation(duplicatedShot.id, copiedLayerA.id, partA, 20, 'Edit copied Shot pose');
    expect(poseAtTime(editor.getSnapshot()!.project, shotAId, layerAId, partA, 1_000).rotationDeg).toBe(40);
    expect(poseAtTime(editor.getSnapshot()!.project, shotAId, duplicateLayerId, partA, 1_000).rotationDeg).toBe(-50);
    expect(poseAtTime(editor.getSnapshot()!.project, duplicatedShot.id, copiedLayerA.id, partA, 1_000).rotationDeg).toBe(20);
    expect(poseAtTime(editor.getSnapshot()!.project, shotAId, layerBId, partA, 1_000).rotationDeg).toBe(-35);

    const beforeDefaults = editor.getSnapshot()!.project;
    const posedLayerKeys = [
      [shotAId, layerAId],
      [shotAId, layerBId],
      [shotAId, duplicateLayerId],
      [shotBId, layerCId],
      [duplicatedShot.id, copiedLayerA.id],
      [duplicatedShot.id, duplicatedShot.layers.find((layer) => layer.name === duplicateLayerResult.layer.name)!.id],
    ] as const;
    const visualSnapshots = posedLayerKeys.map(([shotId, layerId]) =>
      poseVisualSummary(beforeDefaults, shotId, layerId, 750),
    );
    const staticBeforeDefaults = poseVisualSummary(
      beforeDefaults,
      shotBId,
      staticLayerId,
      750,
    );
    const currentDefinition = characters.getAdaptivePartsDefinition(
      beforeDefaults,
      character.id,
    );
    const replacementPartId = randomUUID();
    const changedParts = currentDefinition.parts
      .slice(1)
      .map((part, index) => ({
        ...part,
        assetId: IDS.assetChar2,
        drawOrder: index,
        visible: true,
        restTransform: {
          ...part.restTransform,
          tx: part.restTransform.tx + 35,
          ty: part.restTransform.ty - 15,
        },
      }));
    changedParts.push({
      ...currentDefinition.parts[0]!,
      partId: replacementPartId,
      assetId: IDS.assetChar2,
      source: { kind: 'manual', sourceId: 'manual:test:replacement-part' },
      drawOrder: changedParts.length,
      visible: true,
      restTransform: {
        ...currentDefinition.parts[0]!.restTransform,
        tx: currentDefinition.parts[0]!.restTransform.tx + 100,
      },
    });
    const changedDefaults = characters.applyAdaptivePartsDefinition(
      beforeDefaults,
      character.id,
      {
        ...currentDefinition,
        sourceRootTransform: {
          ...currentDefinition.sourceRootTransform,
          tx: currentDefinition.sourceRootTransform.tx + 50,
        },
        parts: changedParts,
      },
    );
    commit(changedDefaults, 'Change Character defaults');
    const afterDefaults = editor.getSnapshot()!.project;
    posedLayerKeys.forEach(([shotId, layerId], index) => {
      expect(poseVisualSummary(afterDefaults, shotId, layerId, 750)).toEqual(
        visualSnapshots[index],
      );
    });
    const staticAfterDefaults = poseVisualSummary(
      afterDefaults,
      shotBId,
      staticLayerId,
      750,
    );
    expect(staticAfterDefaults).not.toEqual(staticBeforeDefaults);
    expect(staticAfterDefaults.map((part) => part.partId)).toContain(replacementPartId);
    expect(staticAfterDefaults.map((part) => part.assetId).filter(Boolean)).toEqual(
      Array.from({ length: changedParts.length }, () => IDS.assetChar2),
    );

    const snapshotOnlyReferences = scanAssetReferences(afterDefaults, IDS.assetChar);
    expect(snapshotOnlyReferences.length).toBeGreaterThan(0);
    expect(snapshotOnlyReferences.every((reference) => reference.kind === 'pose-animation-part')).toBe(true);
    expect(
      afterDefaults.shots.flatMap((shot) => shot.layers).some(
        (layer) => layer.poseAnimation?.tracks.some(
          (track) => track.assetId === IDS.assetChar && !track.visible &&
            track.keys.some((key) => key.timeMs === 1_000),
        ),
      ),
    ).toBe(true);
    expect(collectExportPreparationMedia(afterDefaults).map((entry) => entry.asset.id)).toContain(IDS.assetChar);
    expect(evaluateExportPreparationSupport(afterDefaults, 'static').some(
      (issue) => issue.problem.includes('Part pose animation'),
    )).toBe(true);

    const beforeDelete = editor.getSnapshot()!.project;
    const deletedCopy = layers.deleteLayer(beforeDelete, shotAId, duplicateLayerId);
    commit(deletedCopy, 'Delete duplicated layer');
    expect(poseAtTime(editor.getSnapshot()!.project, shotAId, layerAId, partA, 1_000).rotationDeg).toBe(40);
    expect(poseAtTime(editor.getSnapshot()!.project, shotAId, layerBId, partA, 1_000).rotationDeg).toBe(-35);
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots.find((shot) => shot.id === shotAId)!.layers.some((layer) => layer.id === duplicateLayerId)).toBe(true);

    const finalProject = editor.getSnapshot()!.project;
    const finalRevision = editor.getSnapshot()!.revision;
    await projectService.save(projectRoot, finalProject, finalRevision);
    const reopened = await projectService.open(projectRoot);
    expect(scanAssetReferences(reopened.project, IDS.assetChar).every(
      (reference) => reference.kind === 'pose-animation-part',
    )).toBe(true);
    expect(collectExportPreparationMedia(reopened.project).map((entry) => entry.asset.id)).toContain(IDS.assetChar);
    expect(poseAtTime(reopened.project, shotAId, layerAId, partA, 1_000).rotationDeg).toBe(40);
    expect(poseAtTime(reopened.project, shotAId, layerBId, partA, 1_000).rotationDeg).toBe(-35);
    expect(poseAtTime(reopened.project, shotAId, duplicateLayerId, partA, 1_000).rotationDeg).toBe(-50);
    expect(poseAtTime(reopened.project, duplicatedShot.id, copiedLayerA.id, partA, 1_000).rotationDeg).toBe(20);
    expect(poseAtTime(reopened.project, shotBId, layerCId, partB, 1_000).rotationDeg).toBe(25);
    for (const [timeMs, expectedRotation] of [
      [1_000, 40],
      [0, 0],
      [750, 30],
      [250, 10],
      [1_000, 40],
    ] as const) {
      expect(
        poseAtTime(reopened.project, shotAId, layerAId, partA, timeMs)
          .rotationDeg,
      ).toBe(expectedRotation);
    }
    expect(poseVisualSummary(reopened.project, shotAId, layerAId, 750)).toEqual(
      visualSnapshots[0],
    );
    editor.clear();
  });
});
