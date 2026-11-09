import {
  DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT,
  type CharacterPart,
} from '../models/character';
import {
  PartPoseAnimationSchema,
  PartPoseKeyframeSchema,
  type PartPoseAnimation,
  type PartPoseEasing,
  type PartPoseKeyframe,
  type PartPosePoint,
  type PartPoseTrack,
} from '../models/pose-animation';
import { ProjectSchema, type Project } from '../models/project';
import { adaptiveCharacterSourceAnchor } from '../selectors/visualParts';
import { isValidFrameTime, lastValidFrameTime } from '../timeline/frame-grid';

type AdaptivePartsCharacter = Extract<
  Project['characters'][number],
  { mode: 'adaptive-parts' }
>;

export interface CreatePartPoseAnimationInput {
  shotId: string;
  layerId: string;
  /** Overrides the default crop-center pivot for selected Parts. */
  pivotSourceByPartId?: Readonly<Record<string, PartPosePoint>>;
}

export interface SetPartPoseKeyframeInput {
  shotId: string;
  layerId: string;
  partId: string;
  keyframe: PartPoseKeyframe;
}

export interface RetimePartPoseKeyframeInput {
  shotId: string;
  layerId: string;
  partId: string;
  fromTimeMs: number;
  toTimeMs: number;
}

export interface CopyPartPoseKeyframeInput {
  shotId: string;
  layerId: string;
  partId: string;
  sourceTimeMs: number;
  targetTimeMs: number;
  /** UI-only copy buffer snapshot; the source key must still exist. */
  sourceKeyframe?: PartPoseKeyframe;
}

export interface DeletePartPoseKeyframeInput {
  shotId: string;
  layerId: string;
  partId: string;
  timeMs: number;
}

export interface SetPartPoseKeyEasingInput {
  shotId: string;
  layerId: string;
  partId: string;
  timeMs: number;
  easingToNext: PartPoseEasing;
}

export interface ClearPartPoseTrackInput {
  shotId: string;
  layerId: string;
  partId: string;
}

export interface SetPartPosePivotInput {
  shotId: string;
  layerId: string;
  partId: string;
  pivotSource: PartPosePoint;
}

export type PartPoseClearFallback =
  | 'captured-static-snapshot'
  | 'current-character-defaults';

export interface PartPoseClearResult {
  project: Project;
  clearedPartId: string | null;
  changed: boolean;
  animationRemoved: boolean;
  fallback: PartPoseClearFallback;
}

/** True once this Part has keys or values beyond its protected neutral base. */
export function hasAuthoredPartPose(track: PartPoseTrack): boolean {
  const base = track.keys[0]!;
  return (
    track.keys.length > 1 ||
    base.offsetX !== 0 ||
    base.offsetY !== 0 ||
    base.rotationDeg !== 0 ||
    base.scale !== 1 ||
    base.easingToNext !== 'linear'
  );
}

/**
 * Creates and edits persisted Part pose data without owning renderer state.
 * Callers apply each returned Project once through EditorProjectStore.updateProject
 * so one user operation becomes one revision and one undo/redo command.
 */
