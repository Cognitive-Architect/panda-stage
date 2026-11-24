import { useState } from 'react';
import {
  ACTION_PRESETS,
  actionRecipeBindingOptions,
  actionRecipeStepLabel,
  applyActionRecipe,
  saveActionRecipe,
  userMotionPresetContinuationSpanMs,
  type ActionPresetDefinition,
  type Layer,
  type Project,
  type Shot,
} from '../../../domain';
import type { ActionRecipe, ActionRecipeStep } from '../../../domain/models/actionRecipe';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { formatTimecode } from '../timeline/timeGeometry';

type PresetStep = Extract<ActionRecipeStep, { kind: 'preset' }>;
type NumericParameter = keyof NonNullable<PresetStep['parameters']>;
const BUILTINS = ACTION_PRESETS.filter((preset): preset is ActionPresetDefinition & { id: PresetStep['presetId'] } =>
  preset.id !== 'expression-switch');
const SKIP = 'skip';

function ActionRecipeRun({ project, shot, layer, recipe, onPreview }: {
  project: Project;
  shot: Shot;
  layer: Layer;
  recipe: ActionRecipe;
  onPreview?: (draft: Project) => void;
}): React.JSX.Element {
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const { currentTimeMs } = useTimelineUi();
  const instance = editorProjectStore.getProjectInstanceId();
  const target = { shotId: shot.id, layerId: layer.id };
  const planned = recipe.steps.map((step) => {
    const options = actionRecipeBindingOptions(project, target, step);
    const suggestions = 'preferredName' in step && step.preferredName
      ? options.filter((option) => option.name === step.preferredName)
      : [];
    const value = resolved[step.id] ?? (suggestions.length === 1 ? suggestions[0]!.id : '');
    return { step, options, value, hasRole: step.kind === 'expression' || step.kind === 'action' };
  });
  const unresolved = planned.some(({ hasRole, value, options }) =>
    hasRole && value !== SKIP && !options.some((option) => option.id === value));
  const canExecute = !layer.locked && shot.backgroundLayerId !== layer.id && !unresolved &&
    planned.some(({ value }) => value !== SKIP);

  const run = (preview: boolean): void => {
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot || instance !== editorProjectStore.getProjectInstanceId() ||
      shotStore.getCurrentShotId() !== shot.id || selectionStore.getSelectedLayerId() !== layer.id) return;
    try {
      const bindings = Object.fromEntries(planned.filter(({ hasRole }) => hasRole)
        .map(({ step, value }) => [step.id, value === SKIP ? null : value]));
      const draft = applyActionRecipe(snapshot.project, recipe.id,
        { ...target, startMs: timelineUiStore.getSnapshot().currentTimeMs }, bindings);
      if (preview) onPreview?.(draft);
      else if (draft !== snapshot.project) editorProjectStore.updateProject(draft, '运行操作配方');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法执行配方。');
    }
  };

  return <>
    <output>{layer.name} · {formatTimecode(currentTimeMs)}</output>
    <ol className="action-recipe-steps">
      {planned.map(({ step, options, value, hasRole }, index) => <li key={step.id}>
        <span>{actionRecipeStepLabel(project, step)} · {formatTimecode(currentTimeMs + step.offsetMs)}</span>
        {hasRole ? <label>
          <span className="sr-only">第 {index + 1} 步目标</span>
          <select value={value} onChange={(event) => {
            setResolved({ ...resolved, [step.id]: event.target.value });
            setError('');
          }}>
            <option value="">{options.length ? '选择对应项' : '目标没有对应项'}</option>
            {options.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
            <option value={SKIP}>跳过此步</option>
          </select>
        </label> : null}
      </li>)}
    </ol>
    {onPreview ? <Button variant="secondary" disabled={!canExecute} onClick={() => run(true)}>预览配方</Button> : null}
    <Button disabled={!canExecute} onClick={() => run(false)}>执行配方</Button>
    {error ? <p role="alert">{error}</p> : null}
  </>;
}

