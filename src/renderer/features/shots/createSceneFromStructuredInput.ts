import { SceneCreationService } from '../../../domain';
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

/** Build against the active snapshot, then record the complete scene as one command. */
export function createSceneFromStructuredInput(
  rawInput: string,
  options: CreateSceneFromStructuredInputOptions,
) {
  const { editorStore, shotStore } = options;
  const baseline = editorStore.getSnapshot();
  if (!baseline) {
    throw new SceneCreationActionError(
      'PROJECT_NOT_OPEN',
      '请先打开项目。',
    );
  }

  const projectInstanceId = editorStore.getProjectInstanceId();
  const previousShotId = shotStore.getCurrentShotId();
  const result = (options.service ?? new SceneCreationService()).create(
    baseline.project,
    rawInput,
  );
  const current = editorStore.getSnapshot();
  if (
    current !== baseline ||
    !current ||
    current.projectRoot !== baseline.projectRoot ||
    current.project.id !== baseline.project.id ||
    current.revision !== baseline.revision ||
    editorStore.getProjectInstanceId() !== projectInstanceId ||
    JSON.stringify(current.project) !== JSON.stringify(baseline.project)
  ) {
    throw new SceneCreationActionError(
      'PROJECT_CHANGED',
      '生成期间工程已变化，请从当前工程重新开始。',
    );
  }

  const selectIfActive = (shotId: string): void => {
    const active = editorStore.getSnapshot();
    if (
      active?.projectRoot === baseline.projectRoot &&
      active.project.id === baseline.project.id &&
      active.project.shots.some((shot) => shot.id === shotId)
    ) {
      shotStore.select(shotId);
    }
  };

  editorStore.updateProject(
    result.project,
    'Create scene from structured input',
    {},
    {
      afterUndo: () => {
        if (previousShotId) selectIfActive(previousShotId);
      },
      afterRedo: () => selectIfActive(result.shotId),
    },
  );
  shotStore.select(result.shotId);
  return result;
}
