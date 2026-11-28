import { invertAffineMatrix, multiplyAffineMatrices, type AffineMatrix2D } from '../../shared/affine-matrix';
import {
  characterFaceAndMouthPartIds, composeAnimatedCharacterPartTransform, createCharacterPartAnimationClip,
  resolveLayeredCharacterPartTransforms,
} from '../character-part-animation';
import { evaluateShotAtTime, type EvaluatedLayer } from '../evaluate-shot-at-time';
import { solveRigidArm, type ArmPoint } from '../geometry/rigidArmIk';
import { layerPivotStageVector } from '../layer-animation';
import type { AnimationProperty } from '../models/animationCore';
import {
  CharacterArmChainSchema, DEFAULT_ARM_CHAIN_ID, DEFAULT_ARM_CHAIN_NAME, resolveCharacterArmChain,
  resolveCharacterArmChains, type CharacterArmChain, type CharacterArmChainEntry, type CharacterArmChainKind,
  type CharacterArmChainSource,
} from '../models/character';
import { ProjectSchema, type Project } from '../models/project';
import { isValidFrameTime } from '../timeline/frame-grid';
import { CharacterMotionService, characterMotionValues } from './CharacterMotionService';

export interface CharacterArmIkAddress {
  shotId: string;
  layerId: string;
  timeMs: number;
}

/** Optional name/kind used when a save creates a new named chain. */
export interface CharacterArmChainUpdateMeta {
  name?: string;
  kind?: CharacterArmChainKind;
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
    if (!basis || protectedIds.has(segment.partId)) throw new Error('骨链包含缺失、隐藏或由脸嘴系统控制的部件。');
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

function requireChain(character: CharacterArmChainSource, chainId?: string) {
  const entry = resolveCharacterArmChain(character, chainId);
  if (!entry) throw new Error(chainId ? '未找到所选骨链。' : '请先设置骨链。');
  return entry;
}

/** Rejects one Part being claimed by two named chains; shared ancestors belong to a later stage. */
function assertChainPartsDoNotOverlap(entries: readonly CharacterArmChainEntry[]): void {
  const owners = new Map<string, CharacterArmChainEntry>();
  for (const entry of entries) {
    for (const { partId } of entry.chain.segments) {
      const owner = owners.get(partId);
      if (owner && owner.id !== entry.id) {
        throw new Error(`部件已属于骨链「${owner.name}」，同一部件不能同时绑定到多条骨链。`);
      }
      owners.set(partId, entry);
    }
  }
}

type ProjectCharacter = Project['characters'][number];

function replaceCharacter(project: Project, character: ProjectCharacter, next: ProjectCharacter): Project {
  return ProjectSchema.parse({ ...project, characters: project.characters.map(entry => entry === character ? next : entry) });
}

export function saveCharacterArmChain(
  project: Project,
  address: CharacterArmIkAddress,
  draft: CharacterArmChain,
  chainId?: string,
  meta?: CharacterArmChainUpdateMeta,
): Project {
  const instance = resolveArmInstance(project, address);
  const chain = CharacterArmChainSchema.parse(draft);
  const { rest, limits, currentTip } = calibrate(project, address, instance, chain);
  solveRigidArm(rest, currentTip, limits);
  const { character } = instance;
  const existing = resolveCharacterArmChains(character);
  const target = resolveCharacterArmChain(character, chainId);
  // With a chainId this is an upsert: saving a newly created named chain persists it here.
  const targetId = target?.id ?? chainId ?? DEFAULT_ARM_CHAIN_ID;
  const name = (meta?.name ?? target?.name ?? (targetId === DEFAULT_ARM_CHAIN_ID ? DEFAULT_ARM_CHAIN_NAME : '')).trim()
    || (targetId === DEFAULT_ARM_CHAIN_ID ? DEFAULT_ARM_CHAIN_NAME : '新骨链');
  const kind = meta?.kind ?? target?.kind;
  if (existing.some(entry => entry.id !== targetId && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('骨链名称已存在。');
  }
  const saved: CharacterArmChainEntry = { id: targetId, name, ...(kind ? { kind } : {}), chain };
  const entries = target ? existing.map(entry => entry.id === targetId ? saved : entry) : [...existing, saved];
  assertChainPartsDoNotOverlap(entries);
  const isDefault = targetId === DEFAULT_ARM_CHAIN_ID;
  return replaceCharacter(project, character, {
    ...character,
    armChains: entries,
    // Keep the legacy field in sync for readers that never learned about named chains.
    ...(isDefault ? { armChain: chain } : {}),
  });
}

export function deleteCharacterArmChain(project: Project, address: CharacterArmIkAddress, chainId: string): Project {
  const { character } = resolveArmInstance(project, address);
  const existing = resolveCharacterArmChains(character);
  if (!existing.some(entry => entry.id === chainId)) return project;
  const entries = existing.filter(entry => entry.id !== chainId);
  return replaceCharacter(project, character, {
    ...character,
    ...(entries.length ? { armChains: entries } : { armChains: undefined }),
    ...(chainId === DEFAULT_ARM_CHAIN_ID ? { armChain: undefined } : {}),
  });
}

export function renameCharacterArmChain(project: Project, address: CharacterArmIkAddress, chainId: string, nameInput: string): Project {
  const { character } = resolveArmInstance(project, address);
  const existing = resolveCharacterArmChains(character);
  const target = existing.find(entry => entry.id === chainId);
  if (!target) throw new Error('未找到要重命名的骨链。');
  const name = nameInput.trim();
  if (!name || name.length > 200) throw new Error('请输入 1 到 200 个字符的骨链名称。');
  if (existing.some(entry => entry.id !== chainId && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('骨链名称已存在。');
  }
  if (target.name === name && character.armChains) return project;
  return replaceCharacter(project, character, {
    ...character,
    armChains: existing.map(entry => entry.id === chainId ? { ...entry, name } : entry),
  });
}

export function characterArmTipOnStage(project: Project, address: CharacterArmIkAddress, chainId?: string): ArmPoint {
  const instance = resolveArmInstance(project, address);
  const entry = requireChain(instance.character, chainId);
  checkActionOwnership(instance, entry.chain);
  const { currentTip } = calibrate(project, address, instance, entry.chain);
  return transformPoint(instance.localToStage, currentTip);
}

function checkActionOwnership(instance: ReturnType<typeof resolveArmInstance>, chain: CharacterArmChain): void {
  const { evaluated } = instance;
  if (evaluated.characterAction || evaluated.layeredCharacterAction?.action.tracks.some(({ partId }) =>
    chain.segments.some(segment => segment.partId === partId))) throw new Error('当前动作段控制该骨链，请在段外摆姿势。');
}

export function planCharacterArmIk(
  project: Project,
  address: CharacterArmIkAddress,
  stagePoint: ArmPoint,
  seed?: readonly number[],
  chainId?: string,
) {
  const instance = resolveArmInstance(project, address);
  const entry = requireChain(instance.character, chainId);
  checkActionOwnership(instance, entry.chain);
  const inverse = invertAffineMatrix(instance.localToStage);
  if (!inverse) throw new Error('角色变换不可逆。');
  const { segments, rest, limits } = calibrate(project, address, instance, entry.chain);
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
