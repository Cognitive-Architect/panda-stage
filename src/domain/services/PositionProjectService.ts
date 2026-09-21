import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../constants';
import {
  appendPositionKey,
  bindPositionBase,
  createFirstPositionKey,
  createHoldPositionKey,
  deletePositionKey,
  insertPositionKey,
  recognizePositionChain,
  retimePositionKey,
  updatePositionKey,
  type PositionChainOperationError,
  type PositionChainOperationResult,
  type PositionChainRecognition,
  type PositionHoldInput,
  type PositionKeyInput,
} from '../position-chain';
import {
  ProjectSchema,
  type Layer,
  type MoveEvent,
  type Project,
  type Shot,
  type TimelineEvent,
} from '../models';

export type PositionProjectOperation =
  | { readonly type: 'create-first'; readonly input: PositionKeyInput }
  | { readonly type: 'append'; readonly input: PositionKeyInput }
  | { readonly type: 'insert'; readonly input: PositionKeyInput }
  | {
      readonly type: 'update';
      readonly input: Omit<PositionKeyInput, 'eventId'>;
    }
  | { readonly type: 'delete'; readonly timeMs: number }
  | {
      readonly type: 'retime';
      readonly fromTimeMs: number;
      readonly toTimeMs: number;
    }
  | { readonly type: 'hold'; readonly input: PositionHoldInput };

export interface PositionBoundLayerPatch {
  readonly x: number;
  readonly y: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly rotationDeg?: number;
  readonly opacity?: number;
  readonly flipX?: boolean;
}

export type PositionProjectServiceErrorCode =
  | 'SHOT_NOT_FOUND'
  | 'LAYER_NOT_FOUND'
  | 'INVALID_POSITION'
  | 'POSITION_CHAIN_PLAYBACK_ONLY'
  | 'POSITION_OPERATION_REJECTED'
  | 'EVENT_ID_COLLISION';

export class PositionProjectServiceError extends Error {
  constructor(
    readonly code: PositionProjectServiceErrorCode,
    message: string,
    readonly cause?:
      | PositionChainOperationError
      | PositionChainRecognition,
  ) {
    super(message);
    this.name = 'PositionProjectServiceError';
  }
}

export interface PositionProjectCommandResult {
  readonly project: Project;
  readonly recognition: PositionChainRecognition;
  readonly operation: Extract<PositionChainOperationResult, { ok: true }>;
}

export interface PositionProjectServiceOptions {
  now?: () => Date;
}

function operationChanged(
  operation: Extract<PositionChainOperationResult, { ok: true }>,
): boolean {
  return (
    operation.addedEventIds.length > 0 ||
    operation.changedEventIds.length > 0 ||
    operation.removedEventIds.length > 0
  );
}

function replaceManagedMoveEvents(
  timelineEvents: readonly TimelineEvent[],
  managedEventIds: ReadonlySet<string>,
  replacement: readonly MoveEvent[],
): TimelineEvent[] {
  if (managedEventIds.size === 0) {
    return [...timelineEvents, ...replacement];
  }

  const firstManagedIndex = timelineEvents.findIndex((event) =>
    managedEventIds.has(event.id),
  );
  if (firstManagedIndex < 0) {
    throw new Error('Managed Position events disappeared before they were merged.');
  }

  const replacementByExistingId = new Map(
    replacement
      .filter((event) => managedEventIds.has(event.id))
      .map((event) => [event.id, event]),
  );
  const addedEvents = replacement.filter(
    (event) => !managedEventIds.has(event.id),
  );
  const lastManagedIndex = timelineEvents.reduce(
    (lastIndex, event, index) =>
      managedEventIds.has(event.id) ? index : lastIndex,
    firstManagedIndex,
  );
  const merged: TimelineEvent[] = [];
  timelineEvents.forEach((event, index) => {
    if (managedEventIds.has(event.id)) {
      const replacementEvent = replacementByExistingId.get(event.id);
      if (replacementEvent) merged.push(replacementEvent);
      if (index === lastManagedIndex) merged.push(...addedEvents);
    } else {
      merged.push(event);
    }
  });
  return merged;
}

function assertNewEventIdsAvailable(
  timelineEvents: readonly TimelineEvent[],
  managedEventIds: ReadonlySet<string>,
  operation: Extract<PositionChainOperationResult, { ok: true }>,
): void {
  const existingUnmanagedIds = new Set(
    timelineEvents
      .filter((event) => !managedEventIds.has(event.id))
      .map((event) => event.id),
  );
  for (const eventId of operation.addedEventIds) {
    if (existingUnmanagedIds.has(eventId)) {
      throw new PositionProjectServiceError(
        'EVENT_ID_COLLISION',
        `Position event id already belongs to unrelated timeline data: ${eventId}.`,
      );
    }
  }
}

export class PositionProjectService {
  private readonly now: () => Date;

