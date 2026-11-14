import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ImageOff, Info, RotateCcw } from 'lucide-react';
import type { AnimationImportIR } from '../../shared/fla-import-api';
import type { FlaPartPreviewResponse } from '../../shared/fla-part-preview-api';
import type { FlaRenderTarget } from '../../shared/fla-static-snapshot-api';
import { IconButton } from '../ui';
import {
  createFlaGraphicInstanceWorkbenchCandidates,
  type EditableFlaGraphicInstancePreview,
  type ImportFlaGraphicInstance,
} from '../features/fla-import/fla-graphic-instance-import';
import { FlaUnifiedWorkbench, type FlaUnifiedWorkbenchProgress } from './FlaUnifiedWorkbench';
import type { FlaWorkbenchCandidate } from './fla-workbench-candidates';

interface FlaGraphicInstanceWorkbenchProps {
  enabled: boolean;
  importLocked?: boolean;
  sessionId: string | null;
  source: Pick<AnimationImportIR['source'], 'basename' | 'sha256'>;
  targetRenderTargetId: FlaRenderTarget['renderTargetId'] | null;
  targetLookupPending: boolean;
  importDisabledReason: string | null;
  onImportComplete?(): void;
  onRequestReimport?(): void;
  onImportGraphicInstance?: ImportFlaGraphicInstance;
  onImportingChange?(importing: boolean): boolean | void;
}

type PreviewFailureKind = 'preview' | 'session-expired' | 'no-main' | 'import';

