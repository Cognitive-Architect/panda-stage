import {
  applyPresetEvents,
  createPresetEvents,
  getActionPreset,
  propertyOfType,
  type ActionPresetId,
  type CreatePresetEventsParams,
} from '../actions';
import {
  ProjectSchema,
  type Project,
  type TimelineEvent,
} from '../models';
import { TimelineEventSchema } from '../models/timeline-event';
import { validatePresetApplication } from '../validators';
import type { MultiSceneBlock } from '../scene/multiSceneInput';
import {
  PERFORMANCE_ACTION_LABELS,
  PERFORMANCE_PRESET_IDS,
  type PerformanceAction,
} from '../scene/multiScenePerformance';
import {
  MultiSceneDialogueService,
  type MultiSceneDialoguePlan,
  type MultiSceneDialogueServiceOptions,
} from './MultiSceneDialogueService';
import type {
  MultiScenePlanFailureCode,
  MultiScenePlanOutcome,
  MultiSceneSelections,
} from './MultiSceneService';

/** One directive successfully turned into ordinary formal TimelineEvents. */
export interface PerformancePlanRow {
  readonly dialogueOrdinal: number;
  readonly blockIndex: number;
  readonly shotId: string;
  readonly shotName: string;
  readonly layerId: string;
  readonly characterId: string;
  readonly speaker: string;
  readonly action: PerformanceAction;
  readonly actionLabel: string;
  readonly presetId: ActionPresetId;
  readonly property: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly eventIds: readonly string[];
}

export interface MultiScenePerformancePlanDetail {
  readonly rows: readonly PerformancePlanRow[];
  readonly eventCount: number;
}

export interface MultiScenePerformancePlan extends MultiSceneDialoguePlan {
  readonly performance: MultiScenePerformancePlanDetail;
}

export type MultiScenePerformancePlanOutcome =
  MultiScenePlanOutcome<MultiScenePerformancePlan>;

export interface MultiScenePerformanceServiceOptions
  extends MultiSceneDialogueServiceOptions {
  /** Reuse an already-configured AUTO-05 planner (bindings / audio picks). */
  readonly dialogueService?: MultiSceneDialogueService;
  /** Deterministic ids in tests; production uses crypto.randomUUID(). */
  readonly createEventId?: () => string;
}

const PROPERTY_LABELS: Readonly<Record<string, string>> = {
  position: '位置',
  scale: '缩放',
  opacity: '透明度',
  expression: '表情',
  flip: '翻转',
  visibility: '可见性',
};

function failure(
  code: MultiScenePlanFailureCode,
  message: string,
  blockIndex?: number,
): MultiScenePerformancePlanOutcome {
  return { ok: false, code, message, ...(blockIndex ? { blockIndex } : {}) };
}

/**
 * AUTO-06 is a pure post-processor of the AUTO-05 candidate Project:
 *
 *   MultiSceneDialogueService.plan()  (Shots + Dialogue + AudioClips)
 *     → for each explicit directive: Dialogue.startMs → unique Character Layer
 *     → createPresetEvents() + validatePresetApplication()
 *     → conflict / out-of-shot gate → applyPresetEvents() in memory
 *     → one final candidateProject
 *
 * Nothing is committed here. The one existing AUTO-04/AUTO-05 commit owner
 * still performs the only updateProject(), so one batch is one History step.
 */
export class MultiScenePerformanceService {
  private readonly dialogueService: MultiSceneDialogueService;
  private readonly createEventId: () => string;

  constructor(options: MultiScenePerformanceServiceOptions = {}) {
    this.dialogueService =
      options.dialogueService ?? new MultiSceneDialogueService(options);
    this.createEventId = options.createEventId ?? (() => crypto.randomUUID());
  }

