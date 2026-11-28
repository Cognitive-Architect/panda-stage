import {
  ACTION_PRESETS, ACTION_PRESET_BY_ID, DialogueService, applyActionRecipe, applyPresetEvents,
  applyScriptPerformancePlan, createPresetEvents, planScriptPerformance, validatePresetApplication,
  type Project, type ScriptDialogueAudioOverride, type ScriptPerformancePlan,
} from '../../domain';
import type { DesktopAutomationEdit, DesktopAutomationRendererRequest, DesktopAutomationResult } from '../../shared/desktop-automation-api';
import { timelineUiStore } from '../features/timeline/timelineUiStore';
import { editorProjectStore } from '../stores/EditorProjectStore';
import { selectionStore } from '../stores/selectionStore';
import { shotStore } from '../stores/shotStore';
import { dialoguePerformanceLinkStore } from '../stores/dialoguePerformanceLinkStore';

const dialogue = new DialogueService();
const fail = (code: Extract<DesktopAutomationResult, { ok: false }>['code'], message: string): DesktopAutomationResult => ({ ok: false, code, message });

function outcome(beforeRevision: number, data: Record<string, unknown>): DesktopAutomationResult {
  const snapshot = editorProjectStore.getSnapshot()!;
  return { ok: true, data: { ...data, changed: snapshot.revision !== beforeRevision, revision: snapshot.revision, dirty: snapshot.dirty } };
}

function readState(request: DesktopAutomationRendererRequest): DesktopAutomationResult {
  const snapshot = editorProjectStore.getSnapshot();
  const instanceId = editorProjectStore.getProjectInstanceId();
  if (!snapshot || instanceId === null) return fail('NO_PROJECT', 'No Project is open in the desktop editor.');
  const { project, revision, dirty } = snapshot;
  const shotId = shotStore.getCurrentShotId();
  const shot = project.shots.find(({ id }) => id === shotId);
  const selectedLayer = shot?.layers.find(({ id }) => id === selectionStore.getSelectedLayerId());
  return { ok: true, data: {
    appVersion: request.appVersion,
    session: { sessionId: request.sessionId, projectId: project.id, instanceId },
    project: { id: project.id, name: project.name, schemaVersion: project.schemaVersion, revision, dirty },
    shots: project.shots.map(({ id, name, durationMs }) => ({ id, name, durationMs })),
    shot: shot ? { id: shot.id, name: shot.name, durationMs: shot.durationMs,
      playheadMs: timelineUiStore.getSnapshot().currentTimeMs,
      dialogues: shot.dialogues.map(({ id, text, startMs, endMs }) => ({ id, text, startMs, endMs })),
      layers: shot.layers.map(({ id, name, locked, source }) => ({ id, name, locked,
        ...(source.kind === 'character' ? { characterId: source.characterId } : {}),
      })),
    } : null,
    selection: selectedLayer ? { layerId: selectedLayer.id, nodeId: selectionStore.getSelectedCharacterNodeId() } : null,
    history: editorProjectStore.history.getSnapshot(),
    presets: ACTION_PRESETS.map(({ id, label }) => ({ id, label })),
    recipes: project.actionRecipes ?? [],
    characters: project.characters.map(({ id, name, actions, expressions }) => ({ id, name,
      actions: actions?.map(entry => ({ id: entry.id, name: entry.name })) ?? [],
      expressions: expressions?.map(entry => ({ id: entry.id, name: entry.name })) ?? [],
    })),
  } };
}

function editProject(project: Project, operation: DesktopAutomationEdit): { project: Project; label: string; target: Record<string, unknown> } {
  const { shotId } = operation;
  if (operation.name === 'dialogue.update') {
    const { text, dialogueId } = operation;
    const before = project.shots.find(({ id }) => id === shotId)?.dialogues.find(({ id }) => id === dialogueId);
    const next = before?.text === text ? project : dialogue.update(project, { shotId, dialogueId, text });
    return { project: next, label: 'Edit dialogue', target: { shotId, dialogueId, text } };
  }
  const { layerId } = operation;
  if (operation.name === 'preset.apply') {
    const { presetId } = operation;
    const events = createPresetEvents(project, shotId, layerId, presetId, operation.parameters);
    const checked = validatePresetApplication(project, shotId, layerId, events);
    if (!checked.ok) throw new Error(checked.errors.join('；'));
    return { project: applyPresetEvents(project, shotId, events), label: `应用动作预设：${ACTION_PRESET_BY_ID[presetId].label}`,
      target: { shotId, layerId, presetId, eventIds: events.map(({ id }) => id) } };
  }
  const { recipeId, startMs, bindings } = operation;
  const recipe = project.actionRecipes?.find(({ id }) => id === recipeId);
  const stepsById = new Map(recipe?.steps.map(step => [step.id, step]));
  if (Object.entries(bindings).some(([id, value]) => {
    const step = stepsById.get(id);
    return !step || (value !== null && step.kind !== 'action' && step.kind !== 'expression');
  })) throw new Error('A recipe binding does not match a step in this recipe.');
  return { project: applyActionRecipe(project, recipeId, { shotId, layerId, startMs }, bindings),
    label: '应用操作配方', target: { shotId, layerId, recipeId, startMs } };
}

