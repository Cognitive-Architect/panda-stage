import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../constants';
import {
  planQuickCharacterLayout,
  type QuickLayoutPoint,
} from '../layout/quickCharacterLayout';
import { ProjectSchema, type Project } from '../models';
import {
  MULTI_SCENE_SHOT_DURATION_MS,
  type MultiSceneBlock,
} from '../scene/multiSceneInput';
import {
  resolveBackgroundSlot,
  resolveCharacterSlot,
  type SceneSlotResolution,
} from '../scene/sceneResources';
import { LayerService } from './LayerService';
import { ShotService, ShotServiceError } from './ShotService';

/** Where the two Characters sit before the AUTO-01 planner runs. */
const QUICK_LAYOUT_PROVISIONAL_X = PROJECT_WIDTH / 2;

/** Per-block explicit picks; only used to break same-name ambiguity. */
export interface MultiSceneSlotSelection {
  readonly backgroundAssetId?: string | null;
  readonly leftCharacterId?: string | null;
  readonly rightCharacterId?: string | null;
}

export type MultiSceneSelections = readonly (
  | MultiSceneSlotSelection
  | undefined
)[];

export interface MultiSceneBlockReport {
  readonly index: number;
  readonly shotName: string;
  readonly background: SceneSlotResolution;
  readonly left: SceneSlotResolution;
  readonly right: SceneSlotResolution;
  readonly ready: boolean;
}

export interface MultiSceneReport {
  readonly blocks: readonly MultiSceneBlockReport[];
  /** True only when every block resolved its background and both Characters. */
  readonly ready: boolean;
}

export interface MultiScenePlannedShot {
  readonly index: number;
  readonly shotId: string;
  readonly shotName: string;
  readonly backgroundLayerId: string;
  readonly backgroundAssetId: string;
  readonly leftLayerId: string;
  readonly rightLayerId: string;
  readonly leftCharacterId: string;
  readonly rightCharacterId: string;
  readonly leftPosition: QuickLayoutPoint;
  readonly rightPosition: QuickLayoutPoint;
}

export interface MultiScenePlan {
  /** The complete next Project; nothing in it is committed until one update. */
  readonly candidateProject: Project;
  readonly shots: readonly MultiScenePlannedShot[];
  readonly createdShotIds: readonly string[];
}

export type MultiScenePlanFailureCode =
  | 'SHOT_NAME_CONFLICT'
  | 'SCENE_SLOT_UNRESOLVED'
  | 'LAYOUT_OUT_OF_CANVAS'
  | 'GENERATED_SCENE_INVALID'
  // AUTO-05: the dialogue/audio layer refuses the whole batch on any of these.
  | 'SPEAKER_BINDING_UNRESOLVED'
  | 'SPEAKER_BINDING_CONFLICT'
  | 'AUDIO_MATCH_FAILED'
  | 'DIALOGUE_GENERATION_FAILED';

/**
 * AUTO-05 attaches a richer read-only plan through the same outcome contract.
 * The failure branch is shared verbatim, so the UI has one refusal surface.
 */
export type MultiScenePlanOutcome<
  TPlan extends MultiScenePlan = MultiScenePlan,
> =
  | { readonly ok: true; readonly plan: TPlan }
  | {
      readonly ok: false;
      readonly code: MultiScenePlanFailureCode;
      readonly message: string;
      readonly blockIndex?: number;
    };

export interface MultiSceneServiceOptions {
  shotService?: Pick<ShotService, 'create'>;
  layerService?: Pick<
    LayerService,
    'createFromAsset' | 'setBackground' | 'updatePosition'
  >;
}

function selectionFor(
  selections: MultiSceneSelections,
  blockOffset: number,
): MultiSceneSlotSelection {
  return selections[blockOffset] ?? {};
}

/**
 * Resolve every slot of every block against one Project snapshot. This is the
 * single truth the panel renders and the planner enforces, so the two can never
 * disagree about whether a batch is submittable.
 */
