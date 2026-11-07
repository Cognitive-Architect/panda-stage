import type { Asset, Character, ImageAsset, Project } from '../models';

/**
 * AUTO-04 reuses the AUTO-01 V0 resource-binding contract that PR #857 already
 * reviewed: exact-name lookup, zero/one/many candidates, and an explicit
 * "unusable" reason. There is no fuzzy search, no default-first pick, and no
 * silent skip, so the panel and the planner read the same resolution truth.
 */
export type SceneSlotKind = 'background' | 'left-character' | 'right-character';

export type SceneCandidateErrorCode =
  | 'BACKGROUND_NOT_USABLE'
  | 'CHARACTER_NOT_ASSEMBLED'
  | 'CHARACTER_ASSET_UNAVAILABLE';

export interface SceneCandidate<T> {
  readonly value: T;
  readonly selectable: boolean;
  readonly errorCode?: SceneCandidateErrorCode;
}

export type SceneSlotStatus = 'ready' | 'missing' | 'ambiguous' | 'unusable';

export interface SceneSlotChoice {
  readonly id: string;
  readonly name: string;
  readonly selectable: boolean;
  readonly message?: string;
}

export interface SceneSlotResolution {
  readonly slot: SceneSlotKind;
  readonly requestedName: string;
  readonly status: SceneSlotStatus;
  readonly choices: readonly SceneSlotChoice[];
  readonly selectedId: string | null;
  readonly message?: string;
}

export interface ResolvedBackground {
  readonly asset: ImageAsset;
}

export interface ResolvedCharacter {
  readonly character: Character;
  readonly expressionId: string;
  readonly expressionAssetId: string;
}

function backgroundUsable(asset: Asset): boolean {
  return (
    asset.kind === 'image' &&
    asset.usage === 'background' &&
    asset.metadata?.status !== 'error'
  );
}

/** Every image Asset is listed; only exact-name usable ones can be selected. */
export function listBackgroundCandidates(
  project: Project,
): SceneCandidate<Asset>[] {
  return project.assets.map((asset) => {
    const selectable = backgroundUsable(asset);
    return selectable
      ? { value: asset, selectable }
      : { value: asset, selectable, errorCode: 'BACKGROUND_NOT_USABLE' };
  });
}

type AssembledCharacter = Extract<Character, { mode: 'composite' }>;

/** AUTO-04 casts assembled composite Characters only, exactly like #857. */
function isAssembledCharacter(character: Character): character is AssembledCharacter {
  return character.mode === 'composite';
}

function characterExpressionIds(character: AssembledCharacter): string[] {
  return character.expressions.map((expression) => expression.assetId);
}

function characterAssetIds(character: AssembledCharacter): string[] {
  return [
    character.bodyAssetId,
    ...characterExpressionIds(character),
    ...(character.head ? [character.head.assetId] : []),
    ...(character.mouthOpenAssetId ? [character.mouthOpenAssetId] : []),
  ];
}

function characterCandidateError(
  project: Project,
  character: Character,
): SceneCandidateErrorCode | undefined {
  // AUTO-04 keeps PR #857's scope: only assembled composite Characters are
  // castable. Adaptive-parts support is deliberately out of this ticket.
  if (!isAssembledCharacter(character)) return 'CHARACTER_NOT_ASSEMBLED';
  const defaultExpression = character.expressions.find(
    (expression) => expression.id === character.defaultExpressionId,
  );
  if (!defaultExpression) return 'CHARACTER_ASSET_UNAVAILABLE';
  const unavailable = characterAssetIds(character).some((assetId) => {
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    return !asset || asset.kind !== 'image' || asset.metadata?.status === 'error';
  });
  return unavailable ? 'CHARACTER_ASSET_UNAVAILABLE' : undefined;
}

export function listCharacterCandidates(
  project: Project,
): SceneCandidate<Character>[] {
  return project.characters.map((character) => {
    const errorCode = characterCandidateError(project, character);
    return errorCode
      ? { value: character, selectable: false, errorCode }
      : { value: character, selectable: true };
  });
}

export function describeSceneCandidateError(
  code: SceneCandidateErrorCode,
  name: string,
): string {
  switch (code) {
    case 'BACKGROUND_NOT_USABLE':
      return `「${name}」不是可用的背景图片素材。`;
    case 'CHARACTER_NOT_ASSEMBLED':
      return `「${name}」还不是已组装的可编辑角色。`;
    case 'CHARACTER_ASSET_UNAVAILABLE':
      return `「${name}」引用了不可用的图片素材。`;
  }
}

function slotChoices<T extends Asset | Character>(
  candidates: readonly SceneCandidate<T>[],
): SceneSlotChoice[] {
  return candidates.map((candidate) => {
    const message = candidate.errorCode
      ? describeSceneCandidateError(candidate.errorCode, candidate.value.name)
      : undefined;
    return {
      id: candidate.value.id,
      name: candidate.value.name,
      selectable: candidate.selectable,
      ...(message ? { message } : {}),
    };
  });
}

