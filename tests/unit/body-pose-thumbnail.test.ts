import { expect, it } from 'vitest';
import { resolveLayerVisualParts, saveCharacterBodyPose, type AdaptivePartsCharacter } from '../../src/domain';
import { createBodyPoseThumbnailScene, evaluateBodyPoseThumbnail } from '../../src/renderer/features/properties/bodyPoseThumbnailScene';
import { animationCoreFixture } from '../helpers/animationCoreFixture';
import { IDS } from './domain/testProject';

it('projects stored poses through the shared renderer in a clean character scene', () => {
  const fixture = animationCoreFixture();
  const partId = fixture.clip.targetBases[0]!.target.partId;
  const project = ['Stand', 'Point', 'Hands on hips'].reduce((current, name, index) => saveCharacterBodyPose(
    current, { shotId: IDS.shot, layerId: fixture.layerId, timeMs: index * 500 }, name, [partId],
  ), fixture.project);
  const character = project.characters.at(-1)! as AdaptivePartsCharacter;
  const shot = project.shots[0]!;
  const scene = createBodyPoseThumbnailScene(project, shot, fixture.layerId, character)!;
  expect(scene.shot.layers).toHaveLength(1);
  expect(scene.shot.timelineEvents).toEqual([]);
  expect(scene.shot.dialogues).toEqual([]);
  expect(scene.shot.backgroundLayerId).toBeNull();
  expect(scene.shot.layers[0]).toMatchObject({ x: 0, y: 0, scaleX: 1, flipX: false, source: { characterId: character.id } });
  const transformations = character.bodyPoses!.map((pose) => {
    const sample = evaluateBodyPoseThumbnail(scene, pose)!;
    const layer = sample.evaluated.layers[0]!;
    expect(layer.mouthOpen).toBeUndefined();
    return resolveLayerVisualParts(sample.project, sample.project.shots[0]!, layer).parts[0]!.imageTransform;
  });
  expect(new Set(transformations.map((entry) => JSON.stringify(entry))).size).toBe(3);

  const pose = character.bodyPoses![0]!;
  expect(evaluateBodyPoseThumbnail(scene, { ...pose, parts: [{ ...pose.parts[0]!, partId: IDS.character }] })).toBeNull();
  expect(character.bodyPoses?.map(({ name }) => name)).toEqual(['Stand', 'Point', 'Hands on hips']);

  const movedShot = { ...shot, name: 'New shot name', layers: shot.layers.map((layer) => ({ ...layer, x: layer.x + 10 })) };
  expect(createBodyPoseThumbnailScene(project, movedShot, fixture.layerId, character)?.appearanceKey).toBe(scene.appearanceKey);
  const asset = scene.assets[0]!;
  const changed = { ...project, assets: project.assets.map((entry) =>
    entry.id === asset.id ? { ...entry, sha256: 'f'.repeat(64) } : entry) };
  expect(createBodyPoseThumbnailScene(changed, shot, fixture.layerId, character)?.appearanceKey).not.toBe(scene.appearanceKey);
});
