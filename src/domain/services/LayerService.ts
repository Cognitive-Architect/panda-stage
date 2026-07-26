import {
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
} from '../constants';
import type { Point } from '../geometry';
import {
  ProjectSchema,
  type Layer,
  type Project,
  type Shot,
} from '../models';

export type LayerPlacementAssetType =
  | 'character-image'
  | 'background-image'
  | 'audio';

export type LayerServiceErrorCode =
  | 'SHOT_NOT_FOUND'
  | 'LAYER_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_TYPE_MISMATCH'
  | 'INVALID_POSITION'
  | 'LAYER_LOCKED'
  | 'ID_GENERATION_FAILED';

export class LayerServiceError extends Error {
  constructor(
    readonly code: LayerServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LayerServiceError';
  }
}

export interface CreateLayerInput {
  assetId: string;
  type: LayerPlacementAssetType;
  position: Point;
}

export interface LayerServiceOptions {
  createId?: () => string;
  now?: () => Date;
}

export interface CreateLayerResult {
  project: Project;
  layer: Layer;
}

export function clampLayerPosition(point: Point): Point {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new LayerServiceError(
      'INVALID_POSITION',
      '图层坐标必须是有限数字。',
    );
  }
  return {
    x: Math.min(PROJECT_WIDTH, Math.max(0, point.x)),
    y: Math.min(PROJECT_HEIGHT, Math.max(0, point.y)),
  };
}

function validateLayerPosition(point: Point): Point {
  const position = clampLayerPosition(point);
  if (position.x !== point.x || position.y !== point.y) {
    throw new LayerServiceError(
      'INVALID_POSITION',
      `图层坐标必须位于 0–${PROJECT_WIDTH} 和 0–${PROJECT_HEIGHT} 之间。`,
    );
  }
  return position;
}

export class LayerService {
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: LayerServiceOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  createFromAsset(
    project: Project,
    shotId: string,
    input: CreateLayerInput,
  ): CreateLayerResult {
    const shot = this.shot(project, shotId);
    const asset = project.assets.find(
      (candidate) => candidate.id === input.assetId,
    );
    if (!asset) {
      throw new LayerServiceError(
        'ASSET_NOT_FOUND',
        `找不到素材：${input.assetId}`,
      );
    }
    if (asset.kind !== 'image' || input.type === 'audio') {
      throw new LayerServiceError(
        'ASSET_TYPE_MISMATCH',
        '只有图片素材可以放入画布。',
      );
    }

    const characterMatch = project.characters
      .flatMap((character) =>
        character.expressions.map((expression) => ({
          character,
          expression,
        })),
      )
      .find(({ expression }) => expression.assetId === asset.id);
    const characterAssetIds = new Set(
      project.characters.flatMap((character) => [
        character.baseAssetId,
        ...character.expressions.map((expression) => expression.assetId),
        ...(character.mouthOpenAssetId
          ? [character.mouthOpenAssetId]
          : []),
      ]),
    );
    if (
      (input.type === 'character-image' && !characterMatch) ||
      (input.type === 'background-image' &&
        characterAssetIds.has(asset.id))
    ) {
      throw new LayerServiceError(
        'ASSET_TYPE_MISMATCH',
        '素材类型与受控拖放载荷不一致。',
      );
    }

    const usedIds = this.projectIds(project);
    const position = clampLayerPosition(input.position);
    const scale =
      input.type === 'character-image'
        ? characterMatch!.character.defaultScale
        : 1;
    const layer: Layer = {
      id: this.nextUniqueId(usedIds),
      name: asset.name,
      source:
        input.type === 'character-image'
          ? {
              kind: 'character',
              characterId: characterMatch!.character.id,
              expressionId: characterMatch!.expression.id,
            }
          : { kind: 'asset', assetId: asset.id },
      anchor: 'center',
      x: position.x,
      y: position.y,
      scaleX: scale,
      scaleY: scale,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: Math.max(-1, ...shot.layers.map((item) => item.zIndex)) + 1,
    };
    const nextShot = {
      ...shot,
      layers: [...shot.layers, layer],
    };
    return {
      project: this.replaceShot(project, nextShot),
      layer,
    };
  }

  updatePosition(
    project: Project,
    shotId: string,
    layerId: string,
    rawPosition: Point,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    if (layer.locked) {
      throw new LayerServiceError(
        'LAYER_LOCKED',
        `图层“${layer.name}”已锁定，无法移动。`,
      );
    }
    const position = validateLayerPosition(rawPosition);
    if (layer.x === position.x && layer.y === position.y) {
      return project;
    }
    const layers = [...shot.layers];
    layers[layerIndex] = { ...layer, ...position };
    return this.replaceShot(project, { ...shot, layers });
  }

  setLocked(
    project: Project,
    shotId: string,
    layerId: string,
    locked: boolean,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    if (layer.locked === locked) return project;
    const layers = [...shot.layers];
    layers[layerIndex] = { ...layer, locked };
    return this.replaceShot(project, { ...shot, layers });
  }

  private shot(project: Project, shotId: string): Shot {
    const shot = project.shots.find((candidate) => candidate.id === shotId);
    if (!shot) {
      throw new LayerServiceError(
        'SHOT_NOT_FOUND',
        `找不到镜头：${shotId}`,
      );
    }
    return shot;
  }

  private layerIndex(shot: Shot, layerId: string): number {
    const index = shot.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) {
      throw new LayerServiceError(
        'LAYER_NOT_FOUND',
        `找不到图层：${layerId}`,
      );
    }
    return index;
  }

  private replaceShot(project: Project, shot: Shot): Project {
    return ProjectSchema.parse({
      ...project,
      shots: project.shots.map((candidate) =>
        candidate.id === shot.id ? shot : candidate,
      ),
      updatedAt: this.now().toISOString(),
    });
  }

  private projectIds(project: Project): Set<string> {
    return new Set([
      project.id,
      ...project.assets.map((asset) => asset.id),
      ...project.characters.flatMap((character) => [
        character.id,
        ...character.expressions.map((expression) => expression.id),
      ]),
      ...project.voiceProfiles.map((profile) => profile.id),
      ...project.subtitleStyles.map((style) => style.id),
      ...project.shots.flatMap((shot) => [
        shot.id,
        ...shot.layers.map((layer) => layer.id),
        ...shot.audioClips.map((clip) => clip.id),
        ...shot.dialogues.map((dialogue) => dialogue.id),
        ...shot.timelineEvents.map((event) => event.id),
      ]),
    ]);
  }

  private nextUniqueId(usedIds: Set<string>): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = this.createId();
      if (!usedIds.has(id)) return id;
    }
    throw new LayerServiceError(
      'ID_GENERATION_FAILED',
      '生成图层 ID 失败，请重试。',
    );
  }
}
