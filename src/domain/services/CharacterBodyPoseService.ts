import { invertAffineMatrix, multiplyAffineMatrices } from '../../shared/affine-matrix';
import {
  characterFaceAndMouthPartIds, characterPartPivotInClip, composeAnimatedCharacterPartTransform,
  createCharacterPartAnimationClip, resolveLayeredCharacterPartTransforms,
} from '../character-part-animation';
import { CHARACTER_PART_MAX_SCALE, CHARACTER_PART_MIN_SCALE } from '../constants';
import { evaluateShotAtTime } from '../evaluate-shot-at-time';
import { CharacterBodyPoseSchema } from '../models/character';
import { composeAffineMatrix, decomposeAffineMatrix, isAffineMatrixTrsSafe } from '../models/flaGraphicTimeline';
import { ProjectSchema, type Project } from '../models/project';
import { isValidFrameTime } from '../timeline/frame-grid';
import { CharacterMotionService, characterMotionValues } from './CharacterMotionService';

interface BodyPoseAddress {
  shotId: string;
  layerId: string;
  timeMs: number;
}

function resolveBodyPoseTarget(project: Project, address: BodyPoseAddress) {
  const shot = project.shots.find(({ id }) => id === address.shotId);
  const layer = shot?.layers.find(({ id }) => id === address.layerId);
  const characterId = layer?.source.kind === 'character' ? layer.source.characterId : undefined;
  const character = project.characters.find(({ id }) => id === characterId);
  if (!shot || !layer || layer.locked || character?.mode !== 'adaptive-parts') throw new Error('请选中可编辑的分件角色。');
  if (!isValidFrameTime(address.timeMs) || address.timeMs > shot.durationMs) throw new Error('请选择镜头内的有效帧。');
  const overlays = evaluateShotAtTime(shot, address.timeMs, project).layers.find(({ id }) => id === layer.id);
  const protectedIds = characterFaceAndMouthPartIds(character);
  const availableParts = new Set(character.parts.filter(({ partId, visible }) => visible && !protectedIds.has(partId) &&
    (layer.animationClip?.version !== 1 || layer.animationClip.targetBases.some(basis => basis.visible && basis.target.partId === partId)))
    .map(({ partId }) => partId));
  return { character, layer, overlays, availableParts };
}

