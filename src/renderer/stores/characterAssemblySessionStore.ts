import {
  CharacterServiceError,
  type CompositeCharacterDefinition,
  type CompositeCharacterUpdate,
} from '../../domain';
import {
  CharacterStore,
  CharacterStoreStaleError,
  characterStore,
} from './characterStore';
import {
  EditorProjectStore,
  editorProjectStore,
  type EditorProjectSnapshot,
} from './EditorProjectStore';

type Listener = () => void;

export type CharacterAssemblyErrorCode =
  | 'project-not-open'
  | 'character-not-found'
  | 'not-composite'
  | 'stale-session'
  | 'project-changed'
  | 'invalid-definition'
  | 'commit-failed';

export class CharacterAssemblyError extends Error {
  constructor(
    readonly code: CharacterAssemblyErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CharacterAssemblyError';
  }
}

export interface CharacterAssemblySnapshot {
  readonly status: 'active';
  readonly sessionId: number;
  /** Changes after a successful commit so old callbacks cannot reuse it. */
  readonly generation: number;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly characterId: string;
  readonly draft: CompositeCharacterDefinition;
}

export interface CharacterAssemblyDraftResult {
  readonly ok: true;
  readonly snapshot: CharacterAssemblySnapshot;
}

export interface CharacterAssemblyDraftRejected {
  readonly ok: false;
  readonly error: CharacterAssemblyError;
}

export type CharacterAssemblyDraftUpdateResult =
  | CharacterAssemblyDraftResult
  | CharacterAssemblyDraftRejected;

export interface CharacterAssemblySessionHandle {
  readonly sessionId: number;
  readonly generation: number;
  getSnapshot(): CharacterAssemblySnapshot | null;
  /** Update only the ephemeral draft; this never touches Project or History. */
  setDraft(
    draft: CompositeCharacterDefinition,
  ): CharacterAssemblyDraftUpdateResult;
  /** Apply a narrow local change without turning it into a Project write. */
  updateDraft(
    update: CompositeCharacterUpdate,
  ): CharacterAssemblyDraftUpdateResult;
  /** Commit the complete local definition as one Character operation. */
  commit(
    draft?: CompositeCharacterDefinition,
  ): CharacterAssemblyCommitResult;
  cancel(): void;
  exit(): void;
}

export interface CharacterAssemblyBeginSuccess {
  readonly ok: true;
  readonly session: CharacterAssemblySessionHandle;
  readonly snapshot: CharacterAssemblySnapshot;
}

export interface CharacterAssemblyBeginFailure {
  readonly ok: false;
  readonly error: CharacterAssemblyError;
}

export type CharacterAssemblyBeginResult =
  | CharacterAssemblyBeginSuccess
  | CharacterAssemblyBeginFailure;

export interface CharacterAssemblyCommitSuccess {
  readonly status: 'committed';
  readonly session: CharacterAssemblySessionHandle;
  readonly snapshot: CharacterAssemblySnapshot;
}

export interface CharacterAssemblyNoOp {
  readonly status: 'no-op';
  readonly snapshot: CharacterAssemblySnapshot;
}

export interface CharacterAssemblyCommitFailure {
  readonly status: 'rejected' | 'stale';
  readonly error: CharacterAssemblyError;
  readonly snapshot: CharacterAssemblySnapshot | null;
}

export type CharacterAssemblyCommitResult =
  | CharacterAssemblyCommitSuccess
  | CharacterAssemblyNoOp
  | CharacterAssemblyCommitFailure;

export interface CharacterAssemblySessionDependencies {
  readonly editorStore: Pick<
    EditorProjectStore,
    'getSnapshot' | 'subscribe'
  >;
  readonly characterStore: Pick<
    CharacterStore,
    'getCompositeDefinition' | 'applyCompositeDefinition'
  >;
}

interface ActiveSession {
  readonly sessionId: number;
  generation: number;
  baselineSnapshot: EditorProjectSnapshot;
  baselineDefinition: CompositeCharacterDefinition;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly characterId: string;
  draft: CompositeCharacterDefinition;
}

interface CommitContext {
  readonly sessionId: number;
  readonly generation: number;
  editorChangeCount: number;
  contextChanged: boolean;
}

