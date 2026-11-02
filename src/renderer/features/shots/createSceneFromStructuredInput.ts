import {
  SceneCreationService,
  type SceneCreationResult,
  type SceneCreationSelection,
  type Shot,
} from '../../../domain';
import type { ShotStore } from '../../stores/shotStore';
import type { EditorProjectStore } from '../../stores/EditorProjectStore';

export class SceneCreationActionError extends Error {
  constructor(
    readonly code: 'PROJECT_NOT_OPEN' | 'PROJECT_CHANGED',
    message: string,
  ) {
    super(message);
    this.name = 'SceneCreationActionError';
  }
}

export interface CreateSceneFromStructuredInputOptions {
  editorStore: EditorProjectStore;
  shotStore: Pick<ShotStore, 'getCurrentShotId' | 'select'>;
  service?: SceneCreationService;
}

export interface SceneCreationDraft {
  rawInput: string;
  backgroundAssetId: string | null;
  characterId: string | null;
}

export const EMPTY_SCENE_CREATION_DRAFT: SceneCreationDraft = {
  rawInput: '',
  backgroundAssetId: null,
  characterId: null,
};

export interface SceneCreationPreviewPlan {
  identity: SceneCreationPreviewIdentity;
  result: SceneCreationResult;
}

export interface SceneCreationPreviewIdentity {
  projectRoot: string;
  projectId: string;
  projectInstanceId: number | null;
  revision: number;
  projectFingerprint: string;
}

/** Renderer-only scene view data passed to the existing CanvasStage. */
export interface SceneCreationCanvasPreview {
  identity: SceneCreationPreviewIdentity;
  shot: Shot;
}

export type SceneCreationCanvasPreviewStatus =
  | 'loading'
  | 'ready'
  | 'unavailable';

export function toSceneCreationCanvasPreview(
  plan: SceneCreationPreviewPlan,
): SceneCreationCanvasPreview {
  const shot = plan.result.project.shots.find(
    (candidate) => candidate.id === plan.result.shotId,
  );
  if (!shot) throw new Error('Preview shot is missing from the scene result.');
  return { identity: plan.identity, shot };
}

export function isSceneCreationPreviewIdentityCurrent(
  identity: SceneCreationPreviewIdentity,
  editorStore: EditorProjectStore,
): boolean {
  const current = editorStore.getSnapshot();
  return Boolean(
    current &&
      current.projectRoot === identity.projectRoot &&
      current.project.id === identity.projectId &&
      current.revision === identity.revision &&
      editorStore.getProjectInstanceId() === identity.projectInstanceId &&
      JSON.stringify(current.project) === identity.projectFingerprint,
  );
}

export function isSceneCreationPreviewCurrent(
  plan: SceneCreationPreviewPlan,
  editorStore: EditorProjectStore,
): boolean {
  return isSceneCreationPreviewIdentityCurrent(plan.identity, editorStore);
}

/** Build a read-only preview from the active project and capture its identity. */
export function prepareSceneCreationPreview(
  rawInput: string,
  selection: SceneCreationSelection,
  options: CreateSceneFromStructuredInputOptions,
): SceneCreationPreviewPlan {
  const { editorStore } = options;
  const baseline = editorStore.getSnapshot();
  if (!baseline) {
    throw new SceneCreationActionError(
      'PROJECT_NOT_OPEN',
      '请先打开项目。',
    );
  }

  const projectInstanceId = editorStore.getProjectInstanceId();
  const projectFingerprint = JSON.stringify(baseline.project);
  const result = (options.service ?? new SceneCreationService()).create(
    baseline.project,
    rawInput,
    selection,
  );
  const current = editorStore.getSnapshot();
  if (
    !current ||
    current.projectRoot !== baseline.projectRoot ||
    current.project.id !== baseline.project.id ||
    current.revision !== baseline.revision ||
    editorStore.getProjectInstanceId() !== projectInstanceId ||
    JSON.stringify(current.project) !== projectFingerprint
  ) {
    throw new SceneCreationActionError(
      'PROJECT_CHANGED',
      '生成期间工程已变化，请从当前工程重新开始。',
    );
  }

  return {
    identity: {
      projectRoot: baseline.projectRoot,
      projectId: baseline.project.id,
      projectInstanceId,
      revision: baseline.revision,
      projectFingerprint,
    },
    result,
  };
}

/** Commit only the exact plan prepared for the still-open, unchanged Project. */
export function commitSceneCreationPreview(
  plan: SceneCreationPreviewPlan,
  options: CreateSceneFromStructuredInputOptions,
): SceneCreationResult {
  const { editorStore, shotStore } = options;
  if (!isSceneCreationPreviewCurrent(plan, editorStore)) {
    throw new SceneCreationActionError(
      'PROJECT_CHANGED',
      '工程已变化，当前预览已失效，请重新检查素材。',
    );
  }
  const previousShotId = shotStore.getCurrentShotId();
  const selectIfActive = (shotId: string): void => {
    const active = editorStore.getSnapshot();
    if (
      active?.projectRoot === plan.identity.projectRoot &&
      active.project.id === plan.identity.projectId &&
      editorStore.getProjectInstanceId() === plan.identity.projectInstanceId &&
      active.project.shots.some((shot) => shot.id === shotId)
    ) {
      shotStore.select(shotId);
    }
  };

  editorStore.updateProject(
    plan.result.project,
    'Create scene from structured input',
    {},
    {
      afterUndo: () => {
        if (previousShotId) selectIfActive(previousShotId);
      },
      afterRedo: () => selectIfActive(plan.result.shotId),
    },
  );
  shotStore.select(plan.result.shotId);
  return plan.result;
}

/** Build and immediately commit the AC-01 controlled validation action. */
export function createSceneFromStructuredInput(
  rawInput: string,
  options: CreateSceneFromStructuredInputOptions,
): SceneCreationResult {
  const plan = prepareSceneCreationPreview(rawInput, {}, options);
  return commitSceneCreationPreview(plan, options);
}