export class PartPoseAnimationService {
  create(project: Project, input: CreatePartPoseAnimationInput): Project {
    const current = ProjectSchema.parse(project);
    const { shot, layer } = this.requireLayer(current, input.shotId, input.layerId);
    this.assertEditable(layer);
    if (layer.poseAnimation) {
      throw new Error(`Layer ${layer.id} already has Part pose animation.`);
    }
    if (layer.source.kind !== 'character') {
      throw new Error('Part pose animation requires a Character Layer.');
    }
    const characterId = layer.source.characterId;
    const character = current.characters.find(
      (candidate) => candidate.id === characterId,
    );
    if (!character || character.mode !== 'adaptive-parts') {
      throw new Error('Part pose animation requires an Adaptive Parts Character.');
    }

    const pivots = input.pivotSourceByPartId ?? {};
    const validPartIds = new Set(character.parts.map((part) => part.partId));
    const unknownPivotIds = Object.keys(pivots).filter(
      (partId) => !validPartIds.has(partId),
    );
    if (unknownPivotIds.length > 0) {
      throw new Error(
        `Pose pivots reference unknown Parts: ${unknownPivotIds.join(', ')}.`,
      );
    }

    const tracks = character.parts.map((part) =>
      this.snapshotTrack(part, pivots[part.partId]),
    );
    const sourcePoseCharacter: AdaptivePartsCharacter = {
      ...character,
      parts: tracks.map((track) => ({
        partId: track.partId,
        assetId: track.assetId,
        source: { ...track.source },
        restTransform: { ...track.sourceRestTransform },
        sourceRestTransform: { ...track.sourceRestTransform },
        staticAdjustment: { ...track.staticAdjustment },
        imageMapping: {
          ...track.imageMapping,
          crop: { ...track.imageMapping.crop },
        },
        drawOrder: track.drawOrder,
        visible: track.visible,
        ...(track.displayName ? { displayName: track.displayName } : {}),
      })),
    };
    const fixedCharacterCenter = adaptiveCharacterSourceAnchor(
      current,
      sourcePoseCharacter,
    );
    const poseAnimation = PartPoseAnimationSchema.parse({
      version: 1,
      characterId: character.id,
      sourceRootTransform: { ...character.sourceRootTransform },
      fixedCharacterCenter,
      tracks,
    });

    return this.replaceLayer(current, shot.id, layer.id, {
      ...layer,
      poseAnimation,
    });
  }

  /**
   * Explicitly recalibrates an unposed Part track. Once any pose is authored,
   * its pivot stays fixed until the animation is cleared.
   */
  setPivot(project: Project, input: SetPartPosePivotInput): Project {
    const current = ProjectSchema.parse(project);
    const { shot, layer } = this.requireLayer(current, input.shotId, input.layerId);
    this.assertEditable(layer);
    const poseAnimation = layer.poseAnimation;
    if (!poseAnimation) {
      throw new Error(`Layer ${layer.id} has no Part pose animation snapshot.`);
    }
    const trackIndex = poseAnimation.tracks.findIndex(
      (track) => track.partId === input.partId,
    );
    if (trackIndex < 0) {
      throw new Error(`Pose animation has no snapshot for Part ${input.partId}.`);
    }
    const track = poseAnimation.tracks[trackIndex]!;
    if (hasAuthoredPartPose(track)) {
      throw new Error(
        'Part pivot is fixed after a pose is authored; clear the Part pose animation before recalibrating.',
      );
    }
    if (
      track.pivotSource.x === input.pivotSource.x &&
      track.pivotSource.y === input.pivotSource.y
    ) {
      return project;
    }
    const tracks = [...poseAnimation.tracks];
    tracks[trackIndex] = { ...track, pivotSource: { ...input.pivotSource } };
    const nextPoseAnimation = PartPoseAnimationSchema.parse({
      ...poseAnimation,
      tracks,
    });
    return this.replaceLayer(current, shot.id, layer.id, {
      ...layer,
      poseAnimation: nextPoseAnimation,
    });
  }

