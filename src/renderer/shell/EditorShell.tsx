import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type {
  RecoveryAcknowledgeResponse,
  RecoveryCandidate,
  RecoveryError,
  RecoveryIgnoreResponse,
  RecoveryRestoreResponse,
} from '../../shared/recovery-api';
import type { ExportPreparationResponse } from '../../shared/export-preparation-types';
import type { ExportJobUpdate } from '../../shared/export-types';
import type { Project } from '../../domain';
import { projectDurationMs } from '../../domain/selectors/projectDuration';
import {
  ProjectSessionController,
  type ProjectSessionApi,
  type ProjectSessionSnapshot,
} from '../features/recovery/ProjectSessionController';
import {
  saveCurrentProject,
  type EditorProjectSaveResult,
  type ProjectSaveApi,
} from '../features/recovery/saveCurrentProject';
import {
  EditorProjectStore,
  editorProjectStore,
  type EditorProjectSnapshot,
} from '../stores/EditorProjectStore';
import { shotStore } from '../stores/shotStore';
import { characterAssemblySessionStore } from '../stores/characterAssemblySessionStore';
import { CharacterAssemblyWorkbench } from '../features/characters/CharacterAssemblyWorkbench';
import { PendingDialoguePlacementProvider } from '../features/timeline/PendingDialoguePlacement';
import { CloseConfirmDialog } from './CloseConfirmDialog';
import {
  ExportTaskSurface,
  type ExportTaskState,
} from './ExportTaskSurface';
import {
  applyExportJobUpdate,
  safeExportFailureMessage,
  shouldRestoreExportTask,
} from './exportTaskState';
import { AdaptiveWorkspaceSwitcher } from './AdaptiveWorkspaceSwitcher';
import { BottomWorkspace } from './BottomWorkspace';
import { CanvasWorkspace } from './CanvasWorkspace';
import {
  CompactProjectBar,
  type CompactProjectSaveState,
} from './CompactProjectBar';
import { LeftWorkspace } from './LeftWorkspace';
import { NewProjectDialog } from './NewProjectDialog';
import { ProductPreviewOverlay } from './ProductPreviewOverlay';
import { ProjectCenterScreen } from './ProjectCenterScreen';
import { RecoveryCandidateBanner } from './RecoveryCandidateBanner';
import { RightInspector } from './RightInspector';
import { RightWorkspace } from './RightWorkspace';
import type { ResourceActivity } from './ResourceActivityDock';
import {
  reconcileEditorWorkspace,
  useEditorShellLayoutMode,
  type EditorDeviceMode,
  type EditorWorkspace,
} from './adaptiveEditorShell';
import { useDebugFlag } from './useDebugFlag';
import {
  CLOSE_PROJECT_DIRTY_PROMPT,
  CLOSE_PROJECT_STALE_SAVE_MESSAGE,
  closeProjectErrorMessage,
  closeProjectRequestAction,
  closeProjectSaveFailureMessage,
  closeProjectStatusMessage,
  type CloseProjectChoice,
} from './closeProjectFlow';
import {
  projectCreateErrorMessage,
  validateNewProjectInput,
} from './projectCreateFlow';
import {
  projectOpenErrorMessage,
  validateProjectOpenCandidate,
} from './projectOpenFlow';

export type EditorShellState = 'no-project' | 'editor';
export type EditorShellSessionRegion =
  | 'start-screen'
  | 'editor-layout';
export type EditorShellPage = 'project-center' | 'editor';
type PortraitCanvasSurface = 'none' | 'shots';

export function getEditorShellState(
  snapshot: EditorProjectSnapshot | null,
): EditorShellState {
  return snapshot === null ? 'no-project' : 'editor';
}

export function getEditorShellSessionRegion(
  state: EditorShellState,
): EditorShellSessionRegion {
  return state === 'no-project' ? 'start-screen' : 'editor-layout';
}

export function getEditorShellPage(
  requestedPage: EditorShellPage,
  snapshot: EditorProjectSnapshot | null,
): EditorShellPage {
  return requestedPage === 'editor' && snapshot
    ? 'editor'
    : 'project-center';
}

export function getEditorWindowTitle(
  snapshot: Pick<EditorProjectSnapshot, 'project'> | null,
): string {
  return snapshot ? `Panda Stage（${snapshot.project.name}）` : 'Panda Stage';
}

export function shouldRenderProductSurface(gateA: boolean): boolean {
  return !gateA;
}

export function getEditorShellRecoveryCandidate(
  state: EditorShellState,
  sessionSnapshot: ProjectSessionSnapshot,
): RecoveryCandidate | null {
  return state === 'editor'
    ? sessionSnapshot.recoveryCandidate
    : null;
}

interface AutosaveShellApi {
  update(
    request: EditorProjectSnapshot,
  ): Promise<RecoveryAcknowledgeResponse>;
  onError(callback: (error: RecoveryError) => void): () => void;
}

interface RecoveryShellApi {
  restore(
    request: {
      projectRoot: string;
      recoveryFilePath: string;
    },
  ): Promise<RecoveryRestoreResponse>;
  ignore(
    request: {
      projectRoot: string;
      recoveryFilePath: string;
    },
  ): Promise<RecoveryIgnoreResponse>;
}

interface SessionController {
  getSnapshot(): ProjectSessionSnapshot;
  switchProject(projectRoot: string): Promise<ProjectSessionSnapshot>;
  switchRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<ProjectSessionSnapshot>;
  closeProject(): Promise<ProjectSessionSnapshot>;
  clearRecoveryCandidate(ignored?: boolean): ProjectSessionSnapshot;
  dispose(): Promise<void>;
}

export interface EditorShellSessionDependencies {
  store: EditorProjectStore;
  sessionApi: ProjectSessionApi;
  autosaveApi: AutosaveShellApi;
  recoveryApi: RecoveryShellApi;
  projectSaveApi: ProjectSaveApi;
  createController?: (
    api: ProjectSessionApi,
    store: EditorProjectStore,
  ) => SessionController;
}

export class EditorShellSession {
  private readonly controller: SessionController;
  private readonly store: EditorProjectStore;
  private readonly autosaveApi: AutosaveShellApi;
  private readonly recoveryApi: RecoveryShellApi;
  private readonly projectSaveApi: ProjectSaveApi;
  private autosaveErrorUnsubscribe: (() => void) | null = null;
  private lastAutosaveSnapshot: EditorProjectSnapshot | null = null;
  private autosaveUpdateQueue: Promise<void> = Promise.resolve();
  private autosaveUpdateFailure: Error | null = null;
  private controllerTransitionDepth = 0;
  private lifecycleGeneration = 0;
  private controllerDisposePromise: Promise<void> | null = null;

  constructor({
    store,
    sessionApi,
    autosaveApi,
    recoveryApi,
    projectSaveApi,
    createController = (api, projectStore) =>
      new ProjectSessionController(api, projectStore),
  }: EditorShellSessionDependencies) {
    this.store = store;
    this.autosaveApi = autosaveApi;
    this.recoveryApi = recoveryApi;
    this.projectSaveApi = projectSaveApi;
    this.controller = createController(sessionApi, store);
  }

  getSnapshot(): ProjectSessionSnapshot {
    return this.controller.getSnapshot();
  }

  activateAutosaveErrors(
    onError: (error: RecoveryError) => void,
  ): void {
    if (this.autosaveErrorUnsubscribe) return;
    if (this.controllerDisposePromise) {
      throw new Error('Cannot activate a disposed editor shell session.');
    }
    this.lifecycleGeneration += 1;
    this.autosaveErrorUnsubscribe = this.autosaveApi.onError(onError);
  }

  deactivateAutosaveErrors(): void {
    this.autosaveErrorUnsubscribe?.();
    this.autosaveErrorUnsubscribe = null;
  }

  async scheduleControllerDisposal(): Promise<void> {
    const cleanupGeneration = this.lifecycleGeneration;
    // StrictMode immediately runs the replacement setup before this resumes.
    await Promise.resolve();
    if (
      cleanupGeneration !== this.lifecycleGeneration ||
      this.autosaveErrorUnsubscribe
    ) {
      return;
    }
    await this.flushAutosave();
    this.controllerDisposePromise ??= this.controller.dispose();
    await this.controllerDisposePromise;
  }

  async syncAutosave(
    snapshot: EditorProjectSnapshot | null,
  ): Promise<RecoveryAcknowledgeResponse | null> {
    if (
      !snapshot ||
      this.controllerTransitionDepth > 0 ||
      snapshot === this.lastAutosaveSnapshot ||
      snapshot.projectRoot !== this.getSnapshot().trackedProjectRoot
    ) {
      return null;
    }
    const openInstanceId = this.store.getProjectInstanceId();
    const request = {
      ...snapshot,
      ...(openInstanceId === null ? {} : { openInstanceId }),
    };
    const update = this.autosaveUpdateQueue.then(() =>
      this.autosaveApi.update(request),
    );
    this.autosaveUpdateQueue = update.then(
      (response) => {
        if (response.ok) this.lastAutosaveSnapshot = snapshot;
        this.autosaveUpdateFailure = response.ok
          ? null
          : new Error(response.error.message);
      },
      (error: unknown) => {
        this.autosaveUpdateFailure =
          error instanceof Error ? error : new Error(String(error));
      },
    );
    return update;
  }

