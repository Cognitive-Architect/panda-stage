import type {
  CharacterHead,
  CompositeCharacterUpdate,
  FacePlacement,
} from '../../../domain';

export interface CharacterLayoutReuseCandidate {
  characterId: string;
  name: string;
  bodyAssetId: string;
  facePlacement: FacePlacement;
  head?: CharacterHead;
}

export interface CharacterLayoutReuseTarget {
  characterId: string;
  name: string;
  bodyAssetId: string;
  head?: CharacterHead;
}

export interface CharacterLayoutReuseImageAsset {
  id: string;
  kind: 'image';
  width: number;
  height: number;
  sha256?: string;
  metadata?: { status: 'ready' | 'error' };
}

export interface CharacterLayoutReuseImageDimensions {
  width: number;
  height: number;
}

export type CharacterLayoutReuseFailureCode =
  | 'source-unsaved'
  | 'source-not-selected'
  | 'same-character'
  | 'asset-missing'
  | 'asset-unverified'
  | 'asset-error'
  | 'resource-missing'
  | 'resource-loading'
  | 'resource-dimensions-mismatch'
  | 'body-dimensions-mismatch'
  | 'head-structure-mismatch';

export type CharacterLayoutReuseAssessment =
  | {
      ok: true;
      bodyDimensions: {
        source: CharacterLayoutReuseImageDimensions;
        target: CharacterLayoutReuseImageDimensions;
      };
    }
  | {
      ok: false;
      code: CharacterLayoutReuseFailureCode;
      reason: string;
    };

interface AssessCharacterLayoutReuseInput {
  sourceIsSaved: boolean;
  source: CharacterLayoutReuseCandidate | null;
  target: CharacterLayoutReuseTarget;
  assets: readonly CharacterLayoutReuseImageAsset[];
  sourceAssets?: readonly CharacterLayoutReuseImageAsset[];
  targetAssets?: readonly CharacterLayoutReuseImageAsset[];
  loadedImages: ReadonlyMap<string, CharacterLayoutReuseImageDimensions>;
  missingAssetIds: ReadonlySet<string>;
}

type CheckedAsset =
  | { ok: true; asset: CharacterLayoutReuseImageAsset }
  | {
      ok: false;
      code: CharacterLayoutReuseFailureCode;
      reason: string;
    };

function checkAsset(
  assetId: string,
  label: string,
  assets: readonly CharacterLayoutReuseImageAsset[],
  loadedImages: ReadonlyMap<string, CharacterLayoutReuseImageDimensions>,
  missingAssetIds: ReadonlySet<string>,
): CheckedAsset {
  const asset = assets.find(
    (candidate) => candidate.id === assetId && candidate.kind === 'image',
  );
  if (!asset) {
    return {
      ok: false,
      code: 'asset-missing',
      reason: `${label}素材记录不存在，无法确认布局兼容性。`,
    };
  }
  if (!asset.sha256) {
    return {
      ok: false,
      code: 'asset-unverified',
      reason: `${label}素材缺少校验信息，无法确认来源仍然有效。`,
    };
  }
  if (asset.metadata?.status === 'error') {
    return {
      ok: false,
      code: 'asset-error',
      reason: `${label}素材的元数据状态为错误，请先修复素材。`,
    };
  }
  if (missingAssetIds.has(assetId)) {
    return {
      ok: false,
      code: 'resource-missing',
      reason: `${label}素材无法读取，请先修复或重新导入素材。`,
    };
  }
  const decoded = loadedImages.get(assetId);
  if (!decoded) {
    return {
      ok: false,
      code: 'resource-loading',
      reason: `${label}素材仍在读取，完成后即可预览布局。`,
    };
  }
  if (
    decoded.width !== asset.width ||
    decoded.height !== asset.height ||
    decoded.width < 1 ||
    decoded.height < 1
  ) {
    return {
      ok: false,
      code: 'resource-dimensions-mismatch',
      reason: `${label}素材读取尺寸与项目记录不一致，请先修复素材。`,
    };
  }
  return { ok: true, asset };
}

