import {
  ProjectSchema,
  scanAssetReferences,
  type Asset,
  type Character,
  type Project,
  type VoiceProfile,
} from '../../domain';
import type {
  ExecuteHistoryOptions,
  HistoryReplayEffects,
} from '../../history/HistoryCommand';
import { HistoryStore } from '../../history/HistoryStore';
import { ProjectCommand } from '../../history/commands/ProjectCommand';

export interface EditorProjectSnapshot {
  projectRoot: string;
  project: Project;
  dirty: boolean;
  revision: number;
}

export interface SavedEditorProjectSnapshot {
  projectRoot: string;
  project: Project;
}

export type SaveAcknowledgement = 'current' | 'stale';

export interface EditorProjectOperationLease {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly revision: number;
  readonly openInstanceId: number;
  readonly token: symbol;
}

interface ActiveEditorProjectOperation {
  readonly lease: EditorProjectOperationLease;
  committed: boolean;
}

type Listener = () => void;

export class EditorProjectStore {
  private snapshot: EditorProjectSnapshot | null = null;
  private savedProjectJson: string | null = null;
  private cachedSavedProjectJson: string | null = null;
  private cachedSavedProject: Project | null = null;
  /** Runtime-only identity for one open Project instance. */
  private nextProjectInstanceId = 0;
  private activeProjectInstanceId: number | null = null;
  private activeProjectOperation: ActiveEditorProjectOperation | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(readonly history = new HistoryStore()) {}

  readonly getSnapshot = (): EditorProjectSnapshot | null => this.snapshot;

  /** Read the last acknowledged save from this store's existing saved baseline. */
  readonly getSavedProjectSnapshot = (): SavedEditorProjectSnapshot | null => {
    const snapshot = this.snapshot;
    const savedProjectJson = this.savedProjectJson;
    if (!snapshot || !savedProjectJson) return null;
    if (this.cachedSavedProjectJson !== savedProjectJson || !this.cachedSavedProject) {
      this.cachedSavedProjectJson = savedProjectJson;
      this.cachedSavedProject = ProjectSchema.parse(
        JSON.parse(savedProjectJson),
      );
    }
    return {
      projectRoot: snapshot.projectRoot,
      project: this.cachedSavedProject,
    };
  };

  /**
   * Returns the identity of the current open instance, not the persisted
   * Project identity or revision. Canvas continuity uses this to distinguish a
   * same-path close/reopen from an ordinary edit in one still-open instance.
   */
  readonly getProjectInstanceId = (): number | null =>
    this.activeProjectInstanceId;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  open(projectRoot: string, rawProject: Project): void {
    this.assertNoProjectOperation();
    this.history.clear();
    const project = ProjectSchema.parse(rawProject);
    this.activeProjectInstanceId = ++this.nextProjectInstanceId;
    this.savedProjectJson = JSON.stringify(project);
    this.snapshot = {
      projectRoot,
      project,
      dirty: false,
      revision: 0,
    };
    this.emit();
  }

  updateProject(
    rawProject: Project,
    label = 'Edit project',
    options: ExecuteHistoryOptions = {},
    replayEffects: HistoryReplayEffects = {},
  ): void {
    this.assertNoProjectOperation();
    const current = this.requireSnapshot();
    const project = ProjectSchema.parse(rawProject);
    this.assertSameProject(current.project, project);
    if (JSON.stringify(project) === JSON.stringify(current.project)) return;
    this.history.execute(
      new ProjectCommand(
        label,
        current.project,
        project,
        (next) => this.applyHistoryProject(next),
        replayEffects,
      ),
      options,
    );
  }

  restore(rawProject: Project): void {
    this.assertNoProjectOperation();
    const current = this.requireSnapshot();
    const project = ProjectSchema.parse(rawProject);
    this.assertSameProject(current.project, project);
    this.history.clear();
    this.snapshot = {
      ...current,
      project,
      dirty: true,
      revision: current.revision + 1,
    };
    this.emit();
  }

  undo(): boolean {
    this.assertNoProjectOperation();
    return this.history.undo();
  }

  redo(): boolean {
    this.assertNoProjectOperation();
    return this.history.redo();
  }

