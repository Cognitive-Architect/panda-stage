import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnimationImportIR } from '../../shared/fla-import-api';
import type { FlaPartPreviewResponse } from '../../shared/fla-part-preview-api';
import type { FlaRenderTarget } from '../../shared/fla-static-snapshot-api';
import {
  createFlaGraphicInstanceWorkbenchCandidates,
  type EditableFlaGraphicInstancePreview,
  type ImportFlaGraphicInstance,
} from '../features/fla-import/fla-graphic-instance-import';
import { FlaUnifiedWorkbench, type FlaUnifiedWorkbenchProgress } from './FlaUnifiedWorkbench';
import type { FlaWorkbenchCandidate } from './fla-workbench-candidates';

interface FlaGraphicInstanceWorkbenchProps {
  enabled: boolean;
  sessionId: string | null;
  source: Pick<AnimationImportIR['source'], 'basename' | 'sha256'>;
  targetRenderTargetId: FlaRenderTarget['renderTargetId'] | null;
  targetLookupPending: boolean;
  importDisabledReason: string | null;
  onImportComplete?(): void;
  onImportGraphicInstance?: ImportFlaGraphicInstance;
  onImportingChange?(importing: boolean): void;
}

interface ActiveRequest {
  requestId: string;
  sessionId: string;
  generation: number;
}

function imageObjectUrl(bytes: Uint8Array): string {
  const copy = Uint8Array.from(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: 'image/png' }));
}

