import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  calculateViewportTransform,
  DEFAULT_BODY_PLACEMENT,
  resolveLayerVisualParts,
  transformVisualRectByPart,
  type Character,
  type CharacterHead,
  type EvaluatedLayer,
  type ImageAsset,
  type Layer,
  type LayerVisualParts,
  type Project,
  type Size,
  type VisualLocalRect,
  type ViewportTransform,
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
  rotationDeg: number;
  flipX: boolean;
}

export interface NormalizedImageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AssemblyViewportRect = VisualLocalRect;

export interface CharacterLocalPointerDelta {
  x: number;
  y: number;
}

export function parseAssemblyRotationInput(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= -180 && parsed <= 180
    ? parsed
    : null;
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

function isFiniteRect(rect: VisualLocalRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0
    && rect.height > 0;
}

export function visibleImageRect(
  rect: VisualLocalRect,
  bounds: NormalizedImageBounds | null | undefined,
): VisualLocalRect {
  if (
    !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x + bounds.width > 1.000001 ||
    bounds.y + bounds.height > 1.000001
  ) {
    return rect;
  }
  return {
    x: rect.x + rect.width * bounds.x,
    y: rect.y + rect.height * bounds.y,
    width: rect.width * bounds.width,
    height: rect.height * bounds.height,
  };
}

function unionVisibleRects(rects: readonly VisualLocalRect[]): VisualLocalRect | null {
  const valid = rects.filter(isFiniteRect);
  if (valid.length === 0) return null;
  const left = Math.min(...valid.map((rect) => rect.x));
  const top = Math.min(...valid.map((rect) => rect.y));
  const right = Math.max(...valid.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...valid.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Measures the current assembly selection in character-local coordinates.
 * Decoded alpha bounds are used where available; unavailable or unreadable
 * pixels fall back to the source rectangle recorded by the image asset.
 */
export function calculateAssemblyVisibleBounds(
  visual: CharacterAssemblyPreviewVisual | null,
  imageBoundsByAssetId: ReadonlyMap<string, NormalizedImageBounds | null>,
): VisualLocalRect | null {
  if (!visual) return null;
  const rects = visual.parts.map((part) =>
    transformVisualRectByPart(
      visibleImageRect(
        part.localRect,
        imageBoundsByAssetId.get(part.assetId),
      ),
      part,
    ),
  );
  if (visual.headPart) {
    const part = visual.headPart;
    rects.push(
      transformVisualRectByPart(
        visibleImageRect(
          part.localRect,
          imageBoundsByAssetId.get(part.assetId),
        ),
        part,
      ),
    );
  }
  return unionVisibleRects(rects);
}

export function assemblyBoundsExceedFrame(
  bounds: VisualLocalRect | null,
  frame: Size,
): boolean {
  if (!bounds || !isFiniteRect(bounds)) return false;
  return (
    bounds.x < -frame.width / 2 ||
    bounds.y < -frame.height / 2 ||
    bounds.x + bounds.width > frame.width / 2 ||
    bounds.y + bounds.height > frame.height / 2
  );
}

/**
 * Returns the largest rectangle left uncovered by overlay panels, measured
 * from the viewport's content origin.
 */
export function largestUnoccludedAssemblyViewportRect(
  container: Size,
  occlusions: readonly AssemblyViewportRect[],
): AssemblyViewportRect {
  const width = Number.isFinite(container.width) ? Math.max(0, container.width) : 0;
  const height = Number.isFinite(container.height) ? Math.max(0, container.height) : 0;
  let regions: AssemblyViewportRect[] = width > 0 && height > 0
    ? [{ x: 0, y: 0, width, height }]
    : [];

  for (const occlusion of occlusions) {
    if (!isFiniteRect(occlusion)) continue;
    const remaining: AssemblyViewportRect[] = [];
    for (const region of regions) {
      const left = Math.max(region.x, occlusion.x);
      const top = Math.max(region.y, occlusion.y);
      const right = Math.min(region.x + region.width, occlusion.x + occlusion.width);
      const bottom = Math.min(region.y + region.height, occlusion.y + occlusion.height);
      if (right <= left || bottom <= top) {
        remaining.push(region);
        continue;
      }
      const candidates: AssemblyViewportRect[] = [
        { x: region.x, y: region.y, width: left - region.x, height: region.height },
        { x: right, y: region.y, width: region.x + region.width - right, height: region.height },
        { x: region.x, y: region.y, width: region.width, height: top - region.y },
        { x: region.x, y: bottom, width: region.width, height: region.y + region.height - bottom },
      ];
      remaining.push(...candidates.filter(isFiniteRect));
    }
    regions = remaining;
    if (regions.length === 0) break;
  }

  return regions.sort(
    (left, right) => right.width * right.height - left.width * left.height,
  )[0] ?? { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * Fits character-local content into the unoccluded portion of the Assembly
 * viewport without changing the formal Project frame or any placement data.
 */
export function calculateAssemblyFitViewportTransform(
  container: Size,
  logicalFrame: Size,
  bounds: VisualLocalRect | null,
  availableArea: AssemblyViewportRect,
  padding = 24,
): ViewportTransform {
  const fallback = calculateViewportTransform(container, 'fit', logicalFrame);
  if (!bounds || !isFiniteRect(bounds) || !isFiniteRect(availableArea)) {
    return fallback;
  }
  const inset = Number.isFinite(padding) ? Math.max(0, padding) : 24;
  const fitWidth = availableArea.width - inset * 2;
  const fitHeight = availableArea.height - inset * 2;
  if (!(fitWidth > 0 && fitHeight > 0)) return fallback;

  const scale = Math.min(
    fitWidth / bounds.width,
    fitHeight / bounds.height,
    Math.max(1, fallback.scale),
  );
  if (!(Number.isFinite(scale) && scale > 0)) return fallback;

  const displayWidth = logicalFrame.width * scale;
  const displayHeight = logicalFrame.height * scale;
  return {
    mode: 'fit',
    container: {
      width: Number.isFinite(container.width) ? Math.max(0, container.width) : 0,
      height: Number.isFinite(container.height) ? Math.max(0, container.height) : 0,
    },
    logical: { ...logicalFrame },
    scale,
    offsetX:
      availableArea.x +
      (availableArea.width - bounds.width * scale) / 2 -
      (logicalFrame.width / 2 + bounds.x) * scale,
    offsetY:
      availableArea.y +
      (availableArea.height - bounds.height * scale) / 2 -
      (logicalFrame.height / 2 + bounds.y) * scale,
    displayWidth,
    displayHeight,
    contentWidth: Math.max(fallback.container.width, displayWidth),
    contentHeight: Math.max(fallback.container.height, displayHeight),
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

export function characterPartScaleFromPointerDistance(
  startScale: number,
  startDistance: number,
  currentDistance: number,
): number {
  const safeStartScale = Number.isFinite(startScale) && startScale > 0
    ? startScale
    : 1;
  if (
    !Number.isFinite(startDistance) ||
    !Number.isFinite(currentDistance) ||
    startDistance <= 0 ||
    currentDistance < 0
  ) {
    return Math.min(
      CHARACTER_PART_MAX_SCALE,
      Math.max(CHARACTER_PART_MIN_SCALE, safeStartScale),
    );
  }
  const nextScale = safeStartScale * (currentDistance / startDistance);
  if (!Number.isFinite(nextScale)) return CHARACTER_PART_MAX_SCALE;
  return Math.min(
    CHARACTER_PART_MAX_SCALE,
    Math.max(CHARACTER_PART_MIN_SCALE, nextScale),
  );
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
    bodyPlacement: character.bodyPlacement,
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
      talkingHeadMotionIntensityPercent: 100,
      ...(session.draft.mouthOpenAssetId
        ? { mouthOpenAssetId: session.draft.mouthOpenAssetId }
        : {}),
      defaultScale: session.draft.defaultScale ?? 1,
      defaultFlipX: session.draft.defaultFlipX ?? false,
      bodyAssetId: session.draft.bodyAssetId,
      bodyPlacement: { ...(session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT) },
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
    bodyPlacement: { ...session.draft.bodyPlacement },
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

function withoutHeadForAssemblyBaseVisual(character: Character): Character {
  if (character.mode !== 'composite' || !character.head) return character;
  const baseVisualCharacter = { ...character };
  delete baseVisualCharacter.head;
  return baseVisualCharacter;
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
      // The H02 workbench still renders its draft Head through its existing
      // assembly-only Head Group; keep the resolver here scoped to Body and
      // Face so that assembly layer cannot draw Head twice.
      withoutHeadForAssemblyBaseVisual(character),
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
            rotationDeg: character.head.placement.rotationDeg,
            flipX: character.head.placement.flipX,
          }
        : null,
  };
}
