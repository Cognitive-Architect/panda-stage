import {
  actionRecipeBindingOptions,
  applyActionRecipe,
  applyPresetEvents,
  createPresetEvents,
  getActionPreset,
  propertyOfType,
  type ActionRecipeBindings,
  type CreatePresetEventsParams,
} from '../actions';
import {
  DIALOGUE_SPEAKER_NARRATOR,
  ProjectSchema,
  type AudioAsset,
  type Character,
  type Project,
  type TimelineEvent,
} from '../models';
import type { ActionRecipe } from '../models/actionRecipe';
import {
  AutoSubtitleAudioService,
  dialogueDraftSpeakerKey,
  matchDialogueAudioRows,
  reconcileDialogueDraftRows,
  type DialogueAudioMatchReport,
  type DialogueAudioMatchRequest,
  type DialogueAudioMatchRow,
  type DialogueDraftRowSeed,
  type StableDialogueDraftRow,
} from '../services/AutoSubtitleAudioService';
import { upsertCharacterActionEvent } from '../services/CharacterActionEventService';
import { DialogueService } from '../services/DialogueService';
import { ShotService } from '../services/ShotService';
import { validatePresetApplication } from '../validators';
import {
  isAutoScenePlanStale,
  planAutoScenes,
  type AutoScenePlan,
  type AutoSceneStaleCheckResult,
  type PlanAutoScenesOptions,
  type PlannedSceneBlock,
  type ScenePlanOverrides,
} from './scenePlanner';
import {
  BASIC_PERFORMANCE_PRESET_IDS,
  PERFORMANCE_ACTION_LABELS,
  parseScriptPerformanceInput,
  type ParsedPerformanceDirective,
  type ParseScriptPerformanceResult,
  type ScriptDialogueDraftLine,
} from './scriptPerformanceInput';

const DEFAULT_CHARACTER_ACTION_DURATION_MS = 1_000;

const PROPERTY_LABELS: Readonly<Record<string, string>> = {
  position: '位置',
  scale: '缩放',
  opacity: '透明度',
  expression: '表情',
  flip: '翻转',
  visibility: '可见性',
  'character-action': '角色动作',
};

export interface ScriptDialogueAudioOverride {
  /** Explicit audio asset id, or `null` to skip audio for this dialogue line. */
  readonly audioAssetId?: string | null;
  readonly sourceStartMs?: number;
  readonly sourceEndMs?: number;
  /** Optional speaker key guard so speaker edits do not inherit stale audio overrides. */
  readonly speakerKey?: string;
}

export interface ScriptPerformanceOverrides {
  readonly scene?: ScenePlanOverrides;
  /** Per stable `draftRowId` manual audio pick / source range. */
  readonly audioByDraftRowId?: Readonly<Record<string, ScriptDialogueAudioOverride>>;
  /** Explicit directive IDs excluded by the user/CLI to confirm a valid subset. */
  readonly excludedDirectiveIds?: readonly string[];
  /** Optional explicit recipe step bindings keyed by directiveId. */
  readonly recipeBindingsByDirectiveId?: Readonly<Record<string, ActionRecipeBindings>>;
}

export interface PlanScriptPerformanceOptions extends PlanAutoScenesOptions {
  /** Previous session dialogue draft rows so `draftRowId` stays stable across edits. */
  readonly previousDialogueRows?: readonly StableDialogueDraftRow[];
  readonly overrides?: ScriptPerformanceOverrides;
  /**
   * When true, shots are extended via `ShotService.setDuration` if a performance
   * directive's end time exceeds the shot duration. Defaults to false so overflows
   * surface as explicit row-level feedback until confirmed.
   */
  readonly extendShotForPerformance?: boolean;
  readonly defaultDurationMs?: number;
  readonly createDraftRowId?: () => string;
}

export type PlannedScriptDialogueStatus =
  | 'scheduled'
  | 'draft-unready'
  | 'parse-issue'
  | 'block-skipped';

export interface PlannedScriptDialogueRow {
  readonly draftRowId: string;
  readonly ordinal: number;
  readonly blockIndex: number;
  readonly sourceLineNumber: number;
  readonly speakerName: string;
  readonly speakerType: ScriptDialogueDraftLine['speakerType'];
  readonly characterId?: string;
  readonly text: string;
  readonly status: PlannedScriptDialogueStatus;
  readonly shotId: string | null;
  /** Formal `Dialogue.id` created in the candidate Project (null if not scheduled). */
  readonly dialogueId: string | null;
  readonly audioClipId: string | null;
  readonly audioMatch: DialogueAudioMatchRow | null;
  readonly startMs: number | null;
  readonly endMs: number | null;
  readonly issueCode: string | null;
  readonly issueMessage: string | null;
}

export type PlannedPerformanceStatus = 'ready' | 'issue' | 'skipped';

export type PlannedPerformanceIssueCode =
  | 'PARSE_ISSUE'
  | 'DIALOGUE_UNRESOLVED'
  | 'DIALOGUE_BLOCK_MISMATCH'
  | 'TARGET_LAYER_UNRESOLVED'
  | 'EXPRESSION_NOT_FOUND'
  | 'CHARACTER_ACTION_NOT_FOUND'
  | 'RECIPE_NOT_FOUND'
  | 'RECIPE_DURATION_OVERRIDE_UNSUPPORTED'
  | 'OUT_OF_SHOT_BOUNDS'
  | 'PROPERTY_CONFLICT'
  | 'VALIDATION_FAILED';

export interface PlannedPerformanceRow {
  readonly directiveId: string;
  readonly blockIndex: number;
  readonly sourceLineNumber: number;
  readonly raw: string;
  readonly dialogueOrdinal: number | null;
  /** Stable preview draftRowId resolved from `dialogueOrdinal`. */
  readonly draftRowId: string | null;
  /** Formal `Dialogue.id` resolved in candidateProject (null if dialogue unscheduled). */
  readonly dialogueId: string | null;
  readonly shotId: string | null;
  readonly shotName: string | null;
  readonly layerId: string | null;
  readonly characterId: string | null;
  readonly speakerName: string | null;
  readonly action: ParsedPerformanceDirective['action'];
  readonly actionLabel: string;
  readonly property: string | null;
  readonly startMs: number | null;
  readonly endMs: number | null;
  readonly requiredShotDurationMs: number | null;
  readonly status: PlannedPerformanceStatus;
  readonly eventIds: readonly string[];
  readonly issueCode: PlannedPerformanceIssueCode | null;
  readonly issueMessage: string | null;
}

export interface ScriptPerformanceBlockSummary {
  readonly scene: PlannedSceneBlock;
  readonly finalDurationMs: number;
  readonly extendedForAudio: boolean;
  readonly extendedForPerformance: boolean;
  readonly dialogues: readonly PlannedScriptDialogueRow[];
  readonly performances: readonly PlannedPerformanceRow[];
}

export interface ScriptPerformanceStaleCheckToken {
  readonly referencedAudio: readonly {
    readonly id: string;
    readonly durationMs?: number;
    readonly status?: string;
  }[];
  readonly referencedRecipeIds: readonly string[];
  readonly referencedRecipes: readonly {
    readonly id: string;
    readonly snapshotJson: string;
  }[];
}

