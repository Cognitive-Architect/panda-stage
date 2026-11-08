import { ProjectSchema, type Project } from '../models/project';
import { PartPoseActionPresetSchema } from '../models/part-pose-preset';
import {
  PartPoseAnimationSchema,
  type PartPoseAnimation,
  type PartPoseTrack,
} from '../models/pose-animation';
import {
  hasAuthoredPartPose,
  PartPoseAnimationService,
} from './PartPoseAnimationService';

export interface SavePartPoseActionPresetInput {
  shotId: string;
  layerId: string;
  name: string;
}

export interface ApplyPartPoseActionPresetInput {
  shotId: string;
  layerId: string;
  presetId: string;
}

export interface DeletePartPoseActionPresetInput {
  presetId: string;
}

type ProjectLayer = Project['shots'][number]['layers'][number];

/**
 * Saves user-authored Part pose animations as reusable per-Character presets
 * and applies them to other Shot instances of the same Character. The shared
 * Part pose engine (snapshot, pivot, keyframes, evaluation) stays the single
 * source of truth; presets never reference mutable source tracks, and one
 * apply call returns exactly one Project update for one history revision.
 */
export class PartPoseActionPresetService {
  private readonly poseService = new PartPoseAnimationService();

  constructor(private readonly createId: () => string = () => crypto.randomUUID()) {}

  save(project: Project, input: SavePartPoseActionPresetInput): Project {
    const current = ProjectSchema.parse(project);
    const name = input.name.trim();
    if (!name) {
      throw new Error('Preset name must not be empty.');
    }
    const { layer } = this.requireLayer(current, input.shotId, input.layerId);
    const poseAnimation = layer.poseAnimation;
    if (!poseAnimation) {
      throw new Error(
        'This instance has no Part pose animation to save as a preset yet.',
      );
    }
    if (!poseAnimation.tracks.some((track) => hasAuthoredPartPose(track))) {
      throw new Error(
        'Author at least one Part keyframe before saving a preset.',
      );
    }
    const character = current.characters.find(
      (candidate) => candidate.id === poseAnimation.characterId,
    );
    if (!character) {
      throw new Error(
        `Preset source Character ${poseAnimation.characterId} does not exist.`,
      );
    }
    const existing = current.partPosePresets ?? [];
    if (existing.some((preset) => preset.name === name)) {
      throw new Error(`A preset named "${name}" already exists.`);
    }

    const preset = PartPoseActionPresetSchema.parse({
      id: this.createId(),
      name,
      characterId: poseAnimation.characterId,
      durationMs: Math.max(
        ...poseAnimation.tracks.flatMap((track) =>
          track.keys.map((key) => key.timeMs),
        ),
      ),
      sourceRootTransform: { ...poseAnimation.sourceRootTransform },
      fixedCharacterCenter: { ...poseAnimation.fixedCharacterCenter },
      tracks: poseAnimation.tracks.map((track) => ({
        partId: track.partId,
        keys: track.keys.map((key) => ({ ...key })),
        pivotSource: { ...track.pivotSource },
        sourceRestTransform: { ...track.sourceRestTransform },
      })),
      createdAt: new Date().toISOString(),
    });
    return ProjectSchema.parse({
      ...current,
      partPosePresets: [...existing, preset],
    });
  }