  acquireProjectOperationLease(input: {
    projectRoot: string;
    projectId: string;
    revision: number;
    openInstanceId: number;
  }): EditorProjectOperationLease {
    if (this.activeProjectOperation) {
      throw new Error('Another Project operation is already in progress.');
    }
    const current = this.requireSnapshot();
    if (
      current.projectRoot !== input.projectRoot ||
      current.project.id !== input.projectId ||
      current.revision !== input.revision ||
      this.activeProjectInstanceId !== input.openInstanceId
    ) {
      throw new Error('The open Project changed before the operation could start.');
    }
    const lease = Object.freeze({ ...input, token: Symbol('editor-project-operation') });
    this.activeProjectOperation = { lease, committed: false };
    return lease;
  }

  acceptSavedProjectCommand(
    lease: EditorProjectOperationLease,
    rawProject: Project,
    savedRevision: number,
    label: string,
  ): void {
    const active = this.activeProjectOperation;
    if (!active || active.lease !== lease) {
      throw new Error('The Project operation lease is no longer active.');
    }
    const current = this.requireSnapshot();
    const project = ProjectSchema.parse(rawProject);
    this.assertSameProject(current.project, project);
    if (
      current.projectRoot !== lease.projectRoot ||
      current.revision !== lease.revision ||
      this.activeProjectInstanceId !== lease.openInstanceId ||
      savedRevision !== lease.revision + 1 ||
      JSON.stringify(project) === JSON.stringify(current.project)
    ) {
      throw new Error('The saved character result no longer matches the leased Project revision.');
    }
    this.savedProjectJson = JSON.stringify(project);
    this.snapshot = {
      ...current,
      project,
      dirty: false,
      revision: savedRevision,
    };
    active.committed = true;
    this.history.recordApplied(
      new ProjectCommand(
        label,
        current.project,
        project,
        (next) => this.applyHistoryProject(next),
      ),
    );
    this.emit();
  }

  releaseProjectOperationLease(lease: EditorProjectOperationLease): void {
    if (this.activeProjectOperation?.lease !== lease) {
      throw new Error('The Project operation lease is no longer active.');
    }
    this.activeProjectOperation = null;
  }

  assertProjectOperationIdle(): void {
    this.assertNoProjectOperation();
  }

  applyAssetImport(
    rawSavedProject: Project,
    importedAssets: readonly Asset[],
    baseRevision: number,
    savedRevision: number,
  ): SaveAcknowledgement {
    const current = this.requireSnapshot();
    const savedProject = ProjectSchema.parse(rawSavedProject);
    this.assertSameProject(current.project, savedProject);
    if (
      !Number.isInteger(baseRevision) ||
      baseRevision < 0 ||
      savedRevision !== baseRevision + 1
    ) {
      throw new Error(
        `Invalid asset import revisions: base=${baseRevision}, saved=${savedRevision}.`,
      );
    }
    if (current.revision < baseRevision) {
      throw new Error(
        `Asset import base revision ${baseRevision} is ahead of current editor revision ${current.revision}.`,
      );
    }
    this.history.clear();
    if (current.revision === baseRevision) {
      this.savedProjectJson = JSON.stringify(savedProject);
      this.snapshot = {
        ...current,
        project: savedProject,
        dirty: false,
        revision: savedRevision,
      };
      this.emit();
      return 'current';
    }

    const existingIds = new Set(
      current.project.assets.map((asset) => asset.id),
    );
    const project = ProjectSchema.parse({
      ...current.project,
      assets: [
        ...current.project.assets,
        ...importedAssets.filter((asset) => !existingIds.has(asset.id)),
      ],
    });
    this.snapshot = {
      ...current,
      project,
      dirty: true,
      revision: current.revision + 1,
    };
    this.emit();
    return 'stale';
  }