export function inspectMultiScene(
  project: Project,
  blocks: readonly MultiSceneBlock[],
  selections: MultiSceneSelections = [],
): MultiSceneReport {
  const parsed = ProjectSchema.parse(project);
  const reports = blocks.map((block, blockOffset): MultiSceneBlockReport => {
    const selection = selectionFor(selections, blockOffset);
    const background = resolveBackgroundSlot(
      parsed,
      block.backgroundName,
      selection.backgroundAssetId ?? null,
    ).resolution;
    const left = resolveCharacterSlot(
      parsed,
      'left-character',
      block.cast[0],
      selection.leftCharacterId ?? null,
    ).resolution;
    const right = resolveCharacterSlot(
      parsed,
      'right-character',
      block.cast[1],
      selection.rightCharacterId ?? null,
    ).resolution;
    const slots = [background, left, right];
    return {
      index: block.index,
      shotName: block.shotName,
      background,
      left,
      right,
      ready: slots.every((slot) => slot.status === 'ready'),
    };
  });
  return {
    blocks: reports,
    ready: reports.length > 0 && reports.every((block) => block.ready),
  };
}

function slotFailure(
  block: MultiSceneBlock,
  slot: SceneSlotResolution,
): MultiScenePlanOutcome {
  const label =
    slot.slot === 'background'
      ? '背景'
      : slot.slot === 'left-character'
        ? '左角色'
        : '右角色';
  return {
    ok: false,
    code: 'SCENE_SLOT_UNRESOLVED',
    message: `镜头 ${block.index} 的${label}还没有确定：${
      slot.message ?? '请重新检查素材。'
    }`,
    blockIndex: block.index,
  };
}

export class MultiSceneService {
  private readonly shotService: Pick<ShotService, 'create'>;
  private readonly layerService: Pick<
    LayerService,
    'createFromAsset' | 'setBackground' | 'updatePosition'
  >;

  constructor(options: MultiSceneServiceOptions = {}) {
    this.shotService = options.shotService ?? new ShotService();
    this.layerService = options.layerService ?? new LayerService();
  }

  inspect(
    project: Project,
    blocks: readonly MultiSceneBlock[],
    selections: MultiSceneSelections = [],
  ): MultiSceneReport {
    return inspectMultiScene(project, blocks, selections);
  }

