import { afterEach, expect, it, vi } from 'vitest';
import { DialogueService, saveActionRecipe, type Project } from '../../src/domain';
import { DesktopAutomationRendererRequestSchema } from '../../src/shared/desktop-automation-api';
import { executeDesktopAutomation } from '../../src/renderer/shell/desktopAutomationCommands';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { IDS, buildProject } from './domain/testProject';

const sessionId = '12900000-0000-4000-8000-000000000001';
const requestId = '12900000-0000-4000-8000-000000000002';
const dialogueId = '12900000-0000-4000-8000-000000000003';
const recipeStepId = '12900000-0000-4000-8000-000000000004';
const preview = vi.fn<(project: Project, shotId: string) => boolean>(() => true);

const command = (value: unknown) => executeDesktopAutomation(DesktopAutomationRendererRequestSchema.parse({
  requestId, sessionId, deadlineMs: Date.now() + 5_000, appVersion: '0.1.0', command: value,
}), preview);

afterEach(() => { editorProjectStore.clear(); preview.mockClear(); });

it('applies atomic changes in the current History and preserves partial success in a sequence', () => {
  const project = new DialogueService({ createId: () => dialogueId }).create(buildProject(), {
    shotId: IDS.shot, text: 'Original line', pointTimeMs: 500, speakerType: 'narrator',
  });
  editorProjectStore.open('C:/tmp/cli-one.pandastage', project);
  shotStore.select(IDS.shot);
  const state = command({ name: 'state' });
  if (!state.ok) throw new Error(state.message);
  const session = state.data.session;
  const update = { name: 'dialogue.update', shotId: IDS.shot, dialogueId, text: 'Changed' };
  const preset = { name: 'preset.apply', shotId: IDS.shot, layerId: IDS.layerAsset, presetId: 'fade-in', parameters: { durationMs: 500 } };
  const invalid = { ...update, dialogueId: IDS.unknownExpression };
  const before = editorProjectStore.getSnapshot()!;
  expect(before.dirty).toBe(false);
  expect(command({ name: 'batch', session, operations: [update, invalid] })).toMatchObject({ ok: false, code: 'COMMAND_FAILED' });
  expect(editorProjectStore.getSnapshot()).toBe(before);
  expect(command({ name: 'batch', session, operations: [update, preset] })).toMatchObject({ ok: true, data: { revision: before.revision + 1, dirty: true } });
  expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents).toHaveLength(1);
  expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
  expect(command({ name: 'undo', session })).toMatchObject({ ok: true, data: { undone: '桌面自动化批量编辑' } });
  expect(editorProjectStore.getSnapshot()!.project).toEqual(before.project);

  expect(command({ name: 'sequence', session, operations: [update, invalid] })).toMatchObject({ ok: true, data: { allSucceeded: false,
    steps: [{ result: { ok: true } }, { result: { ok: false, code: 'COMMAND_FAILED' } }] } });
  expect(editorProjectStore.getSnapshot()!.project.shots[0]!.dialogues[0]!.text).toBe('Changed');
  editorProjectStore.open('C:/tmp/cli-two.pandastage', project);
  const reopened = editorProjectStore.getSnapshot();
  expect(command({ ...update, session })).toMatchObject({ ok: false, code: 'STALE_SESSION' });
  expect(editorProjectStore.getSnapshot()).toBe(reopened);
});

it('previews and applies a rebound recipe without adding a separate History entry for preview', () => {
  const project = saveActionRecipe(buildProject(), { name: 'Change expression', steps: [
    { kind: 'expression', id: recipeStepId, offsetMs: 0, durationMs: 100 },
  ] });
  editorProjectStore.open('C:/tmp/cli-recipe.pandastage', project);
  shotStore.select(IDS.shot);
  const state = command({ name: 'state' });
  if (!state.ok) throw new Error(state.message);
  const session = state.data.session;
  const data = { session, recipeId: project.actionRecipes![0]!.id, shotId: IDS.shot, layerId: IDS.layerChar, startMs: 250,
    bindings: { [recipeStepId]: IDS.expressionAngry } };
  const before = editorProjectStore.getSnapshot();
  expect(command({ name: 'recipe.preview', ...data })).toMatchObject({ ok: true, data: { changed: false } });
  expect(preview).toHaveBeenCalledTimes(1);
  expect(preview.mock.calls[0]![0].shots[0]!.timelineEvents).toMatchObject([{ type: 'expression', expressionId: IDS.expressionAngry }]);
  expect(editorProjectStore.getSnapshot()).toBe(before);
  expect(command({ name: 'recipe.apply', ...data })).toMatchObject({ ok: true, data: { changed: true } });
  expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents).toMatchObject([{ type: 'expression', expressionId: IDS.expressionAngry }]);
  expect(command({ name: 'undo', session })).toMatchObject({ ok: true, data: { undone: '应用操作配方' } });
  expect(editorProjectStore.getSnapshot()!.project).toEqual(project);
});
