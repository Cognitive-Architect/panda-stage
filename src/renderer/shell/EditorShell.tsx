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
import { AssetLibrary } from '../features/assets/AssetLibrary';
import { CanvasStage } from '../features/canvas/CanvasStage';
import { CharacterManager } from '../features/characters/CharacterManager';
import { ProjectRecoveryPanel } from '../features/recovery/ProjectRecoveryPanel';
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
import { ShotManager } from '../features/shots/ShotManager';
import {
  EditorProjectStore,
  editorProjectStore,
  type EditorProjectSnapshot,
} from '../stores/EditorProjectStore';
import { StartScreen } from './StartScreen';

export type EditorShellState = 'no-project' | 'editor';
export type EditorShellSessionRegion =
  | 'start-screen'
  | 'legacy-recovery';

export function getEditorShellState(
  snapshot: EditorProjectSnapshot | null,
): EditorShellState {
  return snapshot === null ? 'no-project' : 'editor';
}

export function getEditorShellSessionRegion(
  state: EditorShellState,
): EditorShellSessionRegion {
  return state === 'no-project' ? 'start-screen' : 'legacy-recovery';
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
    },
    autosaveApi: window.pandaStage.autosave,
    recoveryApi: window.pandaStage.recovery,
    projectSaveApi: window.pandaStage.project,
  });
}

export interface EditorShellProps {
  beforeRecovery: ReactNode;
  afterRecovery: ReactNode;
}

// Stage 1A-2 replaces only the session/recovery region. The remaining legacy
// modules stay mounted in either branch until 1A-5 introduces LegacyWorkspace.
function CurrentNoProjectLegacySurface({
  projectSnapshot,
}: {
  projectSnapshot: EditorProjectSnapshot | null;
}): React.JSX.Element {
  return (
    <>
      <AssetLibrary snapshot={projectSnapshot} />
      <CharacterManager snapshot={projectSnapshot} />
      <ShotManager snapshot={projectSnapshot} />
      <CanvasStage />
    </>
  );
}

export function EditorShell({
  beforeRecovery,
  afterRecovery,
}: EditorShellProps): React.JSX.Element {
  const projectSnapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const [session] = useState(createBrowserSession);
  const [sessionSnapshot, setSessionSnapshot] = useState(() =>
    session.getSnapshot(),
  );
  const [projectRootInput, setProjectRootInput] = useState('');
  const [status, setStatus] = useState(
    'Open a .pandastage project to check crash recovery.',
  );
  const [busy, setBusy] = useState(false);
  const [recentRefreshToken, setRecentRefreshToken] = useState(0);
  const shellState = getEditorShellState(projectSnapshot);
  const sessionRegion = getEditorShellSessionRegion(shellState);
  const recoveryCandidate = getEditorShellRecoveryCandidate(
    shellState,
    sessionSnapshot,
  );
  const gateA =
    new URLSearchParams(window.location.search).get('gateA') === '1';

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
    setRecentRefreshToken((current) => current + 1);
    setStatus(
      nextSession.recoveryCandidate
        ? 'A newer crash-recovery snapshot is available.'
        : cleanStatus,
    );
  };

  const switchToProject = async (projectRoot: string): Promise<void> => {
    const nextSession = await session.switchProject(projectRoot);
    updateSession(
      nextSession,
      'Project opened. No newer recovery snapshot was found.',
    );
  };

  const switchToRecentProject = async (
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void> => {
    const nextSession = await session.switchRecentProject(
      projectRoot,
      expectedProjectId,
    );
    updateSession(
      nextSession,
      'Project opened from recent list. No newer recovery snapshot was found.',
    );
  };

  const openProject = async (): Promise<void> => {
    const projectRoot = projectRootInput.trim();
    if (!projectRoot) return;
    setBusy(true);
    try {
      await switchToProject(projectRoot);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Open failed.');
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
        'Recovery loaded in memory and marked dirty. Use Save recovered project to replace project.json.',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Restore failed.');
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
          'Recovery ignored for this session. The evidence file was retained.',
        );
      } else {
        setStatus(response.error.message);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Ignore failed.');
    } finally {
      setBusy(false);
    }
  };

  const saveRecoveredProject = async (): Promise<void> => {
    if (!projectSnapshot?.dirty) return;
    setBusy(true);
    try {
      const result = await session.saveCurrentProject();
      if (!result.ok) {
        setStatus(result.error.message);
      } else if (result.acknowledgement === 'stale') {
        setStatus(
          `Revision ${result.savedRevision} was saved, but newer unsaved changes remain.`,
        );
      } else {
        setStatus(
          'Recovered project saved explicitly; stale recovery was cleaned.',
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className="app-shell"
      data-editor-shell-state={shellState}
    >
      {beforeRecovery}
      {gateA ? null : sessionRegion === 'start-screen' ? (
        <>
          <StartScreen
            busy={busy}
            onOpenProject={openProject}
            onOpenRecentProject={switchToRecentProject}
            onProjectRootInputChange={setProjectRootInput}
            projectRootInput={projectRootInput}
            recentRefreshToken={recentRefreshToken}
            status={status}
          />
          <CurrentNoProjectLegacySurface
            projectSnapshot={projectSnapshot}
          />
        </>
      ) : (
        <ProjectRecoveryPanel
          busy={busy}
          onIgnoreRecovery={ignoreRecovery}
          onOpenProject={openProject}
          onOpenRecentProject={switchToRecentProject}
          onProjectRootInputChange={setProjectRootInput}
          onRestoreRecovery={restoreRecovery}
          onSaveRecoveredProject={saveRecoveredProject}
          projectRootInput={projectRootInput}
          projectSnapshot={projectSnapshot}
          recoveryCandidate={recoveryCandidate}
          recentRefreshToken={recentRefreshToken}
          status={status}
        />
      )}
      {afterRecovery}
    </main>
  );
}
