import type {
  EvaluatedHeadGroupTransform,
  EvaluatedLayer,
  EvaluatedShot,
} from '../evaluate-shot-at-time';
import { audioClipSourceTimeMs, isAudioClipActiveAtTime } from '../audio-contract';
import { resolveMouthPoseEvent } from '../services/mouthPoses';
import { isCharacterTalkingSourceAvailable, listCharacterTalkingSources, resolveCharacterFaceSourceOrNull, resolveCharacterTalkingFace } from './characterFaceSource';
import type { AudioClip, ImageAsset, Project, Shot } from '../models';
import { isFlaGraphicDefinition } from '../models/animation';
import { evaluateFlaGraphicVisual } from '../evaluate-fla-graphic';
import {
  evaluateShotAtTime,
  resolveEffectiveMouthCue,
} from '../evaluate-shot-at-time';
import {
  resolveLayerVisualParts,
  type VisualResourceReference,
} from './visualParts';
import type { DialogueSilence } from '../../shared/dialogue-silence';
import { buildDialogueSubtitleCues } from '../../shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../../shared/preview/subtitle-engine';

export const MOUTH_FLAP_PERIOD_MS = 320;
export const MOUTH_OPEN_MS = 160;
export const TALKING_HEAD_BOB_AMPLITUDE_PX = 4;
export const TALKING_HEAD_FREQUENCY_HZ = 2;
export const TALKING_HEAD_EDGE_ENVELOPE_MS = 120;

/** Images needed by every referenced Character action frame in one Shot. */
export function listCharacterActionVisualAssetIds(project: Project, shot: Shot): string[] {
  const assetIds = new Set<string>();
  for (const event of shot.timelineEvents) {
    if (event.type !== 'character-action') continue;
    const layer = shot.layers.find((candidate) => candidate.id === event.layerId);
    const characterId = layer?.source.kind === 'character' ? layer.source.characterId : undefined;
    const character = project.characters.find((candidate) => candidate.id === characterId);
    const action = character?.actions?.find((candidate) => candidate.id === event.actionId);
    const animation = action && 'animationId' in action
      ? project.animations.find((candidate) => candidate.id === action.animationId)
      : undefined;
    if (!animation) continue;
    for (const frame of animation.frames) assetIds.add(frame.assetId);
    if (isFlaGraphicDefinition(animation)) {
      for (const frame of animation.frames) {
        const visual = evaluateFlaGraphicVisual({
          definition: animation,
          frameOrdinal: frame.ordinal,
          mode: 'instance',
          internalTimeMs: frame.startMs,
        });
        for (const assetId of visual?.resourceAssetIds ?? []) assetIds.add(assetId);
      }
    }
  }
  return [...assetIds];
}

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
  // Start each Dialogue from neutral toward the frozen upper-left endpoint,
  // then return through neutral toward the lower-right endpoint.
  const rawMotion = -Math.sin(phase) * envelope;
  const motion = Math.abs(rawMotion) < 1e-12 ? 0 : rawMotion;
  const offset =
    TALKING_HEAD_BOB_AMPLITUDE_PX * (intensityPercent / 100) * motion;
  return {
    translateX: offset,
    translateY: offset,
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
  const ownerByLayer = new Map(shot.layers.flatMap(({ id, source }) =>
    source.kind === 'character' ? [[id, source.characterId] as const] : []));
  const characterIds = new Set(ownerByLayer.values());
  const eventsByCharacter = new Map<string, Map<string, boolean>>();
  for (const event of shot.timelineEvents) {
    if (event.type !== 'mouth-pose') continue;
    const owner = ownerByLayer.get(event.layerId);
    if (!owner) continue;
    const poses = eventsByCharacter.get(owner) ?? new Map<string, boolean>();
    poses.set(event.poseId, poses.get(event.poseId) === true || event.origin === 'manual');
    eventsByCharacter.set(owner, poses);
  }
  const assetIndex = new Map(project.assets.map((asset) => [asset.id, asset]));
  for (const assetId of listCharacterActionVisualAssetIds(project, shot)) {
    const asset = assetIndex.get(assetId);
    if (asset?.kind === 'image') assets.set(asset.id, asset);
  }
  for (const character of project.characters) {
    const set = character.mouthPoseSet;
    if (!characterIds.has(character.id) || !set) continue;
    const events = eventsByCharacter.get(character.id);
    for (const pose of set.poses) {
      const used = set.driveMode === 'mouth-poses'
        ? pose.id === set.restPoseId || events?.has(pose.id)
        : events?.get(pose.id) === true;
      if (!used) continue;
      const face = resolveCharacterFaceSourceOrNull(project, pose.source);
      const resourceIds = face?.flaGraphic?.resourceAssetIds ?? (face?.assetId ? [face.assetId] : []);
      for (const id of resourceIds) {
        const asset = assetIndex.get(id);
        if (asset?.kind === 'image') assets.set(id, asset);
      }
    }
  }
  const evaluated = evaluateShotAtTime(shot, 0, project);
  for (const layer of evaluated.layers) {
    const visual = resolveLayerVisualParts(project, shot, layer);
    const resources: VisualResourceReference[] = [
      ...visual.resources.required,
      ...visual.resources.candidates,
      ...visual.resources.fallback,
    ];
    for (const resource of resources) {
      const asset = assetIndex.get(resource.assetId);
      if (asset?.kind === 'image') assets.set(asset.id, asset);
    }
  }

  return [...assets.values()];
}

