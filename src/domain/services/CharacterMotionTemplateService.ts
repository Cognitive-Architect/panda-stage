import { characterFaceAndMouthPartIds, createCharacterPartAnimationClip } from '../character-part-animation';
import { evaluateAnimationTrackAtTime } from '../evaluate-animation-core';
import { evaluateShotAtTime } from '../evaluate-shot-at-time';
import { evaluateLayerMotionAtTime } from '../evaluate-layer-motion';
import { LayeredCharacterActionSchema, type Character } from '../models/character';
import type { AnimationKey, AnimationProperty } from '../models/animationCore';
import type { Layer } from '../models/layer';
import { ProjectSchema, type Project } from '../models/project';
import { TimelineEventSchema } from '../models/timeline-event';
import { frameTimeMs, isValidFrameTime, TIMELINE_FPS } from '../timeline/frame-grid';
import { upsertCharacterActionEvent } from './CharacterActionEventService';

export const CHARACTER_MOTION_TEMPLATES = [
  'teleport', 'shake', 'sway', 'nod', 'head-shake', 'look-up', 'look-down', 'smooth-head-shake',
] as const;

export type CharacterMotionTemplate = typeof CHARACTER_MOTION_TEMPLATES[number];

export function isHeadMotionTemplate(template: CharacterMotionTemplate): boolean {
  return template !== 'teleport' && template !== 'shake' && template !== 'sway';
}

export function characterTemplateHeadParts(character: Character, layer: Layer): readonly { id: string; name: string }[] {
  if (character.mode !== 'adaptive-parts') return [];
  const protectedParts = characterFaceAndMouthPartIds(character);
  const knownHeads = new Set(character.headMotionBinding?.partIds);
  return character.parts.flatMap((part, index) => part.visible && knownHeads.has(part.partId) &&
    !protectedParts.has(part.partId) && (layer.animationClip?.version !== 1 ||
      layer.animationClip.targetBases.some(({ target, visible }) => target.partId === part.partId && visible))
    ? [{ id: part.partId, name: part.displayName ?? `部件 ${index + 1}` }] : []);
}

export interface CharacterMotionTemplateInput {
  shotId: string;
  layerId: string;
  kind: CharacterMotionTemplate;
  templateName: string;
  startMs: number;
  endMs: number;
  cycles: number;
  amplitude: number;
  deltaY?: number;
  headPartId?: string;
}

