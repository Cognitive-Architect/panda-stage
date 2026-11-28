import { PROJECT_HEIGHT, PROJECT_WIDTH, SHOT_MIN_DURATION_MS } from '../constants';
import {
  applyStandingPlacement,
  computeStandingSlotTargets,
  type LayerLayoutPlanResult,
  type StandingPlacementOptions,
} from '../layout';
import {
  ProjectSchema,
  type Character,
  type Project,
} from '../models';
import { LayerService } from '../services/LayerService';
import { ShotService } from '../services/ShotService';
import {
  parseStructuredSceneBlocks,
  type ParseStructuredSceneOptions,
  type SceneDraftBlock,
  type SceneManualPoint,
  type SceneParseIssue,
} from './sceneInput';
import {
  normalizeSceneResourceName,
  resolveBackgroundMatch,
  resolveCharacterMatch,
  resolvePropMatch,
  type ResolvedBackgroundMatch,
  type ResolvedCharacterMatch,
  type ResolvedPropMatch,
  type SceneBackgroundRef,
  type ScenePropRef,
} from './sceneResolver';

export interface SceneBlockOverrides {
  readonly included?: boolean;
  readonly shotName?: string;
  readonly durationMs?: number;
  readonly background?: SceneBackgroundRef | 'skip';
  readonly cast?: Readonly<
    Record<
      number,
      { readonly characterId: string; readonly expressionId?: string } | 'skip'
    >
  >;
  readonly props?: Readonly<Record<number, ScenePropRef | 'skip'>>;
}

/** Overrides are indexed against the scene input of this planning request. */
export type ScenePlanOverrides = Readonly<Record<number, SceneBlockOverrides>>;

export interface AutoScenePlanIssue {
  readonly severity: 'warning' | 'error';
  readonly scope: 'block' | 'background' | 'cast' | 'prop' | 'layout';
  readonly itemIndex?: number;
  readonly message: string;
}

export interface PlannedSceneCastItem {
  readonly index: number;
  readonly match: ResolvedCharacterMatch;
  readonly explicitPosition?: SceneManualPoint;
  readonly layerId: string | null;
}

export interface PlannedScenePropItem {
  readonly index: number;
  readonly match: ResolvedPropMatch;
  readonly explicitPosition?: SceneManualPoint;
  readonly layerId: string | null;
}

export interface PlannedSceneBlock {
  /** 1-based block index matching `SceneDraftBlock.index`. */
  readonly blockIndex: number;
  readonly draft: SceneDraftBlock;
  readonly included: boolean;
  readonly applicable: boolean;
  readonly shotName: string;
  readonly durationMs: number;
  readonly createdShotId: string | null;
  readonly background: ResolvedBackgroundMatch;
  readonly backgroundLayerId: string | null;
  readonly cast: readonly PlannedSceneCastItem[];
  readonly props: readonly PlannedScenePropItem[];
  /** Convenience lookup for WF-04: characterId -> created layerId(s) in this shot. */
  readonly castLayerIdsByCharacterId: Readonly<Record<string, readonly string[]>>;
  readonly standingPlan: LayerLayoutPlanResult | null;
  readonly issues: readonly AutoScenePlanIssue[];
}

export interface AutoSceneStaleCheckToken {
  readonly projectId: string;
  readonly plannedShotNames: readonly string[];
  readonly referencedAssets: readonly {
    readonly id: string;
    readonly kind: string;
    readonly sha256?: string;
    readonly width?: number;
    readonly height?: number;
  }[];
  readonly referencedCharacters: readonly {
    readonly id: string;
    readonly mode: Character['mode'];
    readonly defaultScale: number;
    readonly defaultFlipX: boolean;
    readonly expressionSignature: string;
  }[];
  readonly referencedAnimations: readonly {
    readonly id: string;
    readonly frameSignature: string;
  }[];
}

