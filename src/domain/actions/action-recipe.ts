import { ActionRecipeSchema, type ActionRecipe, type ActionRecipeStep } from '../models/actionRecipe';
import { ProjectSchema, type Project } from '../models/project';
import { upsertCharacterActionEvent } from '../services/CharacterActionEventService';
import { LayerMotionService } from '../services/LayerMotionService';
import { resolveTimelineFrameTime } from '../timeline/frame-grid';
import { validatePresetApplication } from '../validators';
import { ACTION_PRESET_BY_ID } from './ActionPreset';
import { applyPresetEvents } from './applyPresetEvents';
import { createPresetEvents } from './createPresetEvents';

export interface ActionRecipeTarget {
  shotId: string;
  layerId: string;
  startMs: number;
}

/** A null binding explicitly skips this step for the current run. */
export type ActionRecipeBindings = Readonly<Record<string, string | null>>;

const motion = new LayerMotionService();

export function saveActionRecipe(project: Project, input: Omit<ActionRecipe, 'id'>, replaceId?: string): Project {
  const recipes = project.actionRecipes ?? [];
  if (replaceId && !recipes.some(({ id }) => id === replaceId)) throw new Error('找不到要更新的配方。');
  const recipe = ActionRecipeSchema.parse({ ...input, id: replaceId ?? crypto.randomUUID() });
  return ProjectSchema.parse({ ...project, actionRecipes: replaceId
    ? recipes.map((entry) => entry.id === replaceId ? recipe : entry)
    : [...recipes, recipe] });
}

export function actionRecipeStepLabel(project: Project, step: ActionRecipeStep): string {
  switch (step.kind) {
    case 'preset': return ACTION_PRESET_BY_ID[step.presetId].label;
    case 'motion': return project.userMotionPresets?.find(({ id }) => id === step.presetId)?.name ?? '运动预设不可用';
    case 'action': return '角色动作';
    case 'expression': return '切换表情';
  }
}

export function actionRecipeBindingOptions(project: Project, target: Pick<ActionRecipeTarget, 'shotId' | 'layerId'>,
  step: ActionRecipeStep): readonly { id: string; name: string }[] {
  if (step.kind !== 'expression' && step.kind !== 'action') return [];
  const layer = project.shots.find(({ id }) => id === target.shotId)?.layers.find(({ id }) => id === target.layerId);
  if (layer?.source.kind !== 'character') return [];
  const characterId = layer.source.characterId;
  const character = project.characters.find(({ id }) => id === characterId);
  if (step.kind === 'action') return character?.actions ?? [];
  if (character?.mode === 'adaptive-parts' && !character.faceBinding) return [];
  return character?.expressions ?? [];
}

/** Computes a complete document change. The caller commits this result to its existing History once. */
export function applyActionRecipe(
  project: Project, recipeId: string, target: ActionRecipeTarget, bindings: ActionRecipeBindings,
): Project {
  const recipe = project.actionRecipes?.find(({ id }) => id === recipeId);
  const shot = project.shots.find(({ id }) => id === target.shotId);
  const layer = shot?.layers.find(({ id }) => id === target.layerId);
  if (!recipe) throw new Error('找不到选择的操作配方。');
  if (!shot || !layer || shot.backgroundLayerId === layer.id || layer.locked) throw new Error('请选择可编辑的非背景图层。');
  if (!Number.isSafeInteger(target.startMs) || target.startMs < 0 || target.startMs > shot.durationMs) {
    throw new Error('配方起点必须在当前镜头内。');
  }

  let draft = project;
  recipe.steps.forEach((step, index) => {
    const binding = bindings[step.id];
    if (binding === null) return;
    const startMs = target.startMs + step.offsetMs;
    const label = actionRecipeStepLabel(project, step);
    try {
      if (startMs > shot.durationMs || ('durationMs' in step && startMs + step.durationMs > shot.durationMs)) {
        throw new Error('步骤超出当前镜头。');
      }
      if (step.kind === 'motion') {
        draft = motion.applyUserMotionPreset(draft,
          { shotId: shot.id, layerId: layer.id, timeMs: resolveTimelineFrameTime(startMs, shot.durationMs) }, step.presetId);
        return;
      }
      if ((step.kind === 'expression' || step.kind === 'action') &&
        !actionRecipeBindingOptions(project, target, step).some(({ id }) => id === binding)) {
        throw new Error('请选择目标角色中的对应项，或跳过此步。');
      }
      if (step.kind === 'action') {
        draft = upsertCharacterActionEvent(draft, shot.id, layer.id, {
          actionId: binding!, startMs, endMs: startMs + step.durationMs,
        });
        return;
      }
      const presetId = step.kind === 'expression' ? 'expression-switch' : step.presetId;
      const params = step.kind === 'expression' ? { expressionId: binding } : step.parameters;
      const events = createPresetEvents(draft, shot.id, layer.id, presetId, { ...params, startMs, durationMs: step.durationMs });
      const validation = validatePresetApplication(draft, shot.id, layer.id, events);
      if (!validation.ok) throw new Error(validation.errors.join('；'));
      draft = applyPresetEvents(draft, shot.id, events);
    } catch (cause) {
      throw new Error(`第 ${index + 1} 步 · ${label}：${cause instanceof Error ? cause.message : '无法执行。'}`, { cause });
    }
  });
  return draft;
}
