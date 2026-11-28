import { invertAffineMatrix, multiplyAffineMatrices } from '../../shared/affine-matrix';
import {
  deleteTargetKeyAtTime,
  evaluateTargetMotionValues,
  NEUTRAL_ANIMATION_MOTION,
  upsertTargetKeyValues,
  type AnimationMotionValues,
} from '../animation-track-ops';
import {
  characterBoneProtectedPartIds,
  characterBoneTargetRef,
  characterBoneWorldRestTransforms,
  resolveCharacterBoneTree,
} from '../character-bone-pose';
import { characterPartSourceBounds } from '../geometry/characterPartLayout';
import {
  CharacterPoseAnimationClipV0Schema,
  type AnimationClipV0,
  type AnimationProperty,
} from '../models/animationCore';
import { createCharacterPartAnimationClip } from '../character-part-animation';
import {
  AdaptivePartsCharacterSchema,
  CHARACTER_BONE_MAX_COUNT,
  CharacterBoneSchema,
  type AdaptivePartsCharacter,
  type CharacterBone,
  type CharacterBoneRestLocal,
} from '../models/character';
import { ProjectSchema, type Project } from '../models/project';
import { isValidFrameTime } from '../timeline/frame-grid';

/** Parts that stay in the face/mouth/head-follow pipeline and are never bone-bound. */
export { characterBoneProtectedPartIds } from '../character-bone-pose';

export interface CharacterBoneCreateInput {
  readonly parentBoneId: string | null;
  readonly name?: string;
  readonly partId?: string;
  readonly restLocal?: CharacterBoneRestLocal;
  readonly length?: number;
  readonly minDeg?: number;
  readonly maxDeg?: number;
  readonly inheritRotation?: boolean;
}

export interface CharacterBoneUpdateInput {
  readonly name?: string | null;
  readonly restLocal?: Partial<CharacterBoneRestLocal>;
  readonly length?: number | null;
  readonly minDeg?: number | null;
  readonly maxDeg?: number | null;
  readonly inheritRotation?: boolean | null;
}

export interface CharacterBonePoseInput {
  readonly shotId: string;
  readonly layerId: string;
  readonly boneId: string;
  readonly timeMs: number;
}

function adaptiveCharacter(project: Project, characterId: string): AdaptivePartsCharacter {
  const character = project.characters.find((candidate) => candidate.id === characterId);
  if (!character || character.mode !== 'adaptive-parts') {
    throw new Error('请选择分件角色。');
  }
  return character;
}

function replaceAdaptiveCharacter(
  project: Project,
  character: AdaptivePartsCharacter,
  next: AdaptivePartsCharacter,
): Project {
  const validated = AdaptivePartsCharacterSchema.parse(next);
  return ProjectSchema.parse({
    ...project,
    updatedAt: new Date().toISOString(),
    characters: project.characters.map((candidate) =>
      candidate.id === character.id ? validated : candidate,
    ),
  });
}

function requireBone(character: AdaptivePartsCharacter, boneId: string): CharacterBone {
  const tree = resolveCharacterBoneTree(character);
  if (!tree.ok) throw new Error(`骨骼树无效：${tree.message}`);
  const bone = tree.byId.get(boneId);
  if (!bone) throw new Error('未找到所选骨骼。');
  return bone;
}

/** Character-space pivot of a Part's authored rest pose (used as a new Bone origin). */
export function characterPartRestPivot(
  project: Project,
  character: AdaptivePartsCharacter,
  partId: string,
): { x: number; y: number } | null {
  const part = character.parts.find((candidate) => candidate.partId === partId);
  if (!part) return null;
  const bounds = characterPartSourceBounds(part, project.animations, project.assets);
  if (!bounds) return null;
  const matrix = multiplyAffineMatrices(character.sourceRootTransform, part.restTransform);
  const pivotX = bounds.x + bounds.width / 2;
  const pivotY = bounds.y + bounds.height / 2;
  return {
    x: matrix.a * pivotX + matrix.c * pivotY + matrix.tx,
    y: matrix.b * pivotX + matrix.d * pivotY + matrix.ty,
  };
}

function restLocalOfPivot(
  parentRestWorld: ReturnType<typeof multiplyAffineMatrices> | null,
  pivot: { x: number; y: number },
): CharacterBoneRestLocal {
  if (!parentRestWorld) return { x: pivot.x, y: pivot.y, rotationDeg: 0 };
  const inverse = invertAffineMatrix(parentRestWorld);
  if (!inverse) return { x: pivot.x, y: pivot.y, rotationDeg: 0 };
  return {
    x: inverse.a * pivot.x + inverse.c * pivot.y + inverse.tx,
    y: inverse.b * pivot.x + inverse.d * pivot.y + inverse.ty,
    rotationDeg: 0,
  };
}

