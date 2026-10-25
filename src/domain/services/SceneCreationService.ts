import {
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
} from '../constants';
import {
  ProjectSchema,
  type Asset,
  type Character,
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
    options?: SceneCreationErrorOptions,
  ) {
    super(message, options);
    this.name = 'SceneCreationError';
    this.field = options?.field;
    this.lineNumber = options?.lineNumber;
  }

  readonly field?: SceneCreationField;
  readonly lineNumber?: number;
}

export interface SceneCreationErrorOptions extends ErrorOptions {
  field?: SceneCreationField;
  lineNumber?: number;
}

export interface SceneCreationCandidate<T> {
  value: T;
  selectable: boolean;
  errorCode?:
    | 'BACKGROUND_NOT_USABLE'
    | 'CHARACTER_NOT_ASSEMBLED'
    | 'CHARACTER_ASSET_UNAVAILABLE';
}

export interface SceneCreationResolution {
  input: StructuredSceneInput;
  backgroundCandidates: SceneCreationCandidate<Asset>[];
  characterCandidates: SceneCreationCandidate<Character>[];
}

export interface SceneCreationSelection {
  backgroundAssetId?: string;
  characterId?: string;
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
  for (const [lineIndex, rawLine] of lines.entries()) {
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
        { lineNumber: lineIndex + 1 },
      );
    }

    const label = line.slice(0, separatorIndex).trim();
    const field = REQUIRED_FIELDS.find((candidate) => candidate === label);
    if (!field) {
      throw new SceneCreationError(
        'UNKNOWN_FIELD',
        `不支持“${label || line}”字段。`,
        { lineNumber: lineIndex + 1 },
      );
    }
    if (fields[field] !== undefined) {
      throw new SceneCreationError(
        'DUPLICATE_FIELD',
        `“${field}”字段只能出现一次。`,
        { field, lineNumber: lineIndex + 1 },
      );
    }

    const value = line.slice(separatorIndex + 1).trim();
    if (!value) {
      throw new SceneCreationError(
        'EMPTY_FIELD',
        `“${field}”字段不能为空。`,
        { field, lineNumber: lineIndex + 1 },
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

function candidateError(
  code: SceneCreationCandidate<unknown>['errorCode'],
  name: string,
): string {
  if (code === 'BACKGROUND_NOT_USABLE') {
    return `“${name}”不是可用的背景图片素材。`;
  }
  if (code === 'CHARACTER_NOT_ASSEMBLED') {
    return `“${name}”还不是已组装的可编辑角色。`;
  }
  return `“${name}”引用了不可用的图片素材。`;
}

function characterCandidateError(
  project: Project,
  character: Character,
): SceneCreationCandidate<Character>['errorCode'] | undefined {
  if (character.mode !== 'composite') return 'CHARACTER_NOT_ASSEMBLED';
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
  return !expression || unavailableCharacterAsset
    ? 'CHARACTER_ASSET_UNAVAILABLE'
    : undefined;
}

function selectCandidate<T extends Asset | Character>(
  candidates: SceneCreationCandidate<T>[],
  selectionId: string | undefined,
  kind: 'background' | 'character',
  name: string,
): T {
  const notFoundCode =
    kind === 'background' ? 'BACKGROUND_NOT_FOUND' : 'CHARACTER_NOT_FOUND';
  const ambiguousCode =
    kind === 'background' ? 'BACKGROUND_AMBIGUOUS' : 'CHARACTER_AMBIGUOUS';
  if (candidates.length === 0) {
    throw new SceneCreationError(
      notFoundCode,
      kind === 'background'
        ? `当前工程中找不到名为“${name}”的图片素材。`
        : `当前工程中找不到名为“${name}”的角色。`,
    );
  }
  if (!selectionId && candidates.length > 1) {
    throw new SceneCreationError(
      ambiguousCode,
      kind === 'background'
        ? `当前工程中有多个名为“${name}”的素材，请先选择背景。`
        : `当前工程中有多个名为“${name}”的角色，请先选择角色。`,
    );
  }
  const selected = selectionId
    ? candidates.find(({ value }) => value.id === selectionId)
    : candidates[0];
  if (!selected) {
    throw new SceneCreationError(
      notFoundCode,
      `当前工程中找不到所选的“${name}”。`,
    );
  }
  if (!selected.selectable) {
    const code = selected.errorCode ??
      (kind === 'background'
        ? 'BACKGROUND_NOT_USABLE'
        : 'CHARACTER_ASSET_UNAVAILABLE');
    throw new SceneCreationError(
      code,
      candidateError(code, name),
    );
  }
  return selected.value;
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

  resolve(projectInput: Project, rawInput: string): SceneCreationResolution {
    const project = ProjectSchema.parse(projectInput);
    const input = parseStructuredSceneInput(rawInput);
    return {
      input,
      backgroundCandidates: project.assets
        .filter((asset) => asset.name === input.backgroundName)
        .map((asset): SceneCreationCandidate<Asset> => {
          const errorCode =
            asset.kind !== 'image' ||
            (asset.kind === 'image' &&
              (asset.usage !== 'background' || asset.metadata?.status === 'error'))
              ? 'BACKGROUND_NOT_USABLE'
              : undefined;
          return {
            value: asset,
            selectable: !errorCode,
            ...(errorCode ? { errorCode } : {}),
          };
        }),
      characterCandidates: project.characters
        .filter((character) => character.name === input.characterName)
        .map((character): SceneCreationCandidate<Character> => {
          const errorCode = characterCandidateError(project, character);
          return {
            value: character,
            selectable: !errorCode,
            ...(errorCode ? { errorCode } : {}),
          };
        }),
    };
  }

  create(
    projectInput: Project,
    rawInput: string,
    selection: SceneCreationSelection = {},
  ): SceneCreationResult {
    const project = ProjectSchema.parse(projectInput);
    const resolution = this.resolve(project, rawInput);
    const backgroundCandidate = selectCandidate(
      resolution.backgroundCandidates,
      selection.backgroundAssetId,
      'background',
      resolution.input.backgroundName,
    );
    if (backgroundCandidate.kind !== 'image') {
      throw new SceneCreationError(
        'BACKGROUND_NOT_USABLE',
        `“${resolution.input.backgroundName}”不是图片素材。`,
      );
    }
    const background = backgroundCandidate as ImageAsset;
    const character = selectCandidate(
      resolution.characterCandidates,
      selection.characterId,
      'character',
      resolution.input.characterName,
    );
    const input = resolution.input;
    if (character.mode !== 'composite') {
      throw new SceneCreationError(
        'CHARACTER_NOT_ASSEMBLED',
        `“${resolution.input.characterName}”还不是已组装的可编辑角色。`,
      );
    }
    const expression = character.expressions.find(
      (candidate) => candidate.id === character.defaultExpressionId,
    );
    if (!expression) {
      throw new SceneCreationError(
        'CHARACTER_ASSET_UNAVAILABLE',
        `角色“${resolution.input.characterName}”引用了不可用的图片素材。`,
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