export function planCharacterMotionTemplate(
  project: Project,
  input: CharacterMotionTemplateInput,
  createId: () => string = () => crypto.randomUUID(),
): Project {
  const shot = project.shots.find(({ id }) => id === input.shotId);
  const layer = shot?.layers.find(({ id }) => id === input.layerId);
  if (!shot || layer?.source.kind !== 'character' || layer.locked) throw new Error('请选择可编辑的角色图层。');
  const characterId = layer.source.characterId;
  const character = project.characters.find(({ id }) => id === characterId);
  if (!character || !CHARACTER_MOTION_TEMPLATES.includes(input.kind)) throw new Error('所选角色或动作不可用。');

  const { kind, startMs, amplitude, cycles } = input;
  const teleport = kind === 'teleport';
  const endMs = teleport ? startMs : input.endMs;
  const head = isHeadMotionTemplate(kind);
  if (!isValidFrameTime(startMs) || !isValidFrameTime(endMs) ||
    endMs > shot.durationMs || (!teleport && endMs <= startMs)) throw new Error('请选择镜头内有效的动作起止帧。');
  if (!Number.isFinite(amplitude) || Math.abs(amplitude) > (head ? 70 : 1920) ||
    (teleport ? amplitude === 0 && !input.deltaY : amplitude <= 0) ||
    (input.deltaY !== undefined && (!Number.isFinite(input.deltaY) || Math.abs(input.deltaY) > 1080))) {
    throw new Error('动作幅度无效。');
  }
  if (!teleport && (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 12)) {
    throw new Error('次数须为 1–12 的整数。');
  }

  if (!head) {
    if (shot.timelineEvents.some((event) => event.layerId === layer.id &&
      (event.type === 'move' || event.type === 'shake') && event.startMs <= endMs && startMs <= event.endMs)) {
      throw new Error('选段已有移动或抖动，请选择空闲时段。');
    }
    if (!teleport && (endMs - startMs) * TIMELINE_FPS < cycles * 4_000 - 24) {
      throw new Error('每次摇动至少需要 4 帧。');
    }
    const anchor = evaluateLayerMotionAtTime(layer, shot.timelineEvents, startMs).mainPosition;
    const destination = { x: anchor.x + amplitude, y: anchor.y + (input.deltaY ?? 0) };
    const event = TimelineEventSchema.parse(teleport
      ? { id: createId(), type: 'move', layerId: layer.id, startMs, endMs, from: destination, to: destination, easing: 'linear' }
      : { id: createId(), type: 'shake', layerId: layer.id, startMs, endMs,
          amplitudeX: amplitude, amplitudeY: kind === 'shake' ? amplitude * 0.35 : 0,
          frequencyHz: cycles * 1000 / (endMs - startMs) });
    return ProjectSchema.parse({ ...project, shots: project.shots.map((candidate) => candidate === shot
      ? { ...shot, timelineEvents: [...shot.timelineEvents, event] } : candidate) });
  }

  const partId = input.headPartId;
  if (character.mode !== 'adaptive-parts' || !partId || !characterTemplateHeadParts(character, layer).some(({ id }) => id === partId)) {
    throw new Error('请选择已绑定、可编辑的头部部件。');
  }
  if ((character.actions?.length ?? 0) >= 64) throw new Error('角色动作库已满。');
  const clip = createCharacterPartAnimationClip(project, shot.id, layer.id);
  const offsetY = kind === 'nod' || kind === 'look-up' || kind === 'look-down';
  const planarShake = kind === 'head-shake' || kind === 'smooth-head-shake';
  const phases = planarShake ? [0, 1, 0, -1, 0] : [0, 1, 0];
  const startFrame = Math.round(startMs * TIMELINE_FPS / 1000);
  const frameCount = Math.round(endMs * TIMELINE_FPS / 1000) - startFrame;
  const intervals = cycles * (phases.length - 1);
  if (frameCount < intervals) throw new Error('选段太短，无法容纳设定的动作次数。');
  const properties: Array<{ property: AnimationProperty; delta: number }> = offsetY
    ? [
        { property: 'transform.offsetY', delta: (kind === 'look-up' ? -1 : 1) * amplitude / 2 },
        { property: 'transform.scaleY', delta: -amplitude / 300 },
      ]
    : [{ property: 'transform.rotationDeg', delta: amplitude }];
  const tracks = properties.map(({ property, delta }) => {
    const source = clip.tracks.find((track) =>
      track.target.kind === 'character-part' && track.target.partId === partId && track.property === property);
    const neutral = property === 'transform.scaleY' ? 1 : 0;
    const keys: AnimationKey[] = Array.from({ length: intervals + 1 }, (_, index) => {
      const frame = Math.round(index * frameCount / intervals);
      const time = frameTimeMs(startFrame + frame);
      const baseline = source ? evaluateAnimationTrackAtTime(source, time) : neutral;
      const wave = phases[index % (phases.length - 1)]!;
      return {
        timeMs: frameTimeMs(frame),
        value: property === 'transform.scaleY' ? baseline * (1 + wave * delta) : baseline + wave * delta,
        interpolationToNext: kind === 'smooth-head-shake' || !planarShake ? 'ease-in-out' : 'linear',
      };
    });
    return { property, partId, keys };
  });
  const requestedName = input.templateName.trim().slice(0, 56);
  if (!requestedName) throw new Error('请输入动作名称。');
  const usedNames = new Set(character.actions?.map(({ name }) => name.toLocaleLowerCase()));
  let name = requestedName;
  for (let suffix = 2; usedNames.has(name.toLocaleLowerCase()); suffix += 1) name = requestedName + ' ' + suffix;
  const action = LayeredCharacterActionSchema.parse({ id: createId(), name, kind: 'layered', tracks, headAnchorPartId: partId });
  const withAction = ProjectSchema.parse({
    ...project, characters: project.characters.map((candidate) => candidate === character
      ? { ...character, actions: [...(character.actions ?? []), action] } : candidate),
  });
  return upsertCharacterActionEvent(withAction, shot.id, layer.id, { actionId: action.id, startMs, endMs }, createId);
}

