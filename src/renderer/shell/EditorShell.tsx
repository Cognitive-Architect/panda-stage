import { LayerEffectPreviewContext, LayerEffectPreviewDispatch, type LayerEffectPreview } from '../stage/LayerEffectPreview';
import type { CurveMotionStageDraft } from '../features/canvas/CurveMotionStageOverlay';
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
import type { DialogueSilence } from '../../shared/dialogue-silence';
import type { ExportPreparationResponse, PngSequenceOptions } from '../../shared/export-preparation-types';
import { DEFAULT_EXPORT_PREFERENCES, type ExportPreferences } from '../../domain/models/exportPreferences';
import type { ExportJobUpdate } from '../../shared/export-types';
import {
  FlaPartPreviewResponseSchema,
  type FlaPartPreviewRequest,
  type FlaPartPreviewResponse,
} from '../../shared/fla-part-preview-api';
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
import { selectionStore } from '../stores/selectionStore';
import { characterAssemblySessionStore } from '../stores/characterAssemblySessionStore';
import { characterStore } from '../stores/characterStore';
import { timelineUiStore } from '../features/timeline/timelineUiStore';
import { AnimationCurveDraftDispatch, type AnimationCurveDraft } from '../features/timeline/AnimationCurveDraft';
import { CharacterArmToolProvider } from '../features/canvas/CharacterArmTool';
import { CharacterAssemblyWorkbench } from '../features/characters/CharacterAssemblyWorkbench';
import {
  createAdaptiveCharacterFromFlaGraphic,
  type CreateAdaptiveCharacterFromGraphic,
} from '../features/fla-import/createAdaptiveCharacterFromGraphic';
import {
  createCharacterFromPreparedParts,
  queryFlaCharacterCreateStatus,
} from '../features/fla-import/createCharacterFromPreparedParts';
import {
  FlaCharacterCreateRecoveryPanel,
  FlaCharacterCreateRecoveryUnavailable,
} from '../features/fla-import/FlaCharacterCreateRecoveryPanel';
import {
  clearPendingFlaCharacterCreateCredential,
  decideFlaCharacterNativeClose,
  isFlaCharacterOperationLocked,
  queryPendingFlaCharacterCreateStatus,
  readPendingFlaCharacterCreateRecord,
  type PendingFlaCharacterCreateCredential,
  type PendingFlaCharacterCreateRecord,
} from '../features/fla-import/fla-character-create-recovery';
import type {
  CreateFlaCharacter,
  FlaCharacterCreateOperationState,
  QueryFlaCharacterCreateStatus,
} from '../features/fla-import/FlaCharacterImportFlow';
import { FlaGraphicImportError, type ImportFlaGraphicInstance } from '../features/fla-import/fla-graphic-instance-import';
import type { AdaptivePartsAssemblyActionsRef } from '../features/characters/CharacterManager';
import { PendingDialoguePlacementProvider } from '../features/timeline/PendingDialoguePlacement';
import { GraphicFrameTargetProvider } from '../features/properties/GraphicFrameAtTimeControl';
import { CloseConfirmDialog } from './CloseConfirmDialog';
import { ExportOptionsDialog } from './ExportOptionsDialog';
import {
  ExportTaskSurface,
  type ExportTaskState,
} from './ExportTaskSurface';
import {
  applyExportJobUpdate,
  safeExportFailureMessage,
  shouldRestoreExportTask,
} from './exportTaskState';
import { CanvasWorkspace } from './CanvasWorkspace';
import {
  CompactProjectBar,
  type CompactProjectSaveState,
} from './CompactProjectBar';
import { LeftWorkspace } from './LeftWorkspace';
import { NewProjectDialog } from './NewProjectDialog';
import { useDialogueSilence } from './useDialogueSilence';
import { useDesktopAutomation } from './useDesktopAutomation';
import { ProductPreviewOverlay } from './ProductPreviewOverlay';
import { ProjectCenterScreen } from './ProjectCenterScreen';
import { RecoveryCandidateBanner } from './RecoveryCandidateBanner';
import { RightInspector, focusLayerParentBinding } from './RightInspector';
import { RightWorkspace, type RightWorkspaceHandle } from './RightWorkspace';
import type { WorkbenchPanel } from './editorWorkbenchLayout';
import { EditorWorkbench, type WorkbenchControls } from './EditorWorkbench';
import { ShotLayerListPanel } from '../features/properties/ShotLayerListPanel';
import { TimelineDock } from '../features/timeline/TimelineDock';
import { DockedAnimationCurve } from '../features/timeline/DockedAnimationCurve';
import { CharacterFloatHost, type FloatingCharacterMode } from '../features/characters/characterFloatHost';
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
import { PROJECT_TEMPLATE_EXTENSION } from '../../shared/project-api';
import {
  projectOpenErrorMessage,
  validateProjectOpenCandidate,
} from './projectOpenFlow';

export type EditorShellState = 'no-project' | 'editor';
export type EditorShellSessionRegion =
  | 'start-screen'
  | 'editor-layout';
