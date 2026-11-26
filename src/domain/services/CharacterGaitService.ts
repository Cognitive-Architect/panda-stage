import {
  characterFaceAndMouthPartIds, characterPartPivotInClip, createCharacterPartAnimationClip,
} from '../character-part-animation';
import { evaluateShotAtTime } from '../evaluate-shot-at-time';
import { evaluateLayerMotionAtTime } from '../evaluate-layer-motion';
import { characterPartSourceBounds } from '../geometry/characterPartLayout';
import { solveRigidArm, type ArmPoint } from '../geometry/rigidArmIk';
import type { AnimationClipV0, CharacterPartTargetBasis } from '../models/animationCore';
import {
  LayeredCharacterActionSchema, type AdaptivePartsCharacter, type LayeredCharacterAction,
} from '../models/character';
import { ProjectSchema, type Project } from '../models/project';
import { frameTimeMs, isValidFrameTime, TIMELINE_FPS } from '../timeline/frame-grid';
import { upsertCharacterActionEvent } from './CharacterActionEventService';

export type CharacterGait = 'walk' | 'run';
export type GaitLegParts = { thigh: string; shin: string; foot: string; footFollower?: string };
export type GaitParts = { left: GaitLegParts; right: GaitLegParts };

interface GaitInput {
  shotId: string;
  layerId: string;
  gait: CharacterGait;
  startMs: number;
  endMs: number;
  cycles: number;
  direction: 1 | -1;
  travel: boolean;
  parts: GaitParts;
}

type Leg = {
  bases: CharacterPartTargetBasis[];
  rest: [ArmPoint, ArmPoint, ArmPoint];
  length: number;
};

export function gaitPartOptions(character: AdaptivePartsCharacter, clip?: AnimationClipV0) {
  const protectedParts = characterFaceAndMouthPartIds(character);
  return character.parts.flatMap((part, index) => part.visible && !protectedParts.has(part.partId) &&
    (!clip || clip.targetBases.some((basis) => basis.visible && basis.target.partId === part.partId))
    ? [{ id: part.partId, name: part.displayName ?? `部件 ${index + 1}` }]
    : []);
}

const angle = (a: ArmPoint, b: ArmPoint) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
const wrappedAngle = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180;

