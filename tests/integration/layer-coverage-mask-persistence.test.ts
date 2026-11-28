import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LayerService,
  ProjectSchema,
  PROJECT_SCHEMA_VERSION,
  buildCoverageMaskClips,
  buildEditorStageRenderModel,
  evaluateShotAtTime,
  type Project,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProject, IDS } from '../unit/domain/testProject';

const MASK_LAYER_ID = '60000000-0000-4000-8000-000000000010';
const temporaryParents: string[] = [];

async function projectRoot(): Promise<string> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-mask-'),
  );
  temporaryParents.push(parent);
  return path.join(parent, '遮罩 镜头.pandastage');
}

function projectService(): ProjectService {
  let counter = 0;
  return new ProjectService({
    createId: () =>
      `d2060000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-11-28T06:30:00.000Z'),
  });
}

function projectWithMask(base: Project, targetLayerIds: readonly string[]): Project {
  return ProjectSchema.parse({
    ...base,
    shots: base.shots.map((shot) => ({
      ...shot,
      layers: [...shot.layers, {
        id: MASK_LAYER_ID,
        name: '门框遮罩',
        source: { kind: 'asset', assetId: IDS.assetChar },
        anchor: 'center',
        x: 960,
        y: 540,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        opacity: 1,
        visible: true,
        zIndex: 5,
        locked: false,
        flipX: false,
        maskTargets: [...targetLayerIds],
      }],
    })),
  });
}

function clipSnapshot(project: Project): unknown {
  const shot = project.shots[0]!;
  const evaluated = evaluateShotAtTime(shot, 0, project);
  const model = buildEditorStageRenderModel(project, shot, evaluated);
  return [...buildCoverageMaskClips(model, undefined).clips.entries()]
    .map(([targetLayerId, clip]) => [
      targetLayerId,
      clip.maskLayerId,
      clip.paths.map((path) => path.d),
    ]);
}

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('coverage mask persistence and history (#1454)', () => {
  it('reopens the same mask relation and evaluated coverage, and undo/redo is one step', async () => {
    const root = await projectRoot();
    const service = projectService();
    const created = await service.create(root, { name: 'mask project' });
    const base = ProjectSchema.parse({ ...buildProject(), id: created.project.id });
    const masked = projectWithMask(base, [IDS.layerChar]);
    await service.save(root, masked, 1);

    const reopened = await service.open(root);
    expect(reopened.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(reopened.project.shots[0]!.layers.find((layer) => layer.id === MASK_LAYER_ID)?.maskTargets)
      .toEqual([IDS.layerChar]);
    expect(clipSnapshot(reopened.project)).toEqual(clipSnapshot(masked));
    expect(created.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

    // The single renderer store records one history step for one mask action.
    const editor = new EditorProjectStore();
    editor.open(root, reopened.project);
    const layerService = new LayerService();
    const withoutMask = layerService.setMaskTargets(
      reopened.project,
      IDS.shot,
      MASK_LAYER_ID,
      null,
    );
    editor.updateProject(withoutMask, '解除遮罩');
    expect(clipSnapshot(editor.getSnapshot()!.project)).toEqual([]);

    expect(editor.undo()).toBe(true);
    expect(clipSnapshot(editor.getSnapshot()!.project)).toEqual(clipSnapshot(masked));
    expect(editor.redo()).toBe(true);
    expect(clipSnapshot(editor.getSnapshot()!.project)).toEqual([]);

    // Saving the undone (clear) state and reopening keeps targets unclipped.
    await service.save(root, editor.getSnapshot()!.project, 1);
    const finalOpen = await service.open(root);
    expect(finalOpen.project.shots[0]!.layers.find((layer) => layer.id === MASK_LAYER_ID)?.maskTargets)
      .toBeUndefined();
    expect(clipSnapshot(finalOpen.project)).toEqual([]);
  });
});
