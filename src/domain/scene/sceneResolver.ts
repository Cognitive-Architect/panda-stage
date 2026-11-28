import {
  isFlaGraphicDefinition,
  type Asset,
  type Character,
  type Project,
  type ProjectAnimationDefinition,
} from '../models';
import { resolveBackgroundVisualDimensions } from '../selectors/canvasLayers';

export type SceneBackgroundRef =
  | { readonly kind: 'empty' }
  | { readonly kind: 'image'; readonly assetId: string }
  | { readonly kind: 'graphic'; readonly animationId: string };

export type ScenePropRef =
  | { readonly kind: 'image'; readonly assetId: string }
  | { readonly kind: 'animation'; readonly animationId: string };

export interface SceneCharacterRef {
  readonly characterId: string;
  readonly expressionId?: string;
  readonly mode: Character['mode'];
}

export interface SceneBackgroundCandidate {
  readonly ref: Exclude<SceneBackgroundRef, { readonly kind: 'empty' }>;
  readonly id: string;
  readonly name: string;
  readonly kind: 'image' | 'graphic';
  readonly usable: boolean;
  readonly reason?: string;
}

export interface SceneCharacterCandidate {
  readonly ref: SceneCharacterRef;
  readonly characterId: string;
  readonly name: string;
  readonly mode: Character['mode'];
  readonly expressionId?: string;
  readonly expressionName?: string;
  readonly usable: boolean;
  readonly reason?: string;
}

export interface ScenePropCandidate {
  readonly ref: ScenePropRef;
  readonly id: string;
  readonly name: string;
  readonly kind: 'image' | 'animation';
  readonly usable: boolean;
  readonly reason?: string;
}

export type SceneMatchStatus =
  | 'empty'
  | 'matched'
  | 'ambiguous'
  | 'missing'
  | 'unusable'
  | 'skipped';

export function normalizeSceneResourceName(name: string): string {
  return name.trim().normalize('NFKC').toLocaleLowerCase();
}

function collectNonAdaptiveExpressionAssetIds(project: Project): Set<string> {
  return new Set(
    project.characters.flatMap((character) =>
      character.mode === 'adaptive-parts'
        ? []
        : character.expressions
            .map((expression) => expression.assetId)
            .filter((assetId): assetId is string => typeof assetId === 'string'),
    ),
  );
}

function isAnimationFramesValid(
  project: Project,
  animation: ProjectAnimationDefinition,
): { valid: boolean; reason?: string } {
  if (animation.frames.length === 0) {
    return { valid: false, reason: '动画缺少有效帧数据。' };
  }
  const nativeStructured =
    isFlaGraphicDefinition(animation) && animation.source.origin === 'native';
  if (nativeStructured) {
    // Native Definitions own editable structure instead of baked frame media.
    if (!animation.structure) {
      return { valid: false, reason: '原生元件缺少可编辑结构。' };
    }
    for (const frame of animation.frames) {
      if (!animation.structure.frames.some((candidate) => candidate.ordinal === frame.ordinal)) {
        return { valid: false, reason: '原生元件的帧缺少对应结构。' };
      }
    }
    return { valid: true };
  }
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  for (const frame of animation.frames) {
    const frameAsset = frame.assetId ? assetsById.get(frame.assetId) : undefined;
    if (
      !frameAsset ||
      frameAsset.kind !== 'image' ||
      frameAsset.sha256 !== frame.sha256
    ) {
      return { valid: false, reason: '动画引用的帧图片缺失或哈希不一致。' };
    }
  }
  return { valid: true };
}

/**
 * List all usable background candidates in the project (image assets + FLA Graphic
 * definitions that pass `resolveBackgroundVisualDimensions`).
 */
