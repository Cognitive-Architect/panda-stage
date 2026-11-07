import { ProjectSchema, type Project } from '../models';
import {
  MULTI_SCENE_SHOT_DURATION_MS,
  collectSpeakerLabels,
  type MultiSceneBlock,
} from '../scene/multiSceneInput';
import {
  resolveAudioMatches,
  type AudioMatchRequest,
} from '../scene/multiSceneAudio';
import {
  canonicalCharacterName,
  resolveSpeakerBindings,
  type SpeakerBindings,
} from '../scene/multiSceneSpeakers';
import {
  AutoSubtitleGenerationService,
  type AutoSubtitleGenerationRow,
} from './AutoSubtitleGenerationService';
import {
  MultiSceneService,
  type MultiScenePlan,
  type MultiScenePlanFailureCode,
  type MultiScenePlanOutcome,
  type MultiSceneSelections,
} from './MultiSceneService';

/** One formal row of the batch, in whole-script ordinal order. */
export interface MultiSceneDialoguePlanRow {
  readonly ordinal: number;
  readonly blockIndex: number;
  readonly shotId: string;
  readonly speaker: string;
  readonly characterId: string;
  readonly text: string;
  readonly audioAssetId: string;
  readonly audioFileName: string;
  readonly durationMs: number;
  readonly startMs: number;
  readonly endMs: number;
}

/** Preview-only: the author confirms the extension by clicking generate. */
export interface MultiSceneDialogueShotTiming {
  readonly shotId: string;
  readonly shotName: string;
  readonly currentDurationMs: number;
  readonly requiredDurationMs: number;
  readonly nextDurationMs: number;
  readonly extended: boolean;
}

export interface MultiSceneDialoguePlanDetail {
  readonly rows: readonly MultiSceneDialoguePlanRow[];
  readonly timings: readonly MultiSceneDialogueShotTiming[];
}

export interface MultiSceneDialoguePlan extends MultiScenePlan {
  readonly dialogue: MultiSceneDialoguePlanDetail;
}

export type MultiSceneDialoguePlanOutcome =
  MultiScenePlanOutcome<MultiSceneDialoguePlan>;

export interface MultiSceneDialogueServiceOptions {
  readonly speakerBindings?: SpeakerBindings;
  readonly audioSelections?: Readonly<Record<number, string>>;
  readonly sceneService?: MultiSceneService;
  readonly subtitleService?: AutoSubtitleGenerationService;
}

function failure(
  code: MultiScenePlanFailureCode,
  message: string,
  blockIndex?: number,
): MultiSceneDialoguePlanOutcome {
  return { ok: false, code, message, ...(blockIndex ? { blockIndex } : {}) };
}

/**
 * AUTO-05 combines the two Foundation planners in memory:
 *
 *   baseline Project
 *     → AUTO-04 scene planner (candidate Shots, Layers, Background)
 *     → for each candidate Shot, #934 plan()/generate() at startMs = 0
 *     → one final candidateProject
 *
 * The Store is never looped: the caller commits exactly one updateProject().
 */
export class MultiSceneDialogueService {
  private readonly sceneService: MultiSceneService;
  private readonly subtitleService: AutoSubtitleGenerationService;
  private readonly speakerBindings: SpeakerBindings;
  private readonly audioSelections: Readonly<Record<number, string>>;

  constructor(options: MultiSceneDialogueServiceOptions = {}) {
    this.sceneService = options.sceneService ?? new MultiSceneService();
    this.subtitleService =
      options.subtitleService ?? new AutoSubtitleGenerationService();
    this.speakerBindings = options.speakerBindings ?? {};
    this.audioSelections = options.audioSelections ?? {};
  }

