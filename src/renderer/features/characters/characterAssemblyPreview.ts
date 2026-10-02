import {
  resolveLayerVisualParts,
  type Character,
  type CharacterHead,
  type EvaluatedLayer,
  type ImageAsset,
  type Layer,
  type LayerVisualParts,
  type Project,
  type VisualLocalRect,
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

export interface AssemblyHeadMotionTestToken {
  sessionId: number;
  generation: number;
}

export interface AssemblyHeadPreviewPart {
  assetId: string;
  localRect: VisualLocalRect;
}

export interface NormalizedImageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CharacterLocalPointerDelta {
  x: number;
  y: number;
}

export interface CharacterAssemblyPreviewVisual extends LayerVisualParts {
  /** Assembly-only visual; it never enters the production Stage resolver. */
  headPart: AssemblyHeadPreviewPart | null;
}

export function isAssemblyHeadMotionTestRunning(
  token: AssemblyHeadMotionTestToken | null,
  session: CharacterAssemblySnapshotUnion,
): boolean {
  return Boolean(
    token &&
      session.draft.head &&
      token.sessionId === session.sessionId &&
      token.generation === session.generation,
  );
}

export function findVisibleImageBounds(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  alphaThreshold = 8,
): NormalizedImageBounds | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    rgba.length < width * height * 4
  ) {
    return null;
  }

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3]! < alphaThreshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) return null;
  return {
    x: left / width,
    y: top / height,
    width: (right - left + 1) / width,
    height: (bottom - top + 1) / height,
  };
}

export function characterLocalPointerDelta(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  viewportScale: number,
): CharacterLocalPointerDelta {
  const safeScale = Number.isFinite(viewportScale)
    ? Math.max(viewportScale, 0.0001)
    : 0.0001;
  return {
    x: (currentX - startX) / safeScale,
    y: (currentY - startY) / safeScale,
  };
}

export function headScaleFromPointerDistance(
  startScale: number,
  startDistance: number,
  currentDistance: number,
): number {
  if (
    !Number.isFinite(startScale) ||
    !Number.isFinite(startDistance) ||
    !Number.isFinite(currentDistance) ||
    startScale <= 0 ||
    startDistance <= 0 ||
    currentDistance < 0
  ) {
    return Math.max(0.05, Number.isFinite(startScale) ? startScale : 1);
  }
  return Math.max(0.05, startScale * (currentDistance / startDistance));
}

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
    ...(character.head ? { head: character.head } : {}),
    expressionAssets: character.expressions.map((expression) => ({
      expressionId: expression.id,
      assetId: expression.assetId,
    })),
    mouthOpenAssetId: character.mouthOpenAssetId ?? null,
  };
  return JSON.stringify(current) !== JSON.stringify(session.draft);
}

export function hasPendingCharacterAssemblyEdit(
  project: Project,
  session: CharacterAssemblySnapshotUnion | null,
): boolean {
  return Boolean(
    session &&
      !isCharacterCreationSnapshot(session) &&
      session.projectId === project.id &&
      isCharacterAssemblyPending(project, session),
  );
}

/** One product-level decision for every route that exits the assembly context. */
export const ASSEMBLY_DISCARD_CONFIRM_MESSAGE =
  '组装更改尚未应用，离开将放弃这些更改。继续吗？';

export type AssemblyExitDecision = 'leave' | 'stay';

/**
 * Unifies the dirty-exit contract: a clean assembly leaves immediately, a
 * dirty one leaves only on an explicit discard confirmation and otherwise
 * keeps the draft and the workspace exactly where they are.
 */
export function resolveAssemblyExitDecision(
  pending: boolean,
  confirmed: boolean,
): AssemblyExitDecision {
  return !pending || confirmed ? 'leave' : 'stay';
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
      ...(session.draft.head
        ? {
            head: {
              assetId: session.draft.head.assetId,
              placement: { ...session.draft.head.placement },
              pivot: { ...session.draft.head.pivot },
            },
          }
        : {}),
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
  delete baseCharacter.head;
  return {
    ...baseCharacter,
    baseAssetId: defaultExpression.assetId,
    expressions,
    bodyAssetId: session.draft.bodyAssetId,
    facePlacement: { ...session.draft.facePlacement },
    ...(session.draft.head
      ? {
          head: {
            assetId: session.draft.head.assetId,
            placement: { ...session.draft.head.placement },
            pivot: { ...session.draft.head.pivot },
          },
        }
      : {}),
    ...(session.draft.mouthOpenAssetId
      ? { mouthOpenAssetId: session.draft.mouthOpenAssetId }
      : {}),
  };
}

function centeredHeadRect(
  asset: ImageAsset,
  placement: CharacterHead['placement'],
): VisualLocalRect {
  const width = asset.width * placement.scale;
  const height = asset.height * placement.scale;
  return {
    x: placement.offsetX - width / 2,
    y: placement.offsetY - height / 2,
    width,
    height,
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
): CharacterAssemblyPreviewVisual | null {
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
    name: '临时组装预览',
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
  const visual = resolveLayerVisualParts(
    previewProject,
    { layers: [layer] },
    evaluated,
  );
  const headAsset = character.head
    ? project.assets.find(
        (asset): asset is ImageAsset =>
          asset.id === character.head?.assetId && asset.kind === 'image',
      )
    : undefined;
  return {
    ...visual,
    headPart:
      character.head && headAsset
        ? {
            assetId: headAsset.id,
            localRect: centeredHeadRect(headAsset, character.head.placement),
          }
        : null,
  };
}