export function listUsableBackgroundCandidates(
  project: Project,
): readonly SceneBackgroundCandidate[] {
  const expressionAssetIds = collectNonAdaptiveExpressionAssetIds(project);
  const candidates: SceneBackgroundCandidate[] = [];

  for (const asset of project.assets) {
    if (asset.kind !== 'image') continue;
    if (expressionAssetIds.has(asset.id)) continue;
    const dimensions = resolveBackgroundVisualDimensions(project, {
      source: { kind: 'asset', assetId: asset.id },
    });
    candidates.push({
      ref: { kind: 'image', assetId: asset.id },
      id: asset.id,
      name: asset.name,
      kind: 'image',
      usable: dimensions !== null,
      ...(dimensions === null ? { reason: '图片尺寸无效，无法作为背景。' } : {}),
    });
  }

  for (const animation of project.animations) {
    if (!isFlaGraphicDefinition(animation)) continue;
    const framesCheck = isAnimationFramesValid(project, animation);
    const dimensions = framesCheck.valid
      ? resolveBackgroundVisualDimensions(project, {
          source: { kind: 'animation', animationId: animation.id },
          animationFirstFrame: 0,
        })
      : null;
    const usable = framesCheck.valid && dimensions !== null;
    candidates.push({
      ref: { kind: 'graphic', animationId: animation.id },
      id: animation.id,
      name: animation.name,
      kind: 'graphic',
      usable,
      ...(!usable
        ? { reason: framesCheck.reason ?? '元件无法渲染为镜头背景。' }
        : {}),
    });
  }

  return candidates;
}

/**
 * List all characters in the project with usability checks covering
 * `single-image`, `composite`, and `adaptive-parts`.
 */
export function listUsableCharacterCandidates(
  project: Project,
  requestedExpressionName?: string,
): readonly SceneCharacterCandidate[] {
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const normalizedExpr = requestedExpressionName
    ? normalizeSceneResourceName(requestedExpressionName)
    : null;

  return project.characters.map((character): SceneCharacterCandidate => {
    if (character.mode === 'adaptive-parts') {
      const expressions = character.expressions ?? [];
      const matchedExpr = normalizedExpr && character.faceBinding
        ? expressions.find(
            (expr) => normalizeSceneResourceName(expr.name) === normalizedExpr,
          )
        : undefined;
      return {
        ref: {
          characterId: character.id,
          ...(matchedExpr ? { expressionId: matchedExpr.id } : {}),
          mode: character.mode,
        },
        characterId: character.id,
        name: character.name,
        mode: character.mode,
        ...(matchedExpr
          ? { expressionId: matchedExpr.id, expressionName: matchedExpr.name }
          : {}),
        usable: !normalizedExpr || matchedExpr !== undefined,
        ...(normalizedExpr && !matchedExpr
          ? { reason: `角色「${character.name}」无法使用表情「${requestedExpressionName}」。` }
          : {}),
      };
    }

    const expressions = character.expressions;
    const matchedExpr = normalizedExpr
      ? expressions.find(
          (expr) => normalizeSceneResourceName(expr.name) === normalizedExpr,
        )
      : undefined;
    const defaultExpr =
      matchedExpr ??
      expressions.find((expr) => expr.id === character.defaultExpressionId) ??
      expressions[0];

    if (!defaultExpr) {
      return {
        ref: { characterId: character.id, mode: character.mode },
        characterId: character.id,
        name: character.name,
        mode: character.mode,
        usable: false,
        reason: `角色「${character.name}」缺少可用表情。`,
      };
    }

    const exprAsset = defaultExpr.assetId
      ? assetsById.get(defaultExpr.assetId)
      : undefined;
    const hasUsableImage = Boolean(
      defaultExpr.visualSource || (exprAsset && exprAsset.kind === 'image'),
    );
    return {
      ref: {
        characterId: character.id,
        expressionId: defaultExpr.id,
        mode: character.mode,
      },
      characterId: character.id,
      name: character.name,
      mode: character.mode,
      expressionId: defaultExpr.id,
      expressionName: defaultExpr.name,
      usable: hasUsableImage,
      ...(!hasUsableImage
        ? { reason: `角色「${character.name}」的默认表情图片不可用。` }
        : {}),
    };
  });
}

/**
 * List all usable prop candidates (standalone image assets + valid animation/Graphic
 * definitions).
 */