export function assessCharacterLayoutReuse(
  input: AssessCharacterLayoutReuseInput,
): CharacterLayoutReuseAssessment {
  const { source, target } = input;
  if (!source) {
    return {
      ok: false,
      code: 'source-not-selected',
      reason: '请选择同项目中已保存的复合角色。',
    };
  }
  if (!input.sourceIsSaved) {
    return {
      ok: false,
      code: 'source-unsaved',
      reason: `来源「${source.name}」尚未保存，请先保存该角色后重试。`,
    };
  }
  if (source.characterId === target.characterId) {
    return {
      ok: false,
      code: 'same-character',
      reason: '来源角色和当前目标相同，请选择另一个复合角色。',
    };
  }

  const sourceBodyResult = checkAsset(
    source.bodyAssetId,
    `来源「${source.name}」的身体`,
    input.sourceAssets ?? input.assets,
    input.loadedImages,
    input.missingAssetIds,
  );
  if (!sourceBodyResult.ok) return sourceBodyResult;
  const targetBodyResult = checkAsset(
    target.bodyAssetId,
    `目标「${target.name}」的身体`,
    input.targetAssets ?? input.assets,
    input.loadedImages,
    input.missingAssetIds,
  );
  if (!targetBodyResult.ok) return targetBodyResult;

  const sourceBody = sourceBodyResult.asset;
  const targetBody = targetBodyResult.asset;
  if (
    sourceBody.id === targetBody.id &&
    sourceBody.sha256 !== targetBody.sha256
  ) {
    return {
      ok: false,
      code: 'resource-dimensions-mismatch',
      reason: '同一素材的已保存版本与当前目标版本不同，无法安全套用布局。',
    };
  }
  if (
    sourceBody.width !== targetBody.width ||
    sourceBody.height !== targetBody.height
  ) {
    return {
      ok: false,
      code: 'body-dimensions-mismatch',
      reason: `身体参考尺寸不同（来源 ${sourceBody.width}×${sourceBody.height}，目标 ${targetBody.width}×${targetBody.height}）；V0 只支持尺寸完全相同，不进行比例换算。`,
    };
  }

  if (Boolean(source.head) !== Boolean(target.head)) {
    return {
      ok: false,
      code: 'head-structure-mismatch',
      reason: source.head
        ? `来源「${source.name}」包含头部，目标「${target.name}」没有头部；两者结构不兼容。`
        : `目标「${target.name}」包含头部，来源「${source.name}」没有头部；两者结构不兼容。`,
    };
  }

  if (source.head && target.head) {
    const sourceHeadResult = checkAsset(
      source.head.assetId,
      `来源「${source.name}」的头部`,
      input.sourceAssets ?? input.assets,
      input.loadedImages,
      input.missingAssetIds,
    );
    if (!sourceHeadResult.ok) return sourceHeadResult;
    const targetHeadResult = checkAsset(
      target.head.assetId,
      `目标「${target.name}」的头部`,
      input.targetAssets ?? input.assets,
      input.loadedImages,
      input.missingAssetIds,
    );
    if (!targetHeadResult.ok) return targetHeadResult;
    if (
      sourceHeadResult.asset.id === targetHeadResult.asset.id &&
      sourceHeadResult.asset.sha256 !== targetHeadResult.asset.sha256
    ) {
      return {
        ok: false,
        code: 'resource-dimensions-mismatch',
        reason: '同一头部素材的已保存版本与当前目标版本不同，无法安全套用布局。',
      };
    }
  }

  return {
    ok: true,
    bodyDimensions: {
      source: { width: sourceBody.width, height: sourceBody.height },
      target: { width: targetBody.width, height: targetBody.height },
    },
  };
}

/** Copy only mapped placement values; all target asset and Character identity stays intact. */
export function buildCharacterLayoutReuseUpdate(
  source: CharacterLayoutReuseCandidate,
  target: CharacterLayoutReuseTarget,
): CompositeCharacterUpdate {
  const update: CompositeCharacterUpdate = {
    facePlacement: { ...source.facePlacement },
  };
  if (source.head && target.head) {
    update.head = {
      assetId: target.head.assetId,
      placement: { ...source.head.placement },
      pivot: { ...source.head.pivot },
    };
  }
  return update;
}
