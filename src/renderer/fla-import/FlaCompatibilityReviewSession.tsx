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
  FLA_COMPATIBILITY_LABELS,
  FLA_COMPATIBILITY_STATUSES,
  reviewMedia,
  toggleFlaMediaSelection,
  type FlaReviewMedia,
} from './fla-review';
import {
  subscribeToFlaInspection,
  type FlaInspectionOperation,
} from './fla-inspection-lifecycle';
import { FlaStaticSnapshotReview } from './FlaStaticSnapshotReview';
import { FlaFrameSequenceReview } from './FlaFrameSequenceReview';
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
  const reviewBodyRef = useRef<HTMLDivElement | null>(null);
  const reviewScrollTop = useRef(0);

  useEffect(() => {
    return subscribeToFlaInspection(
      inspection,
      (nextResponse) => {
        setResponse(nextResponse);
        if (nextResponse.ok) {
          setSessionId(nextResponse.sessionId);
          setSelectedMediaIds(
            new Set(nextResponse.ir.media.map((media) => media.id)),
          );
          setFocusedMediaId(nextResponse.ir.media[0]?.id ?? null);
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
  const usedMediaCount = reviewItems.filter((item) => !item.libraryOnly).length;
  const libraryOnlyMediaCount = reviewItems.length - usedMediaCount;
  const focusedItem = reviewItems.find(({ media }) => media.id === focusedMediaId)
    ?? reviewItems[0]
    ?? null;
  const selectionLocked = phase === 'committing' || phase === 'success';

  useEffect(() => {
    if (reviewItems.length === 0) {
      setFocusedMediaId(null);
      return;
    }
    if (!reviewItems.some(({ media }) => media.id === focusedMediaId)) {
      setFocusedMediaId(reviewItems[0]!.media.id);
    }
  }, [focusedMediaId, reviewItems]);

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
  }, [compatibilityNotesOpen, intent, phase, reviewItems, selectedMediaIds, thumbnailUrls]);

  const rememberReviewScroll = (): void => {
    if (reviewBodyRef.current) reviewScrollTop.current = reviewBodyRef.current.scrollTop;
  };

  const closeSession = (): void => {
    if (phase === 'committing') return;
    onClose();
  };

  if (phase === 'inspecting') {
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
            <button
              autoFocus
              data-testid="fla-review-cancel"
              onClick={() => void closeSession()}
              type="button"
            >
              取消
            </button>
          </header>
          <div className="fla-review-body fla-review-status-body">
            <p>正在读取所选 FLA。预览过程中不会修改项目或素材。</p>
            <output data-testid="fla-review-status">正在检查源文件…</output>
          </div>
        </section>
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
    setSelectedMediaIds(new Set(reviewItems.map(({ media }) => media.id)));
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
        <header className="fla-review-heading" data-testid="fla-review-header">
          <div className="fla-review-heading-copy">
            <p className="eyebrow">{rasterRoute ? '只读导入预览' : '导入前检查'}</p>
            <h2>{rasterRoute ? 'FLA 素材工作台' : 'FLA 兼容性预览'}</h2>
            {rasterRoute ? (
              <ol aria-label="导入进度" className="fla-workbench-progress" data-current-step={progressStep}>
                <li aria-current={progressStep === 'select' ? 'step' : undefined}>选择素材</li>
                <li aria-current={progressStep === 'confirm' ? 'step' : undefined}>确认选择</li>
                <li aria-current={progressStep === 'import' ? 'step' : undefined}>导入素材</li>
              </ol>
            ) : null}
          </div>
          <button
            disabled={phase === 'committing'}
            data-testid="fla-review-cancel"
            onClick={() => void closeSession()}
            type="button"
          >
            取消
          </button>
        </header>

        {!rasterRoute ? (
          <div className="fla-review-selection-toolbar" data-testid="fla-review-selection-toolbar">
            <div>
              <strong data-testid="fla-review-selected-count">已选择：{selectedCount} / {reviewItems.length}</strong>
            </div>
            <div>
              <button data-testid="fla-review-select-all" disabled type="button">全选</button>
              <button data-testid="fla-review-clear-all" disabled type="button">清空</button>
              <button data-testid="fla-review-confirm" disabled type="button">确认选择</button>
            </div>
          </div>
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
          {response?.ok === true && response.trace?.recoveryApplied ? (
            <output
              className="fla-review-recovery-notice"
              data-testid="fla-review-recovery-notice"
              role="status"
            >
              Panda 已处理一个兼容性问题；原 FLA 文件没有被修改。
            </output>
          ) : null}
          {rasterRoute ? (
            <div className="fla-raster-workbench" data-testid="fla-raster-workbench">
              <aside className="fla-raster-overview" data-testid="fla-raster-overview">
                <span className="fla-raster-readonly-badge">只读预览</span>
                <div>
                  <p className="fla-raster-panel-kicker">FLA 文件</p>
                  <h3 title={ir.source.basename}>{ir.source.basename}</h3>
                  <p>在确认导入前，不会修改项目或原文件。</p>
                </div>
                <dl className="fla-review-summary" data-testid="fla-review-summary">
                  <div><dt>舞台</dt><dd>{ir.document.width} × {ir.document.height} · {ir.document.frameRate} fps</dd></div>
                  <div><dt>位图素材</dt><dd data-testid="fla-review-media-count">{ir.media.length} 项</dd></div>
                  <div><dt>使用情况</dt><dd>{usedMediaCount} 已使用 · {libraryOnlyMediaCount} 仅素材库</dd></div>
                </dl>
                {ir.structure ? (
                  <details className="fla-raster-structure" data-testid="fla-raster-structure">
                    <summary>结构信息</summary>
                    <dl className="fla-review-summary">
                      <FlaStructuralSummaryReadOnly summary={ir.structure} />
                    </dl>
                  </details>
                ) : null}
                <section aria-labelledby="fla-compatibility-heading" className="fla-review-compatibility">
                  <h3 id="fla-compatibility-heading">兼容性概览</h3>
                  <ul data-testid="fla-compatibility-summary">
                    {FLA_COMPATIBILITY_STATUSES.map((status) => (
                      <li data-status={status} key={status}>
                        <strong>{FLA_COMPATIBILITY_LABELS[status]}</strong>
                        <span>{counts[status]}</span>
                      </li>
                    ))}
                  </ul>
                  {warnings.length > 0 ? (
                    <details
                      className="fla-review-compatibility-notes"
                      data-testid="fla-compatibility-notes"
                      open={compatibilityNotesOpen}
                    >
                      <summary
                        onClick={(event) => {
                          event.preventDefault();
                          rememberReviewScroll();
                          setCompatibilityNotesOpen((current) => !current);
                        }}
                      >
                        兼容性说明（{warnings.length}）
                      </summary>
                      <ul className="fla-review-warnings" data-testid="fla-compatibility-warnings">
                        {warnings.map((warning) => (
                          <li key={`${warning.feature}:${warning.status}`}>
                            <strong>{FLA_COMPATIBILITY_LABELS[warning.status]} · {compatibilityFeatureLabel(warning.feature)}</strong>
                            <span>{compatibilityReason(warning.feature, warning.status, warning.reason)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </section>
              </aside>

              <section aria-labelledby="fla-raster-grid-heading" className="fla-raster-selection" data-testid="fla-raster-selection">
                <header>
                  <div>
                    <p className="fla-raster-panel-kicker">选择素材</p>
                    <h3 id="fla-raster-grid-heading">位图素材</h3>
                  </div>
                  <span>{reviewItems.length} 项</span>
                </header>
                <div
                  aria-label="FLA 位图素材"
                  className="fla-review-media-grid"
                  data-scroll-region="fla-media-grid"
                  data-testid="fla-review-media-grid"
                >
                  {reviewItems.map((item) => (
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
                  ))}
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
            <div
              className="fla-review-zero-raster"
              data-testid="fla-review-zero-raster"
              role="note"
            >
              {flaZeroRasterUserMessage(response, ir.structure) ??
                '文件已成功读取，但没有找到可直接导入的位图素材。'}
              <FlaStaticSnapshotReview
                sessionId={sessionId}
                source={{ basename: ir.source.basename, sha256: ir.source.sha256 }}
                snapshot={snapshot}
                onImported={(response) => onSnapshotImported?.(response)}
                onClose={() => onClose()}
              />
              <FlaFrameSequenceReview
                sessionId={sessionId}
                source={{ basename: ir.source.basename, sha256: ir.source.sha256 }}
                snapshot={snapshot}
                onImported={(response) => onSequenceImported?.(response)}
                onClose={() => onClose()}
              />
            </div>
          )}
        </div>

        {rasterRoute ? (
          <div className="fla-review-action-stack">
            <div className="fla-review-selection-toolbar" data-testid="fla-review-selection-toolbar">
              <div>
                <strong data-testid="fla-review-selected-count">已选择 {selectedCount} / {reviewItems.length}</strong>
                {intent ? <output data-testid="fla-review-intent-status">已确认选择；尚未创建素材。</output> : null}
              </div>
              <div className="fla-review-selection-actions">
                <div className="fla-review-selection-utilities">
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
            {phase === 'committing' ? (
              <output data-testid="fla-review-commit-status">正在导入已选择的素材…</output>
            ) : null}
            {commitResponse && !commitResponse.ok ? (
              <output data-testid="fla-review-commit-error" role="alert">{commitResponse.error.message}</output>
            ) : null}
            {phase === 'success' && commitResponse?.ok && commitResponse.status === 'completed' ? (
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
      <span>{media.width} × {media.height} · {item.libraryOnly ? '仅素材库' : '已使用'}</span>
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
        <div><dt>来源</dt><dd title={media.sourceReference}>{media.sourceReference}</dd></div>
        <div><dt>目标文件名</dt><dd>{item.name.targetFileName}</dd></div>
      </dl>
      {item.warnings.length > 0 ? (
        <div className="fla-review-detail-warnings" role="note">
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

/**
 * V1.5-B1 zero-raster copy that explicitly links the missing-raster fact to
 * the present-but-not-importable structure summary. Never claims that symbols,
 * layers, frames, or tweens are currently editable in Panda; says "detected"
 * (检测到) only.
 */
function flaZeroRasterUserMessage(
  response: FlaInspectionResponse | null,
  structure: FlaStructuralSummary | undefined,
): string | null {
  if (!structure) return null;
  const parts: string[] = [];
  if (structure.sceneCount > 0) {
    parts.push(
      structure.sceneCount === 1
        ? '1 个场景'
        : `${structure.sceneCount} 个场景`,
    );
  }
  if (structure.symbolCount > 0) {
    const breakdown: string[] = [];
    if (structure.graphicCount > 0) breakdown.push(`图形 ${structure.graphicCount}`);
    if (structure.movieClipCount > 0) breakdown.push(`影片剪辑 ${structure.movieClipCount}`);
    if (structure.buttonCount > 0) breakdown.push(`按钮 ${structure.buttonCount}`);
    const inner =
      breakdown.length > 0 ? `（${breakdown.join('、')}）` : '';
    parts.push(
      structure.symbolCount === 1
        ? `1 个元件${inner}`
        : `${structure.symbolCount} 个元件${inner}`,
    );
  }
  if (structure.layerCount > 0) {
    parts.push(
      structure.layerCount === 1
        ? '1 层'
        : `${structure.layerCount} 层`,
    );
  }
  if (structure.frameCount > 0) {
    parts.push(
      structure.frameCount === 1
        ? '1 帧'
        : `${structure.frameCount} 帧`,
    );
  }
  if (parts.length === 0) {
    return flaDiagnosticUserMessage(response) ??
      '文件已读取；没有可直接导入的位图。';
  }
  return `文件已读取；没有可直接导入的位图，不过检测到可读的 FLA 结构：${parts.join('、')}。Panda 目前不会导入这些结构信息。`;
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