function cloneDefinition(
  definition: CompositeCharacterDefinition,
): CompositeCharacterDefinition {
  return {
    bodyAssetId: definition.bodyAssetId,
    facePlacement: { ...definition.facePlacement },
    expressionAssets: definition.expressionAssets.map((expression) => ({
      expressionId: expression.expressionId,
      assetId: expression.assetId,
    })),
    mouthOpenAssetId: definition.mouthOpenAssetId,
  };
}

function definitionsEqual(
  left: CompositeCharacterDefinition,
  right: CompositeCharacterDefinition,
): boolean {
  if (
    left.bodyAssetId !== right.bodyAssetId ||
    left.facePlacement.offsetX !== right.facePlacement.offsetX ||
    left.facePlacement.offsetY !== right.facePlacement.offsetY ||
    left.facePlacement.scale !== right.facePlacement.scale ||
    left.mouthOpenAssetId !== right.mouthOpenAssetId ||
    left.expressionAssets.length !== right.expressionAssets.length
  ) {
    return false;
  }

  const sortExpressionAssets = (
    expressionAssets: readonly CompositeCharacterDefinition['expressionAssets'][number][],
  ) =>
    expressionAssets
      .map((expression) => ({ ...expression }))
      .sort(
        (leftExpression, rightExpression) =>
          leftExpression.expressionId.localeCompare(
            rightExpression.expressionId,
          ) || leftExpression.assetId.localeCompare(rightExpression.assetId),
      );

  return (
    JSON.stringify(sortExpressionAssets(left.expressionAssets)) ===
    JSON.stringify(sortExpressionAssets(right.expressionAssets))
  );
}

function mergeDefinition(
  current: CompositeCharacterDefinition,
  update: CompositeCharacterUpdate,
): CompositeCharacterDefinition {
  return {
    bodyAssetId: update.bodyAssetId ?? current.bodyAssetId,
    facePlacement: update.facePlacement
      ? { ...update.facePlacement }
      : { ...current.facePlacement },
    expressionAssets: update.expressionAssets
      ? update.expressionAssets.map((expression) => ({ ...expression }))
      : current.expressionAssets.map((expression) => ({ ...expression })),
    mouthOpenAssetId:
      update.mouthOpenAssetId === undefined
        ? current.mouthOpenAssetId
        : update.mouthOpenAssetId,
  };
}

/**
 * Ephemeral, non-persisted authoring capability for BFM-S02.
 *
 * The session owns only a local CompositeCharacterDefinition draft. The
 * CharacterStore remains the sole production write adapter, and every commit
 * supplies the exact baseline EditorProjectSnapshot so a stale callback is
 * rejected before EditorProjectStore.updateProject() can run.
 */
export class CharacterAssemblySessionStore {
  private readonly unsubscribeEditor: () => void;
  private readonly listeners = new Set<Listener>();
  private active: ActiveSession | null = null;
  private snapshot: CharacterAssemblySnapshot | null = null;
  private commitContext: CommitContext | null = null;
  private nextSessionId = 0;

  constructor(
    private readonly dependencies: CharacterAssemblySessionDependencies,
  ) {
    this.unsubscribeEditor = dependencies.editorStore.subscribe(
      this.handleEditorChange,
    );
  }

  readonly getSnapshot = (): CharacterAssemblySnapshot | null =>
    this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  begin(characterId: string): CharacterAssemblyBeginResult {
    const hadActiveSession = this.active !== null;
    this.clearActive();
    if (hadActiveSession) this.emit();

    const snapshot = this.dependencies.editorStore.getSnapshot();
    if (!snapshot) {
      return {
        ok: false,
        error: new CharacterAssemblyError(
          'project-not-open',
          'Open a Project before starting Character assembly.',
        ),
      };
    }

    let definition: CompositeCharacterDefinition;
    try {
      definition = this.dependencies.characterStore.getCompositeDefinition(
        characterId,
      );
    } catch (error) {
      return { ok: false, error: this.mapBeginError(error) };
    }

    const session: ActiveSession = {
      sessionId: ++this.nextSessionId,
      generation: 0,
      baselineSnapshot: snapshot,
      baselineDefinition: cloneDefinition(definition),
      projectId: snapshot.project.id,
      projectRoot: snapshot.projectRoot,
      characterId,
      draft: cloneDefinition(definition),
    };
    this.active = session;
    this.emit();
    return {
      ok: true,
      session: this.createHandle(session.sessionId, session.generation),
      snapshot: this.snapshot!,
    };
  }

