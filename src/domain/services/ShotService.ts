import {
  ProjectSchema,
  type Project,
  type Shot,
  type ShotCameraAutoFraming,
  type TimelineEvent,
} from '../models';
import { SHOT_MIN_DURATION_MS } from '../constants';
import { remapLayerMotionOwner } from '../layer-animation';
import { resolveCharacterActionForLayer } from '../character-part-animation';
import { setShotCameraAutoFraming } from '../shot-camera';
import {
  applyCameraMotionPreset as applyCameraMotionPresetToProject,
  type ApplyCameraMotionPresetInput,
} from '../camera-motion-presets';

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

export type ShotDuplicateMode = 'full' | 'structure-only';

/**
 * Options for `ShotService.duplicate`.
 *
 * WF-06 first vertical slice policy (Issue #1416):
 * - No new persisted schema is introduced; named/persistent shot templates are
 *   deferred to a later slice unless explicitly authorized.
 * - In `'structure-only'` mode, non-dialogue audio (BGM/SFX) is excluded by
 *   default (`includeNonDialogueAudio = false`) and can be explicitly retained.
 */
export interface DuplicateShotOptions {
  mode?: ShotDuplicateMode;
  includeNonDialogueAudio?: boolean;
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
    ...shot.layers.flatMap((layer) => layer.layerMotionTracks?.map((track) => track.keys.at(-1)?.timeMs ?? 0) ?? []),
    ...shot.layers.map((layer) => layer.depthKeys?.at(-1)?.timeMs ?? 0),
    ...shot.layers.map((layer) => layer.parentKeys?.at(-1)?.timeMs ?? 0),
    // #1471 R4: an authored pin-warp pose is content too. Shortening past the
    // last pose must use the same content-end rule instead of accepting a
    // duration that every later pin write is then rejected against.
    ...shot.layers.flatMap(
      (layer) => layer.pinWarp?.poses.map((pose) => pose.timeMs) ?? [],
    ),
    shot.camera?.keys.at(-1)?.timeMs ?? 0,
    ...(shot.camera?.overrides?.map((override) => override.endMs) ?? []),
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