  /**
   * Sets one key on one Part track. New keys are inserted at their time-grid
   * position; malformed persisted key arrays are rejected by ProjectSchema.
   * The protected 0 ms key may be updated but cannot be removed or retimed.
   */
  setKeyframe(project: Project, input: SetPartPoseKeyframeInput): Project {
    const current = ProjectSchema.parse(project);
    const { shot, layer } = this.requireLayer(current, input.shotId, input.layerId);
    this.assertEditable(layer);
    const poseAnimation = layer.poseAnimation;
    if (!poseAnimation) {
      throw new Error(`Layer ${layer.id} has no Part pose animation snapshot.`);
    }
    const keyframe = PartPoseKeyframeSchema.parse(input.keyframe);
    if (keyframe.timeMs > shot.durationMs) {
      throw new Error('Part pose keyframe must be within the Shot duration.');
    }

    const trackIndex = poseAnimation.tracks.findIndex(
      (track) => track.partId === input.partId,
    );
    if (trackIndex < 0) {
      throw new Error(`Pose animation has no snapshot for Part ${input.partId}.`);
    }
    const tracks = [...poseAnimation.tracks];
    const track = tracks[trackIndex]!;
    const keys = [...track.keys];
    const existingIndex = keys.findIndex((key) => key.timeMs === keyframe.timeMs);
    if (existingIndex >= 0) {
      keys[existingIndex] = keyframe;
    } else {
      const insertionIndex = keys.findIndex((key) => key.timeMs > keyframe.timeMs);
      keys.splice(insertionIndex < 0 ? keys.length : insertionIndex, 0, keyframe);
    }
    tracks[trackIndex] = { ...track, keys };
    const nextPoseAnimation: PartPoseAnimation =
      PartPoseAnimationSchema.parse({ ...poseAnimation, tracks });
    if (JSON.stringify(nextPoseAnimation) === JSON.stringify(poseAnimation)) {
      return current;
    }
    return this.replaceLayer(current, shot.id, layer.id, {
      ...layer,
      poseAnimation: nextPoseAnimation,
    });
  }

  /** Move an existing non-base key without replacing another key. */
  retimeKeyframe(project: Project, input: RetimePartPoseKeyframeInput): Project {
    const current = ProjectSchema.parse(project);
    const { shot, layer } = this.requireLayer(current, input.shotId, input.layerId);
    this.assertEditable(layer);
    const poseAnimation = layer.poseAnimation;
    if (!poseAnimation) {
      throw new Error(`Layer ${layer.id} has no Part pose animation snapshot.`);
    }
    if (!isValidFrameTime(input.fromTimeMs)) {
      throw new Error('Part pose source key must be on the Project frame grid.');
    }
    if (!isValidFrameTime(input.toTimeMs)) {
      throw new Error('Part pose target key must be on the Project frame grid.');
    }
    if (input.toTimeMs > lastValidFrameTime(Math.max(0, shot.durationMs - 1))) {
      throw new Error('Part pose target key must be within the Shot duration.');
    }

    const trackIndex = poseAnimation.tracks.findIndex(
      (track) => track.partId === input.partId,
    );
    if (trackIndex < 0) {
      throw new Error(`Pose animation has no snapshot for Part ${input.partId}.`);
    }
    const tracks = [...poseAnimation.tracks];
    const track = tracks[trackIndex]!;
    const keyIndex = track.keys.findIndex(
      (key) => key.timeMs === input.fromTimeMs,
    );
    if (keyIndex < 0) {
      throw new Error(`Part ${input.partId} has no key at ${input.fromTimeMs} ms.`);
    }
    if (input.toTimeMs === input.fromTimeMs) return current;
    if (input.fromTimeMs === 0) {
      throw new Error('The protected 0 ms Part pose key cannot be moved.');
    }
    if (input.toTimeMs === 0) {
      throw new Error('A Part pose key cannot be moved onto the protected 0 ms key.');
    }
    if (track.keys.some((key) => key.timeMs === input.toTimeMs)) {
      throw new Error('A Part pose key already exists at the target time.');
    }
    const previous = track.keys[keyIndex - 1];
    const next = track.keys[keyIndex + 1];
    if (
      (previous && input.toTimeMs <= previous.timeMs) ||
      (next && input.toTimeMs >= next.timeMs)
    ) {
      throw new Error('Part pose keys cannot cross an adjacent key.');
    }

    const keys = [...track.keys];
    keys[keyIndex] = { ...keys[keyIndex]!, timeMs: input.toTimeMs };
    tracks[trackIndex] = { ...track, keys };
    const nextPoseAnimation = PartPoseAnimationSchema.parse({
      ...poseAnimation,
      tracks,
    });
    return this.replaceLayer(current, shot.id, layer.id, {
      ...layer,
      poseAnimation: nextPoseAnimation,
    });
  }

