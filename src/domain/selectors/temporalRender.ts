import type {
  EvaluatedHeadGroupTransform,
  EvaluatedLayer,
  EvaluatedShot,
} from '../evaluate-shot-at-time';
import type { ImageAsset, Project, Shot } from '../models';
import { evaluateShotAtTime } from '../evaluate-shot-at-time';
import {
  resolveLayerVisualParts,
  type VisualResourceReference,
} from './visualParts';
import { buildDialogueSubtitleCues } from '../../shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../../shared/preview/subtitle-engine';

export const MOUTH_FLAP_PERIOD_MS = 320;
export const MOUTH_OPEN_MS = 160;
export const TALKING_HEAD_BOB_AMPLITUDE_PX = 4;
export const TALKING_HEAD_FREQUENCY_HZ = 2;
export const TALKING_HEAD_EDGE_ENVELOPE_MS = 120;

const IDENTITY_HEAD_GROUP_TRANSFORM = {
  translateX: 0,
  translateY: 0,
  scaleX: 1,
  scaleY: 1,
  rotationDeg: 0,
} as const;

function smoothStep(progress: number): number {
  const amount = Math.min(1, Math.max(0, progress));
  return amount * amount * (3 - 2 * amount);
}

/** Pure requested-time V1 motion; elapsed time is local to one Dialogue. */
export function resolveTalkingHeadMotionTransform(
  elapsedMs: number,
  dialogueDurationMs: number,
  intensityPercent = 100,
): EvaluatedHeadGroupTransform {
  if (
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(dialogueDurationMs) ||
    intensityPercent === 0 ||
    elapsedMs <= 0 ||
    dialogueDurationMs <= 0 ||
    elapsedMs >= dialogueDurationMs
  ) {
    return { ...IDENTITY_HEAD_GROUP_TRANSFORM };
  }

  const periodMs = 1_000 / TALKING_HEAD_FREQUENCY_HZ;
  const phase = 2 * Math.PI * ((elapsedMs % periodMs) / periodMs);
  const envelope = Math.min(
    smoothStep(elapsedMs / TALKING_HEAD_EDGE_ENVELOPE_MS),
    smoothStep(
      (dialogueDurationMs - elapsedMs) / TALKING_HEAD_EDGE_ENVELOPE_MS,
    ),
  );
  const motion = Math.sin(phase) * envelope;
  return {
    translateX: 0,
    translateY:
      TALKING_HEAD_BOB_AMPLITUDE_PX * (intensityPercent / 100) * motion,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
  };
}

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
 * Applies the transient Mouth projection used by Editor Live Scrub and Product
 * Preview. The bound AudioClip starts an open-first 320ms cycle: 160ms Mouth,
 * then 160ms of the current formal Expression. All other temporal values stay
 * owned by the formal evaluator.
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

  // Closed phases use the exact formal Expression already in evaluatedShot.
  // Keeping the phase audio-relative makes seeks and dropped frames inert.
  if (
    (evaluatedShot.timeMs - audioClip.startMs) % MOUTH_FLAP_PERIOD_MS >=
    MOUTH_OPEN_MS
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

function clearHeadGroupMotion(evaluatedShot: EvaluatedShot): EvaluatedShot {
  if (!evaluatedShot.layers.some((layer) => layer.headGroupTransform)) {
    return evaluatedShot;
  }
  return {
    ...evaluatedShot,
    layers: evaluatedShot.layers.map((layer) => {
      if (!layer.headGroupTransform) return layer;
      const neutralLayer = { ...layer };
      delete neutralLayer.headGroupTransform;
      return neutralLayer;
    }),
  };
}

/**
 * Applies one deterministic motion to the unique visible occurrence owned by
 * the active Dialogue. Ambiguous duplicate Character occurrences stay neutral.
 */
export function projectShotHeadMotion(
  project: Project,
  shot: Shot,
  evaluatedShot: EvaluatedShot,
  activeDialogueId: string | null,
): EvaluatedShot {
  const neutralShot = clearHeadGroupMotion(evaluatedShot);
  if (!activeDialogueId) return neutralShot;

  const dialogue = shot.dialogues.find(
    (candidate) => candidate.id === activeDialogueId,
  );
  if (
    !dialogue ||
    neutralShot.timeMs < dialogue.startMs ||
    neutralShot.timeMs >= dialogue.endMs
  ) {
    return neutralShot;
  }

  const evaluatedById = new Map(
    neutralShot.layers.map((layer) => [layer.id, layer]),
  );
  const matchingLayers = shot.layers.filter((layer) =>
    layer.id !== shot.backgroundLayerId &&
    layer.source.kind === 'character' &&
    layer.source.characterId === dialogue.characterId &&
    evaluatedById.get(layer.id)?.visible,
  );
  if (matchingLayers.length !== 1) return neutralShot;

  const targetLayer = matchingLayers[0]!;
  const character = project.characters.find(
    (candidate) => candidate.id === dialogue.characterId,
  );
  if (character?.mode !== 'composite' || !character.head) {
    return neutralShot;
  }

  const transform = resolveTalkingHeadMotionTransform(
    neutralShot.timeMs - dialogue.startMs,
    dialogue.endMs - dialogue.startMs,
    character.talkingHeadMotionIntensityPercent,
  );
  if (
    transform.translateX === 0 &&
    transform.translateY === 0 &&
    transform.rotationDeg === 0
  ) {
    return neutralShot;
  }

  return {
    ...neutralShot,
    layers: neutralShot.layers.map((layer) =>
      layer.id === targetLayer.id
        ? { ...layer, headGroupTransform: transform }
        : layer,
    ),
  };
}

/**
 * Shared read-only Dialogue projection for editor, Product Preview, and Export.
 * The active cue winner is the existing subtitle/Mouth/speaker authority.
 */
export function projectShotDialogueVisual(
  project: Project,
  shot: Shot,
  evaluatedShot: EvaluatedShot,
  explicitActiveDialogueId?: string | null,
): EvaluatedShot {
  const activeDialogueId =
    explicitActiveDialogueId === undefined
      ? evaluateSubtitleAtTime(
          buildDialogueSubtitleCues(shot.dialogues),
          evaluatedShot.timeMs,
        )?.id ?? null
      : explicitActiveDialogueId;
  const withMouth = projectShotMouth(
    project,
    shot,
    evaluatedShot,
    activeDialogueId,
  );
  return projectShotHeadMotion(
    project,
    shot,
    withMouth,
    activeDialogueId,
  );
}