  applyProjectResourceImport(
    rawSavedProject: Project,
    importedAssets: readonly Asset[],
    importedCharacters: readonly Character[],
    importedVoiceProfiles: readonly VoiceProfile[],
    baseRevision: number,
    savedRevision: number,
  ): SaveAcknowledgement {
    const current = this.requireSnapshot();
    const savedProject = ProjectSchema.parse(rawSavedProject);
    this.assertSameProject(current.project, savedProject);
    if (
      !Number.isInteger(baseRevision) ||
      baseRevision < 0 ||
      savedRevision !== baseRevision + 1
    ) {
      throw new Error(
        `Invalid project resource import revisions: base=${baseRevision}, saved=${savedRevision}.`,
      );
    }
    if (current.revision < baseRevision) {
      throw new Error(
        `Project resource import base revision ${baseRevision} is ahead of current editor revision ${current.revision}.`,
      );
    }
    this.history.clear();
    if (current.revision === baseRevision) {
      this.savedProjectJson = JSON.stringify(savedProject);
      this.snapshot = {
        ...current,
        project: savedProject,
        dirty: false,
        revision: savedRevision,
      };
      this.emit();
      return 'current';
    }

    const assetIds = new Set(current.project.assets.map((asset) => asset.id));
    const characterIds = new Set(
      current.project.characters.map((character) => character.id),
    );
    const voiceProfileIds = new Set(
      current.project.voiceProfiles.map((profile) => profile.id),
    );
    const characterNames = new Set(
      current.project.characters.map((character) => normalizeName(character.name)),
    );
    const characters = importedCharacters
      .filter((character) => !characterIds.has(character.id))
      .map((character) => ({
        ...character,
        name: uniqueCharacterName(character.name, characterNames),
      }));
    const project = ProjectSchema.parse({
      ...current.project,
      assets: [
        ...current.project.assets,
        ...importedAssets.filter((asset) => !assetIds.has(asset.id)),
      ],
      characters: [...current.project.characters, ...characters],
      voiceProfiles: [
        ...current.project.voiceProfiles,
        ...importedVoiceProfiles.filter(
          (profile) => !voiceProfileIds.has(profile.id),
        ),
      ],
    });
    this.snapshot = {
      ...current,
      project,
      dirty: true,
      revision: current.revision + 1,
    };
    this.emit();
    return 'stale';
  }

  applyAssetMetadata(
    rawSavedProject: Project,
    rawRefreshedAsset: Asset,
    baseRevision: number,
    savedRevision: number,
  ): SaveAcknowledgement {
    const current = this.requireSnapshot();
    const savedProject = ProjectSchema.parse(rawSavedProject);
    const refreshedAsset = savedProject.assets.find(
      (asset) => asset.id === rawRefreshedAsset.id,
    );
    this.assertSameProject(current.project, savedProject);
    if (
      !refreshedAsset ||
      !Number.isInteger(baseRevision) ||
      baseRevision < 0 ||
      savedRevision !== baseRevision + 1
    ) {
      throw new Error(
        `Invalid asset metadata acknowledgement: base=${baseRevision}, saved=${savedRevision}.`,
      );
    }
    if (current.revision < baseRevision) {
      throw new Error(
        `Asset metadata base revision ${baseRevision} is ahead of current editor revision ${current.revision}.`,
      );
    }
    this.history.clear();
    if (current.revision === baseRevision) {
      this.savedProjectJson = JSON.stringify(savedProject);
      this.snapshot = {
        ...current,
        project: savedProject,
        dirty: false,
        revision: savedRevision,
      };
      this.emit();
      return 'current';
    }

    const assetIndex = current.project.assets.findIndex(
      (asset) => asset.id === refreshedAsset.id,
    );
    if (assetIndex < 0) return 'stale';
    const assets = [...current.project.assets];
    assets[assetIndex] = refreshedAsset;
    this.snapshot = {
      ...current,
      project: ProjectSchema.parse({
        ...current.project,
        assets,
      }),
      dirty: true,
      revision: current.revision + 1,
    };
    this.emit();
    return 'stale';
  }