  plan(
    projectInput: Project,
    blocks: readonly MultiSceneBlock[],
    selections: MultiSceneSelections = [],
  ): MultiSceneDialoguePlanOutcome {
    if (blocks.length === 0) {
      return failure('GENERATED_SCENE_INVALID', '请先输入分镜与对白。');
    }
    const baseline = ProjectSchema.parse(projectInput);

    const labels = collectSpeakerLabels(blocks);
    const bindings = resolveSpeakerBindings(
      baseline,
      labels,
      this.speakerBindings,
    );
    if (!bindings.ready) {
      return failure(
        'SPEAKER_BINDING_UNRESOLVED',
        `请先确认角色：${bindings.unresolved.join('、')}。`,
      );
    }

    // The parser rejects two identical cast *texts*, but manual bindings may
    // still resolve two distinct labels to one Character. Refuse before the
    // scene planner sees two identical slot ids; cross-Shot reuse stays legal.
    for (const block of blocks) {
      const leftId = bindings.bindings[block.cast[0]];
      const rightId = bindings.bindings[block.cast[1]];
      if (leftId && rightId && leftId === rightId) {
        return failure(
          'SPEAKER_BINDING_CONFLICT',
          `「${block.cast[0]}」和「${block.cast[1]}」当前绑定到了同一个角色，请重新选择。`,
          block.index,
        );
      }
    }

    const requests: AudioMatchRequest[] = [];
    const ownerByOrdinal = new Map<number, MultiSceneBlock>();
    for (const block of blocks) {
      for (const line of block.dialogues) {
        const characterId = bindings.bindings[line.speaker]!;
        const characterName = canonicalCharacterName(baseline, characterId);
        if (!characterName) {
          return failure(
            'SPEAKER_BINDING_UNRESOLVED',
            `「${line.speaker}」绑定的角色已不存在，请重新确认。`,
            block.index,
          );
        }
        requests.push({ ordinal: line.ordinal, characterName });
        ownerByOrdinal.set(line.ordinal, block);
      }
    }
    const audio = resolveAudioMatches(
      baseline,
      requests,
      this.audioSelections,
    );
    if (!audio.ready) {
      const first = audio.rows.find((row) => row.issue !== null);
      const owner = first ? ownerByOrdinal.get(first.ordinal) : undefined;
      return failure(
        'AUDIO_MATCH_FAILED',
        first?.message ?? '配音未全部匹配，完整批次不能生成。',
        owner?.index,
      );
    }

    // Speaker bindings are the single cast truth: canonical names plus explicit
    // ids make the AUTO-04 slot resolver agree with Dialogue.characterId.
    const canonicalBlocks: MultiSceneBlock[] = blocks.map((block) => ({
      ...block,
      cast: [
        canonicalCharacterName(baseline, bindings.bindings[block.cast[0]]!) ??
          block.cast[0],
        canonicalCharacterName(baseline, bindings.bindings[block.cast[1]]!) ??
          block.cast[1],
      ],
    }));
    const slotSelections: MultiSceneSelections = blocks.map((block, index) => ({
      backgroundAssetId: selections[index]?.backgroundAssetId ?? null,
      leftCharacterId: bindings.bindings[block.cast[0]] ?? null,
      rightCharacterId: bindings.bindings[block.cast[1]] ?? null,
    }));

    const scene = this.sceneService.plan(baseline, canonicalBlocks, slotSelections);
    if (!scene.ok) return scene;

    let next = scene.plan.candidateProject;
    const rows: MultiSceneDialoguePlanRow[] = [];
    const timings: MultiSceneDialogueShotTiming[] = [];

    for (const [blockOffset, block] of blocks.entries()) {
      const plannedShot = scene.plan.shots[blockOffset];
      if (!plannedShot) {
        return failure(
          'GENERATED_SCENE_INVALID',
          `镜头 ${block.index} 没有生成可编辑的镜头。`,
          block.index,
        );
      }
      const blockRows = audio.rows.filter(
        (row) => ownerByOrdinal.get(row.ordinal) === block,
      );
      const generationRows: AutoSubtitleGenerationRow[] = blockRows.map(
        (row, index) => {
          const line = block.dialogues[index]!;
          return {
            sourceLineNumber: line.ordinal,
            characterId: bindings.bindings[line.speaker]!,
            text: line.text,
            audioAssetId: row.asset!.id,
            durationMs: row.durationMs!,
          };
        },
      );

      const subtitlePlan = this.subtitleService.plan(next, {
        shotId: plannedShot.shotId,
        startMs: 0,
        rows: generationRows,
      });
      if (!subtitlePlan.ready || subtitlePlan.blockers.length > 0) {
        return failure(
          'DIALOGUE_GENERATION_FAILED',
          subtitlePlan.blockers[0]?.message ??
            `镜头 ${block.index} 的对白无法排轴，整批未生成。`,
          block.index,
        );
      }

      try {
        const generated = this.subtitleService.generate(next, {
          shotId: plannedShot.shotId,
          startMs: 0,
          rows: generationRows,
          ...(subtitlePlan.needsShotExtension
            ? { extendShotToMs: subtitlePlan.extensionToMs! }
            : {}),
        });
        next = generated.project;
      } catch (error) {
        return failure(
          'DIALOGUE_GENERATION_FAILED',
          error instanceof Error ? error.message : '对白生成失败，整批未生成。',
          block.index,
        );
      }

      subtitlePlan.rows.forEach((placement, index) => {
        const matched = blockRows[index]!;
        rows.push({
          ordinal: placement.sourceLineNumber,
          blockIndex: block.index,
          shotId: plannedShot.shotId,
          speaker: block.dialogues[index]!.speaker,
          characterId: placement.characterId,
          text: placement.text,
          audioAssetId: placement.audioAssetId,
          audioFileName: matched.fileName ?? '',
          durationMs: placement.durationMs,
          startMs: placement.startMs,
          endMs: placement.endMs,
        });
      });

      const requiredDurationMs =
        subtitlePlan.rows.at(-1)?.endMs ?? 0;
      const nextDurationMs = Math.max(
        MULTI_SCENE_SHOT_DURATION_MS,
        requiredDurationMs,
      );
      timings.push({
        shotId: plannedShot.shotId,
        shotName: block.shotName,
        currentDurationMs: MULTI_SCENE_SHOT_DURATION_MS,
        requiredDurationMs,
        nextDurationMs,
        extended: requiredDurationMs > MULTI_SCENE_SHOT_DURATION_MS,
      });
    }

    const candidateProject = ProjectSchema.parse(next);
    if (!this.verify(candidateProject, rows, timings)) {
      return failure(
        'GENERATED_SCENE_INVALID',
        '这批镜头与对白没有通过完整性检查，工程未提交。',
      );
    }

    return {
      ok: true,
      plan: {
        ...scene.plan,
        candidateProject,
        dialogue: { rows, timings },
      },
    };
  }

