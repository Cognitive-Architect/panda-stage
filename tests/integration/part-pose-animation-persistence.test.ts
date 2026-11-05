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
  type Project,
} from '../../src/domain';
import { evaluateExportPreparationSupport } from '../../src/domain/export-preparation';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import {
  adaptivePartsFixture,
  adaptivePartsSourceRootTransform,
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
    project = new CharacterService().createAdaptiveParts(project, {
      name: 'Pose Character',
      sourceRootTransform: adaptivePartsSourceRootTransform(),
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
      { x: 960, y: 540 },
    );
    project = placed.project;
    await projectService.save(projectRoot, project, 1);

    const editor = new EditorProjectStore();
    editor.open(projectRoot, project);
    const poses = new PartPoseAnimationService();
    const captured = poses.create(project, {
      shotId: IDS.shot,
      layerId: placed.layer.id,
    });
    editor.updateProject(captured, 'Capture Part pose snapshot');
    const capturedSnapshot = editor.getSnapshot()!;
    const track = capturedSnapshot.project.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation!.tracks[0]!;
    const keyed = poses.setKeyframe(capturedSnapshot.project, {
      shotId: IDS.shot,
      layerId: placed.layer.id,
      partId: track.partId,
      keyframe: {
        frame: 24,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 270,
        scale: 1,
        easingToNext: 'linear',
      },
    });
    editor.updateProject(keyed, 'Set Part rotation keyframe');
    expect(editor.getSnapshot()).toMatchObject({ revision: 2, dirty: true });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 2, redoCount: 0 });

    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots[0]!.layers.find(
      (layer) => layer.id === placed.layer.id,
    )!.poseAnimation!.tracks[0]!.keys).toHaveLength(1);
    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()).toMatchObject({ revision: 4, dirty: true });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 2, redoCount: 0 });

    const committed = editor.getSnapshot()!.project;
    const committedSnapshot = editor.getSnapshot()!;
    const historyBeforeSeek = editor.history.getSnapshot();
    const beforeSave = evaluatedVisuals(committed, placed.layer.id);
    expect(editor.getSnapshot()).toBe(committedSnapshot);
    expect(editor.history.getSnapshot()).toEqual(historyBeforeSeek);
    expect(committedSnapshot).toMatchObject({ revision: 4, dirty: true });
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
    editor.clear();
  });
});