export function listUsablePropCandidates(
  project: Project,
): readonly ScenePropCandidate[] {
  const expressionAssetIds = collectNonAdaptiveExpressionAssetIds(project);
  const candidates: ScenePropCandidate[] = [];

  for (const asset of project.assets) {
    if (asset.kind !== 'image') continue;
    if (expressionAssetIds.has(asset.id)) continue;
    candidates.push({
      ref: { kind: 'image', assetId: asset.id },
      id: asset.id,
      name: asset.name,
      kind: 'image',
      usable: true,
    });
  }

  for (const animation of project.animations) {
    const framesCheck = isAnimationFramesValid(project, animation);
    candidates.push({
      ref: { kind: 'animation', animationId: animation.id },
      id: animation.id,
      name: animation.name,
      kind: 'animation',
      usable: framesCheck.valid,
      ...(!framesCheck.valid ? { reason: framesCheck.reason } : {}),
    });
  }

  return candidates;
}

export interface ResolvedBackgroundMatch {
  readonly queryName: string | null;
  readonly status: SceneMatchStatus;
  readonly selectedRef: SceneBackgroundRef;
  readonly selectedName: string | null;
  readonly candidates: readonly SceneBackgroundCandidate[];
  readonly manualOverride: boolean;
  readonly message?: string;
}

export function resolveBackgroundMatch(
  project: Project,
  queryName: string | null,
  override?: SceneBackgroundRef | 'skip',
): ResolvedBackgroundMatch {
  const allCandidates = listUsableBackgroundCandidates(project);
  const usableCandidates = allCandidates.filter((c) => c.usable);

  if (override === 'skip' || override?.kind === 'empty') {
    return {
      queryName,
      status: 'empty',
      selectedRef: { kind: 'empty' },
      selectedName: null,
      candidates: usableCandidates,
      manualOverride: true,
      message: '已选择使用空背景。',
    };
  }

  if (override) {
    const found = allCandidates.find((candidate) =>
      override.kind === 'image'
        ? candidate.ref.kind === 'image' && candidate.ref.assetId === override.assetId
        : candidate.ref.kind === 'graphic' && candidate.ref.animationId === override.animationId,
    );
    if (!found) {
      return {
        queryName,
        status: 'missing',
        selectedRef: { kind: 'empty' },
        selectedName: null,
        candidates: usableCandidates,
        manualOverride: true,
        message: '手动选择的背景素材已不存在，将回退为空背景。',
      };
    }
    if (!found.usable) {
      return {
        queryName,
        status: 'unusable',
        selectedRef: { kind: 'empty' },
        selectedName: found.name,
        candidates: usableCandidates,
        manualOverride: true,
        message: found.reason ?? `背景「${found.name}」不可用，将回退为空背景。`,
      };
    }
    return {
      queryName,
      status: 'matched',
      selectedRef: found.ref,
      selectedName: found.name,
      candidates: usableCandidates,
      manualOverride: true,
    };
  }

  if (!queryName) {
    return {
      queryName: null,
      status: 'empty',
      selectedRef: { kind: 'empty' },
      selectedName: null,
      candidates: usableCandidates,
      manualOverride: false,
    };
  }

  const key = normalizeSceneResourceName(queryName);
  const exact = allCandidates.filter(
    (candidate) => normalizeSceneResourceName(candidate.name) === key,
  );
  const exactUsable = exact.filter((candidate) => candidate.usable);

  if (exactUsable.length === 1) {
    const chosen = exactUsable[0]!;
    return {
      queryName,
      status: 'matched',
      selectedRef: chosen.ref,
      selectedName: chosen.name,
      candidates: usableCandidates,
      manualOverride: false,
    };
  }

  if (exactUsable.length > 1) {
    return {
      queryName,
      status: 'ambiguous',
      selectedRef: { kind: 'empty' },
      selectedName: null,
      candidates: exactUsable,
      manualOverride: false,
      message: `背景「${queryName}」匹配到 ${exactUsable.length} 个同名素材，请手动指定（或使用空背景）。`,
    };
  }

  if (exact.length > 0) {
    return {
      queryName,
      status: 'unusable',
      selectedRef: { kind: 'empty' },
      selectedName: null,
      candidates: usableCandidates,
      manualOverride: false,
      message: exact[0]!.reason ?? `背景「${queryName}」不可用作镜头背景，已回退为空背景。`,
    };
  }

  // Check whether a non-image asset (e.g. audio/video) shares this name to give a clearer hint.
  const unsupportedAsset: Asset | undefined = project.assets.find(
    (asset) => normalizeSceneResourceName(asset.name) === key && asset.kind !== 'image',
  );
  if (unsupportedAsset) {
    return {
      queryName,
      status: 'unusable',
      selectedRef: { kind: 'empty' },
      selectedName: null,
      candidates: usableCandidates,
      manualOverride: false,
      message: `「${queryName}」不是可用的图片或元件背景，已回退为空背景。`,
    };
  }

  return {
    queryName,
    status: 'missing',
    selectedRef: { kind: 'empty' },
    selectedName: null,
    candidates: usableCandidates,
    manualOverride: false,
    message: `未找到背景「${queryName}」，可手动选择或使用空背景。`,
  };
}