export interface AutoScenePlan {
  readonly baseProject: Project;
  readonly blocks: readonly PlannedSceneBlock[];
  readonly candidateProject: Project | null;
  readonly createdShotIds: readonly string[];
  readonly applicableCount: number;
  readonly skippedCount: number;
  readonly blockedCount: number;
  readonly staleCheck: AutoSceneStaleCheckToken;
}

export interface PlanAutoScenesOptions {
  readonly shotService?: Pick<ShotService, 'create'>;
  readonly layerService?: Pick<
    LayerService,
    'createFromAsset' | 'createFromAdaptiveCharacter' | 'setBackground'
  >;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export interface AutoSceneStaleCheckResult {
  readonly stale: boolean;
  readonly reason?: string;
}

export type AutoSceneApplyErrorCode =
  | 'STALE_PLAN'
  | 'NO_APPLICABLE_SCENES'
  | 'APPLY_FAILED';

export type AutoSceneApplyResult =
  | {
      readonly ok: true;
      readonly project: Project;
      readonly createdShotIds: readonly string[];
      readonly firstShotId: string;
      readonly blocks: readonly PlannedSceneBlock[];
    }
  | {
      readonly ok: false;
      readonly errorCode: AutoSceneApplyErrorCode;
      readonly message: string;
    };

export interface ParseAndPlanAutoScenesResult {
  readonly parseOk: boolean;
  readonly parseIssues: readonly SceneParseIssue[];
  readonly plan: AutoScenePlan | null;
}

function buildStandingOptionsForBlock(
  draft: SceneDraftBlock,
  standingCast: readonly PlannedSceneCastItem[],
): StandingPlacementOptions {
  const { stance } = draft;
  const options: {
    groundYRatio?: number;
    leftXRatio?: number;
    rightXRatio?: number;
    xRatios?: number[];
    matchHeight?: boolean;
  } = {};

  if (stance.groundYRatio !== undefined) options.groundYRatio = stance.groundYRatio;
  if (stance.leftXRatio !== undefined) options.leftXRatio = stance.leftXRatio;
  if (stance.rightXRatio !== undefined) options.rightXRatio = stance.rightXRatio;
  if (stance.matchHeight !== undefined) options.matchHeight = stance.matchHeight;

  if (stance.namedXRatios && Object.keys(stance.namedXRatios).length > 0) {
    const defaultTargets = computeStandingSlotTargets(standingCast.length, options);
    options.xRatios = standingCast.map((item, idx) => {
      const byQuery = stance.namedXRatios?.[item.match.queryName];
      const bySelected = item.match.selectedName
        ? stance.namedXRatios?.[item.match.selectedName]
        : undefined;
      return byQuery ?? bySelected ?? defaultTargets[idx]?.xRatio ?? 0.5;
    });
  } else if (stance.xRatios && stance.xRatios.length >= standingCast.length) {
    options.xRatios = [...stance.xRatios.slice(0, standingCast.length)];
  } else if (
    standingCast.length >= 3 &&
    options.leftXRatio === undefined &&
    options.rightXRatio === undefined
  ) {
    // Give 3+ standing characters generous horizontal breathing room by default.
    options.leftXRatio = 0.22;
    options.rightXRatio = 0.78;
  }

  return options;
}

function characterExpressionSignature(character: Character): string {
  if (character.mode === 'adaptive-parts') {
    const expressions = [...(character.expressions ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify([character.defaultExpressionId, character.faceBinding, expressions]);
  }
  const exprs = character.expressions
    .map((expr) => `${expr.id}:${expr.assetId}`)
    .sort()
    .join(',');
  return `${character.mode}:${character.defaultExpressionId}:${exprs}`;
}

function buildStaleCheckToken(
  project: Project,
  blocks: readonly PlannedSceneBlock[],
): AutoSceneStaleCheckToken {
  const plannedShotNames: string[] = [];
  const assetIds = new Set<string>();
  const characterIds = new Set<string>();
  const animationIds = new Set<string>();

  for (const block of blocks) {
    if (!block.applicable) continue;
    plannedShotNames.push(normalizeSceneResourceName(block.shotName));

    if (block.background.selectedRef.kind === 'image') {
      assetIds.add(block.background.selectedRef.assetId);
    } else if (block.background.selectedRef.kind === 'graphic') {
      animationIds.add(block.background.selectedRef.animationId);
    }

    for (const castItem of block.cast) {
      if (castItem.match.selectedRef) {
        characterIds.add(castItem.match.selectedRef.characterId);
      }
    }

    for (const propItem of block.props) {
      if (propItem.match.selectedRef?.kind === 'image') {
        assetIds.add(propItem.match.selectedRef.assetId);
      } else if (propItem.match.selectedRef?.kind === 'animation') {
        animationIds.add(propItem.match.selectedRef.animationId);
      }
    }
  }

  // Expand character expression assets and animation frame assets into assetIds.
  for (const characterId of characterIds) {
    const character = project.characters.find((c) => c.id === characterId);
    for (const expr of character?.expressions ?? []) {
      if (expr.visualSource) animationIds.add(expr.visualSource.animationId);
      else if (expr.assetId) assetIds.add(expr.assetId);
    }
  }
  for (const animationId of animationIds) {
    const animation = project.animations.find((a) => a.id === animationId);
    if (animation) {
      for (const frame of animation.frames) {
        if (frame.assetId) assetIds.add(frame.assetId);
      }
    }
  }

  const referencedAssets = [...assetIds]
    .sort()
    .map((id) => {
      const asset = project.assets.find((a) => a.id === id);
      return {
        id,
        kind: asset?.kind ?? 'missing',
        ...(asset?.sha256 ? { sha256: asset.sha256 } : {}),
        ...(asset && 'width' in asset ? { width: asset.width, height: asset.height } : {}),
      };
    });

  const referencedCharacters = [...characterIds]
    .sort()
    .map((id) => {
      const character = project.characters.find((c) => c.id === id);
      return {
        id,
        mode: character?.mode ?? 'single-image',
        defaultScale: character?.defaultScale ?? 1,
        defaultFlipX: character?.defaultFlipX ?? false,
        expressionSignature: character ? characterExpressionSignature(character) : 'missing',
      };
    });

  const referencedAnimations = [...animationIds]
    .sort()
    .map((id) => {
      const animation = project.animations.find((a) => a.id === id);
      const frameSignature = animation
        ? animation.frames.map((f) => `${f.assetId}:${f.sha256}`).join('|')
        : 'missing';
      return { id, frameSignature };
    });

  return {
    projectId: project.id,
    plannedShotNames,
    referencedAssets,
    referencedCharacters,
    referencedAnimations,
  };
}

/**
 * Check whether the project or any asset/character/animation referenced by `plan`
 * has changed since the plan was built.
 */
export function isAutoScenePlanStale(
  currentProject: Project,
  plan: AutoScenePlan,
): AutoSceneStaleCheckResult {
  const token = plan.staleCheck;
  if (currentProject.id !== token.projectId) {
    return {
      stale: true,
      reason: '当前工程已切换，请重新解析布景计划。',
    };
  }

  const currentShotNames = new Set(
    currentProject.shots.map((shot) => normalizeSceneResourceName(shot.name)),
  );
  for (const plannedName of token.plannedShotNames) {
    if (currentShotNames.has(plannedName)) {
      return {
        stale: true,
        reason: '工程中已存在同名镜头，布景计划已过期，请重新解析。',
      };
    }
  }

  const assetsById = new Map(currentProject.assets.map((a) => [a.id, a]));
  for (const ref of token.referencedAssets) {
    const asset = assetsById.get(ref.id);
    if (
      !asset ||
      asset.kind !== ref.kind ||
      asset.sha256 !== ref.sha256 ||
      ('width' in asset && (asset.width !== ref.width || asset.height !== ref.height))
    ) {
      return {
        stale: true,
        reason: '引用的图片素材已变动或删除，请重新解析布景计划。',
      };
    }
  }

  const charactersById = new Map(currentProject.characters.map((c) => [c.id, c]));
  for (const ref of token.referencedCharacters) {
    const character = charactersById.get(ref.id);
    if (
      !character ||
      character.mode !== ref.mode ||
      character.defaultScale !== ref.defaultScale ||
      character.defaultFlipX !== ref.defaultFlipX ||
      characterExpressionSignature(character) !== ref.expressionSignature
    ) {
      return {
        stale: true,
        reason: '引用的角色定义已变动或删除，请重新解析布景计划。',
      };
    }
  }

  const animationsById = new Map(currentProject.animations.map((a) => [a.id, a]));
  for (const ref of token.referencedAnimations) {
    const animation = animationsById.get(ref.id);
    const frameSignature = animation
      ? animation.frames.map((f) => `${f.assetId}:${f.sha256}`).join('|')
      : 'missing';
    if (!animation || frameSignature !== ref.frameSignature) {
      return {
        stale: true,
        reason: '引用的元件/动画素材已变动或删除，请重新解析布景计划。',
      };
    }
  }

  return { stale: false };
}

function createServices(options: PlanAutoScenesOptions): {
  shotService: Pick<ShotService, 'create'>;
  layerService: Pick<
    LayerService,
    'createFromAsset' | 'createFromAdaptiveCharacter' | 'setBackground'
  >;
} {
  return {
    shotService:
      options.shotService ??
      new ShotService({
        ...(options.createId ? { createId: options.createId } : {}),
        ...(options.now ? { now: options.now } : {}),
      }),
    layerService:
      options.layerService ??
      new LayerService({
        ...(options.createId ? { createId: options.createId } : {}),
        ...(options.now ? { now: options.now } : {}),
      }),
  };
}

/**
 * Plan one or more scenes from `SceneDraftBlock[]` (single shot = length-1 array)
 * into a read-only candidate `Project` using official `ShotService`, `LayerService`,
 * and WF-02 `applyStandingPlacement`.
 *
 * Designed as the shared scene planner seam reusable by WF-04.
 */
export function planAutoScenes(
  project: Project,
  draftBlocks: readonly SceneDraftBlock[],
  overrides: ScenePlanOverrides = {},
  options: PlanAutoScenesOptions = {},
): AutoScenePlan {
  const { shotService, layerService } = createServices(options);
  const existingShotNames = new Set(
    project.shots.map((shot) => normalizeSceneResourceName(shot.name)),
  );
  const batchShotNames = new Set<string>();

  let candidate: Project = project;
  const plannedBlocks: PlannedSceneBlock[] = [];
  const createdShotIds: string[] = [];
  let applicableCount = 0;
  let skippedCount = 0;
  let blockedCount = 0;

  for (const draft of draftBlocks) {
    const blockOverride = overrides[draft.index];
    const included = blockOverride?.included ?? true;
    const shotName = (blockOverride?.shotName ?? draft.shotName).trim();
    const durationMs = blockOverride?.durationMs ?? draft.durationMs;
    const issues: AutoScenePlanIssue[] = [];

    const background = resolveBackgroundMatch(
      project,
      draft.backgroundName,
      blockOverride?.background,
    );
    if (background.message && background.status !== 'matched' && background.status !== 'empty') {
      issues.push({
        severity: 'warning',
        scope: 'background',
        message: background.message,
      });
    }

    const castDrafts: {
      index: number;
      match: ResolvedCharacterMatch;
      explicitPosition?: SceneManualPoint;
    }[] = draft.cast.map((entry, idx) => {
      const match = resolveCharacterMatch(
        project,
        entry.index,
        entry.name,
        entry.expressionName,
        blockOverride?.cast?.[entry.index],
      );
      const explicitPosition =
        entry.explicitPosition ?? draft.stance.explicitPositions?.[idx];
      if (match.message && match.status !== 'matched' && match.status !== 'skipped') {
        issues.push({
          severity: 'warning',
          scope: 'cast',
          itemIndex: entry.index,
          message: match.message,
        });
      }
      return {
        index: entry.index,
        match,
        ...(explicitPosition ? { explicitPosition } : {}),
      };
    });

    const propDrafts: {
      index: number;
      match: ResolvedPropMatch;
      explicitPosition?: SceneManualPoint;
    }[] = draft.props.map((entry) => {
      const match = resolvePropMatch(
        project,
        entry.index,
        entry.name,
        blockOverride?.props?.[entry.index],
      );
      if (match.message && match.status !== 'matched' && match.status !== 'skipped') {
        issues.push({
          severity: 'warning',
          scope: 'prop',
          itemIndex: entry.index,
          message: match.message,
        });
      }
      return {
        index: entry.index,
        match,
        ...(entry.explicitPosition ? { explicitPosition: entry.explicitPosition } : {}),
      };
    });

    if (!included) {
      skippedCount += 1;
      plannedBlocks.push({
        blockIndex: draft.index,
        draft,
        included: false,
        applicable: false,
        shotName,
        durationMs,
        createdShotId: null,
        background,
        backgroundLayerId: null,
        cast: castDrafts.map((c) => ({ ...c, layerId: null })),
        props: propDrafts.map((p) => ({ ...p, layerId: null })),
        castLayerIdsByCharacterId: {},
        standingPlan: null,
        issues,
      });
      continue;
    }

    // Block-level fatal checks: empty/conflicting shot name or invalid duration.
    let blockBlocked = false;
    const normalizedShotName = normalizeSceneResourceName(shotName);
    if (!shotName) {
      issues.push({
        severity: 'error',
        scope: 'block',
        message: `镜头 ${draft.index} 名称不能为空。`,
      });
      blockBlocked = true;
    } else if (
      existingShotNames.has(normalizedShotName) ||
      batchShotNames.has(normalizedShotName)
    ) {
      issues.push({
        severity: 'error',
        scope: 'block',
        message: `镜头名称「${shotName}」与已有镜头或同批其他镜头重复。`,
      });
      blockBlocked = true;
    }

    if (!Number.isSafeInteger(durationMs) || durationMs < SHOT_MIN_DURATION_MS) {
      issues.push({
        severity: 'error',
        scope: 'block',
        message: `镜头「${shotName || draft.index}」时长必须 ≥ ${SHOT_MIN_DURATION_MS}ms。`,
      });
      blockBlocked = true;
    }

    if (blockBlocked) {
      blockedCount += 1;
      plannedBlocks.push({
        blockIndex: draft.index,
        draft,
        included: true,
        applicable: false,
        shotName,
        durationMs,
        createdShotId: null,
        background,
        backgroundLayerId: null,
        cast: castDrafts.map((c) => ({ ...c, layerId: null })),
        props: propDrafts.map((p) => ({ ...p, layerId: null })),
        castLayerIdsByCharacterId: {},
        standingPlan: null,
        issues,
      });
      continue;
    }

    // Execute official domain services on the candidate Project for this valid block.
    const previousCandidate = candidate;
    try {
      candidate = shotService.create(candidate, { name: shotName, durationMs });
      const createdShot = candidate.shots.at(-1)!;
      const shotId = createdShot.id;
      batchShotNames.add(normalizedShotName);

      // 1. Background layer (image or FLA Graphic; empty background creates no bg layer).
      let backgroundLayerId: string | null = null;
      if (background.selectedRef.kind === 'image') {
        const created = layerService.createFromAsset(candidate, shotId, {
          version: 2,
          type: 'asset-image',
          assetId: background.selectedRef.assetId,
          position: { x: PROJECT_WIDTH / 2, y: PROJECT_HEIGHT / 2 },
        });
        candidate = layerService.setBackground(created.project, shotId, created.layer.id);
        backgroundLayerId = created.layer.id;
      } else if (background.selectedRef.kind === 'graphic') {
        const created = layerService.createFromAsset(candidate, shotId, {
          version: 3,
          type: 'animation',
          animationId: background.selectedRef.animationId,
          position: { x: PROJECT_WIDTH / 2, y: PROJECT_HEIGHT / 2 },
          startTimeMs: 0,
        });
        candidate = layerService.setBackground(created.project, shotId, created.layer.id);
        backgroundLayerId = created.layer.id;
      }

      // 2. Cast layers (supports single-image, composite, and adaptive-parts characters).
      const plannedCast: PlannedSceneCastItem[] = [];
      const castLayerIdsByCharacterId: Record<string, string[]> = {};
      const standingCastItems: PlannedSceneCastItem[] = [];

      const defaultCastTargets = computeStandingSlotTargets(
        Math.max(1, castDrafts.filter((c) => c.match.selectedRef !== null).length),
      );
      let placedCastOrdinal = 0;

      for (const castDraft of castDrafts) {
        const ref = castDraft.match.selectedRef;
        if (!ref) {
          plannedCast.push({ ...castDraft, layerId: null });
          continue;
        }
        const initialTarget = defaultCastTargets[placedCastOrdinal] ?? {
          centerX: PROJECT_WIDTH / 2,
          groundY: PROJECT_HEIGHT * 0.72,
        };
        const initialPos = castDraft.explicitPosition ?? {
          x: initialTarget.centerX,
          y: Math.min(PROJECT_HEIGHT * 0.72, initialTarget.groundY),
        };
        placedCastOrdinal += 1;

        let createdLayerId: string;
        if (ref.mode === 'adaptive-parts') {
          const created = layerService.createFromAdaptiveCharacter(
            candidate,
            shotId,
            ref.characterId,
            initialPos,
            ref.expressionId,
          );
          candidate = created.project;
          createdLayerId = created.layer.id;
        } else {
          const character = candidate.characters.find((c) => c.id === ref.characterId);
          const expression =
            character && character.mode !== 'adaptive-parts'
              ? character.expressions.find((e) => e.id === ref.expressionId) ??
                character.expressions.find((e) => e.id === character.defaultExpressionId) ??
                character.expressions[0]
              : undefined;
          if (!character || !expression) {
            issues.push({
              severity: 'warning',
              scope: 'cast',
              itemIndex: castDraft.index,
              message: `角色「${castDraft.match.queryName}」缺少有效表情，已跳过该角色。`,
            });
            plannedCast.push({ ...castDraft, layerId: null });
            continue;
          }
          const created = layerService.createFromAsset(candidate, shotId, {
            version: 2,
            type: 'character-expression',
            characterId: character.id,
            expressionId: expression.id,
            ...(expression.assetId ? { assetId: expression.assetId } : {}),
            position: initialPos,
          });
          candidate = created.project;
          createdLayerId = created.layer.id;
        }

        const item: PlannedSceneCastItem = {
          ...castDraft,
          layerId: createdLayerId,
        };
        plannedCast.push(item);
        if (!castLayerIdsByCharacterId[ref.characterId]) {
          castLayerIdsByCharacterId[ref.characterId] = [];
        }
        castLayerIdsByCharacterId[ref.characterId]!.push(createdLayerId);
        if (!castDraft.explicitPosition) {
          standingCastItems.push(item);
        }
      }

      // 3. Apply WF-02 standing placement for all cast layers without explicit coords.
      let standingPlan: LayerLayoutPlanResult | null = null;
      if (standingCastItems.length > 0) {
        const standingLayerIds = standingCastItems
          .map((item) => item.layerId)
          .filter((id): id is string => id !== null);
        const standingOptions = buildStandingOptionsForBlock(draft, standingCastItems);
        const appliedStanding = applyStandingPlacement(candidate, {
          shotId,
          layerIds: standingLayerIds,
          timeMs: 0,
          autoKey: false,
          ...standingOptions,
        });
        candidate = appliedStanding.project;
        standingPlan = appliedStanding.plan;
        if (!appliedStanding.plan.ok && appliedStanding.plan.error) {
          issues.push({
            severity: 'warning',
            scope: 'layout',
            message: `站位布局未能全部应用：${appliedStanding.plan.error}`,
          });
        }
      }

      // 4. Prop layers (image or animation/Graphic).
      const plannedProps: PlannedScenePropItem[] = [];
      const autoPropCount = propDrafts.filter(
        (p) => p.match.selectedRef !== null && !p.explicitPosition,
      ).length;
      const propTargets = computeStandingSlotTargets(autoPropCount, {
        leftXRatio: 0.25,
        rightXRatio: 0.75,
        groundYRatio: 0.88,
      });
      let autoPropOrdinal = 0;
      const autoPropLayerIds: string[] = [];

      for (const propDraft of propDrafts) {
        const ref = propDraft.match.selectedRef;
        if (!ref) {
          plannedProps.push({ ...propDraft, layerId: null });
          continue;
        }
        const target = propDraft.explicitPosition
          ? propDraft.explicitPosition
          : {
              x: propTargets[autoPropOrdinal]?.centerX ?? PROJECT_WIDTH / 2,
              y: PROJECT_HEIGHT * 0.75,
            };
        if (!propDraft.explicitPosition) autoPropOrdinal += 1;

        const created =
          ref.kind === 'image'
            ? layerService.createFromAsset(candidate, shotId, {
                version: 2,
                type: 'asset-image',
                assetId: ref.assetId,
                position: target,
              })
            : layerService.createFromAsset(candidate, shotId, {
                version: 3,
                type: 'animation',
                animationId: ref.animationId,
                position: target,
                startTimeMs: 0,
              });
        candidate = created.project;
        plannedProps.push({ ...propDraft, layerId: created.layer.id });
        if (!propDraft.explicitPosition) {
          autoPropLayerIds.push(created.layer.id);
        }
      }

      if (autoPropLayerIds.length > 0) {
        const appliedProps = applyStandingPlacement(candidate, {
          shotId,
          layerIds: autoPropLayerIds,
          timeMs: 0,
          autoKey: false,
          leftXRatio: 0.25,
          rightXRatio: 0.75,
          groundYRatio: 0.88,
        });
        candidate = appliedProps.project;
      }

      createdShotIds.push(shotId);
      applicableCount += 1;
      plannedBlocks.push({
        blockIndex: draft.index,
        draft,
        included: true,
        applicable: true,
        shotName,
        durationMs,
        createdShotId: shotId,
        background,
        backgroundLayerId,
        cast: plannedCast,
        props: plannedProps,
        castLayerIdsByCharacterId,
        standingPlan,
        issues,
      });
    } catch (error) {
      candidate = previousCandidate;
      blockedCount += 1;
      issues.push({
        severity: 'error',
        scope: 'block',
        message:
          error instanceof Error
            ? `镜头「${shotName}」生成失败：${error.message}`
            : `镜头「${shotName}」生成失败。`,
      });
      plannedBlocks.push({
        blockIndex: draft.index,
        draft,
        included: true,
        applicable: false,
        shotName,
        durationMs,
        createdShotId: null,
        background,
        backgroundLayerId: null,
        cast: castDrafts.map((c) => ({ ...c, layerId: null })),
        props: propDrafts.map((p) => ({ ...p, layerId: null })),
        castLayerIdsByCharacterId: {},
        standingPlan: null,
        issues,
      });
    }
  }

  const candidateProject =
    applicableCount > 0 ? ProjectSchema.parse(candidate) : null;
  const staleCheck = buildStaleCheckToken(project, plannedBlocks);

  return {
    baseProject: project,
    blocks: plannedBlocks,
    candidateProject,
    createdShotIds,
    applicableCount,
    skippedCount,
    blockedCount,
    staleCheck,
  };
}

/**
 * Convenience helper: parse structured Chinese scene text and plan all valid blocks
 * in a single call.
 */
export function parseAndPlanAutoScenes(
  project: Project,
  rawInput: string,
  overrides: ScenePlanOverrides = {},
  options: ParseStructuredSceneOptions & PlanAutoScenesOptions = {},
): ParseAndPlanAutoScenesResult {
  const parsed = parseStructuredSceneBlocks(rawInput, options);
  if (parsed.blocks.length === 0) {
    return {
      parseOk: false,
      parseIssues: parsed.issues,
      plan: null,
    };
  }
  const plan = planAutoScenes(project, parsed.blocks, overrides, options);
  return {
    parseOk: parsed.ok,
    parseIssues: parsed.issues,
    plan,
  };
}

/**
 * Apply a previously planned `AutoScenePlan` onto `currentProject`, verifying
 * staleness before returning the formal `Project` to be committed in ONE
 * `updateProject` call.
 */
export function applyAutoScenePlan(
  currentProject: Project,
  plan: AutoScenePlan,
  options: PlanAutoScenesOptions = {},
): AutoSceneApplyResult {
  const staleResult = isAutoScenePlanStale(currentProject, plan);
  if (staleResult.stale) {
    return {
      ok: false,
      errorCode: 'STALE_PLAN',
      message: staleResult.reason ?? '工程或引用素材已变化，请重新解析布景计划。',
    };
  }

  if (plan.applicableCount === 0 || !plan.candidateProject || plan.createdShotIds.length === 0) {
    return {
      ok: false,
      errorCode: 'NO_APPLICABLE_SCENES',
      message: '没有可生成的有效镜头。',
    };
  }

  if (currentProject === plan.baseProject) {
    return {
      ok: true,
      project: ProjectSchema.parse(plan.candidateProject),
      createdShotIds: plan.createdShotIds,
      firstShotId: plan.createdShotIds[0]!,
      blocks: plan.blocks,
    };
  }

  // Re-apply resolved official IDs onto the updated currentProject (e.g. after
  // an unrelated non-conflicting edit) while preserving identical placement.
  const resolvedOverrides: Record<number, SceneBlockOverrides> = {};
  const drafts: SceneDraftBlock[] = [];
  for (const block of plan.blocks) {
    drafts.push(block.draft);
    const castOverrides: Record<
      number,
      { readonly characterId: string; readonly expressionId?: string } | 'skip'
    > = {};
    for (const c of block.cast) {
      castOverrides[c.index] = c.match.selectedRef
        ? {
            characterId: c.match.selectedRef.characterId,
            ...(c.match.selectedRef.expressionId
              ? { expressionId: c.match.selectedRef.expressionId }
              : {}),
          }
        : 'skip';
    }
    const propOverrides: Record<number, ScenePropRef | 'skip'> = {};
    for (const p of block.props) {
      propOverrides[p.index] = p.match.selectedRef ?? 'skip';
    }
    resolvedOverrides[block.blockIndex] = {
      included: block.applicable,
      shotName: block.shotName,
      durationMs: block.durationMs,
      background: block.background.selectedRef,
      cast: castOverrides,
      props: propOverrides,
    };
  }

  const reapplied = planAutoScenes(currentProject, drafts, resolvedOverrides, options);
  if (
    reapplied.applicableCount === 0 ||
    !reapplied.candidateProject ||
    reapplied.createdShotIds.length === 0
  ) {
    return {
      ok: false,
      errorCode: 'APPLY_FAILED',
      message: '重新应用布景计划失败，请重新解析后再试。',
    };
  }

  return {
    ok: true,
    project: reapplied.candidateProject,
    createdShotIds: reapplied.createdShotIds,
    firstShotId: reapplied.createdShotIds[0]!,
    blocks: reapplied.blocks,
  };
}
