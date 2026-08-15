import {
  ProjectSchema,
  type Project,
  type Shot,
} from '../models';
import { SHOT_MIN_DURATION_MS } from '../constants';

export type ShotServiceErrorCode =
  | 'SHOT_NOT_FOUND'
  | 'DUPLICATE_SHOT_NAME'
  | 'INVALID_SHOT_DURATION'
  | 'SHOT_CONTENT_OUT_OF_RANGE'
  | 'INVALID_SHOT_ORDER'
  | 'ID_GENERATION_FAILED';

export class ShotServiceError extends Error {
  constructor(
    readonly code: ShotServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ShotServiceError';
  }
}

export interface CreateShotInput {
  name: string;
  durationMs: number;
}

export interface ShotServiceOptions {
  createId?: () => string;
  now?: () => Date;
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function maximumContentEndMs(shot: Shot): number {
  return Math.max(
    0,
    ...shot.audioClips.map((clip) => clip.endMs),
    ...shot.dialogues.map((dialogue) => dialogue.endMs),
    ...shot.timelineEvents.map((event) => event.endMs),
  );
}

export class ShotService {
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: ShotServiceOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  create(project: Project, input: CreateShotInput): Project {
    const name = this.validName(project, input.name);
    const durationMs = this.validDuration(input.durationMs);
    const defaultSubtitleStyleId = project.subtitleStyles[0]?.id;
    if (!defaultSubtitleStyleId) {
      throw new ShotServiceError(
        'SHOT_NOT_FOUND',
        '项目缺少默认字幕样式，无法创建镜头。',
      );
    }
    const usedIds = this.projectIds(project);
    const shot: Shot = {
      id: this.nextUniqueId(usedIds),
      name,
      durationMs,
      defaultSubtitleStyleId,
      layers: [],
      backgroundLayerId: null,
      dialogues: [],
      audioClips: [],
      timelineEvents: [],
    };
    return this.replaceShots(project, [...project.shots, shot]);
  }

  duplicate(project: Project, shotId: string): Project {
    const sourceIndex = this.shotIndex(project, shotId);
    const source = project.shots[sourceIndex]!;
    const usedIds = this.projectIds(project);
    const layerIds = new Map(
      source.layers.map((layer) => [
        layer.id,
        this.nextUniqueId(usedIds),
      ]),
    );
    const audioClipIds = new Map(
      source.audioClips.map((clip) => [
        clip.id,
        this.nextUniqueId(usedIds),
      ]),
    );
    const duplicate: Shot = {
      ...source,
      id: this.nextUniqueId(usedIds),
      name: this.copyName(project, source.name),
      layers: source.layers.map((layer) => ({
        ...layer,
        id: layerIds.get(layer.id)!,
      })),
      backgroundLayerId:
        source.backgroundLayerId === null
          ? null
          : layerIds.get(source.backgroundLayerId)!,
      audioClips: source.audioClips.map((clip) => ({
        ...clip,
        id: audioClipIds.get(clip.id)!,
      })),
      dialogues: source.dialogues.map((dialogue) => ({
        ...dialogue,
        id: this.nextUniqueId(usedIds),
        audioClipId:
          dialogue.audioClipId === undefined
            ? undefined
            : audioClipIds.get(dialogue.audioClipId),
      })),
      timelineEvents: source.timelineEvents.map((event) => ({
        ...event,
        id: this.nextUniqueId(usedIds),
        layerId: layerIds.get(event.layerId)!,
      })),
    };
    const shots = [...project.shots];
    shots.splice(sourceIndex + 1, 0, duplicate);
    return this.replaceShots(project, shots);
  }

  rename(project: Project, shotId: string, rawName: string): Project {
    const index = this.shotIndex(project, shotId);
    const name = this.validName(project, rawName, shotId);
    const shots = [...project.shots];
    shots[index] = { ...shots[index]!, name };
    return this.replaceShots(project, shots);
  }

