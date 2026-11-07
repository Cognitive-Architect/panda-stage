import {
  MultiSceneService,
  type MultiSceneBlock,
  type MultiScenePlan,
  type MultiScenePlanFailureCode,
  type MultiSceneSelections,
} from '../../../domain';
import type { EditorProjectStore } from '../../stores/EditorProjectStore';
import type { ShotStore } from '../../stores/shotStore';

export class MultiSceneActionError extends Error {
  constructor(
    readonly code: 'PROJECT_NOT_OPEN' | 'PROJECT_CHANGED',
    message: string,
  ) {
    super(message);
    this.name = 'MultiSceneActionError';
  }
}

/**
 * A batch plan is only valid for the exact Project instance it was built from.
 * Reopening the same path, switching Project, Undo/Redo, or any edit changes at
 * least one field here and invalidates the plan.
 */
export interface MultiSceneIdentity {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly projectInstanceId: number | null;
  readonly revision: number;
  readonly projectFingerprint: string;
}

export interface MultiScenePreview {
  readonly identity: MultiSceneIdentity;
  readonly plan: MultiScenePlan;
}

export type PrepareMultiSceneOutcome =
  | { readonly ok: true; readonly preview: MultiScenePreview }
  | {
      readonly ok: false;
      readonly code: MultiScenePlanFailureCode;
      readonly message: string;
      readonly blockIndex?: number;
    };

export interface MultiScenePlanOptions {
  editorStore: EditorProjectStore;
  shotStore: Pick<ShotStore, 'getCurrentShotId' | 'select'>;
  service?: MultiSceneService;
}

/** One History label for one whole batch. */
export const MULTI_SCENE_HISTORY_LABEL = 'Create scenes from storyboard';

export function isMultiScenePreviewCurrent(
  preview: MultiScenePreview,
  editorStore: EditorProjectStore,
): boolean {
  const current = editorStore.getSnapshot();
  return Boolean(
    current &&
      current.projectRoot === preview.identity.projectRoot &&
      current.project.id === preview.identity.projectId &&
      current.revision === preview.identity.revision &&
      editorStore.getProjectInstanceId() === preview.identity.projectInstanceId &&
      JSON.stringify(current.project) === preview.identity.projectFingerprint,
  );
}

/**
 * Build the whole batch in memory and stamp it with the baseline identity.
 * Nothing is written: the Project revision, History and dirty flag stay as-is
 * until `commitMultiScenePreview`.
 */
export function prepareMultiScenePreview(
  blocks: readonly MultiSceneBlock[],
  selections: MultiSceneSelections,
  options: MultiScenePlanOptions,
): PrepareMultiSceneOutcome {
  const { editorStore } = options;
  const baseline = editorStore.getSnapshot();
  if (!baseline) {
    throw new MultiSceneActionError('PROJECT_NOT_OPEN', '请先打开工程。');
  }
  const projectInstanceId = editorStore.getProjectInstanceId();
  const projectFingerprint = JSON.stringify(baseline.project);
  const outcome = (options.service ?? new MultiSceneService()).plan(
    baseline.project,
    blocks,
    selections,
  );
  if (!outcome.ok) return outcome;

  const current = editorStore.getSnapshot();
  if (
    !current ||
    current.projectRoot !== baseline.projectRoot ||
    current.project.id !== baseline.project.id ||
    current.revision !== baseline.revision ||
    editorStore.getProjectInstanceId() !== projectInstanceId ||
    JSON.stringify(current.project) !== projectFingerprint
  ) {
    throw new MultiSceneActionError(
      'PROJECT_CHANGED',
      '检查期间工程已变化，请重新检查这批镜头。',
    );
  }

  return {
    ok: true,
    preview: {
      identity: {
        projectRoot: baseline.projectRoot,
        projectId: baseline.project.id,
        projectInstanceId,
        revision: baseline.revision,
        projectFingerprint,
      },
      plan: outcome.plan,
    },
  };
}

/**
 * Commit the exact prepared batch in one Project update: one revision, one
 * History entry, one Undo that removes every Shot of the batch together.
 */
export function commitMultiScenePreview(
  preview: MultiScenePreview,
  options: MultiScenePlanOptions,
): MultiScenePlan {
  const { editorStore, shotStore } = options;
  if (!isMultiScenePreviewCurrent(preview, editorStore)) {
    throw new MultiSceneActionError(
      'PROJECT_CHANGED',
      '工程已变化，请重新检查这批镜头。',
    );
  }

  const previousShotId = shotStore.getCurrentShotId();
  const lastCreatedShotId = preview.plan.createdShotIds.at(-1) ?? null;
  const selectIfActive = (shotId: string | null): void => {
    if (!shotId) return;
    const active = editorStore.getSnapshot();
    if (
      active?.projectRoot === preview.identity.projectRoot &&
      active.project.id === preview.identity.projectId &&
      editorStore.getProjectInstanceId() === preview.identity.projectInstanceId &&
      active.project.shots.some((shot) => shot.id === shotId)
    ) {
      shotStore.select(shotId);
    }
  };

  editorStore.updateProject(
    preview.plan.candidateProject,
    MULTI_SCENE_HISTORY_LABEL,
    {},
    {
      afterUndo: () => selectIfActive(previousShotId),
      afterRedo: () => selectIfActive(lastCreatedShotId),
    },
  );
  selectIfActive(lastCreatedShotId);
  return preview.plan;
}
