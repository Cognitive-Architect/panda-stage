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

interface FlaCompatibilityReviewSessionProps {
  inspection: FlaInspectionOperation;
  snapshot: EditorProjectSnapshot | null;
  onClose: () => void;
  onIntent?: (intent: FlaRasterSelectionIntent) => void;
  onCommit?: (response: FlaAssetCommitResponse) => void;
  onSnapshotImported?: (response: FlaStaticSnapshotCommitResponse) => void;
  onSequenceImported?: (response: unknown) => void;
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
  const reviewItems = useMemo(
    () => (ir ? reviewMedia(ir, snapshot?.project.assets ?? []) : []),
    [ir, snapshot],
  );
  const selectedCount = reviewItems.filter(({ media }) =>
    selectedMediaIds.has(media.id),
  ).length;
  const selectionLocked = phase === 'committing' || phase === 'success';

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
        role="dialog"
      >
        <header className="fla-review-heading" data-testid="fla-review-header">
          <div>
            <p className="eyebrow">导入前检查</p>
            <h2>FLA 兼容性预览</h2>
          </div>
          <button
            autoFocus
            disabled={phase === 'committing'}
            data-testid="fla-review-cancel"
            onClick={() => void closeSession()}
            type="button"
          >
            取消
          </button>
        </header>

        <div className="fla-review-selection-toolbar" data-testid="fla-review-selection-toolbar">
          <div>
            <strong data-testid="fla-review-selected-count">已选择：{selectedCount} / {reviewItems.length}</strong>
            {intent ? <output data-testid="fla-review-intent-status">已确认选择；尚未创建素材。</output> : null}
          </div>
          <div>
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
            <button
              data-testid="fla-review-confirm"
              disabled={
                selectedCount === 0 ||
                phase === 'confirmed' ||
                phase === 'committing' ||
                phase === 'success'
              }
              onClick={confirm}
              type="button"
            >
              {phase === 'confirmed' ? '已确认选择' : '确认选择'}
            </button>
          </div>
        </div>

        <div className="fla-review-action-stack">
          {intent && phase === 'confirmed' ? (
            <div className="fla-review-commit-action" data-testid="fla-review-commit-action">
              <div className="fla-review-commit-copy">
                <strong data-testid="fla-review-commit-copy">已确认 {intent.selectedCount} 项</strong>
                <span>确认选择仅保留选择信息；点击导入后才会创建普通图片素材。</span>
              </div>
              <button
                className="fla-review-commit-primary"
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
        <div
          className="fla-review-body"
          data-preserves-scroll-position="true"
          data-testid="fla-review-body"
          onScroll={(event) => {
            reviewScrollTop.current = event.currentTarget.scrollTop;
          }}
          ref={reviewBodyRef}
        >
          <p className="fla-review-readonly-note">
            这是导入前预览。确认选择只会记录本次选择；点击“导入”后才会创建项目素材。
          </p>

          <dl className="fla-review-summary" data-testid="fla-review-summary">
            <div><dt>源文件</dt><dd>{ir.source.basename}</dd></div>
            <div><dt>舞台</dt><dd>{ir.document.width} × {ir.document.height} · {ir.document.frameRate} fps</dd></div>
            <div><dt>素材</dt><dd data-testid="fla-review-media-count">{ir.media.length}</dd></div>
            <div><dt>已使用</dt><dd>{ir.summary.placedInstanceCount}</dd></div>
            <div><dt>仅素材库</dt><dd>{ir.summary.libraryOnlyMediaCount}</dd></div>
            {ir.structure ? (
              <FlaStructuralSummaryReadOnly summary={ir.structure} />
            ) : null}
          </dl>

          <section aria-labelledby="fla-compatibility-heading" className="fla-review-compatibility">
            <h3 id="fla-compatibility-heading">兼容性</h3>
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

          {ir.media.length === 0 ? (
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
          ) : (
            <div
              aria-label="FLA 位图素材"
              className="fla-review-media-grid"
              data-scroll-region="fla-media-grid"
              data-testid="fla-review-media-grid"
            >
              {reviewItems.map((item) => (
                <FlaReviewMediaCard
                  item={item}
                  key={item.media.id}
                  selected={selectedMediaIds.has(item.media.id)}
                  selectionLocked={selectionLocked}
                  thumbnailUrl={thumbnailUrls[item.media.id]}
                  onToggle={() => toggle(item.media.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </FlaReviewPortal>
  );
}

function FlaReviewMediaCard({
  item,
  selected,
  selectionLocked,
  thumbnailUrl,
  onToggle,
}: {
  item: FlaReviewMedia;
  selected: boolean;
  selectionLocked: boolean;
  thumbnailUrl?: string;
  onToggle: () => void;
}): React.JSX.Element {
  const { media } = item;
  return (
    <article
      aria-label={`${selected ? '取消选择' : '选择'} ${media.name}`}
      aria-pressed={selected}
      className={`fla-review-media-card${selected ? ' fla-review-media-card-selected' : ''}`}
      data-alpha-kind={media.payload.alpha.kind}
      data-fla-media-id={media.id}
      data-library-only={item.libraryOnly ? 'true' : 'false'}
      data-source-format={media.sourceFormat}
      data-target-file-name={item.name.targetFileName}
      data-testid={`fla-review-media-card-${media.id}`}
      data-zero-alpha-pixels={media.payload.alpha.zeroAlphaPixels}
      onClick={(event: ReactMouseEvent<HTMLElement>) => {
        if (isNestedInteractiveTarget(event.target)) return;
        onToggle();
      }}
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
      <span title={media.sourceReference}>来源：{media.sourceReference}</span>
      <span>{media.width} × {media.height} · 格式 {media.sourceFormat.toUpperCase()}</span>
      <span>{item.libraryOnly ? '仅素材库' : '已使用'}</span>
      <span>目标文件名：{item.name.targetFileName}</span>
      {item.warnings.length > 0 ? (
        <ul className="fla-review-name-warnings">
          {item.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
    </article>
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