  /** Copy one existing key's complete pose and outgoing easing to a free time. */
  copyKeyframe(project: Project, input: CopyPartPoseKeyframeInput): Project {
    const current = ProjectSchema.parse(project);
    const { shot, layer } = this.requireLayer(current, input.shotId, input.layerId);
    this.assertEditable(layer);
    const poseAnimation = layer.poseAnimation;
    if (!poseAnimation) {
      throw new Error(`Layer ${layer.id} has no Part pose animation snapshot.`);
    }
    if (!isValidFrameTime(input.sourceTimeMs)) {
      throw new Error('Part pose source key must be on the Project frame grid.');
    }
    if (!isValidFrameTime(input.targetTimeMs)) {
      throw new Error('Part pose target key must be on the Project frame grid.');
    }
    if (input.targetTimeMs > lastValidFrameTime(Math.max(0, shot.durationMs - 1))) {
      throw new Error('Part pose target key must be within the Shot duration.');
    }

    const trackIndex = poseAnimation.tracks.findIndex(
      (track) => track.partId === input.partId,
    );
    if (trackIndex < 0) {
      throw new Error(`Pose animation has no snapshot for Part ${input.partId}.`);
    }
    const tracks = [...poseAnimation.tracks];
    const track = tracks[trackIndex]!;
    const source = track.keys.find((key) => key.timeMs === input.sourceTimeMs);
    if (!source) {
      throw new Error(`Part ${input.partId} has no key at ${input.sourceTimeMs} ms.`);
    }
    const copiedKeyframe = input.sourceKeyframe
      ? PartPoseKeyframeSchema.parse(input.sourceKeyframe)
      : source;
    if (copiedKeyframe.timeMs !== input.sourceTimeMs) {
      throw new Error('Copied Part pose data no longer matches its source key.');
    }
    if (input.targetTimeMs === 0) {
      throw new Error('A Part pose key cannot be copied onto the protected 0 ms key.');
    }
    if (track.keys.some((key) => key.timeMs === input.targetTimeMs)) {
      throw new Error('A Part pose key already exists at the target time.');
    }

    const keys = [...track.keys, { ...copiedKeyframe, timeMs: input.targetTimeMs }].sort(
      (left, right) => left.timeMs - right.timeMs,
    );
    tracks[trackIndex] = { ...track, keys };
    const nextPoseAnimation = PartPoseAnimationSchema.parse({
      ...poseAnimation,
      tracks,
    });
    return this.replaceLayer(current, shot.id, layer.id, {
      ...layer,
      poseAnimation: nextPoseAnimation,
    });
  }

  /** Delete one non-base key from the current Part track. */
  deleteKeyframe(project: Project, input: DeletePartPoseKeyframeInput): Project {
    const current = ProjectSchema.parse(project);
    const { shot, layer } = this.requireLayer(current, input.shotId, input.layerId);
    this.assertEditable(layer);
    const poseAnimation = layer.poseAnimation;
    if (!poseAnimation) {
      throw new Error(`Layer ${layer.id} has no Part pose animation snapshot.`);
    }
    if (!isValidFrameTime(input.timeMs)) {
      throw new Error('Part pose key must be on the Project frame grid.');
    }

    const trackIndex = poseAnimation.tracks.findIndex(
      (track) => track.partId === input.partId,
    );
    if (trackIndex < 0) {
      throw new Error(`Pose animation has no snapshot for Part ${input.partId}.`);
    }
    const tracks = [...poseAnimation.tracks];
    const track = tracks[trackIndex]!;
    const keyIndex = track.keys.findIndex((key) => key.timeMs === input.timeMs);
    if (keyIndex < 0) {
      throw new Error(`Part ${input.partId} has no key at ${input.timeMs} ms.`);
    }
    if (input.timeMs === 0) {
      throw new Error('The protected 0 ms Part pose key cannot be deleted.');
    }

    const keys = track.keys.filter((_, index) => index !== keyIndex);
    tracks[trackIndex] = { ...track, keys };
    const nextPoseAnimation = PartPoseAnimationSchema.parse({
      ...poseAnimation,
      tracks,
    });
    return this.replaceLayer(current, shot.id, layer.id, {
      ...layer,
      poseAnimation: nextPoseAnimation,
    });
  }

