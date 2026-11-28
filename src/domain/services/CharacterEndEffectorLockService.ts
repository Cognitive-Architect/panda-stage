import {
  applyCharacterEndEffectorLocksToValues,
  characterEndEffectorLayerStageMatrix,
  characterEndEffectorLockActiveAt,
  resolveCharacterEndEffectorLockChain,
  validateCharacterEndEffectorLock,
  type CharacterEndEffectorResidual,
} from '../character-end-effector-lock';
import {
  characterBoneProtectedPartIds,
  characterBoneTargetRef,
} from '../character-bone-pose';
import { evaluateAnimationClipAtTime } from '../evaluate-animation-core';
import { evaluateShotAtTime, type EvaluatedLayer } from '../evaluate-shot-at-time';
import { upsertTargetKeyValues } from '../animation-track-ops';
import type { AnimationProperty } from '../models/animationCore';
import {
  CharacterEndEffectorLockSchema,
  type CharacterEndEffectorLock,
  type CharacterEndEffectorLockSpace,
  type Layer,
} from '../models/layer';
import { ProjectSchema, type Project } from '../models/project';
import { isValidFrameTime } from '../timeline/frame-grid';
import { characterBonePoseValues, CharacterBoneService, type CharacterBonePoseInput } from './CharacterBoneService';

export interface CharacterEndEffectorLockAddress {
  readonly shotId: string;
  readonly layerId: string;
}

export interface CharacterEndEffectorLockFrameAddress extends CharacterEndEffectorLockAddress {
  readonly timeMs: number;
}

export interface CharacterEndEffectorLockTarget {
  readonly x: number;
  readonly y: number;
}

export interface CharacterEndEffectorLockCreateInput {
  readonly boneId: string;
  readonly space: CharacterEndEffectorLockSpace;
  readonly target: CharacterEndEffectorLockTarget;
  readonly footRotationDeg?: number;
  readonly weight?: number;
  readonly activeRange?: { readonly startMs: number; readonly endMs: number };
}

export interface CharacterEndEffectorLockPatch {
  readonly space?: CharacterEndEffectorLockSpace;
  readonly target?: CharacterEndEffectorLockTarget;
  /** `null` clears the foot direction lock. */
  readonly footRotationDeg?: number | null;
  /** `null` restores the full-authority default (1). */
  readonly weight?: number | null;
  /** `null` makes the lock active for the whole Shot. */
  readonly activeRange?: { readonly startMs: number; readonly endMs: number } | null;
}

export interface CharacterEndEffectorLockStatus {
  readonly lock: CharacterEndEffectorLock;
  /** Present only when this lock did not reach its target or was skipped. */
  readonly residual?: CharacterEndEffectorResidual;
  /** Current achieved foot direction in the lock's space, when the leaf is evaluable. */
  readonly footRotationDeg?: number;
}

interface EndEffectorLockContext {
  readonly shot: Project['shots'][number];
  readonly layer: Layer;
  readonly character: Extract<Project['characters'][number], { mode: 'adaptive-parts' }>;
}

function resolveContext(
  project: Project,
  address: CharacterEndEffectorLockAddress,
): EndEffectorLockContext {
  const shot = project.shots.find(({ id }) => id === address.shotId);
  const layer = shot?.layers.find(({ id }) => id === address.layerId);
  const characterId = layer?.source.kind === 'character' ? layer.source.characterId : undefined;
  const character = project.characters.find(({ id }) => id === characterId);
  if (!shot || !layer || character?.mode !== 'adaptive-parts') {
    throw new Error('请选择分件角色图层。');
  }
  return { shot, layer, character };
}

function requireEditableContext(
  project: Project,
  address: CharacterEndEffectorLockAddress,
): EndEffectorLockContext {
  const context = resolveContext(project, address);
  if (context.layer.locked) throw new Error('角色图层已锁定。');
  if ((context.character.bones?.length ?? 0) === 0) throw new Error('该角色还没有骨骼，无法使用末端锁定。');
  return context;
}

function replaceLayer(
  project: Project,
  shotId: string,
  layerId: string,
  patch: Partial<Pick<Layer, 'endEffectorLocks'>>,
): Project {
  return ProjectSchema.parse({
    ...project,
    updatedAt: new Date().toISOString(),
    shots: project.shots.map((shot) => shot.id === shotId
      ? {
          ...shot,
          layers: shot.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } : layer),
        }
      : shot),
  });
}

