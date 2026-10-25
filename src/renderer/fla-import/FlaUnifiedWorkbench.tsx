import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { FlaUnifiedImportReceipt } from './fla-unified-import';
import { readableFlaCandidateLabel, type FlaWorkbenchCandidate } from './fla-workbench-candidates';
import { filterFlaUnifiedCandidates } from './fla-unified-workbench-selection';

const SINGLE_SUCCESS_RECEIPT_DURATION_MS = 2_400;

export interface FlaUnifiedWorkbenchProgress {
  phase: 'loading' | 'scanning' | 'ready' | 'error';
  completed: number;
  total: number;
  omittedCandidateCount: number;
}

interface FlaUnifiedWorkbenchProps {
  candidates: readonly FlaWorkbenchCandidate[];
  allCandidates: readonly FlaWorkbenchCandidate[];
  focusedCandidateIdentityKey: string | null;
  multiSelectMode: boolean;
  searchText: string;
  selectedOnly: boolean;
  selectedCount: number;
  locked: boolean;
  canImport: boolean;
  importing: boolean;
  stopAfterCurrentRequested: boolean;
  bulkConfirmationOpen: boolean;
  newEligibleCount: number;
  progress: FlaUnifiedWorkbenchProgress;
  receipt: FlaUnifiedImportReceipt | null;
  singleModeSummary: string | null;
  singleImportLabel: string | null;
  singleImportDisabled: boolean;
  showSnapshotPreview: boolean;
  showSequencePreview: boolean;
  snapshotPreview: ReactNode;
  sequencePreview: ReactNode;
  onSearchTextChange: (value: string) => void;
  onToggleMultiSelectMode: () => void;
  onToggleSelectedOnly: () => void;
  onFocusCandidate: (candidate: FlaWorkbenchCandidate) => void;
  onToggleCandidate: (candidate: FlaWorkbenchCandidate, checked: boolean) => void;
  onSelectCurrentResults: () => void;
  onConfirmBulkSelection: () => void;
  onCancelBulkSelection: () => void;
  onClearSelection: () => void;
  onImport: () => void;
  onImportFocused: () => void;
  onStopAfterCurrent: () => void;
}