interface PreviewFailure {
  kind: PreviewFailureKind;
  details: string;
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

function diagnosticText(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function FlaGraphicInstanceWorkbench({
  enabled,
  importLocked = false,
  sessionId,
  source,
  targetRenderTargetId,
  targetLookupPending,
  importDisabledReason,
  onImportComplete,
  onRequestReimport,
  onImportGraphicInstance,
  onImportingChange,
}: FlaGraphicInstanceWorkbenchProps): React.JSX.Element {
  const [preview, setPreview] = useState<EditableFlaGraphicInstancePreview | null>(null);
  const [selectedIdentityKey, setSelectedIdentityKey] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [previewUrls, setPreviewUrls] = useState<Readonly<Record<string, string>>>({});
  const [statusMessage, setStatusMessage] = useState('');
  const [previewFailure, setPreviewFailure] = useState<PreviewFailure | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [emptyGraphicList, setEmptyGraphicList] = useState(false);
  const [importing, setImporting] = useState(false);
  const [planInvalidated, setPlanInvalidated] = useState(false);
  const generationBySessionRef = useRef(new Map<string, number>());
  const flowGenerationRef = useRef(0);
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const heldPlanRef = useRef<ActiveRequest | null>(null);
  const preparingPreviewRef = useRef(false);

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
    !importDisabledReason && onImportGraphicInstance && !importing && !importLocked && !planInvalidated &&
    !previewFailure,
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

  const preparePreview = useCallback(async (focusGraphicAfterReset = false): Promise<void> => {
    if (!sessionId || !targetRenderTargetId) {
      setPreview(null);
      setSelectedIdentityKey(null);
      setPreviewUrls({});
      setPreviewLoading(false);
      setEmptyGraphicList(false);
      setPreviewFailure({
        kind: sessionId ? 'no-main' : 'session-expired',
        details: sessionId ? 'Main scene render target was unavailable.' : 'FLA session is no longer available.',
      });
      setStatusMessage('');
      return;
    }
    if (preparingPreviewRef.current || importing || importLocked) return;

    preparingPreviewRef.current = true;
    const flowGeneration = ++flowGenerationRef.current;
    const active = activeRequestRef.current;
    activeRequestRef.current = null;
    const held = heldPlanRef.current;
    heldPlanRef.current = null;
    setPreview(null);
    setSelectedIdentityKey(null);
    setPreviewUrls({});
    setPreviewFailure(null);
    setPreviewLoading(true);
    setEmptyGraphicList(false);
    setPlanInvalidated(false);
    setStatusMessage('正在加载预览…');
    try {
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
        if (focusGraphicAfterReset) {
          const refreshedCandidates = createFlaGraphicInstanceWorkbenchCandidates(validatedPreview, {
            sessionId,
            source,
            renderTargetId: targetRenderTargetId,
            previewUrls: {},
            focusedIdentityKey: null,
          });
          const previousUnitId = selectedCandidate?.operation.unitId;
          const candidateToFocus = refreshedCandidates.find((candidate) =>
            candidate.selectable && candidate.operation.unitId === previousUnitId,
          ) ?? refreshedCandidates.find((candidate) => candidate.selectable) ?? refreshedCandidates[0];
          setSelectedIdentityKey(candidateToFocus?.identityKey ?? null);
        }
        setPreview(validatedPreview);
        heldPlanRef.current = request;
        const graphicCount = validatedPreview.partPreviews.filter((part) =>
          part.sourceKind === 'graphic-symbol-occurrence',
        ).length;
        setEmptyGraphicList(graphicCount === 0);
        setStatusMessage('');
        return;
      }
      if (response.ok && response.capability === 'EDITABLE_PARTS_READY') {
        setPreviewFailure({
          kind: 'preview',
          details: `Preview identity did not match the active request. Response session=${response.sessionId}, generation=${response.generation}; expected session=${sessionId}, generation=${generation}.`,
        });
        setStatusMessage('');
        return;
      }
      if (response.ok) {
        setPreviewFailure({
          kind: 'preview',
          details: `${response.status}: ${response.reason}`,
        });
        setStatusMessage('');
        return;
      }
      setPreviewFailure({
        kind: response.error.code === 'SESSION_NOT_FOUND' ? 'session-expired' : 'preview',
        details: `${response.error.code}: ${response.error.message}`,
      });
      setStatusMessage('');
    } catch (error) {
      if (flowGenerationRef.current !== flowGeneration) return;
      activeRequestRef.current = null;
      setPreviewFailure({ kind: 'preview', details: diagnosticText(error) });
      setStatusMessage('');
    } finally {
      if (flowGenerationRef.current === flowGeneration) {
        preparingPreviewRef.current = false;
        setPreviewLoading(false);
      }
    }
  }, [cancelRequest, importing, importLocked, releaseHeldPlan, selectedCandidate, sessionId, source, targetRenderTargetId]);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    if (!targetRenderTargetId) {
      if (targetLookupPending) {
        setStatusMessage('正在加载预览…');
        return;
      }
      setPreviewFailure({ kind: 'no-main', details: 'Main scene render target was unavailable.' });
      setStatusMessage('');
      return;
    }
    if (preview?.sessionId === sessionId) return;
    if (preparingPreviewRef.current) return;
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
      setPreview(null);
      setSelectedIdentityKey(null);
      setPlanInvalidated(true);
      setPreviewFailure({ kind: 'preview', details: diagnosticText(error) });
      setStatusMessage('');
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
    if (onImportingChange?.(true) === false) return;
    let imported = false;
    setImporting(true);
    setStatusMessage('正在导入元件…');
    try {
      await onImportGraphicInstance(preview, selectedCandidate.operation.unitId);
      imported = true;
    } catch (error) {
      setPlanInvalidated(true);
      setPreviewFailure({ kind: 'import', details: diagnosticText(error) });
      setStatusMessage('导入失败');
    } finally {
      setImporting(false);
      onImportingChange?.(false);
    }
    if (imported) onImportComplete?.();
  };

