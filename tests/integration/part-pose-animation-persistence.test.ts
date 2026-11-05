import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  PartPoseAnimationService,
  ProjectSchema,
  evaluateShotAtTime,
  resolveLayerVisualParts,
  transformPointByVisualPart,
  type Project,
} from '../../src/domain';
import { evaluateExportPreparationSupport } from '../../src/domain/export-preparation';
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
});
