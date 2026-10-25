import {
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
} from '../constants';
import {
  ProjectSchema,
  type ImageAsset,
  type Project,
} from '../models';
import { LayerService } from './LayerService';
import { ShotService, ShotServiceError } from './ShotService';

const REQUIRED_FIELDS = ['镜头', '背景', '出场'] as const;

export type SceneCreationField = (typeof REQUIRED_FIELDS)[number];

export interface StructuredSceneInput {
  shotName: string;
  backgroundName: string;
  characterName: string;
}

export type SceneCreationErrorCode =
  | 'INVALID_INPUT'
  | 'UNKNOWN_FIELD'
  | 'DUPLICATE_FIELD'
  | 'MISSING_FIELD'
  | 'EMPTY_FIELD'
  | 'BACKGROUND_NOT_FOUND'
  | 'BACKGROUND_AMBIGUOUS'
  | 'BACKGROUND_NOT_USABLE'
  | 'CHARACTER_NOT_FOUND'
  | 'CHARACTER_AMBIGUOUS'
  | 'CHARACTER_NOT_ASSEMBLED'
  | 'CHARACTER_ASSET_UNAVAILABLE'
  | 'SHOT_NAME_CONFLICT'
  | 'GENERATED_SCENE_INVALID';

export class SceneCreationError extends Error {
  constructor(
    readonly code: SceneCreationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SceneCreationError';
  }
}

export interface SceneCreationResult {
  project: Project;
  shotId: string;
  backgroundLayerId: string;
  characterLayerId: string;
  backgroundAssetId: string;
  characterId: string;
  expressionId: string;
}

export interface SceneCreationServiceOptions {
  shotService?: Pick<ShotService, 'create'>;
  layerService?: Pick<LayerService, 'createFromAsset' | 'setBackground'>;
}

function requiredField(
  fields: Partial<Record<SceneCreationField, string>>,
  field: SceneCreationField,
): string {
  const value = fields[field];
  if (value === undefined) {
    throw new SceneCreationError(
      'MISSING_FIELD',
      `输入缺少“${field}”字段。`,
    );
  }
  return value;
}

/** Parse the fixed three-line V0 input without interpreting values as commands. */
export function parseStructuredSceneInput(
  rawInput: string,
): StructuredSceneInput {
  if (typeof rawInput !== 'string') {
    throw new SceneCreationError('INVALID_INPUT', '输入必须是文本。');
  }

  const fields: Partial<Record<SceneCreationField, string>> = {};
  const lines = rawInput.replace(/\r\n?/gu, '\n').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const asciiColon = line.indexOf(':');
    const fullWidthColon = line.indexOf('：');
    const separatorIndex =
      asciiColon < 0
        ? fullWidthColon
        : fullWidthColon < 0
          ? asciiColon
          : Math.min(asciiColon, fullWidthColon);
    if (separatorIndex < 0) {
      throw new SceneCreationError(
        'INVALID_INPUT',
        `无法识别字段行“${line}”，请使用“字段：值”格式。`,
      );
    }

    const label = line.slice(0, separatorIndex).trim();
    const field = REQUIRED_FIELDS.find((candidate) => candidate === label);
    if (!field) {
      throw new SceneCreationError(
        'UNKNOWN_FIELD',
        `不支持“${label || line}”字段。`,
      );
    }
    if (fields[field] !== undefined) {
      throw new SceneCreationError(
        'DUPLICATE_FIELD',
        `“${field}”字段只能出现一次。`,
      );
    }

    const value = line.slice(separatorIndex + 1).trim();
    if (!value) {
      throw new SceneCreationError(
        'EMPTY_FIELD',
        `“${field}”字段不能为空。`,
      );
    }
    fields[field] = value;
  }

  return {
    shotName: requiredField(fields, '镜头'),
    backgroundName: requiredField(fields, '背景'),
    characterName: requiredField(fields, '出场'),
  };
}

function namedImage(
  project: Project,
  name: string,
): ImageAsset {
  const matches = project.assets.filter((asset) => asset.name === name);
  if (matches.length === 0) {
    throw new SceneCreationError(
      'BACKGROUND_NOT_FOUND',
      `当前工程中找不到名为“${name}”的图片素材。`,
    );
  }
  if (matches.length > 1) {
    throw new SceneCreationError(
      'BACKGROUND_AMBIGUOUS',
      `当前工程中有多个名为“${name}”的素材，无法安全选择。`,
    );
  }
  const asset = matches[0]!;
  if (asset.kind !== 'image' || asset.usage !== 'background') {
    throw new SceneCreationError(
      'BACKGROUND_NOT_USABLE',
      `“${name}”不是标记为背景用途的图片素材。`,
    );
  }
  if (asset.metadata?.status === 'error') {
    throw new SceneCreationError(
      'BACKGROUND_NOT_USABLE',
      `背景素材“${name}”当前不可用。`,
    );
  }
  return asset;
}

export class SceneCreationService {
  private readonly shotService: Pick<ShotService, 'create'>;
  private readonly layerService: Pick<
    LayerService,
    'createFromAsset' | 'setBackground'
  >;