/** Switch the selected instance's authored expression using its existing event track. */
export function planCharacterAppearanceSwitch(
  project: Project,
  input: { shotId: string; layerId: string; expressionId: string; timeMs: number; fadeFrames: number },
  createId: () => string = () => crypto.randomUUID(),
): Project {
  const shot = project.shots.find(({ id }) => id === input.shotId);
  const layer = shot?.layers.find(({ id }) => id === input.layerId);
  if (!shot || layer?.source.kind !== 'character' || layer.locked) throw new Error('请选择可编辑的角色图层。');
  const characterId = layer.source.characterId;
  const character = project.characters.find(({ id }) => id === characterId);
  if (!character?.expressions?.some(({ id }) => id === input.expressionId)) throw new Error('当前角色没有所选表情。');
  if (!isValidFrameTime(input.timeMs) || !Number.isSafeInteger(input.fadeFrames) || input.fadeFrames < 0 ||
    input.fadeFrames === 1 || input.fadeFrames > 24) throw new Error('请选择有效的切换帧和淡变长度。');
  const startMs = input.timeMs;
  const frame = Math.round(startMs * TIMELINE_FPS / 1000);
  const endMs = frameTimeMs(frame + input.fadeFrames);
  const changeMs = frameTimeMs(frame + Math.floor(input.fadeFrames / 2));
  if (endMs > shot.durationMs) throw new Error('切换或淡变超出镜头范围。');
  const events = shot.timelineEvents.filter((event) => event.layerId === layer.id);
  if (events.some((event) =>
    (event.type === 'expression' && event.startMs >= startMs && event.startMs <= endMs) ||
    (input.fadeFrames > 0 && event.type === 'opacity' && event.startMs <= endMs && startMs <= event.endMs))) {
    throw new Error('区段已有表情或透明度事件，请选择空闲时段。');
  }
  if (events.some((event) => event.type === 'character-action' && event.startMs <= changeMs && changeMs < event.endMs &&
    character.actions?.some((action) => action.id === event.actionId && 'animationId' in action))) {
    throw new Error('切换帧正在播放替换整个人物画面的动作。');
  }
  const expression = { id: createId(), type: 'expression', layerId: layer.id,
    startMs: changeMs, endMs: changeMs, expressionId: input.expressionId };
  const additions = [TimelineEventSchema.parse(expression)];
  if (input.fadeFrames > 0) {
    const opacity = evaluateShotAtTime(shot, startMs, project).layers.find(({ id }) => id === layer.id)!.opacity;
    additions.push(
      TimelineEventSchema.parse({ id: createId(), type: 'opacity', layerId: layer.id, startMs, endMs: changeMs,
        from: opacity, to: 0, easing: 'linear' }),
      TimelineEventSchema.parse({ id: createId(), type: 'opacity', layerId: layer.id, startMs: changeMs, endMs,
        from: 0, to: opacity, easing: 'linear' }),
    );
  }
  return ProjectSchema.parse({ ...project, shots: project.shots.map((candidate) => candidate === shot
    ? { ...shot, timelineEvents: [...shot.timelineEvents, ...additions] } : candidate) });
}
