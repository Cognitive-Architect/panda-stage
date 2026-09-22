import {
  FacePlacementSchema,
  ProjectSchema,
  type Character,
  type CharacterExpression,
  type FacePlacement,
  type ImageAsset,
  type Project,
} from '../models';
import {
  scanCharacterReferences,
  scanExpressionReferences,
  type CharacterReference,
  type ExpressionReference,
} from '../validators';

export type CharacterServiceErrorCode =
  | 'CHARACTER_NOT_FOUND'
  | 'EXPRESSION_NOT_FOUND'
  | 'DUPLICATE_CHARACTER_NAME'
  | 'DUPLICATE_EXPRESSION_NAME'
  | 'IMAGE_ASSET_REQUIRED'
  | 'DEFAULT_EXPRESSION_REQUIRED'
  | 'LAST_EXPRESSION_REQUIRED'
  | 'CHARACTER_REFERENCED'
  | 'EXPRESSION_REFERENCED'
  | 'COMPOSITE_CHARACTER_REQUIRED'
  | 'INVALID_FACE_PLACEMENT'
  | 'EXPRESSION_SET_MISMATCH';

export class CharacterServiceError extends Error {
  constructor(
    readonly code: CharacterServiceErrorCode,
    message: string,
    readonly references:
      | readonly CharacterReference[]
      | readonly ExpressionReference[] = [],
  ) {
    super(message);
    this.name = 'CharacterServiceError';
  }
}

export interface CharacterExpressionDraft {
  name: string;
  assetId: string;
}

export interface CreateCharacterInput {
  name: string;
  expressions: readonly CharacterExpressionDraft[];
  defaultExpressionIndex?: number;
  mouthOpenAssetId?: string;
  defaultScale?: number;
  defaultFlipX?: boolean;
}

export interface CreateCompositeCharacterInput
  extends CreateCharacterInput {
  bodyAssetId: string;
  facePlacement: FacePlacement;
}

export interface CharacterExpressionAssetUpdate {
  expressionId: string;
  assetId: string;
}

/** The complete persisted definition owned by a composite Character. */
export interface CompositeCharacterDefinition {
  bodyAssetId: string;
  facePlacement: FacePlacement;
  expressionAssets: readonly CharacterExpressionAssetUpdate[];
  mouthOpenAssetId: string | null;
}

/** Narrow fields that a single assembly Apply may change. */
export interface CompositeCharacterUpdate {
  bodyAssetId?: string;
  facePlacement?: FacePlacement;
  expressionAssets?: readonly CharacterExpressionAssetUpdate[];
  mouthOpenAssetId?: string | null;
}

export interface CharacterDimensionWarning {
  assetId: string;
  expressionId?: string;
  label: string;
  baseline: { width: number; height: number };
  candidate: { width: number; height: number };
  widthDifferenceRatio: number;
  heightDifferenceRatio: number;
}

export interface ResolvedCharacterAppearance {
  characterId: string;
  expressionId: string;
  assetId: string;
  center: { x: number; y: number };
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
}