export interface ScriptPerformancePlan {
  readonly baseProject: Project;
  readonly rawInput: string;
  readonly parsed: ParseScriptPerformanceResult;
  readonly scenePlan: AutoScenePlan;
  readonly dialogueDraftRows: readonly StableDialogueDraftRow[];
  readonly audioMatchReport: DialogueAudioMatchReport;
  readonly blocks: readonly ScriptPerformanceBlockSummary[];
  readonly dialogues: readonly PlannedScriptDialogueRow[];
  readonly performances: readonly PlannedPerformanceRow[];
  /** Preview draftRowId -> formal Dialogue.id mapping in candidateProject. */
  readonly dialogueIdByDraftRowId: Readonly<Record<string, string>>;
  readonly candidateProject: Project | null;
  readonly createdShotIds: readonly string[];
  readonly applicableBlockCount: number;
  readonly scheduledDialogueCount: number;
  readonly unreadyDialogueCount: number;
  readonly readyPerformanceCount: number;
  readonly issuePerformanceCount: number;
  readonly skippedPerformanceCount: number;
  readonly hasIssues: boolean;
  readonly overrides: ScriptPerformanceOverrides;
  readonly extendShotForPerformance: boolean;
  readonly staleToken: ScriptPerformanceStaleCheckToken;
}

export interface ApplyScriptPerformanceOptions extends PlanAutoScenesOptions {
  /**
   * When false, refuse to commit if any parse/dialogue/performance row has an
   * issue. Defaults to true so the user/CLI can explicitly confirm the valid
   * subset after reviewing row-level feedback.
   */
  readonly allowPartialConfirm?: boolean;
}

export type ScriptPerformanceApplyErrorCode =
  | 'STALE_PLAN'
  | 'NO_APPLICABLE_SCENES'
  | 'HAS_ISSUES'
  | 'APPLY_FAILED';

export type ScriptPerformanceApplyResult =
  | {
      readonly ok: true;
      readonly project: Project;
      readonly createdShotIds: readonly string[];
      readonly firstShotId: string;
      readonly dialogueIdByDraftRowId: Readonly<Record<string, string>>;
      readonly blocks: readonly ScriptPerformanceBlockSummary[];
      readonly dialogues: readonly PlannedScriptDialogueRow[];
      readonly performances: readonly PlannedPerformanceRow[];
      readonly scheduledDialogueCount: number;
      readonly readyPerformanceCount: number;
      readonly issuePerformanceCount: number;
    }
  | {
      readonly ok: false;
      readonly errorCode: ScriptPerformanceApplyErrorCode;
      readonly message: string;
    };

function normalizeLookupName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function inferCharacterActionDurationMs(
  character: Character,
  actionId: string,
): number {
  const action = character.actions?.find((entry) => entry.id === actionId);
  if (!action) return DEFAULT_CHARACTER_ACTION_DURATION_MS;
  if ('tracks' in action && Array.isArray(action.tracks)) {
    let maxMs = 0;
    for (const track of action.tracks) {
      for (const key of track.keys) {
        if (key.timeMs > maxMs) maxMs = key.timeMs;
      }
    }
    if (maxMs > 0) return maxMs;
  }
  return DEFAULT_CHARACTER_ACTION_DURATION_MS;
}

function getRecipeEndMs(
  recipe: ActionRecipe,
  startMs: number,
  bindings: ActionRecipeBindings,
): number {
  let maxEnd = startMs;
  for (const step of recipe.steps) {
    if (bindings[step.id] === null) continue;
    const end = startMs + step.offsetMs + ('durationMs' in step ? step.durationMs : 0);
    maxEnd = Math.max(maxEnd, end);
  }
  return maxEnd;
}

function resolveRecipeBindings(
  project: Project,
  shotId: string,
  layerId: string,
  recipeId: string,
  explicitBindings?: ActionRecipeBindings,
): ActionRecipeBindings {
  const recipe = project.actionRecipes?.find((entry) => entry.id === recipeId);
  if (!recipe) return {};
  const bindings: Record<string, string | null> = {};
  for (const step of recipe.steps) {
    if (explicitBindings && step.id in explicitBindings) {
      bindings[step.id] = explicitBindings[step.id] ?? null;
      continue;
    }
    if (step.kind === 'expression' || step.kind === 'action') {
      const options = actionRecipeBindingOptions(
        project,
        { shotId, layerId },
        step,
      );
      bindings[step.id] = options[0]?.id ?? null;
    }
  }
  return bindings;
}

function findPropertyOverlap(
  events: readonly TimelineEvent[],
  layerId: string,
  property: string,
  startMs: number,
  endMs: number,
): TimelineEvent | undefined {
  return events.find(
    (event) =>
      event.layerId === layerId &&
      propertyOfType(event.type) === property &&
      event.startMs < endMs &&
      startMs < event.endMs,
  );
}

/**
 * Check whether the current Project has changed in a way that invalidates a
 * previously built `ScriptPerformancePlan`.
 */
export function isScriptPerformancePlanStale(
  currentProject: Project,
  plan: ScriptPerformancePlan,
): AutoSceneStaleCheckResult {
  const sceneStale = isAutoScenePlanStale(currentProject, plan.scenePlan);
  if (sceneStale.stale) return sceneStale;

  const audioById = new Map(
    currentProject.assets
      .filter((asset): asset is AudioAsset => asset.kind === 'audio')
      .map((asset) => [asset.id, asset]),
  );
  for (const ref of plan.staleToken.referencedAudio) {
    const asset = audioById.get(ref.id);
    if (
      !asset ||
      asset.durationMs !== ref.durationMs ||
      asset.metadata?.status !== ref.status
    ) {
      return {
        stale: true,
        reason: '引用的配音素材已变动或删除，请重新解析剧本计划。',
      };
    }
  }

  const recipesById = new Map(
    (currentProject.actionRecipes ?? []).map((recipe) => [recipe.id, recipe]),
  );
  for (const recipeRef of plan.staleToken.referencedRecipes) {
    const currentRecipe = recipesById.get(recipeRef.id);
    if (!currentRecipe || JSON.stringify(currentRecipe) !== recipeRef.snapshotJson) {
      return {
        stale: true,
        reason: '引用的操作配方已变动或删除，请重新解析剧本计划。',
      };
    }
  }

  return { stale: false };
}

/**
 * Shared WF-04 planner reused identically by both UI (`AutoScenePanel`) and
 * desktop automation / CLI (`script.plan`, `script.apply`).
 *
 * Pipeline (pure — never mutates `project` or stores):
 * 1. Parse Chinese script blocks via WF-03 `parseStructuredSceneBlocks` with
 *    `allowExtraSections: ['对白', '表演']`.
 * 2. Reconcile dialogue lines into stable `draftRowId`s via WF-01
 *    `reconcileDialogueDraftRows` and match audio via WF-01
 *    `matchDialogueAudioRows`.
 * 3. Plan multi-shot staging via WF-03 `planAutoScenes`.
 * 4. Schedule ready dialogues & real audio per shot via WF-01
 *    `AutoSubtitleAudioService` (extending shots when audio requires it;
 *    never silently clipping audio) and map `draftRowId -> Dialogue.id`.
 * 5. Plan & apply performance directives (all 8 basic presets + official
 *    `CharacterActionEventService` + official `applyActionRecipe`) with
 *    row-level feedback for missing actions, same-property conflicts, and
 *    shot-bounds overflow.
 */