export type EditorShellPage = 'project-center' | 'editor';

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
    options: {
      shouldSkipAutosave?: (snapshot: EditorProjectSnapshot) => boolean;
      assertSnapshotCanClose?: (snapshot: EditorProjectSnapshot | null) => void;
    } = {},
  ): Promise<void> {
    this.store.assertProjectOperationIdle();
    while (true) {
      const snapshot = getSnapshot();
      this.assertNativeCloseSyncable(snapshot);
      options.assertSnapshotCanClose?.(snapshot);
      const skipAutosave = Boolean(
        snapshot &&
          !snapshot.dirty &&
          options.shouldSkipAutosave?.(snapshot),
      );
      if (!skipAutosave) {
        const response = await this.syncAutosave(snapshot);
        if (response && !response.ok) {
          throw new Error(response.error.message);
        }
      }
      await this.flushAutosave();
      this.store.assertProjectOperationIdle();
      this.assertNativeCloseSyncable(snapshot);
      if (getSnapshot() === snapshot) return;
    }
  }

  async switchProject(projectRoot: string): Promise<ProjectSessionSnapshot> {
    this.store.assertProjectOperationIdle();
    await this.flushAutosave();
    this.store.assertProjectOperationIdle();
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
    this.store.assertProjectOperationIdle();
    await this.flushAutosave();
    this.store.assertProjectOperationIdle();
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
    this.store.assertProjectOperationIdle();
    await this.flushAutosave();
    this.store.assertProjectOperationIdle();
    return this.runControllerTransition(() =>
      this.controller.closeProject(),
    );
  }

  async restoreRecovery(): Promise<RecoveryRestoreResponse> {
    this.store.assertProjectOperationIdle();
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
    this.store.assertProjectOperationIdle();
    await this.flushAutosave();
    this.store.assertProjectOperationIdle();
    return saveCurrentProject(this.projectSaveApi, this.store);
  }

  assertNoControllerTransition(): void {
    if (this.controllerTransitionDepth > 0) {
      throw new Error('The Project is changing sessions and cannot start a confirmed operation.');
    }
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

interface ProductPreviewProjectIdentity {
  projectId: string;
  projectRoot: string;
}

export function EditorShell({
  debugSurface,
  gatePreview,
}: EditorShellProps): React.JSX.Element {
  const [characterFloatTarget, setCharacterFloatTarget] = useState<HTMLElement | null>(null);
  const [characterFloatMode, setCharacterFloatMode] = useState<FloatingCharacterMode | null>(null);
  const workbench = useRef<WorkbenchControls>(null);
  const rightWorkspace = useRef<RightWorkspaceHandle>(null);
  const [panelVisibility, setPanelVisibility] = useState<Partial<Record<WorkbenchPanel, boolean>>>({});
  const updatePanelVisibility = useCallback((panel: WorkbenchPanel, visible: boolean) => {
    setPanelVisibility(current => current[panel] === visible ? current : { ...current, [panel]: visible });
  }, []);
  const projectSnapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const openInstanceId = editorProjectStore.getProjectInstanceId();
  const { dialogueSilence, captureForExport: captureDialogueSilence } =
    useDialogueSilence(
      projectSnapshot?.project,
      projectSnapshot?.projectRoot,
      openInstanceId,
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
  const createFlaCharacter = useCallback<CreateFlaCharacter>(
    async (preview, name, operationId) => {
      session.assertNoControllerTransition();
      return createCharacterFromPreparedParts({
        preview,
        name,
        operationId,
        api: window.pandaStage.fla,
        store: editorProjectStore,
        ensureMainSnapshot: async (currentSnapshot) => {
          session.assertNoControllerTransition();
          const response = await session.syncAutosave(currentSnapshot);
          if (response && !response.ok) throw new Error(response.error.message);
          session.assertNoControllerTransition();
        },
      });
    },
    [session],
  );
  const createFlaCharacterFromGraphic = useCallback<CreateAdaptiveCharacterFromGraphic>(
    async (input) => {
      session.assertNoControllerTransition();
      return createAdaptiveCharacterFromFlaGraphic({
        ...input,
        api: window.pandaStage.fla,
        store: editorProjectStore,
        characters: characterStore,
        ensureMainSnapshot: async (currentSnapshot) => {
          session.assertNoControllerTransition();
          const response = await session.syncAutosave(currentSnapshot);
          if (response && !response.ok) throw new Error(response.error.message);
          session.assertNoControllerTransition();
        },
      });
    },
    [session],
  );
  const importFlaGraphicInstance = useCallback<ImportFlaGraphicInstance>(
    async (preview, unitId) => {
      session.assertNoControllerTransition();
      const snapshot = editorProjectStore.getSnapshot();
      const openInstanceId = editorProjectStore.getProjectInstanceId();
      const shotId = shotStore.getCurrentShotId();
      const shot = snapshot?.project.shots.find((candidate) => candidate.id === shotId);
      if (!snapshot || openInstanceId === null) {
        throw new Error('请先打开项目。');
      }
      if (!preview.sessionId || !preview.generation || !preview.planId || !preview.poseIdentity) {
        throw new Error('FLA 对象预览已失效，请重新准备。');
      }
      const lease = editorProjectStore.acquireProjectOperationLease({
        projectRoot: snapshot.projectRoot,
        projectId: snapshot.project.id,
        revision: snapshot.revision,
        openInstanceId,
      });
      try {
        const sync = await session.syncAutosave(snapshot);
        if (sync && !sync.ok) throw new Error(sync.error.message);
        session.assertNoControllerTransition();
        if (editorProjectStore.getSnapshot() !== snapshot) {
          throw new Error('项目状态已更新，请重试导入。');
        }
        const response = await window.pandaStage.fla.commitGraphicInstance({
          format: 'fla-graphic-instance-commit',
          version: 1,
          requestId: crypto.randomUUID(),
          projectRoot: snapshot.projectRoot,
          projectId: snapshot.project.id,
          baseRevision: snapshot.revision,
          openInstanceId,
          ...(shot ? { shotId: shot.id } : {}),
          startTimeMs: shot ? Math.min(timelineUiStore.getSnapshot().currentTimeMs, shot.durationMs) : 0,
          plan: {
            sessionId: preview.sessionId,
            planId: preview.planId,
            generation: preview.generation,
            poseIdentity: preview.poseIdentity,
            unitId,
          },
        });
        if (!response.ok) throw new FlaGraphicImportError(response.error.code, response.error.message);
        if (
          response.projectRoot !== lease.projectRoot ||
          response.projectId !== lease.projectId ||
          response.openInstanceId !== lease.openInstanceId ||
          response.baseRevision !== lease.revision
        ) {
          throw new Error('Main Process returned an FLA instance result for a different project session.');
        }
        if (response.projectChanged) {
          editorProjectStore.acceptSavedProjectCommand(
            lease,
            response.project,
            response.savedRevision,
            '导入 FLA 对象',
          );
        } else {
          editorProjectStore.markSaved(response.project, response.savedRevision);
        }
        if (shot && response.layerId && shotStore.getCurrentShotId() === shot.id) {
          selectionStore.select(response.layerId);
        }
      } finally {
        editorProjectStore.releaseProjectOperationLease(lease);
      }
    },
    [session],
  );
  const queryFlaCreateStatus = useCallback<QueryFlaCharacterCreateStatus>(
    (operationId, preview, baseSnapshot, openInstanceId) =>
      queryFlaCharacterCreateStatus({
        operationId,
        preview,
        baseSnapshot,
        openInstanceId,
        api: window.pandaStage.fla,
        store: editorProjectStore,
      }),
    [],
  );
  const queryPendingFlaCreateStatus = useCallback(
    (credential: PendingFlaCharacterCreateCredential) =>
      queryPendingFlaCharacterCreateStatus(credential, window.pandaStage.fla),
    [],
  );
  const [sessionSnapshot, setSessionSnapshot] = useState(() =>
    session.getSnapshot(),
  );
  const [openCandidatePath, setOpenCandidatePath] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [recentRefreshToken, setRecentRefreshToken] = useState(0);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [projectTemplateMode, setProjectTemplateMode] = useState<
    { kind: 'save-template' } | { kind: 'from-template'; templateRoot: string } | null
  >(null);
  const [newProjectParentDirectory, setNewProjectParentDirectory] =
    useState('');
  const [newProjectParentDirectoryTouched, setNewProjectParentDirectoryTouched] =
    useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectNameTouched, setNewProjectNameTouched] = useState(false);
  const [newProjectStatus, setNewProjectStatus] = useState('');
  const [productPreviewOpen, setProductPreviewOpen] = useState(false);
  const [productPreviewDraft, setProductPreviewDraft] = useState<Project | null>(null);
  const [curveMotionStageDraft, setCurveMotionStageDraft] = useState<CurveMotionStageDraft | null>(null);
  const [layerEffectPreview, setLayerEffectPreview] = useState<LayerEffectPreview | null>(null);
  const [animationCurveDraft, setAnimationCurveDraft] = useState<AnimationCurveDraft | null>(null);
  const [dockedCurveDraft, setDockedCurveDraft] = useState<AnimationCurveDraft | null>(null);
  const productPreviewOpenRef = useRef(false);
  const productPreviewSessionRef = useRef(0);
  const productPreviewFocusRestoreFrameRef = useRef<number | null>(null);
  const productPreviewOpenerRef = useRef<{
    element: HTMLElement;
    projectId: string;
    projectRoot: string;
    sessionId: number;
  } | null>(null);
  const currentProjectIdentityRef = useRef<ProductPreviewProjectIdentity | null>(
    null,
  );
  currentProjectIdentityRef.current = projectSnapshot
    ? {
        projectId: projectSnapshot.project.id,
        projectRoot: projectSnapshot.projectRoot,
      }
    : null;
  const productPreviewSessionId = productPreviewSessionRef.current;
  // Preview Camera is an editor-session mode, not Project or Preview state.
  const [autoCameraEnabled, setAutoCameraEnabled] = useState(false);
  const issue816FlowActive = useRef(false);
  const adaptivePartsActionsRef = useRef<AdaptivePartsAssemblyActionsRef['current']>(null);
  const [productPreviewSurfaceActive, setProductPreviewSurfaceActive] =
    useState(false);
  const commitProductPreviewSurface = useCallback((): void => {
    if (
      !productPreviewOpenRef.current ||
      productPreviewSessionRef.current !== productPreviewSessionId
    ) {
      return;
    }
    setProductPreviewSurfaceActive(true);
  }, [productPreviewSessionId]);
  const cancelProductPreviewFocusRestore = (): void => {
    if (productPreviewFocusRestoreFrameRef.current === null) return;
    window.cancelAnimationFrame(productPreviewFocusRestoreFrameRef.current);
    productPreviewFocusRestoreFrameRef.current = null;
  };
  const invalidateProductPreviewSession = (): void => {
    productPreviewSessionRef.current += 1;
    productPreviewOpenRef.current = false;
    productPreviewOpenerRef.current = null;
    cancelProductPreviewFocusRestore();
    setProductPreviewSurfaceActive(false);
    setProductPreviewOpen(false);
    setProductPreviewDraft(null);
  };
  useEffect(
    () => () => {
      productPreviewSessionRef.current += 1;
      productPreviewOpenRef.current = false;
      productPreviewOpenerRef.current = null;
      if (productPreviewFocusRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(productPreviewFocusRestoreFrameRef.current);
        productPreviewFocusRestoreFrameRef.current = null;
      }
    },
    [],
  );
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
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false);
  const exportJobIdRef = useRef<string | null>(null);
  const latestExportUpdatesRef = useRef(new Map<string, ExportJobUpdate>());
  const mountedRef = useRef(true);
  const pendingSilenceWaitRef = useRef<{
    attemptId: string;
    controller: AbortController;
    cancelledByUser: boolean;
  } | null>(null);
  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        pendingSilenceWaitRef.current?.controller.abort();
      };
    },
    [],
  );
  const [saveActivity, setSaveActivity] = useState<{
    phase: 'idle' | 'saving' | 'failed';
    revision: number | null;
  }>({ phase: 'idle', revision: null });
  const [requestedPage, setRequestedPage] =
    useState<EditorShellPage>('project-center');
  const [flaCharacterRecoveryRecord, setFlaCharacterRecoveryRecord] = useState(
    () => readPendingFlaCharacterCreateRecord(),
  );
  const flaCharacterRecoveryRecordRef = useRef(flaCharacterRecoveryRecord);
  flaCharacterRecoveryRecordRef.current = flaCharacterRecoveryRecord;
  const flaCharacterOperationStateRef = useRef<FlaCharacterCreateOperationState>(
    flaCharacterRecoveryRecord.kind === 'none' ? 'terminal' : 'unknown',
  );
  const safeFlaCharacterCloseArmedRef = useRef<string | null>(null);
  const flaCharacterCommitActiveRef = useRef(
    flaCharacterRecoveryRecord.kind !== 'none',
  );
  const setFlaCharacterCommitActive = (committing: boolean): void => {
    flaCharacterCommitActiveRef.current = committing || isFlaCharacterOperationLocked(
      flaCharacterOperationStateRef.current,
      flaCharacterRecoveryRecordRef.current.kind !== 'none',
    );
  };
  const setFlaCharacterRecoveryCredential = (
    credential: PendingFlaCharacterCreateCredential | null,
  ): void => {
    const nextRecord: PendingFlaCharacterCreateRecord = credential
      ? { kind: 'valid', credential }
      : readPendingFlaCharacterCreateRecord();
    flaCharacterRecoveryRecordRef.current = nextRecord;
    setFlaCharacterRecoveryRecord(nextRecord);
    flaCharacterCommitActiveRef.current = isFlaCharacterOperationLocked(
      flaCharacterOperationStateRef.current,
      nextRecord.kind !== 'none',
    );
  };
  const setFlaCharacterOperationState = (
    state: FlaCharacterCreateOperationState,
  ): void => {
    flaCharacterOperationStateRef.current = state;
    flaCharacterCommitActiveRef.current = isFlaCharacterOperationLocked(
      state,
      flaCharacterRecoveryRecordRef.current.kind !== 'none',
    );
  };
  const armSafeFlaCharacterClose = (operationId: string): void => {
    const record = flaCharacterRecoveryRecordRef.current;
    if (
      flaCharacterOperationStateRef.current !== 'safe-to-close' ||
      record.kind !== 'valid' ||
      record.credential.operationId !== operationId
    ) {
      return;
    }
    safeFlaCharacterCloseArmedRef.current = operationId;
    setStatus('已允许安全关闭。请点击应用窗口右上角关闭按钮；核对记录会保留。');
  };
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

  const setExportTaskState = (next: ExportTaskState): void => {
    exportTaskRef.current = next;
    setExportTask(next);
  };
  const exportTaskIsActive = (task: ExportTaskState): boolean =>
    ['selecting', 'preparing', 'starting', 'running', 'cancelling'].includes(task.status);
  const blockSessionChangeDuringExport = (
    allowPersistedFlaRecovery = false,
  ): boolean => {
    if (flaCharacterCommitActiveRef.current && !allowPersistedFlaRecovery) {
      setStatus('角色保存仍待核对，请先查询同一保存编号后再关闭或切换工程。');
      return true;
    }
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
      new URLSearchParams(window.location.search).get('flaF103Acceptance') !== '1'
    ) {
      return;
    }
    let lastCreatedCharacterId: string | null = null;
    const switchAcceptanceProject = session.switchProject.bind(session);
    const acceptanceApi = {
      openProject: async (projectRoot: string) => {
        const opened = await switchAcceptanceProject(projectRoot);
        setRequestedPage('editor');
        return opened;
      },
      closeProject: () => session.closeProject(),
      inspect: () => {
        const snapshot = editorProjectStore.getSnapshot();
        if (!snapshot) return null;
        return {
          projectRoot: snapshot.projectRoot,
          project: structuredClone(snapshot.project),
          revision: snapshot.revision,
          dirty: snapshot.dirty,
          openInstanceId: editorProjectStore.getProjectInstanceId(),
          undoCount: editorProjectStore.history.getSnapshot().undoCount,
          redoCount: editorProjectStore.history.getSnapshot().redoCount,
          nextUndoLabel: editorProjectStore.history.getSnapshot().nextUndoLabel,
        };
      },
      createCharacter: async (
        rawPreview: FlaPartPreviewResponse,
        name: string,
        operationId?: string,
      ) => {
        session.assertNoControllerTransition();
        const preview = FlaPartPreviewResponseSchema.parse(rawPreview);
        if (!preview.ok || preview.status !== 'PREVIEW_READY' || preview.capability !== 'EDITABLE_PARTS_READY') {
          throw new Error('F1-03 acceptance requires a confirmed editable Part preview.');
        }
        const result = await createCharacterFromPreparedParts({
          preview,
          name,
          operationId,
          api: window.pandaStage.fla,
          store: editorProjectStore,
          ensureMainSnapshot: async (snapshot) => {
            session.assertNoControllerTransition();
            const response = await session.syncAutosave(snapshot);
            if (response && !response.ok) throw new Error(response.error.message);
            session.assertNoControllerTransition();
          },
        });
        lastCreatedCharacterId = result.characterId;
        return result;
      },
      previewAndCreate: async (
        request: FlaPartPreviewRequest,
        name: string,
        operationId?: string,
      ) => {
        session.assertNoControllerTransition();
        const preview = await window.pandaStage.fla.partPreview(request);
        if (!preview.ok || preview.status !== 'PREVIEW_READY' || preview.capability !== 'EDITABLE_PARTS_READY') {
          throw new Error(preview.ok ? 'The FLA preview is not an editable Part batch.' : preview.error.message);
        }
        const result = await createCharacterFromPreparedParts({
          preview,
          name,
          operationId,
          api: window.pandaStage.fla,
          store: editorProjectStore,
          ensureMainSnapshot: async (snapshot) => {
            session.assertNoControllerTransition();
            const response = await session.syncAutosave(snapshot);
            if (response && !response.ok) throw new Error(response.error.message);
            session.assertNoControllerTransition();
          },
        });
        lastCreatedCharacterId = result.characterId;
        return {
          preview: {
            planId: preview.planId,
            sessionId: preview.sessionId,
            requestId: preview.requestId,
            generation: preview.generation,
            capability: preview.capability,
            poseIdentity: preview.poseIdentity,
            target: preview.target,
            stage: preview.stage,
            partPreviews: preview.partPreviews.map((part) => ({
              unitId: part.unitId,
              occurrenceId: part.occurrenceId,
              drawOrder: part.drawOrder,
              sha256: part.image.sha256,
              byteLength: part.image.byteLength,
              width: part.image.width,
              height: part.image.height,
            })),
          },
          result,
          state: acceptanceApi.inspect(),
        };
      },
      undo: () => editorProjectStore.undo(),
      redo: () => editorProjectStore.redo(),
      save: () => session.saveCurrentProject(),
      editUnsavedFixture: () => {
        const snapshot = editorProjectStore.getSnapshot();
        if (!snapshot) throw new Error('Open a Project before creating the F1-03 dirty snapshot.');
        const existingCharacter = snapshot.project.characters[0];
        if (!existingCharacter) throw new Error('The F1-03 acceptance Project requires an existing Character.');
        const editedName = `${existingCharacter.name} F1-03 edit`;
        editorProjectStore.updateProject(
          {
            ...snapshot.project,
            characters: snapshot.project.characters.map((character) =>
              character.id === existingCharacter.id
                ? { ...character, name: editedName }
                : character,
            ),
          },
          'Edit existing Character',
        );
        return {
          ...acceptanceApi.inspect(),
          editedCharacterId: existingCharacter.id,
          originalCharacterName: existingCharacter.name,
          editedCharacterName: editedName,
        };
      },
      readCreatedCharacterAssets: async (characterId?: string) => {
        const snapshot = editorProjectStore.getSnapshot();
        const targetCharacterId = characterId ?? lastCreatedCharacterId;
        if (!snapshot || !targetCharacterId) throw new Error('No F1-03 Character is available to read.');
        const character = snapshot.project.characters.find((item) => item.id === targetCharacterId);
        if (!character || character.mode !== 'adaptive-parts') throw new Error('The saved F1-03 Character was not reopened.');
        const assetIds = [
          ...new Set(
            character.parts
              .map((part) => part.assetId)
              .filter((assetId): assetId is string => Boolean(assetId)),
          ),
        ];
        const reads = await Promise.all(assetIds.map(async (assetId) => {
          const asset = snapshot.project.assets.find((item) => item.id === assetId);
          if (!asset || asset.kind !== 'image' || !asset.sha256) throw new Error(`Character image Asset ${assetId} is missing.`);
          const response = await window.pandaStage.assets.readCanvasImage({
            projectRoot: snapshot.projectRoot,
            assetId: asset.id,
            sha256: asset.sha256,
          });
          if (!response.ok) throw new Error(response.error.message);
          return {
            assetId: response.assetId,
            sha256: asset.sha256,
            width: response.width,
            height: response.height,
            byteLength: response.byteLength,
          };
        }));
        return reads;
      },
    };
    const acceptanceWindow = window as Window & {
      __pandaStageFlaF103Acceptance?: typeof acceptanceApi;
    };
    acceptanceWindow.__pandaStageFlaF103Acceptance = acceptanceApi;
    return () => {
      delete acceptanceWindow.__pandaStageFlaF103Acceptance;
    };
  }, [session]);

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
    if (assemblyActive || characterFloatMode) workbench.current?.show('stage');
  }, [assemblyActive, characterFloatMode]);

  useEffect(() => {
    if (page === 'editor' && flaCharacterRecoveryRecord.kind !== 'none') workbench.current?.show('assets');
  }, [page, flaCharacterRecoveryRecord.kind]);

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
      const pendingRecord = flaCharacterRecoveryRecordRef.current;
      const persistedRecord = readPendingFlaCharacterCreateRecord();
      const armedOperationId = safeFlaCharacterCloseArmedRef.current;
      const currentSnapshot = editorProjectStore.getSnapshot();
      const closeDecision = decideFlaCharacterNativeClose({
        operationLocked: flaCharacterCommitActiveRef.current,
        pendingRecord,
        persistedRecord,
        armedOperationId,
        operationState: flaCharacterOperationStateRef.current,
        currentProject: currentSnapshot
          ? {
            projectRoot: currentSnapshot.projectRoot,
            projectId: currentSnapshot.project.id,
            dirty: currentSnapshot.dirty,
          }
          : null,
      });
      const allowPersistedFlaRecoveryClose = closeDecision.allowed;
      if (closeDecision.reason === 'dirty-project' || closeDecision.reason === 'project-mismatch') {
        safeFlaCharacterCloseArmedRef.current = null;
        window.pandaStage.nativeClose.respondSync({
          ok: false,
          requestId,
          error: closeDecision.reason === 'dirty-project'
            ? '已确认角色保存，但当前项目仍有未保存编辑。请先同步项目，再安全关闭。'
            : '当前打开项目与待核对的保存记录身份不一致。请先在项目中心核对后再关闭。',
        });
        return;
      }
      if (blockSessionChangeDuringExport(allowPersistedFlaRecoveryClose)) {
        const exportActive = exportTaskIsActive(exportTaskRef.current);
        safeFlaCharacterCloseArmedRef.current = null;
        window.pandaStage.nativeClose.respondSync({
          ok: false,
          requestId,
          error:
            flaCharacterCommitActiveRef.current && !allowPersistedFlaRecoveryClose
              ? '角色保存仍待核对，请回到保存结果页面查询后再关闭窗口。'
              : exportActive
                ? '\u6b63\u5728\u5bfc\u51fa\u89c6\u9891\u3002\u8bf7\u5b8c\u6210\u6216\u53d6\u6d88\u5bfc\u51fa\u540e\u518d\u5173\u95ed\u7a97\u53e3\u3002'
                : '当前操作仍在确认中，窗口保持打开。',
        });
        return;
      }
      const staleCommittedSnapshot = allowPersistedFlaRecoveryClose &&
        closeDecision.skipAutosave &&
        pendingRecord.kind === 'valid' &&
        currentSnapshot !== null &&
        currentSnapshot.revision < pendingRecord.credential.baseRevision + 1;
      void session
        .prepareForNativeClose(editorProjectStore.getSnapshot, {
          shouldSkipAutosave: (snapshot) => Boolean(
            staleCommittedSnapshot &&
              !snapshot.dirty &&
              pendingRecord.kind === 'valid' &&
              snapshot.projectRoot === pendingRecord.credential.projectRoot &&
              snapshot.project.id === pendingRecord.credential.projectId &&
              snapshot.revision < pendingRecord.credential.baseRevision + 1,
          ),
          assertSnapshotCanClose: (snapshot) => {
            const latestPendingRecord = flaCharacterRecoveryRecordRef.current;
            const latestPersistedRecord = readPendingFlaCharacterCreateRecord();
            const latestDecision = decideFlaCharacterNativeClose({
              operationLocked: flaCharacterCommitActiveRef.current,
              pendingRecord: latestPendingRecord,
              persistedRecord: latestPersistedRecord,
              armedOperationId: safeFlaCharacterCloseArmedRef.current,
              operationState: flaCharacterOperationStateRef.current,
              currentProject: snapshot
                ? {
                  projectRoot: snapshot.projectRoot,
                  projectId: snapshot.project.id,
                  dirty: snapshot.dirty,
                }
                : null,
            });
            if (!latestDecision.allowed) {
              throw new Error(latestDecision.reason === 'dirty-project'
                ? '已确认角色保存，但当前项目出现未保存编辑。窗口保持打开，请先同步项目。'
                : latestDecision.reason === 'project-mismatch'
                  ? '当前打开项目与待核对的保存记录身份不一致。窗口保持打开，请先核对项目。'
                  : '角色保存仍待核对，窗口保持打开。');
            }
          },
        })
        .then(() => {
          safeFlaCharacterCloseArmedRef.current = null;
          window.pandaStage.nativeClose.respondSync({
            ok: true,
            requestId,
          });
        })
        .catch((error: unknown) => {
          safeFlaCharacterCloseArmedRef.current = null;
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
    allowPersistedFlaRecovery = false,
  ): Promise<boolean> => {
    if (blockSessionChangeDuringExport(allowPersistedFlaRecovery)) return false;
    const nextSession = await session.switchProject(projectRoot);
    await clearExportTask();
    // The preview belongs to the project that was open when it was requested.
    invalidateProductPreviewSession();
    setAutoCameraEnabled(false);
    setSaveActivity({ phase: 'idle', revision: null });
    updateSession(nextSession, cleanStatus);
    setRequestedPage('editor');
    return true;
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
      invalidateProductPreviewSession();
      updateSession(
        nextSession,
        '已从最近项目打开，暂无未保存更改。',
      );
      setAutoCameraEnabled(false);
      setSaveActivity({ phase: 'idle', revision: null });
      setRequestedPage('editor');
    } catch (error) {
      throw new Error(projectOpenErrorMessage(error), { cause: error });
    }
  };

  const resolvePendingFlaCharacterRecovery = async (
    credential: PendingFlaCharacterCreateCredential,
    result: 'committed' | 'not-committed',
  ): Promise<boolean> => {
    if (result === 'not-committed') {
      if (!clearPendingFlaCharacterCreateCredential(credential)) {
        setStatus('本次没有保存成功，但本机核对信息暂时无法清理。请重试查询。');
        return false;
      }
      setFlaCharacterRecoveryCredential(null);
      setFlaCharacterOperationState('terminal');
      setStatus('本次角色没有保存成功，可以重新准备。');
      return true;
    }

    const current = editorProjectStore.getSnapshot();
    if (
      current?.projectRoot === credential.projectRoot &&
      current.project.id === credential.projectId
    ) {
      if (current.revision < credential.baseRevision + 1) {
        setFlaCharacterOperationState('safe-to-close');
        setStatus('Main 已确认角色保存，但当前编辑器快照仍旧。核对记录已保留；请稍后重新打开项目以载入已保存结果。');
        return false;
      }
      if (!clearPendingFlaCharacterCreateCredential(credential)) {
        setStatus('角色已保存，但本机核对信息暂时无法清理。请重试查询。');
        return false;
      }
      setFlaCharacterRecoveryCredential(null);
      setFlaCharacterOperationState('terminal');
      setRequestedPage('editor');
      setStatus('角色已保存，请在角色列表核对。');
      return true;
    }

    setBusy(true);
    try {
      const opened = await switchToProject(
        credential.projectRoot,
        '角色已保存，请在角色列表核对。',
        true,
      );
      if (!opened) return false;
      const reopened = editorProjectStore.getSnapshot();
      if (
        reopened?.projectRoot !== credential.projectRoot ||
        reopened.project.id !== credential.projectId ||
        reopened.revision < credential.baseRevision + 1
      ) {
        setStatus('重新打开的项目与本次已确认保存记录不匹配。保留核对信息并继续核查。');
        return false;
      }
      if (!clearPendingFlaCharacterCreateCredential(credential)) {
        setStatus('角色已保存，但本机核对信息暂时无法清理。请重试查询。');
        return false;
      }
      setFlaCharacterRecoveryCredential(null);
      setFlaCharacterOperationState('terminal');
      return true;
    } catch (error) {
      setStatus(projectOpenErrorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openProjectCenter = (): void => {
    if (blockSessionChangeDuringExport()) return;
    invalidateProductPreviewSession();
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
    setProjectTemplateMode(null);
    setNewProjectParentDirectoryTouched(false);
    setNewProjectNameTouched(false);
    setNewProjectStatus('');
    setNewProjectDialogOpen(true);
  };

  const cancelNewProject = (): void => {
    setNewProjectDialogOpen(false);
    setProjectTemplateMode(null);
    setNewProjectStatus('');
  };

  const requestSaveTemplate = (): void => {
    requestNewProject();
    setProjectTemplateMode({ kind: 'save-template' });
    setNewProjectName('');
  };

  const requestCreateFromTemplate = async (): Promise<void> => {
    if (blockSessionChangeDuringExport()) return;
    setBusy(true);
    try {
      const response = await window.pandaStage.project.chooseDirectory();
      if (response.status === 'cancelled') return;
      if (!response.projectRoot.replace(/[\\/]+$/u, '').toLowerCase().endsWith(PROJECT_TEMPLATE_EXTENSION)) {
        setStatus('请选择 Panda Stage 模板文件夹。');
        return;
      }
      requestNewProject();
      setProjectTemplateMode({ kind: 'from-template', templateRoot: response.projectRoot });
      setNewProjectName('');
      setStatus('');
    } catch {
      setStatus('无法选择模板文件夹，请重试。');
    } finally {
      setBusy(false);
    }
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
      setNewProjectStatus(projectTemplateMode ? '' : '已选择存放文件夹，请填写项目名称。');
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
      if (projectTemplateMode?.kind === 'save-template') {
        setNewProjectStatus('正在保存模板…');
        const snapshot = editorProjectStore.getSnapshot();
        if (!snapshot) {
          setNewProjectStatus('请先打开要保存为模板的工程。');
          return;
        }
        const synced = await session.syncAutosave(snapshot);
        if (synced && !synced.ok) {
          setNewProjectStatus(synced.error.message);
          return;
        }
        const response = await window.pandaStage.project.saveTemplate({
          projectRoot: snapshot.projectRoot,
          project: snapshot.project,
          revision: snapshot.revision,
          parentDirectory,
          templateName: projectName,
        });
        if (!response.ok) {
          const message = response.error.code === 'PROJECT_ALREADY_EXISTS'
            ? '该文件夹已存在同名模板，请更换名称。'
            : response.error.code === 'PROJECT_SAVE_STALE_REVISION'
              ? '项目已有更新，请重试以保存最新内容。'
              : '无法保存模板，请检查项目和存放文件夹后重试。';
          setNewProjectStatus(message);
          return;
        }
        cancelNewProject();
        setNewProjectName('');
        setStatus('模板已保存。');
        return;
      }
      if (projectTemplateMode?.kind === 'from-template') setNewProjectStatus('正在从模板创建工程…');
      const response = await window.pandaStage.project.createAt({
        parentDirectory,
        projectName,
        metadata: { name: projectName },
        ...(projectTemplateMode?.kind === 'from-template' ? { templateRoot: projectTemplateMode.templateRoot } : {}),
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
      setProjectTemplateMode(null);
      setNewProjectName('');
      setNewProjectParentDirectoryTouched(false);
      setNewProjectNameTouched(false);
      setNewProjectStatus('');
    } catch (error) {
      setNewProjectStatus(projectTemplateMode?.kind === 'save-template'
        ? '无法保存模板，请检查项目和存放文件夹后重试。'
        : projectCreateErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openProductPreview = (): void => {
    if (productPreviewOpenRef.current) return;
    cancelProductPreviewFocusRestore();
    const sessionId = productPreviewSessionRef.current + 1;
    productPreviewSessionRef.current = sessionId;
    productPreviewOpenRef.current = true;
    const identity = currentProjectIdentityRef.current;
    const activeElement = document.activeElement;
    productPreviewOpenerRef.current =
      identity &&
      activeElement instanceof HTMLElement &&
      activeElement.tabIndex >= 0
        ? {
            element: activeElement,
            projectId: identity.projectId,
            projectRoot: identity.projectRoot,
            sessionId,
          }
        : null;
    setProductPreviewSurfaceActive(false);
    setProductPreviewOpen(true);
  };

  const openDraftPreview = (draft: Project): void => {
    if (productPreviewOpenRef.current) return;
    const activeShot = draft.shots.find((shot) => shot.id === shotStore.getCurrentShotId());
    if (!activeShot) return;
    setProductPreviewDraft({ ...draft, shots: [activeShot] });
    openProductPreview();
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
    pngSequence?: PngSequenceOptions;
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
      pngSequence: candidate.pngSequence,
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
        pngSequence: candidate.pngSequence,
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
        pngSequence: candidate.pngSequence,
        completedFrames: 0,
        totalFrames: 0,
        message: safeExportFailureMessage(error),
        issues: [],
      });
    }
  };

  const beginFormalExportFlow = async (pngSequence?: PngSequenceOptions): Promise<void> => {
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
      pngSequence,
      outputPath: undefined,
      incomplete: undefined,
      message: undefined,
      issues: [],
    });
    try {
      const selection = await window.pandaStage.exportPreparation.selectOutput({
        projectRoot: initial.projectRoot,
        projectId: initial.project.id,
        projectName: initial.project.name,
        openInstanceId: initialInstanceId,
        ...(pngSequence ? { pngSequence } : {}),
        ...(!pngSequence && (
          initial.project.exportPreferences?.format === 'webm' ||
          initial.project.exportPreferences?.format === 'gif'
        ) ? { videoFormat: initial.project.exportPreferences.format } : {}),
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
        pngSequence,
        durationMs: projectDurationMs(captured.project),
        completedFrames: 0,
        totalFrames: 0,
        issues: [],
      });
      const cameraMode = autoCameraEnabled ? 'speaker-focus' : 'static';
      const waitController = new AbortController();
      const silenceWait = {
        attemptId,
        controller: waitController,
        cancelledByUser: false,
      };
      pendingSilenceWaitRef.current = silenceWait;
      const unsubscribeProjectWatch = editorProjectStore.subscribe(() => {
        const currentSnapshot = editorProjectStore.getSnapshot();
        const currentInstanceId = editorProjectStore.getProjectInstanceId();
        if (
          currentSnapshot !== captured ||
          currentInstanceId !== capturedInstanceId
        ) {
          waitController.abort();
        }
      });
      let silenceAtCapture: DialogueSilence;
      try {
        silenceAtCapture = await captureDialogueSilence({
          project: pngSequence ? { ...captured.project, shots: captured.project.shots.filter(shot => shot.id === pngSequence.shotId) }
            : captured.project,
          projectRoot: captured.projectRoot,
          openInstanceId: capturedInstanceId,
          signal: waitController.signal,
        });
      } finally {
        unsubscribeProjectWatch();
        if (pendingSilenceWaitRef.current === silenceWait) {
          pendingSilenceWaitRef.current = null;
        }
      }
      if (!mountedRef.current || silenceWait.cancelledByUser) {
        await window.pandaStage.exportPreparation.discard({
          selectionId: selection.selectionId,
        });
        if (mountedRef.current) {
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
        }
        return;
      }
      const latest = editorProjectStore.getSnapshot();
      const latestInstanceId = editorProjectStore.getProjectInstanceId();
      if (
        !latest ||
        latestInstanceId !== capturedInstanceId ||
        latest.projectRoot !== captured.projectRoot ||
        latest.project.id !== captured.project.id
      ) {
        await window.pandaStage.exportPreparation.discard({
          selectionId: selection.selectionId,
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
      if (
        latest.revision !== captured.revision ||
        latest.dirty !== captured.dirty ||
        latest.project !== captured.project
      ) {
        await window.pandaStage.exportPreparation.discard({
          selectionId: selection.selectionId,
        });
        const projectChangedIssue = {
          code: 'PROJECT_SESSION_CHANGED' as const,
          location: '\u5f53\u524d\u5de5\u7a0b',
          problem:
            '\u9009\u62e9\u8f93\u51fa\u4f4d\u7f6e\u540e\uff0c\u5de5\u7a0b\u5185\u5bb9\u6216\u4fdd\u5b58\u7248\u672c\u5df2\u53d8\u5316\u3002',
          nextStep:
            '\u91cd\u65b0\u9009\u62e9\u8f93\u51fa\u4f4d\u7f6e\uff0c\u5e76\u68c0\u67e5\u5f53\u524d\u5de5\u7a0b\u7248\u672c\u3002',
        };
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
          message: projectChangedIssue.problem,
          issues: [projectChangedIssue],
        });
        return;
      }
      const result = await window.pandaStage.exportPreparation.prepare({
        selectionId: selection.selectionId,
        attemptId,
        projectRoot: captured.projectRoot,
        projectId: captured.project.id,
        openInstanceId: capturedInstanceId,
        revision: captured.revision,
        dirty: captured.dirty,
        cameraMode,
        ...(!pngSequence && captured.project.exportPreferences?.videoOutput
          ? { videoOutput: captured.project.exportPreferences.videoOutput } : {}),
        ...(Object.keys(silenceAtCapture).length > 0 ? { dialogueSilence: silenceAtCapture } : {}),
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
          pngSequence: result.candidate.pngSequence,
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

  const beginPreferredExport = (): void => {
    const snapshot = editorProjectStore.getSnapshot();
    const preferences = snapshot?.project.exportPreferences;
    if (!preferences || preferences.format === 'mp4' || preferences.format === 'webm' || preferences.format === 'gif') { void beginFormalExportFlow(); return; }
    const spriteSheet = preferences.format === 'sprite-sheet';
    const shotId = shotStore.getCurrentShotId();
    if (!shotId || preferences.rangeMode === 'range') { setExportOptionsOpen(true); return; }
    void beginFormalExportFlow({ shotId, transparent: spriteSheet || preferences.transparent,
      ...(spriteSheet ? { spriteSheet: true } : {}) });
  };

  const confirmExportOptions = (preferences: ExportPreferences, pngSequence?: PngSequenceOptions): void => {
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot) return;
    const previous = snapshot.project.exportPreferences ?? DEFAULT_EXPORT_PREFERENCES;
    if (previous.format !== preferences.format || previous.rangeMode !== preferences.rangeMode || previous.transparent !== preferences.transparent ||
        previous.videoOutput?.width !== preferences.videoOutput?.width || previous.videoOutput?.fps !== preferences.videoOutput?.fps ||
        previous.gifLoop !== preferences.gifLoop) {
      editorProjectStore.updateProject({ ...snapshot.project, exportPreferences: preferences }, '更新导出设置');
    }
    setExportOptionsOpen(false);
    void beginFormalExportFlow(pngSequence);
  };

  const onExportVideo = (): void => {
    if (shouldRestoreExportTask(exportTaskRef.current)) {
      setExportSurfaceOpen(true);
      return;
    }
    beginPreferredExport();
  };

  const cancelExportTask = async (): Promise<void> => {
    const task = exportTaskRef.current;
    if (task.status === 'preparing' && task.attemptId) {
      if (pendingSilenceWaitRef.current?.attemptId === task.attemptId) {
        pendingSilenceWaitRef.current.cancelledByUser = true;
        pendingSilenceWaitRef.current.controller.abort();
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
        return;
      }
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
        ...(task.pngSequence ? { pngSequence: task.pngSequence } : {}),
        ...(!task.pngSequence && /\.webm$/iu.test(task.fileName ?? '')
          ? { videoFormat: 'webm' as const }
          : !task.pngSequence && /\.gif$/iu.test(task.fileName ?? '')
            ? { videoFormat: 'gif' as const }
            : {}),
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
          pngSequence: task.pngSequence,
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
      beginPreferredExport();
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
          message: current.pngSequence?.spriteSheet ? '无法打开精灵图输出目录。' : current.pngSequence ? '无法打开 PNG 序列输出目录。' :
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
    const sessionId = productPreviewSessionRef.current;
    const opener = productPreviewOpenerRef.current;
    productPreviewOpenRef.current = false;
    cancelProductPreviewFocusRestore();
    setProductPreviewSurfaceActive(false);
    setProductPreviewOpen(false);
    setProductPreviewDraft(null);
    if (!opener) return;
    productPreviewFocusRestoreFrameRef.current = window.requestAnimationFrame(() => {
      productPreviewFocusRestoreFrameRef.current = null;
      if (
        productPreviewOpenRef.current ||
        productPreviewSessionRef.current !== sessionId ||
        productPreviewOpenerRef.current !== opener ||
        opener.sessionId !== sessionId
      ) {
        return;
      }
      productPreviewOpenerRef.current = null;
      const currentIdentity = currentProjectIdentityRef.current;
      if (
        !currentIdentity ||
        currentIdentity.projectId !== opener.projectId ||
        currentIdentity.projectRoot !== opener.projectRoot ||
        !opener.element.isConnected ||
        opener.element.tabIndex < 0 ||
        opener.element.matches(':disabled') ||
        opener.element.closest('[inert], [hidden], [aria-hidden="true"]') ||
        window.getComputedStyle(opener.element).visibility === 'hidden' ||
        opener.element.getClientRects().length === 0
      ) {
        return;
      }
      opener.element.focus({ preventScroll: true });
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
    invalidateProductPreviewSession();
    setSessionSnapshot(nextSession);
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

  useDesktopAutomation({
    isBusy: () => busy || closeConfirmOpen || flaCharacterCommitActiveRef.current,
    previewDraft: (project, shotId) => {
      if (productPreviewOpenRef.current || shotId !== shotStore.getCurrentShotId()) return false;
      openDraftPreview(project);
      return true;
    },
  });

  const surface = (
    <main
      className="app-shell editor-shell"
      data-debug={debug ? 'enabled' : 'disabled'}
      data-editor-device-mode="desktop"
      data-editor-shell-layout="desktop"
      data-editor-shell-state={shellState}
      data-editor-shell-region={sessionRegion}
      data-editor-page={page}
      data-character-assembly-active={assemblyActive ? 'true' : 'false'}
      data-character-assembly-kind={assemblyKind}
      data-character-float-mode={characterFloatMode ?? undefined}
      data-gate-a={gateA ? 'enabled' : 'disabled'}
    >
      {!renderProductSurface ? null : page === 'project-center' ? (
        <ProjectCenterScreen
          busy={busy || flaCharacterRecoveryRecord.kind !== 'none'}
          currentProject={projectSnapshot}
          newProjectDialogOpen={newProjectDialogOpen}
          onChooseProjectDirectory={chooseProjectDirectory}
          onOpenProjectFromChooser={openProjectFromChooser}
          onOpenProject={openProject}
          onOpenRecentProject={switchToRecentProject}
          onOpenCandidatePathChange={setOpenCandidatePath}
          onRequestNewProject={requestNewProject}
          onCreateFromTemplate={requestCreateFromTemplate}
          onRequestSaveTemplate={requestSaveTemplate}
          onReturnToEditor={returnToEditor}
          openCandidatePath={openCandidatePath}
          recentRefreshToken={recentRefreshToken}
          recoveryBanner={
            <>
              {recoveryCandidate && projectSnapshot ? (
                <RecoveryCandidateBanner
                  busy={busy}
                  candidate={recoveryCandidate}
                  onIgnore={ignoreRecovery}
                  onRestore={restoreRecovery}
                />
              ) : null}
              {flaCharacterRecoveryRecord.kind === 'valid' ? (
                <FlaCharacterCreateRecoveryPanel
                  credential={flaCharacterRecoveryRecord.credential}
                  onOperationStateChange={setFlaCharacterOperationState}
                  onQuery={queryPendingFlaCreateStatus}
                  onResolved={resolvePendingFlaCharacterRecovery}
                  onSafeExit={armSafeFlaCharacterClose}
                />
              ) : flaCharacterRecoveryRecord.kind === 'invalid' ? (
                <FlaCharacterCreateRecoveryUnavailable />
              ) : null}
            </>
          }
          status={status}
        />
      ) : projectSnapshot ? (
        <div
          className="editor-layout editor-workbench"
          data-preview-surface-active={productPreviewSurfaceActive ? 'true' : 'false'}
          data-shell-mode="desktop"
          data-project-revision={projectSnapshot.revision}
          data-top-region-layout="flow"
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
          <PendingDialoguePlacementProvider desktopWorkbench>
            <GraphicFrameTargetProvider>
              <div className="workbench-body" data-testid="editor-body" inert={productPreviewOpen || undefined}>
                <EditorWorkbench onPanelVisibilityChange={updatePanelVisibility}
                  controls={workbench}
                  canHide={(panel) => {
                    if (panel === 'assets') return !assemblyActive && !characterFloatMode && !flaCharacterCommitActiveRef.current;
                    if (panel === 'stage') return !assemblyActive && !characterFloatMode;
                    return true;
                  }}
                  header={<>
                    <span className="workbench-project-name" title={projectSnapshot.project.name}>{projectSnapshot.project.name}</span>
                    <select aria-label="切换镜头" value={currentShotId ?? ''}
                      disabled={busy || assemblyActive || Boolean(characterFloatMode) || flaCharacterRecoveryRecord.kind !== 'none'}
                      onChange={(event) => shotStore.select(event.target.value)}>
                      {projectSnapshot.project.shots.map((shot) => <option key={shot.id} value={shot.id}>{shot.name}</option>)}
                    </select>
                    <CompactProjectBar
                      docked
                      busy={busy}
                      closeConfirmOpen={closeConfirmOpen}
                      exportBusy={exportTaskIsActive(exportTask)}
                      exportSurfaceOpen={exportSurfaceOpen}
                      key={`quick-action-drawer:${projectSnapshot.projectRoot}`}
                      onExportVideo={onExportVideo}
                      onOpenExportSettings={() => setExportOptionsOpen(true)}
                      onOpenProductPreview={openProductPreview}
                      onOpenProjectCenter={openProjectCenter}
                      onOpenProjectFolder={openProjectFolder}
                      onRequestCloseProject={requestCloseProject}
                      onSaveProject={saveProject}
                      productPreviewOpen={productPreviewOpen}
                      projectSnapshot={projectSnapshot}
                      saveState={saveState}
                      status={status}
                    />
                  </>}
                  panels={{
                    assets: (
                      <CharacterFloatHost.Provider value={{ target: characterFloatTarget, setMode: setCharacterFloatMode }}>
                        <LeftWorkspace
                          docked
                          drawerOpen
                          onDrawerOpenChange={(open) => { if (!open) workbench.current?.close('assets'); }}
                          adaptivePartsActionsRef={adaptivePartsActionsRef}
                          onCreateFlaCharacter={createFlaCharacter}
                          onCreateCharacterFromGraphic={createFlaCharacterFromGraphic}
                          onImportGraphicInstance={importFlaGraphicInstance}
                          onQueryFlaCharacterCreateStatus={queryFlaCreateStatus}
                          flaCharacterRecoveryRecord={flaCharacterRecoveryRecord}
                          onQueryPendingFlaCharacterCreateStatus={queryPendingFlaCreateStatus}
                          onResolvePendingFlaCharacterRecovery={resolvePendingFlaCharacterRecovery}
                          onFlaCharacterRecoveryCredentialChange={setFlaCharacterRecoveryCredential}
                          onFlaCharacterOperationStateChange={setFlaCharacterOperationState}
                          onSafeFlaCharacterExit={armSafeFlaCharacterClose}
                          flaCharacterRecoveryAction={
                            recoveryCandidate && projectSnapshot ? (
                              <RecoveryCandidateBanner
                                busy={busy}
                                candidate={recoveryCandidate}
                                onIgnore={ignoreRecovery}
                                onRestore={restoreRecovery}
                              />
                            ) : null
                          }
                          flaCharacterRecoveryBusy={busy}
                          onFlaCharacterCommitStateChange={setFlaCharacterCommitActive}
                          onFlaCharacterImportStart={() => workbench.current?.show('assets')}
                        onOpenRecentProject={switchToRecentProject}
                        projectSnapshot={projectSnapshot}
                        recentRefreshToken={recentRefreshToken}
                        />
                      </CharacterFloatHost.Provider>
                    ),
                    layers: <div className="workbench-scroll" inert={assemblyActive || Boolean(characterFloatMode) || undefined}>
                      <ShotLayerListPanel onFocusParentBinding={(layerId) => {
                        workbench.current?.show('props');
                        rightWorkspace.current?.closeForPropertyFocus();
                        requestAnimationFrame(() => {
                          if (selectionStore.getSelectedLayerId() === layerId) focusLayerParentBinding();
                        });
                      }} />
                    </div>,
                    stage: <div className="workbench-stage editor-workspace-slot-canvas"
                      data-character-assembly-active={assemblyActive ? 'true' : 'false'}>
                      <div className="character-assembly-canvas-owner"
                        aria-hidden={Boolean(characterFloatMode) || assemblyActive}
                        data-character-assembly-inactive={assemblyActive ? 'true' : 'false'}
                        inert={Boolean(characterFloatMode) || assemblyActive || undefined}>
                        <CanvasWorkspace showHeading={false} dialogueSilence={dialogueSilence}
                          onCharacterPartSelected={() => workbench.current?.show('props')}
                          curveDraft={animationCurveDraft ?? (panelVisibility.curve ? dockedCurveDraft : null)}
                          curveMotionDraft={panelVisibility.props ? curveMotionStageDraft : null} />
                      </div>
                      <div className="character-float-host" ref={setCharacterFloatTarget} />
                      {activeAssemblySession && characterFloatMode !== 'composite' ? (
                        <CharacterAssemblyWorkbench adaptivePartsActionsRef={adaptivePartsActionsRef}
                          projectSnapshot={projectSnapshot}
                          savedProjectSnapshot={editorProjectStore.getSavedProjectSnapshot()}
                          session={activeAssemblySession} />
                      ) : null}
                    </div>,
                    props: <div className="workbench-properties" inert={assemblyActive || Boolean(characterFloatMode) || undefined}>
                      <RightWorkspace ref={rightWorkspace} docked autoCameraEnabled={autoCameraEnabled}
                        key={projectSnapshot.projectRoot}
                        onAutoCameraChange={setAutoCameraEnabled} onPreviewDraft={openDraftPreview}
                        onCurveMotionDraft={setCurveMotionStageDraft}>
                        <RightInspector drawerOpen embedded layerListDocked shellMode="landscape" />
                      </RightWorkspace>
                    </div>,
                    curve: <div className="workbench-scroll" inert={assemblyActive || Boolean(characterFloatMode) || undefined}>
                      <DockedAnimationCurve onDraft={setDockedCurveDraft} />
                    </div>,
                    timeline: <div className="workbench-timeline" inert={assemblyActive || Boolean(characterFloatMode) || undefined}>
                      <TimelineDock docked presentation="desktop" productPreviewOpen={productPreviewOpen}
                        onOpenCurve={() => workbench.current?.show('curve')} />
                    </div>,
                  }}
                />
              </div>
            </GraphicFrameTargetProvider>
          </PendingDialoguePlacementProvider>
          {productPreviewOpen ? (
            <ProductPreviewOverlay
              autoPlay
              autoCameraEnabled={autoCameraEnabled}
              dialogueSilence={dialogueSilence}
              onAutoCameraChange={setAutoCameraEnabled}
              onClose={closeProductPreview}
              onHandoffReady={commitProductPreviewSurface}
              project={projectSnapshot.project}
              draftProject={productPreviewDraft}
              layerEffectPreview={!productPreviewDraft &&
                layerEffectPreview?.projectInstanceId === openInstanceId &&
                layerEffectPreview?.revision === projectSnapshot.revision
                ? layerEffectPreview : undefined}
              projectRoot={projectSnapshot.projectRoot}
              shotId={currentShotId}
              surfaceActive={productPreviewSurfaceActive}
            />
          ) : null}
          {exportOptionsOpen ? <ExportOptionsDialog
            key={`${openInstanceId}:${currentShotId}`}
            project={projectSnapshot.project}
            shot={projectSnapshot.project.shots.find(({ id }) => id === currentShotId)}
            selectedLayerId={selectionStore.getSelectedLayerId()}
            initial={projectSnapshot.project.exportPreferences ?? DEFAULT_EXPORT_PREFERENCES}
            playheadMs={timelineUiStore.getSnapshot().currentTimeMs}
            onCancel={() => setExportOptionsOpen(false)} onExport={confirmExportOptions}
          /> : null}
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
          mode={projectTemplateMode?.kind}
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
  return (
    <LayerEffectPreviewDispatch.Provider value={setLayerEffectPreview}>
      <LayerEffectPreviewContext.Provider value={layerEffectPreview}>
        <AnimationCurveDraftDispatch.Provider value={setAnimationCurveDraft}>
          <CharacterArmToolProvider>{surface}</CharacterArmToolProvider>
        </AnimationCurveDraftDispatch.Provider>
      </LayerEffectPreviewContext.Provider>
    </LayerEffectPreviewDispatch.Provider>
  );
}