export function saveCharacterBodyPose(project: Project, address: BodyPoseAddress, nameInput: string, partIds: readonly string[],
  createId: () => string = () => crypto.randomUUID()): Project {
  const { character, layer, overlays, availableParts } = resolveBodyPoseTarget(project, address);
  if (overlays?.characterAction) throw new Error('请在整人动作段外保存身体姿势。');
  const name = nameInput.trim();
  const saved = character.bodyPoses ?? [];
  if (saved.length >= 64) throw new Error('一个角色最多可保存 64 个身体姿势。');
  if (!name || name.length > 64 || saved.some(pose => pose.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new Error('请输入 1 到 64 个字符的未使用姿势名称。');
  }
  const layered = overlays?.layeredCharacterAction;
  const clip = layered ? layer.animationClip ?? createCharacterPartAnimationClip(project, address.shotId, layer.id) : undefined;
  const transforms = layered && clip?.version === 1
    ? resolveLayeredCharacterPartTransforms(clip, character, overlays.animationValues ?? [], layered) : undefined;
  const parts = [...new Set(partIds)].filter(id => availableParts.has(id)).map(partId => {
    const partName = character.parts.find(part => part.partId === partId)?.displayName;
    if (!transforms || clip?.version !== 1) {
      return { partId, partName, properties: characterMotionValues(project, { ...address, partId, autoKey: true }) };
    }
    const basis = clip.targetBases.find(entry => entry.target.partId === partId)!;
    const referencePivot = characterPartPivotInClip(basis, clip.fixedCharacterCenter);
    const rest = composeAnimatedCharacterPartTransform(basis, clip.fixedCharacterCenter, []);
    const inverse = invertAffineMatrix(rest)!;
    // Remove source geometry so the pose can be written as motion on another instance.
    const delta = multiplyAffineMatrices(transforms.get(partId)!, inverse);
    const { tx, ty, rotationDeg, scaleX, scaleY } = decomposeAffineMatrix(delta);
    if (!isAffineMatrixTrsSafe(delta) || [scaleX, scaleY].some(scale =>
      scale < CHARACTER_PART_MIN_SCALE - 1e-9 || scale > CHARACTER_PART_MAX_SCALE + 1e-9)) {
      throw new Error(`「${partName ?? '所选部件'}」的姿态超出身体姿势可保存的变换范围。请改选一帧，或取消勾选此部件。`);
    }
    const { x, y } = referencePivot;
    return { partId, partName, referencePivot, properties: {
      'transform.offsetX': tx + (delta.a - 1) * x + delta.c * y,
      'transform.offsetY': ty + delta.b * x + (delta.d - 1) * y,
      'transform.rotationDeg': rotationDeg,
      'transform.scaleX': Math.min(CHARACTER_PART_MAX_SCALE, Math.max(CHARACTER_PART_MIN_SCALE, scaleX)),
      'transform.scaleY': Math.min(CHARACTER_PART_MAX_SCALE, Math.max(CHARACTER_PART_MIN_SCALE, scaleY)),
    } };
  });
  if (!parts.length) throw new Error('请至少选择一个可用身体部件。');
  const pose = CharacterBodyPoseSchema.parse({ id: createId(), name, parts });
  return ProjectSchema.parse({ ...project, characters: project.characters.map(entry => entry === character
    ? { ...character, bodyPoses: [...saved, pose] } : entry) });
}

export function planCharacterBodyPose(project: Project, address: BodyPoseAddress, poseId: string): {
  project: Project;
  missingPartIds: string[];
  actionPartIds: string[];
} {
  const { character, overlays, availableParts } = resolveBodyPoseTarget(project, address);
  const pose = character.bodyPoses?.find(({ id }) => id === poseId);
  if (!pose) throw new Error('该身体姿势不属于当前角色。');
  if (overlays?.characterAction) throw new Error('请在整人动作段外应用身体姿势。');
  const missingPartIds: string[] = [];
  const actionPartIds: string[] = [];
  const service = new CharacterMotionService();
  const clip = pose.parts.some(({ referencePivot }) => referencePivot)
    ? createCharacterPartAnimationClip(project, address.shotId, address.layerId) : undefined;
  let next = project;
  for (const { partId, properties, referencePivot } of pose.parts) {
    if (!availableParts.has(partId)) {
      missingPartIds.push(partId);
      continue;
    }
    const writable = { ...properties };
    if (referencePivot && clip) {
      const basis = clip.targetBases.find(entry => entry.target.partId === partId)!;
      const pivot = characterPartPivotInClip(basis, clip.fixedCharacterCenter);
      const dx = pivot.x - referencePivot.x;
      const dy = pivot.y - referencePivot.y;
      const { a, b, c, d } = composeAffineMatrix({ tx: 0, ty: 0, rotationDeg: properties['transform.rotationDeg'] ?? 0,
        scaleX: properties['transform.scaleX'] ?? 1, scaleY: properties['transform.scaleY'] ?? 1 });
      writable['transform.offsetX'] = (properties['transform.offsetX'] ?? 0) + (a - 1) * dx + c * dy;
      writable['transform.offsetY'] = (properties['transform.offsetY'] ?? 0) + b * dx + (d - 1) * dy;
    }
    for (const track of overlays?.layeredCharacterAction?.action.tracks ?? []) {
      if (track.partId === partId) delete writable[track.property];
    }
    if (Object.keys(writable).length !== Object.keys(properties).length) actionPartIds.push(partId);
    next = service.apply(next, { ...address, partId, autoKey: true }, writable);
  }
  return { project: next, missingPartIds, actionPartIds };
}

export function deleteCharacterBodyPose(project: Project, address: BodyPoseAddress, poseId: string): Project {
  const { character } = resolveBodyPoseTarget(project, address);
  if (!character.bodyPoses?.some(({ id }) => id === poseId)) return project;
  return ProjectSchema.parse({ ...project, characters: project.characters.map(entry => entry === character
    ? { ...character, bodyPoses: character.bodyPoses!.filter(({ id }) => id !== poseId) } : entry) });
}