  async prepareForNativeClose(
    getSnapshot: () => EditorProjectSnapshot | null,
  ): Promise<void> {
    while (true) {
      const snapshot = getSnapshot();
      this.assertNativeCloseSyncable(snapshot);
      const response = await this.syncAutosave(snapshot);
      if (response && !response.ok) {
        throw new Error(response.error.message);
      }
      await this.flushAutosave();
      this.assertNativeCloseSyncable(snapshot);
      if (getSnapshot() === snapshot) return;
    }
  }

  async switchProject(projectRoot: string): Promise<ProjectSessionSnapshot> {
    await this.flushAutosave();
    const snapshot = await this.runControllerTransition(() =>
      this.controller.switchProject(projectRoot),
    );
    await this.registerCurrentOpenInstance();
    return snapshot;
  }

  async switchRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<ProjectSessionSnapshot> {
    await this.flushAutosave();
    const snapshot = await this.runControllerTransition(() =>
      this.controller.switchRecentProject(
        projectRoot,
        expectedProjectId,
      ),
    );
    await this.registerCurrentOpenInstance();
    return snapshot;
  }

  /**
   * Closes the current project through the one owned session controller.
   * The window itself stays open; the native `×` guard is untouched.
   */
  async closeProject(): Promise<ProjectSessionSnapshot> {
    await this.flushAutosave();
    return this.runControllerTransition(() =>
      this.controller.closeProject(),
    );
  }

  async restoreRecovery(): Promise<RecoveryRestoreResponse> {
    const candidate = this.getSnapshot().recoveryCandidate;
    if (!candidate) throw new Error('No recovery candidate is available.');
    const response = await this.recoveryApi.restore({
      projectRoot: candidate.projectRoot,
      recoveryFilePath: candidate.recoveryFilePath,
    });
    if (response.ok) {
      this.store.restore(response.candidate.project);
      this.controller.clearRecoveryCandidate();
    }
    return response;
  }

  async ignoreRecovery(): Promise<RecoveryIgnoreResponse> {
    const candidate = this.getSnapshot().recoveryCandidate;
    if (!candidate) throw new Error('No recovery candidate is available.');
    const response = await this.recoveryApi.ignore({
      projectRoot: candidate.projectRoot,
      recoveryFilePath: candidate.recoveryFilePath,
    });
    if (response.ok) this.controller.clearRecoveryCandidate(true);
    return response;
  }

  async saveCurrentProject(): Promise<EditorProjectSaveResult> {
    await this.flushAutosave();
    return saveCurrentProject(this.projectSaveApi, this.store);
  }

  private async flushAutosave(): Promise<void> {
    await this.autosaveUpdateQueue;
    const failure = this.autosaveUpdateFailure;
    this.autosaveUpdateFailure = null;
    if (failure) throw failure;
  }

  private async registerCurrentOpenInstance(): Promise<void> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) return;
    await this.syncAutosave(snapshot);
    await this.flushAutosave();
  }

  private assertNativeCloseSyncable(
    snapshot: EditorProjectSnapshot | null,
  ): void {
    const trackedProjectRoot = this.getSnapshot().trackedProjectRoot;
    if (
      this.controllerTransitionDepth > 0 ||
      (snapshot?.projectRoot ?? null) !== trackedProjectRoot
    ) {
      throw new Error(
        'Project state is transitioning and cannot be synchronized for native close.',
      );
    }
  }

  private async runControllerTransition<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    this.controllerTransitionDepth += 1;
    try {
      return await operation();
    } finally {
      this.controllerTransitionDepth -= 1;
    }
  }
}

function createBrowserSession(): EditorShellSession {
  return new EditorShellSession({
    store: editorProjectStore,
    sessionApi: {
      open: (projectRoot) =>
        window.pandaStage.project.open({ projectRoot }),
      openRecent: (projectRoot, expectedProjectId) =>
        window.pandaStage.recentProjects.open({
          projectRoot,
          expectedProjectId,
        }),
      track: (request) => window.pandaStage.autosave.track(request),
      stop: (projectRoot) => window.pandaStage.autosave.stop(projectRoot),
      detect: (projectRoot) =>
        window.pandaStage.recovery.detect(projectRoot),
      confirmSwitch: (request) =>
        window.pandaStage.project.confirmSwitch(request),
    },
    autosaveApi: window.pandaStage.autosave,
    recoveryApi: window.pandaStage.recovery,
    projectSaveApi: window.pandaStage.project,
  });
}

export interface EditorShellProps {
  debugSurface?: ReactNode;
  gatePreview?: ReactNode;
}

