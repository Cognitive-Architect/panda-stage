import {
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  FlaCompatibilityStatus,
  FlaInspectionResponse,
  FlaRasterSelectionIntent,
  FlaStructuralSummary,
} from '../../shared/fla-import-api';
import type { FlaAssetCommitResponse } from '../../shared/fla-asset-commit-api';
import type { FlaStaticSnapshotCommitResponse } from '../../shared/fla-static-snapshot-api';
import type { FlaFrameSequenceCommitResponse } from '../../shared/fla-frame-sequence-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import {
  compatibilityCounts,
  compatibilityWarnings,
  createFlaRasterSelectionIntent,
  allFlaReviewMediaIds,
  filterFlaReviewMedia,
  flaReviewPageCount,
  FLA_RASTER_REVIEW_PAGE_SIZES,
  FLA_COMPATIBILITY_LABELS,
  FLA_COMPATIBILITY_STATUSES,
  paginateFlaReviewMedia,
  reviewMedia,
  toggleFlaMediaSelection,
  type FlaRasterReviewFilter,
  type FlaReviewMedia,
} from './fla-review';
import {
  isFlaInspectionUserCancelled,
  subscribeToFlaInspection,
  type FlaInspectionOperation,
} from './fla-inspection-lifecycle';
import { FlaStaticSnapshotReview } from './FlaStaticSnapshotReview';
import { FlaFrameSequenceReview } from './FlaFrameSequenceReview';
import {
  FlaRenderWorkbench,
  type FlaRenderWorkbenchMode,
} from './FlaRenderWorkbench';
import {
  FlaStageGImporting,
  FlaStageGRecovery,
  FlaStageGRasterSuccess,
  type FlaStageGTerminalState,
} from './FlaStageGTerminal';
import { FlaStageAInspecting } from './FlaStageAInspecting';
import { FlaStageF3Blocked } from './FlaStageF';
import { routeFlaInspection } from './fla-content-route';

interface FlaCompatibilityReviewSessionProps {
  inspection: FlaInspectionOperation;
  snapshot: EditorProjectSnapshot | null;
  onClose: () => void;
  onIntent?: (intent: FlaRasterSelectionIntent) => void;
  onCommit?: (response: FlaAssetCommitResponse) => void;
  onSnapshotImported?: (response: FlaStaticSnapshotCommitResponse) => void;
  onSequenceImported?: (response: FlaFrameSequenceCommitResponse) => void;
}

type SessionPhase =
  | 'inspecting'
  | 'ready'
  | 'confirmed'
  | 'committing'
  | 'success'
  | 'error';

