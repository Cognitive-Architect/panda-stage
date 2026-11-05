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
  clearPendingFlaCharacterCreateCredential,
  decideFlaCharacterCreateCommittedOutcome,
  decideFlaCharacterCreateQueryFailure,
  decideFlaCharacterCreateStatus,
  shouldBlockFlaCharacterImportClose,
  readPendingFlaCharacterCreateRecord,
  samePendingFlaCharacterCreateCredential,
  writePendingFlaCharacterCreateCredential,
  type FlaCharacterCreateOperationState,
  type PendingFlaCharacterCreateCredential,
} from './fla-character-create-recovery';
import {
  getCharacterImportEntries,
  getSelectableCharacterImportCandidateCount,
  getUniqueCharacterImportCandidate,
} from './fla-character-import-model';
import { FlaCharacterImportPartsControl } from './FlaCharacterImportPartsControl';
import { VisibleBoundsThumbnail } from '../characters/VisibleBoundsThumbnail';
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
  credential: PendingFlaCharacterCreateCredential;
}

export type { FlaCharacterCreateOperationState } from './fla-character-create-recovery';

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
  parts: readonly { src: string; sha256: string }[];
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
      return '保存编号发生冲突，已停止创建。请查询本次保存结果；确认前不要重复创建。';
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
  onRecoveryCredentialChange?(credential: PendingFlaCharacterCreateCredential | null): void;
  onOperationStateChange?(state: FlaCharacterCreateOperationState): void;
  onSafeExit?(operationId: string): void;
  recoveryAction?: React.JSX.Element | null;
  recoveryBusy?: boolean;
  onCreatedCharacter: (characterId: string) => boolean;
  onClose: () => void;
}