  /** Set the easing for exactly one existing key-to-next-key interval. */
  setKeyEasing(project: Project, input: SetPartPoseKeyEasingInput): Project {
    const current = ProjectSchema.parse(project);
    const { shot, layer } = this.requireLayer(current, input.shotId, input.layerId);
    this.assertEditable(layer);
    const poseAnimation = layer.poseAnimation;
    if (!poseAnimation) {
      throw new Error(`Layer ${layer.id} has no Part pose animation snapshot.`);
    }
    if (!isValidFrameTime(input.timeMs)) {
      throw new Error('Part pose key must be on the Project frame grid.');
    }

    const trackIndex = poseAnimation.tracks.findIndex(
      (track) => track.partId === input.partId,
    );
    if (trackIndex < 0) {
      throw new Error(`Pose animation has no snapshot for Part ${input.partId}.`);
    }
    const tracks = [...poseAnimation.tracks];
    const track = tracks[trackIndex]!;
    const keyIndex = track.keys.findIndex((key) => key.timeMs === input.timeMs);
    if (keyIndex < 0) {
      throw new Error(`Part ${input.partId} has no key at ${input.timeMs} ms.`);
    }
    if (keyIndex === track.keys.length - 1) {
      throw new Error('The last Part pose key has no outgoing interval.');
    }
    if (track.keys[keyIndex]!.easingToNext === input.easingToNext) {
      return current;
    }

    const keys = [...track.keys];
    keys[keyIndex] = PartPoseKeyframeSchema.parse({
      ...keys[keyIndex]!,
      easingToNext: input.easingToNext,
    });
    tracks[trackIndex] = { ...track, keys };
    const nextPoseAnimation = PartPoseAnimationSchema.parse({
      ...poseAnimation,
      tracks,
    });
    return this.replaceLayer(current, shot.id, layer.id, {
      ...layer,
      poseAnimation: nextPoseAnimation,
    });
  }

  /**
   * Clears one Part's authored pose while retaining its captured static Part
   * snapshot if another Part still has authored animation. Clearing the last
   * authored Part drops the whole snapshot and explicitly falls back to the
   * Character's current defaults.
   */
  clearTrack(
    project: Project,
    input: ClearPartPoseTrackInput,
  ): PartPoseClearResult {
    const current = ProjectSchema.parse(project);
    const { shot, layer } = this.requireLayer(current, input.shotId, input.layerId);
    this.assertEditable(layer);
    const poseAnimation = layer.poseAnimation;
    if (!poseAnimation) {
      throw new Error(`Layer ${layer.id} has no Part pose animation snapshot.`);
    }
    const trackIndex = poseAnimation.tracks.findIndex(
      (track) => track.partId === input.partId,
    );
    if (trackIndex < 0) {
      throw new Error(`Pose animation has no snapshot for Part ${input.partId}.`);
    }

    const tracks = [...poseAnimation.tracks];
    const track = tracks[trackIndex]!;
    const neutralTrack: PartPoseTrack = {
      ...track,
      keys: [
        {
          timeMs: 0,
          offsetX: 0,
          offsetY: 0,
          rotationDeg: 0,
          scale: 1,
          easingToNext: 'linear',
        },
      ],
    };
    const trackChanged =
      JSON.stringify(track.keys) !== JSON.stringify(neutralTrack.keys);
    tracks[trackIndex] = neutralTrack;
    const hasAuthoredTrack = tracks.some(hasAuthoredPartPose);

    if (!hasAuthoredTrack) {
      const layerWithoutPose = { ...layer };
      delete layerWithoutPose.poseAnimation;
      const nextProject = this.replaceLayer(
        current,
        shot.id,
        layer.id,
        layerWithoutPose,
      );
      return {
        project: nextProject,
        clearedPartId: input.partId,
        changed: true,
        animationRemoved: true,
        fallback: 'current-character-defaults',
      };
    }

    if (!trackChanged) {
      return {
        project: current,
        clearedPartId: input.partId,
        changed: false,
        animationRemoved: false,
        fallback: 'captured-static-snapshot',
      };
    }

    const nextPoseAnimation: PartPoseAnimation =
      PartPoseAnimationSchema.parse({ ...poseAnimation, tracks });
    return {
      project: this.replaceLayer(current, shot.id, layer.id, {
        ...layer,
        poseAnimation: nextPoseAnimation,
      }),
      clearedPartId: input.partId,
      changed: true,
      animationRemoved: false,
      fallback: 'captured-static-snapshot',
    };
  }