export function FlaCompatibilityReviewSession({
  inspection,
  snapshot,
  onClose,
  onIntent,
  onCommit,
  onSnapshotImported,
  onSequenceImported,
}: FlaCompatibilityReviewSessionProps): React.JSX.Element {
  const [phase, setPhase] = useState<SessionPhase>('inspecting');
  const [response, setResponse] = useState<FlaInspectionResponse | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedMediaIds, setSelectedMediaIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [intent, setIntent] = useState<FlaRasterSelectionIntent | null>(null);
  const [commitResponse, setCommitResponse] = useState<FlaAssetCommitResponse | null>(null);
  const [thumbnailUrls, setThumbnailUrls] = useState<Readonly<Record<string, string>>>({});
  const [focusedMediaId, setFocusedMediaId] = useState<string | null>(null);
  const [compatibilityNotesOpen, setCompatibilityNotesOpen] = useState(false);
  const [rasterPage, setRasterPage] = useState(1);
  const [rasterPageSize, setRasterPageSize] = useState<number>(FLA_RASTER_REVIEW_PAGE_SIZES[0]);
  const [rasterFilter, setRasterFilter] = useState<FlaRasterReviewFilter>('all');
  const [rasterSearch, setRasterSearch] = useState('');
  const [renderMode, setRenderMode] = useState<FlaRenderWorkbenchMode>('snapshot');
  const [renderCommitBusy, setRenderCommitBusy] = useState(false);
  const [renderTerminalState, setRenderTerminalState] = useState<FlaStageGTerminalState>('active');
  const reviewBodyRef = useRef<HTMLDivElement | null>(null);
  const reviewScrollTop = useRef(0);

  useEffect(() => {
    return subscribeToFlaInspection(
      inspection,
      (nextResponse) => {
        if (isFlaInspectionUserCancelled(nextResponse)) {
          // Native picker cancellation is a clean dismissal, not a failed
          // inspection.  Do not briefly mount F3 or expose its diagnostics.
          onClose();
          return;
        }
        setResponse(nextResponse);
        if (nextResponse.ok) {
          setSessionId(nextResponse.sessionId);
          setSelectedMediaIds(
            new Set(nextResponse.ir.media.map((media) => media.id)),
          );
          setFocusedMediaId(nextResponse.ir.media[0]?.id ?? null);
          setRasterPage(1);
          setRasterPageSize(16);
          setRasterFilter('all');
          setRasterSearch('');
          setCompatibilityNotesOpen(false);
          setRenderMode('snapshot');
          setRenderCommitBusy(false);
          setRenderTerminalState('active');
          reviewScrollTop.current = 0;
          setPhase('ready');
        } else {
          setPhase('error');
        }
      },
      (error: unknown) => {
        setResponse({
          ok: false,
          error: {
            code: 'PARSER_CRASH',
            message: error instanceof Error ? error.message : 'FLA inspection failed',
          },
        });
        setPhase('error');
      },
    );
  }, [inspection]);

  const ir = response?.ok ? response.ir : null;
  const contentRoute = response ? routeFlaInspection(response) : 'blocked';
  const reviewItems = useMemo(
    () => (ir ? reviewMedia(ir, snapshot?.project.assets ?? []) : []),
    [ir, snapshot],
  );
  const selectedCount = reviewItems.filter(({ media }) =>
    selectedMediaIds.has(media.id),
  ).length;
  const filteredReviewItems = useMemo(() => {
    return filterFlaReviewMedia(reviewItems, rasterFilter, rasterSearch, selectedMediaIds);
  }, [rasterFilter, rasterSearch, reviewItems, selectedMediaIds]);
  const rasterPageCount = flaReviewPageCount(filteredReviewItems.length, rasterPageSize);
  const pagedReviewItems = useMemo(() => {
    return paginateFlaReviewMedia(filteredReviewItems, rasterPage, rasterPageSize);
  }, [filteredReviewItems, rasterPage, rasterPageSize]);
  const usedMediaCount = reviewItems.filter((item) => !item.libraryOnly).length;
  const libraryOnlyMediaCount = reviewItems.length - usedMediaCount;
  const focusedItem = pagedReviewItems.find(({ media }) => media.id === focusedMediaId)
    ?? pagedReviewItems[0]
    ?? null;
  const selectionLocked = phase === 'committing' || phase === 'success';

  useEffect(() => {
    if (pagedReviewItems.length === 0) {
      setFocusedMediaId(null);
      return;
    }
    if (!pagedReviewItems.some(({ media }) => media.id === focusedMediaId)) {
      setFocusedMediaId(pagedReviewItems[0]!.media.id);
    }
  }, [focusedMediaId, pagedReviewItems]);

  useEffect(() => {
    if (rasterPage <= rasterPageCount) return;
    reviewScrollTop.current = 0;
    setRasterPage(rasterPageCount);
  }, [rasterPage, rasterPageCount]);

  useEffect(() => {
    if (!ir) return undefined;
    reviewScrollTop.current = reviewBodyRef.current?.scrollTop ?? reviewScrollTop.current;
    const created: Record<string, string> = {};
    if (typeof URL.createObjectURL === 'function') {
      for (const media of ir.media) {
        const bytes = media.payload.bytes.slice();
        const blob = new Blob([bytes.buffer as ArrayBuffer], {
          type: media.payload.mimeType,
        });
        created[media.id] = URL.createObjectURL(blob);
      }
    }
    setThumbnailUrls(created);
    return () => {
      for (const url of Object.values(created)) URL.revokeObjectURL(url);
    };
  }, [ir]);

  useLayoutEffect(() => {
    const body = reviewBodyRef.current;
    if (!body) return;
    const maximumScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const nextScrollTop = Math.min(reviewScrollTop.current, maximumScrollTop);
    if (Math.abs(body.scrollTop - nextScrollTop) > 0.5) {
      body.scrollTop = nextScrollTop;
    }
  }, [
    compatibilityNotesOpen,
    intent,
    pagedReviewItems,
    phase,
    rasterPage,
    rasterPageSize,
    rasterSearch,
    selectedMediaIds,
    thumbnailUrls,
  ]);

  const rememberReviewScroll = (): void => {
    if (reviewBodyRef.current) reviewScrollTop.current = reviewBodyRef.current.scrollTop;
  };

  const resetRasterBrowsePosition = (): void => {
    reviewScrollTop.current = 0;
    setRasterPage(1);
  };

  const changeRasterFilter = (nextFilter: FlaRasterReviewFilter): void => {
    if (nextFilter === rasterFilter) return;
    resetRasterBrowsePosition();
    setRasterFilter(nextFilter);
  };

  const changeRasterSearch = (nextSearch: string): void => {
    resetRasterBrowsePosition();
    setRasterSearch(nextSearch);
  };

  const changeRasterPageSize = (nextPageSize: number): void => {
    if (!FLA_RASTER_REVIEW_PAGE_SIZES.includes(nextPageSize as (typeof FLA_RASTER_REVIEW_PAGE_SIZES)[number])) {
      return;
    }
    resetRasterBrowsePosition();
    setRasterPageSize(nextPageSize);
  };

  const changeRasterPage = (delta: number): void => {
    const nextPage = Math.min(
      Math.max(1, rasterPage + delta),
      rasterPageCount,
    );
    if (nextPage === rasterPage) return;
    resetRasterBrowsePosition();
    setRasterPage(nextPage);
  };

  const closeSession = (): void => {
    if (phase === 'committing' || renderCommitBusy) return;
    onClose();
  };

  if (phase === 'inspecting') {
    return (
      <FlaReviewPortal>
        <FlaStageAInspecting onCancel={closeSession} />
      </FlaReviewPortal>
    );
  }

  if (response && !response.ok) {
    return (
      <FlaReviewPortal>
        <FlaStageF3Blocked response={response} onClose={onClose} />
      </FlaReviewPortal>
    );
  }

  if (!ir || !sessionId) {
    const diagnostic = flaDiagnosticUserMessage(response);
    return (
      <FlaReviewPortal>
        <section
          aria-label="FLA 兼容性预览"
          aria-modal="true"
          className="fla-review-session"
          data-review-layout="portal"
          data-testid="fla-review-session"
          role="dialog"
        >
          <header className="fla-review-heading" data-testid="fla-review-header">
            <div>
              <p className="eyebrow">导入前检查</p>
              <h2>FLA 兼容性预览</h2>
            </div>
            <button autoFocus onClick={onClose} type="button">返回素材库</button>
          </header>
          <div className="fla-review-body fla-review-status-body">
            {diagnostic ? (
              <output data-testid="fla-review-diagnostic" role="alert">
                {diagnostic}
              </output>
            ) : (
              <output data-testid="fla-review-error" role="alert">
                FLA 检查失败，请关闭后重试。
              </output>
            )}
          </div>
        </section>
      </FlaReviewPortal>
    );
  }

  const counts = compatibilityCounts(ir);
  const warnings = compatibilityWarnings(ir);
  const rasterRoute = contentRoute === 'v1-raster-review';
  const rasterCommitError = rasterRoute && commitResponse && !commitResponse.ok
    ? commitResponse
    : null;
  const renderPhase: SessionPhase = phase;
  const progressStep = phase === 'ready'
    ? 'select'
    : phase === 'confirmed'
      ? 'confirm'
      : 'import';
  const toggle = (mediaId: string): void => {
    if (selectionLocked) return;
    rememberReviewScroll();
    setSelectedMediaIds((current) => toggleFlaMediaSelection(current, mediaId));
    setIntent(null);
    if (phase === 'confirmed') setPhase('ready');
  };
  const selectAll = (): void => {
    if (selectionLocked) return;
    rememberReviewScroll();
    setSelectedMediaIds(allFlaReviewMediaIds(reviewItems));
    setIntent(null);
    if (phase === 'confirmed') setPhase('ready');
  };
  const clearAll = (): void => {
    if (selectionLocked) return;
    rememberReviewScroll();
    setSelectedMediaIds(new Set());
    setIntent(null);
    if (phase === 'confirmed') setPhase('ready');
  };
  const confirm = (): void => {
    if (selectedCount === 0) return;
    rememberReviewScroll();
    const nextIntent = createFlaRasterSelectionIntent(
      ir,
      sessionId,
      selectedMediaIds,
    );
    setIntent(nextIntent);
    setPhase('confirmed');
    onIntent?.(nextIntent);
  };

  const commit = async (): Promise<void> => {
    if (!intent || !snapshot || phase !== 'confirmed') return;
    rememberReviewScroll();
    setCommitResponse(null);
    setPhase('committing');
    try {
      const nextResponse = await window.pandaStage.fla.commitSelected({
        format: 'fla-raster-commit',
        version: 1,
        projectRoot: snapshot.projectRoot,
        project: snapshot.project,
        baseRevision: snapshot.revision,
        sessionId: intent.sessionId,
        source: intent.source,
        selectedMediaIds: intent.selectedMediaIds,
        selectedCount: intent.selectedCount,
        confirmed: true,
      });
      setCommitResponse(nextResponse);
      if (nextResponse.ok && nextResponse.status === 'completed') {
        setPhase('success');
        onCommit?.(nextResponse);
      } else {
        setPhase('confirmed');
      }
    } catch (error) {
      setCommitResponse({
        ok: false,
        error: {
          code: 'ASSET_COMMIT_FAILED',
          message:
            error instanceof Error
              ? error.message
              : 'FLA 素材导入失败，请重试。',
          projectRoot: snapshot.projectRoot,
        },
      });
      setPhase('confirmed');
    }
  };

  return (
    <FlaReviewPortal>
      <section
        aria-label="FLA 兼容性预览"
        aria-modal="true"
        className="fla-review-session"
        data-review-layout="portal"
        data-testid="fla-review-session"
        data-workbench-route={rasterRoute ? 'raster' : 'render'}
        role="dialog"
      >
        {rasterRoute ? (
          <header className="fla-review-heading fla-raster-review-heading" data-testid="fla-review-header">
            <div className="fla-review-heading-copy">
              <h2>FLA 素材工作台</h2>
            </div>
            {phase !== 'committing' && phase !== 'success' && !rasterCommitError ? (
              <ol aria-label="导入进度" className="fla-workbench-progress" data-current-step={progressStep}>
                <li aria-current={progressStep === 'select' ? 'step' : undefined}>选择素材</li>
                <li aria-current={progressStep === 'confirm' ? 'step' : undefined}>确认选择</li>
                <li aria-current={progressStep === 'import' ? 'step' : undefined}>导入素材</li>
              </ol>
            ) : null}
            {phase !== 'committing' && phase !== 'success' && !rasterCommitError ? (
              <button
                data-testid="fla-review-cancel"
                onClick={() => void closeSession()}
                type="button"
              >
                取消
              </button>
            ) : null}
          </header>
        ) : null}

        <div
          className="fla-review-body"
          data-preserves-scroll-position="true"
          data-testid="fla-review-body"
          onScroll={(event) => {
            reviewScrollTop.current = event.currentTarget.scrollTop;
          }}
          ref={reviewBodyRef}
        >
          {rasterRoute && response?.ok === true && response.trace?.recoveryApplied ? (
            <output
              className="fla-review-recovery-notice"
              data-testid="fla-review-recovery-notice"
              role="status"
            >
              Panda 已处理一个兼容性问题；原 FLA 文件没有被修改。
            </output>
          ) : null}
          {rasterRoute && phase === 'committing' ? (
            <FlaStageGImporting
              context={`${intent?.selectedCount ?? selectedCount} 项位图素材`}
              headline={`正在导入 ${intent?.selectedCount ?? selectedCount} 项位图素材…`}
              route="raster"
            />
          ) : rasterRoute && phase === 'success' && commitResponse?.ok && commitResponse.status === 'completed' ? (
            <FlaStageGRasterSuccess onReturn={closeSession} response={commitResponse} />
          ) : rasterCommitError ? (
            <FlaStageGRecovery
              candidateStillCurrent={rasterCommitError.error.code === 'ASSET_COMMIT_FAILED' || rasterCommitError.error.code === 'COMMIT_BUSY'}
              code={rasterCommitError.error.code}
              message={rasterCommitError.error.message}
              onClose={closeSession}
              onPrimary={() => void commit()}
              residualPaths={rasterCommitError.error.residualPaths}
              route="raster"
            />
          ) : rasterRoute ? (
            <div className="fla-raster-workbench" data-testid="fla-raster-workbench">
              <aside className="fla-raster-overview" data-testid="fla-raster-overview">
                <div>
                  <p className="fla-raster-panel-kicker">FLA 文件 · 只读预览</p>
                  <h3 title={ir.source.basename}>{ir.source.basename}</h3>
                </div>
                <dl className="fla-review-summary" data-testid="fla-review-summary">
                  <div><dt>舞台</dt><dd>{ir.document.width} × {ir.document.height} · {ir.document.frameRate} fps</dd></div>
                  <div><dt>位图摘要</dt><dd data-testid="fla-review-media-count">{ir.media.length} 项位图 · {usedMediaCount} 已使用 · {libraryOnlyMediaCount} 仅素材库</dd></div>
                </dl>
                <details className="fla-raster-file-details" data-testid="fla-raster-file-details">
                  <summary>文件详情</summary>
                  <dl className="fla-review-summary">
                    <div><dt>格式</dt><dd>{ir.source.format.toUpperCase()}</dd></div>
                    <div><dt>文件大小</dt><dd>{ir.source.byteLength.toLocaleString('en-US')} bytes</dd></div>
                    <div><dt>解析器</dt><dd>{ir.source.parser.entrypoint}</dd></div>
                  </dl>
                </details>
                {ir.structure ? (
                  <details className="fla-raster-structure" data-testid="fla-raster-structure">
                    <summary>结构信息</summary>
                    <dl className="fla-review-summary">
                      <FlaStructuralSummaryReadOnly summary={ir.structure} />
                    </dl>
                  </details>
                ) : null}
                <section
                  aria-label="兼容性说明"
                  className="fla-review-compatibility"
                  data-stage-f-severity={warnings.length > 0 ? 'warning' : 'clear'}
                  data-testid="fla-stage-f1-raster-warning"
                >
                  <details
                    className="fla-review-compatibility-notes"
                    data-testid="fla-compatibility-notes"
                    open={compatibilityNotesOpen}
                  >
                    <summary
                      className="fla-raster-compatibility-summary"
                      onClick={(event) => {
                        event.preventDefault();
                        rememberReviewScroll();
                        setCompatibilityNotesOpen((current) => !current);
                      }}
                    >
                      <strong data-testid="fla-raster-compatibility-summary">
                        {warnings.length > 0 ? `⚠ ${warnings.length} 个兼容性提示` : '无兼容性提示'}
                      </strong>
                      <span>查看兼容性说明</span>
                    </summary>
                    <ul data-testid="fla-compatibility-summary">
                      {FLA_COMPATIBILITY_STATUSES.map((status) => (
                        <li data-status={status} key={status}>
                          <strong>{FLA_COMPATIBILITY_LABELS[status]}</strong>
                          <span>{counts[status]}</span>
                        </li>
                      ))}
                    </ul>
                    {warnings.length > 0 ? (
                      <ul className="fla-review-warnings" data-testid="fla-compatibility-warnings">
                        {warnings.map((warning) => (
                          <li key={`${warning.feature}:${warning.status}`}>
                            <strong>{FLA_COMPATIBILITY_LABELS[warning.status]} · {compatibilityFeatureLabel(warning.feature)}</strong>
                            <span>{compatibilityReason(warning.feature, warning.status, warning.reason)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                </section>
              </aside>

              <section aria-labelledby="fla-raster-grid-heading" className="fla-raster-selection" data-testid="fla-raster-selection">
                <header className="fla-raster-selection-header">
                  <div>
                    <p className="fla-raster-panel-kicker">选择素材</p>
                    <h3 id="fla-raster-grid-heading">位图素材</h3>
                  </div>
                  <div className="fla-raster-grid-count" data-testid="fla-raster-grid-count">
                    <strong>{filteredReviewItems.length} / {reviewItems.length}</strong>
                    <span>{selectedCount} 已选</span>
                  </div>
                </header>
                <div className="fla-raster-browse-controls" data-testid="fla-raster-browse-controls">
                  <div
                    aria-label="筛选位图素材"
                    className="fla-raster-filter-group"
                    role="group"
                  >
                    {([
                      ['all', '全部'],
                      ['selected', '已选'],
                      ['unselected', '未选'],
                    ] as const).map(([filter, label]) => (
                      <button
                        aria-pressed={rasterFilter === filter}
                        className={rasterFilter === filter ? 'is-active' : undefined}
                        data-testid={`fla-review-filter-${filter}`}
                        key={filter}
                        onClick={() => changeRasterFilter(filter)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="fla-raster-search">
                    <span>搜索文件名</span>
                    <input
                      aria-label="搜索文件名"
                      data-testid="fla-review-search"
                      onChange={(event) => changeRasterSearch(event.currentTarget.value)}
                      placeholder="搜索文件名"
                      type="search"
                      value={rasterSearch}
                    />
                  </label>
                  <div className="fla-raster-browse-secondary">
                    <div className="fla-raster-selection-utilities" aria-label="全局选择工具">
                      <button
                        data-testid="fla-review-select-all"
                        disabled={selectionLocked}
                        onClick={selectAll}
                        type="button"
                      >
                        全选
                      </button>
                      <button
                        data-testid="fla-review-clear-all"
                        disabled={selectionLocked}
                        onClick={clearAll}
                        type="button"
                      >
                        清空
                      </button>
                    </div>
                    <label className="fla-raster-page-size">
                      <span>每页</span>
                      <select
                        aria-label="每页数量"
                        data-testid="fla-review-page-size"
                        onChange={(event) => changeRasterPageSize(Number(event.currentTarget.value))}
                        value={rasterPageSize}
                      >
                        {FLA_RASTER_REVIEW_PAGE_SIZES.map((size) => (
                          <option key={size} value={size}>{size}</option>
                        ))}
                      </select>
                    </label>
                    <nav aria-label="位图素材分页" className="fla-raster-pagination" data-testid="fla-review-pagination">
                      <button
                        aria-label="上一页"
                        disabled={rasterPage <= 1}
                        onClick={() => changeRasterPage(-1)}
                        type="button"
                      >
                        ‹
                      </button>
                      <span data-testid="fla-review-page-status">{rasterPage} / {rasterPageCount}</span>
                      <button
                        aria-label="下一页"
                        disabled={rasterPage >= rasterPageCount}
                        onClick={() => changeRasterPage(1)}
                        type="button"
                      >
                        ›
                      </button>
                    </nav>
                  </div>
                </div>
                <div
                  aria-label="FLA 位图素材"
                  className="fla-review-media-grid"
                  data-scroll-region="fla-media-grid"
                  data-testid="fla-review-media-grid"
                >
                  {pagedReviewItems.length > 0 ? pagedReviewItems.map((item) => (
                    <FlaReviewMediaCard
                      focused={focusedItem?.media.id === item.media.id}
                      item={item}
                      key={item.media.id}
                      selected={selectedMediaIds.has(item.media.id)}
                      selectionLocked={selectionLocked}
                      thumbnailUrl={thumbnailUrls[item.media.id]}
                      onFocus={() => setFocusedMediaId(item.media.id)}
                      onToggle={() => toggle(item.media.id)}
                    />
                  )) : (
                    <p className="fla-raster-empty" data-testid="fla-review-empty-state">
                      没有匹配的位图素材，请清除搜索或筛选条件。
                    </p>
                  )}
                </div>
              </section>

              <aside className="fla-raster-detail" data-testid="fla-raster-detail">
                <p className="fla-raster-panel-kicker">素材详情</p>
                {focusedItem ? (
                  <FlaReviewMediaDetail
                    item={focusedItem}
                    selected={selectedMediaIds.has(focusedItem.media.id)}
                    thumbnailUrl={thumbnailUrls[focusedItem.media.id]}
                  />
                ) : (
                  <p>聚焦一个位图素材以查看详情。</p>
                )}
              </aside>
            </div>
          ) : (
            <div className="fla-review-zero-raster" data-testid="fla-review-zero-raster">
              <FlaRenderWorkbench
                compatibility={ir.compatibility}
                mode={renderMode}
                onModeChange={(mode) => {
                  setRenderMode(mode);
                  setRenderCommitBusy(false);
                  setRenderTerminalState('active');
                }}
                sourceBasename={ir.source.basename}
                terminalState={renderTerminalState}
              >
                {renderMode === 'snapshot' ? (
                  <FlaStaticSnapshotReview
                    onCommitStateChange={setRenderCommitBusy}
                    onTerminalStateChange={setRenderTerminalState}
                    sessionId={sessionId}
                    source={{ basename: ir.source.basename, sha256: ir.source.sha256 }}
                    stage={ir.document}
                    snapshot={snapshot}
                    onImported={(response) => onSnapshotImported?.(response)}
                    onClose={() => onClose()}
                  />
                ) : (
                  <FlaFrameSequenceReview
                    onCommitStateChange={setRenderCommitBusy}
                    onTerminalStateChange={setRenderTerminalState}
                    sessionId={sessionId}
                    source={{ basename: ir.source.basename, sha256: ir.source.sha256 }}
                    embedded
                    snapshot={snapshot}
                    onImported={(response) => onSequenceImported?.(response)}
                    onClose={() => onClose()}
                  />
                )}
              </FlaRenderWorkbench>
            </div>
          )}
        </div>

        {rasterRoute && phase !== 'committing' && phase !== 'success' && !rasterCommitError ? (
          <div className="fla-review-action-stack">
            <div className="fla-review-action-bar fla-review-selection-toolbar" data-testid="fla-review-selection-toolbar">
              <div>
                <strong data-testid="fla-review-selected-count">{selectedCount} 项将进入确认步骤</strong>
                {intent ? <output data-testid="fla-review-intent-status">已确认选择；尚未创建素材。</output> : null}
              </div>
              <div className="fla-review-action-buttons">
                <button
                  className="fla-review-action-cancel"
                  data-testid="fla-review-action-cancel"
                  disabled={renderPhase === 'committing'}
                  onClick={() => void closeSession()}
                  type="button"
                >
                  取消
                </button>
                {phase === 'ready' ? (
                  <button
                    className="fla-review-primary-action"
                    data-testid="fla-review-confirm"
                    disabled={selectedCount === 0}
                    onClick={confirm}
                    type="button"
                  >
                    确认 {selectedCount} 项
                  </button>
                ) : null}
              </div>
            </div>
            {intent && phase === 'confirmed' ? (
              <div className="fla-review-commit-action" data-testid="fla-review-commit-action">
                <div className="fla-review-commit-copy">
                  <strong data-testid="fla-review-commit-copy">已确认 {intent.selectedCount} 项</strong>
                  <span>选择已确认，但尚未创建项目素材；修改选择会返回上一步。</span>
                </div>
                <button
                  className="fla-review-commit-primary fla-review-primary-action"
                  data-testid="fla-review-commit"
                  disabled={phase !== 'confirmed'}
                  onClick={() => void commit()}
                  type="button"
                >
                  导入这 {intent.selectedCount} 项
                </button>
              </div>
            ) : null}
            {renderPhase === 'committing' ? (
              <output data-testid="fla-review-commit-status">正在导入已选择的素材…</output>
            ) : null}
            {commitResponse && !commitResponse.ok ? (
              <output data-testid="fla-review-commit-error" role="alert">{commitResponse.error.message}</output>
            ) : null}
            {renderPhase === 'success' && commitResponse?.ok && commitResponse.status === 'completed' ? (
              <output
                data-testid="fla-review-commit-success"
                data-imported-count={commitResponse.summary.importedCount}
                data-duplicate-count={commitResponse.summary.duplicateCount}
                data-renamed-count={commitResponse.summary.renamedCount}
              >
                导入完成：{commitResponse.summary.importedCount} 项；已复用重复素材：{commitResponse.summary.duplicateCount} 项。
              </output>
            ) : null}
          </div>
        ) : null}
      </section>
    </FlaReviewPortal>
  );
}

function FlaReviewMediaCard({
  focused,
  item,
  selected,
  selectionLocked,
  thumbnailUrl,
  onFocus,
  onToggle,
}: {
  focused: boolean;
  item: FlaReviewMedia;
  selected: boolean;
  selectionLocked: boolean;
  thumbnailUrl?: string;
  onFocus: () => void;
  onToggle: () => void;
}): React.JSX.Element {
  const { media } = item;
  return (
    <article
      aria-label={`${selected ? '取消选择' : '选择'} ${media.name}`}
      aria-pressed={selected}
      className={`fla-review-media-card${selected ? ' fla-review-media-card-selected' : ''}${focused ? ' fla-review-media-card-focused' : ''}`}
      data-alpha-kind={media.payload.alpha.kind}
      data-fla-media-id={media.id}
      data-library-only={item.libraryOnly ? 'true' : 'false'}
      data-source-format={media.sourceFormat}
      data-target-file-name={item.name.targetFileName}
      data-testid={`fla-review-media-card-${media.id}`}
      data-zero-alpha-pixels={media.payload.alpha.zeroAlphaPixels}
      onClickCapture={onFocus}
      onClick={(event: ReactMouseEvent<HTMLElement>) => {
        if (isNestedInteractiveTarget(event.target)) return;
        onToggle();
      }}
      onFocus={onFocus}
      onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
        if (isNestedInteractiveTarget(event.target)) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onToggle();
      }}
      role="button"
      tabIndex={0}
    >
      <label>
        <input
          aria-label={`选择 ${media.name}`}
          checked={selected}
          data-selection-target="checkbox"
          disabled={selectionLocked}
          onChange={onToggle}
          type="checkbox"
        />
        <span>{selected ? '已选' : '选择'}</span>
      </label>
      <div
        className="fla-review-thumbnail"
        data-selection-target="thumbnail"
      >
        {thumbnailUrl ? (
          <img alt={media.name} loading="lazy" src={thumbnailUrl} />
        ) : (
          <span>缩略图不可用</span>
        )}
      </div>
      <strong title={media.name}>{media.name}</strong>
      <span className="fla-review-media-usage" data-usage-state={item.libraryOnly ? 'library-only' : 'used'}>
        {item.libraryOnly ? '仅素材库' : '已使用'}
      </span>
      {item.warnings.length > 0 ? <span className="fla-review-card-warning">需确认文件名</span> : null}
    </article>
  );
}

function FlaReviewMediaDetail({
  item,
  selected,
  thumbnailUrl,
}: {
  item: FlaReviewMedia;
  selected: boolean;
  thumbnailUrl?: string;
}): React.JSX.Element {
  const { media } = item;
  const normalizedSourceReference = media.sourceReference.replaceAll('\\', '/');
  const sourceBasename = normalizedSourceReference.slice(
    normalizedSourceReference.lastIndexOf('/') + 1,
  );
  const sourceMatchesTarget = sourceBasename.toLocaleLowerCase('en-US') ===
    item.name.targetFileName.toLocaleLowerCase('en-US');
  return (
    <div className="fla-review-media-detail-content" data-focused-media-id={media.id}>
      <div className="fla-review-detail-preview">
        {thumbnailUrl ? (
          <img alt={media.name} src={thumbnailUrl} />
        ) : (
          <span>预览不可用</span>
        )}
      </div>
      <div className="fla-review-detail-heading">
        <h3 title={media.name}>{media.name}</h3>
        <span data-selected={selected ? 'true' : 'false'}>{selected ? '已选择' : '未选择'}</span>
      </div>
      <dl>
        <div><dt>尺寸与格式</dt><dd>{media.width} × {media.height} · {media.sourceFormat.toUpperCase()}</dd></div>
        <div><dt>使用状态</dt><dd>{item.libraryOnly ? '仅素材库' : '已在舞台中使用'}</dd></div>
        {sourceMatchesTarget ? (
          <div><dt>来源与目标</dt><dd title={media.sourceReference}>{media.sourceReference}（保持文件名）</dd></div>
        ) : (
          <>
            <div><dt>来源</dt><dd title={media.sourceReference}>{media.sourceReference}</dd></div>
            <div><dt>目标文件名</dt><dd>{item.name.targetFileName}</dd></div>
          </>
        )}
      </dl>
      {item.warnings.length > 0 ? (
        <div className="fla-review-detail-warnings" data-testid="fla-review-detail-warnings" role="note">
          <strong>文件名提醒</strong>
          <ul className="fla-review-name-warnings">
            {item.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function isNestedInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('input, label, button, a'),
  );
}

/**
 * Primary user-facing diagnostic copy derived from the response.  Prefers the
 * most specific category (archive-malformed) and otherwise falls back to the
 * first attached diagnostic.  Returns `null` when no diagnostic is present so
 * callers can show a neutral fallback without implying a specific cause.
 * Developer-only detail fields are never surfaced here.
 */
function flaDiagnosticUserMessage(response: FlaInspectionResponse | null): string | null {
  const diagnostics = response?.diagnostics;
  if (!diagnostics || diagnostics.length === 0) return null;
  const archive = diagnostics.find(
    (diagnostic) => diagnostic.category === 'archive-malformed',
  );
  return (archive ?? diagnostics[0]!).userMessage;
}

function FlaStructuralSummaryReadOnly({
  summary,
}: {
  summary: FlaStructuralSummary;
}): React.JSX.Element {
  const symbolBreakdown: string[] = [];
  if (summary.graphicCount > 0) symbolBreakdown.push(`图形 ${summary.graphicCount}`);
  if (summary.movieClipCount > 0) symbolBreakdown.push(`影片剪辑 ${summary.movieClipCount}`);
  if (summary.buttonCount > 0) symbolBreakdown.push(`按钮 ${summary.buttonCount}`);
  return (
    <div
      className="fla-review-structure"
      data-testid="fla-review-structure"
      role="group"
      aria-label="FLA 结构信息"
    >
      <div className="fla-review-structure-row">
        <dt>场景</dt>
        <dd data-testid="fla-review-structure-scene">{summary.sceneCount}</dd>
      </div>
      <div className="fla-review-structure-row">
        <dt>元件</dt>
        <dd data-testid="fla-review-structure-symbol">
          {summary.symbolCount}
          {symbolBreakdown.length > 0
            ? `（${symbolBreakdown.join('、')}）`
            : ''}
        </dd>
      </div>
      <div className="fla-review-structure-row">
        <dt>图层</dt>
        <dd data-testid="fla-review-structure-layer">{summary.layerCount}</dd>
      </div>
      <div className="fla-review-structure-row">
        <dt>帧</dt>
        <dd data-testid="fla-review-structure-frame">{summary.frameCount}</dd>
      </div>
      {summary.tweenCount > 0 ? (
        <div className="fla-review-structure-row">
          <dt>补间</dt>
          <dd data-testid="fla-review-structure-tween">{summary.tweenCount}</dd>
        </div>
      ) : null}
    </div>
  );
}

function compatibilityFeatureLabel(feature: string): string {
  const labels: Readonly<Record<string, string>> = {
    'actionscript': 'ActionScript 脚本',
    'basic-tweens': '基础补间',
    'bitmap-media': '位图素材',
    'symbol-movieclip-semantics': '元件/影片剪辑',
    'timeline-frame-placement': '时间轴使用',
    'unresolved-bitmap-reference': '位图引用',
  };
  return labels[feature] ?? '其他功能';
}

function compatibilityReason(
  feature: string,
  status: FlaCompatibilityStatus,
  reason: string,
): string {
  if (feature === 'unresolved-bitmap-reference') {
    const prefix = 'Bitmap reference was not found: ';
    return reason.startsWith(prefix)
      ? `未找到位图引用：${reason.slice(prefix.length)}`
      : '未找到对应的位图引用。';
  }
  if (status === 'exact') return '此类内容可以在当前预览中使用。';
  if (status === 'degraded') return '当前可预览，时间轴动画暂不导入。';
  if (status === 'unsupported') return '此类内容暂不在当前 FLA 导入范围内。';
  if (status === 'not-present') return '源文件中未发现此类内容。';
  return '暂时无法确定此类内容的兼容性。';
}

function FlaReviewPortal({ children }: { children: ReactNode }): React.JSX.Element {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const appRoot = document.getElementById('root');
    if (!appRoot) return undefined;
    const wasInert = appRoot.inert;
    appRoot.inert = true;
    return () => {
      appRoot.inert = wasInert;
    };
  }, []);

  const surface = (
    <div
      aria-label="FLA 兼容性预览前景层"
      className="fla-review-portal"
      data-testid="fla-review-portal"
    >
      <div
        aria-hidden="true"
        className="fla-review-backdrop"
        data-testid="fla-review-backdrop"
      />
      {children}
    </div>
  );
  if (typeof document === 'undefined') return <>{children}</>;
  return createPortal(surface, document.body);
}