type SerialOperation = DesktopAutomationEdit | { name: 'undo' };
function commitOne(operation: SerialOperation): DesktopAutomationResult {
  const current = editorProjectStore.getSnapshot()!;
  try {
    if (operation.name === 'undo') {
      const label = editorProjectStore.history.getSnapshot().nextUndoLabel;
      const undone = editorProjectStore.undo();
      return outcome(current.revision, { command: 'undo', undone: undone ? label : null });
    }
    const change = editProject(current.project, operation);
    if (change.project !== current.project) editorProjectStore.updateProject(change.project, change.label);
    return outcome(current.revision, { command: operation.name, ...change.target });
  } catch (error) {
    return fail('COMMAND_FAILED', error instanceof Error ? error.message : 'The requested operation failed.');
  }
}

function buildScriptPlanFromCommand(
  project: Project,
  command: Extract<DesktopAutomationRendererRequest['command'], { name: 'script.plan' | 'script.apply' }>,
): ScriptPerformancePlan {
  const baseOptions = {
    ...(command.defaultDurationMs !== undefined ? { defaultDurationMs: command.defaultDurationMs } : {}),
    ...(command.extendShotForPerformance !== undefined ? { extendShotForPerformance: command.extendShotForPerformance } : {}),
  };
  if (!command.audioByOrdinal || Object.keys(command.audioByOrdinal).length === 0) {
    return planScriptPerformance(project, command.script, {
      ...baseOptions,
      ...(command.excludedDirectiveIds
        ? { overrides: { excludedDirectiveIds: command.excludedDirectiveIds } }
        : {}),
    });
  }
  // Map 1-based ordinal overrides to stable draftRowIds via the same shared planner.
  const initial = planScriptPerformance(project, command.script, baseOptions);
  const audioByDraftRowId: Record<string, ScriptDialogueAudioOverride> = {};
  for (const row of initial.dialogues) {
    const override = command.audioByOrdinal[String(row.ordinal)];
    if (override) {
      audioByDraftRowId[row.draftRowId] = {
        ...(override.audioAssetId !== undefined ? { audioAssetId: override.audioAssetId } : {}),
        ...(override.sourceStartMs !== undefined ? { sourceStartMs: override.sourceStartMs } : {}),
        ...(override.sourceEndMs !== undefined ? { sourceEndMs: override.sourceEndMs } : {}),
      };
    }
  }
  return planScriptPerformance(project, command.script, {
    ...baseOptions,
    previousDialogueRows: initial.dialogueDraftRows,
    overrides: {
      audioByDraftRowId,
      ...(command.excludedDirectiveIds ? { excludedDirectiveIds: command.excludedDirectiveIds } : {}),
    },
  });
}