  getActiveSessionHandle(): CharacterAssemblySessionHandle | null {
    if (!this.active) return null;
    return this.createHandle(this.active.sessionId, this.active.generation);
  }

  dispose(): void {
    this.unsubscribeEditor();
    this.clearActive();
    this.snapshot = null;
    this.listeners.clear();
  }

  private readonly handleEditorChange = (): void => {
    if (!this.active) return;
    if (this.commitContextMatchesActive()) {
      this.commitContext!.editorChangeCount += 1;
      return;
    }
    this.invalidate();
  };

  private createHandle(
    sessionId: number,
    generation: number,
  ): CharacterAssemblySessionHandle {
    return {
      sessionId,
      generation,
      getSnapshot: () => this.snapshotForToken(sessionId, generation),
      setDraft: (draft) =>
        this.setDraft(sessionId, generation, draft),
      updateDraft: (update) =>
        this.updateDraft(sessionId, generation, update),
      commit: (draft) =>
        this.commit(sessionId, generation, draft),
      cancel: () => this.exit(sessionId, generation),
      exit: () => this.exit(sessionId, generation),
    };
  }

  private setDraft(
    sessionId: number,
    generation: number,
    draft: CompositeCharacterDefinition,
  ): CharacterAssemblyDraftUpdateResult {
    const active = this.activeForToken(sessionId, generation);
    if (!active) return this.staleDraftResult();
    if (!this.baselineIsCurrent(active)) {
      this.invalidate();
      return this.staleDraftResult();
    }
    if (definitionsEqual(active.draft, draft)) {
      return { ok: true, snapshot: this.snapshot! };
    }
    active.draft = cloneDefinition(draft);
    this.emit();
    return { ok: true, snapshot: this.snapshot! };
  }

  private updateDraft(
    sessionId: number,
    generation: number,
    update: CompositeCharacterUpdate,
  ): CharacterAssemblyDraftUpdateResult {
    const active = this.activeForToken(sessionId, generation);
    if (!active) return this.staleDraftResult();
    return this.setDraft(
      sessionId,
      generation,
      mergeDefinition(active.draft, update),
    );
  }

  private commit(
    sessionId: number,
    generation: number,
    finalDraft?: CompositeCharacterDefinition,
  ): CharacterAssemblyCommitResult {
    const active = this.activeForToken(sessionId, generation);
    if (!active) return this.staleCommitResult();

    if (finalDraft !== undefined) {
      const draftResult = this.setDraft(sessionId, generation, finalDraft);
      if (!draftResult.ok) return this.staleCommitResult();
    }

    if (!this.baselineIsCurrent(active)) {
      this.invalidate();
      return this.staleCommitResult();
    }
    if (definitionsEqual(active.draft, active.baselineDefinition)) {
      return { status: 'no-op', snapshot: this.snapshot! };
    }

    const baseline = active.baselineSnapshot;
    this.commitContext = {
      sessionId: active.sessionId,
      generation: active.generation,
      editorChangeCount: 0,
      contextChanged: false,
    };

    let resultProject;
    try {
      resultProject = this.dependencies.characterStore.applyCompositeDefinition(
        active.characterId,
        cloneDefinition(active.draft),
        baseline,
      );
    } catch (error) {
      this.commitContext = null;
      if (error instanceof CharacterStoreStaleError) {
        this.invalidate();
        return this.staleCommitResult();
      }
      if (error instanceof CharacterServiceError) {
        return {
          status: 'rejected',
          error: this.definitionError(error),
          snapshot: this.snapshot,
        };
      }
      this.invalidate();
      return {
        status: 'stale',
        error: new CharacterAssemblyError(
          'commit-failed',
          'Character assembly could not be committed safely.',
          error,
        ),
        snapshot: null,
      };
    }

    const current = this.dependencies.editorStore.getSnapshot();
    const commitState = this.commitContext;
    this.commitContext = null;
    if (
      !current ||
      !commitState ||
      commitState.sessionId !== active.sessionId ||
      commitState.generation !== active.generation ||
      commitState.editorChangeCount !== 1 ||
      commitState.contextChanged ||
      current.projectRoot !== baseline.projectRoot ||
      current.project.id !== baseline.project.id ||
      current.revision !== baseline.revision + 1 ||
      JSON.stringify(current?.project) !== JSON.stringify(resultProject)
    ) {
      this.invalidate();
      return this.staleCommitResult();
    }

    active.baselineSnapshot = current;
    active.baselineDefinition = cloneDefinition(active.draft);
    active.generation += 1;
    this.emit();
    return {
      status: 'committed',
      session: this.createHandle(active.sessionId, active.generation),
      snapshot: this.snapshot!,
    };
  }

