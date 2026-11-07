import { ProjectSchema, type Project } from '../models';
import { DialogueService } from './DialogueService';
import { ShotService } from './ShotService';

export interface AutoSubtitleGenerationRow {
  sourceLineNumber: number;
  characterId: string;
  /** Character identity captured when a manual audio choice was made. */
  selectedCharacterId?: string;
  text: string;
  audioAssetId: string;
  durationMs: number;
}

export interface AutoSubtitleGenerationInput {
  shotId: string;
  startMs: number;
  rows: readonly AutoSubtitleGenerationRow[];
}

export interface AutoSubtitlePlacementRow extends AutoSubtitleGenerationRow {
  startMs: number;
  endMs: number;
}

export type AutoSubtitleGenerationBlockerCode =
  | 'SHOT_NOT_FOUND'
  | 'INVALID_START_TIME'
  | 'EMPTY_BATCH'
  | 'INVALID_SOURCE_ORDER'
  | 'CHARACTER_NOT_FOUND'
  | 'ROLE_CHANGED'
  | 'INVALID_TEXT'
  | 'AUDIO_ASSET_NOT_FOUND'
  | 'AUDIO_ASSET_NOT_READY'
  | 'INVALID_DURATION'
  | 'AUDIO_REUSED'
  | 'TIME_OVERFLOW'
  | 'DIALOGUE_OVERLAP';

export interface AutoSubtitleGenerationBlocker {
  code: AutoSubtitleGenerationBlockerCode;
  message: string;
  sourceLineNumber?: number;
}

export interface AutoSubtitlePlacementPlan {
  shotId: string;
  startMs: number;
  endMs: number;
  totalDurationMs: number;
  shotDurationMs: number;
  remainingDurationMs: number;
  needsShotExtension: boolean;
  extensionToMs: number | null;
  rows: AutoSubtitlePlacementRow[];
  blockers: AutoSubtitleGenerationBlocker[];
  ready: boolean;
}

export type AutoSubtitleGenerationErrorCode =
  | AutoSubtitleGenerationBlockerCode
  | 'EXTENSION_REQUIRED'
  | 'STALE_EXTENSION_CONFIRMATION'
  | 'GENERATION_INVARIANT_FAILED';

export class AutoSubtitleGenerationError extends Error {
  constructor(
    readonly code: AutoSubtitleGenerationErrorCode,
    message: string,
    readonly sourceLineNumber?: number,
  ) {
    super(message);
    this.name = 'AutoSubtitleGenerationError';
  }
}

export interface AutoSubtitleGenerationResult {
  project: Project;
  plan: AutoSubtitlePlacementPlan;
  dialogueIds: string[];
  previousShotDurationMs: number;
  nextShotDurationMs: number;
}

/** Pure preview and all-or-nothing formal Dialogue + AudioClip construction. */
export class AutoSubtitleGenerationService {
  constructor(
    private readonly dialogues = new DialogueService(),
    private readonly shots = new ShotService(),
  ) {}