  constructor(options: PositionProjectServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Apply one pure Position-chain operation to one current Project snapshot.
   * This method never mutates its input and never changes unrelated timeline
   * events; the renderer commits its returned Project through
   * EditorProjectStore.updateProject exactly once.
   */
  applyOperation(
    project: Project,
    shotId: string,
    layerId: string,
    operation: PositionProjectOperation,
  ): PositionProjectCommandResult {
    const { shot, layer } = this.context(project, shotId, layerId);
    const recognition = recognizePositionChain({ shot, layer });
    if (recognition.status === 'playback-only') {
      throw new PositionProjectServiceError(
        'POSITION_CHAIN_PLAYBACK_ONLY',
        `Position chain for layer ${layerId} is playback-only: ${recognition.reason.message}`,
        recognition,
      );
    }

    const result = this.runOperation(recognition.chain, operation);
    if (!result.ok) {
      throw new PositionProjectServiceError(
        'POSITION_OPERATION_REJECTED',
        result.error.message,
        result.error,
      );
    }
    if (!operationChanged(result)) {
      return { project, recognition, operation: result };
    }

    const managedEventIds = new Set(
      recognition.chain.segments.map((event) => event.id),
    );
    assertNewEventIdsAvailable(shot.timelineEvents, managedEventIds, result);
    const timelineEvents = replaceManagedMoveEvents(
      shot.timelineEvents,
      managedEventIds,
      result.events,
    );
    return {
      project: this.replaceShot(project, shot, { timelineEvents }),
      recognition,
      operation: result,
    };
  }

  /**
   * Apply a Base/Transform layer edit while recognizing the old chain first.
   * If the layer owns a managed Position chain, its first Move.from follows
   * the new Base in this same returned Project. Playback-only legacy chains
   * retain the existing plain Base-edit behavior and are never normalized or
   * rewritten by this path.
   */
  applyBaseBoundLayerChange(
    project: Project,
    shotId: string,
    layerId: string,
    patch: PositionBoundLayerPatch,
  ): Project {
    this.assertValidPosition(patch.x, patch.y);
    const { shot, layer } = this.context(project, shotId, layerId);
    const recognition = recognizePositionChain({ shot, layer });
    const positionChanged = layer.x !== patch.x || layer.y !== patch.y;
    const nextLayer: Layer = { ...layer, ...patch };
    const layerChanged = JSON.stringify(nextLayer) !== JSON.stringify(layer);
    let timelineEvents = shot.timelineEvents;
    if (positionChanged && recognition.status === 'editable') {
      const baseUpdate = bindPositionBase(recognition.chain, {
        x: patch.x,
        y: patch.y,
      });
      if (!baseUpdate.ok) {
        throw new PositionProjectServiceError(
          'POSITION_OPERATION_REJECTED',
          baseUpdate.error.message,
          baseUpdate.error,
        );
      }
      const managedEventIds = new Set(
        recognition.chain.segments.map((event) => event.id),
      );
      assertNewEventIdsAvailable(
        shot.timelineEvents,
        managedEventIds,
        baseUpdate,
      );
      timelineEvents = replaceManagedMoveEvents(
        shot.timelineEvents,
        managedEventIds,
        baseUpdate.events,
      );
    }

    if (!layerChanged && timelineEvents === shot.timelineEvents) {
      return project;
    }
    return this.replaceShot(project, shot, {
      layers: shot.layers.map((candidate) =>
        candidate.id === layerId ? nextLayer : candidate,
      ),
      timelineEvents,
    });
  }

  private runOperation(
    chain: PositionChainFromRecognition,
    operation: PositionProjectOperation,
  ): PositionChainOperationResult {
    switch (operation.type) {
      case 'create-first':
        return createFirstPositionKey(chain, operation.input);
      case 'append':
        return appendPositionKey(chain, operation.input);
      case 'insert':
        return insertPositionKey(chain, operation.input);
      case 'update':
        return updatePositionKey(chain, operation.input);
      case 'delete':
        return deletePositionKey(chain, operation.timeMs);
      case 'retime':
        return retimePositionKey(
          chain,
          operation.fromTimeMs,
          operation.toTimeMs,
        );
      case 'hold':
        return createHoldPositionKey(chain, operation.input);
    }
  }

  private context(
    project: Project,
    shotId: string,
    layerId: string,
  ): { shot: Shot; layer: Layer } {
    const shot = project.shots.find((candidate) => candidate.id === shotId);
    if (!shot) {
      throw new PositionProjectServiceError(
        'SHOT_NOT_FOUND',
        `Shot not found: ${shotId}.`,
      );
    }
    const layer = shot.layers.find((candidate) => candidate.id === layerId);
    if (!layer) {
      throw new PositionProjectServiceError(
        'LAYER_NOT_FOUND',
        `Layer not found in Shot ${shotId}: ${layerId}.`,
      );
    }
    return { shot, layer };
  }

  private assertValidPosition(x: number, y: number): void {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x > PROJECT_WIDTH ||
      y < 0 ||
      y > PROJECT_HEIGHT
    ) {
      throw new PositionProjectServiceError(
        'INVALID_POSITION',
        `Layer position must remain inside the ${PROJECT_WIDTH}x${PROJECT_HEIGHT} canvas.`,
      );
    }
  }

  private replaceShot(
    project: Project,
    shot: Shot,
    patch: Partial<Pick<Shot, 'layers' | 'timelineEvents'>>,
  ): Project {
    return ProjectSchema.parse({
      ...project,
      shots: project.shots.map((candidate) =>
        candidate.id === shot.id ? { ...shot, ...patch } : candidate,
      ),
      updatedAt: this.now().toISOString(),
    });
  }
}

type PositionChainFromRecognition = Extract<
  PositionChainRecognition,
  { status: 'none' | 'editable' }
>['chain'];