export interface ResolvedCharacterMatch {
  readonly index: number;
  readonly queryName: string;
  readonly expressionName?: string;
  readonly status: SceneMatchStatus;
  readonly selectedRef: SceneCharacterRef | null;
  readonly selectedName: string | null;
  readonly candidates: readonly SceneCharacterCandidate[];
  readonly manualOverride: boolean;
  readonly message?: string;
}

export function resolveCharacterMatch(
  project: Project,
  index: number,
  queryName: string,
  expressionName?: string,
  override?: { readonly characterId: string; readonly expressionId?: string } | 'skip',
): ResolvedCharacterMatch {
  const allCandidates = listUsableCharacterCandidates(
    project,
    override && override !== 'skip' && override.expressionId
      ? undefined
      : expressionName,
  );
  const usableCandidates = allCandidates.filter((c) => c.usable);

  if (override === 'skip') {
    return {
      index,
      queryName,
      ...(expressionName ? { expressionName } : {}),
      status: 'skipped',
      selectedRef: null,
      selectedName: null,
      candidates: usableCandidates,
      manualOverride: true,
      message: `已跳过角色「${queryName}」。`,
    };
  }

  if (override) {
    const found = allCandidates.find(
      (candidate) => candidate.characterId === override.characterId,
    );
    if (!found) {
      return {
        index,
        queryName,
        ...(expressionName ? { expressionName } : {}),
        status: 'missing',
        selectedRef: null,
        selectedName: null,
        candidates: usableCandidates,
        manualOverride: true,
        message: '手动选择的角色已不存在。',
      };
    }
    const character = project.characters.find((entry) => entry.id === found.characterId);
    const invalidAdaptiveOverride =
      character?.mode === 'adaptive-parts' &&
      override.expressionId !== undefined &&
      (!character.faceBinding ||
        !character.expressions?.some((expression) => expression.id === override.expressionId));
    if (!found.usable || invalidAdaptiveOverride) {
      return {
        index,
        queryName,
        ...(expressionName ? { expressionName } : {}),
        status: 'unusable',
        selectedRef: null,
        selectedName: found.name,
        candidates: usableCandidates,
        manualOverride: true,
        message: found.reason ?? `角色「${found.name}」无法使用所选表情。`,
      };
    }
    const finalRef: SceneCharacterRef = override.expressionId
      ? { ...found.ref, expressionId: override.expressionId }
      : found.ref;
    return {
      index,
      queryName,
      ...(expressionName ? { expressionName } : {}),
      status: 'matched',
      selectedRef: finalRef,
      selectedName: found.name,
      candidates: usableCandidates,
      manualOverride: true,
    };
  }

  const key = normalizeSceneResourceName(queryName);
  const exact = allCandidates.filter(
    (candidate) => normalizeSceneResourceName(candidate.name) === key,
  );
  const exactUsable = exact.filter((candidate) => candidate.usable);

  if (exactUsable.length === 1) {
    const chosen = exactUsable[0]!;
    return {
      index,
      queryName,
      ...(expressionName ? { expressionName } : {}),
      status: 'matched',
      selectedRef: chosen.ref,
      selectedName: chosen.name,
      candidates: usableCandidates,
      manualOverride: false,
    };
  }

  if (exactUsable.length > 1) {
    return {
      index,
      queryName,
      ...(expressionName ? { expressionName } : {}),
      status: 'ambiguous',
      selectedRef: null,
      selectedName: null,
      candidates: exactUsable,
      manualOverride: false,
      message: `角色「${queryName}」匹配到 ${exactUsable.length} 个同名角色，请手动指定或跳过。`,
    };
  }

  if (exact.length > 0) {
    return {
      index,
      queryName,
      ...(expressionName ? { expressionName } : {}),
      status: 'unusable',
      selectedRef: null,
      selectedName: null,
      candidates: usableCandidates,
      manualOverride: false,
      message: exact[0]!.reason ?? `角色「${queryName}」当前不可用。`,
    };
  }

  return {
    index,
    queryName,
    ...(expressionName ? { expressionName } : {}),
    status: 'missing',
    selectedRef: null,
    selectedName: null,
    candidates: usableCandidates,
    manualOverride: false,
    message: `未找到角色「${queryName}」，可手动选择或跳过。`,
  };
}