export function FlaGraphicInstanceWorkbench({
  enabled,
  sessionId,
  source,
  targetRenderTargetId,
  targetLookupPending,
  importDisabledReason,
  onImportComplete,
  onImportGraphicInstance,
  onImportingChange,
}: FlaGraphicInstanceWorkbenchProps): React.JSX.Element {
  const [preview, setPreview] = useState<EditableFlaGraphicInstancePreview | null>(null);
  const [selectedIdentityKey, setSelectedIdentityKey] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [previewUrls, setPreviewUrls] = useState<Readonly<Record<string, string>>>({});
  const [statusMessage, setStatusMessage] = useState('');
  const [previewError, setPreviewError] = useState(false);
  const [importing, setImporting] = useState(false);
  const [planInvalidated, setPlanInvalidated] = useState(false);
  const generationBySessionRef = useRef(new Map<string, number>());
  const flowGenerationRef = useRef(0);
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const heldPlanRef = useRef<ActiveRequest | null>(null);

  const candidates = useMemo(
    () => preview && targetRenderTargetId
      ? createFlaGraphicInstanceWorkbenchCandidates(preview, {
          sessionId: preview.sessionId ?? sessionId ?? '',
          source,
          renderTargetId: targetRenderTargetId,
          previewUrls,
          focusedIdentityKey: selectedIdentityKey,
        })
      : [],
    [preview, previewUrls, selectedIdentityKey, sessionId, source, targetRenderTargetId],
  );
  const selectedCandidate = candidates.find((candidate) =>
    candidate.identityKey === selectedIdentityKey,
  ) ?? null;
  const canCommit = Boolean(
    enabled && sessionId && preview && targetRenderTargetId && selectedCandidate?.selectable &&
    !importDisabledReason && onImportGraphicInstance && !importing && !planInvalidated,
  );

  const cancelRequest = useCallback(async (request: ActiveRequest | null): Promise<void> => {
    if (!request) return;
    await window.pandaStage.fla.partPreviewCancel({
      format: 'fla-part-preview-cancel',
      version: 1,
      requestId: request.requestId,
      sessionId: request.sessionId,
      generation: request.generation,
    }).catch(() => undefined);
  }, []);

  const releaseHeldPlan = useCallback(async (request: ActiveRequest | null): Promise<void> => {
    if (!request) return;
    await window.pandaStage.fla.partPreviewCancel({
      format: 'fla-part-preview-cancel',
      version: 1,
      sessionId: request.sessionId,
      generation: request.generation,
    }).catch(() => undefined);
  }, []);

  const preparePreview = useCallback(async (): Promise<void> => {
    if (!sessionId || !targetRenderTargetId) {
      setPreview(null);
      setSelectedIdentityKey(null);
      setPreviewError(true);
      setStatusMessage('FLA 文件中没有可预览的 Main 场景。');
      return;
    }

    const flowGeneration = ++flowGenerationRef.current;
    const active = activeRequestRef.current;
    activeRequestRef.current = null;
    const held = heldPlanRef.current;
    heldPlanRef.current = null;
    setPreview(null);
    setSelectedIdentityKey(null);
    setPreviewUrls({});
    setPreviewError(false);
    setPlanInvalidated(false);
    setStatusMessage('正在读取 Graphic…');
    await Promise.all([cancelRequest(active), releaseHeldPlan(held)]);
    if (flowGenerationRef.current !== flowGeneration) return;

    const generation = (generationBySessionRef.current.get(sessionId) ?? 0) + 1;
    generationBySessionRef.current.set(sessionId, generation);
    const request: ActiveRequest = {
      requestId: crypto.randomUUID(),
      sessionId,
      generation,
    };
    activeRequestRef.current = request;
    try {
      const response: FlaPartPreviewResponse = await window.pandaStage.fla.partPreview({
        format: 'fla-part-preview',
        version: 1,
        requestId: request.requestId,
        sessionId,
        generation,
        target: {
          renderTargetId: targetRenderTargetId,
          selectedFrameIndex: 0,
        },
      });
      if (
        flowGenerationRef.current !== flowGeneration ||
        activeRequestRef.current?.requestId !== request.requestId
      ) return;
      activeRequestRef.current = null;
      if (response.ok && response.capability === 'EDITABLE_PARTS_READY' &&
          response.sessionId === sessionId && response.generation === generation) {
        const validatedPreview: EditableFlaGraphicInstancePreview = {
          ...response,
          sessionId,
          generation,
        };
        setPreview(validatedPreview);
        heldPlanRef.current = request;
        const graphicCount = validatedPreview.partPreviews.filter((part) =>
          part.sourceKind === 'graphic-symbol-occurrence',
        ).length;
        setStatusMessage(graphicCount > 0 ? '' : '未找到 Graphic 对象。');
        return;
      }
      if (response.ok && response.capability === 'EDITABLE_PARTS_READY') {
        setPreviewError(true);
        setStatusMessage('Graphic 预览身份已变化，请重新打开 FLA。');
        return;
      }
      if (response.ok) {
        setPreviewError(true);
        setStatusMessage(response.reason);
        return;
      }
      setPreviewError(true);
      setStatusMessage(response.error.code === 'SESSION_NOT_FOUND'
        ? 'FLA 会话已失效，请重新导入文件。'
        : response.error.message);
    } catch (error) {
      if (flowGenerationRef.current !== flowGeneration) return;
      activeRequestRef.current = null;
      setPreviewError(true);
      setStatusMessage(error instanceof Error ? error.message : '无法读取 Graphic。');
    }
  }, [cancelRequest, releaseHeldPlan, sessionId, targetRenderTargetId]);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    if (!targetRenderTargetId) {
      setPreviewError(!targetLookupPending);
      setStatusMessage(targetLookupPending
        ? '正在读取 Main 场景…'
        : 'FLA 文件中没有可预览的 Main 场景。');
      return;
    }
    if (preview?.sessionId === sessionId) return;
    void preparePreview();
  }, [enabled, preparePreview, preview?.sessionId, sessionId, targetLookupPending, targetRenderTargetId]);

  useEffect(() => {
    if (!preview) return undefined;
    const created: Record<string, string> = {};
    try {
      for (const part of preview.partPreviews) {
        if (part.sourceKind === 'graphic-symbol-occurrence') {
          created[part.unitId] = imageObjectUrl(part.image.bytes);
        }
      }
      setPreviewUrls(created);
    } catch (error) {
      for (const url of Object.values(created)) URL.revokeObjectURL(url);
      setPreviewError(true);
      setStatusMessage(error instanceof Error ? error.message : 'Graphic 预览不可用。');
      return undefined;
    }
    return () => {
      for (const url of Object.values(created)) URL.revokeObjectURL(url);
    };
  }, [preview]);

  useEffect(() => () => {
    flowGenerationRef.current += 1;
    void cancelRequest(activeRequestRef.current);
    void releaseHeldPlan(heldPlanRef.current);
  }, [cancelRequest, releaseHeldPlan]);

  const importSelected = async (): Promise<void> => {
    if (!canCommit || !preview || !selectedCandidate || !onImportGraphicInstance) return;
    let imported = false;
    setImporting(true);
    onImportingChange?.(true);
    setStatusMessage('正在导入 Graphic…');
    try {
      await onImportGraphicInstance(preview, selectedCandidate.operation.unitId);
      imported = true;
    } catch (error) {
      setPlanInvalidated(true);
      setPreviewError(true);
      setStatusMessage(error instanceof Error ? error.message : 'Graphic 导入失败，请重新预览后重试。');
    } finally {
      setImporting(false);
      onImportingChange?.(false);
    }
    if (imported) onImportComplete?.();
  };

  const onFocusCandidate = (candidate: FlaWorkbenchCandidate): void => {
    if (candidate.kind !== 'graphic' || importing) return;
    setSelectedIdentityKey(candidate.identityKey);
    setPreviewError(false);
    setStatusMessage('');
  };
  const progress: FlaUnifiedWorkbenchProgress = {
    phase: targetLookupPending && !preview ? 'loading' : previewError ? 'error' : preview ? 'ready' : 'scanning',
    completed: preview ? candidates.length : 0,
    total: preview ? candidates.length : 0,
    omittedCandidateCount: 0,
  };
  const summary = importDisabledReason || statusMessage || selectedCandidate?.displayLabel || '选择一个 Graphic 查看预览';

  return (
    <FlaUnifiedWorkbench
      candidates={candidates}
      allCandidates={candidates}
      focusedCandidateIdentityKey={selectedIdentityKey}
      multiSelectMode={false}
      searchText={searchText}
      selectedOnly={false}
      selectedCount={0}
      locked={!enabled || importing}
      canImport={false}
      importing={importing}
      importKind="mixed"
      stopAfterCurrentAvailable={false}
      stopAfterCurrentRequested={false}
      bulkConfirmationOpen={false}
      newEligibleCount={0}
      progress={progress}
      progressMessage={statusMessage}
      receipt={null}
      singleModeSummary={summary}
      singleImportLabel="导入到舞台"
      singleImportDisabled={!canCommit}
      showSnapshotPreview={false}
      showSequencePreview={false}
      showMultiSelectControls={false}
      candidateSearchLabel="搜索 Graphic"
      candidateListLabel="Graphic 列表"
      previewSectionLabel="Graphic 预览"
      previewEmptyTitle={previewError ? '预览不可用' : '选择一个 Graphic 查看预览'}
      previewEmptyDescription={statusMessage}
      testIdPrefix="fla-graphic-instance"
      workbenchClassName="fla-graphic-instance-workbench"
      contentClassName="fla-graphic-instance-workbench-content"
      footerAuxiliary={planInvalidated ? (
        <button
          data-testid="fla-graphic-instance-refresh"
          disabled={!sessionId || !targetRenderTargetId || importing}
          onClick={() => void preparePreview()}
          type="button"
        >
          重新预览
        </button>
      ) : null}
      snapshotPreview={null}
      sequencePreview={null}
      onSearchTextChange={setSearchText}
      onToggleMultiSelectMode={() => undefined}
      onToggleSelectedOnly={() => undefined}
      onFocusCandidate={onFocusCandidate}
      onToggleCandidate={() => undefined}
      onSelectCurrentResults={() => undefined}
      onConfirmBulkSelection={() => undefined}
      onCancelBulkSelection={() => undefined}
      onClearSelection={() => undefined}
      onImport={() => undefined}
      onImportFocused={() => void importSelected()}
      onStopAfterCurrent={() => undefined}
    />
  );
}
