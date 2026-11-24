import {
  captureCharacterPartAnimationBasis, characterFaceAndMouthPartIds, evaluateShotAtTime,
  resolveBodyPosePartProperties, resolveLayerVisualParts,
  type AdaptivePartsCharacter, type AnimationProperty, type CharacterBodyPose, type CharacterPartAnimationTrack,
  type ImageAsset, type Layer, type Project, type Shot,
} from '../../../domain';

export function createBodyPoseThumbnailScene(project: Project, shot: Shot, layerId: string, character: AdaptivePartsCharacter) {
  try {
    const layer: Layer = {
      id: layerId, name: character.name, source: { kind: 'character', characterId: character.id },
      anchor: 'center', x: 0, y: 0, scaleX: 1, scaleY: 1, flipX: false,
      rotationDeg: 0, opacity: 1, locked: false, visible: true, zIndex: 0,
      animationClip: captureCharacterPartAnimationBasis(project, character, layerId),
    };
    const isolated: Shot = { ...shot, layers: [layer], timelineEvents: [], dialogues: [], audioClips: [], backgroundLayerId: null };
    const evaluated = evaluateShotAtTime(isolated, 0, project);
    const visual = resolveLayerVisualParts(project, isolated, evaluated.layers[0]!, 0, undefined, { collectCandidates: false });
    const requiredIds = new Set([
      ...visual.resources.required.map(({ assetId }) => assetId),
      ...visual.parts.flatMap(({ assetId }) => assetId ? [assetId] : []),
    ]);
    const assets = project.assets.filter((asset): asset is ImageAsset => asset.kind === 'image' && requiredIds.has(asset.id));
    if (!visual.parts.length || assets.length !== requiredIds.size) return null;

    const expression = character.expressions?.find(({ id }) => id === character.defaultExpressionId);
    const appearanceKey = JSON.stringify([
      shot.id, layerId, character.id, layer.animationClip, character.faceBinding, expression, visual.parts,
      assets.map(({ id, sha256, width, height }) => [id, sha256, width, height]),
      [...characterFaceAndMouthPartIds(character)].sort(),
    ]);
    return { project, shot: isolated, character, assets, bounds: visual.combinedLocalBounds, appearanceKey };
  } catch {
    return null;
  }
}

export type BodyPoseThumbnailScene = NonNullable<ReturnType<typeof createBodyPoseThumbnailScene>>;

export function evaluateBodyPoseThumbnail(scene: BodyPoseThumbnailScene, pose: CharacterBodyPose) {
  const layer = scene.shot.layers[0]!;
  const clip = layer.animationClip;
  if (clip?.version !== 1) return null;
  const protectedParts = characterFaceAndMouthPartIds(scene.character);
  const tracks: CharacterPartAnimationTrack[] = [];
  for (const part of pose.parts) {
    const basis = clip.targetBases.find(({ target, visible }) => visible && target.partId === part.partId);
    if (!basis || protectedParts.has(part.partId)) return null;
    const properties = resolveBodyPosePartProperties(part, clip);
    for (const [property, value] of Object.entries(properties)) {
      tracks.push({ target: basis.target, property: property as AnimationProperty, keys: [{ timeMs: 0, value, interpolationToNext: 'step' }] });
    }
  }
  const shot: Shot = { ...scene.shot, layers: [{ ...layer, animationClip: { ...clip, tracks } }] };
  return { project: { ...scene.project, shots: [shot] }, evaluated: evaluateShotAtTime(shot, 0, scene.project) };
}