export function planScriptPerformance(
  project: Project,
  rawInput: string,
  options: PlanScriptPerformanceOptions = {},
): ScriptPerformancePlan {
  const overrides = options.overrides ?? {};
  const extendShotForPerformance = options.extendShotForPerformance ?? false;
  const createId = options.createId ?? (() => crypto.randomUUID());

  const parsed = parseScriptPerformanceInput(rawInput, project.characters, {
    ...(options.defaultDurationMs !== undefined
      ? { defaultDurationMs: options.defaultDurationMs }
      : {}),
  });

  // Step 1: Stable draft-row reconciliation (WF-01)
  const dialogueSeeds: DialogueDraftRowSeed[] = parsed.dialogues.map((line) => ({
    sourceLineNumber: line.sourceLineNumber,
    logicalOrdinal: line.ordinal,
    text: line.text || line.raw,
    speakerType: line.speakerType,
    ...(line.characterId ? { characterId: line.characterId } : {}),
    speakerName: line.speakerName,
  }));
  const reconciledDraftRows = reconcileDialogueDraftRows(
    options.previousDialogueRows ?? [],
    dialogueSeeds,
    options.createDraftRowId,
  );
  const draftRowIdByOrdinal = new Map<number, string>();
  const draftLineByOrdinal = new Map<number, ScriptDialogueDraftLine>();
  parsed.dialogues.forEach((line, index) => {
    const draftRow = reconciledDraftRows[index]!;
    draftRowIdByOrdinal.set(line.ordinal, draftRow.draftRowId);
    draftLineByOrdinal.set(line.ordinal, line);
  });

  // Step 2: Audio matching (WF-01) — preserve confirmed audioAssetId, formal
  // Dialogue.id, and source range across edits/inserts/reorders while ignoring
  // stale speaker-mismatched manual overrides and respecting explicit clears.
  const matchRequests: DialogueAudioMatchRequest[] = [];
  const activeManualByDraftRowId = new Map<string, ScriptDialogueAudioOverride>();
  parsed.dialogues.forEach((line, index) => {
    if (line.parseIssue) return;
    const draftRow = reconciledDraftRows[index]!;
    const speakerKey = dialogueDraftSpeakerKey(draftRow);
    const rawManual = overrides.audioByDraftRowId?.[draftRow.draftRowId];
    const manual =
      rawManual &&
      (rawManual.speakerKey === undefined || rawManual.speakerKey === speakerKey)
        ? rawManual
        : undefined;
    if (manual) {
      activeManualByDraftRowId.set(draftRow.draftRowId, manual);
    }

    const manualChangedAsset =
      manual?.audioAssetId !== undefined &&
      manual.audioAssetId !== draftRow.confirmedAudioAssetId;
    const effectiveSourceStartMs =
      manual?.sourceStartMs !== undefined
        ? manual.sourceStartMs
        : manualChangedAsset
          ? undefined
          : draftRow.sourceStartMs;
    const effectiveSourceEndMs =
      manual?.sourceEndMs !== undefined
        ? manual.sourceEndMs
        : manualChangedAsset
          ? undefined
          : draftRow.sourceEndMs;

    matchRequests.push({
      draftRowId: draftRow.draftRowId,
      ordinal: line.ordinal,
      sourceLineNumber: line.sourceLineNumber,
      text: line.text,
      speakerType: line.speakerType,
      ...(line.characterId ? { characterId: line.characterId } : {}),
      speakerName: line.speakerName,
      ...(draftRow.existingDialogueId
        ? { existingDialogueId: draftRow.existingDialogueId }
        : {}),
      ...(draftRow.confirmedAudioAssetId
        ? { confirmedAudioAssetId: draftRow.confirmedAudioAssetId }
        : {}),
      ...(manual?.audioAssetId !== undefined
        ? { manualAudioAssetId: manual.audioAssetId }
        : {}),
      ...(effectiveSourceStartMs !== undefined
        ? { sourceStartMs: effectiveSourceStartMs }
        : {}),
      ...(effectiveSourceEndMs !== undefined
        ? { sourceEndMs: effectiveSourceEndMs }
        : {}),
    });
  });
  const audioMatchReport = matchDialogueAudioRows(project, matchRequests);
  const audioMatchByDraftRowId = new Map<string, DialogueAudioMatchRow>(
    audioMatchReport.rows.map((row) => [row.draftRowId, row]),
  );

  // Hydrate returned dialogueDraftRows with confirmed bindings & source ranges
  // so subsequent inserts/reorders preserve deterministic audio assignments
  // without falling back to ordinal guessing, while explicit clears drop prior bindings.
  const dialogueDraftRows: StableDialogueDraftRow[] = reconciledDraftRows.map(
    (row) => {
      const match = audioMatchByDraftRowId.get(row.draftRowId);
      const manual = activeManualByDraftRowId.get(row.draftRowId);
      if (manual?.audioAssetId === null) {
        const cleared: StableDialogueDraftRow = {
          draftRowId: row.draftRowId,
          sourceLineNumber: row.sourceLineNumber,
          ...(row.logicalOrdinal !== undefined
            ? { logicalOrdinal: row.logicalOrdinal }
            : {}),
          text: row.text,
          speakerType: row.speakerType,
          ...(row.characterId ? { characterId: row.characterId } : {}),
          speakerName: row.speakerName,
          ...(row.existingDialogueId
            ? { existingDialogueId: row.existingDialogueId }
            : {}),
        };
        return cleared;
      }
      if (match?.ready && match.audioAssetId) {
        return {
          ...row,
          confirmedAudioAssetId: match.audioAssetId,
          confirmedSpeakerKey: dialogueDraftSpeakerKey(row),
          ...(match.sourceStartMs !== null
            ? { sourceStartMs: match.sourceStartMs }
            : {}),
          ...(match.sourceEndMs !== null
            ? { sourceEndMs: match.sourceEndMs }
            : {}),
        };
      }
      return row;
    },
  );

  // Step 3: Scene staging (WF-03)
  const scenePlan = planAutoScenes(
    project,
    parsed.sceneBlocks,
    overrides.scene ?? {},
    options,
  );

  const shotService = new ShotService({
    createId,
    ...(options.now ? { now: options.now } : {}),
  });
  const dialogueService = new DialogueService({
    createId,
    ...(options.now ? { now: options.now } : {}),
  });
  const autoSubtitleAudio = new AutoSubtitleAudioService(
    dialogueService,
    shotService,
  );

  let candidate: Project | null = scenePlan.candidateProject;
  const sceneBlockByIndex = new Map<number, PlannedSceneBlock>(
    scenePlan.blocks.map((block) => [block.blockIndex, block]),
  );

  const plannedDialogues: PlannedScriptDialogueRow[] = [];
  const plannedDialogueByDraftRowId = new Map<string, PlannedScriptDialogueRow>();
  const dialogueIdByDraftRowId: Record<string, string> = {};
  const extendedForAudioByBlock = new Set<number>();
  const extendedForPerformanceByBlock = new Set<number>();
  const referencedAudioIds = new Set<string>();
  const referencedRecipeIds = new Set<string>();

  // Step 4: Per-shot WF-01 dialogue + audio timing
  for (const parsedBlock of parsed.blocks) {
    const blockIndex = parsedBlock.scene.index;
    const sceneBlock = sceneBlockByIndex.get(blockIndex);
    const shotId = sceneBlock?.applicable ? sceneBlock.createdShotId : null;

    if (!candidate || !shotId) {
      for (const line of parsedBlock.dialogues) {
        const draftRowId = draftRowIdByOrdinal.get(line.ordinal)!;
        const row: PlannedScriptDialogueRow = {
          draftRowId,
          ordinal: line.ordinal,
          blockIndex,
          sourceLineNumber: line.sourceLineNumber,
          speakerName: line.speakerName,
          speakerType: line.speakerType,
          ...(line.characterId ? { characterId: line.characterId } : {}),
          text: line.text,
          status: line.parseIssue ? 'parse-issue' : 'block-skipped',
          shotId: null,
          dialogueId: null,
          audioClipId: null,
          audioMatch: audioMatchByDraftRowId.get(draftRowId) ?? null,
          startMs: null,
          endMs: null,
          issueCode: line.parseIssue?.code ?? 'BLOCK_SKIPPED',
          issueMessage:
            line.parseIssue?.message ?? '所属镜头未包含或无法生成，对白已跳过。',
        };
        plannedDialogues.push(row);
        plannedDialogueByDraftRowId.set(draftRowId, row);
      }
      continue;
    }

    const readyLinesForShot: {
      line: ScriptDialogueDraftLine;
      draftRowId: string;
      match: DialogueAudioMatchRow;
    }[] = [];

    for (const line of parsedBlock.dialogues) {
      const draftRowId = draftRowIdByOrdinal.get(line.ordinal)!;
      if (line.parseIssue) {
        const row: PlannedScriptDialogueRow = {
          draftRowId,
          ordinal: line.ordinal,
          blockIndex,
          sourceLineNumber: line.sourceLineNumber,
          speakerName: line.speakerName,
          speakerType: line.speakerType,
          ...(line.characterId ? { characterId: line.characterId } : {}),
          text: line.text,
          status: 'parse-issue',
          shotId,
          dialogueId: null,
          audioClipId: null,
          audioMatch: null,
          startMs: null,
          endMs: null,
          issueCode: line.parseIssue.code,
          issueMessage: line.parseIssue.message,
        };
        plannedDialogues.push(row);
        plannedDialogueByDraftRowId.set(draftRowId, row);
        continue;
      }

      const match = audioMatchByDraftRowId.get(draftRowId) ?? null;
      if (!match || !match.ready || !match.audioAssetId) {
        const row: PlannedScriptDialogueRow = {
          draftRowId,
          ordinal: line.ordinal,
          blockIndex,
          sourceLineNumber: line.sourceLineNumber,
          speakerName: line.speakerName,
          speakerType: line.speakerType,
          ...(line.characterId ? { characterId: line.characterId } : {}),
          text: line.text,
          status: 'draft-unready',
          shotId,
          dialogueId: null,
          audioClipId: null,
          audioMatch: match,
          startMs: null,
          endMs: null,
          issueCode: match?.issue ?? 'AUDIO_NOT_FOUND',
          issueMessage:
            match?.issueMessage ??
            `第 ${line.ordinal} 句缺少就绪配音，保留为草稿（不阻断其他就绪台词）。`,
        };
        plannedDialogues.push(row);
        plannedDialogueByDraftRowId.set(draftRowId, row);
        continue;
      }

      referencedAudioIds.add(match.audioAssetId);
      readyLinesForShot.push({ line, draftRowId, match });
    }

    if (readyLinesForShot.length > 0) {
      const scheduleRows = readyLinesForShot.map(({ line, draftRowId, match }) => ({
        draftRowId,
        sourceLineNumber: line.sourceLineNumber,
        text: line.text,
        speakerType: line.speakerType,
        ...(line.characterId ? { characterId: line.characterId } : {}),
        audioAssetId: match.audioAssetId!,
        ...(match.sourceStartMs !== null ? { sourceStartMs: match.sourceStartMs } : {}),
        ...(match.sourceEndMs !== null ? { sourceEndMs: match.sourceEndMs } : {}),
      }));

      const schedulePlan = autoSubtitleAudio.plan(candidate, {
        shotId,
        startMs: 0,
        rows: scheduleRows,
      });

      if (schedulePlan.ready) {
        const applied = autoSubtitleAudio.apply(candidate, {
          shotId,
          startMs: 0,
          rows: scheduleRows,
          ...(schedulePlan.needsShotExtension && schedulePlan.extensionToMs !== null
            ? { extendShotToMs: schedulePlan.extensionToMs }
            : {}),
        });
        candidate = applied.project;
        if (applied.nextShotDurationMs > applied.previousShotDurationMs) {
          extendedForAudioByBlock.add(blockIndex);
        }

        readyLinesForShot.forEach(({ line, draftRowId, match }, idx) => {
          const formalDialogueId = applied.dialogueIds[idx]!;
          const formalAudioClipId = applied.audioClipIds[idx]!;
          const plannedRow = applied.plan.rows[idx]!;
          dialogueIdByDraftRowId[draftRowId] = formalDialogueId;
          const row: PlannedScriptDialogueRow = {
            draftRowId,
            ordinal: line.ordinal,
            blockIndex,
            sourceLineNumber: line.sourceLineNumber,
            speakerName: line.speakerName,
            speakerType: line.speakerType,
            ...(line.characterId ? { characterId: line.characterId } : {}),
            text: line.text,
            status: 'scheduled',
            shotId,
            dialogueId: formalDialogueId,
            audioClipId: formalAudioClipId,
            audioMatch: match,
            startMs: plannedRow.startMs,
            endMs: plannedRow.endMs,
            issueCode: null,
            issueMessage: null,
          };
          plannedDialogues.push(row);
          plannedDialogueByDraftRowId.set(draftRowId, row);
        });
      } else {
        const fallbackBlocker = schedulePlan.blockers[0];
        readyLinesForShot.forEach(({ line, draftRowId, match }) => {
          const rowBlocker =
            schedulePlan.blockers.find((b) => b.draftRowId === draftRowId) ??
            fallbackBlocker;
          const row: PlannedScriptDialogueRow = {
            draftRowId,
            ordinal: line.ordinal,
            blockIndex,
            sourceLineNumber: line.sourceLineNumber,
            speakerName: line.speakerName,
            speakerType: line.speakerType,
            ...(line.characterId ? { characterId: line.characterId } : {}),
            text: line.text,
            status: 'draft-unready',
            shotId,
            dialogueId: null,
            audioClipId: null,
            audioMatch: match,
            startMs: null,
            endMs: null,
            issueCode: rowBlocker?.code ?? 'SCHEDULE_FAILED',
            issueMessage: rowBlocker?.message ?? '对白排轴失败。',
          };
          plannedDialogues.push(row);
          plannedDialogueByDraftRowId.set(draftRowId, row);
        });
      }
    }
  }

  // Sort plannedDialogues back into script ordinal order.
  plannedDialogues.sort((a, b) => a.ordinal - b.ordinal);

  // Step 5: Performance directives (8 basic presets + character actions + action recipes)
  const excludedSet = new Set(overrides.excludedDirectiveIds ?? []);
  const plannedPerformances: PlannedPerformanceRow[] = [];

  for (const directive of parsed.performances) {
    const resolvedDraftRowId =
      directive.dialogueOrdinal !== null
        ? (draftRowIdByOrdinal.get(directive.dialogueOrdinal) ?? null)
        : null;
    const targetDialogue = resolvedDraftRowId
      ? (plannedDialogueByDraftRowId.get(resolvedDraftRowId) ?? null)
      : null;

    if (excludedSet.has(directive.directiveId)) {
      plannedPerformances.push({
        directiveId: directive.directiveId,
        blockIndex: directive.blockIndex,
        sourceLineNumber: directive.sourceLineNumber,
        raw: directive.raw,
        dialogueOrdinal: directive.dialogueOrdinal,
        draftRowId: resolvedDraftRowId,
        dialogueId: targetDialogue?.dialogueId ?? null,
        shotId: targetDialogue?.shotId ?? null,
        shotName: sceneBlockByIndex.get(directive.blockIndex)?.shotName ?? null,
        layerId: null,
        characterId: targetDialogue?.characterId ?? null,
        speakerName: targetDialogue?.speakerName ?? null,
        action: directive.action,
        actionLabel: directive.actionLabel,
        property: null,
        startMs: null,
        endMs: null,
        requiredShotDurationMs: null,
        status: 'skipped',
        eventIds: [],
        issueCode: null,
        issueMessage: '已手动跳过此表演指令。',
      });
      continue;
    }

    const pushIssue = (
      issueCode: PlannedPerformanceIssueCode,
      issueMessage: string,
      extra: Partial<PlannedPerformanceRow> = {},
    ): void => {
      plannedPerformances.push({
        directiveId: directive.directiveId,
        blockIndex: directive.blockIndex,
        sourceLineNumber: directive.sourceLineNumber,
        raw: directive.raw,
        dialogueOrdinal: directive.dialogueOrdinal,
        draftRowId: resolvedDraftRowId,
        dialogueId: targetDialogue?.dialogueId ?? null,
        shotId: targetDialogue?.shotId ?? null,
        shotName: sceneBlockByIndex.get(directive.blockIndex)?.shotName ?? null,
        layerId: null,
        characterId: targetDialogue?.characterId ?? null,
        speakerName: targetDialogue?.speakerName ?? null,
        action: directive.action,
        actionLabel: directive.actionLabel,
        property: null,
        startMs: null,
        endMs: null,
        requiredShotDurationMs: null,
        status: 'issue',
        eventIds: [],
        issueCode,
        issueMessage,
        ...extra,
      });
    };

    if (directive.parseIssue || !directive.action || directive.dialogueOrdinal === null) {
      pushIssue(
        'PARSE_ISSUE',
        directive.parseIssue?.message ?? `第 ${directive.sourceLineNumber} 行表演指令无法解析。`,
      );
      continue;
    }

    if (!targetDialogue || targetDialogue.status !== 'scheduled' || !targetDialogue.shotId || !targetDialogue.dialogueId || targetDialogue.startMs === null || targetDialogue.endMs === null) {
      const hasRawLine = draftLineByOrdinal.has(directive.dialogueOrdinal);
      pushIssue(
        'DIALOGUE_UNRESOLVED',
        hasRawLine
          ? `第 ${directive.dialogueOrdinal} 句对白尚未排轴（缺少就绪配音或镜头未生成），表演「${directive.actionLabel}」已跳过。`
          : `第 ${directive.dialogueOrdinal} 句对白不存在，表演「${directive.actionLabel}」无法锚定。`,
      );
      continue;
    }

    if (targetDialogue.blockIndex !== directive.blockIndex) {
      pushIssue(
        'DIALOGUE_BLOCK_MISMATCH',
        `第 ${directive.dialogueOrdinal} 句对白属于第 ${targetDialogue.blockIndex} 镜头，与当前第 ${directive.blockIndex} 镜头不匹配。`,
      );
      continue;
    }

    const sceneBlock = sceneBlockByIndex.get(directive.blockIndex);
    if (!candidate || !sceneBlock || !sceneBlock.createdShotId) {
      pushIssue(
        'TARGET_LAYER_UNRESOLVED',
        `第 ${directive.blockIndex} 镜头未生成，无法应用表演「${directive.actionLabel}」。`,
      );
      continue;
    }

    if (
      targetDialogue.speakerType === DIALOGUE_SPEAKER_NARRATOR ||
      !targetDialogue.characterId
    ) {
      pushIssue(
        'TARGET_LAYER_UNRESOLVED',
        `第 ${directive.dialogueOrdinal} 句为旁白，没有角色图层可应用「${directive.actionLabel}」。`,
      );
      continue;
    }

    const characterId = targetDialogue.characterId;
    const layerIds = sceneBlock.castLayerIdsByCharacterId[characterId] ?? [];
    const layerId = layerIds[0] ?? null;
    if (!layerId) {
      pushIssue(
        'TARGET_LAYER_UNRESOLVED',
        `第 ${directive.dialogueOrdinal} 句角色「${targetDialogue.speakerName}」未在镜头「${sceneBlock.shotName}」出场，无法应用「${directive.actionLabel}」。`,
      );
      continue;
    }

    const shot = candidate.shots.find((s) => s.id === targetDialogue.shotId);
    const character = candidate.characters.find((c) => c.id === characterId);
    if (!shot || !character) {
      pushIssue(
        'TARGET_LAYER_UNRESOLVED',
        `镜头或角色「${targetDialogue.speakerName}」在候选工程中不可用。`,
        { layerId },
      );
      continue;
    }

    const anchorBaseMs =
      directive.anchor === 'end' ? targetDialogue.endMs : targetDialogue.startMs;
    const startMs = anchorBaseMs + directive.offsetMs;

    // Resolve action-specific target + duration
    if (directive.action === 'character-action') {
      const query = normalizeLookupName(directive.characterActionName ?? '');
      const actions = character.actions ?? [];
      const matchedAction =
        actions.find((a) => a.id === directive.characterActionName) ??
        actions.find((a) => normalizeLookupName(a.name) === query);
      if (!matchedAction) {
        pushIssue(
          'CHARACTER_ACTION_NOT_FOUND',
          `角色「${character.name}」没有名为「${directive.characterActionName ?? ''}」的角色动作。`,
          { layerId, property: 'character-action' },
        );
        continue;
      }

      const durationMs =
        directive.durationMs ??
        inferCharacterActionDurationMs(character, matchedAction.id);
      const endMs = startMs + durationMs;

      if (startMs < 0) {
        pushIssue(
          'OUT_OF_SHOT_BOUNDS',
          `第 ${directive.dialogueOrdinal} 句角色动作「${matchedAction.name}」起点 ${startMs}ms 小于 0ms。`,
          { layerId, property: 'character-action', startMs, endMs },
        );
        continue;
      }

      if (endMs > shot.durationMs) {
        if (extendShotForPerformance) {
          candidate = shotService.setDuration(candidate, shot.id, endMs);
          extendedForPerformanceByBlock.add(directive.blockIndex);
        } else {
          pushIssue(
            'OUT_OF_SHOT_BOUNDS',
            `镜头「${shot.name}」时长 ${shot.durationMs}ms，第 ${directive.dialogueOrdinal} 句角色动作「${matchedAction.name}」（${startMs}–${endMs}ms）超出镜头边界；可确认延长镜头至 ${endMs}ms 或跳过此行。`,
            {
              layerId,
              property: 'character-action',
              startMs,
              endMs,
              requiredShotDurationMs: endMs,
            },
          );
          continue;
        }
      }

      const currentShot = candidate.shots.find((s) => s.id === shot.id)!;
      const conflict = findPropertyOverlap(
        currentShot.timelineEvents,
        layerId,
        'character-action',
        startMs,
        endMs,
      );
      if (conflict) {
        pushIssue(
          'PROPERTY_CONFLICT',
          `镜头「${shot.name}」第 ${directive.dialogueOrdinal} 句角色「${character.name}」的${PROPERTY_LABELS['character-action']}在 ${startMs}–${endMs}ms 与已有动作冲突，保留已有动作。`,
          { layerId, property: 'character-action', startMs, endMs },
        );
        continue;
      }

      try {
        const beforeIds = new Set(currentShot.timelineEvents.map((e) => e.id));
        candidate = upsertCharacterActionEvent(
          candidate,
          shot.id,
          layerId,
          { actionId: matchedAction.id, startMs, endMs },
          createId,
        );
        const afterShot = candidate.shots.find((s) => s.id === shot.id)!;
        const createdIds = afterShot.timelineEvents
          .filter((e) => !beforeIds.has(e.id))
          .map((e) => e.id);
        plannedPerformances.push({
          directiveId: directive.directiveId,
          blockIndex: directive.blockIndex,
          sourceLineNumber: directive.sourceLineNumber,
          raw: directive.raw,
          dialogueOrdinal: directive.dialogueOrdinal,
          draftRowId: resolvedDraftRowId,
          dialogueId: targetDialogue.dialogueId,
          shotId: shot.id,
          shotName: shot.name,
          layerId,
          characterId,
          speakerName: character.name,
          action: directive.action,
          actionLabel: `${PERFORMANCE_ACTION_LABELS[directive.action]}：${matchedAction.name}`,
          property: 'character-action',
          startMs,
          endMs,
          requiredShotDurationMs: null,
          status: 'ready',
          eventIds: createdIds,
          issueCode: null,
          issueMessage: null,
        });
      } catch (error) {
        pushIssue(
          'VALIDATION_FAILED',
          error instanceof Error
            ? `第 ${directive.dialogueOrdinal} 句角色动作应用失败：${error.message}`
            : `第 ${directive.dialogueOrdinal} 句角色动作应用失败。`,
          { layerId, property: 'character-action', startMs, endMs },
        );
      }
      continue;
    }

    if (directive.action === 'action-recipe') {
      const query = normalizeLookupName(directive.recipeName ?? '');
      const recipes = candidate.actionRecipes ?? [];
      const matchedRecipe =
        recipes.find((r) => r.id === directive.recipeName) ??
        recipes.find((r) => normalizeLookupName(r.name) === query);
      if (!matchedRecipe) {
        pushIssue(
          'RECIPE_NOT_FOUND',
          `工程中找不到名为「${directive.recipeName ?? ''}」的操作配方。`,
          { layerId, property: 'action-recipe' },
        );
        continue;
      }

      referencedRecipeIds.add(matchedRecipe.id);
      const bindings = resolveRecipeBindings(
        candidate,
        shot.id,
        layerId,
        matchedRecipe.id,
        overrides.recipeBindingsByDirectiveId?.[directive.directiveId],
      );
      const endMs = getRecipeEndMs(matchedRecipe, startMs, bindings);

      if (directive.durationMs !== undefined) {
        pushIssue(
          'RECIPE_DURATION_OVERRIDE_UNSUPPORTED',
          `配方「${matchedRecipe.name}」使用原时长 ${endMs - startMs}ms，请移除此行的「时长」参数后重试。`,
          { layerId, property: 'action-recipe', startMs, endMs },
        );
        continue;
      }

      if (startMs < 0) {
        pushIssue(
          'OUT_OF_SHOT_BOUNDS',
          `第 ${directive.dialogueOrdinal} 句操作配方「${matchedRecipe.name}」起点 ${startMs}ms 小于 0ms。`,
          { layerId, property: 'action-recipe', startMs, endMs },
        );
        continue;
      }

      const needsExtension = endMs > shot.durationMs;
      if (needsExtension && !extendShotForPerformance) {
        pushIssue(
          'OUT_OF_SHOT_BOUNDS',
          `镜头「${shot.name}」时长 ${shot.durationMs}ms，第 ${directive.dialogueOrdinal} 句配方「${matchedRecipe.name}」（${startMs}–${endMs}ms）超出镜头边界；可确认延长镜头至 ${endMs}ms 或跳过此行。`,
          {
            layerId,
            property: 'action-recipe',
            startMs,
            endMs,
            requiredShotDurationMs: endMs,
          },
        );
        continue;
      }

      try {
        const recipeProject = needsExtension
          ? shotService.setDuration(candidate, shot.id, endMs)
          : candidate;
        const beforeShot = recipeProject.shots.find((s) => s.id === shot.id)!;
        const beforeIds = new Set(beforeShot.timelineEvents.map((e) => e.id));
        candidate = applyActionRecipe(
          recipeProject,
          matchedRecipe.id,
          { shotId: shot.id, layerId, startMs },
          bindings,
        );
        if (needsExtension) extendedForPerformanceByBlock.add(directive.blockIndex);
        const afterShot = candidate.shots.find((s) => s.id === shot.id)!;
        const createdIds = afterShot.timelineEvents
          .filter((e) => !beforeIds.has(e.id))
          .map((e) => e.id);
        plannedPerformances.push({
          directiveId: directive.directiveId,
          blockIndex: directive.blockIndex,
          sourceLineNumber: directive.sourceLineNumber,
          raw: directive.raw,
          dialogueOrdinal: directive.dialogueOrdinal,
          draftRowId: resolvedDraftRowId,
          dialogueId: targetDialogue.dialogueId,
          shotId: shot.id,
          shotName: shot.name,
          layerId,
          characterId,
          speakerName: character.name,
          action: directive.action,
          actionLabel: `${PERFORMANCE_ACTION_LABELS[directive.action]}：${matchedRecipe.name}`,
          property: 'action-recipe',
          startMs,
          endMs,
          requiredShotDurationMs: null,
          status: 'ready',
          eventIds: createdIds,
          issueCode: null,
          issueMessage: null,
        });
      } catch (error) {
        pushIssue(
          'VALIDATION_FAILED',
          error instanceof Error
            ? `第 ${directive.dialogueOrdinal} 句配方「${matchedRecipe.name}」应用失败：${error.message}`
            : `第 ${directive.dialogueOrdinal} 句配方「${matchedRecipe.name}」应用失败。`,
          { layerId, property: 'action-recipe', startMs, endMs },
        );
      }
      continue;
    }

    // 8 legacy basic actions -> official ActionPreset + createPresetEvents + validatePresetApplication + applyPresetEvents
    const presetId = BASIC_PERFORMANCE_PRESET_IDS[directive.action];
    const preset = getActionPreset(presetId);
    const property = propertyOfType(preset.eventType);
    const durationMs = directive.durationMs ?? preset.defaultDurationMs;
    const endMs = startMs + durationMs;

    let expressionId: string | undefined;
    if (directive.action === 'expression') {
      if (character.mode === 'adaptive-parts' && !character.faceBinding) {
        pushIssue(
          'EXPRESSION_NOT_FOUND',
          `角色「${character.name}」尚未配置脸部表情绑定，无法应用表情「${directive.expressionName ?? ''}」。`,
          { layerId, property, startMs, endMs },
        );
        continue;
      }
      const query = normalizeLookupName(directive.expressionName ?? '');
      const expressions = character.expressions ?? [];
      const matches = expressions.filter(
        (expr) =>
          expr.id === directive.expressionName ||
          normalizeLookupName(expr.name) === query,
      );
      if (matches.length !== 1) {
        pushIssue(
          'EXPRESSION_NOT_FOUND',
          `角色「${character.name}」的表情「${directive.expressionName ?? ''}」匹配到 ${matches.length} 项，无法应用。`,
          { layerId, property, startMs, endMs },
        );
        continue;
      }
      expressionId = matches[0]!.id;
    }

    if (startMs < 0) {
      pushIssue(
        'OUT_OF_SHOT_BOUNDS',
        `第 ${directive.dialogueOrdinal} 句「${directive.actionLabel}」起点 ${startMs}ms 小于 0ms。`,
        { layerId, property, startMs, endMs },
      );
      continue;
    }

    if (endMs > shot.durationMs) {
      if (extendShotForPerformance) {
        candidate = shotService.setDuration(candidate, shot.id, endMs);
        extendedForPerformanceByBlock.add(directive.blockIndex);
      } else {
        pushIssue(
          'OUT_OF_SHOT_BOUNDS',
          `镜头「${shot.name}」时长 ${shot.durationMs}ms，第 ${directive.dialogueOrdinal} 句「${directive.actionLabel}」（${startMs}–${endMs}ms）超出镜头边界；可确认延长镜头至 ${endMs}ms 或跳过此行。`,
          {
            layerId,
            property,
            startMs,
            endMs,
            requiredShotDurationMs: endMs,
          },
        );
        continue;
      }
    }

    const currentShot = candidate.shots.find((s) => s.id === shot.id)!;
    const conflict = findPropertyOverlap(
      currentShot.timelineEvents,
      layerId,
      property,
      startMs,
      endMs,
    );
    if (conflict) {
      pushIssue(
        'PROPERTY_CONFLICT',
        `镜头「${shot.name}」第 ${directive.dialogueOrdinal} 句角色「${character.name}」的${PROPERTY_LABELS[property] ?? property}在 ${startMs}–${endMs}ms 与已有动作重叠，保留已有动作。`,
        { layerId, property, startMs, endMs },
      );
      continue;
    }

    const params: CreatePresetEventsParams = { startMs, durationMs };
    if (directive.action === 'move') {
      params.targetX = directive.targetX;
      params.targetY = directive.targetY;
    } else if (directive.action === 'scale') {
      params.scaleFactor = directive.scaleFactor;
    } else if (directive.action === 'shake') {
      if (directive.amplitudeX !== undefined) params.amplitudeX = directive.amplitudeX;
      if (directive.amplitudeY !== undefined) params.amplitudeY = directive.amplitudeY;
      if (directive.frequencyHz !== undefined) params.frequencyHz = directive.frequencyHz;
    } else if (directive.action === 'expression') {
      params.expressionId = expressionId;
    }

    let events: TimelineEvent[];
    try {
      events = createPresetEvents(
        candidate,
        shot.id,
        layerId,
        presetId,
        params,
        { createId },
      );
    } catch (error) {
      pushIssue(
        'VALIDATION_FAILED',
        error instanceof Error
          ? `第 ${directive.dialogueOrdinal} 句「${directive.actionLabel}」生成失败：${error.message}`
          : `第 ${directive.dialogueOrdinal} 句「${directive.actionLabel}」生成失败。`,
        { layerId, property, startMs, endMs },
      );
      continue;
    }

    const validation = validatePresetApplication(
      candidate,
      shot.id,
      layerId,
      events,
    );
    if (!validation.ok) {
      pushIssue(
        'VALIDATION_FAILED',
        `第 ${directive.dialogueOrdinal} 句「${directive.actionLabel}」校验未通过：${validation.errors.join('；')}`,
        { layerId, property, startMs, endMs },
      );
      continue;
    }

    candidate = applyPresetEvents(candidate, shot.id, events);
    plannedPerformances.push({
      directiveId: directive.directiveId,
      blockIndex: directive.blockIndex,
      sourceLineNumber: directive.sourceLineNumber,
      raw: directive.raw,
      dialogueOrdinal: directive.dialogueOrdinal,
      draftRowId: resolvedDraftRowId,
      dialogueId: targetDialogue.dialogueId,
      shotId: shot.id,
      shotName: shot.name,
      layerId,
      characterId,
      speakerName: character.name,
      action: directive.action,
      actionLabel: directive.actionLabel,
      property,
      startMs,
      endMs,
      requiredShotDurationMs: null,
      status: 'ready',
      eventIds: events.map((e) => e.id),
      issueCode: null,
      issueMessage: null,
    });
  }

  const finalCandidate =
    candidate && scenePlan.applicableCount > 0
      ? ProjectSchema.parse(candidate)
      : null;

  const blockSummaries: ScriptPerformanceBlockSummary[] = scenePlan.blocks.map(
    (sceneBlock) => {
      const finalShot =
        finalCandidate && sceneBlock.createdShotId
          ? finalCandidate.shots.find((s) => s.id === sceneBlock.createdShotId)
          : undefined;
      return {
        scene: sceneBlock,
        finalDurationMs: finalShot?.durationMs ?? sceneBlock.durationMs,
        extendedForAudio: extendedForAudioByBlock.has(sceneBlock.blockIndex),
        extendedForPerformance: extendedForPerformanceByBlock.has(
          sceneBlock.blockIndex,
        ),
        dialogues: plannedDialogues.filter(
          (d) => d.blockIndex === sceneBlock.blockIndex,
        ),
        performances: plannedPerformances.filter(
          (p) => p.blockIndex === sceneBlock.blockIndex,
        ),
      };
    },
  );

  const scheduledDialogueCount = plannedDialogues.filter(
    (d) => d.status === 'scheduled',
  ).length;
  const unreadyDialogueCount = plannedDialogues.filter(
    (d) => d.status === 'draft-unready' || d.status === 'parse-issue',
  ).length;
  const readyPerformanceCount = plannedPerformances.filter(
    (p) => p.status === 'ready',
  ).length;
  const issuePerformanceCount = plannedPerformances.filter(
    (p) => p.status === 'issue',
  ).length;
  const skippedPerformanceCount = plannedPerformances.filter(
    (p) => p.status === 'skipped',
  ).length;

  const audioById = new Map(
    project.assets
      .filter((asset): asset is AudioAsset => asset.kind === 'audio')
      .map((asset) => [asset.id, asset]),
  );
  const recipesById = new Map(
    (project.actionRecipes ?? []).map((recipe) => [recipe.id, recipe]),
  );
  const sortedRecipeIds = [...referencedRecipeIds].sort();
  const staleToken: ScriptPerformanceStaleCheckToken = {
    referencedAudio: [...referencedAudioIds].sort().map((id) => {
      const asset = audioById.get(id);
      return {
        id,
        ...(asset?.durationMs !== undefined ? { durationMs: asset.durationMs } : {}),
        ...(asset?.metadata?.status ? { status: asset.metadata.status } : {}),
      };
    }),
    referencedRecipeIds: sortedRecipeIds,
    referencedRecipes: sortedRecipeIds.map((id) => {
      const recipe = recipesById.get(id);
      return {
        id,
        snapshotJson: recipe ? JSON.stringify(recipe) : '',
      };
    }),
  };

  const hasIssues =
    parsed.sceneParseIssues.length > 0 ||
    scenePlan.blockedCount > 0 ||
    unreadyDialogueCount > 0 ||
    issuePerformanceCount > 0;

  return {
    baseProject: project,
    rawInput,
    parsed,
    scenePlan,
    dialogueDraftRows,
    audioMatchReport,
    blocks: blockSummaries,
    dialogues: plannedDialogues,
    performances: plannedPerformances,
    dialogueIdByDraftRowId,
    candidateProject: finalCandidate,
    createdShotIds: scenePlan.createdShotIds,
    applicableBlockCount: scenePlan.applicableCount,
    scheduledDialogueCount,
    unreadyDialogueCount,
    readyPerformanceCount,
    issuePerformanceCount,
    skippedPerformanceCount,
    hasIssues,
    overrides,
    extendShotForPerformance,
    staleToken,
  };
}

