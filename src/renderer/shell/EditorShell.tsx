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
import { EditorTopBar } from './EditorTopBar';
import { LegacyWorkspace } from './LegacyWorkspace';
import { RecoveryCandidateBanner } from './RecoveryCandidateBanner';
import { StartScreen } from './StartScreen';
import { useDebugFlag } from './useDebugFlag';
import {
  projectOpenErrorMessage,
  validateProjectOpenCandidate,
} from './projectOpenFlow';

export type EditorShellState = 'no-project' | 'editor';
export type EditorShellSessionRegion =
  | 'start-screen'
  | 'editor-layout';

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
  clearRecoveryCandidate(): ProjectSessionSnapshot;
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
    this.controllerDisposePromise ??= this.controller.dispose();
    await this.controllerDisposePromise;
  }

  async syncAutosave(
    snapshot: EditorProjectSnapshot | null,
  ): Promise<RecoveryAcknowledgeResponse | null> {
    if (
      !snapshot ||
      snapshot === this.lastAutosaveSnapshot ||
      snapshot.projectRoot !== this.getSnapshot().trackedProjectRoot
    ) {
      return null;
    }
    this.lastAutosaveSnapshot = snapshot;
    return this.autosaveApi.update(snapshot);
  }

  switchProject(projectRoot: string): Promise<ProjectSessionSnapshot> {
    return this.controller.switchProject(projectRoot);
  }

  switchRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<ProjectSessionSnapshot> {
    return this.controller.switchRecentProject(
      projectRoot,
      expectedProjectId,
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
    if (response.ok) this.controller.clearRecoveryCandidate();
    return response;
  }

  saveCurrentProject(): Promise<EditorProjectSaveResult> {
    return saveCurrentProject(this.projectSaveApi, this.store);
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
  const shellState = getEditorShellState(projectSnapshot);
  const sessionRegion = getEditorShellSessionRegion(shellState);
  const recoveryCandidate = getEditorShellRecoveryCandidate(
    shellState,
    sessionSnapshot,
  );
  const { debug, gateA } = useDebugFlag();

  useEffect(() => {
    session.activateAutosaveErrors((error) => setStatus(error.message));
    return () => {
      session.deactivateAutosaveErrors();
      void session.scheduleControllerDisposal();
    };
  }, [session]);

  useEffect(() => {
    void session.syncAutosave(projectSnapshot).then((response) => {
      if (response && !response.ok) setStatus(response.error.message);
    });
  }, [projectSnapshot, session]);

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

  const switchToProject = async (projectRoot: string): Promise<void> => {
    const nextSession = await session.switchProject(projectRoot);
    updateSession(
      nextSession,
      '项目已打开，暂无未保存更改。',
    );
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
    } catch (error) {
      throw new Error(projectOpenErrorMessage(error), { cause: error });
    }
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
    setBusy(true);
    try {
      const result = await session.saveCurrentProject();
      if (!result.ok) {
        setStatus(result.error.message);
      } else if (result.acknowledgement === 'stale') {
        setStatus(
          `已保存修订 ${result.savedRevision}，但编辑器中仍有更新的未保存更改。`,
        );
      } else {
        setStatus(
          '项目已保存。',
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存项目失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className="app-shell editor-shell"
      data-debug={debug ? 'enabled' : 'disabled'}
      data-editor-shell-state={shellState}
      data-gate-a={gateA ? 'enabled' : 'disabled'}
    >
      {sessionRegion === 'start-screen' ? (
        <div className="start-screen" data-testid="start-screen">
          <StartScreen
            busy={busy}
            onChooseProjectDirectory={chooseProjectDirectory}
            onOpenProject={openProject}
            onOpenRecentProject={switchToRecentProject}
            onOpenCandidatePathChange={setOpenCandidatePath}
            openCandidatePath={openCandidatePath}
            recentRefreshToken={recentRefreshToken}
            status={status}
          />
        </div>
      ) : projectSnapshot ? (
        <div className="editor-layout" data-testid="editor-layout">
          <EditorTopBar
            busy={busy}
            onChooseProjectDirectory={chooseProjectDirectory}
            onOpenProject={openProject}
            onOpenCandidatePathChange={setOpenCandidatePath}
            onSaveProject={saveProject}
            openCandidatePath={openCandidatePath}
            projectSnapshot={projectSnapshot}
            recoveryBanner={
              recoveryCandidate ? (
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
          <div className="editor-body" data-testid="editor-body">
            <aside
              className="workspace-placeholder left-workspace-placeholder"
              data-testid="left-workspace-placeholder"
            >
              <strong>左侧工作区</strong>
              <span>镜头、素材与角色将在后续阶段迁入</span>
            </aside>
            <LegacyWorkspace
              key={projectSnapshot.projectRoot}
              onOpenRecentProject={switchToRecentProject}
              projectSnapshot={projectSnapshot}
              recentRefreshToken={recentRefreshToken}
            />
            <aside
              className="workspace-placeholder right-inspector-placeholder"
              data-testid="right-inspector-placeholder"
            >
              <strong>右侧检查器</strong>
              <span>图层属性与动作预设将在后续阶段迁入</span>
            </aside>
          </div>
          <footer
            className="workspace-placeholder bottom-workspace-placeholder"
            data-testid="bottom-workspace-placeholder"
          >
            <strong>底部工作区</strong>
            <span>编辑历史正式迁移与时间轴将在后续阶段进行</span>
          </footer>
        </div>
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
