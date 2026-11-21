import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useImportFeedbackDismiss } from '../features/assets/useImportFeedbackDismiss';
import type { AnimationImportIR } from '../../shared/fla-import-api';
import { FLA_NO_IMPORTABLE_GRAPHIC, type FlaPartPreviewResponse } from '../../shared/fla-part-preview-api';
import type { FlaRenderTarget } from '../../shared/fla-static-snapshot-api';
import { FlaPreviewFailure } from './FlaPreviewFailure';
import {
  createFlaGraphicInstanceWorkbenchCandidates,
  FlaGraphicImportError,
  type EditableFlaGraphicInstancePreview,
  type ImportFlaGraphicInstance,
} from '../features/fla-import/fla-graphic-instance-import';
import type {
  CreateAdaptiveCharacterFromGraphic,
  CreateAdaptiveCharacterFromGraphicResult,
} from '../features/fla-import/createAdaptiveCharacterFromGraphic';
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
  onCreateCharacterFromGraphic?: CreateAdaptiveCharacterFromGraphic;
  onCharacterCreated?(
    result: Extract<CreateAdaptiveCharacterFromGraphicResult, { ok: true }>,
  ): void;
  onImportingChange?(importing: boolean): boolean | void;
  onRecoveryRequired?(): void;
}

type PreviewFailureKind = 'preview' | 'session-expired' | 'no-main' | 'import' | 'recovery';

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
  onCreateCharacterFromGraphic,
  onCharacterCreated,
  onImportingChange,
  onRecoveryRequired,
}: FlaGraphicInstanceWorkbenchProps): React.JSX.Element {
  const [preview, setPreview] = useState<EditableFlaGraphicInstancePreview | null>(null);
  const [previewContext, setPreviewContext] = useState<string | null>(null);
  const context = JSON.stringify([sessionId, source.sha256, targetRenderTargetId]);
  const [selectedIdentityKey, setSelectedIdentityKey] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [previewUrls, setPreviewUrls] = useState<Readonly<Record<string, string>>>({});
  const [statusMessage, setStatusMessage] = useState('');
  const [previewFailure, setPreviewFailure] = useState<PreviewFailure | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [emptyGraphicList, setEmptyGraphicList] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importingMessage, setImportingMessage] = useState<string | undefined>(undefined);
  const [successNoticeId, setSuccessNoticeId] = useState<number | null>(null);
  const successNoticeIdRef = useRef(0);
  const dismissSuccessNotice = useCallback((id: number) => {
    setSuccessNoticeId((current) => current === id ? null : current);
  }, []);
  const successNoticeHandlers = useImportFeedbackDismiss(successNoticeId, 3_000, dismissSuccessNotice);
  const [planInvalidated, setPlanInvalidated] = useState(false);
  const importingRef = useRef(false);
  const committedCharacterAnimationIdsRef = useRef(new Map<string, string>());
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
    enabled && sessionId && preview && previewContext === context && targetRenderTargetId && selectedCandidate?.selectable &&
    !importDisabledReason && onImportGraphicInstance && !importing && !importLocked && !planInvalidated &&
    (!previewFailure || previewFailure.kind === 'import'),
  );
  const canCreateCharacter = Boolean(
    enabled && sessionId && preview && previewContext === context && targetRenderTargetId && selectedCandidate?.selectable &&
    !importDisabledReason && onCreateCharacterFromGraphic && !importing && !importLocked && !planInvalidated &&
    (!previewFailure || previewFailure.kind === 'import'),
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
    committedCharacterAnimationIdsRef.current.clear();
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
        purpose: 'graphic-instance',
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
      if (response.ok && response.capability !== 'WHOLE_IMAGE_ONLY' &&
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
        setPreviewContext(context);
        heldPlanRef.current = request;
        const graphicCount = validatedPreview.partPreviews.filter((part) =>
          part.sourceKind === 'graphic-symbol-occurrence',
        ).length;
        setEmptyGraphicList(graphicCount === 0);
        setStatusMessage('');
        return;
      }
      if (response.ok && response.capability !== 'WHOLE_IMAGE_ONLY') {
        setPreviewFailure({
          kind: 'preview',
          details: `Preview identity did not match the active request. Response session=${response.sessionId}, generation=${response.generation}; expected session=${sessionId}, generation=${generation}.`,
        });
        setStatusMessage('');
        return;
      }
      if (response.ok) {
        if (response.reason === FLA_NO_IMPORTABLE_GRAPHIC) {
          setEmptyGraphicList(true);
        } else {
          setPreviewFailure({ kind: 'preview', details: response.reason });
        }
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
  }, [cancelRequest, context, importing, importLocked, releaseHeldPlan, selectedCandidate, sessionId, source, targetRenderTargetId]);

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
    if (preview?.sessionId === sessionId && previewContext === context) return;
    if (preparingPreviewRef.current) return;
    void preparePreview();
  }, [context, enabled, preparePreview, preview?.sessionId, previewContext, sessionId, targetLookupPending, targetRenderTargetId]);

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

  useEffect(() => {
    committedCharacterAnimationIdsRef.current.clear();
  }, [sessionId, source?.sha256, context]);

  useEffect(() => () => {
    flowGenerationRef.current += 1;
    committedCharacterAnimationIdsRef.current.clear();
    void cancelRequest(activeRequestRef.current);
    void releaseHeldPlan(heldPlanRef.current);
  }, [cancelRequest, releaseHeldPlan]);

  const importSelected = async (): Promise<void> => {
    if (importingRef.current || !canCommit || !preview || !selectedCandidate || !onImportGraphicInstance) return;
    if (onImportingChange?.(true) === false) return;
    importingRef.current = true;
    setSuccessNoticeId(null);
    let imported = false;
    setImporting(true);
    setImportingMessage('正在导入元件…');
    setPreviewFailure(null);
    setStatusMessage('正在导入元件…');
    try {
      await onImportGraphicInstance(preview, selectedCandidate.operation.unitId);
      imported = true;
      setStatusMessage('');
    } catch (error) {
      const recoveryRequired = error instanceof FlaGraphicImportError && error.code === 'ROLLBACK_FAILED';
      setPlanInvalidated(error instanceof FlaGraphicImportError &&
        (error.code === 'STALE_PLAN' || error.code === 'PROJECT_NOT_TRACKED' ||
          error.code === 'UNSUPPORTED_SOURCE' || error.code === 'ROLLBACK_FAILED'));
      setPreviewFailure({ kind: recoveryRequired ? 'recovery' : 'import', details: diagnosticText(error) });
      setStatusMessage('');
      if (recoveryRequired) onRecoveryRequired?.();
    } finally {
      setImporting(false);
      setImportingMessage(undefined);
      importingRef.current = false;
      onImportingChange?.(false);
    }
    if (imported) {
      setSuccessNoticeId(++successNoticeIdRef.current);
      onImportComplete?.();
    }
  };

  const createCharacterFromSelected = async (): Promise<void> => {
    if (
      importingRef.current ||
      !canCreateCharacter ||
      !preview ||
      !selectedCandidate ||
      !onCreateCharacterFromGraphic
    ) return;
    if (onImportingChange?.(true) === false) return;
    importingRef.current = true;
    setSuccessNoticeId(null);
    let createdResult: Extract<CreateAdaptiveCharacterFromGraphicResult, { ok: true }> | null = null;
    setImporting(true);
    setImportingMessage('正在创建角色…');
    setPreviewFailure(null);
    setStatusMessage('正在创建角色…');
    try {
      const rawName = selectedCandidate.provenance.sourceSymbolId ?? selectedCandidate.displayLabel;
      const characterName = rawName.split(/[\\/]/u).pop()?.trim() || undefined;
      const result = await onCreateCharacterFromGraphic({
        preview,
        unitId: selectedCandidate.operation.unitId,
        ...(characterName ? { characterName } : {}),
        poseFrameOrdinal: 0,
        reusedAnimationId: committedCharacterAnimationIdsRef.current.get(
          selectedCandidate.identityKey,
        ),
      });
      if (!result.ok) {
        if (result.animationId) {
          committedCharacterAnimationIdsRef.current.set(
            selectedCandidate.identityKey,
            result.animationId,
          );
        }
        const recoveryRequired = result.code === 'ROLLBACK_FAILED';
        setPlanInvalidated(
          result.code === 'STALE_PLAN' ||
            result.code === 'PROJECT_NOT_TRACKED' ||
            result.code === 'UNSUPPORTED_SOURCE' ||
            recoveryRequired,
        );
        setPreviewFailure({
          kind: recoveryRequired ? 'recovery' : 'import',
          details: result.message,
        });
        setStatusMessage('');
        if (recoveryRequired) onRecoveryRequired?.();
        return;
      }
      committedCharacterAnimationIdsRef.current.delete(selectedCandidate.identityKey);
      createdResult = result;
      setStatusMessage('');
    } catch (error) {
      setPreviewFailure({ kind: 'import', details: diagnosticText(error) });
      setStatusMessage('');
    } finally {
      setImporting(false);
      setImportingMessage(undefined);
      importingRef.current = false;
      onImportingChange?.(false);
    }
    if (createdResult) {
      onCharacterCreated?.(createdResult);
    }
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
  const previewEmptyContent = previewLoading || isTargetLoading ? (
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
  const requiresReimport = previewFailure?.kind === 'session-expired' || previewFailure?.kind === 'no-main';
  const failure = previewFailure ? (
    <FlaPreviewFailure
      details={previewFailure.details}
      heading={previewFailure.kind === 'recovery' ? '导入未能安全恢复' :
        previewFailure.kind === 'session-expired' ? 'FLA 会话已失效' :
          previewFailure.kind === 'import' ? '导入失败' : '预览加载失败'}
      guidance={previewFailure.kind === 'recovery'
        ? '请关闭此导入并重新打开当前项目；如出现恢复提示，请先处理恢复后再导入。' : undefined}
      onRetry={previewFailure.kind === 'recovery' || (previewFailure.kind === 'import' && !planInvalidated)
        ? undefined : requiresReimport ? onRequestReimport : () => void preparePreview(true)}
      retryDisabled={previewLoading || importing || importLocked}
      retryLabel={requiresReimport ? '重新导入 FLA' : '请重试'}
      retryTestId={requiresReimport ? 'fla-graphic-instance-reimport' : undefined}
      testIdPrefix="fla-graphic-instance"
    />
  ) : undefined;

  return (
    <>
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
      importingMessage={importingMessage}
      importKind="mixed"
      footerAuxiliary={onCreateCharacterFromGraphic ? (
        <button
          data-testid="fla-graphic-instance-create-character"
          disabled={!canCreateCharacter}
          onClick={() => void createCharacterFromSelected()}
          type="button"
        >
          创建为角色
        </button>
      ) : undefined}
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
      previewOverride={failure}
      testIdPrefix="fla-graphic-instance"
      workbenchClassName="fla-graphic-instance-workbench"
      contentClassName="fla-graphic-instance-workbench-content"
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
    {enabled && successNoticeId !== null ? createPortal(
      <output
        key={successNoticeId}
        aria-live="polite"
        className="asset-import-feedback asset-import-feedback-success fla-graphic-instance-success"
        data-testid="fla-graphic-instance-success"
        role="status"
        tabIndex={0}
        {...successNoticeHandlers}
      >
        <span className="asset-import-feedback-summary">已导入元件</span>
      </output>,
      document.body,
    ) : null}
    </>
  );
}
