import {
  CharacterService,
  LayerService,
  ProjectSchema,
  createCharacterPartAnimationClip,
  type AdaptivePartsCharacter,
  type CharacterBone,
  type Project,
} from '../../src/domain';
import { adaptivePartsFixture } from './adaptivePartsFixtures';
import { IDS, buildProject } from '../unit/domain/testProject';

/** Adaptive-parts fixture with horizontally spaced 640x640 image Parts. */
export function buildBoneFixture(partCount = 3) {
  const parts = adaptivePartsFixture(IDS.assetChar)
    .slice(0, partCount)
    .map((part, index) => ({
      ...part,
      restTransform: { a: 1, b: 0, c: 0, d: 1, tx: index * 120, ty: 0 },
    }));
  const created = new CharacterService().createAdaptiveParts(buildProject(), {
    name: '骨树角色',
    parts,
  });
  const character = created.characters.at(-1)!;
  const placement = new LayerService().createFromAdaptiveCharacter(
    created,
    IDS.shot,
    character.id,
    { x: 650, y: 450 },
  );
  return {
    project: placement.project,
    characterId: character.id,
    layerId: placement.layer.id,
    partIds: parts.map(({ partId }) => partId),
    shotId: IDS.shot,
  };
}

export function adaptiveCharacterOf(project: Project, characterId: string): AdaptivePartsCharacter {
  const character = project.characters.find(({ id }) => id === characterId);
  if (!character || character.mode !== 'adaptive-parts') {
    throw new Error('Expected an adaptive-parts fixture.');
  }
  return character;
}

/** Persists Bones directly through the formal Project path. */
export function withBones(
  project: Project,
  characterId: string,
  bones: readonly CharacterBone[],
): Project {
  return ProjectSchema.parse({
    ...project,
    characters: project.characters.map((character) =>
      character.id === characterId ? { ...character, bones } : character),
  });
}

/** Freezes a Character Clip v1 on the fixture Layer. */
export function withClip(project: Project, shotId: string, layerId: string): Project {
  const clip = createCharacterPartAnimationClip(project, shotId, layerId);
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((shot) => shot.id === shotId
      ? {
          ...shot,
          layers: shot.layers.map((layer) =>
            layer.id === layerId ? { ...layer, animationClip: clip } : layer),
        }
      : shot),
  });
}