/**
 * Apply a `ScriptPerformancePlan` onto `currentProject`, verifying staleness
 * and explicit partial-confirmation policy, and returning a single validated
 * `Project` for ONE `editorProjectStore.updateProject` (1 Undo/Redo).
 */
export function applyScriptPerformancePlan(
  currentProject: Project,
  plan: ScriptPerformancePlan,
  options: ApplyScriptPerformanceOptions = {},
): ScriptPerformanceApplyResult {
  const stale = isScriptPerformancePlanStale(currentProject, plan);
  if (stale.stale) {
    return {
      ok: false,
      errorCode: 'STALE_PLAN',
      message: stale.reason ?? '工程或引用素材已变化，请重新解析剧本计划。',
    };
  }

  if (
    plan.applicableBlockCount === 0 ||
    !plan.candidateProject ||
    plan.createdShotIds.length === 0
  ) {
    return {
      ok: false,
      errorCode: 'NO_APPLICABLE_SCENES',
      message: '没有可生成的有效镜头。',
    };
  }

  if (options.allowPartialConfirm === false && plan.hasIssues) {
    const firstPerfIssue = plan.performances.find((p) => p.status === 'issue');
    const firstDialogueIssue = plan.dialogues.find(
      (d) => d.status === 'draft-unready' || d.status === 'parse-issue',
    );
    const firstSceneIssue = plan.parsed.sceneParseIssues[0];
    return {
      ok: false,
      errorCode: 'HAS_ISSUES',
      message:
        firstPerfIssue?.issueMessage ??
        firstDialogueIssue?.issueMessage ??
        firstSceneIssue?.message ??
        '剧本计划存在未处理的行级问题；请修正后重试或显式确认仅应用合法子集。',
    };
  }

  if (currentProject === plan.baseProject) {
    return {
      ok: true,
      project: ProjectSchema.parse(plan.candidateProject),
      createdShotIds: plan.createdShotIds,
      firstShotId: plan.createdShotIds[0]!,
      dialogueIdByDraftRowId: plan.dialogueIdByDraftRowId,
      blocks: plan.blocks,
      dialogues: plan.dialogues,
      performances: plan.performances,
      scheduledDialogueCount: plan.scheduledDialogueCount,
      readyPerformanceCount: plan.readyPerformanceCount,
      issuePerformanceCount: plan.issuePerformanceCount,
    };
  }

  // Re-plan cleanly against the updated currentProject while preserving
  // resolved draftRowIds and overrides.
  const replanned = planScriptPerformance(currentProject, plan.rawInput, {
    ...options,
    previousDialogueRows: plan.dialogueDraftRows,
    overrides: plan.overrides,
    extendShotForPerformance: plan.extendShotForPerformance,
  });

  if (
    replanned.applicableBlockCount === 0 ||
    !replanned.candidateProject ||
    replanned.createdShotIds.length === 0
  ) {
    return {
      ok: false,
      errorCode: 'APPLY_FAILED',
      message: '重新应用剧本表演计划失败，请重新解析后再试。',
    };
  }

  if (options.allowPartialConfirm === false && replanned.hasIssues) {
    const firstPerfIssue = replanned.performances.find((p) => p.status === 'issue');
    const firstDialogueIssue = replanned.dialogues.find(
      (d) => d.status === 'draft-unready' || d.status === 'parse-issue',
    );
    const firstSceneIssue = replanned.parsed.sceneParseIssues[0];
    return {
      ok: false,
      errorCode: 'HAS_ISSUES',
      message:
        firstPerfIssue?.issueMessage ??
        firstDialogueIssue?.issueMessage ??
        firstSceneIssue?.message ??
        '重新解析后剧本计划存在未处理的行级问题；请重新确认后再应用。',
    };
  }

  return {
    ok: true,
    project: replanned.candidateProject,
    createdShotIds: replanned.createdShotIds,
    firstShotId: replanned.createdShotIds[0]!,
    dialogueIdByDraftRowId: replanned.dialogueIdByDraftRowId,
    blocks: replanned.blocks,
    dialogues: replanned.dialogues,
    performances: replanned.performances,
    scheduledDialogueCount: replanned.scheduledDialogueCount,
    readyPerformanceCount: replanned.readyPerformanceCount,
    issuePerformanceCount: replanned.issuePerformanceCount,
  };
}
