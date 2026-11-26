import { useContext, useEffect, useRef, useState } from 'react';
import { frameTimeMs, resolveTimelineFrameTime, TIMELINE_FPS, type Layer, type Project, type Shot } from '../../../domain';
import {
  CHARACTER_MOTION_TEMPLATES, characterTemplateHeadParts, isHeadMotionTemplate,
  planCharacterAppearanceSwitch, planCharacterMotionTemplate, type CharacterMotionTemplate,
} from '../../../domain/services/CharacterMotionTemplateService';
import { gaitPartOptions, planCharacterGait, type CharacterGait, type GaitParts } from '../../../domain/services/CharacterGaitService';
import { upsertCharacterActionEvent } from '../../../domain/services/CharacterActionEventService';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import { AnimationCurveDraftDispatch } from '../timeline/AnimationCurveDraft';
import { formatTimecode } from '../timeline/timeGeometry';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';

type TemplateKind = CharacterMotionTemplate | CharacterGait | 'appearance' | 'baked-appearance';

const labels: Record<TemplateKind, string> = {
  walk: '走路', run: '跑步', teleport: '瞬移', shake: '发抖', sway: '晃动', nod: '点头', 'head-shake': '摇头',
  'look-up': '抬头', 'look-down': '低头', 'smooth-head-shake': '丝滑摇头', appearance: '切换表情', 'baked-appearance': '切换角色动作外观',
};

const emptyLeg = { thigh: '', shin: '', foot: '' };
const legLabels = { left: '左腿', right: '右腿' } as const;
const segmentLabels = { thigh: '大腿', shin: '小腿', foot: '脚', footFollower: '脚部跟随' } as const;

type Preview = {
  snapshot: EditorProjectSnapshot;
  instance: number | null;
  project: Project;
  startMs: number;
  endFrame: number;
};

