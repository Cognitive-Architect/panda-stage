import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  FlaCharacterCreateOutcome,
  FlaCharacterCreateErrorCode,
  FlaCharacterCreateStatusResponse,
} from '../../../shared/fla-character-create-api';
import type {
  FlaInspectionResponse,
} from '../../../shared/fla-import-api';
import type {
  FlaRenderableTargetCatalogEntry,
  FlaStaticSnapshotPreviewRequest,
} from '../../../shared/fla-static-snapshot-api';
import type {
  FlaPartPreviewResponse,
} from '../../../shared/fla-part-preview-api';
import {
  FlaInspectionLifecycle,
  isFlaInspectionUserCancelled,
  subscribeToFlaInspection,
} from '../../fla-import/fla-inspection-lifecycle';
import type {
  FlaInspectionOperation,
} from '../../fla-import/fla-inspection-lifecycle';
import {
  flaStaticSnapshotClient,
} from '../../fla-import/fla-static-snapshot-render';
import {
  flaStaticSnapshotPreviewQueue,
  runFlaStaticSnapshotPreviewTransaction,
} from '../../fla-import/fla-static-snapshot-preview-transaction';
import {
  editorProjectStore,
  type EditorProjectSnapshot,
} from '../../stores/EditorProjectStore';
import {
  FlaCharacterCreateOperationError,
} from './createCharacterFromPreparedParts';
import {
  getCharacterImportSceneEntries,
  getSelectableCharacterImportCandidateCount,
  getUniqueCharacterImportCandidate,
} from './fla-character-import-model';
import '../../styles/features/fla-import/f1-04--character-import.css';

export type EditableFlaCharacterPreview = Extract<
  FlaPartPreviewResponse,
  { ok: true; status: 'PREVIEW_READY'; capability: 'EDITABLE_PARTS_READY' }
>;

export interface FlaCharacterImportAttempt {
  lifecycle: FlaInspectionLifecycle;
  operation: FlaInspectionOperation;
}

export type CreateFlaCharacter = (
  preview: EditableFlaCharacterPreview,
  name: string,
  operationId: string,
) => Promise<FlaCharacterCreateOutcome>;

export type QueryFlaCharacterCreateStatus = (
  operationId: string,
  preview: EditableFlaCharacterPreview,
  baseSnapshot: EditorProjectSnapshot,
  openInstanceId: number,
) => Promise<FlaCharacterCreateStatusResponse>;

type CreateOperationOutcome =
  | 'IN_PROGRESS'
  | 'RECOVERY_REQUIRED'
  | 'OPERATION_ID_CONFLICT'
  | 'UNKNOWN'
  | 'FAILED'
  | 'NOT_FOUND'
  | 'COMMITTED'
  | null;

interface PendingCreateOperation {
  operationId: string;
  preview: EditableFlaCharacterPreview;
  baseSnapshot: EditorProjectSnapshot;
  openInstanceId: number;
}

type ImportPhase =
  | 'inspecting'
  | 'selecting'
  | 'preparing'
  | 'preview-ready'
  | 'whole-image-only'
  | 'unsupported'
  | 'error'
  | 'committing'
  | 'created';

interface ProjectIdentity {
  projectRoot: string;
  projectId: string;
  revision: number;
  openInstanceId: number;
}

interface ImportPreviewImages {
  source: string;
  reassembled: string | null;
  parts: readonly string[];
}

interface ActiveRequest {
  requestId: string;
  sessionId: string;
  generation: number;
}

function createFlaInspectionAttempt(): FlaCharacterImportAttempt {
  const lifecycle = new FlaInspectionLifecycle({
    chooseAndInspect: (requestId) =>
      window.pandaStage.fla.chooseAndInspect(requestId),
    onInspectionStarted: (callback) =>
      window.pandaStage.fla.onInspectionStarted(callback),
    cancel: (sessionId) => window.pandaStage.fla.cancel(sessionId),
  });
  return { lifecycle, operation: lifecycle.start() };
}

export function startFlaCharacterImport(): FlaCharacterImportAttempt {
  // Called synchronously from the user's explicit “导入角色” action so the
  // native picker is not started by a mount effect or React StrictMode replay.
  return createFlaInspectionAttempt();
}

function pngObjectUrl(bytes: Uint8Array): string {
  const copy = bytes.slice();
  return URL.createObjectURL(new Blob([copy.buffer], { type: 'image/png' }));
}

function getSuggestedName(basename: string): string {
  return basename.replace(/\.fla$/iu, '').trim().slice(0, 100);
}

function safeCreateErrorMessage(code: FlaCharacterCreateErrorCode | undefined): string {
  switch (code) {
    case 'DUPLICATE_CHARACTER_NAME':
      return '这个角色名已存在，请换一个名称。';
    case 'PLAN_EXPIRED':
      return '预览已过期，请重新准备角色。';
    case 'STALE_PROJECT':
      return '工程状态已变化，请返回角色列表后重新准备。';
    case 'RECOVERY_REQUIRED':
      return '保存结果需要恢复核对。请继续查询本次保存结果；确认结果前不要关闭导入窗口。';
    case 'OPERATION_IN_PROGRESS':
      return '保存仍在进行。本次操作内容已锁定，请查询保存结果。';
    case 'OPERATION_ID_CONFLICT':
      return '保存编号发生冲突，已停止创建。请查询保存结果并核对角色列表。';
    case 'UNSUPPORTED_CAPABILITY':
    case 'INVALID_REQUEST':
      return '当前预览无法用于创建，请重新准备角色。';
    case 'COMMIT_FAILED':
      return '角色未能保存，请检查工程状态后重试。';
    default:
      return '无法确认保存结果。再次查询会继续使用本次保存记录。';
  }
}