export function FlaUnifiedWorkbench({
  candidates,
  allCandidates,
  focusedCandidateIdentityKey,
  multiSelectMode,
  searchText,
  selectedOnly,
  selectedCount,
  locked,
  canImport,
  importing,
  stopAfterCurrentRequested,
  bulkConfirmationOpen,
  newEligibleCount,
  progress,
  receipt,
  singleModeSummary,
  singleImportLabel,
  singleImportDisabled,
  showSnapshotPreview,
  showSequencePreview,
  snapshotPreview,
  sequencePreview,
  onSearchTextChange,
  onToggleMultiSelectMode,
  onToggleSelectedOnly,
  onFocusCandidate,
  onToggleCandidate,
  onSelectCurrentResults,
  onConfirmBulkSelection,
  onCancelBulkSelection,
  onClearSelection,
  onImport,
  onImportFocused,
  onStopAfterCurrent,
}: FlaUnifiedWorkbenchProps): React.JSX.Element {
  const [previewZoom, setPreviewZoom] = useState(1);
  const candidateGridRef = useRef<HTMLUListElement | null>(null);
  const browseScrollTopRef = useRef(0);
  const restoreBrowseScrollRef = useRef(false);
  const visibleCandidates = filterFlaUnifiedCandidates(candidates, searchText, selectedOnly);
  const focusedCandidate = candidates.find((candidate) =>
    candidate.identityKey === focusedCandidateIdentityKey,
  ) ?? null;
  const activeSequenceRenderCandidate = candidates.find((candidate) =>
    candidate.kind === 'sequence' && candidate.preview.status === 'checking',
  ) ?? null;
  const previewCandidate = activeSequenceRenderCandidate ?? focusedCandidate;
  const previewCandidateLabel = previewCandidate
    ? readableFlaCandidateLabel(previewCandidate.displayLabel)
    : null;
  const relatedSnapshot = focusedCandidate?.kind === 'sequence'
    ? allCandidates.find((candidate) => candidate.kind === 'snapshot' &&
      candidate.provenance.renderTargetId === focusedCandidate.provenance.renderTargetId) ?? null
    : null;
  const status = activeSequenceRenderCandidate
    ? null
    : focusedCandidate ? focusedCandidateStatus(focusedCandidate) : null;
  const canZoom = Boolean(focusedCandidate?.preview.previewUrl || showSnapshotPreview || showSequencePreview);

  useLayoutEffect(() => {
    if (selectedOnly) return;
    if (restoreBrowseScrollRef.current && candidateGridRef.current) {
      candidateGridRef.current.scrollTop = browseScrollTopRef.current;
      restoreBrowseScrollRef.current = false;
    }
  }, [selectedOnly, visibleCandidates.length]);

  const toggleSelectedView = (): void => {
    if (!selectedOnly) {
      browseScrollTopRef.current = candidateGridRef.current?.scrollTop ?? 0;
    } else {
      restoreBrowseScrollRef.current = true;
    }
    onToggleSelectedOnly();
  };

  const updateZoom = (delta: number): void => {
    setPreviewZoom((current) => Math.min(2.5, Math.max(0.5, Math.round((current + delta) * 100) / 100)));
  };

  const renderPreview = (): ReactNode => {
    if (!focusedCandidate) {
      return (
        <div className="fla-c03-preview-placeholder" data-testid="fla-c03-preview-empty">
          <strong>{progress.phase === 'loading' ? '正在读取素材…' : '选择一个素材查看预览'}</strong>
          <span>{progress.phase === 'scanning' ? '正在加载素材…' : '单击缩略图只会打开预览。'}</span>
        </div>
      );
    }

    if (focusedCandidate.kind === 'raster') {
      return focusedCandidate.preview.previewUrl ? (
        <img
          alt={focusedCandidate.displayLabel}
          className="fla-c03-preview-image"
          data-testid="fla-c03-focused-raster-preview"
          src={focusedCandidate.preview.previewUrl}
          style={{ transform: `scale(${previewZoom})` }}
        />
      ) : <PreviewPlaceholder candidate={focusedCandidate} />;
    }

    if (focusedCandidate.kind === 'snapshot' || focusedCandidate.kind === 'sequence') {
      if (focusedCandidate.kind === 'snapshot' && !focusedCandidate.selectable) {
        return <PreviewPlaceholder candidate={focusedCandidate} />;
      }
      if (focusedCandidate.kind === 'sequence' &&
        (!focusedCandidate.supported || focusedCandidate.blank || focusedCandidate.preview.status === 'error' || !relatedSnapshot?.selectable)) {
        return <PreviewPlaceholder candidate={focusedCandidate} />;
      }
      return null;
    }
    return <PreviewPlaceholder candidate={focusedCandidate} />;
  };

  return (
    <>
      <main
        className="fla-c03-workbench"
        data-multi-select={multiSelectMode ? 'true' : 'false'}
        data-sequence-preview={showSequencePreview ? 'true' : undefined}
        data-testid="fla-c03-workbench"
      >
        <section className="fla-c03-browser" aria-label="素材列表">
          <div className="fla-c03-browser-tools">
            <label className="fla-c03-search">
              <span className="sr-only">搜索素材</span>
              <input
                aria-label="搜索素材"
                data-testid="fla-c03-search"
                disabled={selectedOnly || locked}
                onChange={(event) => onSearchTextChange(event.currentTarget.value)}
                placeholder={selectedOnly ? '返回浏览后继续搜索' : '搜索素材'}
                type="search"
                value={searchText}
              />
            </label>
            <button
              aria-label={multiSelectMode ? '返回单素材模式' : '进入多选模式'}
              aria-pressed={multiSelectMode}
              data-testid="fla-c03-multi-select-toggle"
              disabled={locked || (multiSelectMode && selectedCount > 0)}
              onClick={onToggleMultiSelectMode}
              type="button"
            >
              {multiSelectMode ? '单素材' : '多选'}
            </button>
            {multiSelectMode ? (
              <>
                <button
                  aria-label="全选当前结果"
                  data-testid="fla-c03-select-current-results"
                  disabled={locked || selectedOnly || visibleCandidates.every((candidate) => !candidate.selectable || candidate.checked)}
                  onClick={onSelectCurrentResults}
                  type="button"
                >
                  全选
                </button>
                <button
                  aria-label="清空全部已选素材"
                  data-testid="fla-c03-clear-selection"
                  disabled={locked || selectedCount === 0}
                  onClick={onClearSelection}
                  type="button"
                >
                  清空
                </button>
                <button
                  aria-label={selectedOnly ? '返回浏览' : `查看已选 ${selectedCount}`}
                  aria-pressed={selectedOnly}
                  data-testid="fla-c03-selected-view"
                  disabled={(!selectedOnly && selectedCount === 0) || locked}
                  onClick={toggleSelectedView}
                  type="button"
                >
                  {selectedOnly ? '返回浏览' : `已选 ${selectedCount}`}
                </button>
                {selectedOnly && searchText.trim() ? (
                  <output className="fla-c03-selected-view-status" data-testid="fla-c03-selected-view-status" role="status">
                    正在查看已选 · 搜索已暂停
                  </output>
                ) : null}
              </>
            ) : null}
          </div>

          {multiSelectMode && bulkConfirmationOpen ? (
            <div className="fla-c03-bulk-confirmation" data-testid="fla-c03-bulk-confirmation" role="group" aria-label="确认批量选择">
              <span>即将勾选 {newEligibleCount} 项素材，暂不会导入。</span>
              <button type="button" disabled={newEligibleCount === 0 || locked} onClick={onConfirmBulkSelection} data-testid="fla-c03-bulk-confirm">
                确认勾选
              </button>
              <button type="button" onClick={onCancelBulkSelection} data-testid="fla-c03-bulk-cancel">
                取消
              </button>
            </div>
          ) : null}

          <output
            aria-live={progress.phase === 'ready' && progress.omittedCandidateCount === 0 ? undefined : 'polite'}
            className="fla-c03-progress"
            data-testid="fla-c03-catalog-progress"
          >
            {progress.phase === 'scanning'
              ? '正在加载素材…'
              : progress.phase === 'loading'
                ? '正在加载素材…'
                : progress.phase === 'error'
                  ? '部分素材预览未能读取。'
                  : progress.omittedCandidateCount > 0
                    ? `另有 ${progress.omittedCandidateCount} 项未列出，这些项目不能导入。`
                    : ''}
          </output>

          <ul
            aria-label={selectedOnly ? '已选择素材' : 'FLA 素材'}
            className="fla-c03-candidate-grid"
            data-testid="fla-c03-candidate-grid"
            data-view={selectedOnly ? 'selected' : 'browse'}
            onScroll={(event) => {
              if (!selectedOnly) browseScrollTopRef.current = event.currentTarget.scrollTop;
            }}
            ref={candidateGridRef}
            role="list"
          >
            {visibleCandidates.length > 0 ? visibleCandidates.map((candidate) => {
              const thumbnail = candidatePreviewUrl(candidate, allCandidates);
              const fullItemLabel = candidate.displayLabel;
              const cardLabel = candidate.cardLabel ?? candidate.displayLabel;
              const itemLabel = cardLabel;
              const statusLabel = candidate.kind === 'sequence' &&
                (candidate.preview.status === 'verified' || candidate.preview.status === 'unscanned' || candidate.preview.status === 'checking')
                ? ''
                : candidateStatus(candidate);
              return (
                <li
                  className={`fla-c03-candidate${candidate.identityKey === focusedCandidateIdentityKey ? ' is-focused' : ''}${candidate.checked ? ' is-checked' : ''}`}
                  data-candidate-kind={candidate.kind}
                  data-candidate-identity={candidate.identityKey}
                  data-preview-status={candidate.preview.status}
                  data-selectable={candidate.selectable ? 'true' : 'false'}
                  key={candidate.identityKey}
                  role="listitem"
                >
                  <button
                    aria-label={`预览 ${fullItemLabel}`}
                    aria-pressed={candidate.identityKey === focusedCandidateIdentityKey}
                    className="fla-c03-candidate-focus"
                    data-testid={`fla-c03-focus-${candidate.kind}-${candidate.id}`}
                    onClick={() => onFocusCandidate(candidate)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onFocusCandidate(candidate);
                    }}
                    type="button"
                  >
                    <span className="fla-c03-thumbnail">
                      {thumbnail ? (
                        <img alt="" loading="lazy" decoding="async" src={thumbnail} />
                      ) : candidate.kind === 'sequence' && candidate.preview.status === 'checking' ? null : (
                        <span>{thumbnailPlaceholder(candidate)}</span>
                      )}
                    </span>
                    <span className="fla-c03-candidate-copy">
                      <strong title={fullItemLabel}>{itemLabel}</strong>
                      <small className="fla-c03-candidate-kind">{candidate.kind === 'sequence' ? '动画' : '图片'}</small>
                      {statusLabel ? <small data-status={candidate.preview.status}>{statusLabel}</small> : null}
                    </span>
                  </button>
                  {multiSelectMode ? (
                    <label className="fla-c03-checkbox-hitbox">
                      <input
                        aria-label={`选择 ${fullItemLabel}`}
                        checked={candidate.checked}
                        disabled={!candidate.selectable || locked}
                        onChange={(event) => onToggleCandidate(candidate, event.currentTarget.checked)}
                        onKeyDown={(event) => {
                          if ((event.key !== ' ' && event.code !== 'Space') || event.repeat) return;
                          event.preventDefault();
                          onToggleCandidate(candidate, !candidate.checked);
                        }}
                        type="checkbox"
                      />
                      <span className="sr-only">选择 {itemLabel}</span>
                    </label>
                  ) : null}
                </li>
              );
            }) : (
              <li className="fla-c03-empty-state" data-testid="fla-c03-empty-state">
                {selectedOnly ? '还没有已选择的素材。' : searchText.trim() ? '没有找到匹配的素材。' : '暂时没有可显示的素材。'}
              </li>
            )}
          </ul>
        </section>

        <section
          aria-label="素材预览"
          className="fla-c03-preview"
          data-candidate-kind={focusedCandidate?.kind ?? 'none'}
          data-preview-status={focusedCandidate?.preview.status ?? 'empty'}
          data-sequence-canvas={focusedCandidate?.kind === 'sequence' && showSequencePreview ? 'true' : 'false'}
          data-sequence-preview={showSequencePreview ? 'true' : 'false'}
          data-testid="fla-c03-preview"
          style={{ '--fla-c03-zoom': previewZoom } as CSSProperties}
        >
          <header className="fla-c03-preview-header">
            <div className="fla-c03-preview-title">
              <h2
                data-preview-owner={activeSequenceRenderCandidate ? 'active-render' : 'focused-candidate'}
                data-testid="fla-c03-focused-label"
              >
                {previewCandidateLabel ?? '预览'}
              </h2>
              {status ? <output data-testid="fla-c03-focused-status">{status}</output> : null}
            </div>
            <div className="fla-c03-zoom-tools" role="group" aria-label="预览缩放">
              <button aria-label="缩小预览" disabled={!canZoom} onClick={() => updateZoom(-0.25)} type="button">−</button>
              <button
                aria-label="恢复默认预览大小"
                disabled={!canZoom}
                onClick={() => setPreviewZoom(1)}
                title="恢复默认预览大小"
                type="button"
              >
                适中
              </button>
              <button aria-label="放大预览" disabled={!canZoom} onClick={() => updateZoom(0.25)} type="button">+</button>
            </div>
          </header>
          <div
            className="fla-c03-preview-stage"
            data-testid="fla-c03-preview-stage"
            style={{ '--fla-c03-zoom': previewZoom } as CSSProperties}
          >
            {renderPreview()}
            <div className="fla-c03-preview-controller-slot" hidden={!showSnapshotPreview}>
              {snapshotPreview}
            </div>
          </div>
          <div
            className="fla-c03-sequence-preview-slot"
            data-testid="fla-c03-sequence-preview-slot"
            hidden={!showSequencePreview}
          >
            {sequencePreview}
          </div>
        </section>
      </main>

      <footer className="fla-c03-import-footer" data-testid="fla-c03-import-footer">
        <div className="fla-c03-footer-summary">
          <strong data-testid={multiSelectMode ? 'fla-unified-import-selected-count' : 'fla-single-mode-summary'}>
            {importing
              ? stopAfterCurrentRequested
                ? '当前操作完成后将停止后续导入'
                : multiSelectMode ? `正在导入已选 ${selectedCount} 项…` : '正在导入当前素材…'
              : multiSelectMode ? `已选择 ${selectedCount} 项` : singleModeSummary ?? '选择一个素材查看预览'}
          </strong>
          {importing ? <span>当前操作结束后停止，已完成的结果会保留。</span> : null}
        </div>
        <div className="fla-c03-footer-actions">
          {importing ? (
            <button
              data-testid="fla-unified-import-stop"
              disabled={stopAfterCurrentRequested}
              onClick={onStopAfterCurrent}
              type="button"
            >
              {stopAfterCurrentRequested ? '已请求停止' : '停止后续导入'}
            </button>
          ) : multiSelectMode ? (
            <button
              className="fla-c03-import-primary"
              data-testid="fla-unified-import"
              disabled={!canImport || selectedCount === 0}
              onClick={onImport}
              type="button"
            >
              导入所选 {selectedCount} 项
            </button>
          ) : singleImportLabel ? (
            <button
              className="fla-c03-import-primary"
              data-testid="fla-single-import"
              disabled={singleImportDisabled || locked}
              onClick={onImportFocused}
              type="button"
            >
              {singleImportLabel}
            </button>
          ) : null}
        </div>
        {receipt ? <ImportReceipt receipt={receipt} /> : null}
      </footer>
    </>
  );
}