  const onFocusCandidate = (candidate: FlaWorkbenchCandidate): void => {
    if (candidate.kind !== 'graphic' || importing || importLocked || planInvalidated) return;
    setSelectedIdentityKey(candidate.identityKey);
    setPreviewFailure(null);
    setStatusMessage('');
  };
  const isTargetLoading = targetLookupPending && !targetRenderTargetId;
  const progress: FlaUnifiedWorkbenchProgress = {
    phase: previewLoading || isTargetLoading ? 'loading' : previewFailure ? 'error' : preview ? 'ready' : 'scanning',
    completed: preview ? candidates.length : 0,
    total: preview ? candidates.length : 0,
    omittedCandidateCount: 0,
  };
  const summary = previewFailure?.kind === 'import'
    ? statusMessage
    : previewFailure || emptyGraphicList || previewLoading || isTargetLoading
      ? ''
      : importDisabledReason || selectedCandidate?.displayLabel || '选择一个元件查看预览';
  const previewEmptyContent = previewFailure ? (
    <div className="fla-c03-preview-placeholder fla-graphic-preview-failure" data-testid="fla-graphic-instance-preview-failure" role="alert">
      <ImageOff aria-hidden="true" size={22} />
      <strong>{previewFailure.kind === 'session-expired' ? 'FLA 会话已失效' : '预览加载失败'}</strong>
    </div>
  ) : previewLoading || isTargetLoading ? (
    <div className="fla-c03-preview-placeholder" data-testid="fla-graphic-instance-preview-loading" role="status">
      <strong>正在加载预览…</strong>
    </div>
  ) : emptyGraphicList ? (
    <div className="fla-c03-preview-placeholder" data-testid="fla-graphic-instance-preview-empty" role="status">
      <strong>未找到元件</strong>
    </div>
  ) : (
    <div className="fla-c03-preview-placeholder" data-testid="fla-graphic-instance-preview-empty" role="status">
      <strong>选择一个元件查看预览</strong>
    </div>
  );
  const previewFailureDetails = previewFailure ? (
    <details className="fla-c03-preview-diagnostics" data-testid="fla-graphic-instance-error-details">
      <summary>
        <Info aria-hidden="true" size={14} />
        <span>详细信息</span>
        <ChevronDown aria-hidden="true" className="fla-c03-preview-diagnostics-chevron" size={14} />
      </summary>
      <pre>{previewFailure.details}</pre>
    </details>
  ) : undefined;
  const retryAction = previewFailure ? (
    previewFailure.kind === 'session-expired' || previewFailure.kind === 'no-main' ? (
      <button
        className="fla-c03-graphic-reimport"
        data-testid="fla-graphic-instance-reimport"
        disabled={!onRequestReimport || importing || importLocked}
        onClick={onRequestReimport}
        type="button"
      >
        重新导入 FLA
      </button>
    ) : (
      <div className="fla-c03-graphic-retry">
        <span>请重试</span>
        <IconButton
          aria-label="重置预览"
          className="fla-c03-graphic-reset"
          data-testid="fla-graphic-instance-reset-preview"
          disabled={previewLoading || importing || importLocked || !sessionId || !targetRenderTargetId}
          icon={<RotateCcw size={16} />}
          onClick={() => void preparePreview(true)}
          title="重置预览"
        />
      </div>
    )
  ) : null;

  return (
    <FlaUnifiedWorkbench
      candidates={candidates}
      allCandidates={candidates}
      focusedCandidateIdentityKey={selectedIdentityKey}
      multiSelectMode={false}
      searchText={searchText}
      selectedOnly={false}
      selectedCount={0}
      locked={!enabled || importing || importLocked}
      canImport={false}
      importing={importing}
      importKind="mixed"
      stopAfterCurrentAvailable={false}
      stopAfterCurrentRequested={false}
      bulkConfirmationOpen={false}
      newEligibleCount={0}
      progress={progress}
      progressMessage={previewFailure || previewLoading || isTargetLoading ? '' : undefined}
      receipt={null}
      singleModeSummary={summary}
      singleImportLabel="导入此元件"
      singleImportDisabled={!canCommit}
      showSnapshotPreview={false}
      showSequencePreview={false}
      showMultiSelectControls={false}
      candidateSearchLabel="搜索元件"
      candidateListLabel="元件列表"
      candidateEmptyMessage={null}
      graphicKindLabel="元件"
      previewSectionLabel="元件预览"
      previewEmptyContent={previewEmptyContent}
      previewAuxiliary={previewFailureDetails}
      testIdPrefix="fla-graphic-instance"
      workbenchClassName="fla-graphic-instance-workbench"
      contentClassName="fla-graphic-instance-workbench-content"
      footerAuxiliary={retryAction}
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
