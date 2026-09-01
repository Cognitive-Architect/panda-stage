/**
 * V2-R1 Static Snapshot — Stage D zero-raster render workbench.
 *
 * This is a presentation convergence over the existing R1 catalog, preview,
 * stale-preview guard, and explicit ImageAsset commit contracts. The review
 * surface remains read-only until the user explicitly imports the latest
 * valid preview.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  FlaRenderTarget,
  FlaRenderableTargetCatalogEntry,
  FlaStaticSnapshotCommitResponse,
  FlaStaticSnapshotPreviewResponse,
} from '../../shared/fla-static-snapshot-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { flaStaticSnapshotClient } from './fla-static-snapshot-render';

interface FlaStaticSnapshotStageFacts {
  width: number;
  height: number;
  frameRate: number;
}

interface FlaStaticSnapshotReviewProps {
  sessionId: string;
  source: { basename: string; sha256: string };
  stage?: FlaStaticSnapshotStageFacts;
  snapshot: EditorProjectSnapshot | null;
  onImported: (response: FlaStaticSnapshotCommitResponse) => void;
  onClose: () => void;
}

type SnapshotPhase =
  | 'loading'
  | 'selecting'
  | 'previewing'
  | 'preview-ready'
  | 'committing'
  | 'committed'
  | 'error';

const COMPATIBILITY_NOTE: Record<string, string> = {
  exact: '当前目标可按 Panda 的安全渲染范围预览。',
  degraded: '当前可预览，但时间轴动画、渐变方向、描边等细节可能不完整。',
  unsupported: '该目标暂不在当前单帧渲染范围内。',
  unknown: '该目标的兼容性暂未完全确认。',
  'not-present': '源文件中未发现该类兼容性信息。',
};

export function FlaStaticSnapshotReview({
  sessionId,
  source,
  stage,
  snapshot,
  onImported,
  onClose,
}: FlaStaticSnapshotReviewProps): React.JSX.Element {
  const [phase, setPhase] = useState<SnapshotPhase>('loading');
  const [entries, setEntries] = useState<FlaRenderableTargetCatalogEntry[]>([]);
  const [targetSearch, setTargetSearch] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [preview, setPreview] = useState<FlaStaticSnapshotPreviewResponse | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [commitResponse, setCommitResponse] = useState<FlaStaticSnapshotCommitResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const previewRequestIdRef = useRef<string | null>(null);
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.target.renderTargetId === selectedTargetId) ?? null,
    [entries, selectedTargetId],
  );
  const visibleEntries = useMemo(() => {
    const query = targetSearch.trim().toLocaleLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => entry.target.userLabel.toLocaleLowerCase().includes(query));
  }, [entries, targetSearch]);
  const selecting = selectedEntry?.target ?? null;
  const frameCount = selecting?.frameCount ?? 0;
  const supported = selectedEntry?.previewSupported === true;
  const previewIsCurrent = Boolean(
    preview?.ok === true &&
    selecting &&
    preview.targetRenderTargetId === selecting.renderTargetId &&
    preview.targetSelectedFrameIndex === selectedFrameIndex,
  );
  const previewState = phase === 'previewing'
    ? 'rendering'
    : phase === 'error'
      ? 'error'
      : previewIsCurrent
        ? 'valid'
        : 'needs-preview';

  // Load the Main-owned catalog once for this inspection session.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const response = await flaStaticSnapshotClient.catalog(sessionId);
        if (disposed) return;
        if (!response.ok) {
          setErrorMessage(response.error.message);
          setPhase('error');
          return;
        }
        setEntries(response.entries);
        const firstEntry = response.entries[0];
        setSelectedTargetId(firstEntry?.target.renderTargetId ?? null);
        setSelectedFrameIndex(0);
        setPhase('selecting');
      } catch (error) {
        if (disposed) return;
        setErrorMessage(error instanceof Error ? error.message : '无法获取可渲染内容列表。');
        setPhase('error');
      }
    })();
    return () => {
      disposed = true;
    };
  }, [sessionId]);

  // Revoke transient preview resources whenever the active URL changes.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Any authoritative target/frame change invalidates both renderer state and
  // Main's commit candidate. This prevents a stale image from being imported
  // after the user changes the render intent.
  useEffect(() => {
    setPreview(null);
    setPreviewUrl(null);
    setCommitResponse(null);
    setErrorMessage('');
    previewRequestIdRef.current = null;
    setPhase((current) => {
      if (current === 'loading') return current;
      if (current === 'committed') return current;
      return 'selecting';
    });
    void flaStaticSnapshotClient.cancel({
      format: 'fla-static-snapshot-cancel',
      version: 1,
      sessionId,
    });
  }, [selectedTargetId, selectedFrameIndex, sessionId]);

  // Mode switches unmount this panel. Invalidate any Main-side preview that
  // would otherwise remain eligible while the sibling R2 panel is visible.
  useEffect(() => {
    return () => {
      previewRequestIdRef.current = null;
      void flaStaticSnapshotClient.cancel({
        format: 'fla-static-snapshot-cancel',
        version: 1,
        sessionId,
      });
    };
  }, [sessionId]);

  if (entries.length === 0 && phase !== 'loading' && phase !== 'error') {
    return (
      <div
        className="fla-snapshot-review fla-render-workbench-panel"
        data-testid="fla-snapshot-review"
        data-workbench-panel="snapshot"
        role="note"
      >
        <p data-testid="fla-snapshot-empty">这个 FLA 没有可渲染的矢量内容。</p>
      </div>
    );
  }

  if (phase === 'loading' || phase === 'error' || !selectedEntry || !selecting) {
    return (
      <div
        className="fla-snapshot-review fla-render-workbench-panel"
        data-preview-state={phase === 'error' ? 'error' : 'needs-preview'}
        data-testid="fla-snapshot-review"
        data-workbench-panel="snapshot"
        role="note"
      >
        {phase === 'loading' ? (
          <p data-testid="fla-snapshot-loading">正在分析可渲染的图形…</p>
        ) : (
          <p role="alert" data-testid="fla-snapshot-error">{errorMessage || '无法获取可渲染内容。'}</p>
        )}
      </div>
    );
  }

  const previewNow = async (): Promise<void> => {
    if (!supported || !snapshot) return;

    // Re-previewing the same target/frame must also invalidate the previous
    // accepted preview before a new request becomes the sole candidate.
    await flaStaticSnapshotClient.cancel({
      format: 'fla-static-snapshot-cancel',
      version: 1,
      sessionId,
    });
    setPreview(null);
    setPreviewUrl(null);
    setCommitResponse(null);
    setPhase('previewing');
    setErrorMessage('');

    const requestId = crypto.randomUUID();
    previewRequestIdRef.current = requestId;
    const target: FlaRenderTarget = {
      ...selecting,
      selectedFrameIndex,
    };
    try {
      const response = await flaStaticSnapshotClient.preview({
        format: 'fla-static-snapshot-preview',
        version: 1,
        requestId,
        sessionId,
        target,
      });
      if (previewRequestIdRef.current !== requestId) return;
      setPreview(response);
      if (response.ok && response.bytes) {
        const url = URL.createObjectURL(
          new Blob([response.bytes.buffer as ArrayBuffer], { type: 'image/png' }),
        );
        setPreviewUrl(url);
        setPhase('preview-ready');
      } else {
        setErrorMessage(response.ok ? '预览生成失败。' : response.error.message);
        setPhase('error');
      }
    } catch (error) {
      if (previewRequestIdRef.current !== requestId) return;
      setErrorMessage(error instanceof Error ? error.message : '预览失败。');
      setPhase('error');
    }
  };

  const importFrame = async (): Promise<void> => {
    if (!previewIsCurrent || !preview || !preview.ok || !snapshot || phase !== 'preview-ready') return;
    setPhase('committing');
    setErrorMessage('');
    const target: FlaRenderTarget = {
      ...selecting,
      selectedFrameIndex,
    };
    try {
      const response = await flaStaticSnapshotClient.commit({
        format: 'fla-static-snapshot-commit',
        version: 1,
        projectRoot: snapshot.projectRoot,
        project: snapshot.project,
        baseRevision: snapshot.revision,
        sessionId,
        confirmedPreviewRequestId: preview.requestId,
        source,
        target,
        preview: {
          sha256: preview.sha256,
          width: preview.width,
          height: preview.height,
          byteLength: preview.bytes.byteLength,
        },
        confirmed: true,
      });
      setCommitResponse(response);
      if (response.ok && response.status === 'completed') {
        setPhase('committed');
        onImported(response);
      } else {
        setErrorMessage(response.ok ? '导入失败。' : response.error.message);
        setPhase('preview-ready');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导入失败。');
      setPhase('preview-ready');
    }
  };

  const close = (): void => {
    if (phase === 'committing') return;
    previewRequestIdRef.current = null;
    void flaStaticSnapshotClient.cancel({
      format: 'fla-static-snapshot-cancel',
      version: 1,
      sessionId,
    });
    onClose();
  };

  const compatibilityNote = selecting.compatibility
    .map((status) => COMPATIBILITY_NOTE[status])
    .filter(Boolean)
    .join(' ');
  const previewStatus = snapshotPreviewStatus(phase, previewIsCurrent);
  const canPreview = supported && Boolean(snapshot) && phase !== 'previewing' && phase !== 'committing' && phase !== 'committed';
  const canImport = previewIsCurrent && phase === 'preview-ready';

  return (
    <div
      className="fla-snapshot-review fla-render-workbench-panel"
      data-preview-state={previewState}
      data-testid="fla-snapshot-review"
      data-workbench-panel="snapshot"
    >
      <div className="fla-snapshot-workbench" data-testid="fla-snapshot-workbench">
        <aside className="fla-snapshot-source-region" data-testid="fla-snapshot-source-region">
          <span className="fla-snapshot-badge">零位图 · 只读</span>
          <div>
            <p className="fla-render-panel-kicker">来源文件</p>
            <h3 title={source.basename}>{source.basename}</h3>
            <p data-testid="fla-snapshot-zero-raster">从可渲染目标生成 PNG 图片素材</p>
          </div>
          <dl className="fla-snapshot-facts" data-testid="fla-snapshot-source-facts">
            {stage ? (
              <div>
                <dt>舞台</dt>
                <dd>{stage.width} × {stage.height} · {stage.frameRate} fps</dd>
              </div>
            ) : null}
            <div>
              <dt>可渲染目标</dt>
              <dd data-testid="fla-snapshot-target-count">{entries.length} 个</dd>
            </div>
          </dl>

          <section className="fla-snapshot-target-region" aria-labelledby="fla-snapshot-target-heading">
            <header>
              <div>
                <p className="fla-render-panel-kicker">第一步</p>
                <h3 id="fla-snapshot-target-heading">选择目标</h3>
              </div>
              <span data-testid="fla-snapshot-visible-target-count">{visibleEntries.length} / {entries.length}</span>
            </header>
            <label className="fla-snapshot-target-search">
              <span>搜索目标</span>
              <input
                aria-label="搜索目标名称"
                data-testid="fla-snapshot-target-search"
                onChange={(event) => setTargetSearch(event.currentTarget.value)}
                placeholder="按名称搜索"
                type="search"
                value={targetSearch}
              />
            </label>
            <ul className="fla-snapshot-targets" data-testid="fla-snapshot-targets">
              {visibleEntries.map((entry) => {
                const target = entry.target;
                const compatibility = target.compatibility
                  .map((status) => COMPATIBILITY_NOTE[status])
                  .filter(Boolean)
                  .join(' ');
                const showException = !entry.previewSupported || target.compatibility.some(
                  (status) => status === 'unsupported' || status === 'unknown',
                );
                return (
                  <li
                    className={target.renderTargetId === selectedTargetId ? 'is-selected' : undefined}
                    data-preview-supported={entry.previewSupported ? 'true' : 'false'}
                    key={target.renderTargetId}
                  >
                    <label aria-label={`${target.userLabel}，${target.frameCount} 帧`} title={target.userLabel}>
                      <input
                        type="radio"
                        name="fla-snapshot-target"
                        checked={target.renderTargetId === selectedTargetId}
                        disabled={!entry.previewSupported || phase === 'committing' || phase === 'committed'}
                        onChange={() => {
                          setSelectedTargetId(target.renderTargetId);
                          setSelectedFrameIndex(0);
                        }}
                        data-testid={`fla-snapshot-target-${target.renderTargetId}`}
                      />
                      <span className="fla-snapshot-target-copy">
                        <strong title={target.userLabel}>{target.userLabel}</strong>
                        <small>{target.frameCount} 帧</small>
                        {showException ? (
                          <small
                            className={entry.previewSupported ? 'fla-snapshot-target-fidelity' : 'fla-snapshot-unsupported'}
                            title={entry.previewSupported ? compatibility : entry.unsupportedReason}
                          >
                            {entry.previewSupported ? '需注意' : '暂不可预览'}
                          </small>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
              {visibleEntries.length === 0 ? (
                <li className="fla-snapshot-targets-empty">没有匹配的目标，请清除搜索。</li>
              ) : null}
            </ul>
          </section>
        </aside>

        <section className="fla-snapshot-preview-region" data-testid="fla-snapshot-preview-region">
          <header className="fla-snapshot-region-heading">
            <div>
              <p className="fla-render-panel-kicker">第二步 · 视觉焦点</p>
              <h3>预览当前帧</h3>
            </div>
            <output
              aria-live="polite"
              data-preview-state={previewState}
              data-testid="fla-snapshot-preview-status"
            >
              {previewStatus}
            </output>
          </header>

          <div
            className="fla-snapshot-preview-stage"
            data-preview-state={previewState}
            data-testid="fla-snapshot-preview-area"
          >
            {previewUrl && previewIsCurrent ? (
              <img
                alt={`${selecting.userLabel} 第 ${selectedFrameIndex + 1} 帧预览`}
                data-testid="fla-snapshot-preview-image"
                src={previewUrl}
              />
            ) : (
              <div className="fla-snapshot-preview-placeholder" data-testid="fla-snapshot-preview-placeholder">
                <strong>{previewState === 'rendering' ? '正在生成预览…' : previewState === 'error' ? '预览失败' : '需要重新预览'}</strong>
                <span>{previewState === 'needs-preview' ? '确认目标与帧后，点击下方“预览当前帧”。' : '当前帧尚未产生可导入的有效预览。'}</span>
              </div>
            )}
          </div>

          {supported ? (
            <div className="fla-snapshot-frame" data-testid="fla-snapshot-frame-controls">
              <div>
                <p className="fla-render-panel-kicker">帧选择</p>
                <strong>当前帧</strong>
              </div>
              <div className="fla-snapshot-frame-controls">
                <button
                  type="button"
                  disabled={selectedFrameIndex <= 0 || phase === 'committing' || phase === 'committed'}
                  onClick={() => setSelectedFrameIndex((index) => Math.max(0, index - 1))}
                  data-testid="fla-snapshot-frame-prev"
                >
                  上一帧
                </button>
                <label>
                  <span className="sr-only">当前帧编号</span>
                  <input
                    type="number"
                    min={0}
                    max={frameCount - 1}
                    value={selectedFrameIndex}
                    disabled={phase === 'committing' || phase === 'committed'}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value)) {
                        setSelectedFrameIndex(Math.min(frameCount - 1, Math.max(0, Math.trunc(value))));
                      }
                    }}
                    data-testid="fla-snapshot-frame-input"
                  />
                </label>
                <span>/ {Math.max(0, frameCount - 1)}</span>
                <button
                  type="button"
                  disabled={selectedFrameIndex >= frameCount - 1 || phase === 'committing' || phase === 'committed'}
                  onClick={() => setSelectedFrameIndex((index) => Math.min(frameCount - 1, index + 1))}
                  data-testid="fla-snapshot-frame-next"
                >
                  下一帧
                </button>
              </div>
            </div>
          ) : null}

          <p className="fla-snapshot-fidelity" role="note" data-testid="fla-snapshot-fidelity">
            {compatibilityNote || '当前预览遵循 Panda 的安全渲染范围。'}
          </p>
        </section>

        <aside className="fla-snapshot-details-region" data-testid="fla-snapshot-details-region">
          <p className="fla-render-panel-kicker">第三步 · 结果详情</p>
          <h3>{selecting.userLabel}</h3>
          <dl className="fla-snapshot-details" data-testid="fla-snapshot-details">
            <div><dt>目标类型</dt><dd>{renderTargetKindLabel(selecting.kind)}</dd></div>
            <div><dt>可用帧</dt><dd>0 – {Math.max(0, frameCount - 1)}</dd></div>
            <div><dt>输出</dt><dd>ImageAsset（PNG）</dd></div>
            <div><dt>来源</dt><dd title={source.basename}>{source.basename}</dd></div>
          </dl>
          <p className="fla-snapshot-detail-warning" role="note">
            保真度：{snapshotFidelityLabel(selecting.compatibility)}
          </p>
          <details className="fla-snapshot-compatibility" data-testid="fla-snapshot-compatibility-details">
            <summary>更多详情</summary>
            <ul>
              {selecting.compatibility.map((status) => (
                <li data-status={status} key={status}>{COMPATIBILITY_NOTE[status]}</li>
              ))}
            </ul>
            <dl className="fla-snapshot-detail-more">
              <div><dt>目标标识</dt><dd title={selecting.renderTargetId}>{selecting.renderTargetId}</dd></div>
              {selecting.sourceLibraryItemName ? (
                <div><dt>源元件</dt><dd title={selecting.sourceLibraryItemName}>{selecting.sourceLibraryItemName}</dd></div>
              ) : null}
              {selecting.sourceTimelineIndex !== undefined ? (
                <div><dt>源时间线</dt><dd>{selecting.sourceTimelineIndex}</dd></div>
              ) : null}
            </dl>
            {!supported ? <p className="fla-snapshot-unsupported">{selectedEntry.unsupportedReason}</p> : null}
          </details>
          <p className="fla-snapshot-readonly-note" data-testid="fla-snapshot-readonly-note">
            导入只创建当前帧的 PNG 图片素材。
          </p>
        </aside>
      </div>

      <div className="fla-snapshot-action-bar" data-testid="fla-snapshot-action-bar">
        <div className="fla-snapshot-action-status">
          <p className="fla-render-panel-kicker">当前选择</p>
          <strong data-testid="fla-snapshot-action-state" title={selecting.userLabel}>
            {selecting.userLabel} · 第 {selectedFrameIndex + 1} 帧
          </strong>
          <span data-testid="fla-snapshot-action-guidance">
            {snapshotActionLabel(phase, supported, previewIsCurrent)}
          </span>
          {errorMessage ? <span role="alert" data-testid="fla-snapshot-error">{errorMessage}</span> : null}
          {phase === 'committed' && commitResponse?.ok && commitResponse.status === 'completed' ? (
            <span data-testid="fla-snapshot-committed">已导入：{commitResponse.result.targetFileName}</span>
          ) : null}
        </div>
        <div className="fla-snapshot-action-buttons">
          <button
            className={canImport ? 'fla-snapshot-secondary-action' : 'fla-render-primary-action'}
            type="button"
            disabled={!canPreview}
            onClick={() => void previewNow()}
            data-testid="fla-snapshot-preview"
          >
            {phase === 'previewing' ? '正在预览…' : previewIsCurrent ? '重新预览' : '预览当前帧'}
          </button>
          {canImport ? (
            <button
              className="fla-render-primary-action"
              type="button"
              disabled={!canImport}
              onClick={() => void importFrame()}
              data-testid="fla-snapshot-import"
            >
              导入当前帧
            </button>
          ) : null}
          <button
            className="fla-snapshot-close-action"
            type="button"
            disabled={phase === 'committing'}
            onClick={() => void close()}
            data-testid="fla-snapshot-close"
          >
            返回
          </button>
        </div>
      </div>
    </div>
  );
}

function renderTargetKindLabel(kind: FlaRenderTarget['kind']): string {
  switch (kind) {
    case 'scene':
      return '场景';
    case 'timeline':
      return '时间线';
    case 'graphic-symbol':
      return '图形元件';
    default:
      return '未知目标';
  }
}

function snapshotFidelityLabel(compatibility: FlaRenderTarget['compatibility']): string {
  if (compatibility.some((status) => status === 'unsupported' || status === 'unknown')) {
    return '需要注意兼容性';
  }
  if (compatibility.includes('degraded')) return '部分兼容';
  return '当前支持范围内';
}

function snapshotPreviewStatus(phase: SnapshotPhase, previewIsCurrent: boolean): string {
  if (phase === 'loading') return '正在读取目标';
  if (phase === 'previewing') return '正在生成';
  if (phase === 'committing') return '正在导入';
  if (phase === 'committed') return '已导入';
  if (phase === 'error') return '需要重试';
  return previewIsCurrent ? '有效预览' : '需要重新预览';
}

function snapshotActionLabel(
  phase: SnapshotPhase,
  supported: boolean,
  previewIsCurrent: boolean,
): string {
  if (!supported) return '当前目标暂不可预览';
  if (phase === 'previewing') return '等待当前帧预览完成';
  if (phase === 'committing') return '正在创建图片素材';
  if (phase === 'committed') return '当前帧已导入项目';
  if (previewIsCurrent) return '预览有效，可以导入当前帧';
  return '先生成当前帧预览';
}