function ImportReceipt({ receipt }: { receipt: FlaUnifiedImportReceipt }): React.JSX.Element | null {
  const [dismissedReceipt, setDismissedReceipt] = useState<FlaUnifiedImportReceipt | null>(null);
  const cleanSingleSuccess = isCleanSingleItemSuccess(receipt);
  const hasDiagnostics = receipt.warnings.length > 0 || receipt.items.some((item) => item.message);

  useEffect(() => {
    if (!cleanSingleSuccess) return undefined;
    const timeoutId = window.setTimeout(
      () => setDismissedReceipt(receipt),
      SINGLE_SUCCESS_RECEIPT_DURATION_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [cleanSingleSuccess, receipt]);

  if (cleanSingleSuccess) {
    if (dismissedReceipt === receipt) return null;
    return (
      <output
        aria-live="polite"
        className="fla-c03-receipt-transient"
        data-testid="fla-unified-import-receipt"
        role="status"
      >
        {receiptSummary(receipt)}
      </output>
    );
  }

  return (
    <details
      className="fla-c03-receipt"
      data-partial={receipt.partial ? 'true' : 'false'}
      data-testid="fla-unified-import-receipt"
      open={receipt.partial}
    >
      <summary>
        {receiptSummary(receipt)}
      </summary>
      <div className="fla-c03-receipt-details">
        <output data-testid="fla-unified-import-counts">
          共处理 {receipt.selectedCount} 项；新建素材 {receipt.counts.importedAssets} 项、复用素材 {receipt.counts.duplicateAssets} 项。
        </output>
        {receipt.cancelled ? <span data-testid="fla-unified-import-cancelled">已停止后续导入。</span> : null}
        {receipt.counts.failed > 0 ? (
          <p data-testid="fla-unified-import-review-guidance" role="alert">
            有 {receipt.counts.failed} 项导入结果需要核对。请先检查素材库，避免重复导入。
          </p>
        ) : receipt.warnings.length > 0 ? (
          <p data-testid="fla-unified-import-review-guidance" role="alert">
            导入过程中有需要核对的提示，请展开技术详情。
          </p>
        ) : null}
        {receipt.counts.notAttempted > 0 ? (
          <span data-testid="fla-unified-import-not-attempted">
            {receipt.counts.notAttempted} 项未尝试导入。
          </span>
        ) : null}
        <ul data-testid="fla-unified-import-items">
          {receipt.items.map((item) => (
            <li data-kind={item.kind} data-status={item.status} key={item.key}>
              <strong>{item.label}</strong>
              <span>{item.status === 'imported' ? '已导入' : item.status === 'duplicate' ? '已复用' : item.status === 'failed' ? '失败' : '未尝试'}</span>
              {item.baseRevision !== undefined && item.savedRevision !== undefined
                ? <small>项目版本 {item.baseRevision} → {item.savedRevision}</small>
                : null}
              {item.status === 'failed' ? (
                <small>请先检查素材库，再决定下一步，避免重复导入。</small>
              ) : item.status === 'not-attempted' ? (
                <small>此项未尝试导入。</small>
              ) : null}
            </li>
          ))}
        </ul>
        {hasDiagnostics ? (
          <details className="fla-c03-receipt-diagnostics" data-testid="fla-unified-import-diagnostics">
            <summary>技术详情</summary>
            <div>
              {receipt.warnings.length > 0 ? (
                <ul aria-label="导入提示">
                  {receipt.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
                </ul>
              ) : null}
              {receipt.items.some((item) => item.message) ? (
                <ul aria-label="项目诊断信息">
                  {receipt.items.filter((item) => item.message).map((item) => (
                    <li key={item.key}>
                      <strong>{item.label}</strong>
                      <code>{item.message}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
}

export function isCleanSingleItemSuccess(receipt: FlaUnifiedImportReceipt): boolean {
  const [item] = receipt.items;
  if (
    receipt.selectedCount !== 1 ||
    receipt.items.length !== 1 ||
    receipt.partial ||
    receipt.cancelled ||
    receipt.warnings.length > 0 ||
    receipt.counts.failed !== 0 ||
    receipt.counts.notAttempted !== 0 ||
    !item ||
    item.message
  ) return false;
  return item.status === 'imported'
    ? receipt.counts.imported === 1 && receipt.counts.duplicate === 0
    : item.status === 'duplicate' && receipt.counts.imported === 0 && receipt.counts.duplicate === 1;
}

function candidatePreviewUrl(
  candidate: FlaWorkbenchCandidate,
  candidates: readonly FlaWorkbenchCandidate[],
): string | undefined {
  if (candidate.preview.previewUrl) return candidate.preview.previewUrl;
  if (candidate.kind !== 'sequence') return undefined;
  const snapshot = candidates.find((item) => item.kind === 'snapshot' &&
    item.provenance.renderTargetId === candidate.provenance.renderTargetId);
  return snapshot?.preview.previewUrl;
}

function thumbnailPlaceholder(candidate: FlaWorkbenchCandidate): string {
  if (candidate.preview.status === 'blank') return '空白画面';
  if (candidate.preview.status === 'unsupported') return '暂无法预览';
  if (candidate.preview.status === 'error') return '加载失败';
  return candidate.kind === 'sequence' ? '预览' : '加载中…';
}

function candidateStatus(candidate: FlaWorkbenchCandidate): string {
  switch (candidate.preview.status) {
    case 'verified':
      return candidate.kind === 'sequence' ? '已生成' : '';
    case 'checking':
      return candidate.kind === 'sequence' ? '' : '加载中…';
    case 'unscanned':
      return candidate.kind === 'sequence' ? '' : '加载中…';
    case 'unsupported':
      return '暂无法预览';
    case 'blank':
      return '空白画面';
    case 'error':
      return '加载失败';
  }
}

function receiptSummary(receipt: FlaUnifiedImportReceipt): string {
  if (receipt.partial) return `部分导入完成：新导入 ${receipt.counts.imported} 项、复用 ${receipt.counts.duplicate} 项、失败 ${receipt.counts.failed} 项、未尝试 ${receipt.counts.notAttempted} 项`;
  if (receipt.selectedCount === 1 && receipt.counts.imported === 1) return '已导入素材库';
  if (receipt.selectedCount === 1 && receipt.counts.duplicate === 1) return '素材已在素材库';
  return `导入完成：新导入 ${receipt.counts.imported} 项、复用 ${receipt.counts.duplicate} 项、失败 ${receipt.counts.failed} 项、未尝试 ${receipt.counts.notAttempted} 项`;
}

function focusedCandidateStatus(candidate: FlaWorkbenchCandidate): string | null {
  if (candidate.kind === 'sequence' && candidate.preview.status === 'verified' && candidate.selectable) {
    return null;
  }
  return candidateStatus(candidate) || null;
}

function PreviewPlaceholder({ candidate }: { candidate: FlaWorkbenchCandidate }): React.JSX.Element {
  const reason = candidate.preview.reason ?? (candidate.preview.status === 'blank'
    ? '此项没有可导入的画面。'
    : candidate.preview.status === 'unsupported'
      ? '可以选择其他素材继续。'
      : candidate.preview.status === 'error'
        ? '请重试检查，或选择其他素材。'
        : candidate.kind === 'sequence'
          ? '生成预览后再导入。'
          : '预览生成后会显示在这里。');
  return (
    <div
      className="fla-c03-preview-placeholder"
      data-testid="fla-c03-preview-placeholder"
      role={candidate.preview.status === 'error' ? 'alert' : 'status'}
    >
      <span>{reason}</span>
    </div>
  );
}
