import {
  DEFAULT_SHOT_CAMERA,
  ProjectSchema,
  type Layer,
  type Project,
  type Shot,
  type ShotTemplate,
  type TimelineEvent,
} from '../models';
import { SHOT_MIN_DURATION_MS } from '../constants';

export type ShotServiceErrorCode =
  | 'SHOT_NOT_FOUND'
  | 'DUPLICATE_SHOT_NAME'
  | 'INVALID_SHOT_DURATION'
  | 'SHOT_CONTENT_OUT_OF_RANGE'
  | 'INVALID_SHOT_ORDER'
  | 'SHOT_TEMPLATE_NOT_FOUND'
  | 'INVALID_SHOT_TEMPLATE_NAME'
  | 'SHOT_STRUCTURE_INVALID'
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

export interface SaveShotAsTemplateInput {
  shotId: string;
  name: string;
}

export interface CreateShotFromTemplateInput {
  templateId: string;
  shotName: string;
}

/** The structural part of a Shot a template snapshot can own. */
interface ShotStructure {
  readonly layers: readonly Layer[];
  readonly backgroundLayerId: string | null;
  readonly timelineEvents: readonly TimelineEvent[];
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
      camera: DEFAULT_SHOT_CAMERA,
    };
    return this.replaceShots(project, [...project.shots, shot]);
  }

  duplicate(project: Project, shotId: string): Project {
    const sourceIndex = this.shotIndex(project, shotId);
    const source = project.shots[sourceIndex]!;
    const usedIds = this.projectIds(project);
    const structure = this.remapShotStructure(source, usedIds);
    const audioClipIds = new Map(
      source.audioClips.map((clip) => [
        clip.id,
        this.nextUniqueId(usedIds),
      ]),
    );
    const duplicate: Shot = {
      ...source,
      ...structure,
      id: this.nextUniqueId(usedIds),
      name: this.copyName(project, source.name),
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

  /**
   * Saves one Shot as a project-local template snapshot. The template owns its
   * own Layer / TimelineEvent IDs and never keeps a link back to the source
   * Shot, so editing or deleting that Shot cannot change the template.
   */
  saveAsTemplate(project: Project, input: SaveShotAsTemplateInput): Project {
    const source = project.shots[this.shotIndex(project, input.shotId)]!;
    const name = this.validTemplateName(input.name);
    const usedIds = this.projectIds(project);
    const template: ShotTemplate = {
      id: this.nextUniqueId(usedIds),
      name,
      createdAt: this.now().toISOString(),
      durationMs: source.durationMs,
      defaultSubtitleStyleId: source.defaultSubtitleStyleId,
      ...this.remapShotStructure(source, usedIds),
    };
    return this.commit(project, {
      shotTemplates: [...project.shotTemplates, template],
    });
  }

  /**
   * Instantiates a template as a brand new Shot at the end of the list. Every
   * instance-level ID is freshly allocated and the episode-specific dialogues
   * and audio clips intentionally start empty.
   */
  createFromTemplate(
    project: Project,
    input: CreateShotFromTemplateInput,
  ): Project {
    const template = this.template(project, input.templateId);
    const name = this.validName(project, input.shotName);
    const usedIds = this.projectIds(project);
    const shot: Shot = {
      id: this.nextUniqueId(usedIds),
      name,
      durationMs: template.durationMs,
      defaultSubtitleStyleId: template.defaultSubtitleStyleId,
      ...this.remapShotStructure(template, usedIds),
      dialogues: [],
      audioClips: [],
      // A template stores structure only; a new Shot starts at the historical
      // full-stage framing, exactly like a hand-authored Shot.
      camera: DEFAULT_SHOT_CAMERA,
    };
    return this.commit(project, { shots: [...project.shots, shot] });
  }

  removeTemplate(project: Project, templateId: string): Project {
    this.template(project, templateId);
    return this.commit(project, {
      shotTemplates: project.shotTemplates.filter(
        (template) => template.id !== templateId,
      ),
    });
  }

  private template(project: Project, templateId: string): ShotTemplate {
    const template = project.shotTemplates.find(
      (candidate) => candidate.id === templateId,
    );
    if (!template) {
      throw new ShotServiceError(
        'SHOT_TEMPLATE_NOT_FOUND',
        `找不到镜头模板：${templateId}`,
      );
    }
    return template;
  }

  private validTemplateName(rawName: string): string {
    const name = rawName.trim();
    if (!name) {
      throw new ShotServiceError(
        'INVALID_SHOT_TEMPLATE_NAME',
        '请输入模板名称。',
      );
    }
    if (name.length > 200) {
      throw new ShotServiceError(
        'INVALID_SHOT_TEMPLATE_NAME',
        '模板名称最多 200 个字符。',
      );
    }
    return name;
  }

  /**
   * The single Layer / background / TimelineEvent remap core shared by Shot
   * duplication, template saving and template instantiation. Rotation, scale,
   * flip, opacity, zIndex and project-level resource references are copied
   * as-is; only IDs are replaced.
   */
  private remapShotStructure(
    structure: ShotStructure,
    usedIds: Set<string>,
  ): {
    layers: Layer[];
    backgroundLayerId: string | null;
    timelineEvents: TimelineEvent[];
  } {
    const layerIds = new Map<string, string>();
    for (const layer of structure.layers) {
      layerIds.set(layer.id, this.nextUniqueId(usedIds));
    }
    if (
      structure.backgroundLayerId !== null &&
      !layerIds.has(structure.backgroundLayerId)
    ) {
      throw new ShotServiceError(
        'SHOT_STRUCTURE_INVALID',
        `镜头结构引用了不存在的背景图层：${structure.backgroundLayerId}`,
      );
    }
    return {
      layers: structure.layers.map((layer) => ({
        ...layer,
        id: layerIds.get(layer.id)!,
      })),
      backgroundLayerId:
        structure.backgroundLayerId === null
          ? null
          : layerIds.get(structure.backgroundLayerId)!,
      timelineEvents: structure.timelineEvents.map((event) => {
        const layerId = layerIds.get(event.layerId);
        if (!layerId) {
          throw new ShotServiceError(
            'SHOT_STRUCTURE_INVALID',
            `时间轴事件引用了不存在的图层：${event.layerId}`,
          );
        }
        return { ...event, id: this.nextUniqueId(usedIds), layerId };
      }),
    };
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
        ...(character.mode === 'adaptive-parts'
          ? character.parts.map((part) => part.partId)
          : character.expressions.map((expression) => expression.id)),
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
    // Template-internal IDs share the same project-wide namespace: a new Shot
    // must never reuse a Layer/Event ID that a persisted template already owns.
    for (const template of project.shotTemplates) {
      ids.add(template.id);
      template.layers.forEach((layer) => ids.add(layer.id));
      template.timelineEvents.forEach((event) => ids.add(event.id));
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
    return this.commit(project, { shots });
  }

  private commit(
    project: Project,
    changes: Partial<Pick<Project, 'shots' | 'shotTemplates'>>,
  ): Project {
    return ProjectSchema.parse({
      ...project,
      ...changes,
      updatedAt: this.now().toISOString(),
    });
  }
}