function assertValidLock(
  context: EndEffectorLockContext,
  lock: CharacterEndEffectorLock,
  ignoreLockId?: string,
): void {
  const message = validateCharacterEndEffectorLock({
    character: context.character,
    lock,
    durationMs: context.shot.durationMs,
    existingLocks: context.layer.endEffectorLocks ?? [],
    protectedPartIds: characterBoneProtectedPartIds(context.character),
    ...(ignoreLockId === undefined ? {} : { ignoreLockId }),
  });
  if (message) throw new Error(message);
}

function requireFrame(context: EndEffectorLockContext, timeMs: number): void {
  if (!isValidFrameTime(timeMs) || timeMs > context.shot.durationMs) {
    throw new Error('请选择镜头内的有效帧。');
  }
}

function evaluatedLayerAt(
  project: Project,
  context: EndEffectorLockContext,
  timeMs: number,
): EvaluatedLayer | undefined {
  return evaluateShotAtTime(context.shot, timeMs, project)
    .layers.find(({ id }) => id === context.layer.id);
}

function leafPoseAt(
  project: Project,
  context: EndEffectorLockContext,
  timeMs: number,
  boneId: string,
) {
  const evaluated = evaluatedLayerAt(project, context, timeMs);
  const poses = evaluated?.characterBonePose
    ? new Map(evaluated.characterBonePose.map((pose) => [pose.boneId, pose]))
    : undefined;
  const pose = poses?.get(boneId);
  return { evaluated, pose };
}

function transformPoint(matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number },
  point: CharacterEndEffectorLockTarget): CharacterEndEffectorLockTarget {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
    y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
  };
}

function directionAngle(
  matrix: { a: number; b: number; c: number; d: number },
  characterAngleDeg: number,
): number {
  const radians = characterAngleDeg * Math.PI / 180;
  const x = matrix.a * Math.cos(radians) + matrix.c * Math.sin(radians);
  const y = matrix.b * Math.cos(radians) + matrix.d * Math.sin(radians);
  return Math.atan2(y, x) * 180 / Math.PI;
}

/**
 * Authoring service for #1456 end-effector locks.
 *
 * Every mutating call returns a Project produced through `ProjectSchema.parse`
 * exactly once, so one call is exactly one undo entry. Editing-time solving and
 * the persistent per-frame evaluator both call the same pure
 * `applyCharacterEndEffectorLocks` core.
 */
export class CharacterEndEffectorLockService {
  private readonly createId: () => string;

