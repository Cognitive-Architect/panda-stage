import {
  resolveLayerVisualParts,
  type Character,
  type EvaluatedLayer,
  type Layer,
  type LayerVisualParts,
  type Project,
} from '../../../domain';
import type {
  CharacterAssemblySnapshot,
  CharacterCreationSnapshot,
} from '../../stores/characterAssemblySessionStore';

export type CharacterAssemblySnapshotUnion =
  | CharacterAssemblySnapshot
  | CharacterCreationSnapshot;

export type AssemblyFaceSelection =
  | { kind: 'expression'; expressionId: string }
  | { kind: 'mouth' };

export function isCharacterCreationSnapshot(
  session: CharacterAssemblySnapshotUnion,
): session is CharacterCreationSnapshot {
  return 'kind' in session && session.kind === 'create';
}

export interface AssemblyPreviewExpression {
  id: string;
  name: string;
  assetId: string;
}

export function isCharacterAssemblyPending(
  project: Project,
  session: CharacterAssemblySnapshotUnion,
): boolean {
  if (isCharacterCreationSnapshot(session)) return false;
  const character = project.characters.find(
    (candidate) => candidate.id === session.characterId,
  );
  if (!character || character.mode !== 'composite') return true;
  const current = {
    bodyAssetId: character.bodyAssetId,
    facePlacement: character.facePlacement,
    expressionAssets: character.expressions.map((expression) => ({
      expressionId: expression.id,
      assetId: expression.assetId,
    })),
    mouthOpenAssetId: character.mouthOpenAssetId ?? null,
  };
  return JSON.stringify(current) !== JSON.stringify(session.draft);
}

const PREVIEW_CHARACTER_ID = '00000000-0000-4000-8000-000000000609';
const PREVIEW_LAYER_ID = '00000000-0000-4000-8000-000000000610';
const PREVIEW_VOICE_ID = '00000000-0000-4000-8000-000000000611';

export function getAssemblyPreviewExpressions(
  project: Project,
  session: CharacterAssemblySnapshotUnion,
): AssemblyPreviewExpression[] {
  if (isCharacterCreationSnapshot(session)) {
    return session.draft.expressions.map((expression, index) => ({
      id: `assembly-create-expression-${index}`,
      name: expression.name,
      assetId: expression.assetId,
    }));
  }

  const character = project.characters.find(
    (candidate) => candidate.id === session.characterId,
  );
  if (!character || character.mode !== 'composite') return [];
  const assets = new Map(
    session.draft.expressionAssets.map((expression) => [
      expression.expressionId,
      expression.assetId,
    ]),
  );
  return character.expressions.map((expression) => ({
    id: expression.id,
    name: expression.name,
    assetId: assets.get(expression.id) ?? expression.assetId,
  }));
}

function previewCharacter(
  project: Project,
  session: CharacterAssemblySnapshotUnion,
): Character | null {
  if (isCharacterCreationSnapshot(session)) {
    const expressions = session.draft.expressions.map((expression, index) => ({
      id: `assembly-create-expression-${index}`,
      name: expression.name,
      assetId: expression.assetId,
    }));
    const defaultIndex = Math.min(
      Math.max(0, session.draft.defaultExpressionIndex ?? 0),
      expressions.length - 1,
    );
    const defaultExpression = expressions[defaultIndex];
    if (!defaultExpression) return null;
    return {
      id: PREVIEW_CHARACTER_ID,
      name: session.draft.name,
      mode: 'composite',
      baseAssetId: defaultExpression.assetId,
      defaultVoiceProfileId: PREVIEW_VOICE_ID,
      expressions,
      defaultExpressionId: defaultExpression.id,
      ...(session.draft.mouthOpenAssetId
        ? { mouthOpenAssetId: session.draft.mouthOpenAssetId }
        : {}),
      defaultScale: session.draft.defaultScale ?? 1,
      defaultFlipX: session.draft.defaultFlipX ?? false,
      bodyAssetId: session.draft.bodyAssetId,
      facePlacement: { ...session.draft.facePlacement },
    };
  }

  const existing = project.characters.find(
    (candidate) => candidate.id === session.characterId,
  );
  if (!existing || existing.mode !== 'composite') return null;
  const assets = new Map(
    session.draft.expressionAssets.map((expression) => [
      expression.expressionId,
      expression.assetId,
    ]),
  );
  const expressions = existing.expressions.map((expression) => ({
    ...expression,
    assetId: assets.get(expression.id) ?? expression.assetId,
  }));
  const defaultExpression =
    expressions.find(
      (expression) => expression.id === existing.defaultExpressionId,
    ) ?? expressions[0];
  if (!defaultExpression) return null;
  const baseCharacter = { ...existing };
  delete baseCharacter.mouthOpenAssetId;
  return {
    ...baseCharacter,
    baseAssetId: defaultExpression.assetId,
    expressions,
    bodyAssetId: session.draft.bodyAssetId,
    facePlacement: { ...session.draft.facePlacement },
    ...(session.draft.mouthOpenAssetId
      ? { mouthOpenAssetId: session.draft.mouthOpenAssetId }
      : {}),
  };
}

/**
 * Build the temporary workbench visual through S03's authoritative part
 * resolver. The synthetic Character/Layer never enter Project or History.
 */
export function buildCharacterAssemblyPreviewVisual(
  project: Project,
  session: CharacterAssemblySnapshotUnion,
  selection: AssemblyFaceSelection,
): LayerVisualParts | null {
  const character = previewCharacter(project, session);
  if (!character || character.mode !== 'composite') return null;
  const expressions = character.expressions;
  const defaultExpression =
    expressions.find(
      (expression) => expression.id === character.defaultExpressionId,
    ) ?? expressions[0];
  if (!defaultExpression) return null;

  const selectedExpression =
    selection.kind === 'expression'
      ? expressions.find(
          (expression) => expression.id === selection.expressionId,
        )
      : undefined;
  const expression = selectedExpression ?? defaultExpression;
  const mouthAssetId =
    selection.kind === 'mouth' ? character.mouthOpenAssetId : undefined;
  const activeAssetId = mouthAssetId ?? expression.assetId;
  const requiredAssets = [character.bodyAssetId, activeAssetId];
  if (
    requiredAssets.some(
      (assetId) =>
        !project.assets.some(
          (asset) => asset.id === assetId && asset.kind === 'image',
        ),
    )
  ) {
    return null;
  }

  const previewProject: Project = {
    ...project,
    characters: [
      ...project.characters.filter(
        (candidate) => candidate.id !== character.id,
      ),
      character,
    ],
  };
  const layer: Layer = {
    id: PREVIEW_LAYER_ID,
    name: '临时装配预览',
    source: {
      kind: 'character',
      characterId: character.id,
      expressionId: expression.id,
    },
    anchor: 'center',
    x: project.width / 2,
    y: project.height / 2,
    scaleX: 1,
    scaleY: 1,
    flipX: false,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    zIndex: 0,
    locked: false,
  };
  const evaluated: EvaluatedLayer = {
    id: layer.id,
    assetId: activeAssetId,
    currentExpressionId: expression.id,
    mouthOverrideAssetId: mouthAssetId ?? null,
    anchor: layer.anchor,
    x: layer.x,
    y: layer.y,
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
    flipX: layer.flipX,
    rotationDeg: layer.rotationDeg,
    opacity: layer.opacity,
    visible: layer.visible,
    zIndex: layer.zIndex,
  };
  return resolveLayerVisualParts(previewProject, { layers: [layer] }, evaluated);
}