  applyAssetDelete(
    rawSavedProject: Project,
    deletedAssetId: string,
    baseRevision: number,
    savedRevision: number,
  ): SaveAcknowledgement {
    const current = this.requireSnapshot();
    const savedProject = ProjectSchema.parse(rawSavedProject);
    this.assertSameProject(current.project, savedProject);
    if (
      !Number.isInteger(baseRevision) ||
      baseRevision < 0 ||
      savedRevision !== baseRevision + 1 ||
      savedProject.assets.some((asset) => asset.id === deletedAssetId)
    ) {
      throw new Error(
        `Invalid asset delete acknowledgement: base=${baseRevision}, saved=${savedRevision}.`,
      );
    }
    if (current.revision < baseRevision) {
      throw new Error(
        `Asset delete base revision ${baseRevision} is ahead of current editor revision ${current.revision}.`,
      );
    }
    this.history.clear();
    if (current.revision === baseRevision) {
      this.savedProjectJson = JSON.stringify(savedProject);
      this.snapshot = {
        ...current,
        project: savedProject,
        dirty: false,
        revision: savedRevision,
      };
      this.emit();
      return 'current';
    }

    if (
      scanAssetReferences(current.project, deletedAssetId).length > 0
    ) {
      throw new Error(
        'Newer editor changes reference the deleted asset and cannot be merged safely.',
      );
    }
    const project = ProjectSchema.parse({
      ...current.project,
      assets: current.project.assets.filter(
        (asset) => asset.id !== deletedAssetId,
      ),
    });
    this.snapshot = {
      ...current,
      project,
      dirty: true,
      revision: current.revision + 1,
    };
    this.emit();
    return 'stale';
  }

  markSaved(
    rawProject: Project,
    savedRevision: number,
  ): SaveAcknowledgement {
    if (this.activeProjectOperation?.committed) return 'stale';
    const current = this.requireSnapshot();
    const project = ProjectSchema.parse(rawProject);
    this.assertSameProject(current.project, project);
    if (!Number.isInteger(savedRevision) || savedRevision < 0) {
      throw new Error(
        `Saved revision must be a non-negative integer: ${savedRevision}.`,
      );
    }
    if (savedRevision > current.revision) {
      throw new Error(
        `Saved revision ${savedRevision} is ahead of current editor revision ${current.revision}.`,
      );
    }
    if (savedRevision < current.revision) {
      this.savedProjectJson = JSON.stringify(project);
      this.snapshot = {
        ...current,
        dirty: true,
      };
      this.emit();
      return 'stale';
    }
    this.snapshot = {
      ...current,
      project,
      dirty: false,
    };
    this.savedProjectJson = JSON.stringify(project);
    this.emit();
    return 'current';
  }

  clear(): void {
    this.assertNoProjectOperation();
    this.history.clear();
    this.savedProjectJson = null;
    this.cachedSavedProjectJson = null;
    this.cachedSavedProject = null;
    this.snapshot = null;
    this.activeProjectInstanceId = null;
    this.emit();
  }

  private requireSnapshot(): EditorProjectSnapshot {
    if (!this.snapshot) throw new Error('No project is open.');
    return this.snapshot;
  }

  private assertSameProject(current: Project, next: Project): void {
    if (current.id !== next.id) {
      throw new Error(
        `Editor project identity mismatch: ${current.id} !== ${next.id}.`,
      );
    }
  }

  private assertNoProjectOperation(): void {
    if (this.activeProjectOperation) {
      throw new Error('The Project is busy with a confirmed operation. Try the edit again after it finishes.');
    }
  }

  private applyHistoryProject(project: Project): void {
    const current = this.requireSnapshot();
    this.assertSameProject(current.project, project);
    this.snapshot = {
      ...current,
      project,
      dirty: JSON.stringify(project) !== this.savedProjectJson,
      revision: current.revision + 1,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('en-US');
}

function uniqueCharacterName(name: string, occupied: Set<string>): string {
  const normalized = normalizeName(name);
  if (!occupied.has(normalized)) {
    occupied.add(normalized);
    return name;
  }
  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const marker = ` (${suffix})`;
    const characters = Array.from(name);
    while (characters.join('').length > 200 - marker.length) {
      characters.pop();
    }
    const candidate = `${characters.join('').trimEnd()}${marker}`;
    const key = normalizeName(candidate);
    if (occupied.has(key)) continue;
    occupied.add(key);
    return candidate;
  }
  throw new Error(`Could not allocate a unique name for ${name}.`);
}

export const editorProjectStore = new EditorProjectStore();
export const historyStore = editorProjectStore.history;