function calibrateLeg(project: Project, character: AdaptivePartsCharacter, clip: AnimationClipV0, ids: GaitLegParts): Leg {
  const readPart = (partId: string) => {
    const part = character.parts.find((entry) => entry.partId === partId);
    const basis = clip.targetBases.find((entry) => entry.target.partId === partId);
    const bounds = part && characterPartSourceBounds(part, project.animations, project.assets);
    if (!basis || !bounds || bounds.height <= 0 || bounds.width <= 0) throw new Error('无法读取腿部尺寸。');
    const m = basis.baseTransform;
    const center = clip.fixedCharacterCenter;
    return {
      basis,
      point: (heightFraction: number): ArmPoint => {
        const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height * heightFraction;
        return { x: m.a * x + m.c * y + m.tx - center.x, y: m.b * x + m.d * y + m.ty - center.y };
      },
    };
  };
  const [thigh, shin, foot] = [readPart(ids.thigh), readPart(ids.shin), readPart(ids.foot)];
  const midpoint = (a: ArmPoint, b: ArmPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const rest: Leg['rest'] = [thigh.point(0.12), midpoint(thigh.point(0.88), shin.point(0.12)),
    midpoint(shin.point(0.88), foot.point(0.23))];
  const [hip, knee, ankle] = rest;
  const thighLength = Math.hypot(knee.x - hip.x, knee.y - hip.y);
  const shinLength = Math.hypot(ankle.x - knee.x, ankle.y - knee.y);
  if (knee.y <= hip.y || ankle.y <= knee.y || Math.min(thighLength, shinLength) < 3 ||
    Math.max(thighLength, shinLength) > 3 * Math.min(thighLength, shinLength)) {
    throw new Error('腿部需要按站立姿势选择大腿、小腿和脚。');
  }
  const follower = ids.footFollower && clip.targetBases.find((entry) => entry.target.partId === ids.footFollower);
  return { rest, bases: [thigh.basis, shin.basis, foot.basis, ...(follower ? [follower] : [])],
    length: thighLength + shinLength };
}

function cycleTracks(legs: readonly Leg[], clip: AnimationClipV0, input: GaitInput, frames: number, distance: number):
  LayeredCharacterAction['tracks'] {
  const running = input.gait === 'run';
  const duty = running ? 0.38 : 0.58;
  const transitionFrames = Math.min(4, Math.floor(frames / input.cycles / 4));
  const properties = ['transform.offsetX', 'transform.offsetY', 'transform.rotationDeg'] as const;
  return legs.flatMap((leg, legIndex) => {
    const restBend = wrappedAngle(angle(leg.rest[1], leg.rest[2]) - angle(leg.rest[0], leg.rest[1]));
    const knees = input.direction === 1 ? { minDeg: -restBend, maxDeg: 145 - restBend } :
      { minDeg: -145 - restBend, maxDeg: -restBend };
    const poses = Array.from({ length: frames + 1 }, (_, frame) => {
      // Match the standing pose at both event boundaries; leave the interior cycle clock intact.
      if (frame === 0 || frame === frames) return leg.bases.map(() => [0, 0, 0]);
      const transition = Math.min(1, frame / transitionFrames, (frames - frame) / transitionFrames);
      const weight = transition * transition * (3 - 2 * transition);
      const cycle = frame * input.cycles / frames;
      const phase = (cycle + legIndex / 2) % 1;
      const swing = phase >= duty ? (phase - duty) / (1 - duty) : 0;
      const stride = phase < duty ? distance * (duty / 2 - phase) :
        distance * duty * (swing * swing * (3 - 2 * swing) - 0.5);
      const flight = Math.sin(Math.PI * swing) ** 2 * leg.length * (running ? 0.26 : 0.14);
      const dip = leg.length * ((running ? 0.10 : 0.055) + (running ? 0.05 : 0.035) * Math.cos(4 * Math.PI * cycle) ** 2);
      const hip = { x: leg.rest[0].x, y: leg.rest[0].y + dip };
      const knee = { x: leg.rest[1].x, y: leg.rest[1].y + dip };
      const ankle = { x: leg.rest[2].x, y: leg.rest[2].y + dip };
      const target = { x: leg.rest[2].x + input.direction * stride, y: leg.rest[2].y - flight };
      const solution = solveRigidArm([hip, knee, ankle], target, [{ minDeg: -110, maxDeg: 110 }, knees],
        [0, input.direction * 18 - restBend]);
      if (solution.distance > 0.08) throw new Error('当前腿部比例无法完成此步态，请检查部件与站立姿势。');
      const rotations = solution.rotationsDeg.map((rotation) => rotation * weight);
      let joints = solution.joints;
      if (weight < 1) {
        // Rebuild the chain at the blended angles so the knee and ankle stay attached.
        joints = [{ x: hip.x, y: leg.rest[0].y + dip * weight }];
        rotations.forEach((rotation, index) => {
          const start = leg.rest[index]!, end = leg.rest[index + 1]!;
          const parent = joints[index]!;
          const radians = rotation * Math.PI / 180;
          const x = end.x - start.x, y = end.y - start.y;
          joints.push({ x: parent.x + x * Math.cos(radians) - y * Math.sin(radians),
            y: parent.y + x * Math.sin(radians) + y * Math.cos(radians) });
        });
      }
      return leg.bases.map((basis, index) => {
        const pivot = characterPartPivotInClip(basis, clip.fixedCharacterCenter);
        const rotation = rotations[index] ?? 0;
        const radians = rotation * Math.PI / 180;
        const attachment = Math.min(index, 2);
        const rest = leg.rest[attachment]!;
        const joint = joints[attachment]!;
        const x = rest.x - pivot.x, y = rest.y - pivot.y;
        return [
          joint.x - pivot.x - x * Math.cos(radians) + y * Math.sin(radians),
          joint.y - pivot.y - x * Math.sin(radians) - y * Math.cos(radians),
          rotation,
        ];
      });
    });
    return leg.bases.flatMap((basis, index) => properties.slice(0, index < 2 ? 3 : 2)
      .map((property, channel) => ({
        partId: basis.target.partId,
        property,
        keys: poses.map((pose, frame) => ({
          timeMs: frameTimeMs(frame), value: pose[index]![channel]!, interpolationToNext: 'linear' as const,
        })),
      })));
  });
}

/** Builds an editable native action and, for travel, one ordinary Move event. */
export function planCharacterGait(project: Project, input: GaitInput, createId = () => crypto.randomUUID()): Project {
  const shot = project.shots.find(({ id }) => id === input.shotId);
  const layer = shot?.layers.find(({ id }) => id === input.layerId);
  const characterId = layer?.source.kind === 'character' ? layer.source.characterId : null;
  const character = project.characters.find(({ id }) => id === characterId);
  if (!shot || !layer || layer.locked || character?.mode !== 'adaptive-parts') throw new Error('走跑需要可编辑的分件角色。');
  const { startMs, endMs, cycles } = input;
  const frames = Math.round(endMs * TIMELINE_FPS / 1000) - Math.round(startMs * TIMELINE_FPS / 1000);
  if (!isValidFrameTime(startMs) || !isValidFrameTime(endMs) || endMs > shot.durationMs ||
    !Number.isInteger(cycles) || cycles < 1 || cycles > 12 || frames < cycles * (input.gait === 'walk' ? 12 : 10) || frames > 288 ||
    (input.gait !== 'walk' && input.gait !== 'run') || (input.direction !== 1 && input.direction !== -1)) {
    throw new Error('请选择镜头内的有效区段。每周期走路至少 12 帧，跑步至少 10 帧，总长最多 288 帧。');
  }
  const clip = createCharacterPartAnimationClip(project, shot.id, layer.id);
  const permitted = new Set(gaitPartOptions(character, clip).map(({ id }) => id));
  const requiredIds = [input.parts.left, input.parts.right].flatMap(({ thigh, shin, foot }) => [thigh, shin, foot]);
  const followers = [input.parts.left.footFollower, input.parts.right.footFollower].filter(Boolean) as string[];
  const ids = [...requiredIds, ...followers];
  if (new Set(ids).size !== ids.length || ids.some((id) => !permitted.has(id))) {
    throw new Error('请选择不同且可见的大腿、小腿、脚与跟随部件。');
  }
  if (clip.tracks.some((track) => ids.includes(track.target.partId) &&
    track.keys.some(({ value }) => value !== (track.property.startsWith('transform.scale') ? 1 : 0)))) {
    throw new Error('所选腿部已有动画，请选未编排腿部动作的实例。');
  }
  if (shot.timelineEvents.some((event) => event.layerId === layer.id &&
    event.startMs <= endMs && startMs <= event.endMs &&
    (event.type === 'move' || event.type === 'shake' || event.type === 'scale' || event.type === 'flip'))) {
    throw new Error('所选区段已有位置或变换事件，请选择空闲区段。');
  }
  if ((character.actions?.length ?? 0) >= 64) throw new Error('角色动作库已满。');

  const legs = [calibrateLeg(project, character, clip, input.parts.left), calibrateLeg(project, character, clip, input.parts.right)];
  const distance = Math.min(...legs.map(({ length }) => length)) * (input.gait === 'walk' ? 0.44 : 0.78);
  const description = input.gait === 'walk' ? '走路' : '跑步';
  const names = new Set(character.actions?.map(({ name }) => name));
  let name = description;
  for (let suffix = 2; names.has(name); suffix += 1) name = `${description} ${suffix}`;
  const action = LayeredCharacterActionSchema.parse({ id: createId(), name, kind: 'layered',
    tracks: cycleTracks(legs, clip, input, frames, distance) });
  const authored = ProjectSchema.parse({ ...project, characters: project.characters.map((candidate) =>
    candidate === character ? { ...character, actions: [...(character.actions ?? []), action] } : candidate) });
  const planned = upsertCharacterActionEvent(authored, shot.id, layer.id, { actionId: action.id, startMs, endMs }, createId);
  if (!input.travel) return planned;
  const from = evaluateLayerMotionAtTime(layer, shot.timelineEvents, startMs).mainPosition;
  const pose = evaluateShotAtTime(shot, startMs, project).layers.find(({ id }) => id === layer.id)!;
  const radians = pose.rotationDeg * Math.PI / 180;
  const travel = input.direction * (pose.flipX ? -1 : 1) * distance * cycles * pose.scaleX;
  const to = { x: from.x + Math.cos(radians) * travel, y: from.y + Math.sin(radians) * travel };
  return ProjectSchema.parse({ ...planned, shots: planned.shots.map((candidate) => candidate.id === shot.id
    ? { ...candidate, timelineEvents: [...candidate.timelineEvents, {
        id: createId(), type: 'move', layerId: layer.id, startMs, endMs, from, to, easing: 'linear',
      }] } : candidate) });
}
