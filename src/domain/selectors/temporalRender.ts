import type { EvaluatedLayer, EvaluatedShot } from '../evaluate-shot-at-time';
import type { ImageAsset, Project, Shot } from '../models';
import { evaluateShotAtTime } from '../evaluate-shot-at-time';
import {
  resolveLayerVisualParts,
  type VisualResourceReference,
} from './visualParts';

/**
 * Lists the image assets a single Shot may display over time.
 *
 * This is deliberately scoped to the current Shot. Base layer images, every
 * expression used by its character layers, and valid mouth-open images are
 * all included without turning the rule into a whole-project preload.
 */
export function listShotRuntimeImageAssets(
  project: Project,
  shot: Shot,
): ImageAsset[] {
  const assets = new Map<string, ImageAsset>();
  const evaluated = evaluateShotAtTime(shot, 0, project);
  for (const layer of evaluated.layers) {
    const visual = resolveLayerVisualParts(project, shot, layer);
    const resources: VisualResourceReference[] = [
      ...visual.resources.required,
      ...visual.resources.candidates,
      ...visual.resources.fallback,
    ];
    for (const resource of resources) {
      const asset = project.assets.find(
        (candidate) => candidate.id === resource.assetId,
      );
      if (asset?.kind === 'image') assets.set(asset.id, asset);
    }
  }

  return [...assets.values()];
}

/**
 * Applies the transient mouth-open projection used by both Editor Live Scrub
 * and Product Preview. The formal evaluator remains the source of every other
 * temporal value; this function only projects the active dialogue's bound
 * audio interval onto the speaking character's image asset.
 */
export function projectShotMouth(
  project: Project,
  shot: Shot,
  evaluatedShot: EvaluatedShot,
  activeDialogueId: string | null,
): EvaluatedShot {
  if (!activeDialogueId) return evaluatedShot;

  const dialogue = shot.dialogues.find(
    (candidate) => candidate.id === activeDialogueId,
  );
  if (!dialogue?.audioClipId) return evaluatedShot;

  const audioClip = shot.audioClips.find(
    (candidate) => candidate.id === dialogue.audioClipId,
  );
  if (
    !audioClip ||
    evaluatedShot.timeMs < audioClip.startMs ||
    evaluatedShot.timeMs >= audioClip.endMs
  ) {
    return evaluatedShot;
  }

  const audioAsset = project.assets.find(
    (candidate) => candidate.id === audioClip.assetId,
  );
  if (audioAsset?.kind !== 'audio') return evaluatedShot;

  const speakingCharacter = project.characters.find(
    (candidate) => candidate.id === dialogue.characterId,
  );
  if (!speakingCharacter?.mouthOpenAssetId) return evaluatedShot;

  const mouthAsset = project.assets.find(
    (candidate) => candidate.id === speakingCharacter.mouthOpenAssetId,
  );
  if (mouthAsset?.kind !== 'image') return evaluatedShot;

  let changed = false;
  const layers = evaluatedShot.layers.map((layer: EvaluatedLayer) => {
    const source = shot.layers.find(
      (candidate) => candidate.id === layer.id,
    )?.source;
    if (
      source?.kind !== 'character' ||
      source.characterId !== dialogue.characterId
    ) {
      return layer;
    }
    if (
      layer.assetId === mouthAsset.id &&
      layer.mouthOverrideAssetId === mouthAsset.id
    ) {
      return layer;
    }
    changed = true;
    return {
      ...layer,
      assetId: mouthAsset.id,
      mouthOverrideAssetId: mouthAsset.id,
    };
  });

  return changed ? { ...evaluatedShot, layers } : evaluatedShot;
}
