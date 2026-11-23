import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  actionRecipeBindingOptions,
  applyActionRecipe,
  evaluateShotAtTime,
  ProjectSchema,
  saveActionRecipe,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { projectProductPreviewDialogue } from '../../src/renderer/shell/productPreviewModel';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from '../unit/domain/testProject';

it('runs an authored recipe against a new target with explicit role binding, one Undo and save/reopen', async () => {
  const parent = await mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-action-recipe-'));
  try {
    const projects = new ProjectService();
    const created = await projects.createAt(parent, 'Recipe', { name: 'Recipe' });
    const base = graphicFaceProject();
    const first = base.characters[0]!;
    if (first.mode !== 'single-image') throw new Error('Fixture character must use a single image.');
    const secondId = randomUUID();
    const voiceId = randomUUID();
    const expressionId = randomUUID();
    const actionId = randomUUID();
    const newLayerId = randomUUID();
    const expressionStep = randomUUID();
    const actionStep = randomUUID();
    const second = { ...first, id: secondId, name: '第二个角色', defaultVoiceProfileId: voiceId,
      baseAssetId: first.expressions[1]!.assetId, defaultExpressionId: expressionId,
      expressions: [{ ...first.expressions[1]!, id: expressionId }],
      actions: [{ id: actionId, name: '招手', animationId: FACE_GRAPHIC_ID, placement: { offsetX: 0, offsetY: 0, scale: 1 } }] };
    const shot = base.shots[0]!;
    const originalLayer = shot.layers.find(({ id }) => id === IDS.layerChar)!;
    const project = ProjectSchema.parse({ ...base, id: created.project.id, characters: [...base.characters, second],
      voiceProfiles: [...base.voiceProfiles, { ...base.voiceProfiles[0], id: voiceId, characterId: secondId }],
      shots: [{ ...shot, layers: [...shot.layers, { ...originalLayer, id: newLayerId, x: 1_000, name: '目标角色',
        zIndex: 5, source: { kind: 'character', characterId: secondId, expressionId } }] }] });
    const library = saveActionRecipe(project, { name: '入场→强调→抖动', steps: [
      { id: randomUUID(), kind: 'preset', presetId: 'enter-left', offsetMs: 0, durationMs: 500 },
      { id: randomUUID(), kind: 'preset', presetId: 'scale-emphasis', offsetMs: 500, durationMs: 500, parameters: { scaleFactor: 1.2 } },
      { id: randomUUID(), kind: 'preset', presetId: 'shake', offsetMs: 1_000, durationMs: 500 },
      { id: expressionStep, kind: 'expression', preferredName: '生气', offsetMs: 1_500, durationMs: 500 },
      { id: actionStep, kind: 'action', preferredName: '招手', offsetMs: 2_000, durationMs: 500 },
    ] });
    const recipe = library.actionRecipes![0]!;
    const target = { shotId: IDS.shot, layerId: newLayerId, startMs: 0 };
    expect(actionRecipeBindingOptions(library, target, recipe.steps[3]!).map(({ id }) => id)).toEqual([expressionId]);
    expect(() => applyActionRecipe(library, recipe.id, target, { [expressionStep]: IDS.expressionAngry, [actionStep]: actionId }))
      .toThrow('第 4 步');
    expect(library.shots[0]!.timelineEvents).toHaveLength(0);
    const plainTarget = { ...target, layerId: IDS.layerAsset };
    const withoutRoles = applyActionRecipe(library, recipe.id, plainTarget, { [expressionStep]: null, [actionStep]: null });
    expect(withoutRoles.shots[0]!.timelineEvents.map(({ type }) => type)).toEqual(['move', 'scale', 'shake']);
    expect(withoutRoles.shots[0]!.timelineEvents.every(({ layerId }) => layerId === IDS.layerAsset)).toBe(true);

    const editor = new EditorProjectStore();
    editor.open(created.projectRoot, library);
    const draft = applyActionRecipe(library, recipe.id, target, { [expressionStep]: expressionId, [actionStep]: actionId });
    expect(editor.getSnapshot()!.project).toEqual(library);
    const events = draft.shots[0]!.timelineEvents;
    expect(events).toMatchObject([
      { type: 'move', layerId: newLayerId, to: { x: 1_000 } },
      { type: 'scale', layerId: newLayerId },
      { type: 'shake', layerId: newLayerId },
      { type: 'expression', expressionId },
      { type: 'character-action', actionId },
    ]);
    expect(draft.shots[0]!.layers).toEqual(library.shots[0]!.layers);
    editor.updateProject(draft, '运行操作配方');
    expect(editor.history.getSnapshot().undoCount).toBe(1);
    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project).toEqual(library);
    expect(editor.redo()).toBe(true);
    await projects.save(created.projectRoot, editor.getSnapshot()!.project);
    const reopened = (await projects.open(created.projectRoot)).project;
    expect(reopened).toEqual(draft);
    const editedShot = reopened.shots[0]!;
    for (const time of [2_250, 250, 1_700, 1_250, 750]) {
      const stage = evaluateShotAtTime(editedShot, time, reopened);
      const expected = stage.layers.find(({ id }) => id === newLayerId);
      expect(projectProductPreviewDialogue(reopened, editedShot, stage).layers.find(({ id }) => id === newLayerId)).toEqual(expected);
      expect(evaluateExportShotAtTime(reopened, editedShot, time).layers.find(({ id }) => id === newLayerId)).toEqual(expected);
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