  apply(project: Project, input: ApplyPartPoseActionPresetInput): Project {
    const current = ProjectSchema.parse(project);
    const preset = (current.partPosePresets ?? []).find(
      (candidate) => candidate.id === input.presetId,
    );
    if (!preset) {
      throw new Error('The selected action preset no longer exists.');
    }
    const { shot, layer } = this.requireLayer(current, input.shotId, input.layerId);
    this.assertEditable(layer);
    if (layer.source.kind !== 'character') {
      throw new Error('Action presets apply to Character Layers only.');
    }
    if (layer.source.characterId !== preset.characterId) {
      throw new Error(
        'This preset belongs to a different Character; it cannot be applied here.',
      );
    }
    if (layer.poseAnimation) {
      throw new Error(
        'This instance already has Part pose animation; clear it before applying a preset.',
      );
    }
    const character = current.characters.find(
      (candidate) => candidate.id === preset.characterId,
    );
    if (!character || character.mode !== 'adaptive-parts') {
      throw new Error(
        'Action presets require an Adaptive Parts Character that still exists.',
      );
    }
    const partsById = new Map(character.parts.map((part) => [part.partId, part]));
    for (const track of preset.tracks) {
      const part = partsById.get(track.partId);
      if (!part) {
        throw new Error(
          `The target Character is missing Part ${track.partId}; the preset cannot be applied.`,
        );
      }
      const sourceRestTransform = part.sourceRestTransform ?? part.restTransform;
      if (
        JSON.stringify(sourceRestTransform) !==
        JSON.stringify(track.sourceRestTransform)
      ) {
        throw new Error(
          `Part ${track.partId} rest pose changed since this preset was saved; refusing an incompatible apply.`,
        );
      }
    }
    if (preset.durationMs > shot.durationMs) {
      throw new Error(
        `This Shot is shorter than the preset motion (${preset.durationMs} ms).`,
      );
    }

    // Capture the target instance's own rest pose through the shared engine,
    // then overwrite pivots and keys with the preset's relative motion.
    const withSnapshot = this.poseService.create(current, {
      shotId: input.shotId,
      layerId: input.layerId,
    });
    const { layer: snapshotLayer } = this.requireLayer(
      withSnapshot,
      input.shotId,
      input.layerId,
    );
    const animation = snapshotLayer.poseAnimation;
    if (!animation) {
      throw new Error('Part pose snapshot could not be captured.');
    }
    const nextTracks = animation.tracks.map(
      (track): PartPoseTrack => {
        const presetTrack = preset.tracks.find(
          (candidate) => candidate.partId === track.partId,
        );
        if (!presetTrack) {
          return track;
        }
        return {
          ...track,
          pivotSource: { ...presetTrack.pivotSource },
          keys: presetTrack.keys.map((key) => ({ ...key })),
        };
      },
    );
    const nextPoseAnimation: PartPoseAnimation = PartPoseAnimationSchema.parse({
      ...animation,
      tracks: nextTracks,
    });
    return ProjectSchema.parse(
      replaceLayer(withSnapshot, input.shotId, input.layerId, {
        ...snapshotLayer,
        poseAnimation: nextPoseAnimation,
      }),
    );
  }  delete(project: Project, input: DeletePartPoseActionPresetInput): Project {
    const current = ProjectSchema.parse(project);
    const existing = current.partPosePresets ?? [];
    const next = existing.filter((preset) => preset.id !== input.presetId);
    if (next.length === existing.length) {
      throw new Error('The selected action preset no longer exists.');
    }
    return ProjectSchema.parse({
      ...current,
      partPosePresets: next,
    });
  }

  private assertEditable(layer: ProjectLayer): void {
    if (layer.locked) {
      throw new Error(`Layer ${layer.id} is locked and cannot edit Part poses.`);
    }
  }

  private requireLayer(
    project: Project,
    shotId: string,
    layerId: string,
  ): { shot: Project['shots'][number]; layer: ProjectLayer } {
    const shot = project.shots.find((candidate) => candidate.id === shotId);
    if (!shot) throw new Error(`Shot ${shotId} does not exist.`);
    const layer = shot.layers.find((candidate) => candidate.id === layerId);
    if (!layer) throw new Error(`Layer ${layerId} does not exist in Shot ${shotId}.`);
    return { shot, layer };
  }
}

function replaceLayer(
  project: Project,
  shotId: string,
  layerId: string,
  nextLayer: ProjectLayer,
): Project {
  return {
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
  };
}
