import {
  SceneCreationService,
  type SceneCreationResult,
  type SceneCreationSelection,
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

export interface SceneCreationPreviewPlan {
  identity: {
    projectRoot: string;
    projectId: string;
    projectInstanceId: number | null;
    revision: number;
    projectFingerprint: string;
  };
  result: SceneCreationResult;
}

export function isSceneCreationPreviewCurrent(
  plan: SceneCreationPreviewPlan,
  editorStore: EditorProjectStore,
): boolean {
  const current = editorStore.getSnapshot();
  return Boolean(
    current &&
      current.projectRoot === plan.identity.projectRoot &&
      current.project.id === plan.identity.projectId &&
      current.revision === plan.identity.revision &&
      editorStore.getProjectInstanceId() === plan.identity.projectInstanceId &&
      JSON.stringify(current.project) === plan.identity.projectFingerprint,
  );
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