export function FlaCharacterImportFlow({
  snapshot,
  attempt,
  onCreateCharacter,
  onQueryCharacterCreateStatus,
  onCommittingChange,
  onRecoveryCredentialChange,
  onOperationStateChange,
  onSafeExit,
  recoveryAction,
  recoveryBusy = false,
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
  const [candidateEntries, setCandidateEntries] = useState<readonly FlaRenderableTargetCatalogEntry[]>([]);
  const [omittedCandidateCount, setOmittedCandidateCount] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const selectedFrameIndexRef = useRef(0);
  const frameInteractionRef = useRef(false);
  const [preview, setPreview] = useState<FlaPartPreviewResponse | null>(null);
  const [previewImages, setPreviewImages] = useState<ImportPreviewImages | null>(null);
  const [partsExpanded, setPartsExpanded] = useState(false);
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
  const [safeExitAvailable, setSafeExitAvailable] = useState(false);
  const [receiptCopied, setReceiptCopied] = useState(false);
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
    setCandidateEntries([]);
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
    setCandidateEntries([]);
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
          const candidates = getCharacterImportEntries(catalog.entries);
          setCandidateEntries(candidates);
          setOmittedCandidateCount(catalog.omittedCandidateCount);
          const uniqueCandidate = getUniqueCharacterImportCandidate(candidates);
          if (uniqueCandidate) {
            const entry = uniqueCandidate;
            const frameIndex = entry.target.selectedFrameIndex ?? 0;
            setSelectedTargetId(entry.target.renderTargetId);
            setSelectedFrameIndex(frameIndex);
            selectedFrameIndexRef.current = frameIndex;
            void prepareTarget(entry, frameIndex, response.sessionId);
            return;
          }
          if (getSelectableCharacterImportCandidateCount(candidates) === 0) {
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
    setPartsExpanded(false);
    const source = pngObjectUrl(preview.nativePreview.bytes);
    const reassembled = preview.capability === 'EDITABLE_PARTS_READY'
      ? pngObjectUrl(preview.reassembledPreview.bytes)
      : null;
    const parts = preview.capability === 'EDITABLE_PARTS_READY'
      ? preview.partPreviews.map((part) => ({
          src: pngObjectUrl(part.image.bytes),
          sha256: part.image.sha256,
        }))
      : [];
    setPreviewImages({ source, reassembled, parts });
    return () => {
      URL.revokeObjectURL(source);
      if (reassembled) URL.revokeObjectURL(reassembled);
      for (const part of parts) URL.revokeObjectURL(part.src);
    };
  }, [preview]);

  const selectedTarget = candidateEntries.find(
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
    if (shouldBlockFlaCharacterImportClose(
      phaseRef.current,
      Boolean(pendingCreateOperationRef.current),
    )) return;
    await cancelOwnedWork();
    onCloseRef.current();
  }, [cancelOwnedWork]);

  const setOperationSafetyState = (
    state: FlaCharacterCreateOperationState,
  ): void => {
    setSafeExitAvailable(state === 'safe-to-close');
    onOperationStateChange?.(state);
  };

  const clearRecoveryCredential = (
    credential: PendingFlaCharacterCreateCredential,
  ): boolean => {
    const cleared = clearPendingFlaCharacterCreateCredential(
      credential,
    );
    if (cleared) onRecoveryCredentialChange?.(null);
    return cleared;
  };

  const copyOperationReceipt = async (
    credential: PendingFlaCharacterCreateCredential,
  ): Promise<void> => {
    const receipt = [
      `operationId=${credential.operationId}`,
      `projectId=${credential.projectId}`,
      `projectRoot=${credential.projectRoot}`,
      `baseRevision=${credential.baseRevision}`,
      `openInstanceId=${credential.openInstanceId}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(receipt);
      setReceiptCopied(true);
    } catch {
      setReceiptCopied(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (shouldBlockFlaCharacterImportClose(
        phaseRef.current,
        Boolean(pendingCreateOperationRef.current),
      )) {
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
    const pending = pendingCreateOperationRef.current;
    if (!pending) {
      setOperationOutcome('OPERATION_ID_CONFLICT');
      setStatusMessage(safeCreateErrorMessage('OPERATION_ID_CONFLICT'));
      setOperationSafetyState('unknown');
      transition('error');
      onCommittingChange?.(true);
      return;
    }

    const current = editorProjectStore.getSnapshot();
    const persisted = readPendingFlaCharacterCreateRecord();
    const hasVerifiedReentryCredential = persisted.kind === 'valid' &&
      samePendingFlaCharacterCreateCredential(persisted.credential, pending.credential);
    const decision = decideFlaCharacterCreateCommittedOutcome(
      pending.credential,
      result,
      current
        ? { projectRoot: current.projectRoot, project: current.project, revision: current.revision }
        : null,
      hasVerifiedReentryCredential,
    );
    if (decision.kind === 'conflict') {
      setOperationOutcome('OPERATION_ID_CONFLICT');
      setStatusMessage(safeCreateErrorMessage('OPERATION_ID_CONFLICT'));
      setOperationSafetyState('unknown');
      transition('error');
      onCommittingChange?.(true);
      return;
    }
    if (decision.kind === 'committed-project-not-current') {
      setOperationOutcome('COMMITTED');
      setOperationSafetyState(decision.operationState);
      setStatusMessage(decision.canClose
        ? 'Main 已确认保存，但当前工程快照尚未同步。核对记录已保留；请在项目中心重新打开工程核对，不要重复创建。'
        : 'Main 已确认保存，但当前工程快照尚未同步且本机核对信息无法验证。请复制编号并保持窗口打开。');
      transition('error');
      onCommittingChange?.(true);
      return;
    }

    const opened = onCreatedCharacter(result.characterId);
    if (!clearRecoveryCredential(pending.credential)) {
      setOperationOutcome('COMMITTED');
      setOperationSafetyState('unknown');
      setStatusMessage('角色已保存，但本机核对信息未能清理。请复制编号并重试查询；当前不能再次创建。');
      transition('error');
      onCommittingChange?.(true);
      return;
    }

    pendingCreateOperationRef.current = null;
    operationIdRef.current = null;
    setOperationOutcome('COMMITTED');
    setOperationSafetyState('terminal');
    transition('created');
    void cancelOwnedWork();
    onCommittingChange?.(false);
    if (opened) {
      onCloseRef.current();
      return;
    }
    setStatusMessage('角色已保存，可从角色列表打开。');
  };

  const queryCharacterStatus = async (): Promise<void> => {
    const pending = pendingCreateOperationRef.current;
    if (!pending || phaseRef.current === 'committing' || recoveryBusy) return;
    transition('committing');
    setOperationSafetyState('in-progress');
    setStatusMessage('正在查询保存结果…');
    onCommittingChange?.(true);
    try {
      const status = await onQueryCharacterCreateStatus(
        pending.operationId,
        pending.preview,
        pending.baseSnapshot,
        pending.openInstanceId,
      );
      const persisted = readPendingFlaCharacterCreateRecord();
      const hasVerifiedReentryCredential = persisted.kind === 'valid' &&
        samePendingFlaCharacterCreateCredential(persisted.credential, pending.credential);
      const decision = decideFlaCharacterCreateStatus(
        pending.credential,
        status,
        { hasVerifiedReentryCredential },
      );
      if (decision.kind === 'committed' || decision.kind === 'committed-project-not-current') {
        if (!status.ok || status.status !== 'COMMITTED') {
          setOperationOutcome('UNKNOWN');
          setOperationSafetyState('unknown');
          setStatusMessage('保存结果无法与本次操作对应。请保留编号并继续查询。');
          transition('error');
          return;
        }
        completeCommittedOperation(status.result);
        return;
      }
      if (decision.kind === 'in-progress') {
        setOperationOutcome('IN_PROGRESS');
        setOperationSafetyState(decision.operationState);
        setStatusMessage(safeCreateErrorMessage('OPERATION_IN_PROGRESS'));
        transition('error');
        return;
      }
      if (decision.kind === 'failed' || decision.kind === 'not-found') {
        if (!decision.shouldClearCredential || !clearRecoveryCredential(pending.credential)) {
          setOperationOutcome(decision.kind === 'failed' ? 'FAILED' : 'NOT_FOUND');
          setOperationSafetyState('unknown');
          setStatusMessage('保存结果已核对，但本机核对信息未能清理。请保持窗口打开并重试查询。');
          transition('error');
          return;
        }
        pendingCreateOperationRef.current = null;
        operationIdRef.current = null;
        setOperationOutcome(decision.kind === 'failed' ? 'FAILED' : 'NOT_FOUND');
        setOperationSafetyState('terminal');
        setStatusMessage(decision.kind === 'failed' && status.ok && status.status === 'FAILED'
          ? safeCreateErrorMessage(status.error.code)
          : '没有找到本次保存记录。确认角色列表后，可以重新创建。');
        if (status.ok && status.status === 'FAILED' &&
            (status.error.code === 'PLAN_EXPIRED' || status.error.code === 'STALE_PROJECT')) {
          setPreview(null);
          if (status.error.code === 'STALE_PROJECT') invalidatedRef.current = true;
          transition('error');
          return;
        }
        transition('preview-ready');
        return;
      }
      const code = status.ok
        ? status.status === 'FAILED'
          ? status.error.code
          : status.status === 'RECOVERY_REQUIRED'
            ? 'RECOVERY_REQUIRED'
            : undefined
        : status.error.code;
      const outcome = decision.kind === 'conflict'
        ? 'OPERATION_ID_CONFLICT'
        : decision.kind === 'recovery-required'
          ? 'RECOVERY_REQUIRED'
          : 'UNKNOWN';
      setOperationOutcome(outcome);
      setOperationSafetyState(decision.operationState);
      setStatusMessage(code
        ? safeCreateErrorMessage(code)
        : '无法查询保存结果。请重试查询，不要重复创建。');
      transition('error');
    } catch (error) {
      const operationError = error instanceof FlaCharacterCreateOperationError
        ? error
        : null;
      const code = operationError?.code;
      const decision = decideFlaCharacterCreateQueryFailure(code);
      if (decision.kind === 'in-progress') {
        setOperationSafetyState(decision.operationState);
        setOperationOutcome('IN_PROGRESS');
        setStatusMessage(safeCreateErrorMessage(code));
      } else {
        setOperationSafetyState('unknown');
        setOperationOutcome(decision.kind === 'conflict'
          ? 'OPERATION_ID_CONFLICT'
          : decision.kind === 'recovery-required'
            ? 'RECOVERY_REQUIRED'
            : 'UNKNOWN');
        setStatusMessage(code
          ? safeCreateErrorMessage(code)
          : '无法查询保存结果。请重试查询，不要重复创建。');
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
    const credential: PendingFlaCharacterCreateCredential = {
      version: 1,
      operationId,
      projectRoot: baseline.projectRoot,
      projectId: baseline.projectId,
      openInstanceId,
      baseRevision: baseline.revision,
      planId: preview.planId,
      poseIdentity: preview.poseIdentity,
    };
    if (!writePendingFlaCharacterCreateCredential(credential)) {
      setOperationOutcome('UNKNOWN');
      setOperationSafetyState('terminal');
      setStatusMessage('无法保存本机核对信息，本次创建没有开始。');
      transition('error');
      return;
    }
    onRecoveryCredentialChange?.(credential);
    operationIdRef.current = operationId;
    pendingCreateOperationRef.current = {
      operationId,
      preview,
      baseSnapshot,
      openInstanceId,
      credential,
    };
    setOperationOutcome(null);
    setOperationSafetyState('in-progress');
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
      const decision = decideFlaCharacterCreateQueryFailure(code);
      setOperationOutcome(decision.kind === 'conflict'
        ? 'OPERATION_ID_CONFLICT'
        : decision.kind === 'recovery-required'
          ? 'RECOVERY_REQUIRED'
          : decision.kind === 'in-progress'
            ? 'IN_PROGRESS'
            : 'UNKNOWN');
      setOperationSafetyState(decision.operationState);
      setStatusMessage(decision.kind === 'in-progress'
        ? safeCreateErrorMessage('OPERATION_IN_PROGRESS')
        : '创建请求尚未得到最终确认。请查询保存结果，不要重新创建。');
      transition('error');
    } finally {
      onCommittingChange?.(Boolean(pendingCreateOperationRef.current));
    }
  };

  if (typeof document === 'undefined') return null;

  const visibleTargets = candidateEntries;
  const multipleTargets = visibleTargets.length > 1;
  const editablePreview = preview?.ok &&
    preview.status === 'PREVIEW_READY' &&
    preview.capability === 'EDITABLE_PARTS_READY'
    ? preview
    : null;
  const partCount = previewImages?.parts.length ?? editablePreview?.partPreviews.length ?? 0;
  const hasPendingOperation = Boolean(pendingCreateOperationRef.current);
  const pendingCredential = pendingCreateOperationRef.current?.credential ?? null;
  const canCreate = !hasPendingOperation &&
    phase === 'preview-ready' &&
    Boolean(editablePreview) &&
    name.trim().length > 0 &&
    !invalidatedRef.current;
  const canQueryStatus = hasPendingOperation && phase !== 'committing' && !recoveryBusy;
  const centerLoading = phase === 'inspecting' || phase === 'preparing';
  const showPreviewStatus = !centerLoading && phase !== 'preview-ready' && Boolean(statusMessage) &&
    !(operationOutcome === 'RECOVERY_REQUIRED' && recoveryAction);
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
          !shouldBlockFlaCharacterImportClose(
            phaseRef.current,
            Boolean(pendingCreateOperationRef.current),
          )
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
          <div className="fla-character-import-header-copy">
            <h1 data-testid="fla-character-import-title" title={sourceBasename || '选择 FLA 文件'}>
              {sourceBasename || '选择 FLA 文件'}
            </h1>
          </div>
          <div className="fla-character-import-header-actions">
            {phase === 'error' && selectedTarget && sessionIdRef.current && !invalidatedRef.current ? (
              <button
                className="fla-character-import-change-file"
                data-testid="fla-character-import-reprepare"
                disabled={hasPendingOperation}
                onClick={() => void prepareTarget(selectedTarget, selectedFrameIndex, sessionIdRef.current!)}
                type="button"
              >
                重新准备
              </button>
            ) : null}
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
              aria-label={
                phase === 'committing'
                  ? '正在保存角色'
                  : hasPendingOperation
                    ? '保存结果待核对，暂不能关闭'
                    : '关闭'
              }
              className="fla-character-import-close"
              data-testid="fla-character-import-close"
              disabled={phase === 'committing' || hasPendingOperation}
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
                        <small>{entry.target.kind === 'graphic-symbol'
                          ? '独立姿势（首帧）'
                          : enabled ? `${entry.target.frameCount} 个整体姿势` : '暂不可用'}</small>
                        {!enabled ? <small>这个对象目前无法安全还原。</small> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>
          ) : null}

          <main className="fla-character-import-preview-area">
            <div className="fla-character-import-preview-toolbar">
              {selectedTarget && selectedTarget.target.kind === 'scene' && selectedTarget.target.frameCount > 1 ? (
                <label className="fla-character-import-pose-control">
                  <span>整体姿势 · {selectedFrameIndex + 1}/{selectedTarget.target.frameCount}</span>
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

            <div
              className="fla-character-import-preview-workspace"
              data-parts-expanded={partsExpanded}
              data-preview-mode="assembled"
            >
              <div className="fla-character-import-preview-surface">
                {editablePreview && !partsExpanded ? (
                  <FlaCharacterImportPartsControl
                    disabled={hasPendingOperation}
                    expanded={false}
                    onToggle={() => setPartsExpanded(true)}
                    partCount={partCount}
                  />
                ) : null}
                <div className="fla-character-import-preview-canvas" data-testid="fla-character-import-preview">
                  {previewImages && phase !== 'inspecting' && phase !== 'selecting' && phase !== 'preparing' ? (
                    <img
                      alt={phase === 'whole-image-only' ? 'FLA 原始整图（仅供参考）' : '角色组装预览'}
                      className="fla-character-import-reassembled"
                      data-testid={phase === 'whole-image-only' || !previewImages.reassembled
                        ? 'fla-character-import-source'
                        : 'fla-character-import-reassembled'}
                      src={phase === 'whole-image-only' || !previewImages.reassembled
                        ? previewImages.source
                        : previewImages.reassembled}
                    />
                  ) : phase === 'preparing' ? (
                    <p>正在准备角色…</p>
                  ) : phase === 'inspecting' ? (
                    <p>正在读取角色…</p>
                  ) : phase === 'selecting' || selectedTarget ? (
                    <p>选择一个完整源姿势以查看角色预览。</p>
                  ) : (
                    <p>选择一个 FLA 文件以开始。</p>
                  )}
                </div>
              </div>
              {partsExpanded && previewImages && editablePreview ? (
                <aside
                  aria-label="角色零件"
                  className="fla-character-import-parts-panel"
                  id="fla-character-import-parts"
                  data-testid="fla-character-import-parts-panel"
                >
                  <FlaCharacterImportPartsControl
                    disabled={hasPendingOperation}
                    expanded
                    onToggle={() => setPartsExpanded(false)}
                    partCount={partCount}
                  />
                  <ol className="fla-character-import-parts-list">
                    {previewImages.parts.map((part, index) => (
                      <li key={part.sha256}>
                        <span className="fla-character-import-part-thumb">
                          <VisibleBoundsThumbnail
                            alt={`零件 ${index + 1}`}
                            cacheKey={`sha256:${part.sha256}`}
                            src={part.src}
                          />
                        </span>
                        <span>零件 {index + 1}</span>
                      </li>
                    ))}
                  </ol>
                </aside>
              ) : null}
            </div>

            <div className="fla-character-import-preview-feedback">
              {operationOutcome === 'RECOVERY_REQUIRED' && recoveryAction ? recoveryAction : null}
              {showPreviewStatus ? (
                <output
                  aria-live="polite"
                  className="fla-character-import-preview-status"
                  data-testid="fla-character-import-status"
                  role={phase === 'error' || phase === 'unsupported' ? 'alert' : 'status'}
                >
                  {statusMessage}
                </output>
              ) : null}
            </div>
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
            {pendingCredential && operationOutcome !== 'IN_PROGRESS' ? (
              <div className="fla-character-import-recovery-receipt" data-testid="fla-character-import-recovery-receipt">
                <code>{pendingCredential.operationId}</code>
                <button
                  data-testid="fla-character-import-copy-receipt"
                  onClick={() => void copyOperationReceipt(pendingCredential)}
                  type="button"
                >
                  {receiptCopied ? '已复制核对信息' : '复制核对信息'}
                </button>
                {safeExitAvailable ? (
                  <button
                    data-testid="fla-character-import-safe-exit"
                    onClick={() => {
                      onSafeExit?.(pendingCredential.operationId);
                      setStatusMessage('已允许安全关闭。请点击应用窗口右上角关闭按钮；核对记录会保留。');
                    }}
                    type="button"
                  >
                    允许安全关闭并保留核对记录
                  </button>
                ) : null}
              </div>
            ) : null}
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