export interface ResolvedPropMatch {
  readonly index: number;
  readonly queryName: string;
  readonly status: SceneMatchStatus;
  readonly selectedRef: ScenePropRef | null;
  readonly selectedName: string | null;
  readonly candidates: readonly ScenePropCandidate[];
  readonly manualOverride: boolean;
  readonly message?: string;
}

export function resolvePropMatch(
  project: Project,
  index: number,
  queryName: string,
  override?: ScenePropRef | 'skip',
): ResolvedPropMatch {
  const allCandidates = listUsablePropCandidates(project);
  const usableCandidates = allCandidates.filter((c) => c.usable);

  if (override === 'skip') {
    return {
      index,
      queryName,
      status: 'skipped',
      selectedRef: null,
      selectedName: null,
      candidates: usableCandidates,
      manualOverride: true,
      message: `已跳过道具「${queryName}」。`,
    };
  }

  if (override) {
    const found = allCandidates.find((candidate) =>
      override.kind === 'image'
        ? candidate.ref.kind === 'image' && candidate.ref.assetId === override.assetId
        : candidate.ref.kind === 'animation' && candidate.ref.animationId === override.animationId,
    );
    if (!found) {
      return {
        index,
        queryName,
        status: 'missing',
        selectedRef: null,
        selectedName: null,
        candidates: usableCandidates,
        manualOverride: true,
        message: '手动选择的道具素材已不存在。',
      };
    }
    if (!found.usable) {
      return {
        index,
        queryName,
        status: 'unusable',
        selectedRef: null,
        selectedName: found.name,
        candidates: usableCandidates,
        manualOverride: true,
        message: found.reason ?? `道具「${found.name}」不可用。`,
      };
    }
    return {
      index,
      queryName,
      status: 'matched',
      selectedRef: found.ref,
      selectedName: found.name,
      candidates: usableCandidates,
      manualOverride: true,
    };
  }

  const key = normalizeSceneResourceName(queryName);
  const exact = allCandidates.filter(
    (candidate) => normalizeSceneResourceName(candidate.name) === key,
  );
  const exactUsable = exact.filter((candidate) => candidate.usable);

  if (exactUsable.length === 1) {
    const chosen = exactUsable[0]!;
    return {
      index,
      queryName,
      status: 'matched',
      selectedRef: chosen.ref,
      selectedName: chosen.name,
      candidates: usableCandidates,
      manualOverride: false,
    };
  }

  if (exactUsable.length > 1) {
    return {
      index,
      queryName,
      status: 'ambiguous',
      selectedRef: null,
      selectedName: null,
      candidates: exactUsable,
      manualOverride: false,
      message: `道具「${queryName}」匹配到 ${exactUsable.length} 个同名素材，请手动指定或跳过。`,
    };
  }

  if (exact.length > 0) {
    return {
      index,
      queryName,
      status: 'unusable',
      selectedRef: null,
      selectedName: null,
      candidates: usableCandidates,
      manualOverride: false,
      message: exact[0]!.reason ?? `道具「${queryName}」不可用。`,
    };
  }

  return {
    index,
    queryName,
    status: 'missing',
    selectedRef: null,
    selectedName: null,
    candidates: usableCandidates,
    manualOverride: false,
    message: `未找到道具「${queryName}」，可手动选择或跳过。`,
  };
}