  constructor(options: SceneCreationServiceOptions = {}) {
    this.shotService = options.shotService ?? new ShotService();
    this.layerService = options.layerService ?? new LayerService();
  }

  create(projectInput: Project, rawInput: string): SceneCreationResult {
    const project = ProjectSchema.parse(projectInput);
    const input = parseStructuredSceneInput(rawInput);
    const background = namedImage(project, input.backgroundName);

    const characters = project.characters.filter(
      (character) => character.name === input.characterName,
    );
    if (characters.length === 0) {
      throw new SceneCreationError(
        'CHARACTER_NOT_FOUND',
        `当前工程中找不到名为“${input.characterName}”的角色。`,
      );
    }
    if (characters.length > 1) {
      throw new SceneCreationError(
        'CHARACTER_AMBIGUOUS',
        `当前工程中有多个名为“${input.characterName}”的角色，无法安全选择。`,
      );
    }
    const character = characters[0]!;
    if (character.mode !== 'composite') {
      throw new SceneCreationError(
        'CHARACTER_NOT_ASSEMBLED',
        `“${input.characterName}”还不是已组装的可编辑角色。`,
      );
    }

    const expression = character.expressions.find(
      (candidate) => candidate.id === character.defaultExpressionId,
    );
    const characterAssetIds = [
      character.bodyAssetId,
      ...character.expressions.map((candidate) => candidate.assetId),
      ...(character.head ? [character.head.assetId] : []),
      ...(character.mouthOpenAssetId ? [character.mouthOpenAssetId] : []),
    ];
    const unavailableCharacterAsset = characterAssetIds.some((assetId) => {
      const asset = project.assets.find(
        (candidate) => candidate.id === assetId,
      );
      return !asset || asset.kind !== 'image' || asset.metadata?.status === 'error';
    });
    if (!expression || unavailableCharacterAsset) {
      throw new SceneCreationError(
        'CHARACTER_ASSET_UNAVAILABLE',
        `角色“${input.characterName}”引用了不可用的图片素材。`,
      );
    }

    let next: Project;
    try {
      next = this.shotService.create(project, {
        name: input.shotName,
        durationMs: 3_000,
      });
    } catch (error) {
      if (
        error instanceof ShotServiceError &&
        error.code === 'DUPLICATE_SHOT_NAME'
      ) {
        throw new SceneCreationError(
          'SHOT_NAME_CONFLICT',
          error.message,
          { cause: error },
        );
      }
      throw error;
    }

    const shot = next.shots.at(-1);
    if (!shot) {
      throw new SceneCreationError(
        'GENERATED_SCENE_INVALID',
        '创建镜头失败，没有生成可编辑的镜头。',
      );
    }

    const backgroundLayer = this.layerService.createFromAsset(
      next,
      shot.id,
      {
        version: 2,
        assetId: background.id,
        type: 'asset-image',
        position: { x: PROJECT_WIDTH / 2, y: PROJECT_HEIGHT / 2 },
      },
    );
    next = this.layerService.setBackground(
      backgroundLayer.project,
      shot.id,
      backgroundLayer.layer.id,
    );
    const characterLayer = this.layerService.createFromAsset(
      next,
      shot.id,
      {
        version: 2,
        assetId: expression.assetId,
        type: 'character-expression',
        characterId: character.id,
        expressionId: expression.id,
        position: { x: PROJECT_WIDTH / 2, y: PROJECT_HEIGHT * 0.73 },
      },
    );
    next = ProjectSchema.parse(characterLayer.project);

    const createdShot = next.shots.find(
      (candidate) => candidate.id === shot.id,
    );
    const existingShots = next.shots.filter(
      (candidate) => candidate.id !== shot.id,
    );
    const projectWithOnlySceneChanges = {
      ...next,
      shots: project.shots,
      updatedAt: project.updatedAt,
    };
    if (
      !createdShot ||
      next.shots.length !== project.shots.length + 1 ||
      JSON.stringify(existingShots) !== JSON.stringify(project.shots) ||
      JSON.stringify(projectWithOnlySceneChanges) !== JSON.stringify(project) ||
      createdShot.layers.length !== 2 ||
      createdShot.backgroundLayerId !== backgroundLayer.layer.id ||
      createdShot.layers.some(
        (layer) =>
          layer.source.kind === 'asset' &&
          layer.source.assetId === background.id,
      ) !== true ||
      createdShot.layers.some(
        (layer) =>
          layer.source.kind === 'character' &&
          layer.source.characterId === character.id &&
          layer.source.expressionId === expression.id,
      ) !== true
    ) {
      throw new SceneCreationError(
        'GENERATED_SCENE_INVALID',
        '新镜头没有通过完整性检查，工程未提交。',
      );
    }

    return {
      project: next,
      shotId: createdShot.id,
      backgroundLayerId: backgroundLayer.layer.id,
      characterLayerId: characterLayer.layer.id,
      backgroundAssetId: background.id,
      characterId: character.id,
      expressionId: expression.id,
    };
  }
}
