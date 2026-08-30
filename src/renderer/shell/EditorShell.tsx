import {
  useEffect,
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
import { CloseConfirmDialog } from './CloseConfirmDialog';
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
    const update = this.autosaveUpdateQueue.then(() =>
      this.autosaveApi.update(snapshot),
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
    return this.runControllerTransition(() =>
      this.controller.switchProject(projectRoot),
    );
  }

  async switchRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<ProjectSessionSnapshot> {
    await this.flushAutosave();
    return this.runControllerTransition(() =>
      this.controller.switchRecentProject(
        projectRoot,
        expectedProjectId,
      ),
    );
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
  const [status, setStatus] = useState(
    '请选择一个 .pandastage 项目文件夹。',
  );
  const [busy, setBusy] = useState(false);
  const [recentRefreshToken, setRecentRefreshToken] = useState(0);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [newProjectParentDirectory, setNewProjectParentDirectory] =
    useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectStatus, setNewProjectStatus] = useState(
    '请选择存放文件夹并填写项目名称。',
  );
  const [productPreviewOpen, setProductPreviewOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeConfirmStatus, setCloseConfirmStatus] = useState('');
  const [saveActivity, setSaveActivity] = useState<{
    phase: 'idle' | 'saving' | 'failed';
    revision: number | null;
  }>({ phase: 'idle', revision: null });
  const [requestedPage, setRequestedPage] =
    useState<EditorShellPage>('project-center');
  // This is presentation/session state only. It never enters Project,
  // History, autosave, or any cross-process contract.
  const [deviceMode, setDeviceMode] = useState<EditorDeviceMode>('auto');
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
    setStatus(
      nextSession.recoveryCandidate
        ? '检测到未保存的恢复内容，请选择恢复或忽略。'
        : cleanStatus,
    );
  };

  const switchToProject = async (
    projectRoot: string,
    cleanStatus = '项目已打开，暂无未保存更改。',
  ): Promise<void> => {
    const nextSession = await session.switchProject(projectRoot);
    // The preview belongs to the project that was open when it was requested.
    setProductPreviewOpen(false);
    setSaveActivity({ phase: 'idle', revision: null });
    updateSession(nextSession, cleanStatus);
    setRequestedPage('editor');
  };

  const switchToRecentProject = async (
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void> => {
    try {
      const nextSession = await session.switchRecentProject(
        projectRoot,
        expectedProjectId,
      );
      updateSession(
        nextSession,
        '已从最近项目打开，暂无未保存更改。',
      );
      setSaveActivity({ phase: 'idle', revision: null });
      setRequestedPage('editor');
    } catch (error) {
      throw new Error(projectOpenErrorMessage(error), { cause: error });
    }
  };

  const openProjectCenter = (): void => {
    setProductPreviewOpen(false);
    setRequestedPage('project-center');
    setStatus(
      projectSnapshot
        ? '项目中心已打开，当前项目与编辑状态保持不变。'
        : '请选择一个 .pandastage 项目文件夹。',
    );
  };

  const returnToEditor = (): void => {
    if (!projectSnapshot) return;
    setRequestedPage('editor');
    setStatus('已返回编辑器，当前镜头与编辑状态保持不变。');
  };

  const openProject = async (): Promise<void> => {
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

  const chooseProjectDirectory = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await window.pandaStage.project.chooseDirectory();
      if (response.status === 'cancelled') {
        setStatus('已取消选择，当前项目与待打开路径保持不变。');
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
    setNewProjectStatus('请选择存放文件夹并填写项目名称。');
    setNewProjectDialogOpen(true);
  };

  const cancelNewProject = (): void => {
    setNewProjectDialogOpen(false);
    setNewProjectStatus('已取消新建项目。');
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
    const parentDirectory = newProjectParentDirectory.trim();
    const projectName = newProjectName.trim();
    const validation = validateNewProjectInput(parentDirectory, projectName);
    if (!validation.valid) {
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
      setNewProjectStatus('请选择存放文件夹并填写项目名称。');
    } catch (error) {
      setNewProjectStatus(projectCreateErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openProductPreview = (): void => {
    setProductPreviewOpen(true);
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
    setProductPreviewOpen(false);
  };

  const requestCloseProject = (): void => {
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
    const nextSession = await session.closeProject();
    setSessionSnapshot(nextSession);
    setProductPreviewOpen(false);
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
      data-gate-a={gateA ? 'enabled' : 'disabled'}
    >
      {!renderProductSurface ? null : page === 'project-center' ? (
        <ProjectCenterScreen
          busy={busy}
          currentProject={projectSnapshot}
          newProjectDialogOpen={newProjectDialogOpen}
          onChooseProjectDirectory={chooseProjectDirectory}
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
          data-shell-mode={layoutMode}
          data-testid="editor-layout"
        >
          <div className="editor-top-region" data-testid="editor-top-region">
            <CompactProjectBar
              busy={busy}
              closeConfirmOpen={closeConfirmOpen}
              onOpenProductPreview={openProductPreview}
              onOpenProjectCenter={openProjectCenter}
              onOpenProjectFolder={openProjectFolder}
              onRequestCloseProject={requestCloseProject}
              onSaveProject={saveProject}
              onDeviceModeChange={setDeviceMode}
              productPreviewOpen={productPreviewOpen}
              projectSnapshot={projectSnapshot}
              saveState={saveState}
              status={status}
              deviceMode={deviceMode}
              presentation={layoutMode}
            />
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
          </div>
          <div
            className="editor-body"
            data-active-workspace={isPortrait ? portraitWorkspace : 'canvas'}
            data-portrait-surface={portraitContextSurface}
            data-shell-mode={layoutMode}
            data-testid="editor-body"
          >
            <div
              aria-hidden={!portraitResourcesVisible}
              className="editor-workspace-slot editor-workspace-slot-resources"
              data-active={portraitResourcesVisible}
              data-workspace-owner="resources"
              hidden={!portraitResourcesVisible}
            >
              <LeftWorkspace
                activeActivity={
                  isPortrait ? portraitResourceActivity : undefined
                }
                drawerOpen={
                  isPortrait && portraitResourcesVisible ? true : undefined
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
              aria-hidden={!portraitCanvasVisible}
              className="editor-workspace-slot editor-workspace-slot-canvas"
              data-active={portraitCanvasVisible}
              data-workspace-owner="canvas"
              hidden={!portraitCanvasVisible}
            >
              <CanvasWorkspace
                showHeading={false}
                showToolbar={canvasToolbarVisible}
              />
            </div>
            <div
              aria-hidden={!portraitPropertiesVisible}
              className="editor-workspace-slot editor-workspace-slot-properties"
              data-active={portraitPropertiesVisible}
              data-workspace-owner="properties"
              hidden={!portraitPropertiesVisible}
            >
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
            </div>
            {/* 右侧检查器由 RightInspector 作为唯一属性所有者渲染。 */}
          </div>
          <BottomWorkspace
            hidden={isPortrait && portraitWorkspace !== 'timeline'}
            presentation={layoutMode}
            resizable={deviceMode === 'cloud-touch' && layoutMode === 'landscape'}
            showHistoryControls={false}
          />
          {productPreviewOpen ? (
            <ProductPreviewOverlay
              onClose={closeProductPreview}
              project={projectSnapshot.project}
              projectRoot={projectSnapshot.projectRoot}
              shotId={currentShotId}
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
          onParentDirectoryChange={setNewProjectParentDirectory}
          onProjectNameChange={setNewProjectName}
          parentDirectory={newProjectParentDirectory}
          projectName={newProjectName}
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