  private baselineIsCurrent(active: ActiveSession): boolean {
    const current = this.dependencies.editorStore.getSnapshot();
    return (
      current === active.baselineSnapshot &&
      current.projectRoot === active.projectRoot &&
      current.project.id === active.projectId &&
      current.revision === active.baselineSnapshot.revision
    );
  }

  private activeForToken(
    sessionId: number,
    generation: number,
  ): ActiveSession | null {
    return this.active?.sessionId === sessionId &&
      this.active.generation === generation
      ? this.active
      : null;
  }

  private commitContextMatchesActive(): boolean {
    return (
      this.active !== null &&
      this.commitContext !== null &&
      this.commitContext.sessionId === this.active.sessionId &&
      this.commitContext.generation === this.active.generation
    );
  }

  private snapshotForToken(
    sessionId: number,
    generation: number,
  ): CharacterAssemblySnapshot | null {
    return this.activeForToken(sessionId, generation) ? this.snapshot : null;
  }

  private snapshotFor(
    active: ActiveSession | null,
  ): CharacterAssemblySnapshot | null {
    if (!active) return null;
    return {
      status: 'active',
      sessionId: active.sessionId,
      generation: active.generation,
      projectId: active.projectId,
      projectRoot: active.projectRoot,
      characterId: active.characterId,
      draft: cloneDefinition(active.draft),
    };
  }

  private mapBeginError(error: unknown): CharacterAssemblyError {
    if (error instanceof CharacterServiceError) {
      if (error.code === 'CHARACTER_NOT_FOUND') {
        return new CharacterAssemblyError(
          'character-not-found',
          error.message,
          error,
        );
      }
      if (error.code === 'COMPOSITE_CHARACTER_REQUIRED') {
        return new CharacterAssemblyError(
          'not-composite',
          error.message,
          error,
        );
      }
      return this.definitionError(error);
    }
    return new CharacterAssemblyError(
      'commit-failed',
      'Character assembly could not start safely.',
      error,
    );
  }

  private definitionError(error: CharacterServiceError): CharacterAssemblyError {
    return new CharacterAssemblyError(
      'invalid-definition',
      error.message,
      error,
    );
  }

  private staleDraftResult(): CharacterAssemblyDraftRejected {
    return {
      ok: false,
      error: new CharacterAssemblyError(
        'stale-session',
        'This Character assembly draft is no longer current.',
      ),
    };
  }

  private staleCommitResult(): CharacterAssemblyCommitFailure {
    return {
      status: 'stale',
      error: new CharacterAssemblyError(
        'stale-session',
        'This Character assembly callback is no longer current.',
      ),
      snapshot: null,
    };
  }

  private exit(sessionId: number, generation: number): void {
    if (!this.activeForToken(sessionId, generation)) return;
    this.invalidate();
  }

  private invalidate(): void {
    if (!this.active) return;
    this.clearActive();
    this.emit();
  }

  private clearActive(): void {
    this.active = null;
    this.commitContext = null;
  }

  private emit(): void {
    this.snapshot = this.snapshotFor(this.active);
    for (const listener of this.listeners) listener();
  }
}

export const characterAssemblySessionStore =
  new CharacterAssemblySessionStore({
    editorStore: editorProjectStore,
    characterStore,
  });
