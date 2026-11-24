import { invertAffineMatrix, multiplyAffineMatrices, type AffineMatrix2D } from '../../shared/affine-matrix';
import {
  characterFaceAndMouthPartIds, composeAnimatedCharacterPartTransform, createCharacterPartAnimationClip,
  resolveLayeredCharacterPartTransforms,
} from '../character-part-animation';
import { evaluateShotAtTime, type EvaluatedLayer } from '../evaluate-shot-at-time';
import { solveRigidArm, type ArmPoint } from '../geometry/rigidArmIk';
import { layerPivotStageVector } from '../layer-animation';
import type { AnimationProperty } from '../models/animationCore';
import { CharacterArmChainSchema, type CharacterArmChain } from '../models/character';
import { ProjectSchema, type Project } from '../models/project';
import { isValidFrameTime } from '../timeline/frame-grid';
import { CharacterMotionService, characterMotionValues } from './CharacterMotionService';

export interface CharacterArmIkAddress {
  shotId: string;
  layerId: string;
  timeMs: number;
}

function transformPoint(matrix: AffineMatrix2D, point: ArmPoint): ArmPoint {
  return { x: matrix.a * point.x + matrix.c * point.y + matrix.tx, y: matrix.b * point.x + matrix.d * point.y + matrix.ty };
}

function resolveArmInstance(project: Project, address: CharacterArmIkAddress, displayed?: EvaluatedLayer) {
  const shot = project.shots.find(({ id }) => id === address.shotId);
  const layer = shot?.layers.find(({ id }) => id === address.layerId);
  const characterId = layer?.source.kind === 'character' ? layer.source.characterId : undefined;
  const character = project.characters.find(({ id }) => id === characterId);
  if (!shot || !layer || layer.locked || character?.mode !== 'adaptive-parts') throw new Error('请选择可编辑的分件角色。');
  if (!isValidFrameTime(address.timeMs) || address.timeMs > shot.durationMs) throw new Error('请选择镜头内的有效帧。');
  const evaluated = displayed?.id === layer.id ? displayed : evaluateShotAtTime(shot, address.timeMs, project).layers.find(({ id }) => id === layer.id)!;
  const horizontal = layerPivotStageVector({ x: 1, y: 0 }, evaluated.rotationDeg, evaluated.scaleX, evaluated.scaleY, evaluated.flipX);
  const vertical = layerPivotStageVector({ x: 0, y: 1 }, evaluated.rotationDeg, evaluated.scaleX, evaluated.scaleY, evaluated.flipX);
  const localToStage = { a: horizontal.x, b: horizontal.y, c: vertical.x, d: vertical.y, tx: evaluated.x, ty: evaluated.y };
  return { character, evaluated, localToStage, clip: createCharacterPartAnimationClip(project, shot.id, layer.id) };
}

interface CharacterArmAssemblyPart {
  pivot: ArmPoint;
  toStage: (point: ArmPoint) => ArmPoint;
  toPart: (point: ArmPoint) => ArmPoint;
}

/** Store attachment points in the source Part's coordinates, even when its instance is posed. */
export function resolveCharacterArmAssemblyParts(
  project: Project, address: CharacterArmIkAddress, displayed: EvaluatedLayer,
): ReadonlyMap<string, CharacterArmAssemblyPart> {
  const { character, evaluated, localToStage, clip } = resolveArmInstance(project, address, displayed);
  const parts = new Map<string, CharacterArmAssemblyPart>();
  if (evaluated.characterAction || !evaluated.visible) return parts;
  const excluded = characterFaceAndMouthPartIds(character);
  if (evaluated.headGroupTransform) character.headMotionBinding?.partIds.forEach(id => excluded.add(id));
  const values = evaluated.animationValues ?? [];
  const layered = evaluated.layeredCharacterAction
    ? resolveLayeredCharacterPartTransforms(clip, character, values, evaluated.layeredCharacterAction)
    : undefined;
  for (const basis of clip.targetBases) {
    const { partId } = basis.target;
    if (!basis.visible || excluded.has(partId) || !character.parts.some(part => part.partId === partId && part.visible)) continue;
    const local = layered?.get(partId) ?? composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, values);
    const toStage = multiplyAffineMatrices(localToStage, local);
    const toPart = invertAffineMatrix(toStage);
    if (toPart) parts.set(partId, {
      pivot: { x: basis.pivot.x, y: basis.pivot.y },
      toStage: point => transformPoint(toStage, point),
      toPart: point => transformPoint(toPart, point),
    });
  }
  return parts;
}