  plan(
    project: Project,
    input: AutoSubtitleGenerationInput,
  ): AutoSubtitlePlacementPlan {
    const shot = project.shots.find((candidate) => candidate.id === input.shotId);
    const blockers: AutoSubtitleGenerationBlocker[] = [];
    if (!shot) {
      return {
        shotId: input.shotId,
        startMs: input.startMs,
        endMs: input.startMs,
        totalDurationMs: 0,
        shotDurationMs: 0,
        remainingDurationMs: 0,
        needsShotExtension: false,
        extensionToMs: null,
        rows: [],
        blockers: [{
          code: 'SHOT_NOT_FOUND',
          message: '当前镜头已不存在，请重新选择镜头。',
        }],
        ready: false,
      };
    }

    if (
      !Number.isSafeInteger(input.startMs) ||
      input.startMs < 0 ||
      input.startMs > shot.durationMs
    ) {
      blockers.push({
        code: 'INVALID_START_TIME',
        message: '当前播放位置无效，请重新定位后再生成。',
      });
    }
    if (input.rows.length === 0) {
      blockers.push({ code: 'EMPTY_BATCH', message: '请先输入对白。' });
    }

    const scheduledRows: AutoSubtitlePlacementRow[] = [];
    const seenAssets = new Map<string, number>();
    let cursor = Number.isSafeInteger(input.startMs) && input.startMs >= 0
      ? input.startMs
      : 0;
    let previousSourceLine = 0;

    input.rows.forEach((row) => {
      let valid = true;
      if (
        !Number.isSafeInteger(row.sourceLineNumber) ||
        row.sourceLineNumber <= previousSourceLine
      ) {
        blockers.push({
          code: 'INVALID_SOURCE_ORDER',
          message: '对白顺序已变化，请重新核对输入内容。',
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      }
      previousSourceLine = row.sourceLineNumber;

      const character = project.characters.find(
        (candidate) => candidate.id === row.characterId,
      );
      if (!character) {
        blockers.push({
          code: 'CHARACTER_NOT_FOUND',
          message: `第 ${row.sourceLineNumber} 行的角色已不存在，请重新选择。`,
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      }
      if (
        row.selectedCharacterId !== undefined &&
        row.selectedCharacterId !== row.characterId
      ) {
        blockers.push({
          code: 'ROLE_CHANGED',
          message: `第 ${row.sourceLineNumber} 行角色已更改，请重新确认配音。`,
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      }
      if (row.text.trim().length === 0 || row.text.length > 10_000) {
        blockers.push({
          code: 'INVALID_TEXT',
          message: `第 ${row.sourceLineNumber} 行对白无效，请检查文字内容。`,
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      }

      const asset = project.assets.find(
        (candidate) => candidate.id === row.audioAssetId,
      );
      if (!asset || asset.kind !== 'audio') {
        blockers.push({
          code: 'AUDIO_ASSET_NOT_FOUND',
          message: `第 ${row.sourceLineNumber} 行配音素材已不存在，请重新选择。`,
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      } else if (
        asset.metadata?.status === 'error' ||
        !Number.isSafeInteger(asset.durationMs) ||
        (asset.durationMs ?? 0) < 1
      ) {
        blockers.push({
          code: 'AUDIO_ASSET_NOT_READY',
          message: `第 ${row.sourceLineNumber} 行配音不可用，请刷新素材或更换配音。`,
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      }
      if (
        !Number.isSafeInteger(row.durationMs) ||
        row.durationMs < 1 ||
        (asset?.kind === 'audio' && row.durationMs > (asset.durationMs ?? 0))
      ) {
        blockers.push({
          code: 'INVALID_DURATION',
          message: `第 ${row.sourceLineNumber} 行片段时长无效，必须在音频可播放范围内。`,
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      }

      const previousLine = seenAssets.get(row.audioAssetId);
      if (previousLine !== undefined) {
        blockers.push({
          code: 'AUDIO_REUSED',
          message: `第 ${row.sourceLineNumber} 行与第 ${previousLine} 行使用了同一段配音，请更换素材。`,
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      } else {
        seenAssets.set(row.audioAssetId, row.sourceLineNumber);
      }

      const endMs = cursor + row.durationMs;
      if (!Number.isSafeInteger(endMs)) {
        blockers.push({
          code: 'TIME_OVERFLOW',
          message: '本批配音总时长超出可安排范围。',
          sourceLineNumber: row.sourceLineNumber,
        });
        valid = false;
      }
      if (!valid) return;

      const conflict = shot.dialogues.find(
        (dialogue) =>
          dialogue.endMs > dialogue.startMs &&
          cursor < dialogue.endMs &&
          endMs > dialogue.startMs,
      );
      if (conflict) {
        blockers.push({
          code: 'DIALOGUE_OVERLAP',
          message: `第 ${row.sourceLineNumber} 行与已有字幕 ${conflict.startMs}–${conflict.endMs} ms 重叠，请移动已有字幕或更改播放头位置。`,
          sourceLineNumber: row.sourceLineNumber,
        });
        return;
      }

      scheduledRows.push({ ...row, startMs: cursor, endMs });
      cursor = endMs;
    });

    const validRows = scheduledRows.length === input.rows.length && blockers.length === 0;
    const endMs = validRows ? cursor : input.startMs;
    const totalDurationMs = validRows ? endMs - input.startMs : 0;
    const needsShotExtension = validRows && endMs > shot.durationMs;
    return {
      shotId: shot.id,
      startMs: input.startMs,
      endMs,
      totalDurationMs,
      shotDurationMs: shot.durationMs,
      remainingDurationMs: Math.max(0, shot.durationMs - input.startMs),
      needsShotExtension,
      extensionToMs: needsShotExtension ? endMs : null,
      rows: scheduledRows,
      blockers,
      ready: validRows,
    };
  }

  generate(
    project: Project,
    input: AutoSubtitleGenerationInput & { extendShotToMs?: number },
  ): AutoSubtitleGenerationResult {
    const plan = this.plan(project, input);
    if (plan.blockers.length > 0 || !plan.ready) {
      const blocker = plan.blockers[0] ?? {
        code: 'EMPTY_BATCH' as const,
        message: '请先输入有效对白。',
      };
      throw new AutoSubtitleGenerationError(
        blocker.code,
        blocker.message,
        blocker.sourceLineNumber,
      );
    }
    if (plan.needsShotExtension && input.extendShotToMs === undefined) {
      throw new AutoSubtitleGenerationError(
        'EXTENSION_REQUIRED',
        `本批需要将镜头延长至 ${plan.extensionToMs} ms。`,
      );
    }
    if (
      (plan.needsShotExtension && input.extendShotToMs !== plan.extensionToMs) ||
      (!plan.needsShotExtension && input.extendShotToMs !== undefined)
    ) {
      throw new AutoSubtitleGenerationError(
        'STALE_EXTENSION_CONFIRMATION',
        '工程或播放位置已变化，请重新核验生成预览。',
      );
    }

    const initialShot = project.shots.find((shot) => shot.id === plan.shotId)!;
    const previousShotDurationMs = initialShot.durationMs;
    let next = plan.needsShotExtension
      ? this.shots.setDuration(project, plan.shotId, plan.extensionToMs!)
      : project;
    const originalDialogueCount = next.shots.find(
      (shot) => shot.id === plan.shotId,
    )!.dialogues.length;
    next = this.dialogues.createMany(next, {
      shotId: plan.shotId,
      pointTimeMs: plan.startMs,
      lines: plan.rows.map((row) => ({
        characterId: row.characterId,
        text: row.text,
      })),
    });
    const created = next.shots.find(
      (shot) => shot.id === plan.shotId,
    )!.dialogues.slice(originalDialogueCount);
    if (created.length !== plan.rows.length) {
      throw new AutoSubtitleGenerationError(
        'GENERATION_INVARIANT_FAILED',
        '生成字幕未能完整创建，请重试；工程未提交任何更改。',
      );
    }

    for (const [index, row] of plan.rows.entries()) {
      const dialogue = created[index]!;
      next = this.dialogues.setTiming(next, {
        shotId: plan.shotId,
        dialogueId: dialogue.id,
        startMs: row.startMs,
        endMs: row.endMs,
      });
      next = this.dialogues.bindAudio(next, {
        shotId: plan.shotId,
        dialogueId: dialogue.id,
        assetId: row.audioAssetId,
      });
    }

    const result = ProjectSchema.parse(next);
    const resultShot = result.shots.find((shot) => shot.id === plan.shotId)!;
    const dialogueIds = created.map(({ id }) => id);
    const committedRows = dialogueIds.map((id) =>
      resultShot.dialogues.find((candidate) => candidate.id === id),
    );
    if (
      committedRows.some((dialogue, index) => {
        const row = plan.rows[index]!;
        const clip = resultShot.audioClips.find(
          (candidate) => candidate.id === dialogue?.audioClipId,
        );
        return (
          !dialogue ||
          dialogue.startMs !== row.startMs ||
          dialogue.endMs !== row.endMs ||
          !clip ||
          clip.role !== 'dialogue' ||
          clip.assetId !== row.audioAssetId ||
          clip.startMs !== row.startMs ||
          clip.endMs !== row.endMs
        );
      })
    ) {
      throw new AutoSubtitleGenerationError(
        'GENERATION_INVARIANT_FAILED',
        '生成结果无法保持字幕、配音和真实时长一致；工程未提交任何更改。',
      );
    }

    return {
      project: result,
      plan,
      dialogueIds,
      previousShotDurationMs,
      nextShotDurationMs: resultShot.durationMs,
    };
  }
}