function validateAngleLimits(minDeg: number | undefined, maxDeg: number | undefined): void {
  if (minDeg !== undefined && maxDeg !== undefined && minDeg > maxDeg) {
    throw new Error('骨骼的最小角度不能大于最大角度。');
  }
}

function assertBindablePart(
  character: AdaptivePartsCharacter,
  partId: string,
  exceptBoneId?: string,
): void {
  const part = character.parts.find((candidate) => candidate.partId === partId);
  if (!part) throw new Error('未找到要绑定的部件。');
  if (!part.visible) throw new Error('隐藏的部件不能绑定骨骼。');
  if (characterBoneProtectedPartIds(character).has(partId)) {
    throw new Error('脸部、口型与随头部件保持原有系统，不能绑定骨骼。');
  }
  const tree = resolveCharacterBoneTree(character);
  if (!tree.ok) throw new Error(`骨骼树无效：${tree.message}`);
  const owner = tree.boneByPart.get(partId);
  if (owner !== undefined && owner !== exceptBoneId) {
    throw new Error('该部件已绑定到其他骨骼，请先解除绑定。');
  }
}

/** Reads the five transform values of one Bone pose target at Shot time. */
export function characterBonePoseValues(
  project: Project,
  input: CharacterBonePoseInput,
): AnimationMotionValues {
  const shot = project.shots.find((candidate) => candidate.id === input.shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === input.layerId);
  if (!shot || !layer || layer.source.kind !== 'character') throw new Error('请选择角色图层。');
  const character = adaptiveCharacter(project, layer.source.characterId);
  requireBone(character, input.boneId);
  if (layer.animationClip?.version !== 1) return { ...NEUTRAL_ANIMATION_MOTION };
  return evaluateTargetMotionValues(
    layer.animationClip.tracks,
    characterBoneTargetRef(layer.id, input.boneId),
    input.timeMs,
  );
}

/** True when the Bone owns authored keys beyond a neutral 0 ms key. */
export function hasAuthoredCharacterBoneMotion(
  layer: Project['shots'][number]['layers'][number] | undefined,
  boneId: string,
): boolean {
  return Boolean(
    layer?.animationClip?.version === 1 && layer.animationClip.tracks.some(
      (track) =>
        track.target.kind === 'character-bone' &&
        track.target.boneId === boneId &&
        (track.keys.length > 1 || track.keys.some((key) =>
          key.value !== NEUTRAL_ANIMATION_MOTION[track.property] || key.interpolationToNext !== 'linear')),
    ),
  );
}

function replaceLayerAnimationClip(
  project: Project,
  shotId: string,
  layerId: string,
  clip: AnimationClipV0,
): Project {
  const validatedClip = CharacterPoseAnimationClipV0Schema.parse(clip);
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((shot) => shot.id === shotId
      ? {
          ...shot,
          layers: shot.layers.map((layer) =>
            layer.id === layerId ? { ...layer, animationClip: validatedClip } : layer),
        }
      : shot),
  });
}

function requireEditableBonePoseContext(project: Project, input: CharacterBonePoseInput) {
  const shot = project.shots.find((candidate) => candidate.id === input.shotId);
  const layer = shot?.layers.find((candidate) => candidate.id === input.layerId);
  if (!shot || !layer || layer.source.kind !== 'character') throw new Error('请选择角色图层。');
  if (layer.locked) throw new Error('角色图层已锁定。');
  const character = adaptiveCharacter(project, layer.source.characterId);
  requireBone(character, input.boneId);
  if (!isValidFrameTime(input.timeMs) || input.timeMs > shot.durationMs) {
    throw new Error('请选择镜头内的有效帧。');
  }
  return { shot, layer, character };
}

/**
 * Bone authoring/pose service. Every mutating call returns a Project produced
 * through `ProjectSchema.parse` exactly once, so the caller records one undo.
 */
export class CharacterBoneService {
  private readonly createId: () => string;

