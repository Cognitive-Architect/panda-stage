import { describe, expect, it } from 'vitest';
import { ProjectSchema, migrateProject } from '../../src/domain';
import {
  buildCharacterAssemblyPreviewVisual,
  getAssemblyPreviewExpressions,
  isCharacterAssemblyPending,
} from '../../src/renderer/features/characters/characterAssemblyPreview';
import type { CharacterAssemblySnapshot } from '../../src/renderer/stores/characterAssemblySessionStore';
import exampleProject from '../../demo-project/project-v1.example.json';

function fixture(): {
  project: ReturnType<typeof migrateProject>;
  session: CharacterAssemblySnapshot;
} {
  const base = migrateProject(exampleProject);
  const original = base.characters[0]!;
  const imageAssets = base.assets.filter(
    (asset) => asset.kind === 'image',
  );
  const body = imageAssets[0]!;
  const face = original.expressions[0]!;
  const mouth = imageAssets.find((asset) => asset.id !== face.assetId)!;
  const placement = { offsetX: 48, offsetY: -24, scale: 0.75 };
  const project = ProjectSchema.parse({
    ...base,
    characters: [
      {
        ...original,
        mode: 'composite' as const,
        bodyAssetId: body.id,
        facePlacement: placement,
        mouthOpenAssetId: mouth.id,
      },
    ],
  });
  const character = project.characters[0]!;
  if (character.mode !== 'composite') {
    throw new Error('Expected composite fixture.');
  }
  return {
    project,
    session: {
      status: 'active',
      sessionId: 609,
      generation: 0,
      projectId: project.id,
      projectRoot: 'D:\\PandaStage-Acceptance\\issue609.pandastage',
      characterId: character.id,
      draft: {
        bodyAssetId: character.bodyAssetId,
        facePlacement: { ...placement },
        expressionAssets: character.expressions.map((expression) => ({
          expressionId: expression.id,
          assetId: expression.assetId,
        })),
        mouthOpenAssetId: character.mouthOpenAssetId ?? null,
      },
    },
  };
}

describe('S07 composite assembly preview', () => {
  it('uses S03 Body/Face local geometry and previews Mouth as a Face replacement', () => {
    const { project, session } = fixture();
    const expressions = getAssemblyPreviewExpressions(project, session);
    const faceExpression = expressions.find(
      (expression) =>
        expression.id ===
        project.characters[0]!.defaultExpressionId,
    )!;
    const visual = buildCharacterAssemblyPreviewVisual(project, session, {
      kind: 'expression',
      expressionId: faceExpression.id,
    });
    const bodyPart = visual?.parts.find((part) => part.slot === 'body');
    const facePart = visual?.parts.find((part) => part.slot === 'face');
    const bodyAsset = project.assets.find(
      (asset) => asset.id === session.draft.bodyAssetId,
    )!;
    const faceAsset = project.assets.find(
      (asset) => asset.id === faceExpression.assetId,
    )!;
    if (bodyAsset.kind !== 'image' || faceAsset.kind !== 'image') {
      throw new Error('Expected image assets in the assembly fixture.');
    }

    expect(bodyPart?.localRect).toEqual({
      x: -bodyAsset.width / 2,
      y: -bodyAsset.height / 2,
      width: bodyAsset.width,
      height: bodyAsset.height,
    });
    expect(facePart?.localRect).toEqual({
      x:
        session.draft.facePlacement.offsetX -
        (faceAsset.width * session.draft.facePlacement.scale) / 2,
      y:
        session.draft.facePlacement.offsetY -
        (faceAsset.height * session.draft.facePlacement.scale) / 2,
      width: faceAsset.width * session.draft.facePlacement.scale,
      height: faceAsset.height * session.draft.facePlacement.scale,
    });

    const mouthVisual = buildCharacterAssemblyPreviewVisual(project, session, {
      kind: 'mouth',
    });
    expect(mouthVisual?.parts.map(({ slot }) => slot)).toEqual([
      'body',
      'face',
    ]);
    expect(mouthVisual?.parts[1]?.assetId).toBe(
      session.draft.mouthOpenAssetId,
    );
  });

  it('reports pending only when the edit draft differs from the persisted definition', () => {
    const { project, session } = fixture();
    expect(isCharacterAssemblyPending(project, session)).toBe(false);
    expect(
      isCharacterAssemblyPending(project, {
        ...session,
        draft: {
          ...session.draft,
          facePlacement: { ...session.draft.facePlacement, offsetX: 80 },
        },
      }),
    ).toBe(true);
  });
});
