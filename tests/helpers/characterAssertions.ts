import type { Character, ExpressionCharacter, Project } from '../../src/domain';

/** Assert that a legacy Character fixture has the expression-based shape. */
export function asExpressionCharacter(
  character: Character | undefined,
): ExpressionCharacter {
  if (!character || character.mode === 'adaptive-parts') {
    throw new Error('Expected an expression-based Character fixture.');
  }
  return character;
}

export function firstExpressionCharacter(
  project: Pick<Project, 'characters'>,
): ExpressionCharacter {
  return asExpressionCharacter(project.characters[0]);
}