  plan(
    projectInput: Project,
    blocks: readonly MultiSceneBlock[],
    selections: MultiSceneSelections = [],
  ): MultiScenePerformancePlanOutcome {
    const base = this.dialogueService.plan(projectInput, blocks, selections);
    if (!base.ok) return base;

    const plan = base.plan;
    let candidate = plan.candidateProject;
    const rows: PerformancePlanRow[] = [];

    for (const directive of blocks.flatMap(
      (block) => block.performances,
    )) {
      const ordinal = directive.dialogueOrdinal;
      const dialogue = plan.dialogue.rows.find(
        (row) => row.ordinal === ordinal,
      );
      if (!dialogue) {
        return failure(
          'PERFORMANCE_ORDINAL_UNKNOWN',
          `第 ${ordinal} 句对白不存在，表演指令无法锚定。`,
          directive.blockIndex,
        );
      }

      const shot = candidate.shots.find(
        (candidateShot) => candidateShot.id === dialogue.shotId,
      );
      if (!shot) {
        return failure(
          'PERFORMANCE_TARGET_UNRESOLVED',
          `第 ${ordinal} 句对白所在的镜头不存在。`,
          directive.blockIndex,
        );
      }

      const layers = shot.layers.filter(
        (layer) =>
          layer.id !== shot.backgroundLayerId &&
          layer.source.kind === 'character' &&
          layer.source.characterId === dialogue.characterId,
      );
      if (layers.length !== 1) {
        return failure(
          'PERFORMANCE_TARGET_UNRESOLVED',
          `第 ${ordinal} 句「${dialogue.speaker}」在镜头「${shot.name}」匹配到 ${layers.length} 个正式角色图层，整批未生成。`,
          directive.blockIndex,
        );
      }
      const layer = layers[0]!;
      if (layer.locked) {
        return failure(
          'PERFORMANCE_LAYER_LOCKED',
          `第 ${ordinal} 句「${dialogue.speaker}」的角色图层已锁定，整批未生成。`,
          directive.blockIndex,
        );
      }

      const character = candidate.characters.find(
        (entry) => entry.id === dialogue.characterId,
      );
      if (!character) {
        return failure(
          'PERFORMANCE_TARGET_UNRESOLVED',
          `第 ${ordinal} 句「${dialogue.speaker}」绑定的角色已不存在。`,
          directive.blockIndex,
        );
      }

      let expressionId: string | undefined;
      if (directive.action === 'expression') {
        if (character.mode === 'adaptive-parts') {
          return failure(
            'PERFORMANCE_EXPRESSION_UNRESOLVED',
            `第 ${ordinal} 句「${dialogue.speaker}」是 adaptive-parts 角色，当前没有正式 Expression 能力，表情指令整批未生成。`,
            directive.blockIndex,
          );
        }
        const matches = character.expressions.filter(
          (expression) =>
            expression.name.trim() === directive.expressionName,
        );
        if (matches.length !== 1) {
          return failure(
            'PERFORMANCE_EXPRESSION_UNRESOLVED',
            `第 ${ordinal} 句「${dialogue.speaker}」的表情「${directive.expressionName}」在本角色内命中 ${matches.length} 个，整批未生成。`,
            directive.blockIndex,
          );
        }
        expressionId = matches[0]!.id;
      }

      const presetId = PERFORMANCE_PRESET_IDS[directive.action];
      const preset = getActionPreset(presetId);
      const startMs = dialogue.startMs;
      const endMs = startMs + preset.defaultDurationMs;
      if (endMs > shot.durationMs) {
        return failure(
          'PERFORMANCE_OUT_OF_SHOT',
          `镜头「${shot.name}」时长 ${shot.durationMs}ms，第 ${ordinal} 句「${PERFORMANCE_ACTION_LABELS[directive.action]}」从 ${startMs}ms 起默认 ${preset.defaultDurationMs}ms 会到 ${endMs}ms，整批未生成。`,
          directive.blockIndex,
        );
      }

      // createPresetEvents() only console.warns on overlap. AUTO-06 must refuse
      // formally instead: same Layer + same logical property + time overlap,
      // against both the Shot's pre-existing events and this batch's earlier
      // directives (already applied to `candidate`).
      const property = propertyOfType(preset.eventType);
      const conflicting = shot.timelineEvents.find(
        (event) =>
          event.layerId === layer.id &&
          propertyOfType(event.type) === property &&
          event.startMs < endMs &&
          startMs < event.endMs,
      );
      if (conflicting) {
        return failure(
          'PERFORMANCE_CONFLICT',
          `镜头「${shot.name}」第 ${ordinal} 句「${dialogue.speaker}」的${PROPERTY_LABELS[property] ?? property}已有动作，保留原动作，未生成新的「${PERFORMANCE_ACTION_LABELS[directive.action]}」，整批未提交。`,
          directive.blockIndex,
        );
      }

      const params: CreatePresetEventsParams = { startMs };
      if (directive.action === 'move') {
        params.targetX = directive.targetX;
        params.targetY = directive.targetY;
      } else if (directive.action === 'scale') {
        params.scaleFactor = directive.scaleFactor;
      } else if (directive.action === 'expression') {
        params.expressionId = expressionId;
      }

      let events: TimelineEvent[];
      try {
        events = createPresetEvents(
          candidate,
          shot.id,
          layer.id,
          presetId,
          params,
          { createId: this.createEventId },
        ).map((event) => TimelineEventSchema.parse(event));
      } catch (error) {
        return failure(
          'PERFORMANCE_EVENT_INVALID',
          error instanceof Error
            ? `第 ${ordinal} 句的动作无法生成正式事件：${error.message}`
            : `第 ${ordinal} 句的动作无法生成正式事件。`,
          directive.blockIndex,
        );
      }
      const validation = validatePresetApplication(
        candidate,
        shot.id,
        layer.id,
        events,
      );
      if (!validation.ok) {
        return failure(
          'PERFORMANCE_EVENT_INVALID',
          `第 ${ordinal} 句的动作未通过正式事件校验：${validation.errors.join(' ')}`,
          directive.blockIndex,
        );
      }

      candidate = applyPresetEvents(candidate, shot.id, events);
      rows.push({
        dialogueOrdinal: ordinal,
        blockIndex: directive.blockIndex,
        shotId: shot.id,
        shotName: shot.name,
        layerId: layer.id,
        characterId: dialogue.characterId,
        speaker: dialogue.speaker,
        action: directive.action,
        actionLabel: PERFORMANCE_ACTION_LABELS[directive.action],
        presetId,
        property,
        startMs,
        endMs,
        eventIds: events.map((event) => event.id),
      });
    }

    return {
      ok: true,
      plan: {
        ...plan,
        candidateProject: ProjectSchema.parse(candidate),
        performance: {
          rows,
          eventCount: rows.reduce(
            (total, row) => total + row.eventIds.length,
            0,
          ),
        },
      },
    };
  }
}