function summarizeScriptPlan(plan: ScriptPerformancePlan): Record<string, unknown> {
  return {
    applicableBlockCount: plan.applicableBlockCount,
    scheduledDialogueCount: plan.scheduledDialogueCount,
    unreadyDialogueCount: plan.unreadyDialogueCount,
    readyPerformanceCount: plan.readyPerformanceCount,
    issuePerformanceCount: plan.issuePerformanceCount,
    skippedPerformanceCount: plan.skippedPerformanceCount,
    hasIssues: plan.hasIssues,
    createdShotIds: plan.createdShotIds,
    dialogueIdByDraftRowId: plan.dialogueIdByDraftRowId,
    parseIssues: plan.parsed.sceneParseIssues,
    blocks: plan.blocks.map((block) => ({
      blockIndex: block.scene.blockIndex,
      shotName: block.scene.shotName,
      applicable: block.scene.applicable,
      createdShotId: block.scene.createdShotId,
      finalDurationMs: block.finalDurationMs,
      extendedForAudio: block.extendedForAudio,
      extendedForPerformance: block.extendedForPerformance,
      issues: block.scene.issues,
    })),
    dialogues: plan.dialogues.map((row) => ({
      draftRowId: row.draftRowId,
      ordinal: row.ordinal,
      blockIndex: row.blockIndex,
      speakerName: row.speakerName,
      text: row.text,
      status: row.status,
      shotId: row.shotId,
      dialogueId: row.dialogueId,
      audioClipId: row.audioClipId,
      startMs: row.startMs,
      endMs: row.endMs,
      issueCode: row.issueCode,
      issueMessage: row.issueMessage,
    })),
    performances: plan.performances.map((row) => ({
      directiveId: row.directiveId,
      blockIndex: row.blockIndex,
      dialogueOrdinal: row.dialogueOrdinal,
      draftRowId: row.draftRowId,
      dialogueId: row.dialogueId,
      shotId: row.shotId,
      layerId: row.layerId,
      action: row.action,
      actionLabel: row.actionLabel,
      startMs: row.startMs,
      endMs: row.endMs,
      requiredShotDurationMs: row.requiredShotDurationMs,
      status: row.status,
      eventIds: row.eventIds,
      ...(row.motionKeyTimes ? { motionKeyTimes: row.motionKeyTimes } : {}),
      ...(row.cameraKeyTimes ? { cameraKeyTimes: row.cameraKeyTimes } : {}),
      issueCode: row.issueCode,
      issueMessage: row.issueMessage,
    })),
  };
}

export function executeDesktopAutomation(request: DesktopAutomationRendererRequest,
  previewDraft: (project: Project, shotId: string) => boolean): DesktopAutomationResult {
  if (Date.now() >= request.deadlineMs) return fail('TIMEOUT', 'The desktop command expired.');
  const command = request.command;
  if (command.name === 'state') return readState(request);
  const current = editorProjectStore.getSnapshot();
  if (!current || command.session.sessionId !== request.sessionId || command.session.projectId !== current.project.id ||
    command.session.instanceId !== editorProjectStore.getProjectInstanceId()) {
    return fail('STALE_SESSION', 'The original desktop Project session is no longer active. Read state again.');
  }
  try {
    editorProjectStore.assertProjectOperationIdle();
    if (command.name === 'script.plan') {
      const plan = buildScriptPlanFromCommand(current.project, command);
      return outcome(current.revision, { command: command.name, ...summarizeScriptPlan(plan) });
    }
    if (command.name === 'script.apply') {
      const plan = buildScriptPlanFromCommand(current.project, command);
      const applied = applyScriptPerformancePlan(current.project, plan, {
        allowPartialConfirm: command.allowPartialConfirm ?? false,
      });
      if (!applied.ok) return fail('COMMAND_FAILED', applied.message);
      dialoguePerformanceLinkStore.capture(plan.performances);
      const label = plan.parsed.hasDialogueOrPerformance
        ? `剧本表演生成（${applied.createdShotIds.length} 镜头 / ${applied.scheduledDialogueCount} 对白 / ${applied.readyPerformanceCount} 动作）`
        : `自动布景（${applied.createdShotIds.length} 个镜头）`;
      editorProjectStore.updateProject(applied.project, label);
      shotStore.select(applied.firstShotId);
      return outcome(current.revision, {
        command: command.name,
        firstShotId: applied.firstShotId,
        ...summarizeScriptPlan(plan),
      });
    }
    if (command.name === 'sequence') {
      const steps = command.operations.map(operation => ({ command: operation.name, result: commitOne(operation) }));
      return outcome(current.revision, { command: command.name, steps, allSucceeded: steps.every(({ result }) => result.ok) });
    }
    if (command.name === 'batch') {
      let next = current.project;
      const steps = command.operations.map((operation, index) => {
        try {
          const change = editProject(next, operation);
          next = change.project;
          return { command: operation.name, ...change.target };
        } catch (error) {
          throw new Error(`Batch step ${index + 1} (${operation.name}): ${error instanceof Error ? error.message : 'failed'}`, { cause: error });
        }
      });
      if (next !== current.project) editorProjectStore.updateProject(next, '桌面自动化批量编辑');
      return outcome(current.revision, { command: command.name, steps });
    }
    if (command.name === 'recipe.preview') {
      const change = editProject(current.project, { ...command, name: 'recipe.apply' });
      if (!previewDraft(change.project, command.shotId)) return fail('COMMAND_FAILED', 'Select the requested shot and close any existing preview first.');
      return outcome(current.revision, { command: command.name, ...change.target });
    }
    return commitOne(command);
  } catch (error) {
    return fail('COMMAND_FAILED', error instanceof Error ? error.message : 'The requested operation failed.');
  }
}