  constructor(options: { createId?: () => string } = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  createBone(
    project: Project,
    characterId: string,
    input: CharacterBoneCreateInput,
  ): Project {
    const character = adaptiveCharacter(project, characterId);
    const existing = character.bones ?? [];
    if (existing.length >= CHARACTER_BONE_MAX_COUNT) {
      throw new Error(`一个角色最多 ${CHARACTER_BONE_MAX_COUNT} 根骨骼。`);
    }
    const tree = resolveCharacterBoneTree(character);
    if (!tree.ok) throw new Error(`骨骼树无效：${tree.message}`);
    if (input.parentBoneId !== null && !tree.byId.has(input.parentBoneId)) {
      throw new Error('未找到父骨骼。');
    }
    if (input.parentBoneId === null && tree.rootIds.length > 0) {
      throw new Error('骨骼树已有根骨骼，请选择父骨骼。');
    }
    if (input.partId !== undefined) assertBindablePart(character, input.partId);
    validateAngleLimits(input.minDeg, input.maxDeg);
    const parent = input.parentBoneId === null ? null : tree.byId.get(input.parentBoneId)!;
    const pivot = input.partId === undefined
      ? null
      : characterPartRestPivot(project, character, input.partId);
    const restLocal: CharacterBoneRestLocal = input.restLocal ?? (
      pivot
        ? restLocalOfPivot(characterBoneParentRestWorld(character, input.parentBoneId), pivot)
        : { x: parent?.length ?? 0, y: 0, rotationDeg: 0 }
    );
    const bone = CharacterBoneSchema.parse({
      id: this.createId(),
      name: input.name?.trim() || `骨骼 ${existing.length + 1}`,
      parentBoneId: input.parentBoneId,
      ...(input.partId !== undefined ? { partId: input.partId } : {}),
      restLocal,
      ...(input.length !== undefined ? { length: input.length } : {}),
      ...(input.minDeg !== undefined ? { minDeg: input.minDeg } : {}),
      ...(input.maxDeg !== undefined ? { maxDeg: input.maxDeg } : {}),
      ...(input.inheritRotation !== undefined ? { inheritRotation: input.inheritRotation } : {}),
    });
    return replaceAdaptiveCharacter(project, character, {
      ...character,
      bones: [...existing, bone],
    });
  }

  updateBone(
    project: Project,
    characterId: string,
    boneId: string,
    patch: CharacterBoneUpdateInput,
  ): Project {
    const character = adaptiveCharacter(project, characterId);
    requireBone(character, boneId);
    const bones = (character.bones ?? []).map((bone) => {
      if (bone.id !== boneId) return bone;
      const restLocal = patch.restLocal === undefined
        ? bone.restLocal
        : { ...bone.restLocal, ...patch.restLocal };
      const minDeg = patch.minDeg === null ? undefined : patch.minDeg ?? bone.minDeg;
      const maxDeg = patch.maxDeg === null ? undefined : patch.maxDeg ?? bone.maxDeg;
      validateAngleLimits(minDeg, maxDeg);
      return CharacterBoneSchema.parse({
        ...bone,
        ...(patch.name === undefined ? {} : patch.name === null ? { name: undefined } : { name: patch.name.trim() }),
        restLocal,
        ...(patch.length === null ? { length: undefined } : patch.length !== undefined ? { length: patch.length } : {}),
        ...(minDeg === undefined ? { minDeg: undefined } : { minDeg }),
        ...(maxDeg === undefined ? { maxDeg: undefined } : { maxDeg }),
        ...(patch.inheritRotation === null
          ? { inheritRotation: undefined }
          : patch.inheritRotation !== undefined ? { inheritRotation: patch.inheritRotation } : {}),
      });
    });
    const current = character.bones ?? [];
    if (JSON.stringify(current) === JSON.stringify(bones)) return project;
    return replaceAdaptiveCharacter(project, character, { ...character, bones });
  }

  /** Deletes the Bone together with its whole descendant subtree. */
  deleteBone(project: Project, characterId: string, boneId: string): Project {
    const character = adaptiveCharacter(project, characterId);
    const tree = resolveCharacterBoneTree(character);
    if (!tree.ok) throw new Error(`骨骼树无效：${tree.message}`);
    if (!tree.byId.has(boneId)) throw new Error('未找到要删除的骨骼。');
    const descendants = new Set<string>([boneId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const bone of tree.bones) {
        if (bone.parentBoneId !== null && descendants.has(bone.parentBoneId) && !descendants.has(bone.id)) {
          descendants.add(bone.id);
          changed = true;
        }
      }
    }
    const bones = tree.bones.filter((bone) => !descendants.has(bone.id));
    const nextCharacter = AdaptivePartsCharacterSchema.parse({
      ...character,
      ...(bones.length === 0 ? { bones: undefined } : { bones }),
    });
    // #1456: a deleted Bone must not leave an unsolvable end-effector lock behind.
    const affectedLayerIds = new Set(project.shots.flatMap((shot) =>
      shot.layers.flatMap((layer) =>
        layer.source.kind === 'character' &&
        layer.source.characterId === characterId &&
        (layer.endEffectorLocks ?? []).some((lock) => descendants.has(lock.boneId))
          ? [layer.id]
          : [])));
    return ProjectSchema.parse({
      ...project,
      updatedAt: new Date().toISOString(),
      characters: project.characters.map((candidate) =>
        candidate.id === character.id ? nextCharacter : candidate),
      ...(affectedLayerIds.size === 0 ? {} : {
        shots: project.shots.map((shot) => ({
          ...shot,
          layers: shot.layers.map((layer) => {
            if (!affectedLayerIds.has(layer.id)) return layer;
            const remaining = (layer.endEffectorLocks ?? [])
              .filter((lock) => !descendants.has(lock.boneId));
            return remaining.length > 0
              ? { ...layer, endEffectorLocks: remaining }
              : { ...layer, endEffectorLocks: undefined };
          }),
        })),
      }),
    });
  }

  /** Binds or unbinds exactly one visible Part to a Bone. */
  bindBonePart(
    project: Project,
    characterId: string,
    boneId: string,
    partId: string | null,
  ): Project {
    const character = adaptiveCharacter(project, characterId);
    requireBone(character, boneId);
    if (partId !== null) assertBindablePart(character, partId, boneId);
    const bones = (character.bones ?? []).map((bone) => {
      const next: CharacterBone = { ...bone };
      if (next.id === boneId) {
        if (partId === null) delete next.partId;
        else next.partId = partId;
      } else if (partId !== null && next.partId === partId) {
        delete next.partId;
      }
      return next;
    });
    const current = character.bones ?? [];
    if (JSON.stringify(current) === JSON.stringify(bones)) return project;
    return replaceAdaptiveCharacter(project, character, { ...character, bones });
  }

  /** Writes the five Bone pose properties at the playhead through Clip Property Tracks. */
  applyBonePose(
    project: Project,
    input: CharacterBonePoseInput,
    changes: Partial<AnimationMotionValues>,
  ): Project {
    const { shot, layer } = requireEditableBonePoseContext(project, input);
    const current = characterBonePoseValues(project, input);
    const properties = (Object.keys(changes) as AnimationProperty[])
      .filter((property) => changes[property] !== undefined && changes[property] !== current[property]);
    if (properties.length === 0) return project;
    const clip = createCharacterPartAnimationClip(project, shot.id, layer.id);
    const target = characterBoneTargetRef(layer.id, input.boneId);
    const nextTracks = upsertTargetKeyValues(clip.tracks, target, input.timeMs, changes);
    if (nextTracks === clip.tracks) return project;
    return replaceLayerAnimationClip(project, shot.id, layer.id, { ...clip, tracks: nextTracks });
  }

  /** Deletes all Pose Keys of one Bone at a non-0 ms key time. */
  deleteBoneKey(
    project: Project,
    input: CharacterBonePoseInput,
  ): Project {
    const { layer } = requireEditableBonePoseContext(project, input);
    if (input.timeMs === 0) throw new Error('0 秒基础姿势关键帧不可删除。');
    const clip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
    if (!clip) throw new Error('找不到要删除的骨骼关键帧。');
    const nextTracks = deleteTargetKeyAtTime(
      clip.tracks,
      characterBoneTargetRef(layer.id, input.boneId),
      input.timeMs,
      { protectedBaseMessage: '0 秒基础姿势关键帧不可删除。', missingMessage: '找不到要删除的骨骼关键帧。' },
    );
    return replaceLayerAnimationClip(project, input.shotId, input.layerId, { ...clip, tracks: nextTracks });
  }

  /** Resets one Bone pose to neutral at the playhead (one key, one undo). */
  resetBonePose(project: Project, input: CharacterBonePoseInput): Project {
    return this.applyBonePose(project, input, { ...NEUTRAL_ANIMATION_MOTION });
  }
}

function characterBoneParentRestWorld(
  character: AdaptivePartsCharacter,
  parentBoneId: string | null,
): ReturnType<typeof multiplyAffineMatrices> | null {
  if (parentBoneId === null) return null;
  const restWorlds = characterBoneWorldRestTransforms(character);
  return restWorlds?.get(parentBoneId) ?? null;
}