  constructor(options: { createId?: () => string } = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  /** Adds a lock with an explicit target. Use `pinFromCurrentPose` to capture one. */
  addLock(
    project: Project,
    address: CharacterEndEffectorLockAddress,
    input: CharacterEndEffectorLockCreateInput,
  ): Project {
    const context = requireEditableContext(project, address);
    const lock = CharacterEndEffectorLockSchema.parse({
      id: this.createId(),
      boneId: input.boneId,
      space: input.space,
      target: input.target,
      ...(input.footRotationDeg === undefined ? {} : { footRotationDeg: input.footRotationDeg }),
      ...(input.weight === undefined ? {} : { weight: input.weight }),
      ...(input.activeRange === undefined ? {} : { activeRange: input.activeRange }),
    });
    assertValidLock(context, lock);
    return replaceLayer(project, address.shotId, address.layerId, {
      endEffectorLocks: [...(context.layer.endEffectorLocks ?? []), lock],
    });
  }

  updateLock(
    project: Project,
    address: CharacterEndEffectorLockAddress,
    lockId: string,
    patch: CharacterEndEffectorLockPatch,
  ): Project {
    const context = requireEditableContext(project, address);
    const existing = (context.layer.endEffectorLocks ?? []).find((lock) => lock.id === lockId);
    if (!existing) throw new Error('未找到要修改的末端锁定。');
    const next: CharacterEndEffectorLock = {
      id: existing.id,
      boneId: existing.boneId,
      space: patch.space ?? existing.space,
      target: patch.target ?? existing.target,
      ...(patch.footRotationDeg === null
        ? {}
        : { footRotationDeg: patch.footRotationDeg ?? existing.footRotationDeg }),
      ...(patch.weight === null
        ? {}
        : { weight: patch.weight ?? existing.weight }),
      ...(patch.activeRange === null
        ? {}
        : { activeRange: patch.activeRange ?? existing.activeRange }),
    };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) delete (next as Record<string, unknown>)[key];
    }
    const parsed = CharacterEndEffectorLockSchema.parse(next);
    assertValidLock(context, parsed, lockId);
    if (JSON.stringify(parsed) === JSON.stringify(existing)) return project;
    return replaceLayer(project, address.shotId, address.layerId, {
      endEffectorLocks: (context.layer.endEffectorLocks ?? []).map((lock) => lock.id === lockId ? parsed : lock),
    });
  }

  removeLock(
    project: Project,
    address: CharacterEndEffectorLockAddress,
    lockId: string,
  ): Project {
    const context = requireEditableContext(project, address);
    const locks = context.layer.endEffectorLocks ?? [];
    if (!locks.some((lock) => lock.id === lockId)) return project;
    const remaining = locks.filter((lock) => lock.id !== lockId);
    return replaceLayer(project, address.shotId, address.layerId, {
      endEffectorLocks: remaining.length > 0 ? remaining : undefined,
    });
  }

  /**
   * Captures the current world/character leaf pivot as the lock target. The
   * target is persisted at the current frame, never as pointer history.
   */
  pinFromCurrentPose(
    project: Project,
    address: CharacterEndEffectorLockFrameAddress,
    input: {
      readonly boneId: string;
      readonly space: CharacterEndEffectorLockSpace;
      readonly footRotationDeg?: number;
      readonly weight?: number;
      readonly activeRange?: { readonly startMs: number; readonly endMs: number };
    },
  ): { readonly project: Project; readonly lock: CharacterEndEffectorLock } {
    const context = requireEditableContext(project, address);
    requireFrame(context, address.timeMs);
    if (context.layer.animationClip?.version !== 1) {
      throw new Error('请先为角色记录基础姿势或关键帧。');
    }
    const chain = resolveCharacterEndEffectorLockChain(context.character, { boneId: input.boneId });
    if (!chain.ok) throw new Error(chain.message);
    const { evaluated, pose } = leafPoseAt(project, context, address.timeMs, input.boneId);
    if (!evaluated || !pose) throw new Error('当前帧无法解算该骨骼，请先记录角色姿势。');
    const characterPoint = { x: pose.world.tx, y: pose.world.ty };
    const localToStage = characterEndEffectorLayerStageMatrix(
      { ...evaluated, parentSpace: evaluated.parentSpace },
      context.layer.animationClip.fixedCharacterCenter,
    );
    const target = input.space === 'stage'
      ? transformPoint(localToStage, characterPoint)
      : characterPoint;
    const createdId = this.createId();
    const lock = CharacterEndEffectorLockSchema.parse({
      id: createdId,
      boneId: input.boneId,
      space: input.space,
      target: {
        x: Number(target.x.toFixed(4)),
        y: Number(target.y.toFixed(4)),
      },
      ...(input.footRotationDeg === undefined ? {} : { footRotationDeg: input.footRotationDeg }),
      ...(input.weight === undefined ? {} : { weight: input.weight }),
      ...(input.activeRange === undefined ? {} : { activeRange: input.activeRange }),
    });
    assertValidLock(context, lock);
    const next = replaceLayer(project, address.shotId, address.layerId, {
      endEffectorLocks: [...(context.layer.endEffectorLocks ?? []), lock],
    });
    return { project: next, lock };
  }

  /** Current achieved foot direction in the lock's space, for the foot-direction toggle. */
  footDirectionDeg(
    project: Project,
    address: CharacterEndEffectorLockFrameAddress,
    boneId: string,
    space: CharacterEndEffectorLockSpace,
  ): number | undefined {
    const context = resolveContext(project, address);
    const { evaluated, pose } = leafPoseAt(project, context, address.timeMs, boneId);
    if (!evaluated || !pose) return undefined;
    const characterAngle = Math.atan2(pose.world.b, pose.world.a) * 180 / Math.PI;
    if (space === 'character') return characterAngle;
    if (context.layer.animationClip?.version !== 1) return undefined;
    const localToStage = characterEndEffectorLayerStageMatrix(
      { ...evaluated, parentSpace: evaluated.parentSpace },
      context.layer.animationClip.fixedCharacterCenter,
    );
    return directionAngle(localToStage, characterAngle);
  }

  /** Read-only lock list with the residual the formal evaluator reports. */
  describeLocks(
    project: Project,
    address: CharacterEndEffectorLockFrameAddress,
  ): CharacterEndEffectorLockStatus[] {
    const context = resolveContext(project, address);
    const locks = context.layer.endEffectorLocks ?? [];
    if (locks.length === 0) return [];
    const evaluated = evaluatedLayerAt(project, context, address.timeMs);
    const residuals = new Map((evaluated?.endEffectorResiduals ?? []).map((entry) => [entry.lockId, entry]));
    const poses = new Map((evaluated?.characterBonePose ?? []).map((pose) => [pose.boneId, pose]));
    const clip = context.layer.animationClip?.version === 1 ? context.layer.animationClip : undefined;
    const localToStage = evaluated && clip
      ? characterEndEffectorLayerStageMatrix(evaluated, clip.fixedCharacterCenter)
      : undefined;
    return locks.map((lock) => {
      const residual = residuals.get(lock.id);
      const pose = poses.get(lock.boneId);
      let footRotationDeg: number | undefined;
      if (pose) {
        const characterAngle = Math.atan2(pose.world.b, pose.world.a) * 180 / Math.PI;
        footRotationDeg = lock.space === 'character' || !localToStage
          ? characterAngle
          : directionAngle(localToStage, characterAngle);
      }
      return {
        lock,
        ...(residual ? { residual } : {}),
        ...(footRotationDeg === undefined ? {} : { footRotationDeg }),
      };
    });
  }

  /**
   * Editing-time fast path: solves every active lock from the authored pose at
   * this frame and writes real pose keys for the affected Bones. One call is
   * one undo entry; the persistent evaluator uses the same pure function so the
   * two can never disagree.
   */
  solveAtFrame(project: Project, address: CharacterEndEffectorLockFrameAddress): Project {
    const context = requireEditableContext(project, address);
    requireFrame(context, address.timeMs);
    const clip = context.layer.animationClip;
    if (clip?.version !== 1) return project;
    const activeLocks = (context.layer.endEffectorLocks ?? [])
      .filter((lock) => characterEndEffectorLockActiveAt(lock, address.timeMs));
    if (activeLocks.length === 0) return project;
    const evaluated = evaluatedLayerAt(project, context, address.timeMs);
    if (!evaluated) return project;
    const localToStage = characterEndEffectorLayerStageMatrix(
      { ...evaluated, parentSpace: evaluated.parentSpace },
      clip.fixedCharacterCenter,
    );
    const applied = applyCharacterEndEffectorLocksToValues({
      character: context.character,
      values: evaluateAnimationClipAtTime(clip, address.timeMs),
      layerId: context.layer.id,
      locks: activeLocks,
      localToStage,
      protectedPartIds: characterBoneProtectedPartIds(context.character),
      timeMs: address.timeMs,
    });
    if (applied.solvedBoneIds.length === 0) return project;
    let tracks = clip.tracks;
    for (const boneId of applied.solvedBoneIds) {
      const pose = applied.poseValues.get(boneId);
      if (!pose) continue;
      const current = characterBonePoseValues(project, {
        shotId: address.shotId,
        layerId: address.layerId,
        boneId,
        timeMs: address.timeMs,
      });
      if (current['transform.rotationDeg'] === pose.rotationDeg) continue;
      tracks = upsertTargetKeyValues(
        tracks,
        characterBoneTargetRef(context.layer.id, boneId),
        address.timeMs,
        { 'transform.rotationDeg': pose.rotationDeg },
      );
    }
    if (tracks === clip.tracks) return project;
    return ProjectSchema.parse({
      ...project,
      updatedAt: new Date().toISOString(),
      shots: project.shots.map((shot) => shot.id === address.shotId
        ? {
            ...shot,
            layers: shot.layers.map((layer) => layer.id === address.layerId
              ? { ...layer, animationClip: { ...clip, tracks } }
              : layer),
          }
        : shot),
    });
  }

  /**
   * One edit gesture for the pelvis/root Bone: writes the moved Bone pose keys
   * and the solved leg keys in a single Project update (one undo entry).
   */
  applyBonePoseWithLocks(
    project: Project,
    address: CharacterBonePoseInput,
    changes: Partial<Record<AnimationProperty, number>>,
  ): Project {
    const context = requireEditableContext(project, address);
    const hasLocks = (context.layer.endEffectorLocks ?? []).length > 0;
    const applied = new CharacterBoneService().applyBonePose(project, address, changes);
    if (!hasLocks) return applied;
    return this.solveAtFrame(applied, address);
  }
}