  setDuration(
    project: Project,
    shotId: string,
    rawDurationMs: number,
  ): Project {
    const index = this.shotIndex(project, shotId);
    const durationMs = this.validDuration(rawDurationMs);
    const shot = project.shots[index]!;
    const contentEndMs = maximumContentEndMs(shot);
    if (durationMs < contentEndMs) {
      throw new ShotServiceError(
        'SHOT_CONTENT_OUT_OF_RANGE',
        `镜头内容延伸到 ${contentEndMs}ms，时长不能缩短到 ${durationMs}ms。`,
      );
    }
    const shots = [...project.shots];
    shots[index] = { ...shot, durationMs };
    return this.replaceShots(project, shots);
  }

  remove(project: Project, shotId: string): Project {
    const index = this.shotIndex(project, shotId);
    return this.replaceShots(
      project,
      project.shots.filter((_, candidateIndex) => candidateIndex !== index),
    );
  }

  move(project: Project, shotId: string, targetIndex: number): Project {
    const sourceIndex = this.shotIndex(project, shotId);
    if (
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= project.shots.length
    ) {
      throw new ShotServiceError(
        'INVALID_SHOT_ORDER',
        `目标顺序 ${targetIndex} 超出镜头列表范围。`,
      );
    }
    if (sourceIndex === targetIndex) return project;
    const shots = [...project.shots];
    const [shot] = shots.splice(sourceIndex, 1);
    shots.splice(targetIndex, 0, shot!);
    return this.replaceShots(project, shots);
  }

  private validName(
    project: Project,
    rawName: string,
    ignoredShotId?: string,
  ): string {
    const name = rawName.trim();
    if (
      project.shots.some(
        (shot) =>
          shot.id !== ignoredShotId &&
          normalizedName(shot.name) === normalizedName(name),
      )
    ) {
      throw new ShotServiceError(
        'DUPLICATE_SHOT_NAME',
        `镜头名称“${name}”已存在，请使用不同名称。`,
      );
    }
    return name;
  }

  private validDuration(rawDurationMs: number): number {
    if (
      !Number.isFinite(rawDurationMs) ||
      !Number.isInteger(rawDurationMs) ||
      rawDurationMs < SHOT_MIN_DURATION_MS
    ) {
      throw new ShotServiceError(
        'INVALID_SHOT_DURATION',
        `镜头时长必须是整数且不少于 ${SHOT_MIN_DURATION_MS}ms。`,
      );
    }
    return rawDurationMs;
  }

  private shotIndex(project: Project, shotId: string): number {
    const index = project.shots.findIndex((shot) => shot.id === shotId);
    if (index < 0) {
      throw new ShotServiceError(
        'SHOT_NOT_FOUND',
        `找不到镜头：${shotId}`,
      );
    }
    return index;
  }

  private copyName(project: Project, sourceName: string): string {
    const names = new Set(project.shots.map((shot) => normalizedName(shot.name)));
    const base = `${sourceName} 副本`;
    if (!names.has(normalizedName(base))) return base;
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidate = `${base} ${suffix}`;
      if (!names.has(normalizedName(candidate))) return candidate;
    }
    throw new ShotServiceError(
      'DUPLICATE_SHOT_NAME',
      `无法为镜头“${sourceName}”生成唯一副本名称。`,
    );
  }

  private projectIds(project: Project): Set<string> {
    const ids = new Set<string>([
      project.id,
      ...project.assets.map((asset) => asset.id),
      ...project.characters.flatMap((character) => [
        character.id,
        ...character.expressions.map((expression) => expression.id),
      ]),
      ...project.voiceProfiles.map((profile) => profile.id),
      ...project.subtitleStyles.map((style) => style.id),
    ]);
    for (const shot of project.shots) {
      ids.add(shot.id);
      shot.layers.forEach((layer) => ids.add(layer.id));
      shot.audioClips.forEach((clip) => ids.add(clip.id));
      shot.dialogues.forEach((dialogue) => ids.add(dialogue.id));
      shot.timelineEvents.forEach((event) => ids.add(event.id));
    }
    return ids;
  }

  private nextUniqueId(usedIds: Set<string>): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = this.createId();
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
    }
    throw new ShotServiceError(
      'ID_GENERATION_FAILED',
      '生成镜头副本 ID 失败，请重试。',
    );
  }

  private replaceShots(project: Project, shots: Shot[]): Project {
    return ProjectSchema.parse({
      ...project,
      shots,
      updatedAt: this.now().toISOString(),
    });
  }
}