  duplicate(
    project: Project,
    shotId: string,
    options: DuplicateShotOptions = {},
  ): Project {
    const mode: ShotDuplicateMode = options.mode ?? 'full';
    const includeNonDialogueAudio =
      mode === 'structure-only' && Boolean(options.includeNonDialogueAudio);
    const sourceIndex = this.shotIndex(project, shotId);
    const source = project.shots[sourceIndex]!;
    const usedIds = this.projectIds(project);

    const retainedLayers = source.layers;
    const retainedDialogues = mode === 'full' ? source.dialogues : [];
    const removedDialogueAudioClipIds =
      mode === 'structure-only'
        ? new Set(
            source.dialogues
              .map((dialogue) => dialogue.audioClipId)
              .filter((id): id is string => id !== undefined),
          )
        : new Set<string>();
    const retainedAudioClips =
      mode === 'full'
        ? source.audioClips
        : includeNonDialogueAudio
          ? source.audioClips.filter(
              (clip) =>
                clip.role !== 'dialogue' &&
                !removedDialogueAudioClipIds.has(clip.id),
            )
          : [];
    const retainedTimelineEvents =
      mode === 'full'
        ? source.timelineEvents
        : source.timelineEvents.filter(
            (event) =>
              !(
                event.type === 'mouth-pose' &&
                (event.origin === 'generated' || event.dialogueId !== undefined)
              ),
          );

    const layerIds = new Map(
      retainedLayers.map((layer) => [layer.id, this.nextUniqueId(usedIds)]),
    );
    const audioClipIds = new Map(
      retainedAudioClips.map((clip) => [clip.id, this.nextUniqueId(usedIds)]),
    );
    const dialogueIds = new Map(
      retainedDialogues.map((dialogue) => [
        dialogue.id,
        this.nextUniqueId(usedIds),
      ]),
    );
    const eventIds = new Map(
      retainedTimelineEvents.map((event) => [
        event.id,
        this.nextUniqueId(usedIds),
      ]),
    );
    const cameraOverrideIds = new Map(
      (source.camera?.overrides ?? []).map((override) => [
        override.id,
        this.nextUniqueId(usedIds),
      ]),
    );

    const retainedCharacterLayerIds = new Set(
      retainedLayers
        .filter((layer) => layer.source.kind === 'character')
        .map((layer) => layer.id),
    );
    const retainedCharacterActionEventOwners = new Map<string, string>();
    for (const event of retainedTimelineEvents) {
      if (event.type === 'character-action') {
        retainedCharacterActionEventOwners.set(event.id, event.layerId);
      }
    }

    const camera = source.camera
      ? (() => {
          const clonedCamera = structuredClone(source.camera);
          if (clonedCamera.overrides) {
            clonedCamera.overrides = clonedCamera.overrides.map((override) => ({
              ...override,
              id: cameraOverrideIds.get(override.id)!,
            }));
          }
          return clonedCamera;
        })()
      : undefined;

    const duplicate: Shot = {
      id: this.nextUniqueId(usedIds),
      name: this.copyName(project, source.name, mode),
      durationMs: source.durationMs,
      defaultSubtitleStyleId: source.defaultSubtitleStyleId,
      layers: retainedLayers.map((layer) => {
        const cloned = structuredClone(layer);
        const layerId = layerIds.get(layer.id)!;
        if (cloned.parentLayerId !== undefined) {
          const remappedParentId = layerIds.get(cloned.parentLayerId);
          if (remappedParentId !== undefined) {
            cloned.parentLayerId = remappedParentId;
          } else {
            delete cloned.parentLayerId;
            delete cloned.parentAttachment;
            delete cloned.parentSpaceOffset;
          }
        }
        if (cloned.parentKeys) {
          cloned.parentKeys = cloned.parentKeys.map((key) => {
            const remappedParentId = key.parentLayerId
              ? (layerIds.get(key.parentLayerId) ?? null)
              : null;
            const nextKey = {
              ...key,
              parentLayerId: remappedParentId,
            };
            if (remappedParentId === null) {
              delete nextKey.parentAttachment;
            }
            return nextKey;
          });
        }
        if (cloned.animationTimeLink) {
          const link = cloned.animationTimeLink;
          const remappedSourceLayerId = layerIds.get(link.sourceLayerId);
          const remappedEventId = eventIds.get(link.eventId);
          const validTarget =
            remappedSourceLayerId !== undefined &&
            remappedEventId !== undefined &&
            retainedCharacterLayerIds.has(link.sourceLayerId) &&
            retainedCharacterActionEventOwners.get(link.eventId) ===
              link.sourceLayerId;
          if (validTarget) {
            cloned.animationTimeLink = {
              ...link,
              sourceLayerId: remappedSourceLayerId,
              eventId: remappedEventId,
            };
          } else {
            delete cloned.animationTimeLink;
          }
        }
        if (cloned.maskTargets) {
          // Duplicating a Shot regenerates its Layer ids; keep the authored
          // coverage mask relationship inside the duplicated Shot.
          cloned.maskTargets = cloned.maskTargets
            .map((targetLayerId) => layerIds.get(targetLayerId))
            .filter((targetLayerId): targetLayerId is string => targetLayerId !== undefined);
        }
        return {
          ...cloned,
          id: layerId,
          ...remapLayerMotionOwner(cloned, layerId),
        };
      }),
      backgroundLayerId:
        source.backgroundLayerId === null
          ? null
          : (layerIds.get(source.backgroundLayerId) ?? null),
      audioClips: retainedAudioClips.map((clip) => ({
        ...structuredClone(clip),
        id: audioClipIds.get(clip.id)!,
      })),
      dialogues: retainedDialogues.map((dialogue) => ({
        ...structuredClone(dialogue),
        id: dialogueIds.get(dialogue.id)!,
        audioClipId:
          dialogue.audioClipId === undefined
            ? undefined
            : audioClipIds.get(dialogue.audioClipId),
      })),
      timelineEvents: retainedTimelineEvents.map((event) => {
        const cloned = structuredClone(event);
        return {
          ...cloned,
          id: eventIds.get(event.id)!,
          layerId: layerIds.get(event.layerId)!,
          ...(cloned.type === 'mouth-pose' && cloned.dialogueId
            ? { dialogueId: dialogueIds.get(cloned.dialogueId)! }
            : {}),
        };
      }),
      ...(camera !== undefined ? { camera } : {}),
    };
    duplicate.timelineEvents = this.rebindDuplicatedCharacterActionEvents(project, duplicate);
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

  setCameraAutoFraming(
    project: Project,
    shotId: string,
    autoFraming: ShotCameraAutoFraming | undefined,
  ): Project {
    this.shotIndex(project, shotId);
    const updated = setShotCameraAutoFraming(project, shotId, autoFraming);
    if (updated === project) return project;
    return this.replaceShots(project, updated.shots);
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

  applyCameraMotionPreset(
    project: Project,
    shotId: string,
    input: ApplyCameraMotionPresetInput,
  ): Project {
    this.shotIndex(project, shotId);
    const updated = applyCameraMotionPresetToProject(project, shotId, input, {
      createId: this.createId,
    });
    return this.replaceShots(updated, updated.shots);
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

  private copyName(
    project: Project,
    sourceName: string,
    mode: ShotDuplicateMode = 'full',
  ): string {
    const names = new Set(project.shots.map((shot) => normalizedName(shot.name)));
    const base =
      mode === 'structure-only'
        ? `${sourceName} 结构副本`
        : `${sourceName} 副本`;
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

  /**
   * #1449: the duplicated Shot owns new Layer instances, so a cloned
   * `character-action` segment may not keep a reference to the source Layer's
   * instance-scoped copy. Rebind each segment to the copy's shared origin
   * action and drop references that cannot be resolved, instead of silently
   * sharing a private copy.
   */
  private rebindDuplicatedCharacterActionEvents(
    project: Project,
    shot: Shot,
  ): TimelineEvent[] {
    if (!shot.timelineEvents.some((event) => event.type === 'character-action')) {
      return [...shot.timelineEvents];
    }
    const layersById = new Map(shot.layers.map((layer) => [layer.id, layer]));
    return shot.timelineEvents.flatMap((event): TimelineEvent[] => {
      if (event.type !== 'character-action') return [event];
      const layer = layersById.get(event.layerId);
      const source = layer?.source;
      if (!layer || source?.kind !== 'character') return [];
      const character = project.characters.find(
        ({ id }) => id === source.characterId,
      );
      const action = resolveCharacterActionForLayer(character, event.actionId, layer.id);
      if (!action) return [];
      return action.id === event.actionId ? [event] : [{ ...event, actionId: action.id }];
    });
  }

  private projectIds(project: Project): Set<string> {
    const ids = new Set<string>([
      project.id,
      ...project.assets.map((asset) => asset.id),
      ...project.characters.flatMap((character) => [
        character.id,
        ...(character.mode === 'adaptive-parts'
          ? [
              ...character.parts.map((part) => part.partId),
              ...(character.expressions ?? []).map((expression) => expression.id),
            ]
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
      shot.camera?.overrides?.forEach((override) => ids.add(override.id));
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
