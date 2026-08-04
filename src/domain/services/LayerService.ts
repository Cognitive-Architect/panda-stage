import {
  LAYER_MAX_SCALE,
  LAYER_MIN_SCALE,
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
import type { AssetDropPayload } from '../assetDropPayload';

export type LayerServiceErrorCode =
  | 'SHOT_NOT_FOUND'
  | 'LAYER_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_TYPE_MISMATCH'
  | 'BACKGROUND_LAYER_INVALID'
  | 'CHARACTER_IDENTITY_MISMATCH'
  | 'INVALID_POSITION'
  | 'INVALID_TRANSFORM'
  | 'BACKGROUND_LAYER_PROTECTED'
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

export type CreateLayerInput = AssetDropPayload & {
  position: Point;
};

export interface LayerServiceOptions {
  createId?: () => string;
  now?: () => Date;
}

export interface CreateLayerResult {
  project: Project;
  layer: Layer;
}

export interface LayerTransformInput {
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
  opacity: number;
  flipX: boolean;
}

export type LayerOrderAction =
  | 'forward'
  | 'backward'
  | 'front'
  | 'back';

export function normalizeLayerRotation(rotationDeg: number): number {
  if (!Number.isFinite(rotationDeg)) {
    throw new LayerServiceError(
      'INVALID_TRANSFORM',
      '图层旋转角度必须是有限数字。',
    );
  }
  const normalized = ((rotationDeg + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function validateLayerScale(scale: number): number {
  if (
    !Number.isFinite(scale) ||
    scale < LAYER_MIN_SCALE ||
    scale > LAYER_MAX_SCALE
  ) {
    throw new LayerServiceError(
      'INVALID_TRANSFORM',
      `图层缩放必须是 ${LAYER_MIN_SCALE}–${LAYER_MAX_SCALE} 之间的有限数字。`,
    );
  }
  return scale;
}

function validateLayerOpacity(opacity: number): number {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new LayerServiceError(
      'INVALID_TRANSFORM',
      '图层不透明度必须是 0–1 之间的有限数字。',
    );
  }
  return opacity;
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

    const expressionAssetIds = new Set(
      project.characters.flatMap((character) => [
        ...character.expressions.map((expression) => expression.assetId),
      ]),
    );
    if (input.type === 'asset-image' && expressionAssetIds.has(asset.id)) {
      throw new LayerServiceError(
        'ASSET_TYPE_MISMATCH',
        '素材类型与受控拖放载荷不一致。',
      );
    }

    const character =
      input.type === 'character-expression'
        ? project.characters.find(
            (candidate) => candidate.id === input.characterId,
          )
        : undefined;
    const expression =
      input.type === 'character-expression'
        ? character?.expressions.find(
            (candidate) => candidate.id === input.expressionId,
          )
        : undefined;
    if (
      input.type === 'character-expression' &&
      (!character ||
        !expression ||
        expression.assetId !== input.assetId)
    ) {
      throw new LayerServiceError(
        'CHARACTER_IDENTITY_MISMATCH',
        '角色、表情与图片素材的身份关系不一致。',
      );
    }

    const usedIds = this.projectIds(project);
    const position = clampLayerPosition(input.position);
    const scale =
      input.type === 'character-expression'
        ? character!.defaultScale
        : 1;
    const layer: Layer = {
      id: this.nextUniqueId(usedIds),
      name: asset.name,
      source:
        input.type === 'character-expression'
          ? {
              kind: 'character',
              characterId: character!.id,
              expressionId: expression!.id,
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
      flipX:
        input.type === 'character-expression'
          ? character!.defaultFlipX
          : false,
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

  setBackground(
    project: Project,
    shotId: string,
    layerId: string,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    const assetId =
      layer.source.kind === 'asset' ? layer.source.assetId : undefined;
    const asset = assetId
      ? project.assets.find((candidate) => candidate.id === assetId)
      : undefined;

    if (!asset || asset.kind !== 'image') {
      throw new LayerServiceError(
        'BACKGROUND_LAYER_INVALID',
        '只有直接引用图片素材的图层才能设为镜头背景。',
      );
    }
    if (shot.backgroundLayerId === layer.id) {
      if (layer.locked) return project;
      const layers = [...shot.layers];
      layers[layerIndex] = { ...layer, locked: true, zIndex: 0 };
      return this.replaceShot(project, {
        ...shot,
        layers: this.normalizeLayerOrder(
          { ...shot, layers },
          layers
            .filter((candidate) => candidate.id !== layer.id)
            .sort((left, right) => left.zIndex - right.zIndex),
        ),
      });
    }

    const orderedContent = shot.layers
      .filter((candidate) => candidate.id !== layer.id)
      .sort((left, right) => left.zIndex - right.zIndex);
    const layers = [
      {
        ...layer,
        x: PROJECT_WIDTH / 2,
        y: PROJECT_HEIGHT / 2,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        flipX: false,
        locked: true,
        zIndex: 0,
      },
      ...orderedContent.map((candidate, index) => ({
        ...candidate,
        zIndex: index + 1,
      })),
    ];

    return this.replaceShot(project, {
      ...shot,
      backgroundLayerId: layer.id,
      layers,
    });
  }

  clearBackground(project: Project, shotId: string): Project {
    const shot = this.shot(project, shotId);
    if (!shot.backgroundLayerId) return project;
    const background = shot.layers.find(
      (candidate) => candidate.id === shot.backgroundLayerId,
    );
    if (!background) {
      throw new LayerServiceError(
        'LAYER_NOT_FOUND',
        `鎵句笉鍒板浘灞傦細${shot.backgroundLayerId}`,
      );
    }
    const layers = shot.layers
      .map((candidate) =>
        candidate.id === background.id
          ? { ...candidate, locked: false }
          : candidate,
      )
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((candidate, index) => ({
        ...candidate,
        zIndex: index,
      }));
    return this.replaceShot(project, {
      ...shot,
      backgroundLayerId: null,
      layers,
    });
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

  updateTransform(
    project: Project,
    shotId: string,
    layerId: string,
    input: LayerTransformInput,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    this.assertEditable(shot, layer);
    const position = validateLayerPosition({ x: input.x, y: input.y });
    const scale = validateLayerScale(input.scale);
    const rotationDeg = normalizeLayerRotation(input.rotationDeg);
    const opacity = validateLayerOpacity(input.opacity);
    const replacement: Layer = {
      ...layer,
      ...position,
      scaleX: scale,
      scaleY: scale,
      rotationDeg,
      opacity,
      flipX: input.flipX,
    };
    if (
      layer.x === replacement.x &&
      layer.y === replacement.y &&
      layer.scaleX === replacement.scaleX &&
      layer.scaleY === replacement.scaleY &&
      layer.rotationDeg === replacement.rotationDeg &&
      layer.opacity === replacement.opacity &&
      layer.flipX === replacement.flipX
    ) {
      return project;
    }
    const layers = [...shot.layers];
    layers[layerIndex] = replacement;
    return this.replaceShot(project, { ...shot, layers });
  }

  toggleFlipX(
    project: Project,
    shotId: string,
    layerId: string,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    this.assertEditable(shot, layer);
    const layers = [...shot.layers];
    layers[layerIndex] = { ...layer, flipX: !layer.flipX };
    return this.replaceShot(project, { ...shot, layers });
  }

  reorder(
    project: Project,
    shotId: string,
    layerId: string,
    action: LayerOrderAction,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);
    const ordered = shot.layers
      .filter((candidate) => candidate.id !== shot.backgroundLayerId)
      .sort((left, right) => left.zIndex - right.zIndex);
    const currentIndex = ordered.findIndex(
      (candidate) => candidate.id === layer.id,
    );
    const targetIndex =
      action === 'front'
        ? ordered.length - 1
        : action === 'back'
          ? 0
          : action === 'forward'
            ? Math.min(ordered.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
    if (targetIndex === currentIndex) return project;
    ordered.splice(currentIndex, 1);
    ordered.splice(targetIndex, 0, layer);
    return this.replaceShot(project, {
      ...shot,
      layers: this.normalizeLayerOrder(shot, ordered),
    });
  }

  deleteLayer(
    project: Project,
    shotId: string,
    layerId: string,
  ): Project {
    const shot = this.shot(project, shotId);
    const layerIndex = this.layerIndex(shot, layerId);
    const layer = shot.layers[layerIndex]!;
    this.assertContentLayer(shot, layer);
    this.assertEditable(shot, layer);
    const remaining = shot.layers.filter(
      (candidate) => candidate.id !== layer.id,
    );
    const remainingShot = { ...shot, layers: remaining };
    return this.replaceShot(project, {
      ...remainingShot,
      layers: this.normalizeLayerOrder(
        remainingShot,
        remaining
          .filter(
            (candidate) => candidate.id !== shot.backgroundLayerId,
          )
          .sort((left, right) => left.zIndex - right.zIndex),
      ),
      timelineEvents: shot.timelineEvents.filter(
        (event) => event.layerId !== layer.id,
      ),
    });
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

  private assertEditable(_shot: Shot, layer: Layer): void {
    if (layer.locked) {
      throw new LayerServiceError(
        'LAYER_LOCKED',
        `图层“${layer.name}”已锁定，请先解锁。`,
      );
    }
  }

  private assertContentLayer(shot: Shot, layer: Layer): void {
    if (shot.backgroundLayerId === layer.id) {
      throw new LayerServiceError(
        'BACKGROUND_LAYER_PROTECTED',
        '背景图层不能通过普通图层层级工具排序或删除。',
      );
    }
  }

  private normalizeLayerOrder(
    shot: Shot,
    orderedContent: readonly Layer[],
  ): Layer[] {
    const background = shot.backgroundLayerId
      ? shot.layers.find(
          (layer) => layer.id === shot.backgroundLayerId,
        )
      : undefined;
    const start = background ? 1 : 0;
    return [
      ...(background ? [{ ...background, zIndex: 0 }] : []),
      ...orderedContent.map((layer, index) => ({
        ...layer,
        zIndex: start + index,
      })),
    ];
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