/** Shared speaker targeting. A null entry means multiple visible occurrences. */
function uniqueVisibleCharacterLayerIds(
  shot: Shot,
  evaluatedShot: EvaluatedShot,
): ReadonlyMap<string, string | null> {
  const visibleLayerIds = new Set(
    evaluatedShot.layers.filter((layer) => layer.visible).map((layer) => layer.id),
  );
  const layerIdsByCharacter = new Map<string, string | null>();
  for (const layer of shot.layers) {
    if (layer.id === shot.backgroundLayerId || layer.source.kind !== 'character' ||
      !visibleLayerIds.has(layer.id)) continue;
    const { characterId } = layer.source;
    layerIdsByCharacter.set(characterId, layerIdsByCharacter.has(characterId) ? null : layer.id);
  }
  return layerIdsByCharacter;
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
  dialogueSilence?: DialogueSilence,
): EvaluatedShot {
  const dialogue = activeDialogueId
    ? shot.dialogues.find((candidate) => candidate.id === activeDialogueId)
    : undefined;
  const audioClip = dialogue?.audioClipId
    ? shot.audioClips.find((candidate) => candidate.id === dialogue.audioClipId)
    : undefined;
  const audioAsset = audioClip
    ? project.assets.find((candidate) => candidate.id === audioClip.assetId)
    : undefined;
  const speakingCharacter =
    dialogue && audioClip && audioAsset?.kind === 'audio'
      ? project.characters.find((candidate) => candidate.id === dialogue.characterId)
      : undefined;
  const dialogueOpenPhase = Boolean(
    audioClip &&
      evaluatedShot.timeMs >= audioClip.startMs &&
      evaluatedShot.timeMs < audioClip.endMs &&
      (evaluatedShot.timeMs - audioClip.startMs) % MOUTH_FLAP_PERIOD_MS <
        MOUTH_OPEN_MS &&
      speakingCharacter &&
      (speakingCharacter.mode !== 'adaptive-parts' ||
        Boolean(speakingCharacter.faceBinding)) &&
      (speakingCharacter.mouthOpenAssetId ||
        speakingCharacter.mouthOpenVisualSource),
  );
  const hasAnyMouthCue = shot.timelineEvents.some(
    (event) => event.type === 'mouth-cue' || event.type === 'mouth-pose',
  );
  const dialoguePoseTargets = new Set(
    speakingCharacter?.mouthPoseSet?.driveMode === 'mouth-poses'
      ? shot.timelineEvents.flatMap((event) => event.type === 'mouth-pose' &&
          event.dialogueId === dialogue?.id && event.startMs <= evaluatedShot.timeMs &&
          evaluatedShot.timeMs < event.endMs ? [event.layerId] : [])
      : [],
  );
  const talkingCharacters = new Set(project.characters.filter((character) =>
    listCharacterTalkingSources(character).some(({ animationId, playback }) =>
      isCharacterTalkingSourceAvailable(project, animationId, playback))).map((character) => character.id));
  const talkingClips = new Map<string, { clip: AudioClip; silent: boolean }>();
  for (const voice of shot.dialogues) {
    if (!voice.characterId || !voice.audioClipId ||
      !talkingCharacters.has(voice.characterId)) continue;
    const clip = shot.audioClips.find((candidate) => candidate.id === voice.audioClipId);
    if (clip?.role !== 'dialogue' || !isAudioClipActiveAtTime(clip, evaluatedShot.timeMs)) continue;
    const asset = project.assets.find((candidate) => candidate.id === clip.assetId);
    if (asset?.kind !== 'audio' ||
      (asset.durationMs !== undefined && audioClipSourceTimeMs(clip, evaluatedShot.timeMs) >= asset.durationMs)) continue;
    const previous = talkingClips.get(voice.characterId);
    if (!previous || clip.startMs > previous.clip.startMs) {
      const analysis = dialogueSilence?.[asset.id];
      const sourceTime = audioClipSourceTimeMs(clip, evaluatedShot.timeMs);
      const silent = Boolean(analysis && analysis.sha256 === asset.sha256 &&
        analysis.intervals.some(([start, end]) => sourceTime >= start && sourceTime < end));
      talkingClips.set(voice.characterId, { clip, silent });
    }
  }
  const hasRestFrames = project.characters.some(character =>
    listCharacterTalkingSources(character).some(({ playback }) => playback?.restFrame !== undefined));
  const hasPoseRest = project.characters.some((character) => character.mouthPoseSet?.driveMode === 'mouth-poses');
  if (!dialogueOpenPhase && !hasAnyMouthCue && talkingClips.size === 0 && !hasRestFrames && !hasPoseRest) return evaluatedShot;
  const talkingTargets = talkingClips.size > 0 || hasRestFrames
    ? uniqueVisibleCharacterLayerIds(shot, evaluatedShot)
    : null;

  let changed = false;
  const layers = evaluatedShot.layers.map((layer): EvaluatedLayer => {
    const shotLayer = shot.layers.find((candidate) => candidate.id === layer.id);
    if (!shotLayer || shotLayer.source.kind !== 'character') return layer;

    const cue = resolveEffectiveMouthCue(shot, layer.id, evaluatedShot.timeMs);
    const layerCharacterId = shotLayer.source.characterId;
    const layerCharacter = project.characters.find(
      (candidate) => candidate.id === layerCharacterId,
    );
    const poseSet = layerCharacter?.mouthPoseSet;
    const poseEvent = poseSet ? resolveMouthPoseEvent(shot, layer.id, evaluatedShot.timeMs) : undefined;
    const pose = poseEvent && (poseEvent.origin === 'manual' || (poseSet?.driveMode === 'mouth-poses' && cue === 'none'))
      ? poseSet?.poses.find((candidate) => candidate.id === poseEvent.poseId) : undefined;
    if (pose) {
      changed = true;
      return { ...layer, mouthPose: pose };
    }
    const restPose = cue === 'none' && poseSet?.driveMode === 'mouth-poses'
      ? poseSet.poses.find((candidate) => candidate.id === poseSet.restPoseId) : undefined;
    if (
      !layerCharacter ||
      (layerCharacter.mode === 'adaptive-parts' && !layerCharacter.faceBinding)
    ) {
      if (restPose?.target.kind === 'mouth') {
        changed = true;
        return { ...layer, mouthPose: restPose };
      }
      return layer;
    }

    const expressionId = layer.currentExpressionId ?? layerCharacter.defaultExpressionId;
    const talking = talkingClips.get(layerCharacterId);
    const dedicated = expressionId ? layerCharacter.expressionTalkingSources?.[expressionId] : undefined;
    const hasTalkingSource = Boolean(layerCharacter.talkingAnimationId ||
      (dedicated && isCharacterTalkingSourceAvailable(project, dedicated.animationId, dedicated.playback)));
    const hasRestFrame = () => resolveCharacterTalkingFace(project, layerCharacter, expressionId, 'rest') !== null;
    if (cue === 'rest') {
      if (hasRestFrame()) {
        changed = true;
        return { ...layer, talkingAnimationElapsedMs: 'rest' };
      }
      if (layer.mouthOverrideAssetId !== null || layer.mouthOpen) {
        const exprId =
          layer.currentExpressionId ?? layerCharacter.defaultExpressionId;
        const expression = (layerCharacter.expressions ?? []).find(
          (candidate) => candidate.id === exprId,
        );
        const restored = { ...layer };
        delete restored.mouthOpen;
        changed = true;
        return {
          ...restored,
          assetId:
            expression?.assetId ??
            (layerCharacter.mode === 'adaptive-parts' ? '' : layer.assetId),
          mouthOverrideAssetId: null,
        };
      }
      return layer;
    }

    if (cue === 'none' && talkingTargets?.get(layerCharacterId) === layer.id) {
      if (talking && !talking.silent && hasTalkingSource) {
        changed = true;
        return { ...layer, talkingAnimationElapsedMs: evaluatedShot.timeMs - talking.clip.startMs };
      }
      if (hasRestFrame()) {
        changed = true;
        return { ...layer, talkingAnimationElapsedMs: 'rest' };
      }
    }

    const shouldOpenFromCue = cue === 'open';
    const shouldOpenFromDialogue =
      cue === 'none' &&
      dialogueOpenPhase &&
      !hasTalkingSource &&
      layerCharacterId === dialogue?.characterId &&
      (dialoguePoseTargets.size === 0 || dialoguePoseTargets.has(layer.id));
    if (!shouldOpenFromCue && !shouldOpenFromDialogue) {
      if (restPose) {
        changed = true;
        return { ...layer, mouthPose: restPose };
      }
      return layer;
    }

    if (shouldOpenFromDialogue && restPose?.target.kind === 'mouth') {
      const openPose = poseSet?.poses.find(({ id }) => id === poseSet.analyzerMapping.open);
      changed = true;
      return { ...layer, mouthPose: openPose?.target.kind === 'mouth' ? openPose : restPose };
    }

    if (
      !layerCharacter.mouthOpenAssetId &&
      !layerCharacter.mouthOpenVisualSource
    ) {
      return layer;
    }
    const mouthAsset = layerCharacter.mouthOpenAssetId
      ? project.assets.find(
          (candidate) => candidate.id === layerCharacter.mouthOpenAssetId,
        )
      : undefined;
    if (!layerCharacter.mouthOpenVisualSource && mouthAsset?.kind !== 'image') {
      return layer;
    }
    if (
      (layerCharacter.mouthOpenVisualSource
        ? layer.mouthOpen
        : layer.assetId === mouthAsset?.id) &&
      layer.mouthOverrideAssetId === (mouthAsset?.id ?? null)
    ) {
      return layer;
    }
    changed = true;
    return {
      ...layer,
      assetId: mouthAsset?.id ?? layer.assetId,
      mouthOverrideAssetId: mouthAsset?.id ?? null,
      ...(layerCharacter.mouthOpenVisualSource ? { mouthOpen: true } : {}),
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

  if (!dialogue.characterId) return neutralShot;
  const targetLayerId = uniqueVisibleCharacterLayerIds(shot, neutralShot).get(dialogue.characterId);
  if (!targetLayerId) return neutralShot;
  const character = project.characters.find(
    (candidate) => candidate.id === dialogue.characterId,
  );
  const supportsHeadMotion =
    (character?.mode === 'composite' && Boolean(character.head)) ||
    (character?.mode === 'adaptive-parts' &&
      Boolean(character.headMotionBinding?.partIds.length));
  if (!character || !supportsHeadMotion) {
    return neutralShot;
  }

  const transform = resolveTalkingHeadMotionTransform(
    neutralShot.timeMs - dialogue.startMs,
    dialogue.endMs - dialogue.startMs,
    character.talkingHeadMotionIntensityPercent ?? 100,
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
      layer.id === targetLayerId
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
  dialogueSilence?: DialogueSilence,
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
    dialogueSilence,
  );
  return projectShotHeadMotion(
    project,
    shot,
    withMouth,
    activeDialogueId,
  );
}