  /** Removes the instance snapshot and returns to the Character's current defaults. */
  clearAnimation(
    project: Project,
    input: Pick<ClearPartPoseTrackInput, 'shotId' | 'layerId'>,
  ): PartPoseClearResult {
    const current = ProjectSchema.parse(project);
    const { shot, layer } = this.requireLayer(current, input.shotId, input.layerId);
    this.assertEditable(layer);
    if (!layer.poseAnimation) {
      throw new Error(`Layer ${layer.id} has no Part pose animation snapshot.`);
    }
    const layerWithoutPose = { ...layer };
    delete layerWithoutPose.poseAnimation;
    return {
      project: this.replaceLayer(
        current,
        shot.id,
        layer.id,
        layerWithoutPose,
      ),
      clearedPartId: null,
      changed: true,
      animationRemoved: true,
      fallback: 'current-character-defaults',
    };
  }

  private assertEditable(layer: Project['shots'][number]['layers'][number]): void {
    if (layer.locked) {
      throw new Error(`Layer ${layer.id} is locked and cannot edit Part poses.`);
    }
  }

  private snapshotTrack(
    part: CharacterPart,
    pivotOverride?: PartPosePoint,
  ): PartPoseTrack {
    const sourceRestTransform =
      part.sourceRestTransform ?? part.restTransform;
    const staticAdjustment =
      part.staticAdjustment ?? DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT;
    const crop = part.imageMapping.crop;
    return {
      partId: part.partId,
      assetId: part.assetId,
      source: { ...part.source },
      restTransform: { ...part.restTransform },
      sourceRestTransform: { ...sourceRestTransform },
      staticAdjustment: { ...staticAdjustment },
      imageMapping: {
        ...part.imageMapping,
        crop: { ...crop },
      },
      drawOrder: part.drawOrder,
      visible: part.visible,
      ...(part.displayName ? { displayName: part.displayName } : {}),
      pivotSource: pivotOverride
        ? { ...pivotOverride }
        : {
            x: crop.x + crop.width / 2,
            y: crop.y + crop.height / 2,
          },
      keys: [
        {
          timeMs: 0,
          offsetX: 0,
          offsetY: 0,
          rotationDeg: 0,
          scale: 1,
          easingToNext: 'linear',
        },
      ],
    };
  }

  private requireLayer(
    project: Project,
    shotId: string,
    layerId: string,
  ): { shot: Project['shots'][number]; layer: Project['shots'][number]['layers'][number] } {
    const shot = project.shots.find((candidate) => candidate.id === shotId);
    if (!shot) throw new Error(`Shot ${shotId} does not exist.`);
    const layer = shot.layers.find((candidate) => candidate.id === layerId);
    if (!layer) throw new Error(`Layer ${layerId} does not exist in Shot ${shotId}.`);
    return { shot, layer };
  }

  private replaceLayer(
    project: Project,
    shotId: string,
    layerId: string,
    nextLayer: Project['shots'][number]['layers'][number],
  ): Project {
    return ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) =>
        shot.id !== shotId
          ? shot
          : {
              ...shot,
              layers: shot.layers.map((layer) =>
                layer.id === layerId ? nextLayer : layer,
              ),
            },
      ),
    });
  }
}