function calibrate(project: Project, address: CharacterArmIkAddress, instance: ReturnType<typeof resolveArmInstance>, chain: CharacterArmChain) {
  const { character, clip } = instance;
  const protectedIds = characterFaceAndMouthPartIds(character);
  const segments = chain.segments.map(segment => {
    const basis = clip.targetBases.find(({ target, visible }) => visible && target.partId === segment.partId);
    if (!basis || protectedIds.has(segment.partId)) throw new Error('手臂链包含缺失、隐藏或由脸嘴系统控制的部件。');
    const values = characterMotionValues(project, { ...address, partId: segment.partId, autoKey: true });
    const restMatrix = composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, []);
    const current = (Object.keys(values) as AnimationProperty[]).map(property => ({ target: basis.target, property, value: values[property] }));
    const currentMatrix = composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, current);
    return { segment, basis, values, restMatrix, currentMatrix };
  });
  const last = segments.at(-1)!;
  const joints = [...segments.map(({ segment, restMatrix }) => transformPoint(restMatrix, segment.joint)), transformPoint(last.restMatrix, chain.tip)];
  const root = transformPoint(segments[0]!.currentMatrix, segments[0]!.segment.joint);
  const rest = [root];
  segments.forEach(({ values }, index) => {
    const previous = rest[index]!;
    const from = joints[index]!;
    const to = joints[index + 1]!;
    rest.push({ x: previous.x + (to.x - from.x) * values['transform.scaleX'],
      y: previous.y + (to.y - from.y) * values['transform.scaleY'] });
  });
  const limits = segments.map(({ segment }) => ({ minDeg: segment.minDeg, maxDeg: segment.maxDeg }));
  return { segments, rest, limits, currentTip: transformPoint(last.currentMatrix, chain.tip) };
}

export function saveCharacterArmChain(project: Project, address: CharacterArmIkAddress, draft: CharacterArmChain): Project {
  const instance = resolveArmInstance(project, address);
  const chain = CharacterArmChainSchema.parse(draft);
  const { rest, limits, currentTip } = calibrate(project, address, instance, chain);
  solveRigidArm(rest, currentTip, limits);
  return ProjectSchema.parse({ ...project, characters: project.characters.map(entry => entry === instance.character
    ? { ...entry, armChain: chain } : entry) });
}

export function characterArmTipOnStage(project: Project, address: CharacterArmIkAddress): ArmPoint {
  const instance = resolveArmInstance(project, address);
  const { armChain } = instance.character;
  if (!armChain) throw new Error('请先设置手臂链。');
  checkActionOwnership(instance, armChain);
  const { currentTip } = calibrate(project, address, instance, armChain);
  return transformPoint(instance.localToStage, currentTip);
}

function checkActionOwnership(instance: ReturnType<typeof resolveArmInstance>, chain: CharacterArmChain): void {
  const { evaluated } = instance;
  if (evaluated.characterAction || evaluated.layeredCharacterAction?.action.tracks.some(({ partId }) =>
    chain.segments.some(segment => segment.partId === partId))) throw new Error('当前动作段控制手臂，请在段外摆姿势。');
}

export function planCharacterArmIk(project: Project, address: CharacterArmIkAddress, stagePoint: ArmPoint, seed?: readonly number[]) {
  const instance = resolveArmInstance(project, address);
  const { armChain } = instance.character;
  if (!armChain) throw new Error('请先设置手臂链。');
  checkActionOwnership(instance, armChain);
  const inverse = invertAffineMatrix(instance.localToStage);
  if (!inverse) throw new Error('角色变换不可逆。');
  const { segments, rest, limits } = calibrate(project, address, instance, armChain);
  const localSeed = seed ?? segments.map(({ values }, index) => values['transform.rotationDeg'] -
    (segments[index - 1]?.values['transform.rotationDeg'] ?? 0));
  const solved = solveRigidArm(rest, transformPoint(inverse, stagePoint), limits, localSeed);
  const service = new CharacterMotionService();
  let next = project;
  segments.forEach(({ segment, basis, values }, index) => {
    const rotation = solved.rotationsDeg[index]!;
    const target = basis.target;
    const rotated = composeAnimatedCharacterPartTransform(basis, instance.clip.fixedCharacterCenter, [
      { target, property: 'transform.rotationDeg', value: rotation },
      { target, property: 'transform.scaleX', value: values['transform.scaleX'] },
      { target, property: 'transform.scaleY', value: values['transform.scaleY'] },
    ]);
    const originalJoint = transformPoint(rotated, segment.joint);
    const plannedJoint = solved.joints[index]!;
    next = service.apply(next, { ...address, partId: segment.partId, autoKey: true }, {
      'transform.rotationDeg': rotation,
      'transform.offsetX': plannedJoint.x - originalJoint.x,
      'transform.offsetY': plannedJoint.y - originalJoint.y,
    });
  });
  return { project: next, tip: transformPoint(instance.localToStage, solved.joints.at(-1)!), jointAnglesDeg: solved.jointAnglesDeg };
}