  /**
   * Build every candidate Shot on one baseline snapshot. Any failure returns
   * without a plan, so the caller cannot commit a partial batch.
   */
  plan(
    projectInput: Project,
    blocks: readonly MultiSceneBlock[],
    selections: MultiSceneSelections = [],
  ): MultiScenePlanOutcome {
    const baseline = ProjectSchema.parse(projectInput);

    const conflicting = blocks.find((block) =>
      baseline.shots.some((shot) => shot.name === block.shotName),
    );
    if (conflicting) {
      return {
        ok: false,
        code: 'SHOT_NAME_CONFLICT',
        message: `工程里已经有名为「${conflicting.shotName}」的镜头，请先改名。`,
        blockIndex: conflicting.index,
      };
    }

    let next = baseline;
    const plannedShots: MultiScenePlannedShot[] = [];

    for (const [blockOffset, block] of blocks.entries()) {
      const selection = selectionFor(selections, blockOffset);
      const background = resolveBackgroundSlot(
        baseline,
        block.backgroundName,
        selection.backgroundAssetId ?? null,
      );
      if (!background.asset) return slotFailure(block, background.resolution);
      const left = resolveCharacterSlot(
        baseline,
        'left-character',
        block.cast[0],
        selection.leftCharacterId ?? null,
      );
      if (!left.character) return slotFailure(block, left.resolution);
      const right = resolveCharacterSlot(
        baseline,
        'right-character',
        block.cast[1],
        selection.rightCharacterId ?? null,
      );
      if (!right.character) return slotFailure(block, right.resolution);

      let created: Project;
      try {
        created = this.shotService.create(next, {
          name: block.shotName,
          durationMs: MULTI_SCENE_SHOT_DURATION_MS,
        });
      } catch (error) {
        if (
          error instanceof ShotServiceError &&
          error.code === 'DUPLICATE_SHOT_NAME'
        ) {
          return {
            ok: false,
            code: 'SHOT_NAME_CONFLICT',
            message: error.message,
            blockIndex: block.index,
          };
        }
        throw error;
      }

      const shot = created.shots.at(-1);
      if (!shot) {
        return {
          ok: false,
          code: 'GENERATED_SCENE_INVALID',
          message: `镜头 ${block.index} 没有生成可编辑的镜头。`,
          blockIndex: block.index,
        };
      }

      const backgroundLayer = this.layerService.createFromAsset(
        created,
        shot.id,
        {
          version: 2,
          type: 'asset-image',
          assetId: background.asset.id,
          position: { x: PROJECT_WIDTH / 2, y: PROJECT_HEIGHT / 2 },
        },
      );
      next = this.layerService.setBackground(
        backgroundLayer.project,
        shot.id,
        backgroundLayer.layer.id,
      );

      // Provisional positions only: the AUTO-01 planner owns the final ones.
      const leftLayer = this.layerService.createFromAsset(next, shot.id, {
        version: 2,
        type: 'character-expression',
        assetId: left.character.expressionAssetId,
        characterId: left.character.character.id,
        expressionId: left.character.expressionId,
        position: { x: QUICK_LAYOUT_PROVISIONAL_X, y: PROJECT_HEIGHT / 2 },
      });
      const rightLayer = this.layerService.createFromAsset(
        leftLayer.project,
        shot.id,
        {
          version: 2,
          type: 'character-expression',
          assetId: right.character.expressionAssetId,
          characterId: right.character.character.id,
          expressionId: right.character.expressionId,
          position: { x: QUICK_LAYOUT_PROVISIONAL_X, y: PROJECT_HEIGHT / 2 },
        },
      );
      next = rightLayer.project;

      const stagedShot = next.shots.find(
        (candidate) => candidate.id === shot.id,
      );
      if (!stagedShot) {
        return {
          ok: false,
          code: 'GENERATED_SCENE_INVALID',
          message: `镜头 ${block.index} 的图层没有落到工程里。`,
          blockIndex: block.index,
        };
      }

      const layout = planQuickCharacterLayout(
        next,
        stagedShot,
        leftLayer.layer.id,
        rightLayer.layer.id,
      );
      if (!layout.ok) {
        return {
          ok: false,
          code: 'LAYOUT_OUT_OF_CANVAS',
          message: `镜头 ${block.index}：${layout.message}`,
          blockIndex: block.index,
        };
      }

      next = this.layerService.updatePosition(
        next,
        shot.id,
        leftLayer.layer.id,
        layout.plan.left,
      );
      next = this.layerService.updatePosition(
        next,
        shot.id,
        rightLayer.layer.id,
        layout.plan.right,
      );

      plannedShots.push({
        index: block.index,
        shotId: shot.id,
        shotName: block.shotName,
        backgroundLayerId: backgroundLayer.layer.id,
        backgroundAssetId: background.asset.id,
        leftLayerId: leftLayer.layer.id,
        rightLayerId: rightLayer.layer.id,
        leftCharacterId: left.character.character.id,
        rightCharacterId: right.character.character.id,
        leftPosition: layout.plan.left,
        rightPosition: layout.plan.right,
      });
    }

    const candidateProject = ProjectSchema.parse(next);
    if (
      candidateProject.shots.length !== baseline.shots.length + blocks.length ||
      candidateProject.shots
        .slice(0, baseline.shots.length)
        .some((shot, index) => shot.id !== baseline.shots[index]!.id)
    ) {
      return {
        ok: false,
        code: 'GENERATED_SCENE_INVALID',
        message: '这批镜头没有通过完整性检查，工程未提交。',
      };
    }

    return {
      ok: true,
      plan: {
        candidateProject,
        shots: plannedShots,
        createdShotIds: plannedShots.map((shot) => shot.shotId),
      },
    };
  }
}