export function EditorShell({
  debugSurface,
  gatePreview,
}: EditorShellProps): React.JSX.Element {
  const projectSnapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const characterAssemblySnapshot = useSyncExternalStore(
    characterAssemblySessionStore.subscribe,
    characterAssemblySessionStore.getSnapshot,
    characterAssemblySessionStore.getSnapshot,
  );
  // Read-only subscription to the single existing shot selection. The product
  // preview reuses it instead of owning a second selection source.
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const [session] = useState(createBrowserSession);
  const [sessionSnapshot, setSessionSnapshot] = useState(() =>
    session.getSnapshot(),
  );
  const [openCandidatePath, setOpenCandidatePath] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [recentRefreshToken, setRecentRefreshToken] = useState(0);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [newProjectParentDirectory, setNewProjectParentDirectory] =
    useState('');
  const [newProjectParentDirectoryTouched, setNewProjectParentDirectoryTouched] =
    useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectNameTouched, setNewProjectNameTouched] = useState(false);
  const [newProjectStatus, setNewProjectStatus] = useState('');
  const [productPreviewOpen, setProductPreviewOpen] = useState(false);
  const productPreviewOpenerRef = useRef<HTMLElement | null>(null);
  // Preview Camera is an editor-session mode, not Project or Preview state.
  const [autoCameraEnabled, setAutoCameraEnabled] = useState(false);
  const issue816FlowActive = useRef(false);
  const [productPreviewSurfaceActive, setProductPreviewSurfaceActive] =
    useState(false);
  const commitProductPreviewSurface = useCallback((): void => {
    setProductPreviewSurfaceActive(true);
  }, []);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeConfirmStatus, setCloseConfirmStatus] = useState('');
  const [exportTask, setExportTask] = useState<ExportTaskState>({
    status: 'idle',
    completedFrames: 0,
    totalFrames: 0,
    issues: [],
  });
  const exportTaskRef = useRef(exportTask);
  const [exportSurfaceOpen, setExportSurfaceOpen] = useState(false);
  const exportJobIdRef = useRef<string | null>(null);
  const latestExportUpdatesRef = useRef(new Map<string, ExportJobUpdate>());
  const [saveActivity, setSaveActivity] = useState<{
    phase: 'idle' | 'saving' | 'failed';
    revision: number | null;
  }>({ phase: 'idle', revision: null });
  const [requestedPage, setRequestedPage] =
    useState<EditorShellPage>('project-center');
  // Cloud Touch is the sole product route. This presentation value is kept
  // only as a DOM/CSS contract; it never enters Project, History, autosave,
  // or any cross-process contract.
  const deviceMode: EditorDeviceMode = 'cloud-touch';
  const layoutMode = useEditorShellLayoutMode(deviceMode);
  const [portraitWorkspace, setPortraitWorkspace] =
    useState<EditorWorkspace>('canvas');
  const [portraitResourceActivity, setPortraitResourceActivity] =
    useState<ResourceActivity>('shots');
  const [portraitCanvasSurface, setPortraitCanvasSurface] =
    useState<PortraitCanvasSurface>('none');
  const shellState = getEditorShellState(projectSnapshot);
  const sessionRegion = getEditorShellSessionRegion(shellState);
  const page = getEditorShellPage(requestedPage, projectSnapshot);
  const activeAssemblySession =
    page === 'editor' &&
    projectSnapshot &&
    characterAssemblySnapshot &&
    characterAssemblySnapshot.projectId === projectSnapshot.project.id &&
    characterAssemblySnapshot.projectRoot === projectSnapshot.projectRoot
      ? characterAssemblySnapshot
      : null;
  const assemblyActive = activeAssemblySession !== null;
  const assemblyKind = activeAssemblySession
    ? activeAssemblySession.kind ?? 'composite'
    : 'none';
  const assemblyHidesResourceDrawer =
    assemblyKind === 'adaptive-parts' || assemblyKind === 'create';
  const legacyCompositeAssemblyActive =
    assemblyActive && assemblyKind === 'composite';
  const recoveryCandidate = getEditorShellRecoveryCandidate(
    shellState,
    sessionSnapshot,
  );
  const saveState: CompactProjectSaveState =
    saveActivity.phase === 'saving'
      ? 'saving'
      : saveActivity.phase === 'failed' &&
          projectSnapshot &&
          saveActivity.revision === projectSnapshot.revision
        ? 'failed'
        : projectSnapshot?.dirty
          ? 'dirty'
          : 'saved';
  const { debug, gateA } = useDebugFlag();
  const renderProductSurface = shouldRenderProductSurface(gateA);
  const isPortrait = layoutMode === 'portrait';

  const setExportTaskState = (next: ExportTaskState): void => {
    exportTaskRef.current = next;
    setExportTask(next);
  };
  const exportTaskIsActive = (task: ExportTaskState): boolean =>
    ['selecting', 'preparing', 'starting', 'running', 'cancelling'].includes(task.status);
  const blockSessionChangeDuringExport = (): boolean => {
    const task = exportTaskRef.current;
    if (!exportTaskIsActive(task)) return false;
    setExportSurfaceOpen(true);
    setExportTaskState({
      ...task,
      message:
        '\u6b63\u5728\u5bfc\u51fa\u89c6\u9891\uff0c\u5b8c\u6210\u6216\u53d6\u6d88\u540e\u518d\u5207\u6362\u6216\u5173\u95ed\u9879\u76ee\u3002',
    });
    return true;
  };
  const clearExportTask = async (): Promise<void> => {
    const task = exportTaskRef.current;
    if (task.snapshotId && !exportTaskIsActive(task)) {
      await window.pandaStage.exportPreparation.discard({
        snapshotId: task.snapshotId,
      });
    }
    exportJobIdRef.current = null;
    setExportSurfaceOpen(false);
    setExportTaskState({
      status: 'idle',
      completedFrames: 0,
      totalFrames: 0,
      issues: [],
    });
  };

  useEffect(
    () =>
      window.pandaStage.export.onUpdate((update) => {
        const updates = latestExportUpdatesRef.current;
        updates.set(update.jobId, update);
        while (updates.size > 32) {
          const oldest = updates.keys().next().value;
          if (!oldest) break;
          updates.delete(oldest);
        }
        if (exportJobIdRef.current !== update.jobId) return;
        const current = exportTaskRef.current;
        const next = applyExportJobUpdate(current, update);
        if (next !== current) setExportTaskState(next);
      }),
    [],
  );

  useEffect(() => {
    const snapshotId = exportTask.snapshotId;
    if (
      !snapshotId ||
      (exportTask.status !== 'failed' && exportTask.status !== 'cancelled')
    ) {
      return;
    }
    let current = true;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshSnapshotStatus = async (): Promise<void> => {
      try {
        const status =
          await window.pandaStage.exportPreparation.getSnapshotRetryStatus(
            snapshotId,
          );
        if (!current) return;
        const latest = exportTaskRef.current;
        if (
          latest.snapshotId !== snapshotId ||
          (latest.status !== 'failed' && latest.status !== 'cancelled')
        ) {
          return;
        }
        setExportTaskState({
          ...latest,
          snapshotRetryAvailable: status.available,
        });
        if (status.available && status.expiresAt !== null) {
          const delay = Math.max(1, status.expiresAt - Date.now() + 1);
          expiryTimer = setTimeout(() => void refreshSnapshotStatus(), delay);
        }
      } catch {
        if (!current) return;
        const latest = exportTaskRef.current;
        if (latest.snapshotId !== snapshotId) return;
        setExportTaskState({
          ...latest,
          snapshotRetryAvailable: false,
        });
      }
    };
    void refreshSnapshotStatus();
    return () => {
      current = false;
      if (expiryTimer) clearTimeout(expiryTimer);
    };
  }, [exportTask.snapshotId, exportTask.status]);

  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get(
        'issue816Acceptance',
      ) !== '1'
    ) {
      return;
    }

    let issue819BaselineProject: Project | null = null;
    const acceptanceApi = {
      lastAttemptId: null as string | null,
      lastMainResponse: null as ExportPreparationResponse | null,
      inspect: () => {
        const snapshot = editorProjectStore.getSnapshot();
        if (!snapshot) return null;
        return {
          projectRoot: snapshot.projectRoot,
          project: structuredClone(snapshot.project),
          revision: snapshot.revision,
          dirty: snapshot.dirty,
          openInstanceId: editorProjectStore.getProjectInstanceId(),
          currentShotId: shotStore.getCurrentShotId(),
          undoCount: editorProjectStore.history.getSnapshot().undoCount,
          redoCount: editorProjectStore.history.getSnapshot().redoCount,
        };
      },
      inspectExportTask: () => {
        const task = structuredClone(exportTaskRef.current);
        return {
          task,
          latestUpdate: task.jobId
            ? structuredClone(latestExportUpdatesRef.current.get(task.jobId) ?? null)
            : null,
        };
      },
      saveCurrentProject: () => session.saveCurrentProject(),
      editUnsavedFixture: async () => {
        const snapshot = editorProjectStore.getSnapshot();
        if (!snapshot) throw new Error('No active Project for issue 816 fixture.');
        const project = structuredClone(snapshot.project);
        const shot = project.shots[0];
        if (!shot) throw new Error('Issue 816 fixture requires one shot.');
        const layer =
          shot.layers.find((candidate) => candidate.source.kind === 'character') ??
          shot.layers.find((candidate) => candidate.id !== shot.backgroundLayerId);
        if (!layer) throw new Error('Issue 816 fixture requires a character layer.');
        if (shot.dialogues.length > 0) {
          shot.dialogues[0] = {
            ...shot.dialogues[0]!,
            text: 'DL-02 未保存字幕验收',
          };
        } else {
          const character = project.characters[0];
          const voiceProfile = project.voiceProfiles.find(
            (candidate) => candidate.characterId === character?.id,
          );
          if (!character || !voiceProfile) {
            throw new Error('Issue 816 fixture requires a character voice profile.');
          }
          shot.dialogues.push({
            id: crypto.randomUUID(),
            characterId: character.id,
            voiceProfileId: voiceProfile.id,
            subtitleStyleId: shot.defaultSubtitleStyleId,
            startMs: 250,
            endMs: Math.min(1_500, shot.durationMs),
            text: 'DL-02 未保存字幕验收',
          });
        }
        layer.x += 37;
        layer.y += 19;
        editorProjectStore.updateProject(project, 'Issue 819 acceptance edit');
        const updated = editorProjectStore.getSnapshot();
        if (!updated) throw new Error('Issue 816 Project closed during fixture edit.');
        const syncResult = await session.syncAutosave(updated);
        if (syncResult && !syncResult.ok) {
          throw new Error('Issue 816 fixture edit did not reach Main autosave tracking.');
        }
        return {
          revision: updated.revision,
          dirty: updated.dirty,
          undoCount: editorProjectStore.history.getSnapshot().undoCount,
          project: structuredClone(updated.project),
        };
      },
      editSubtitleAndAddAudioFixture: async (text: string) => {
        const snapshot = editorProjectStore.getSnapshot();
        if (!snapshot) throw new Error('No active Project for DL-05 edit.');
        const project = structuredClone(snapshot.project);
        const shot = project.shots[0];
        const dialogue = shot?.dialogues[0];
        if (!shot || !dialogue) {
          throw new Error('DL-05 fixture requires a first-Shot subtitle.');
        }
        const priorText = dialogue.text;
        dialogue.text = text;
        const newAudioAsset = project.assets.find(
          (asset) =>
            asset.kind === 'audio' &&
            asset.relativePath.endsWith('dl03-sfx-two.wav'),
        );
        if (!newAudioAsset || newAudioAsset.kind !== 'audio') {
          throw new Error('DL-05 fixture requires its unused SFX source.');
        }
        shot.audioClips.push({
          id: crypto.randomUUID(),
          name: 'DL-05 current-content retry signal',
          assetId: newAudioAsset.id,
          role: 'sfx',
          startMs: 7_000,
          endMs: 8_000,
          offsetMs: 0,
          volume: 0.6,
        });
        editorProjectStore.updateProject(project, 'DL-05 parallel edit');
        const updated = editorProjectStore.getSnapshot();
        if (!updated) throw new Error('DL-05 Project closed during edit.');
        const syncResult = await session.syncAutosave(updated);
        if (syncResult && !syncResult.ok) {
          throw new Error('DL-05 edit did not reach Main project tracking.');
        }
        return {
          priorText,
          text,
          revision: updated.revision,
          dirty: updated.dirty,
          undoCount: editorProjectStore.history.getSnapshot().undoCount,
          project: structuredClone(updated.project),
          addedAudioAssetId: newAudioAsset.id,
          addedAudioAssetSha256: newAudioAsset.sha256,
        };
      },
      setExportScenario: async (
        scenario: 'baseline' | 'audio' | 'multi-shot' | 'no-background',
      ) => {
        const snapshot = editorProjectStore.getSnapshot();
        if (!snapshot) throw new Error('No active Project for issue 819 scenario.');
        issue819BaselineProject ??= structuredClone(snapshot.project);
        const project = structuredClone(issue819BaselineProject);
        const shot = project.shots[0];
        if (!shot) throw new Error('Issue 819 fixture requires one Shot.');

        if (scenario === 'audio') {
          const audio = project.assets.find((asset) => asset.kind === 'audio');
          if (!audio || audio.kind !== 'audio') {
            throw new Error('Issue 819 audio scenario requires a fixture audio Asset.');
          }
          shot.audioClips.push({
            id: crypto.randomUUID(),
            name: 'Unsupported audio acceptance clip',
            assetId: audio.id,
            startMs: 0,
            endMs: Math.min(audio.durationMs ?? 1_000, shot.durationMs),
            offsetMs: 0,
            volume: 1,
            role: 'bgm',
          });
        } else if (scenario === 'multi-shot') {
          const source = structuredClone(shot);
          const remappedIds = new Map<string, string>();
          const mapId = (id: string): string => {
            const replacement = remappedIds.get(id);
            if (!replacement) throw new Error(`Missing scenario ID mapping: ${id}`);
            return replacement;
          };
          remappedIds.set(source.id, crypto.randomUUID());
          for (const layer of source.layers) remappedIds.set(layer.id, crypto.randomUUID());
          for (const event of source.timelineEvents) remappedIds.set(event.id, crypto.randomUUID());
          for (const dialogue of source.dialogues) remappedIds.set(dialogue.id, crypto.randomUUID());
          for (const clip of source.audioClips) remappedIds.set(clip.id, crypto.randomUUID());
          project.shots.push({
            ...source,
            id: mapId(source.id),
            name: 'Second unsupported Shot',
            backgroundLayerId: source.backgroundLayerId
              ? mapId(source.backgroundLayerId)
              : null,
            layers: source.layers.map((layer) => ({ ...layer, id: mapId(layer.id) })),
            timelineEvents: source.timelineEvents.map((event) => ({
              ...event,
              id: mapId(event.id),
              layerId: mapId(event.layerId),
            })),
            dialogues: source.dialogues.map((dialogue) => ({
              ...dialogue,
              id: mapId(dialogue.id),
            })),
            audioClips: source.audioClips.map((clip) => ({
              ...clip,
              id: mapId(clip.id),
            })),
          });
        } else if (scenario === 'no-background') {
          shot.backgroundLayerId = null;
        }

        editorProjectStore.updateProject(project, `Issue 819 ${scenario} scenario`);
        const updated = editorProjectStore.getSnapshot();
        if (!updated) throw new Error('Issue 819 Project closed during scenario setup.');
        const syncResult = await session.syncAutosave(updated);
        if (syncResult && !syncResult.ok) {
          throw new Error('Issue 819 scenario did not reach Main autosave tracking.');
        }
        return {
          revision: updated.revision,
          dirty: updated.dirty,
          project: structuredClone(updated.project),
        };
      },
      reopenSamePath: async () => {
        const snapshot = editorProjectStore.getSnapshot();
        if (!snapshot) throw new Error('No active Project to reopen for issue 816.');
        const projectId = snapshot.project.id;
        const projectRoot = snapshot.projectRoot;
        await session.closeProject();
        await session.switchRecentProject(projectRoot, projectId);
        return acceptanceApi.inspect();
      },
      prepare: async () => {
        if (issue816FlowActive.current) {
          return { status: 'PREPARATION_BUSY' };
        }
        const initial = editorProjectStore.getSnapshot();
        const initialInstanceId = editorProjectStore.getProjectInstanceId();
        if (!initial || initialInstanceId === null) {
          return { status: 'NO_PROJECT' };
        }

        issue816FlowActive.current = true;
        try {
          const selection =
            await window.pandaStage.exportPreparation.selectOutput({
              projectRoot: initial.projectRoot,
              projectId: initial.project.id,
              projectName: initial.project.name,
              openInstanceId: initialInstanceId,
            });
          if (selection.status !== 'selected') return selection;

          const attemptId = crypto.randomUUID();
          const captured = editorProjectStore.getSnapshot();
          const capturedInstanceId =
            editorProjectStore.getProjectInstanceId();
          if (
            !captured ||
            capturedInstanceId !== initialInstanceId ||
            captured.projectRoot !== initial.projectRoot ||
            captured.project.id !== initial.project.id
          ) {
            await window.pandaStage.exportPreparation.discard({
              selectionId: selection.selectionId,
            });
            return {
              status: 'BLOCK',
              attemptId,
              diagnosticId: crypto.randomUUID(),
              issues: [
                {
                  code: 'PROJECT_SESSION_CHANGED',
                  location: '当前工程',
                  problem: '输出位置选择后，当前工程已关闭或切换。',
                  nextStep: '打开目标工程并重新选择输出位置。',
                },
              ],
            };
          }

          const request = {
            selectionId: selection.selectionId,
            attemptId,
            projectRoot: captured.projectRoot,
            projectId: captured.project.id,
            openInstanceId: capturedInstanceId,
            revision: captured.revision,
            dirty: captured.dirty,
            cameraMode: autoCameraEnabled ? 'speaker-focus' : 'static',
            project: structuredClone(captured.project),
          } as const;
          acceptanceApi.lastAttemptId = attemptId;
          const result = await window.pandaStage.exportPreparation.prepare(
            request,
          );
          acceptanceApi.lastMainResponse = result;
          const current = editorProjectStore.getSnapshot();
          if (
            editorProjectStore.getProjectInstanceId() !== initialInstanceId ||
            !current ||
            current.projectRoot !== initial.projectRoot ||
            current.project.id !== initial.project.id
          ) {
            if (result.status === 'PREPARATION_READY') {
              await window.pandaStage.exportPreparation.discard({
                snapshotId: result.candidate.snapshotId,
              });
            }
            return {
              status: 'BLOCK',
              attemptId,
              diagnosticId: crypto.randomUUID(),
              issues: [
                {
                  code: 'PROJECT_SESSION_CHANGED',
                  location: '当前工程',
                  problem: '工程检查期间，当前工程已关闭或切换。',
                  nextStep: '打开目标工程并重新选择输出位置。',
                },
              ],
            };
          }
          return result;
        } finally {
          issue816FlowActive.current = false;
        }
      },
    };
    window.__pandaStageIssue816Acceptance = acceptanceApi;

    return () => {
      delete window.__pandaStageIssue816Acceptance;
    };
  }, [autoCameraEnabled]);

  useEffect(() => {
    setPortraitWorkspace((current) =>
      reconcileEditorWorkspace(layoutMode, current),
    );
  }, [layoutMode]);

  useEffect(() => {
    setPortraitCanvasSurface(
      isPortrait && portraitWorkspace === 'canvas' ? 'shots' : 'none',
    );
  }, [isPortrait, portraitWorkspace]);

  useEffect(() => {
    // Electron uses the renderer document title for the native window title.
    // The formal project snapshot remains the only project-name owner.
    document.title = getEditorWindowTitle(projectSnapshot);
  }, [projectSnapshot?.project.name]);

  useEffect(() => {
    session.activateAutosaveErrors((error) => setStatus(error.message));
    return () => {
      session.deactivateAutosaveErrors();
      void session.scheduleControllerDisposal();
    };
  }, [session]);

  useEffect(() => {
    void session
      .syncAutosave(projectSnapshot)
      .then((response) => {
        if (response && !response.ok) setStatus(response.error.message);
      })
      .catch((error: unknown) => {
        const current = editorProjectStore.getSnapshot();
        if (current?.projectRoot !== projectSnapshot?.projectRoot) return;
        setStatus(
          error instanceof Error ? error.message : 'Autosave 更新失败。',
        );
      });
  }, [projectSnapshot, session]);

  useEffect(() => {
    return window.pandaStage.nativeClose.onSyncRequest(({ requestId }) => {
      if (blockSessionChangeDuringExport()) {
        window.pandaStage.nativeClose.respondSync({
          ok: false,
          requestId,
          error:
            '\u6b63\u5728\u5bfc\u51fa\u89c6\u9891\u3002\u8bf7\u5b8c\u6210\u6216\u53d6\u6d88\u5bfc\u51fa\u540e\u518d\u5173\u95ed\u7a97\u53e3\u3002',
        });
        return;
      }
      void session
        .prepareForNativeClose(editorProjectStore.getSnapshot)
        .then(() => {
          window.pandaStage.nativeClose.respondSync({
            ok: true,
            requestId,
          });
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error && error.message.trim()
              ? error.message
              : 'Autosave 同步失败，窗口保持打开。';
          window.pandaStage.nativeClose.respondSync({
            ok: false,
            requestId,
            error: message.slice(0, 2_000),
          });
        });
    });
  }, [session]);

  const updateSession = (
    nextSession: ProjectSessionSnapshot,
    cleanStatus: string,
  ): void => {
    setSessionSnapshot(nextSession);
    if (nextSession.trackedProjectRoot) {
      setOpenCandidatePath(nextSession.trackedProjectRoot);
    }
    setRecentRefreshToken((current) => current + 1);
    setStatus(nextSession.recoveryCandidate ? '' : cleanStatus);
  };

  const switchToProject = async (
    projectRoot: string,
    cleanStatus = '项目已打开，暂无未保存更改。',
  ): Promise<void> => {
    if (blockSessionChangeDuringExport()) return;
    const nextSession = await session.switchProject(projectRoot);
    await clearExportTask();
    // The preview belongs to the project that was open when it was requested.
    setProductPreviewOpen(false);
    setProductPreviewSurfaceActive(false);
    setAutoCameraEnabled(false);
    setSaveActivity({ phase: 'idle', revision: null });
    updateSession(nextSession, cleanStatus);
    setRequestedPage('editor');
  };

  const switchToRecentProject = async (
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void> => {
    if (blockSessionChangeDuringExport()) return;
    try {
      const nextSession = await session.switchRecentProject(
        projectRoot,
        expectedProjectId,
      );
      await clearExportTask();
      updateSession(
        nextSession,
        '已从最近项目打开，暂无未保存更改。',
      );
      setProductPreviewOpen(false);
      setProductPreviewSurfaceActive(false);
      setAutoCameraEnabled(false);
      setSaveActivity({ phase: 'idle', revision: null });
      setRequestedPage('editor');
    } catch (error) {
      throw new Error(projectOpenErrorMessage(error), { cause: error });
    }
  };

  const openProjectCenter = (): void => {
    if (blockSessionChangeDuringExport()) return;
    setProductPreviewOpen(false);
    setProductPreviewSurfaceActive(false);
    setRequestedPage('project-center');
    setStatus('');
  };

  const returnToEditor = (): void => {
    if (!projectSnapshot) return;
    setRequestedPage('editor');
    setStatus('已返回编辑器，当前镜头与编辑状态保持不变。');
  };

  const openProject = async (): Promise<void> => {
    if (blockSessionChangeDuringExport()) return;
    const projectRoot = openCandidatePath.trim();
    const validation = validateProjectOpenCandidate(
      projectRoot,
      projectSnapshot?.projectRoot,
    );
    if (!validation.valid) {
      setStatus(validation.message);
      return;
    }
    setBusy(true);
    try {
      await switchToProject(projectRoot);
    } catch (error) {
      setStatus(projectOpenErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openProjectFromChooser = async (): Promise<void> => {
    if (blockSessionChangeDuringExport()) return;
    setBusy(true);
    try {
      const response = await window.pandaStage.project.chooseDirectory();
      if (response.status === 'cancelled') {
        setStatus('');
        return;
      }
      await switchToProject(response.projectRoot);
    } catch (error) {
      setStatus(projectOpenErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const chooseProjectDirectory = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await window.pandaStage.project.chooseDirectory();
      if (response.status === 'cancelled') {
        setStatus('');
        return;
      }
      setOpenCandidatePath(response.projectRoot);
      setStatus('已选择项目文件夹，请确认后点击“打开项目”。');
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `无法选择项目文件夹：${error.message}`
          : '无法选择项目文件夹，请稍后重试。',
      );
    } finally {
      setBusy(false);
    }
  };

  const requestNewProject = (): void => {
    setNewProjectParentDirectoryTouched(false);
    setNewProjectNameTouched(false);
    setNewProjectStatus('');
    setNewProjectDialogOpen(true);
  };

  const cancelNewProject = (): void => {
    setNewProjectDialogOpen(false);
    setNewProjectStatus('');
  };

  const chooseNewProjectParentDirectory = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await window.pandaStage.project.chooseDirectory();
      if (response.status === 'cancelled') {
        setNewProjectStatus('已取消选择，存放文件夹保持不变。');
        return;
      }
      // The shared directory picker returns the chosen folder in `projectRoot`.
      // For creation that folder is only the parent: the Main Process appends
      // the project directory name and performs the join.
      setNewProjectParentDirectory(response.projectRoot);
      setNewProjectStatus('已选择存放文件夹，请填写项目名称。');
    } catch (error) {
      setNewProjectStatus(
        error instanceof Error
          ? `无法选择存放文件夹：${error.message}`
          : '无法选择存放文件夹，请稍后重试。',
      );
    } finally {
      setBusy(false);
    }
  };

  const createProject = async (): Promise<void> => {
    if (blockSessionChangeDuringExport()) return;
    const parentDirectory = newProjectParentDirectory.trim();
    const projectName = newProjectName.trim();
    const validation = validateNewProjectInput(parentDirectory, projectName);
    if (!validation.valid) {
      setNewProjectParentDirectoryTouched(true);
      setNewProjectNameTouched(true);
      setNewProjectStatus(
        validation.parentDirectory.valid
          ? validation.projectName.message
          : validation.parentDirectory.message,
      );
      return;
    }
    setBusy(true);
    try {
      const response = await window.pandaStage.project.createAt({
        parentDirectory,
        projectName,
        metadata: { name: projectName },
      });
      if (!response.ok) {
        setNewProjectStatus(projectCreateErrorMessage(response.error));
        return;
      }
      try {
        await switchToProject(
          response.value.projectRoot,
          '新项目已创建并打开，暂无未保存更改。',
        );
      } catch (error) {
        setNewProjectStatus(
          `项目已创建，但无法自动打开：${projectOpenErrorMessage(error)}`,
        );
        return;
      }
      setNewProjectDialogOpen(false);
      setNewProjectName('');
      setNewProjectParentDirectoryTouched(false);
      setNewProjectNameTouched(false);
      setNewProjectStatus('');
    } catch (error) {
      setNewProjectStatus(projectCreateErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openProductPreview = (): void => {
    productPreviewOpenerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setProductPreviewSurfaceActive(false);
    setProductPreviewOpen(true);
  };

  const startCandidateExport = async (candidate: {
    attemptId: string;
    snapshotId: string;
    projectRoot: string;
    projectId: string;
    openInstanceId: number;
    fileName: string;
    durationMs: number;
    cameraMode: 'static' | 'speaker-focus';
  }, reuseSnapshot = false): Promise<void> => {
    if (['starting', 'running', 'cancelling'].includes(exportTaskRef.current.status)) {
      return;
    }
    exportJobIdRef.current = null;
    setExportTaskState({
      status: 'starting',
      attemptId: candidate.attemptId,
      snapshotId: candidate.snapshotId,
      projectRoot: candidate.projectRoot,
      projectId: candidate.projectId,
      openInstanceId: candidate.openInstanceId,
      fileName: candidate.fileName,
      durationMs: candidate.durationMs,
      cameraMode: candidate.cameraMode,
      completedFrames: 0,
      totalFrames: 0,
      issues: [],
    });
    try {
      const response = await window.pandaStage.export.startFormal(
        candidate.snapshotId,
        reuseSnapshot,
      );
      exportJobIdRef.current = response.jobId;
      setExportTaskState({
        status: 'running',
        attemptId: candidate.attemptId,
        jobId: response.jobId,
        snapshotId: candidate.snapshotId,
        projectRoot: candidate.projectRoot,
        projectId: candidate.projectId,
        openInstanceId: candidate.openInstanceId,
        fileName: candidate.fileName,
        durationMs: candidate.durationMs,
        cameraMode: candidate.cameraMode,
        completedFrames: 0,
        totalFrames: 0,
        issues: [],
      });
      const latest = latestExportUpdatesRef.current.get(response.jobId);
      if (latest) {
        setExportTaskState(
          applyExportJobUpdate(exportTaskRef.current, latest),
        );
      }
    } catch (error) {
      setExportTaskState({
        status: 'failed',
        attemptId: candidate.attemptId,
        snapshotId: candidate.snapshotId,
        projectRoot: candidate.projectRoot,
        projectId: candidate.projectId,
        openInstanceId: candidate.openInstanceId,
        fileName: candidate.fileName,
        durationMs: candidate.durationMs,
        cameraMode: candidate.cameraMode,
        completedFrames: 0,
        totalFrames: 0,
        message: safeExportFailureMessage(error),
        issues: [],
      });
    }
  };

  const beginFormalExportFlow = async (): Promise<void> => {
    if (exportTaskIsActive(exportTaskRef.current)) {
      setExportSurfaceOpen(true);
      return;
    }
    const initial = editorProjectStore.getSnapshot();
    const initialInstanceId = editorProjectStore.getProjectInstanceId();
    if (!initial || initialInstanceId === null) return;

    const previousTask = exportTaskRef.current;
    exportJobIdRef.current = null;
    setExportSurfaceOpen(true);
    setExportTaskState({
      ...previousTask,
      status: 'selecting',
      projectRoot: initial.projectRoot,
      message: undefined,
      issues: [],
    });
    try {
      const selection = await window.pandaStage.exportPreparation.selectOutput({
        projectRoot: initial.projectRoot,
        projectId: initial.project.id,
        projectName: initial.project.name,
        openInstanceId: initialInstanceId,
      });
      if (selection.status === 'cancelled') {
        setExportTaskState(previousTask);
        exportJobIdRef.current = previousTask.jobId ?? null;
        setExportSurfaceOpen(previousTask.status !== 'idle');
        return;
      }
      if (selection.status === 'blocked') {
        setExportTaskState({
          ...previousTask,
          status: 'failed',
          projectRoot: initial.projectRoot,
          message: selection.issue.problem,
          issues: [selection.issue],
        });
        return;
      }

      const attemptId = crypto.randomUUID();
      const captured = editorProjectStore.getSnapshot();
      const capturedInstanceId = editorProjectStore.getProjectInstanceId();
      if (
        !captured ||
        capturedInstanceId !== initialInstanceId ||
        captured.projectRoot !== initial.projectRoot ||
        captured.project.id !== initial.project.id
      ) {
        await window.pandaStage.exportPreparation.discard({
          selectionId: selection.selectionId,
        });
        setExportTaskState({
          ...previousTask,
          status: 'failed',
          projectRoot: initial.projectRoot,
          completedFrames: 0,
          totalFrames: 0,
          message:
            '\u5f53\u524d\u9879\u76ee\u5df2\u53d8\u5316\u3002\u8bf7\u6253\u5f00\u76ee\u6807\u9879\u76ee\u540e\u91cd\u65b0\u5bfc\u51fa\u3002',
          issues: [],
        });
        return;
      }

      setExportTaskState({
        status: 'preparing',
        attemptId,
        projectRoot: captured.projectRoot,
        projectId: captured.project.id,
        openInstanceId: capturedInstanceId,
        fileName: selection.fileName,
        durationMs: projectDurationMs(captured.project),
        completedFrames: 0,
        totalFrames: 0,
        issues: [],
      });
      const cameraMode = autoCameraEnabled ? 'speaker-focus' : 'static';
      const result = await window.pandaStage.exportPreparation.prepare({
        selectionId: selection.selectionId,
        attemptId,
        projectRoot: captured.projectRoot,
        projectId: captured.project.id,
        openInstanceId: capturedInstanceId,
        revision: captured.revision,
        dirty: captured.dirty,
        cameraMode,
        project: structuredClone(captured.project),
      });

      if (result.status === 'CANCELLED') {
        setExportTaskState({
          status: 'cancelled',
          attemptId,
          projectRoot: captured.projectRoot,
          projectId: captured.project.id,
          openInstanceId: capturedInstanceId,
          fileName: selection.fileName,
          durationMs: projectDurationMs(captured.project),
          completedFrames: 0,
          totalFrames: 0,
          message: '\u5bfc\u51fa\u51c6\u5907\u5df2\u53d6\u6d88\u3002',
          issues: [],
        });
        return;
      }
      if (result.status === 'BLOCK') {
        setExportTaskState({
          status: 'failed',
          attemptId,
          projectRoot: captured.projectRoot,
          projectId: captured.project.id,
          openInstanceId: capturedInstanceId,
          fileName: selection.fileName,
          durationMs: projectDurationMs(captured.project),
          completedFrames: 0,
          totalFrames: 0,
          issues: result.issues,
        });
        return;
      }

      const current = editorProjectStore.getSnapshot();
      if (
        editorProjectStore.getProjectInstanceId() !== initialInstanceId ||
        !current ||
        current.projectRoot !== initial.projectRoot ||
        current.project.id !== initial.project.id
      ) {
        await window.pandaStage.exportPreparation.discard({
          snapshotId: result.candidate.snapshotId,
        });
        setExportTaskState({
          status: 'failed',
          attemptId,
          projectRoot: captured.projectRoot,
          projectId: captured.project.id,
          openInstanceId: capturedInstanceId,
          fileName: selection.fileName,
          durationMs: projectDurationMs(captured.project),
          completedFrames: 0,
          totalFrames: 0,
          message:
            '\u5f53\u524d\u9879\u76ee\u5df2\u53d8\u5316\u3002\u8bf7\u6253\u5f00\u76ee\u6807\u9879\u76ee\u540e\u91cd\u65b0\u5bfc\u51fa\u3002',
          issues: [],
        });
        return;
      }
      await startCandidateExport(
        {
          attemptId: result.candidate.attemptId,
          snapshotId: result.candidate.snapshotId,
          projectRoot: result.candidate.projectRoot,
          projectId: result.candidate.projectId,
          openInstanceId: result.candidate.openInstanceId,
          fileName: result.candidate.outputIntent.fileName,
          durationMs: projectDurationMs(result.candidate.project),
          cameraMode: result.candidate.cameraMode,
        },
        false,
      );
    } catch (error) {
      const currentTask = exportTaskRef.current;
      setExportTaskState({
        ...currentTask,
        status: 'failed',
        message: safeExportFailureMessage(error),
        issues: [],
      });
    }
  };

  const onExportVideo = (): void => {
    if (shouldRestoreExportTask(exportTaskRef.current)) {
      setExportSurfaceOpen(true);
      return;
    }
    void beginFormalExportFlow();
  };

  const cancelExportTask = async (): Promise<void> => {
    const task = exportTaskRef.current;
    if (task.status === 'preparing' && task.attemptId) {
      const response = await window.pandaStage.exportPreparation.cancel(
        task.attemptId,
      );
      if (response.accepted) {
        const current = exportTaskRef.current;
        if (
          current.attemptId === task.attemptId &&
          !['completed', 'failed', 'cancelled'].includes(current.status)
        ) {
          setExportTaskState({
            ...current,
            status: 'cancelling',
            message: undefined,
          });
        }
      }
      return;
    }
    if (!task.jobId || (task.status !== 'running' && task.status !== 'cancelling')) {
      return;
    }
    const response = await window.pandaStage.export.cancel(task.jobId);
    const current = exportTaskRef.current;
    if (
      current.jobId !== task.jobId ||
      ['completed', 'failed', 'cancelled'].includes(current.status)
    ) {
      return;
    }
    if (response.accepted) {
      setExportTaskState({ ...current, status: 'cancelling', message: undefined });
    } else if (current.phase === 'committing') {
      setExportTaskState({
        ...current,
        message:
          '\u89c6\u9891\u6b63\u5728\u4fdd\u5b58\uff0c\u6b64\u523b\u65e0\u6cd5\u53d6\u6d88\uff0c\u8bf7\u7a0d\u5019\u3002',
      });
    }
  };

  const retrySameExportSnapshot = async (): Promise<void> => {
    const task = exportTaskRef.current;
    if (
      exportTaskIsActive(task) ||
      !task.snapshotId ||
      !task.projectRoot ||
      !task.projectId ||
      !task.openInstanceId ||
      !task.attemptId
    ) {
      return;
    }
    const current = editorProjectStore.getSnapshot();
    const currentInstanceId = editorProjectStore.getProjectInstanceId();
    if (
      !current ||
      current.projectRoot !== task.projectRoot ||
      current.project.id !== task.projectId ||
      currentInstanceId !== task.openInstanceId
    ) {
      setExportTaskState({
        ...task,
        status: 'failed',
        message: safeExportFailureMessage('PROJECT_SESSION_CHANGED'),
      });
      return;
    }

    exportJobIdRef.current = null;
    setExportTaskState({ ...task, status: 'selecting', message: undefined, issues: [] });
    setExportSurfaceOpen(true);
    try {
      const retryStatus =
        await window.pandaStage.exportPreparation.getSnapshotRetryStatus(
          task.snapshotId,
        );
      if (!retryStatus.available) {
        setExportTaskState({
          ...task,
          status: 'failed',
          snapshotRetryAvailable: false,
          message: safeExportFailureMessage('EXPORT_SNAPSHOT_UNAVAILABLE'),
        });
        return;
      }
      const selection = await window.pandaStage.exportPreparation.selectOutput({
        projectRoot: task.projectRoot,
        projectId: task.projectId,
        projectName: current.project.name,
        openInstanceId: task.openInstanceId,
        snapshotId: task.snapshotId,
      });
      if (selection.status === 'cancelled') {
        setExportTaskState(task);
        exportJobIdRef.current = task.jobId ?? null;
        return;
      }
      if (selection.status === 'blocked') {
        setExportTaskState({
          ...task,
          status: 'failed',
          message: selection.issue.problem,
          snapshotRetryAvailable:
            selection.issue.code === 'PREPARATION_FAILED'
              ? false
              : task.snapshotRetryAvailable,
          issues: [selection.issue],
        });
        return;
      }

      setExportTaskState({
        ...task,
        status: 'failed',
        fileName: selection.fileName,
        message: undefined,
        issues: [],
      });
      await startCandidateExport(
        {
          attemptId: task.attemptId,
          snapshotId: task.snapshotId,
          projectRoot: task.projectRoot,
          projectId: task.projectId,
          openInstanceId: task.openInstanceId,
          fileName: selection.fileName,
          durationMs: task.durationMs ?? projectDurationMs(current.project),
          cameraMode: task.cameraMode ?? 'static',
        },
        true,
      );
    } catch (error) {
      setExportTaskState({
        ...task,
        status: 'failed',
        message: safeExportFailureMessage(error),
      });
    }
  };

  const retryCurrentExportContent = (): void => {
    if (!exportTaskIsActive(exportTaskRef.current)) {
      void beginFormalExportFlow();
    }
  };

  const revealExportOutput = async (): Promise<void> => {
    const jobId = exportTaskRef.current.jobId;
    if (!jobId) return;
    try {
      const response = await window.pandaStage.export.revealOutput(jobId);
      if (!response.opened) {
        const current = exportTaskRef.current;
        setExportTaskState({
          ...current,
          message:
            '\u65e0\u6cd5\u663e\u793a\u89c6\u9891\u6587\u4ef6\u3002\u8bf7\u9009\u62e9\u5176\u4ed6\u4f4d\u7f6e\u540e\u91cd\u65b0\u5bfc\u51fa\u3002',
        });
      }
    } catch (error) {
      const current = exportTaskRef.current;
      setExportTaskState({
        ...current,
        message: safeExportFailureMessage(error),
      });
    }
  };

  const openProjectFolder = async (): Promise<void> => {
    if (!projectSnapshot) return;
    setBusy(true);
    try {
      const response = await window.pandaStage.project.openFolder(
        projectSnapshot.projectRoot,
      );
      setStatus(
        response.ok
          ? '已打开项目文件夹。'
          : `无法打开项目文件夹：${response.error}`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `无法打开项目文件夹：${error.message}`
          : '无法打开项目文件夹，请稍后重试。',
      );
    } finally {
      setBusy(false);
    }
  };

  const closeProductPreview = (): void => {
    setProductPreviewSurfaceActive(false);
    setProductPreviewOpen(false);
    window.requestAnimationFrame(() => {
      productPreviewOpenerRef.current?.focus({ preventScroll: true });
      productPreviewOpenerRef.current = null;
    });
  };

  const requestCloseProject = (): void => {
    if (blockSessionChangeDuringExport()) return;
    if (!projectSnapshot) return;
    if (
      closeProjectRequestAction(projectSnapshot.dirty) ===
      'show-dirty-confirmation'
    ) {
      setCloseConfirmStatus(CLOSE_PROJECT_DIRTY_PROMPT);
      setCloseConfirmOpen(true);
      return;
    }
    void closeProject('close-without-saving');
  };

  const cancelCloseProject = (): void => {
    setCloseConfirmOpen(false);
    setCloseConfirmStatus('');
    setStatus('已取消关闭，当前项目保持打开。');
  };

  /**
   * Runs the actual close after the user's branch decision.
   *
   * `session.closeProject()` only stops autosave tracking, so an unsaved close
   * keeps the recovery file on disk (ruling ④). Any failure leaves the project
   * open and reports the reason inside the dialog.
   */
  const finishCloseProject = async (
    choice: Exclude<CloseProjectChoice, 'cancel'>,
    dirtyBeforeClose: boolean,
  ): Promise<void> => {
    if (blockSessionChangeDuringExport()) return;
    const nextSession = await session.closeProject();
    await clearExportTask();
    setSessionSnapshot(nextSession);
    setProductPreviewOpen(false);
    setProductPreviewSurfaceActive(false);
    setAutoCameraEnabled(false);
    setCloseConfirmOpen(false);
    setCloseConfirmStatus('');
    setOpenCandidatePath('');
    setSaveActivity({ phase: 'idle', revision: null });
    setRecentRefreshToken((current) => current + 1);
    setRequestedPage('project-center');
    setStatus(closeProjectStatusMessage(choice, dirtyBeforeClose));
  };

  const closeProject = async (
    choice: CloseProjectChoice,
  ): Promise<void> => {
    if (choice !== 'cancel' && blockSessionChangeDuringExport()) return;
    if (choice === 'cancel') {
      cancelCloseProject();
      return;
    }
    if (!projectSnapshot) return;
    const dirtyBeforeClose = projectSnapshot.dirty;
    setBusy(true);
    try {
      if (choice === 'save-and-close' && dirtyBeforeClose) {
        const result = await session.saveCurrentProject();
        if (!result.ok) {
          setSaveActivity({
            phase: 'failed',
            revision: result.savedRevision,
          });
          setCloseConfirmStatus(
            closeProjectSaveFailureMessage(result.error.message),
          );
          return;
        }
        if (result.acknowledgement === 'stale') {
          setSaveActivity({ phase: 'idle', revision: null });
          setCloseConfirmStatus(CLOSE_PROJECT_STALE_SAVE_MESSAGE);
          return;
        }
        setSaveActivity({ phase: 'idle', revision: null });
      }
      await finishCloseProject(choice, dirtyBeforeClose);
    } catch (error) {
      const message = closeProjectErrorMessage(error);
      if (dirtyBeforeClose) {
        setCloseConfirmStatus(message);
      } else {
        setStatus(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const restoreRecovery = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await session.restoreRecovery();
      if (!response.ok) throw new Error(response.error.message);
      setSessionSnapshot(session.getSnapshot());
      setStatus(
        '恢复内容已载入内存，项目有未保存的更改。请点击“保存整个项目”写入 project.json。',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '恢复失败。');
    } finally {
      setBusy(false);
    }
  };

  const ignoreRecovery = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await session.ignoreRecovery();
      if (response.ok) {
        setSessionSnapshot(session.getSnapshot());
        setStatus(
          '已忽略本次恢复内容，恢复文件仍保留。',
        );
      } else {
        setStatus(response.error.message);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '忽略恢复内容失败。');
    } finally {
      setBusy(false);
    }
  };

  const saveProject = async (): Promise<void> => {
    if (!projectSnapshot?.dirty) return;
    const saveRevision = projectSnapshot.revision;
    setSaveActivity({ phase: 'saving', revision: saveRevision });
    setBusy(true);
    try {
      const result = await session.saveCurrentProject();
      if (!result.ok) {
        setSaveActivity({
          phase: 'failed',
          revision: result.savedRevision,
        });
        setStatus(result.error.message);
      } else if (result.acknowledgement === 'stale') {
        setSaveActivity({ phase: 'idle', revision: null });
        setStatus(
          `已保存修订 ${result.savedRevision}，但编辑器中仍有更新的未保存更改。`,
        );
      } else {
        setSaveActivity({ phase: 'idle', revision: null });
        setStatus(
          '项目已保存。',
        );
      }
    } catch (error) {
      setSaveActivity({ phase: 'failed', revision: saveRevision });
      setStatus(error instanceof Error ? error.message : '保存项目失败。');
    } finally {
      setBusy(false);
    }
  };

  const selectPortraitWorkspace = (workspace: EditorWorkspace): void => {
    setPortraitWorkspace(workspace);
    setPortraitCanvasSurface(workspace === 'canvas' ? 'shots' : 'none');
    if (workspace === 'assets') {
      setPortraitResourceActivity('assets');
    } else if (workspace === 'canvas') {
      setPortraitResourceActivity('shots');
    }
  };

  const closePortraitCanvasSurface = (): void => {
    setPortraitCanvasSurface('none');
  };

  const handlePortraitResourceActivityChange = (
    activity: ResourceActivity,
  ): void => {
    if (!isPortrait) return;
    setPortraitResourceActivity(activity);
    if (activity === 'assets') {
      setPortraitWorkspace('assets');
      setPortraitCanvasSurface('none');
    } else {
      setPortraitWorkspace('canvas');
      setPortraitCanvasSurface('shots');
    }
  };

  const portraitCanvasVisible =
    !isPortrait ||
    portraitWorkspace === 'canvas' ||
    portraitWorkspace === 'properties' ||
    portraitWorkspace === 'timeline';
  const portraitResourcesVisible =
    !isPortrait ||
    portraitWorkspace === 'assets' ||
    (portraitWorkspace === 'canvas' && portraitCanvasSurface === 'shots');
  const portraitResourcesSlotVisible =
    (portraitResourcesVisible &&
      !(isPortrait && assemblyHidesResourceDrawer)) ||
    (isPortrait && legacyCompositeAssemblyActive);
  const portraitPropertiesVisible =
    !isPortrait ||
    portraitWorkspace === 'properties';
  const portraitContextSurface =
    isPortrait && portraitWorkspace === 'canvas'
      ? portraitCanvasSurface
      : isPortrait && portraitWorkspace === 'properties'
        ? 'properties'
        : isPortrait && portraitWorkspace === 'timeline'
          ? 'timeline'
        : 'none';
  // Keep the CanvasStage mounted as the sole Canvas owner, but expose its
  // existing toolbar only for the active portrait Canvas workspace.
  const canvasToolbarVisible =
    !isPortrait || portraitWorkspace === 'canvas';

  return (
    <main
      className="app-shell editor-shell"
      data-debug={debug ? 'enabled' : 'disabled'}
      data-editor-device-mode={deviceMode}
      data-editor-shell-layout={layoutMode}
      data-editor-shell-state={shellState}
      data-editor-shell-region={sessionRegion}
      data-editor-page={page}
      data-character-assembly-active={assemblyActive ? 'true' : 'false'}
      data-character-assembly-kind={assemblyKind}
      data-gate-a={gateA ? 'enabled' : 'disabled'}
    >
      {!renderProductSurface ? null : page === 'project-center' ? (
        <ProjectCenterScreen
          busy={busy}
          currentProject={projectSnapshot}
          newProjectDialogOpen={newProjectDialogOpen}
          onChooseProjectDirectory={chooseProjectDirectory}
          onOpenProjectFromChooser={openProjectFromChooser}
          onOpenProject={openProject}
          onOpenRecentProject={switchToRecentProject}
          onOpenCandidatePathChange={setOpenCandidatePath}
          onRequestNewProject={requestNewProject}
          onReturnToEditor={returnToEditor}
          openCandidatePath={openCandidatePath}
          recentRefreshToken={recentRefreshToken}
          recoveryBanner={
            recoveryCandidate && projectSnapshot ? (
              <RecoveryCandidateBanner
                busy={busy}
                candidate={recoveryCandidate}
                onIgnore={ignoreRecovery}
                onRestore={restoreRecovery}
              />
            ) : null
          }
          status={status}
        />
      ) : projectSnapshot ? (
        <div
          className="editor-layout"
          data-active-workspace={portraitWorkspace}
          data-preview-surface-active={productPreviewSurfaceActive ? 'true' : 'false'}
          data-shell-mode={layoutMode}
          data-top-region-layout={isPortrait ? 'flow' : 'overlay'}
          data-testid="editor-layout"
        >
          <div
            className="editor-top-region"
            inert={productPreviewOpen || undefined}
            data-testid="editor-top-region"
          >
            {recoveryCandidate ? (
              <RecoveryCandidateBanner
                busy={busy}
                candidate={recoveryCandidate}
                onIgnore={ignoreRecovery}
                onRestore={restoreRecovery}
              />
            ) : null}
            {isPortrait ? (
              <AdaptiveWorkspaceSwitcher
                onChange={selectPortraitWorkspace}
                value={portraitWorkspace}
              />
            ) : null}
            <ExportTaskSurface
              onCancel={() => void cancelExportTask()}
              onRetryCurrentContent={retryCurrentExportContent}
              onStartNewExport={retryCurrentExportContent}
              onHide={() => setExportSurfaceOpen(false)}
              onRetrySameSnapshot={() => void retrySameExportSnapshot()}
              onRevealOutput={() => void revealExportOutput()}
              open={exportSurfaceOpen}
              task={exportTask}
            />
          </div>
          <PendingDialoguePlacementProvider>
            <div
              className="editor-body"
              inert={productPreviewOpen || undefined}
              data-active-workspace={isPortrait ? portraitWorkspace : 'canvas'}
              data-portrait-surface={portraitContextSurface}
              data-shell-mode={layoutMode}
              data-testid="editor-body"
            >
              <CompactProjectBar
                busy={busy}
                closeConfirmOpen={closeConfirmOpen}
                exportBusy={exportTaskIsActive(exportTask)}
                exportSurfaceOpen={exportSurfaceOpen}
                key={`quick-action-drawer:${projectSnapshot.projectRoot}`}
                onExportVideo={onExportVideo}
                onOpenProductPreview={openProductPreview}
                onOpenProjectCenter={openProjectCenter}
                onOpenProjectFolder={openProjectFolder}
                onRequestCloseProject={requestCloseProject}
                onSaveProject={saveProject}
                productPreviewOpen={productPreviewOpen}
                projectSnapshot={projectSnapshot}
                saveState={saveState}
                status={status}
                presentation={layoutMode}
              />
            <div
              aria-hidden={!portraitResourcesSlotVisible}
              className="editor-workspace-slot editor-workspace-slot-resources"
              data-active={portraitResourcesSlotVisible}
              data-workspace-owner="resources"
              hidden={!portraitResourcesSlotVisible}
            >
              <LeftWorkspace
                activeActivity={
                  isPortrait
                    ? assemblyActive
                      ? 'characters'
                      : portraitResourceActivity
                    : undefined
                }
                drawerOpen={
                  assemblyActive || (isPortrait && portraitResourcesVisible)
                    ? true
                    : undefined
                }
                onDrawerOpenChange={(open) => {
                  if (!isPortrait || open) return;
                  if (portraitWorkspace === 'assets') {
                    setPortraitWorkspace('canvas');
                    setPortraitResourceActivity('shots');
                  } else {
                    closePortraitCanvasSurface();
                  }
                }}
                onActiveActivityChange={handlePortraitResourceActivityChange}
                onOpenRecentProject={switchToRecentProject}
                projectSnapshot={projectSnapshot}
                recentRefreshToken={recentRefreshToken}
                shellMode={layoutMode}
              />
            </div>
            <div
              aria-hidden={!portraitCanvasVisible && !assemblyActive}
              className="editor-workspace-slot editor-workspace-slot-canvas"
              data-active={portraitCanvasVisible || assemblyActive}
              data-workspace-owner="canvas"
              data-character-assembly-active={assemblyActive ? 'true' : 'false'}
              hidden={!portraitCanvasVisible && !assemblyActive}
            >
              <div
                aria-hidden={assemblyActive || !portraitCanvasVisible}
                className="character-assembly-canvas-owner"
                data-character-assembly-inactive={assemblyActive ? 'true' : 'false'}
                hidden={!portraitCanvasVisible && !assemblyActive}
                inert={assemblyActive || undefined}
              >
                <CanvasWorkspace
                  showHeading={false}
                  showToolbar={canvasToolbarVisible}
                />
              </div>
              {activeAssemblySession && projectSnapshot ? (
                <CharacterAssemblyWorkbench
                  projectSnapshot={projectSnapshot}
                  savedProjectSnapshot={editorProjectStore.getSavedProjectSnapshot()}
                  session={activeAssemblySession}
                />
              ) : null}
            </div>
            <div
              aria-hidden={!portraitPropertiesVisible || assemblyActive}
              className={`editor-workspace-slot editor-workspace-slot-properties${assemblyActive ? ' is-character-assembly-inactive' : ''}`}
              data-active={portraitPropertiesVisible || assemblyActive}
              data-workspace-owner="properties"
              data-character-assembly-inactive={assemblyActive ? 'true' : 'false'}
              hidden={!portraitPropertiesVisible || (isPortrait && assemblyActive)}
              inert={assemblyActive || undefined}
            >
              {isPortrait ? (
                <RightInspector
                compact={isPortrait ? portraitPropertiesVisible : undefined}
                dialogueSelectionVisible={
                  !isPortrait || portraitWorkspace !== 'timeline'
                }
                drawerOpen={
                  isPortrait && portraitPropertiesVisible ? true : undefined
                }
                onDrawerOpenChange={(open) => {
                  if (!isPortrait || open) return;
                  if (portraitWorkspace === 'properties') {
                    setPortraitWorkspace('canvas');
                  } else {
                    closePortraitCanvasSurface();
                  }
                }}
                shellMode={layoutMode}
                />
              ) : (
                <RightWorkspace
                  autoCameraEnabled={autoCameraEnabled}
                  key={`right-workspace:${projectSnapshot.projectRoot}`}
                  onAutoCameraChange={setAutoCameraEnabled}
                />
              )}
            </div>
            {/* 右侧检查器由 RightInspector 作为唯一属性所有者渲染。 */}
            </div>
            <BottomWorkspace
              productPreviewOpen={productPreviewOpen}
              hidden={
                isPortrait && portraitWorkspace !== 'timeline' && !assemblyActive
              }
              assemblyInactive={assemblyActive}
              presentation={layoutMode}
              resizable={layoutMode === 'landscape'}
              showHistoryControls={false}
            />
          </PendingDialoguePlacementProvider>
          {productPreviewOpen ? (
            <ProductPreviewOverlay
              autoPlay
              autoCameraEnabled={autoCameraEnabled}
              onAutoCameraChange={setAutoCameraEnabled}
              onClose={closeProductPreview}
              onHandoffReady={commitProductPreviewSurface}
              project={projectSnapshot.project}
              projectRoot={projectSnapshot.projectRoot}
              shotId={currentShotId}
              surfaceActive={productPreviewSurfaceActive}
            />
          ) : null}
          {closeConfirmOpen ? (
            <CloseConfirmDialog
              busy={busy}
              dirty={projectSnapshot.dirty}
              onChoose={(choice) => void closeProject(choice)}
              projectName={projectSnapshot.project.name}
              status={closeConfirmStatus}
            />
          ) : null}
        </div>
      ) : null}
      {renderProductSurface &&
        page === 'project-center' &&
        newProjectDialogOpen ? (
        <NewProjectDialog
          busy={busy}
          onCancel={cancelNewProject}
          onChooseParentDirectory={chooseNewProjectParentDirectory}
          onCreateProject={createProject}
          onParentDirectoryBlur={() =>
            setNewProjectParentDirectoryTouched(true)
          }
          onParentDirectoryChange={(value) => {
            setNewProjectParentDirectoryTouched(true);
            setNewProjectParentDirectory(value);
          }}
          onProjectNameBlur={() => setNewProjectNameTouched(true)}
          onProjectNameChange={(value) => {
            setNewProjectNameTouched(true);
            setNewProjectName(value);
          }}
          parentDirectory={newProjectParentDirectory}
          parentDirectoryTouched={newProjectParentDirectoryTouched}
          projectName={newProjectName}
          projectNameTouched={newProjectNameTouched}
          status={newProjectStatus}
        />
      ) : null}
      {gateA ? (
        <div
          className="gate-preview-overlay"
          data-testid="gate-preview-overlay"
        >
          {gatePreview}
        </div>
      ) : null}
      {debug ? (
        <aside className="debug-probe-surface" data-testid="debug-probes">
          {debugSurface}
        </aside>
      ) : null}
    </main>
  );
}