function sameProjectIdentity(
  expected: ProjectIdentity,
  snapshot: EditorProjectSnapshot | null,
  openInstanceId: number | null,
): boolean {
  return Boolean(
    snapshot &&
      openInstanceId !== null &&
      snapshot.projectRoot === expected.projectRoot &&
      snapshot.project.id === expected.projectId &&
      snapshot.revision === expected.revision &&
      openInstanceId === expected.openInstanceId,
  );
}

export interface FlaCharacterImportFlowProps {
  snapshot: EditorProjectSnapshot | null;
  attempt: FlaCharacterImportAttempt;
  onCreateCharacter: CreateFlaCharacter;
  onQueryCharacterCreateStatus: QueryFlaCharacterCreateStatus;
  onCommittingChange?(committing: boolean): void;
  onCreatedCharacter: (characterId: string) => boolean;
  onClose: () => void;
}

export function FlaCharacterImportFlow({
  snapshot,
  attempt,
  onCreateCharacter,
  onQueryCharacterCreateStatus,
  onCommittingChange,
  onCreatedCharacter,
  onClose,
}: FlaCharacterImportFlowProps): React.JSX.Element | null {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const currentOpenInstanceId = editorProjectStore.getProjectInstanceId();
  const initialIdentity: ProjectIdentity | null =
    snapshot && currentOpenInstanceId !== null
      ? {
          projectRoot: snapshot.projectRoot,
          projectId: snapshot.project.id,
          revision: snapshot.revision,
          openInstanceId: currentOpenInstanceId,
        }
      : null;
  const baselineRef = useRef<ProjectIdentity | null>(initialIdentity);
  const baselineSnapshotRef = useRef<EditorProjectSnapshot | null>(snapshot);
  const baselineOpenInstanceIdRef = useRef<number | null>(currentOpenInstanceId);
  const [inspectionAttempt, setInspectionAttempt] = useState(attempt);
  const inspectionLifecycleRef = useRef(attempt.lifecycle);
  const [phase, setPhaseState] = useState<ImportPhase>('inspecting');
  const phaseRef = useRef<ImportPhase>('inspecting');
  const [statusMessage, setStatusMessage] = useState('正在读取角色…');
  const sessionIdRef = useRef<string | null>(null);
  const [sourceBasename, setSourceBasename] = useState('');
  const [sceneEntries, setSceneEntries] = useState<readonly FlaRenderableTargetCatalogEntry[]>([]);
  const [omittedCandidateCount, setOmittedCandidateCount] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const selectedFrameIndexRef = useRef(0);
  const frameInteractionRef = useRef(false);
  const [preview, setPreview] = useState<FlaPartPreviewResponse | null>(null);
  const [previewImages, setPreviewImages] = useState<ImportPreviewImages | null>(null);
  const [name, setName] = useState('');
  const [thumbnailUrls, setThumbnailUrls] = useState<Readonly<Record<string, string>>>({});
  const thumbnailUrlsRef = useRef(new Map<string, string>());
  const activeThumbnailRequestRef = useRef<ActiveRequest | null>(null);
  const activePartRequestRef = useRef<ActiveRequest | null>(null);
  const flowGenerationRef = useRef(0);
  const previewGenerationRef = useRef(0);
  const operationIdRef = useRef<string | null>(null);
  const pendingCreateOperationRef = useRef<PendingCreateOperation | null>(null);
  const [operationOutcome, setOperationOutcome] = useState<CreateOperationOutcome>(null);
  const sourceReplacementGenerationRef = useRef(0);
  const invalidatedRef = useRef(false);
  const mountedRef = useRef(false);
  const mountGenerationRef = useRef(0);

  const transition = useCallback((next: ImportPhase): void => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const revokeThumbnails = useCallback((clearState = true): void => {
    for (const url of thumbnailUrlsRef.current.values()) URL.revokeObjectURL(url);
    thumbnailUrlsRef.current.clear();
    if (clearState) setThumbnailUrls({});
  }, []);

  const cancelActiveThumbnail = useCallback(async (): Promise<void> => {
    const active = activeThumbnailRequestRef.current;
    activeThumbnailRequestRef.current = null;
    if (!active) return;
    await flaStaticSnapshotClient.cancel({
      format: 'fla-static-snapshot-cancel',
      version: 1,
      requestId: active.requestId,
    }).catch(() => undefined);
  }, []);

  const cancelActivePartPreview = useCallback(async (): Promise<void> => {
    const active = activePartRequestRef.current;
    activePartRequestRef.current = null;
    if (!active) return;
    await window.pandaStage.fla.partPreviewCancel({
      format: 'fla-part-preview-cancel',
      version: 1,
      requestId: active.requestId,
      sessionId: active.sessionId,
      generation: active.generation,
    }).catch(() => undefined);
  }, []);

  const releaseCurrentPlan = useCallback(async (): Promise<void> => {
    const ownedSessionId = sessionIdRef.current;
    if (!ownedSessionId || previewGenerationRef.current < 1) return;
    await window.pandaStage.fla.partPreviewCancel({
      format: 'fla-part-preview-cancel',
      version: 1,
      sessionId: ownedSessionId,
      generation: previewGenerationRef.current,
    }).catch(() => undefined);
  }, []);

  const cancelOwnedWork = useCallback(async (): Promise<void> => {
    const ownedSessionId = sessionIdRef.current;
    flowGenerationRef.current += 1;
    await Promise.all([
      cancelActiveThumbnail(),
      cancelActivePartPreview(),
      releaseCurrentPlan(),
      inspectionLifecycleRef.current.cancel(),
    ]);
    if (sessionIdRef.current === ownedSessionId) {
      sessionIdRef.current = null;
    }
    if (ownedSessionId) {
      await window.pandaStage.fla.cancel(ownedSessionId).catch(() => undefined);
    }
  }, [cancelActivePartPreview, cancelActiveThumbnail, releaseCurrentPlan]);

  const prepareTarget = useCallback(async (
    entry: FlaRenderableTargetCatalogEntry,
    frameIndex: number,
    ownedSessionId: string,
  ): Promise<void> => {
    if (
      invalidatedRef.current ||
      !ownedSessionId ||
      phaseRef.current === 'committing' ||
      pendingCreateOperationRef.current
    ) return;
    const currentIdentity = baselineRef.current;
    if (!currentIdentity || !sameProjectIdentity(
      currentIdentity,
      editorProjectStore.getSnapshot(),
      editorProjectStore.getProjectInstanceId(),
    )) {
      invalidatedRef.current = true;
      transition('error');
      setStatusMessage('工程已变化，这次预览已作废。请返回角色列表后重新准备。');
      return;
    }

    const flowGeneration = ++flowGenerationRef.current;
    setPreview(null);
    setSelectedTargetId(entry.target.renderTargetId);
    setSelectedFrameIndex(frameIndex);
    selectedFrameIndexRef.current = frameIndex;
    operationIdRef.current = null;
    setOperationOutcome(null);
    setStatusMessage('正在准备角色…');
    transition('preparing');
    await Promise.all([cancelActiveThumbnail(), cancelActivePartPreview(), releaseCurrentPlan()]);
    if (flowGenerationRef.current !== flowGeneration || invalidatedRef.current) return;

    const generation = ++previewGenerationRef.current;
    const requestId = crypto.randomUUID();
    activePartRequestRef.current = {
      requestId,
      sessionId: ownedSessionId,
      generation,
    };
    const request = {
      format: 'fla-part-preview' as const,
      version: 1 as const,
      requestId,
      sessionId: ownedSessionId,
      generation,
      target: {
        renderTargetId: entry.target.renderTargetId,
        selectedFrameIndex: frameIndex,
      },
    };
    try {
      const response = await window.pandaStage.fla.partPreview(request);
      if (
        !mountedRef.current ||
        flowGenerationRef.current !== flowGeneration ||
        sessionIdRef.current !== ownedSessionId ||
        activePartRequestRef.current?.requestId !== requestId
      ) return;
      activePartRequestRef.current = null;
      setPreview(response);
      if (response.ok && response.status === 'PREVIEW_READY') {
        if (response.capability === 'EDITABLE_PARTS_READY') {
          setStatusMessage(`${response.partPreviews.length} 个零件已准备好。`);
          transition('preview-ready');
        } else {
          setStatusMessage('此对象目前只能作为整图导入，无法分别编辑零件。这个入口暂不支持创建整图角色。');
          transition('whole-image-only');
        }
        return;
      }
      if (!response.ok && 'capability' in response && response.capability === 'UNSUPPORTED') {
        setStatusMessage('这个对象暂时无法完整还原。请选择其他对象或文件。');
        transition('unsupported');
        return;
      }
      setStatusMessage(response.ok
        ? '无法准备这个整体姿势，请重新选择。'
        : response.error.code === 'PLAN_EXPIRED'
          ? '预览已过期，请重新准备角色。'
          : '无法准备这个整体姿势，请重试或选择其他对象。');
      transition('error');
    } catch {
      if (!mountedRef.current || flowGenerationRef.current !== flowGeneration) return;
      activePartRequestRef.current = null;
      setStatusMessage('无法准备这个整体姿势，请重试或选择其他对象。');
      transition('error');
    }
  }, [cancelActivePartPreview, cancelActiveThumbnail, releaseCurrentPlan, transition]);

  const loadCandidateThumbnail = useCallback((entry: FlaRenderableTargetCatalogEntry): void => {
    const ownedSessionId = sessionIdRef.current;
    if (
      !ownedSessionId ||
      !entry.previewSupported ||
      entry.isBlank ||
      thumbnailUrlsRef.current.has(entry.target.renderTargetId) ||
      activeThumbnailRequestRef.current?.requestId
    ) return;
    const requestId = crypto.randomUUID();
    const flowGeneration = flowGenerationRef.current;
    const request: FlaStaticSnapshotPreviewRequest = {
      format: 'fla-static-snapshot-preview',
      version: 1,
      requestId,
      sessionId: ownedSessionId,
      target: {
        ...entry.target,
        selectedFrameIndex: entry.target.selectedFrameIndex ?? 0,
      },
    };
    activeThumbnailRequestRef.current = {
      requestId,
      sessionId: ownedSessionId,
      generation: flowGeneration,
    };
    void (async () => {
      const outcome = await runFlaStaticSnapshotPreviewTransaction(
        flaStaticSnapshotClient,
        request,
        flaStaticSnapshotPreviewQueue,
        undefined,
        {
          shouldRun: () =>
            mountedRef.current &&
            flowGenerationRef.current === flowGeneration &&
            activeThumbnailRequestRef.current?.requestId === requestId,
          profileLabel: 'character-import-candidate-thumbnail',
        },
      );
      if (
        !mountedRef.current ||
        flowGenerationRef.current !== flowGeneration ||
        activeThumbnailRequestRef.current?.requestId !== requestId
      ) return;
      activeThumbnailRequestRef.current = null;
      if (!outcome.response?.ok || outcome.cleanupError || outcome.operationError) return;
      const url = pngObjectUrl(outcome.response.bytes);
      if (!mountedRef.current || flowGenerationRef.current !== flowGeneration) {
        URL.revokeObjectURL(url);
        return;
      }
      thumbnailUrlsRef.current.set(entry.target.renderTargetId, url);
      setThumbnailUrls((current) => ({
        ...current,
        [entry.target.renderTargetId]: url,
      }));
    })();
  }, []);

  const replaceSourceFile = useCallback(async (): Promise<void> => {
    if (
      phaseRef.current === 'committing' ||
      phaseRef.current === 'created' ||
      pendingCreateOperationRef.current
    ) return;
    const replacementGeneration = ++sourceReplacementGenerationRef.current;
    invalidatedRef.current = true;
    flowGenerationRef.current += 1;
    setPreview(null);
    setSelectedTargetId(null);
    setSelectedFrameIndex(0);
    selectedFrameIndexRef.current = 0;
    setOperationOutcome(null);
    operationIdRef.current = null;
    revokeThumbnails();
    setSceneEntries([]);
    setSourceBasename('');
    setName('');
    setOmittedCandidateCount(0);
    setStatusMessage('正在读取角色…');
    transition('inspecting');
    await cancelOwnedWork();
    if (
      !mountedRef.current ||
      sourceReplacementGenerationRef.current !== replacementGeneration
    ) return;
    invalidatedRef.current = false;
    const nextAttempt = createFlaInspectionAttempt();
    inspectionLifecycleRef.current = nextAttempt.lifecycle;
    setInspectionAttempt(nextAttempt);
  }, [cancelOwnedWork, revokeThumbnails, transition]);

  useEffect(() => {
    const mountGeneration = ++mountGenerationRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        // React StrictMode replays effects synchronously after cleanup. Let
        // the replacement setup claim the same import attempt before deciding
        // that this was a real unmount and cancelling its native picker.
        if (
          mountedRef.current ||
          mountGenerationRef.current !== mountGeneration ||
          phaseRef.current === 'committing'
        ) return;
        void cancelOwnedWork();
      });
      revokeThumbnails(false);
    };
  }, [cancelOwnedWork, revokeThumbnails]);

  useEffect(() => {
    const generation = ++flowGenerationRef.current;
    sessionIdRef.current = null;
    setSceneEntries([]);
    setSelectedTargetId(null);
    setPreview(null);
    setSourceBasename('');
    setName('');
    setStatusMessage('正在读取角色…');
    transition('inspecting');
    const unsubscribe = subscribeToFlaInspection(
      inspectionAttempt.operation,
      (response: FlaInspectionResponse) => {
        if (!mountedRef.current || flowGenerationRef.current !== generation) return;
        if (isFlaInspectionUserCancelled(response)) {
          onCloseRef.current();
          return;
        }
        if (!response.ok) {
          setStatusMessage('无法读取这个 FLA 文件，请检查文件后重试。');
          transition('error');
          return;
        }
        sessionIdRef.current = response.sessionId;
        setSourceBasename(response.ir.source.basename);
        setName(getSuggestedName(response.ir.source.basename));
        void (async () => {
          const catalog = await flaStaticSnapshotClient.catalog(response.sessionId, {
            includeAuthoredStates: true,
          }).catch(() => null);
          if (!mountedRef.current || flowGenerationRef.current !== generation) return;
          if (!catalog?.ok) {
            setStatusMessage('无法读取这个文件中的角色候选，请重试或选择其他文件。');
            transition('error');
            return;
          }
          const scenes = getCharacterImportSceneEntries(catalog.entries);
          setSceneEntries(scenes);
          setOmittedCandidateCount(catalog.omittedCandidateCount);
          const uniqueCandidate = getUniqueCharacterImportCandidate(scenes);
          if (uniqueCandidate) {
            const entry = uniqueCandidate;
            const frameIndex = entry.target.selectedFrameIndex ?? 0;
            setSelectedTargetId(entry.target.renderTargetId);
            setSelectedFrameIndex(frameIndex);
            selectedFrameIndexRef.current = frameIndex;
            void prepareTarget(entry, frameIndex, response.sessionId);
            return;
          }
          if (getSelectableCharacterImportCandidateCount(scenes) === 0) {
            setStatusMessage('没有可安全准备的完整姿势。请选择其他文件。');
            transition('unsupported');
            return;
          }
          setStatusMessage('请选择要导入的角色对象。');
          transition('selecting');
        })();
      },
      () => {
        if (!mountedRef.current || flowGenerationRef.current !== generation) return;
        setStatusMessage('无法读取这个 FLA 文件，请检查文件后重试。');
        transition('error');
      },
    );
    return unsubscribe;
  }, [inspectionAttempt, prepareTarget, transition]);

  useEffect(() => {
    const baseline = baselineRef.current;
    if (
      !baseline ||
      phaseRef.current === 'committing' ||
      phaseRef.current === 'created' ||
      invalidatedRef.current ||
      sameProjectIdentity(baseline, snapshot, currentOpenInstanceId)
    ) return;
    invalidatedRef.current = true;
    flowGenerationRef.current += 1;
    void cancelOwnedWork();
    setPreview(null);
    transition('error');
    setStatusMessage('工程已变化，这次预览已作废。请返回角色列表后重新准备。');
  }, [
    cancelOwnedWork,
    currentOpenInstanceId,
    phase,
    snapshot?.project.id,
    snapshot?.projectRoot,
    snapshot?.revision,
    transition,
  ]);

  useEffect(() => {
    if (!preview?.ok || preview.status !== 'PREVIEW_READY') {
      setPreviewImages(null);
      return undefined;
    }
    const source = pngObjectUrl(preview.nativePreview.bytes);
    const reassembled = preview.capability === 'EDITABLE_PARTS_READY'
      ? pngObjectUrl(preview.reassembledPreview.bytes)
      : null;
    const parts = preview.capability === 'EDITABLE_PARTS_READY'
      ? preview.partPreviews.map((part) => pngObjectUrl(part.image.bytes))
      : [];
    setPreviewImages({ source, reassembled, parts });
    return () => {
      URL.revokeObjectURL(source);
      if (reassembled) URL.revokeObjectURL(reassembled);
      for (const part of parts) URL.revokeObjectURL(part);
    };
  }, [preview]);

  const selectedTarget = sceneEntries.find(
    (entry) => entry.target.renderTargetId === selectedTargetId,
  ) ?? null;

  const chooseTarget = (entry: FlaRenderableTargetCatalogEntry): void => {
    const frameIndex = entry.target.selectedFrameIndex ?? 0;
    setStatusMessage('正在准备角色…');
    void prepareTarget(entry, frameIndex, sessionIdRef.current ?? '');
  };

  const beginFrameAdjustment = (): void => {
    if (
      frameInteractionRef.current ||
      phaseRef.current === 'committing' ||
      pendingCreateOperationRef.current
    ) return;
    frameInteractionRef.current = true;
    flowGenerationRef.current += 1;
    void cancelActivePartPreview();
    void cancelActiveThumbnail();
    void releaseCurrentPlan();
    setPreview(null);
    operationIdRef.current = null;
    setOperationOutcome(null);
    transition('selecting');
    setStatusMessage('选择一个完整源姿势。');
  };

  const finishFrameAdjustment = (): void => {
    if (!frameInteractionRef.current) return;
    frameInteractionRef.current = false;
    if (
      !selectedTarget ||
      !sessionIdRef.current ||
      invalidatedRef.current ||
      pendingCreateOperationRef.current ||
      phaseRef.current === 'committing'
    ) return;
    void prepareTarget(
      selectedTarget,
      selectedFrameIndexRef.current,
      sessionIdRef.current,
    );
  };

  const changeFrame = (rawValue: string): void => {
    if (phaseRef.current === 'committing' || pendingCreateOperationRef.current) return;
    beginFrameAdjustment();
    const next = Number(rawValue);
    selectedFrameIndexRef.current = next;
    setSelectedFrameIndex(next);
  };

  const closeFlow = useCallback(async (): Promise<void> => {
    if (phaseRef.current === 'committing' || pendingCreateOperationRef.current) return;
    await cancelOwnedWork();
    onCloseRef.current();
  }, [cancelOwnedWork]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (phaseRef.current === 'committing' || pendingCreateOperationRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      void closeFlow();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeFlow]);

  const completeCommittedOperation = (
    result: FlaCharacterCreateOutcome,
  ): void => {
    pendingCreateOperationRef.current = null;
    operationIdRef.current = null;
    setOperationOutcome('COMMITTED');
    transition('created');
    void cancelOwnedWork();
    onCommittingChange?.(false);
    if (!Object.prototype.hasOwnProperty.call(result, 'project')) {
      setStatusMessage('已确认保存。当前工程快照尚未更新，请返回角色列表核对保存结果。');
      return;
    }
    if (onCreatedCharacter(result.characterId)) {
      onCloseRef.current();
      return;
    }
    setStatusMessage('角色已保存，可从角色列表打开。');
  };

  const queryCharacterStatus = async (): Promise<void> => {
    const pending = pendingCreateOperationRef.current;
    if (!pending || phaseRef.current === 'committing') return;
    transition('committing');
    setStatusMessage('正在查询保存结果…');
    onCommittingChange?.(true);
    try {
      const status = await onQueryCharacterCreateStatus(
        pending.operationId,
        pending.preview,
        pending.baseSnapshot,
        pending.openInstanceId,
      );
      if (status.ok && status.status === 'COMMITTED') {
        completeCommittedOperation(status.result);
        return;
      }
      if (status.ok && status.status === 'IN_PROGRESS') {
        setOperationOutcome('IN_PROGRESS');
        setStatusMessage(status.message ?? safeCreateErrorMessage('OPERATION_IN_PROGRESS'));
        transition('error');
        return;
      }
      if (status.ok && status.status === 'RECOVERY_REQUIRED') {
        setOperationOutcome('RECOVERY_REQUIRED');
        setStatusMessage(status.message ?? safeCreateErrorMessage('RECOVERY_REQUIRED'));
        transition('error');
        return;
      }
      if (status.ok && status.status === 'FAILED') {
        if (status.error.code === 'OPERATION_ID_CONFLICT') {
          setOperationOutcome('OPERATION_ID_CONFLICT');
          setStatusMessage(safeCreateErrorMessage('OPERATION_ID_CONFLICT'));
          transition('error');
          return;
        }
        pendingCreateOperationRef.current = null;
        operationIdRef.current = null;
        setOperationOutcome('FAILED');
        setStatusMessage(status.error.message);
        transition('preview-ready');
        return;
      }
      if (status.ok && status.status === 'NOT_FOUND') {
        pendingCreateOperationRef.current = null;
        operationIdRef.current = null;
        setOperationOutcome('NOT_FOUND');
        setStatusMessage('没有找到本次保存记录。确认角色列表后，可以重新创建。');
        transition('preview-ready');
        return;
      }
      const code = status.ok ? undefined : status.error.code;
      setOperationOutcome(
        code === 'OPERATION_ID_CONFLICT'
          ? 'OPERATION_ID_CONFLICT'
          : code === 'OPERATION_IN_PROGRESS'
            ? 'IN_PROGRESS'
            : code === 'RECOVERY_REQUIRED'
              ? 'RECOVERY_REQUIRED'
              : 'UNKNOWN',
      );
      setStatusMessage(code
        ? safeCreateErrorMessage(code)
        : '无法查询保存结果。请重试查询，不要重复创建。');
      transition('error');
    } catch (error) {
      const operationError = error instanceof FlaCharacterCreateOperationError
        ? error
        : null;
      const code = operationError?.code;
      if (
        code === 'OPERATION_ID_CONFLICT' ||
        code === 'RECOVERY_REQUIRED' ||
        code === 'OPERATION_IN_PROGRESS'
      ) {
        setOperationOutcome(code === 'OPERATION_IN_PROGRESS' ? 'IN_PROGRESS' : code);
        setStatusMessage(safeCreateErrorMessage(code));
      } else {
        setOperationOutcome('UNKNOWN');
        setStatusMessage('无法查询保存结果。请重试查询，不要重复创建。');
      }
      transition('error');
    } finally {
      onCommittingChange?.(Boolean(pendingCreateOperationRef.current));
    }
  };

  const createCharacter = async (): Promise<void> => {
    if (pendingCreateOperationRef.current) {
      await queryCharacterStatus();
      return;
    }
    if (
      phaseRef.current !== 'preview-ready' ||
      !preview?.ok ||
      preview.status !== 'PREVIEW_READY' ||
      preview.capability !== 'EDITABLE_PARTS_READY' ||
      !name.trim() ||
      invalidatedRef.current
    ) return;
    const baseline = baselineRef.current;
    if (!baseline || !sameProjectIdentity(
      baseline,
      editorProjectStore.getSnapshot(),
      editorProjectStore.getProjectInstanceId(),
    )) {
      invalidatedRef.current = true;
      setStatusMessage('工程状态已变化，请返回角色列表后重新准备。');
      transition('error');
      return;
    }

    const baseSnapshot = baselineSnapshotRef.current;
    const openInstanceId = baselineOpenInstanceIdRef.current;
    if (!baseSnapshot || openInstanceId === null) {
      invalidatedRef.current = true;
      setStatusMessage('工程已变化，请返回角色列表后重新准备。');
      transition('error');
      return;
    }
    const operationId = crypto.randomUUID();
    operationIdRef.current = operationId;
    pendingCreateOperationRef.current = {
      operationId,
      preview,
      baseSnapshot,
      openInstanceId,
    };
    setOperationOutcome(null);
    transition('committing');
    setStatusMessage('正在保存角色…');
    onCommittingChange?.(true);
    try {
      const result = await onCreateCharacter(preview, name.trim(), operationId);
      completeCommittedOperation(result);
    } catch (error) {
      const operationError = error instanceof FlaCharacterCreateOperationError
        ? error
        : null;
      const code = operationError?.code;
      if (operationError?.code === 'DUPLICATE_CHARACTER_NAME') {
        pendingCreateOperationRef.current = null;
        operationIdRef.current = null;
        setOperationOutcome('FAILED');
        setStatusMessage(safeCreateErrorMessage(code));
        transition('preview-ready');
        return;
      }
      if (operationError?.code === 'PLAN_EXPIRED') {
        pendingCreateOperationRef.current = null;
        operationIdRef.current = null;
        setOperationOutcome('FAILED');
        setPreview(null);
        setStatusMessage(safeCreateErrorMessage(code));
        transition('error');
        return;
      }
      if (operationError?.code === 'STALE_PROJECT') {
        pendingCreateOperationRef.current = null;
        operationIdRef.current = null;
        setOperationOutcome('FAILED');
        invalidatedRef.current = true;
        setStatusMessage(safeCreateErrorMessage(code));
        transition('error');
        return;
      }
      if (code === 'RECOVERY_REQUIRED' || code === 'OPERATION_ID_CONFLICT' || code === 'OPERATION_IN_PROGRESS') {
        setOperationOutcome(code === 'OPERATION_IN_PROGRESS' ? 'IN_PROGRESS' : code);
        setStatusMessage(safeCreateErrorMessage(code));
        transition('error');
        return;
      }
      if (code) {
        pendingCreateOperationRef.current = null;
        operationIdRef.current = null;
        setOperationOutcome('FAILED');
        setStatusMessage(safeCreateErrorMessage(code));
        transition('preview-ready');
        return;
      }
      setOperationOutcome('UNKNOWN');
      setStatusMessage('无法确认保存结果。请查询保存结果，不要重复创建。');
      transition('error');
    } finally {
      onCommittingChange?.(Boolean(pendingCreateOperationRef.current));
    }
  };

  if (typeof document === 'undefined') return null;

  const visibleTargets = sceneEntries;
  const multipleTargets = visibleTargets.length > 1;
  const editablePreview = preview?.ok &&
    preview.status === 'PREVIEW_READY' &&
    preview.capability === 'EDITABLE_PARTS_READY'
    ? preview
    : null;
  const hasPendingOperation = Boolean(pendingCreateOperationRef.current);
  const canCreate = !hasPendingOperation &&
    phase === 'preview-ready' &&
    Boolean(editablePreview) &&
    name.trim().length > 0 &&
    !invalidatedRef.current;
  const canQueryStatus = hasPendingOperation && phase !== 'committing';
  const createLabel = hasPendingOperation
    ? '查询保存结果'
    : operationOutcome === 'FAILED' || operationOutcome === 'NOT_FOUND'
      ? '重新创建角色'
      : '创建角色';

  return createPortal(
    <div
      className="fla-character-import-backdrop"
      data-testid="fla-character-import-overlay"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          phaseRef.current !== 'committing' &&
          !pendingCreateOperationRef.current
        ) {
          void closeFlow();
        }
      }}
    >
      <section
        aria-label="导入角色"
        aria-modal="true"
        className="fla-character-import-dialog"
        data-import-phase={phase}
        data-testid="fla-character-import-dialog"
        role="dialog"
      >
        <header className="fla-character-import-header">
          <div>
            <p>角色资源</p>
            <h1>导入角色</h1>
          </div>
          <div className="fla-character-import-header-actions">
            {phase !== 'committing' && phase !== 'created' && !hasPendingOperation ? (
              <button
                className="fla-character-import-change-file"
                data-testid="fla-character-import-change-file"
                onClick={() => void replaceSourceFile()}
                type="button"
              >
                更换文件
              </button>
            ) : null}
            <button
              aria-label={phase === 'committing' ? '正在保存角色' : '关闭'}
              className="fla-character-import-close"
              data-testid="fla-character-import-close"
              disabled={phase === 'committing'}
              onClick={() => void closeFlow()}
              type="button"
            >
              ×
            </button>
          </div>
        </header>

        <div className={`fla-character-import-body${multipleTargets ? ' has-multiple-targets' : ''}`}>
          {multipleTargets ? (
            <aside className="fla-character-import-targets" aria-label="角色对象">
              <h2>选择角色对象</h2>
              {omittedCandidateCount > 0 ? (
                <p className="fla-character-import-omitted" role="status">
                  候选目录还有 {omittedCandidateCount} 项未列出。
                </p>
              ) : null}
              <div className="fla-character-import-target-list">
                {visibleTargets.map((entry) => {
                  const targetId = entry.target.renderTargetId;
                  const selected = targetId === selectedTargetId;
                  const enabled = entry.previewSupported && !entry.isBlank;
                  const image = selected && previewImages
                    ? previewImages.source
                    : thumbnailUrls[targetId];
                  return (
                    <button
                      aria-pressed={selected}
                      className="fla-character-import-target"
                      data-testid="fla-character-import-target"
                      disabled={!enabled || phase === 'committing' || hasPendingOperation}
                      key={targetId}
                      onClick={() => chooseTarget(entry)}
                      onFocus={() => loadCandidateThumbnail(entry)}
                      onPointerEnter={() => loadCandidateThumbnail(entry)}
                      type="button"
                    >
                      <span className="fla-character-import-target-thumb">
                        {image ? <img alt="" loading="lazy" src={image} /> : <span aria-hidden="true">预览</span>}
                      </span>
                      <span className="fla-character-import-target-copy">
                        <strong>{entry.target.userLabel}</strong>
                        <small>{enabled ? `${entry.target.frameCount} 个整体姿势` : '暂不可用'}</small>
                        {!enabled ? <small>这个对象目前无法安全还原。</small> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>
          ) : null}

          <main className="fla-character-import-preview-area">
            <div className="fla-character-import-preview-heading">
              <div>
                <h2>{selectedTarget?.target.userLabel ?? (sourceBasename || '角色预览')}</h2>
                {editablePreview ? <p>{editablePreview.partPreviews.length} 个可编辑零件</p> : null}
              </div>
              {phase === 'error' && selectedTarget && sessionIdRef.current && !invalidatedRef.current ? (
                <button
                  className="fla-character-import-change-file"
                  data-testid="fla-character-import-reprepare"
                  onClick={() => void prepareTarget(selectedTarget, selectedFrameIndex, sessionIdRef.current!)}
                  type="button"
                >
                  重新准备
                </button>
              ) : null}
              {selectedTarget && selectedTarget.target.frameCount > 1 ? (
                <label className="fla-character-import-pose-control">
                  <span>整体姿势 · 第 {selectedFrameIndex + 1} 帧</span>
                  <input
                    aria-label="整体姿势"
                    data-testid="fla-character-import-frame"
                    max={selectedTarget.target.frameCount - 1}
                    min={0}
                    onBlur={finishFrameAdjustment}
                    onChange={(event) => changeFrame(event.currentTarget.value)}
                    onKeyDown={beginFrameAdjustment}
                    onKeyUp={finishFrameAdjustment}
                    onPointerDown={beginFrameAdjustment}
                    onPointerUp={finishFrameAdjustment}
                    step={1}
                    type="range"
                    value={selectedFrameIndex}
                    disabled={phase === 'committing' || hasPendingOperation}
                  />
                </label>
              ) : null}
            </div>

            <div className="fla-character-import-preview-canvas" data-testid="fla-character-import-preview">
              {previewImages && phase === 'preview-ready' && previewImages.reassembled ? (
                <img
                  alt="角色零件重组预览"
                  className="fla-character-import-reassembled"
                  data-testid="fla-character-import-reassembled"
                  src={previewImages.reassembled}
                />
              ) : previewImages && phase === 'whole-image-only' ? (
                <img
                  alt="角色整体姿势预览"
                  className="fla-character-import-reassembled"
                  src={previewImages.source}
                />
              ) : phase === 'preparing' ? (
                <p>正在准备角色…</p>
              ) : phase === 'inspecting' ? (
                <p>正在读取角色…</p>
              ) : phase === 'unsupported' || phase === 'error' ? (
                null
              ) : selectedTarget ? (
                <p>选择一个完整源姿势以查看角色预览。</p>
              ) : (
                <p>选择一个 FLA 文件以开始。</p>
              )}
            </div>

            {previewImages && editablePreview ? (
              <details className="fla-character-import-parts-details">
                <summary>查看零件</summary>
                <ol className="fla-character-import-parts-list">
                  {previewImages.parts.map((url, index) => (
                    <li key={url}>
                      <img alt={`零件 ${index + 1}`} src={url} />
                      <span>零件 {index + 1}</span>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
            {previewImages && editablePreview ? (
              <details className="fla-character-import-source-details">
                <summary>查看原始整图</summary>
                <img alt="原始整体姿势" src={previewImages.source} />
              </details>
            ) : null}
          </main>
        </div>

        <footer className="fla-character-import-footer">
          <label className="fla-character-import-name">
            <span>角色名称</span>
            <input
              aria-label="角色名称"
              data-testid="fla-character-import-name"
              disabled={phase === 'committing' || phase === 'created' || hasPendingOperation}
              maxLength={100}
              onChange={(event) => {
                if (phaseRef.current !== 'committing' && !pendingCreateOperationRef.current) {
                  setName(event.currentTarget.value);
                }
              }}
              value={name}
            />
          </label>
          <div className="fla-character-import-footer-actions">
            <output aria-live="polite" data-testid="fla-character-import-status" role={phase === 'error' || phase === 'unsupported' ? 'alert' : 'status'}>
              {phase === 'inspecting' || phase === 'preparing' ? '' : statusMessage}
            </output>
            {hasPendingOperation ? null : (
              <button
                className="fla-character-import-cancel"
                data-testid="fla-character-import-cancel"
                disabled={phase === 'committing'}
                onClick={() => void closeFlow()}
                type="button"
              >
                {phase === 'created' ? '返回角色列表' : '取消'}
              </button>
            )}
            <button
              className="fla-character-import-create"
              data-testid="fla-character-import-create"
              disabled={!canCreate && !canQueryStatus}
              onClick={() => void createCharacter()}
              type="button"
            >
              {phase === 'committing'
                ? hasPendingOperation
                  ? '正在查询保存结果…'
                  : '正在保存角色…'
                : createLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
