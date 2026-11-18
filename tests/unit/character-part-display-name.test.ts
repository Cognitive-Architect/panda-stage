import { describe, expect, it } from 'vitest';
import { createCharacterPartAnimationClip } from '../../src/domain';
import { characterMotionParts } from '../../src/renderer/features/canvas/characterMotionContext';
import { localizeDefaultAdaptivePartName } from '../../src/renderer/features/characters/characterPartDisplayName';
import { characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';

describe('adaptive Part display names', () => {
  it('localizes only the generated Part N default labels', () => {
    expect(localizeDefaultAdaptivePartName('Part 1')).toBe('零件 1');
    expect(localizeDefaultAdaptivePartName('Part 5')).toBe('零件 5');
    expect(localizeDefaultAdaptivePartName('Hair')).toBe('Hair');
    expect(localizeDefaultAdaptivePartName('Part 1 (2)')).toBe('Part 1 (2)');
    expect(localizeDefaultAdaptivePartName('part 1')).toBe('part 1');
  });

  it.each([
    { names: ['Part 5', 'Graphic'], expected: ['零件 5', '部件 2'] },
    { names: ['Image', '右手'], expected: ['部件 1', '右手'] },
    { names: ['graphic', 'Image Detail'], expected: ['部件 1', 'Image Detail'] },
  ])('projects $names to $expected in Character Motion', ({ names, expected }) => {
    const { project, layerId } = characterPartAnimationFixture();
    const character = project.characters.find((entry) => entry.mode === 'adaptive-parts')!;
    character.parts.forEach((part, index) => { part.displayName = names[index]; });
    const shot = project.shots[0]!;
    const layer = shot.layers.find(({ id }) => id === layerId)!;
    const clip = createCharacterPartAnimationClip(project, shot.id, layerId);

    expect(characterMotionParts(project, layer).map(({ name }) => name)).toEqual(expected);
    expect(characterMotionParts(project, { ...layer, animationClip: clip }).map(({ name }) => name)).toEqual(expected);
    expect(character.parts.map(({ displayName }) => displayName)).toEqual(names);
    expect(clip.targetBases.map(({ displayName }) => displayName)).toEqual(names);
  });
});