  /** Final invariant pass: the batch is either wholly valid or not committed. */
  private verify(
    project: Project,
    rows: readonly MultiSceneDialoguePlanRow[],
    timings: readonly MultiSceneDialogueShotTiming[],
  ): boolean {
    const seenAssets = new Set<string>();
    for (const row of rows) {
      if (seenAssets.has(row.audioAssetId)) return false;
      seenAssets.add(row.audioAssetId);
      const shot = project.shots.find((candidate) => candidate.id === row.shotId);
      if (!shot) return false;
      const clip = shot.audioClips.find(
        (candidate) =>
          candidate.role === 'dialogue' &&
          candidate.assetId === row.audioAssetId &&
          candidate.startMs === row.startMs &&
          candidate.endMs === row.endMs,
      );
      const dialogue = clip
        ? shot.dialogues.find(
            (candidate) =>
              candidate.audioClipId === clip.id &&
              candidate.text === row.text &&
              candidate.characterId === row.characterId &&
              candidate.startMs === row.startMs &&
              candidate.endMs === row.endMs,
          )
        : undefined;
      if (!clip || !dialogue) return false;
    }
    return timings.every((timing) => {
      const shot = project.shots.find(
        (candidate) => candidate.id === timing.shotId,
      );
      return shot?.durationMs === timing.nextDurationMs;
    });
  }
}