interface SlotResolutionArgs<T extends Asset | Character> {
  slot: SceneSlotKind;
  requestedName: string;
  selectionId: string | null;
  candidates: readonly SceneCandidate<T>[];
  notFoundMessage: string;
  ambiguousMessage: string;
  unusableFallbackCode: SceneCandidateErrorCode;
}

function resolveSlot<T extends Asset | Character>({
  slot,
  requestedName,
  selectionId,
  candidates,
  notFoundMessage,
  ambiguousMessage,
  unusableFallbackCode,
}: SlotResolutionArgs<T>): {
  resolution: SceneSlotResolution;
  value: T | null;
  errorCode: SceneCandidateErrorCode | null;
} {
  const named = candidates.filter(
    (candidate) => candidate.value.name === requestedName,
  );
  const choices = slotChoices(named);
  if (selectionId) {
    const selected = named.find(
      (candidate) => candidate.value.id === selectionId,
    );
    if (!selected) {
      return {
        resolution: {
          slot,
          requestedName,
          status: 'missing',
          choices,
          selectedId: null,
          message: `当前工程中找不到所选的「${requestedName}」。`,
        },
        value: null,
        errorCode: null,
      };
    }
    if (!selected.selectable) {
      const errorCode = selected.errorCode ?? unusableFallbackCode;
      return {
        resolution: {
          slot,
          requestedName,
          status: 'unusable',
          choices,
          selectedId: selected.value.id,
          message: describeSceneCandidateError(errorCode, requestedName),
        },
        value: null,
        errorCode,
      };
    }
    return {
      resolution: {
        slot,
        requestedName,
        status: 'ready',
        choices,
        selectedId: selected.value.id,
      },
      value: selected.value,
      errorCode: null,
    };
  }

  if (named.length === 0) {
    return {
      resolution: {
        slot,
        requestedName,
        status: 'missing',
        choices,
        selectedId: null,
        message: notFoundMessage,
      },
      value: null,
      errorCode: null,
    };
  }
  if (named.length > 1) {
    return {
      resolution: {
        slot,
        requestedName,
        status: 'ambiguous',
        choices,
        selectedId: null,
        message: ambiguousMessage,
      },
      value: null,
      errorCode: null,
    };
  }
  const only = named[0]!;
  if (!only.selectable) {
    const errorCode = only.errorCode ?? unusableFallbackCode;
    return {
      resolution: {
        slot,
        requestedName,
        status: 'unusable',
        choices,
        selectedId: only.value.id,
        message: describeSceneCandidateError(errorCode, requestedName),
      },
      value: null,
      errorCode,
    };
  }
  return {
    resolution: {
      slot,
      requestedName,
      status: 'ready',
      choices,
      selectedId: only.value.id,
    },
    value: only.value,
    errorCode: null,
  };
}

export function resolveBackgroundSlot(
  project: Project,
  requestedName: string,
  selectionId: string | null,
): {
  resolution: SceneSlotResolution;
  asset: ImageAsset | null;
  errorCode: SceneCandidateErrorCode | null;
} {
  const { resolution, value, errorCode } = resolveSlot({
    slot: 'background',
    requestedName,
    selectionId,
    candidates: listBackgroundCandidates(project),
    notFoundMessage: `当前工程中找不到名为「${requestedName}」的背景素材。`,
    ambiguousMessage: `当前工程中有多个名为「${requestedName}」的素材，请先选择背景。`,
    unusableFallbackCode: 'BACKGROUND_NOT_USABLE',
  });
  return {
    resolution,
    asset: value && value.kind === 'image' ? value : null,
    errorCode,
  };
}

export function resolveCharacterSlot(
  project: Project,
  slot: Extract<SceneSlotKind, 'left-character' | 'right-character'>,
  requestedName: string,
  selectionId: string | null,
): {
  resolution: SceneSlotResolution;
  character: ResolvedCharacter | null;
  errorCode: SceneCandidateErrorCode | null;
} {
  const { resolution, value, errorCode } = resolveSlot({
    slot,
    requestedName,
    selectionId,
    candidates: listCharacterCandidates(project),
    notFoundMessage: `当前工程中找不到名为「${requestedName}」的角色。`,
    ambiguousMessage: `当前工程中有多个名为「${requestedName}」的角色，请先选择角色。`,
    unusableFallbackCode: 'CHARACTER_ASSET_UNAVAILABLE',
  });
  if (!value || !isAssembledCharacter(value)) {
    return { resolution, character: null, errorCode };
  }
  const expression = value.expressions.find(
    (candidate) => candidate.id === value.defaultExpressionId,
  );
  if (!expression) {
    return {
      resolution: {
        ...resolution,
        status: 'unusable',
        selectedId: null,
        message: describeSceneCandidateError(
          'CHARACTER_ASSET_UNAVAILABLE',
          requestedName,
        ),
      },
      character: null,
      errorCode: 'CHARACTER_ASSET_UNAVAILABLE',
    };
  }
  return {
    resolution,
    character: {
      character: value,
      expressionId: expression.id,
      expressionAssetId: expression.assetId,
    },
    errorCode: null,
  };
}