export function CharacterMotionTemplateControl({ snapshot, shot, layer }: {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layer: Layer;
}): React.JSX.Element | null {
  const { currentTimeMs } = useTimelineUi();
  const onDraft = useContext(AnimationCurveDraftDispatch);
  const [kind, setKind] = useState<TemplateKind>('teleport');
  const [frames, setFrames] = useState(24);
  const [cycles, setCycles] = useState(1);
  const [amplitude, setAmplitude] = useState(15);
  const [deltaY, setDeltaY] = useState(0);
  const [headPart, setHeadPart] = useState('');
  const [expressionId, setExpressionId] = useState('');
  const [appearanceActionId, setAppearanceActionId] = useState('');
  const [fade, setFade] = useState(false);
  const [legs, setLegs] = useState<GaitParts>({ left: emptyLeg, right: emptyLeg });
  const [direction, setDirection] = useState<1 | -1>(1);
  const [travel, setTravel] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [previewFrame, setPreviewFrame] = useState(0);
  const [error, setError] = useState('');
  const active = useRef(false);
  const instance = editorProjectStore.getProjectInstanceId();
  const startMs = resolveTimelineFrameTime(currentTimeMs, shot.durationMs);
  const startFrame = Math.round(startMs * TIMELINE_FPS / 1000);
  const characterId = layer.source.kind === 'character' ? layer.source.characterId : null;
  const character = snapshot.project.characters.find(({ id }) => id === characterId);
  const headParts = character ? characterTemplateHeadParts(character, layer) : [];
  const headId = headParts.some(({ id }) => id === headPart) ? headPart : headParts[0]?.id;
  const expression = character?.expressions?.find(({ id }) => id === expressionId) ?? character?.expressions?.[0];
  const bakedActions = character?.actions?.filter((action) => 'animationId' in action) ?? [];
  const appearanceAction = bakedActions.find(({ id }) => id === appearanceActionId) ?? bakedActions[0];
  const appearance = kind === 'appearance' || kind === 'baked-appearance';
  const gait = kind === 'walk' || kind === 'run';
  const gaitParts = character?.mode === 'adaptive-parts'
    ? gaitPartOptions(character, layer.animationClip?.version === 1 ? layer.animationClip : undefined) : [];
  const completeLegs = [legs.left, legs.right].every(({ thigh, shin, foot }) =>
    [thigh, shin, foot].every((id) => gaitParts.some((part) => part.id === id)));
  const head = !appearance && !gait && isHeadMotionTemplate(kind);
  const currentPreview = preview?.snapshot === snapshot && preview.instance === instance && preview.startMs === startMs
    ? preview : undefined;

  useEffect(() => () => {
    if (active.current) {
      onDraft?.(null);
      active.current = false;
    }
  }, [instance, layer.id, onDraft, shot.id, snapshot, startMs]);

  if (!character) return null;

  function clear(): void {
    if (active.current) onDraft?.(null);
    active.current = false;
    setPreview(undefined);
    setError('');
  }

  function stillCurrent(): boolean {
    return editorProjectStore.getSnapshot() === snapshot && editorProjectStore.getProjectInstanceId() === instance &&
      shotStore.getCurrentShotId() === shot.id && selectionStore.getSelectedLayerId() === layer.id &&
      resolveTimelineFrameTime(timelineUiStore.getSnapshot().currentTimeMs, shot.durationMs) === startMs;
  }

  function show(draft: Preview, frame: number): void {
    setPreviewFrame(frame);
    active.current = Boolean(onDraft);
    onDraft?.({ project: draft.project, projectInstanceId: draft.instance, revision: draft.snapshot.revision,
      shotId: shot.id, layerId: layer.id, timeMs: frameTimeMs(frame) });
  }

  function prepare(): void {
    clear();
    if (!stillCurrent()) return;
    try {
      const endFrame = kind === 'teleport' || (kind === 'appearance' && !fade) ? startFrame : startFrame + frames;
      const target = { shotId: shot.id, layerId: layer.id };
      const project = kind === 'appearance'
        ? planCharacterAppearanceSwitch(snapshot.project, { ...target, expressionId: expression?.id ?? '',
            timeMs: startMs, fadeFrames: fade ? frames : 0 })
        : kind === 'baked-appearance'
          ? upsertCharacterActionEvent(snapshot.project, shot.id, layer.id, {
              actionId: appearanceAction?.id ?? '', startMs, endMs: frameTimeMs(endFrame),
            })
          : gait
            ? planCharacterGait(snapshot.project, { ...target, gait: kind, startMs, endMs: frameTimeMs(endFrame),
                cycles, direction, travel, parts: legs })
            : planCharacterMotionTemplate(snapshot.project, { ...target, kind, startMs, endMs: frameTimeMs(endFrame),
                amplitude, cycles, deltaY, headPartId: headId, templateName: labels[kind] });
      const draft = { snapshot, instance, project, startMs, endFrame };
      setPreview(draft);
      const fraction = kind === 'appearance' ? 0.75 : (kind === 'shake' || kind === 'sway' ||
        kind === 'head-shake' || kind === 'smooth-head-shake' ? 1 / (4 * cycles) : 1 / (2 * cycles));
      show(draft, Math.round(startFrame + (endFrame - startFrame) * fraction));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法预览角色动作。');
    }
  }

  return <details className="animation-key-selection" data-testid="character-motion-templates" onToggle={(event) => {
    if (!event.currentTarget.open) clear();
  }}>
    <summary>动作模板</summary>
    <div className="animation-curve-fields">
      <label>动作<select value={kind} disabled={layer.locked} onChange={(event) => {
        clear();
        setKind(event.target.value as typeof kind);
      }}>
        {CHARACTER_MOTION_TEMPLATES.map((template) => <option key={template} value={template}
          disabled={isHeadMotionTemplate(template) && !headParts.length}>{labels[template]}</option>)}
        {gaitParts.length >= 6 ? <>
          <option value="walk">{labels.walk}</option>
          <option value="run">{labels.run}</option>
        </> : null}
        {character.expressions?.length ? <option value="appearance">{labels.appearance}</option> : null}
        {bakedActions.length ? <option value="baked-appearance">{labels['baked-appearance']}</option> : null}
      </select></label>
      {head ? <label>头部<select value={headId ?? ''} onChange={(event) => { clear(); setHeadPart(event.target.value); }}>
        {headParts.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select></label> : null}
      {kind === 'baked-appearance' ? (
        <label>角色动作<select value={appearanceAction?.id ?? ''} onChange={(event) => {
          clear(); setAppearanceActionId(event.target.value);
        }}>
          {bakedActions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select></label>
      ) : kind === 'appearance' ? <>
        <label>表情<select value={expression?.id ?? ''} onChange={(event) => { clear(); setExpressionId(event.target.value); }}>
          {character.expressions?.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label><input type="checkbox" checked={fade} onChange={(event) => { clear(); setFade(event.target.checked); }} />淡出后切换并淡入</label>
      </> : gait ? <>
        {(['left', 'right'] as const).map((side) => <fieldset key={side}>
          <legend>{legLabels[side]}</legend>
          {(['thigh', 'shin', 'foot', 'footFollower'] as const).map((segment) => (
            <label key={segment}>{segmentLabels[segment]}<select
              aria-label={legLabels[side] + segmentLabels[segment]}
              value={legs[side][segment] ?? ''} onChange={(event) => {
                const partId = event.target.value;
                clear();
                setLegs((current) => ({ ...current, [side]: { ...current[side], [segment]: partId } }));
              }}>
              <option value="">{segment === 'footFollower' ? '无' : '选择部件'}</option>
              {gaitParts.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select></label>
          ))}
        </fieldset>)}
        <label>前进方向<select value={direction} onChange={(event) => {
          clear(); setDirection(event.target.value === '-1' ? -1 : 1);
        }}>
          <option value={1}>朝角色局部右侧</option>
          <option value={-1}>朝角色局部左侧</option>
        </select></label>
        <label><input type="checkbox" checked={travel} onChange={(event) => { clear(); setTravel(event.target.checked); }} />随步幅位移</label>
        <label>周期数<input type="number" min={1} max={12} value={cycles}
          onChange={(event) => { clear(); setCycles(Number(event.target.value)); }} /></label>
      </> : <>
        <label>{kind === 'teleport' ? '相对 X（像素）' : head ? '幅度' : '幅度（像素）'}
          <input type="number" value={amplitude} onChange={(event) => { clear(); setAmplitude(Number(event.target.value)); }} />
        </label>
        {kind === 'teleport' ? <label>相对 Y（像素）<input type="number" value={deltaY}
          onChange={(event) => { clear(); setDeltaY(Number(event.target.value)); }} /></label>
          : <label>次数<input type="number" min={1} max={12} value={cycles}
            onChange={(event) => { clear(); setCycles(Number(event.target.value)); }} /></label>}
      </>}
      {kind !== 'teleport' && (kind !== 'appearance' || fade) ? <label>时长（帧）<input type="number" min={2}
        value={frames} onChange={(event) => { clear(); setFrames(Number(event.target.value)); }} /></label> : null}
    </div>
    <div className="animation-curve-fields">
      <span>{formatTimecode(startMs)}{kind === 'teleport' ? ' 起 · 保持位置' :
        kind === 'appearance' ? ' 起 · 保持表情' : kind === 'baked-appearance' ? ' 起 · 结束恢复原外观' :
          gait && travel ? ' 起 · 保持终点' :
          ' 起 · 结束回到原姿势'}</span>
      <Button type="button" disabled={layer.locked || (head && !headId) || (gait && !completeLegs)} onClick={prepare}>预览</Button>
      {currentPreview ? <>
        {currentPreview.endFrame > startFrame ? <label>预览帧<input type="range" min={startFrame}
          max={currentPreview.endFrame} value={previewFrame} onChange={(event) => show(currentPreview, Number(event.target.value))} /></label> : null}
        <Button type="button" onClick={() => {
          if (!stillCurrent() || layer.locked) return;
          try {
            editorProjectStore.updateProject(currentPreview.project, labels[kind]);
            clear();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '无法应用角色动作。');
          }
        }}>应用</Button>
        <Button type="button" variant="secondary" onClick={clear}>取消预览</Button>
      </> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
