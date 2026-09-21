import {
  PositionProjectService,
  type PositionProjectOperation,
  type Project,
} from '../../domain';
import {
  EditorProjectStore,
  editorProjectStore,
} from './EditorProjectStore';
import type { EditorProjectSnapshot } from './EditorProjectStore';

/**
 * Stateless renderer adapter for Position Project commands. It owns no
 * Project, selection, or History state: the EditorProjectStore remains the
 * only commit and undo owner.
 */
export class PositionStore {
  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly service: PositionProjectService,
  ) {}

  /**
   * Apply one already-classified Position operation through the single
   * renderer Project-write boundary. Callers must not edit timeline events
   * directly; EditorProjectStore remains the only Project/History owner.
   */
  applyOperation(
    shotId: string,
    layerId: string,
    operation: PositionProjectOperation,
    label = 'Edit Position',
    expectedSnapshot?: EditorProjectSnapshot,
  ): Project {
    return this.execute(
      shotId,
      layerId,
      operation,
      label,
      expectedSnapshot,
    );
  }

  createFirstKey(
    shotId: string,
    layerId: string,
    input: Extract<PositionProjectOperation, { type: 'create-first' }>['input'],
  ): Project {
    return this.applyOperation(
      shotId,
      layerId,
      { type: 'create-first', input },
      'Create Position key',
    );
  }

  appendKey(
    shotId: string,
    layerId: string,
    input: Extract<PositionProjectOperation, { type: 'append' }>['input'],
  ): Project {
    return this.applyOperation(
      shotId,
      layerId,
      { type: 'append', input },
      'Append Position key',
    );
  }

  insertKey(
    shotId: string,
    layerId: string,
    input: Extract<PositionProjectOperation, { type: 'insert' }>['input'],
  ): Project {
    return this.applyOperation(
      shotId,
      layerId,
      { type: 'insert', input },
      'Insert Position key',
    );
  }

  updateKey(
    shotId: string,
    layerId: string,
    input: Extract<PositionProjectOperation, { type: 'update' }>['input'],
  ): Project {
    return this.applyOperation(
      shotId,
      layerId,
      { type: 'update', input },
      'Update Position key',
    );
  }

  deleteKey(shotId: string, layerId: string, timeMs: number): Project {
    return this.applyOperation(
      shotId,
      layerId,
      { type: 'delete', timeMs },
      'Delete Position key',
    );
  }

  retimeKey(
    shotId: string,
    layerId: string,
    fromTimeMs: number,
    toTimeMs: number,
  ): Project {
    return this.applyOperation(
      shotId,
      layerId,
      { type: 'retime', fromTimeMs, toTimeMs },
      'Retime Position key',
    );
  }

  createHold(
    shotId: string,
    layerId: string,
    input: Extract<PositionProjectOperation, { type: 'hold' }>['input'],
  ): Project {
    return this.applyOperation(
      shotId,
      layerId,
      { type: 'hold', input },
      'Create Position hold',
    );
  }

  private execute(
    shotId: string,
    layerId: string,
    operation: PositionProjectOperation,
    label: string,
    expectedSnapshot?: EditorProjectSnapshot,
  ): Project {
    const before = this.editorStore.getSnapshot();
    if (!before) throw new Error('No project is open.');
    if (expectedSnapshot && before !== expectedSnapshot) {
      throw new Error(
        'Position command target became stale before it could be committed.',
      );
    }

    const result = this.service.applyOperation(
      before.project,
      shotId,
      layerId,
      operation,
    );
    const current = this.editorStore.getSnapshot();
    if (
      !current ||
      current !== before ||
      current.project !== before.project ||
      current.projectRoot !== before.projectRoot ||
      current.project.id !== before.project.id ||
      current.revision !== before.revision ||
      JSON.stringify(current.project) !== JSON.stringify(before.project)
    ) {
      throw new Error(
        'Position command target became stale before it could be committed.',
      );
    }
    this.editorStore.updateProject(result.project, label);
    return result.project;
  }
}

export const positionStore = new PositionStore(
  editorProjectStore,
  new PositionProjectService(),
);