export function ActionRecipeControls({ project, shot, layer, onPreview }: {
  project: Project;
  shot: Shot;
  layer: Layer | null;
  onPreview?: (draft: Project) => void;
}): React.JSX.Element {
  const instance = editorProjectStore.getProjectInstanceId();
  const [recipeId, setRecipeId] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<ActionRecipeStep[]>([]);
  const [newType, setNewType] = useState('enter-left');
  const [error, setError] = useState('');
  const recipes = project.actionRecipes ?? [];
  const recipe = recipes.find(({ id }) => id === recipeId);

  const beginEdit = (previous?: ActionRecipe): void => {
    setRecipeId(previous?.id ?? '');
    setName(previous?.name ?? '');
    setSteps(previous?.steps ?? []);
    setEditing(true);
    setError('');
  };
  const update = (edited: ActionRecipeStep): void =>
    setSteps(steps.map((step) => step.id === edited.id ? edited : step));
  const addStep = (): void => {
    const last = steps.at(-1);
    const motionId = newType.startsWith('motion:') ? newType.slice('motion:'.length) : undefined;
    const findMotion = (presetId: string) => project.userMotionPresets?.find(({ id }) => id === presetId);
    const lastMotion = last?.kind === 'motion' ? findMotion(last.presetId) : undefined;
    const nextMotion = motionId ? findMotion(motionId) : undefined;
    const span = last && 'durationMs' in last ? last.durationMs
      : Math.round((lastMotion?.durationFrames ?? 0) * 1_000 / project.fps);
    let offsetMs = (last?.offsetMs ?? 0) + span;
    if (nextMotion) {
      const properties = new Set(nextMotion.tracks.map(({ property }) => property));
      for (const step of steps) {
        const previous = step.kind === 'motion' ? findMotion(step.presetId) : undefined;
        if (previous?.tracks.some(({ property }) => properties.has(property))) {
          offsetMs = Math.max(offsetMs, step.offsetMs + userMotionPresetContinuationSpanMs(previous));
        }
      }
    }
    const base = { id: crypto.randomUUID(), offsetMs };
    if (newType === 'expression' || newType === 'action') {
      setSteps([...steps, { ...base, kind: newType, durationMs: 500 }]);
      return;
    }
    if (motionId) {
      setSteps([...steps, { ...base, kind: 'motion', presetId: motionId }]);
      return;
    }
    const preset = BUILTINS.find(({ id }) => id === newType);
    if (preset) setSteps([...steps, { ...base, kind: 'preset', presetId: preset.id, durationMs: preset.defaultDurationMs }]);
  };
  const save = (): void => {
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot || instance !== editorProjectStore.getProjectInstanceId()) return;
    try {
      const next = saveActionRecipe(snapshot.project, { name, steps }, recipe?.id);
      editorProjectStore.updateProject(next, '保存操作配方');
      setRecipeId(recipe?.id ?? next.actionRecipes?.at(-1)?.id ?? '');
      setEditing(false);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存配方。');
    }
  };

  return <details className="user-motion-preset" data-testid="action-recipe-controls">
    <summary>操作配方</summary>
    {!editing ? <>
      {recipes.length ? <label>配方<select value={recipeId} onChange={(event) => setRecipeId(event.target.value)}>
        <option value="">选择配方</option>
        {recipes.map(({ id, name: label }) => <option key={id} value={id}>{label}</option>)}
      </select></label> : null}
      <Button variant="secondary" onClick={() => beginEdit()}>新建配方</Button>
      {recipe ? <Button variant="secondary" onClick={() => beginEdit(recipe)}>编辑配方</Button> : null}
      {recipe && layer ? <ActionRecipeRun key={JSON.stringify([recipe.id, shot.id, layer.id])}
        project={project} shot={shot} layer={layer} recipe={recipe} onPreview={onPreview} /> : null}
      {recipe && !layer ? <p>选择要执行配方的图层。</p> : null}
    </> : <>
      <label>配方名称<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
      <ol className="action-recipe-steps">{steps.map((step, index) => {
        const fields = step.kind === 'preset'
          ? BUILTINS.find(({ id }) => id === step.presetId)?.parameterFields.filter((field) => field.kind === 'number') ?? [] : [];
        return <li key={step.id}>
          <strong>{actionRecipeStepLabel(project, step)}</strong>
          <label>相对起点 (ms)<input type="number" min={0} value={step.offsetMs}
            onChange={(event) => update({ ...step, offsetMs: Number(event.target.value) })} /></label>
          {'durationMs' in step ? <label>时长 (ms)<input type="number" min={1} value={step.durationMs}
            onChange={(event) => update({ ...step, durationMs: Number(event.target.value) })} /></label> : null}
          {step.kind === 'expression' || step.kind === 'action' ? <label>匹配名称<input value={step.preferredName ?? ''}
            maxLength={200} onChange={(event) => update({ ...step, preferredName: event.target.value || undefined })} /></label> : null}
          {step.kind === 'preset' ? fields.map((field) => {
            const parameter = field.name as NumericParameter;
            return <label key={parameter}>{field.label}<input type="number" step="any" value={step.parameters?.[parameter] ?? ''}
              onChange={(event) => update({ ...step, parameters: { ...step.parameters,
                [parameter]: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label>;
          }) : null}
          <Button variant="secondary" aria-label={`移除第 ${index + 1} 步`}
            onClick={() => setSteps(steps.filter(({ id }) => id !== step.id))}>移除</Button>
        </li>;
      })}</ol>
      <label>添加步骤<select value={newType} onChange={(event) => setNewType(event.target.value)}>
        {BUILTINS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        <option value="expression">切换表情</option>
        <option value="action">角色动作</option>
        {project.userMotionPresets?.map((preset) => <option value={`motion:${preset.id}`} key={preset.id}>{preset.name}</option>)}
      </select></label>
      <Button variant="secondary" disabled={steps.length >= 32} onClick={addStep}>添加步骤</Button>
      <Button disabled={!name.trim() || !steps.length} onClick={save}>保存配方</Button>
      <Button variant="secondary" onClick={() => { setEditing(false); setError(''); }}>取消</Button>
      {error ? <p role="alert">{error}</p> : null}
    </>}
  </details>;
}