export interface CharacterServiceOptions {
  createId?: () => string;
  now?: () => Date;
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export class CharacterService {
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: CharacterServiceOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  create(project: Project, input: CreateCharacterInput): Project {
    const name = input.name.trim();
    if (
      project.characters.some(
        (character) => normalizedName(character.name) === normalizedName(name),
      )
    ) {
      throw new CharacterServiceError(
        'DUPLICATE_CHARACTER_NAME',
        `角色名称“${name}”已存在。`,
      );
    }
    if (input.expressions.length === 0) {
      throw new CharacterServiceError(
        'LAST_EXPRESSION_REQUIRED',
        '角色至少需要一个表情。',
      );
    }
    this.assertUniqueExpressionNames(input.expressions);
    const expressions = input.expressions.map((draft) => ({
      id: this.createId(),
      name: draft.name.trim(),
      assetId: this.imageAsset(project, draft.assetId).id,
    }));
    const defaultIndex = input.defaultExpressionIndex ?? 0;
    const defaultExpression = expressions[defaultIndex];
    if (!defaultExpression) {
      throw new CharacterServiceError(
        'DEFAULT_EXPRESSION_REQUIRED',
        '默认表情必须指向角色中的有效表情。',
      );
    }
    const characterId = this.createId();
    const voiceProfileId = this.createId();
    const mouthOpenAssetId = input.mouthOpenAssetId
      ? this.imageAsset(project, input.mouthOpenAssetId).id
      : undefined;
    const character: Character = {
      id: characterId,
      name,
      mode: 'single-image',
      baseAssetId: defaultExpression.assetId,
      defaultVoiceProfileId: voiceProfileId,
      expressions,
      defaultExpressionId: defaultExpression.id,
      ...(mouthOpenAssetId ? { mouthOpenAssetId } : {}),
      defaultScale: input.defaultScale ?? 1,
      defaultFlipX: input.defaultFlipX ?? false,
    };
    return this.finish(project, {
      ...project,
      characters: [...project.characters, character],
      voiceProfiles: [
        ...project.voiceProfiles,
        {
          id: voiceProfileId,
          name: `${name} 默认语音`,
          characterId,
          locale: 'zh-CN',
          rate: 1,
          pitch: 0,
        },
      ],
    });
  }

  createComposite(
    project: Project,
    input: CreateCompositeCharacterInput,
  ): Project {
    const bodyAssetId = this.imageAsset(project, input.bodyAssetId).id;
    const facePlacement = this.validFacePlacement(input.facePlacement);
    const singleImageProject = this.create(project, input);
    const character = singleImageProject.characters.at(-1);
    if (!character) {
      throw new CharacterServiceError(
        'CHARACTER_NOT_FOUND',
        'The newly created Character was not found.',
      );
    }
    return this.replaceCharacter(singleImageProject, {
      ...character,
      mode: 'composite',
      bodyAssetId,
      facePlacement,
    });
  }

  getCompositeDefinition(
    project: Project,
    characterId: string,
  ): CompositeCharacterDefinition {
    return this.definitionOf(this.compositeCharacter(project, characterId));
  }

  applyCompositeDefinition(
    project: Project,
    characterId: string,
    definition: CompositeCharacterDefinition,
  ): Project {
    const character = this.compositeCharacter(project, characterId);
    const bodyAssetId = this.imageAsset(project, definition.bodyAssetId).id;
    const facePlacement = this.validFacePlacement(definition.facePlacement);
    const expressions = this.resolveExpressionAssets(
      project,
      character,
      definition.expressionAssets,
    );
    const mouthOpenAssetId =
      definition.mouthOpenAssetId === null
        ? undefined
        : this.imageAsset(project, definition.mouthOpenAssetId).id;
    const defaultExpression = expressions.find(
      (expression) => expression.id === character.defaultExpressionId,
    );
    if (!defaultExpression) {
      throw new CharacterServiceError(
        'DEFAULT_EXPRESSION_REQUIRED',
        'A composite Character must keep a valid default Expression.',
      );
    }
    const next: Extract<Character, { mode: 'composite' }> = {
      ...character,
      bodyAssetId,
      facePlacement,
      expressions,
      baseAssetId: defaultExpression.assetId,
      ...(mouthOpenAssetId ? { mouthOpenAssetId } : {}),
    };
    if (this.sameCompositeDefinition(character, next)) return project;
    return this.replaceCharacter(project, next);
  }

  applyCompositeUpdate(
    project: Project,
    characterId: string,
    update: CompositeCharacterUpdate,
  ): Project {
    const current = this.getCompositeDefinition(project, characterId);
    return this.applyCompositeDefinition(project, characterId, {
      bodyAssetId: update.bodyAssetId ?? current.bodyAssetId,
      facePlacement: update.facePlacement ?? current.facePlacement,
      expressionAssets:
        update.expressionAssets ?? current.expressionAssets,
      mouthOpenAssetId:
        update.mouthOpenAssetId === undefined
          ? current.mouthOpenAssetId
          : update.mouthOpenAssetId,
    });
  }

  replaceBodyAsset(
    project: Project,
    characterId: string,
    bodyAssetId: string,
  ): Project {
    return this.applyCompositeUpdate(project, characterId, { bodyAssetId });
  }

  setFacePlacement(
    project: Project,
    characterId: string,
    facePlacement: FacePlacement,
  ): Project {
    return this.applyCompositeUpdate(project, characterId, {
      facePlacement,
    });
  }

  setCompositeExpressionAssets(
    project: Project,
    characterId: string,
    expressionAssets: readonly CharacterExpressionAssetUpdate[],
  ): Project {
    return this.applyCompositeUpdate(project, characterId, {
      expressionAssets,
    });
  }

  setCompositeMouthOpenAsset(
    project: Project,
    characterId: string,
    mouthOpenAssetId: string | null,
  ): Project {
    return this.applyCompositeUpdate(project, characterId, {
      mouthOpenAssetId,
    });
  }

  renameCharacter(
    project: Project,
    characterId: string,
    rawName: string,
  ): Project {
    const character = this.character(project, characterId);
    const name = rawName.trim();
    if (
      project.characters.some(
        (candidate) =>
          candidate.id !== character.id &&
          normalizedName(candidate.name) === normalizedName(name),
      )
    ) {
      throw new CharacterServiceError(
        'DUPLICATE_CHARACTER_NAME',
        `角色名称“${name}”已存在。`,
      );
    }
    return this.replaceCharacter(project, { ...character, name });
  }

  deleteCharacter(project: Project, characterId: string): Project {
    const character = this.character(project, characterId);
    const references = scanCharacterReferences(project, character.id);
    if (references.length > 0) {
      throw new CharacterServiceError(
        'CHARACTER_REFERENCED',
        `角色“${character.name}”仍被 ${references.length} 处内容使用，不能删除。`,
        references,
      );
    }
    return this.finish(project, {
      ...project,
      characters: project.characters.filter(
        (candidate) => candidate.id !== character.id,
      ),
      voiceProfiles: project.voiceProfiles.filter(
        (profile) => profile.characterId !== character.id,
      ),
    });
  }

  addExpression(
    project: Project,
    characterId: string,
    draft: CharacterExpressionDraft,
  ): Project {
    const character = this.character(project, characterId);
    this.assertUniqueExpressionNames([
      ...character.expressions,
      { name: draft.name },
    ]);
    const expression: CharacterExpression = {
      id: this.createId(),
      name: draft.name.trim(),
      assetId: this.imageAsset(project, draft.assetId).id,
    };
    return this.replaceCharacter(project, {
      ...character,
      expressions: [...character.expressions, expression],
    });
  }

  renameExpression(
    project: Project,
    characterId: string,
    expressionId: string,
    rawName: string,
  ): Project {
    const character = this.character(project, characterId);
    this.expression(character, expressionId);
    const expressions = character.expressions.map((expression) =>
      expression.id === expressionId
        ? { ...expression, name: rawName.trim() }
        : expression,
    );
    this.assertUniqueExpressionNames(expressions);
    return this.replaceCharacter(project, { ...character, expressions });
  }

  setExpressionAsset(
    project: Project,
    characterId: string,
    expressionId: string,
    assetId: string,
  ): Project {
    const character = this.character(project, characterId);
    const expression = this.expression(character, expressionId);
    const imageAssetId = this.imageAsset(project, assetId).id;
    if (expression.assetId === imageAssetId) return project;
    const expressions = character.expressions.map((candidate) =>
      candidate.id === expression.id
        ? { ...candidate, assetId: imageAssetId }
        : candidate,
    );
    return this.replaceCharacter(project, {
      ...character,
      expressions,
      ...(character.defaultExpressionId === expression.id
        ? { baseAssetId: imageAssetId }
        : {}),
    });
  }

  removeExpression(
    project: Project,
    characterId: string,
    expressionId: string,
  ): Project {
    const character = this.character(project, characterId);
    const expression = this.expression(character, expressionId);
    if (character.defaultExpressionId === expression.id) {
      throw new CharacterServiceError(
        'DEFAULT_EXPRESSION_REQUIRED',
        `“${expression.name}”是默认表情。请先选择替代表情，再执行删除。`,
      );
    }
    if (character.expressions.length === 1) {
      throw new CharacterServiceError(
        'LAST_EXPRESSION_REQUIRED',
        '角色至少需要保留一个表情。',
      );
    }
    const references = scanExpressionReferences(
      project,
      character.id,
      expression.id,
    );
    if (references.length > 0) {
      throw new CharacterServiceError(
        'EXPRESSION_REFERENCED',
        `表情“${expression.name}”仍被 ${references.length} 处内容使用，不能删除。`,
        references,
      );
    }
    return this.replaceCharacter(project, {
      ...character,
      expressions: character.expressions.filter(
        (candidate) => candidate.id !== expression.id,
      ),
    });
  }

  setDefaultExpression(
    project: Project,
    characterId: string,
    expressionId: string,
  ): Project {
    const character = this.character(project, characterId);
    const expression = this.expression(character, expressionId);
    if (character.defaultExpressionId === expression.id) return project;
    return this.replaceCharacter(project, {
      ...character,
      defaultExpressionId: expression.id,
      baseAssetId: expression.assetId,
    });
  }

  setMouthOpenAsset(
    project: Project,
    characterId: string,
    assetId: string | null,
  ): Project {
    const character = this.character(project, characterId);
    const mouthOpenAssetId = assetId
      ? this.imageAsset(project, assetId).id
      : undefined;
    if ((character.mouthOpenAssetId ?? undefined) === mouthOpenAssetId) {
      return project;
    }
    const next = { ...character };
    if (mouthOpenAssetId) {
      next.mouthOpenAssetId = mouthOpenAssetId;
    } else {
      delete next.mouthOpenAssetId;
    }
    return this.replaceCharacter(project, next);
  }

  setDefaultTransform(
    project: Project,
    characterId: string,
    defaultScale: number,
    defaultFlipX: boolean,
  ): Project {
    const character = this.character(project, characterId);
    if (
      character.defaultScale === defaultScale &&
      character.defaultFlipX === defaultFlipX
    ) {
      return project;
    }
    return this.replaceCharacter(project, {
      ...character,
      defaultScale,
      defaultFlipX,
    });
  }

  dimensionWarnings(
    project: Project,
    characterId: string,
  ): CharacterDimensionWarning[] {
    const character = this.character(project, characterId);
    const defaultExpression = this.expression(
      character,
      character.defaultExpressionId,
    );
    const baseline = this.imageAsset(project, defaultExpression.assetId);
    const candidates = [
      ...character.expressions
        .filter((expression) => expression.id !== defaultExpression.id)
        .map((expression) => ({
          expressionId: expression.id,
          assetId: expression.assetId,
          label: `表情“${expression.name}”`,
        })),
      ...(character.mouthOpenAssetId
        ? [
            {
              assetId: character.mouthOpenAssetId,
              label: '张嘴图片',
            },
          ]
        : []),
    ];
    return candidates.flatMap((candidate) => {
      const asset = this.imageAsset(project, candidate.assetId);
      const widthDifferenceRatio =
        Math.abs(asset.width - baseline.width) / baseline.width;
      const heightDifferenceRatio =
        Math.abs(asset.height - baseline.height) / baseline.height;
      return widthDifferenceRatio > 0.3 || heightDifferenceRatio > 0.3
        ? [
            {
              ...candidate,
              baseline: {
                width: baseline.width,
                height: baseline.height,
              },
              candidate: { width: asset.width, height: asset.height },
              widthDifferenceRatio,
              heightDifferenceRatio,
            },
          ]
        : [];
    });
  }

  resolveAppearance(
    project: Project,
    characterId: string,
    expressionId: string | undefined,
    center: { x: number; y: number },
  ): ResolvedCharacterAppearance {
    const character = this.character(project, characterId);
    const expression = this.expression(
      character,
      expressionId ?? character.defaultExpressionId,
    );
    const asset = this.imageAsset(project, expression.assetId);
    return {
      characterId,
      expressionId: expression.id,
      assetId: asset.id,
      center: { ...center },
      width: asset.width,
      height: asset.height,
      scaleX: character.defaultFlipX
        ? -character.defaultScale
        : character.defaultScale,
      scaleY: character.defaultScale,
      flipX: character.defaultFlipX,
    };
  }

  private compositeCharacter(
    project: Project,
    characterId: string,
  ): Extract<Character, { mode: 'composite' }> {
    const character = this.character(project, characterId);
    if (character.mode !== 'composite') {
      throw new CharacterServiceError(
        'COMPOSITE_CHARACTER_REQUIRED',
        `Character ${characterId} must be composite for this operation.`,
      );
    }
    return character;
  }

  private definitionOf(
    character: Extract<Character, { mode: 'composite' }>,
  ): CompositeCharacterDefinition {
    return {
      bodyAssetId: character.bodyAssetId,
      facePlacement: { ...character.facePlacement },
      expressionAssets: character.expressions.map((expression) => ({
        expressionId: expression.id,
        assetId: expression.assetId,
      })),
      mouthOpenAssetId: character.mouthOpenAssetId ?? null,
    };
  }

  private validFacePlacement(raw: FacePlacement): FacePlacement {
    const parsed = FacePlacementSchema.safeParse(raw);
    if (!parsed.success) {
      throw new CharacterServiceError(
        'INVALID_FACE_PLACEMENT',
        'Face Placement must contain finite offsets and a positive scale.',
      );
    }
    return { ...parsed.data };
  }

  private resolveExpressionAssets(
    project: Project,
    character: Extract<Character, { mode: 'composite' }>,
    updates: readonly CharacterExpressionAssetUpdate[],
  ): CharacterExpression[] {
    if (updates.length !== character.expressions.length) {
      throw new CharacterServiceError(
        'EXPRESSION_SET_MISMATCH',
        'A composite Character update must provide exactly one asset for every Expression.',
      );
    }
    const byExpressionId = new Map<string, string>();
    for (const update of updates) {
      if (byExpressionId.has(update.expressionId)) {
        throw new CharacterServiceError(
          'EXPRESSION_SET_MISMATCH',
          `Expression ${update.expressionId} was supplied more than once.`,
        );
      }
      const expression = this.expression(character, update.expressionId);
      byExpressionId.set(
        expression.id,
        this.imageAsset(project, update.assetId).id,
      );
    }
    if (
      character.expressions.some(
        (expression) => !byExpressionId.has(expression.id),
      )
    ) {
      throw new CharacterServiceError(
        'EXPRESSION_SET_MISMATCH',
        'A composite Character update must preserve every Expression identity.',
      );
    }
    return character.expressions.map((expression) => ({
      ...expression,
      assetId: byExpressionId.get(expression.id)!,
    }));
  }

  private sameCompositeDefinition(
    current: Extract<Character, { mode: 'composite' }>,
    next: Extract<Character, { mode: 'composite' }>,
  ): boolean {
    return (
      current.bodyAssetId === next.bodyAssetId &&
      current.facePlacement.offsetX === next.facePlacement.offsetX &&
      current.facePlacement.offsetY === next.facePlacement.offsetY &&
      current.facePlacement.scale === next.facePlacement.scale &&
      current.baseAssetId === next.baseAssetId &&
      (current.mouthOpenAssetId ?? null) ===
        (next.mouthOpenAssetId ?? null) &&
      current.expressions.length === next.expressions.length &&
      current.expressions.every(
        (expression, index) =>
          expression.id === next.expressions[index]!.id &&
          expression.name === next.expressions[index]!.name &&
          expression.assetId === next.expressions[index]!.assetId,
      )
    );
  }

  private replaceCharacter(
    project: Project,
    replacement: Character,
  ): Project {
    const current = project.characters.find(
      (character) => character.id === replacement.id,
    );
    if (current && JSON.stringify(current) === JSON.stringify(replacement)) {
      return project;
    }
    return this.finish(project, {
      ...project,
      characters: project.characters.map((character) =>
        character.id === replacement.id ? replacement : character,
      ),
    });
  }

  private finish(project: Project, next: Project): Project {
    return ProjectSchema.parse({
      ...next,
      updatedAt: this.now().toISOString(),
      createdAt: project.createdAt,
    });
  }

  private character(project: Project, characterId: string): Character {
    const character = project.characters.find(
      (candidate) => candidate.id === characterId,
    );
    if (!character) {
      throw new CharacterServiceError(
        'CHARACTER_NOT_FOUND',
        `找不到角色：${characterId}`,
      );
    }
    return character;
  }

  private expression(
    character: Character,
    expressionId: string,
  ): CharacterExpression {
    const expression = character.expressions.find(
      (candidate) => candidate.id === expressionId,
    );
    if (!expression) {
      throw new CharacterServiceError(
        'EXPRESSION_NOT_FOUND',
        `角色“${character.name}”中找不到表情：${expressionId}`,
      );
    }
    return expression;
  }

  private imageAsset(project: Project, assetId: string): ImageAsset {
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (!asset || asset.kind !== 'image') {
      throw new CharacterServiceError(
        'IMAGE_ASSET_REQUIRED',
        `角色表情和张嘴图必须引用项目内图片素材：${assetId}`,
      );
    }
    return asset;
  }

  private assertUniqueExpressionNames(
    expressions: readonly { name: string }[],
  ): void {
    const seen = new Set<string>();
    for (const expression of expressions) {
      const name = expression.name.trim();
      const normalized = normalizedName(name);
      if (seen.has(normalized)) {
        throw new CharacterServiceError(
          'DUPLICATE_EXPRESSION_NAME',
          `表情名称“${name}”已存在。`,
        );
      }
      seen.add(normalized);
    }
  }
}
