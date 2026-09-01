/**
 * V2-R2 Frame Sequence - renderer review surface.
 *
 * The component owns the existing R2 review state machine and presents it as
 * the sequence sibling of the accepted Stage D snapshot workbench. The visual
 * shell is intentionally task-first: target selection, range, review, and the
 * explicit import action are visible together without changing the R2 IPC or
 * Project mutation boundaries.
 *
 * Hard boundaries (R2-A/B/C/D/E + Corrective A/B/C/D):
 *  - previewing / importing never mutates the Project until explicit commit;
 *  - over-cap / reversed / out-of-range ranges are rejected before any IPC;
 *  - the per-frame PNG bytes stay Main-owned; the Renderer only holds
 *    transient object URLs for the current bounded sequence;
 *  - a stale / late completion cannot overwrite the current request or
 *    become commit-eligible;
 *  - re-render invalidates the prior commit candidate;
 *  - closing / unmounting cancels or invalidates live sequence work;
 *  - focusing a filmstrip frame changes review focus only, never R2 authority.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  FlaRenderableTargetCatalogEntry,
  FlaRenderTarget,
} from '../../shared/fla-static-snapshot-api';
import type {
  FlaFrameSequenceCommitResponse,
  FlaFrameSequenceResponse,
  FlaFrameSequenceSuccess,
} from '../../shared/fla-frame-sequence-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { flaStaticSnapshotClient } from './fla-static-snapshot-render';
import { flaFrameSequenceClient } from './fla-frame-sequence-render';
import { formatFlaFrameSequenceCommitResult } from './formatFlaFrameSequenceCommitResult';
import {
  buildRange,
  getDefaultSequenceRange,
  intentChangeReset,
  isCommitEligible,
  isCurrentResponse,
  MAX_SEQUENCE_FRAMES,
  postCommitSequenceState,
  rerenderReset,
  validateRange,
} from './fla-frame-sequence-review-state';

interface FlaFrameSequenceReviewProps {
  sessionId: string;
  source: { basename: string; sha256: string };
  snapshot: EditorProjectSnapshot | null;
  embedded?: boolean;
  onImported: (response: FlaFrameSequenceCommitResponse) => void;
  onClose: () => void;
}

type RenderPhase =
  | 'loading'
  | 'selecting'
  | 'rendering'
  | 'preview-ready'
  | 'committing'
  | 'committed'
  | 'cancelled'
  | 'error';

export function FlaFrameSequenceReview({
  sessionId,
  source,
  snapshot,
  embedded = false,
  onImported,
  onClose,
}: FlaFrameSequenceReviewProps): React.JSX.Element {
  const [phase, setPhase] = useState<RenderPhase>('loading');
  const [entries, setEntries] = useState<FlaRenderableTargetCatalogEntry[]>([]);
  const [targetSearch, setTargetSearch] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [startFrameIndex, setStartFrameIndex] = useState(0);
  const [endFrameIndex, setEndFrameIndex] = useState(0);
  const [completedFrameCount, setCompletedFrameCount] = useState(0);
  const [success, setSuccess] = useState<FlaFrameSequenceSuccess | null>(null);
  const [previewUrls, setPreviewUrls] = useState<ReadonlyArray<string>>([]);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const [commitResponse, setCommitResponse] = useState<FlaFrameSequenceCommitResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // R2-D: the latest completed sequence the UI has accepted. Only this one
  // is commit-eligible; an older / stale result cannot become current.
  const activeRequestIdRef = useRef<string | null>(null);
  const acceptedRequestIdRef = useRef<string | null>(null);
  const latestSequenceRef = useRef<FlaFrameSequenceSuccess | null>(null);
  const catalogInitializedRef = useRef(false);
  // Problem B (Corrective #296): active progress subscription handle.
  // Subscribed only while a request is in flight; removed on
  // cancel / re-render / completion / unmount.
  const progressUnsubRef = useRef<(() => void) | null>(null);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.target.renderTargetId === selectedTargetId) ?? null,
    [entries, selectedTargetId],
  );
  const reviewClassName = embedded
    ? 'fla-frame-sequence-review fla-render-workbench-panel'
    : 'fla-frame-sequence-review';
  const targetFrameCount = selectedEntry?.target.frameCount ?? 0;
  const visibleEntries = useMemo(() => {
    const query = targetSearch.trim().toLocaleLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => entry.target.userLabel.toLocaleLowerCase().includes(query));
  }, [entries, targetSearch]);

  const validation = useMemo(
    () => validateRange(startFrameIndex, endFrameIndex, targetFrameCount),
    [startFrameIndex, endFrameIndex, targetFrameCount],
  );
  const orderedSequenceItems = useMemo(
    () => success?.items.slice().sort((a, b) => a.frameIndex - b.frameIndex) ?? [],
    [success],
  );
  const selectedPreviewItem = orderedSequenceItems[selectedPreviewIndex] ?? null;
  const selectedPreviewUrl = previewUrls[selectedPreviewIndex] ?? null;
  const hasPreview = Boolean(selectedPreviewItem && selectedPreviewUrl);
  const sequenceIsCurrent = Boolean(
    phase === 'preview-ready' &&
      success &&
      isCommitEligible(success, acceptedRequestIdRef.current === success.requestId),
  );
  const previewState = phase === 'rendering'
    ? 'rendering'
    : phase === 'error'
      ? 'error'
      : hasPreview
        ? phase === 'committed' ? 'committed' : 'valid'
        : 'needs-preview';

  // Revoke object URLs on unmount / sequence change.
  useEffect(() => {
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  // Load the catalog once (reused from R1 surface).
  useEffect(() => {
    let disposed = false;
    catalogInitializedRef.current = false;
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
        if (!catalogInitializedRef.current) {
          catalogInitializedRef.current = true;
          const firstSupported = response.entries.find((entry) => entry.previewSupported);
          if (firstSupported) {
            const defaultRange = getDefaultSequenceRange(firstSupported.target.frameCount);
            setSelectedTargetId(firstSupported.target.renderTargetId);
            setStartFrameIndex(defaultRange.startFrameIndex);
            setEndFrameIndex(defaultRange.endFrameIndex);
          }
        }
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

  const clearPreviewResources = (): void => {
    setPreviewUrls((current) => {
      for (const url of current) URL.revokeObjectURL(url);
      return [];
    });
    setSelectedPreviewIndex(0);
  };

  // Changing target invalidates any prior sequence state (Corrective C).
  useEffect(() => {
    const reset = intentChangeReset();
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
    activeRequestIdRef.current = null;
    acceptedRequestIdRef.current = null;
    latestSequenceRef.current = null;
    setSuccess(reset.success);
    setCompletedFrameCount(reset.completedFrameCount);
    clearPreviewResources();
    setCommitResponse(reset.commitResponse);
    setPhase((current) => (current === 'loading' ? current : reset.phase));
    void flaFrameSequenceClient.cancel({ format: 'fla-frame-sequence-cancel', version: 1, sessionId });
  }, [selectedTargetId, sessionId]);

  // Changing the selected render intent (start/end frame) MUST immediately
  // invalidate the prior accepted sequence. The UI must never commit an old
  // rendered range while displaying a different range.
  useEffect(() => {
    // Skip until a render has produced an accepted sequence or a stale
    // candidate exists. The initial catalog-load path is handled above.
    if (!acceptedRequestIdRef.current && !success) return;
    const reset = intentChangeReset();
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
    activeRequestIdRef.current = null;
    acceptedRequestIdRef.current = null;
    latestSequenceRef.current = null;
    setSuccess(reset.success);
    setCompletedFrameCount(reset.completedFrameCount);
    clearPreviewResources();
    setCommitResponse(reset.commitResponse);
    setPhase((current) => (current === 'loading' ? current : reset.phase));
    void flaFrameSequenceClient.cancel({ format: 'fla-frame-sequence-cancel', version: 1, sessionId });
  }, [startFrameIndex, endFrameIndex]);

  // Cancel / invalidate any in-flight sequence on unmount (Corrective C).
  // Problem B: also remove the progress subscription to avoid leaks.
  useEffect(() => {
    return () => {
      progressUnsubRef.current?.();
      progressUnsubRef.current = null;
      void flaFrameSequenceClient.cancel({ format: 'fla-frame-sequence-cancel', version: 1, sessionId });
    };
  }, [sessionId]);

  const buildPreviewUrls = (sequence: FlaFrameSequenceSuccess): string[] => {
    // Bounded transient display only - the PNG bytes are not retained after
    // unmount. Ordered by requested frame order, never completion order.
    return sequence.items
      .slice()
      .sort((a, b) => a.frameIndex - b.frameIndex)
      .map((item) =>
        URL.createObjectURL(new Blob([item.preview.bytes.buffer as ArrayBuffer], { type: 'image/png' })),
      );
  };

  const renderSequence = async (): Promise<void> => {
    if (!selectedEntry || !validation.valid || !snapshot) return;
    const renderTargetId = selectedEntry.target.renderTargetId;
    const range = buildRange(renderTargetId, startFrameIndex, endFrameIndex);
    if (!range) {
      setErrorMessage('所选帧范围无效。');
      setPhase('error');
      return;
    }
    const requestId = crypto.randomUUID();
    activeRequestIdRef.current = requestId;
    acceptedRequestIdRef.current = null;
    latestSequenceRef.current = null;
    setPhase('rendering');
    setErrorMessage('');
    setCommitResponse(null);
    setCompletedFrameCount(0);
    clearPreviewResources();
    // Problem B: subscribe to live progress for THIS request only.
    // Stale-request progress is ignored; the subscription is removed
    // on completion / cancel / re-render / unmount.
    progressUnsubRef.current?.();
    progressUnsubRef.current = flaFrameSequenceClient.progressSubscribe((progress) => {
      if (progress.requestId !== activeRequestIdRef.current) return;
      // Monotonic: never let a late/duplicate update lower the count.
      setCompletedFrameCount((current) => Math.max(current, progress.completedFrameCount));
    });
    try {
      const response: FlaFrameSequenceResponse = await flaFrameSequenceClient.render({
        format: 'fla-frame-sequence-render',
        version: 1,
        requestId,
        sessionId,
        range,
      });
      // Corrective C: a stale / late result can never overwrite the current
      // request or become commit-eligible.
      if (!isCurrentResponse(activeRequestIdRef.current, response)) return;
      progressUnsubRef.current?.();
      progressUnsubRef.current = null;
      if (response.ok) {
        const urls = buildPreviewUrls(response);
        setSuccess(response);
        setPreviewUrls(urls);
        setSelectedPreviewIndex(0);
        acceptedRequestIdRef.current = response.requestId;
        latestSequenceRef.current = response;
        setPhase('preview-ready');
      } else {
        setCompletedFrameCount(response.error.completedFrameCount ?? 0);
        setErrorMessage(response.error.message);
        setPhase(response.error.code === 'SEQUENCE_CANCELLED' ? 'cancelled' : 'error');
      }
    } catch (error) {
      if (!isCurrentResponse(activeRequestIdRef.current, { ok: false, error: { code: 'RENDER_FAILED', message: '', requestId } })) return;
      progressUnsubRef.current?.();
      progressUnsubRef.current = null;
      setErrorMessage(error instanceof Error ? error.message : '序列渲染失败。');
      setPhase('error');
    }
  };

  const cancelSequence = async (): Promise<void> => {
    if (phase !== 'rendering') return;
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
    try {
      const response = await flaFrameSequenceClient.cancel({
        format: 'fla-frame-sequence-cancel',
        version: 1,
        sessionId,
      });
      if (response.completedFrameCount !== undefined) {
        setCompletedFrameCount(response.completedFrameCount);
      }
    } catch {
      /* ignore - UI must not get stuck */
    }
    activeRequestIdRef.current = null;
    setPhase('cancelled');
  };

  const rerenderSequence = async (): Promise<void> => {
    // Corrective C: re-render invalidates the prior commit candidate.
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
    const reset = rerenderReset();
    setPhase(reset.phase);
    acceptedRequestIdRef.current = null;
    latestSequenceRef.current = null;
    setSuccess(null);
    clearPreviewResources();
    setCommitResponse(null);
    await renderSequence();
  };

  const commitSequence = async (): Promise<void> => {
    if (!success || !snapshot || phase !== 'preview-ready') return;
    if (!isCommitEligible(success, acceptedRequestIdRef.current === success.requestId)) return;
    const firstItem = orderedSequenceItems[0];
    const lastItem = orderedSequenceItems[orderedSequenceItems.length - 1];
    if (!firstItem || !lastItem) return;
    const range = buildRange(success.renderTargetId, firstItem.frameIndex, lastItem.frameIndex);
    if (!range) {
      setErrorMessage('序列范围无效，无法导入。');
      setPhase('error');
      return;
    }
    setPhase('committing');
    setErrorMessage('');
    try {
      const response = await flaFrameSequenceClient.commit({
        format: 'fla-frame-sequence-commit',
        version: 1,
        projectRoot: snapshot.projectRoot,
        project: snapshot.project,
        baseRevision: snapshot.revision,
        sessionId,
        confirmedSequenceRequestId: success.requestId,
        source,
        range,
        sequence: {
          requestId: success.requestId,
          sha256EachFrame: success.items.map((item) => item.preview.sha256),
          widthEachFrame: success.items.map((item) => item.preview.width),
          heightEachFrame: success.items.map((item) => item.preview.height),
          byteLengthEachFrame: success.items.map((item) => item.preview.bytes.byteLength),
          targetRenderTargetIdEachFrame: success.items.map((item) => item.preview.targetRenderTargetId),
        },
        confirmed: true,
      });
      setCommitResponse(response);
      if (response.ok && response.status === 'completed') {
        // Corrective C: commit success clears/disables stale commit state.
        const next = postCommitSequenceState();
        setPhase(next.phase);
        onImported(response);
      } else {
        setErrorMessage(response.ok ? '序列导入失败。' : response.error.message);
        setPhase('preview-ready');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '序列导入失败。');
      setPhase('preview-ready');
    }
  };

  const close = (): void => {
    if (phase === 'rendering' || phase === 'committing') return;
    void flaFrameSequenceClient.cancel({ format: 'fla-frame-sequence-cancel', version: 1, sessionId });
    onClose();
  };

  if (!selectedEntry) {
    return (
      <div className={reviewClassName} data-testid="fla-frame-sequence-review" data-workbench-panel={embedded ? 'sequence' : undefined} role="note">
        {phase === 'loading' ? (
          <p data-testid="fla-frame-sequence-loading">正在分析可渲染的图形…</p>
        ) : phase === 'error' ? (
          <p role="alert" data-testid="fla-frame-sequence-error">{errorMessage}</p>
        ) : (
          <p data-testid="fla-frame-sequence-empty">这个 FLA 没有可渲染的矢量内容。</p>
        )}
      </div>
    );
  }

  const target = selectedEntry.target;
  const supported = selectedEntry.previewSupported;
  const intentLocked = phase === 'rendering' || phase === 'committing';
  const canGeneratePhase = phase === 'selecting' || phase === 'cancelled' || phase === 'error';
  const canGenerate = supported && validation.valid && Boolean(snapshot) &&
    canGeneratePhase;
  const canImport = sequenceIsCurrent;
  return (
    <div
      className={reviewClassName}
      data-preview-state={previewState}
      data-testid="fla-frame-sequence-review"
      data-workbench-panel={embedded ? 'sequence' : undefined}
    >
      <div className="fla-frame-sequence-workbench" data-testid="fla-frame-sequence-workbench">
        <aside className="fla-frame-sequence-target-region" data-testid="fla-frame-sequence-target-region">
          <section aria-labelledby="fla-frame-sequence-target-heading">
            <header className="fla-frame-sequence-region-heading">
              <div>
                <p className="fla-render-panel-kicker">可渲染目标</p>
                <h3 id="fla-frame-sequence-target-heading">选择目标</h3>
              </div>
              <span data-testid="fla-frame-sequence-target-count">
                {targetSearch.trim() ? `${visibleEntries.length} / ${entries.length}` : `${entries.length} 个`}
              </span>
            </header>
            <label className="fla-frame-sequence-target-search">
              <span>搜索</span>
              <input
                aria-label="搜索目标名称"
                data-testid="fla-frame-sequence-target-search"
                onChange={(event) => setTargetSearch(event.currentTarget.value)}
                placeholder="按名称搜索"
                type="search"
                value={targetSearch}
              />
            </label>
            <ul className="fla-frame-sequence-targets" data-testid="fla-frame-sequence-targets">
              {visibleEntries.map((entry) => {
                const entryTarget = entry.target;
                const showException = !entry.previewSupported || entryTarget.compatibility.some(
                  (status) => status === 'unsupported' || status === 'unknown' || status === 'degraded',
                );
                return (
                  <li
                    className={entryTarget.renderTargetId === selectedTargetId ? 'is-selected' : undefined}
                    data-preview-supported={entry.previewSupported ? 'true' : 'false'}
                    key={entryTarget.renderTargetId}
                  >
                    <label aria-label={`${entryTarget.userLabel}，${entryTarget.frameCount} 帧`} title={entryTarget.userLabel}>
                      <input
                        type="radio"
                        name="fla-frame-sequence-target"
                        checked={entryTarget.renderTargetId === selectedTargetId}
                        disabled={!entry.previewSupported || intentLocked}
                        onChange={() => {
                          const defaultRange = getDefaultSequenceRange(entryTarget.frameCount);
                          setSelectedTargetId(entryTarget.renderTargetId);
                          setStartFrameIndex(defaultRange.startFrameIndex);
                          setEndFrameIndex(defaultRange.endFrameIndex);
                        }}
                        data-testid={`fla-frame-sequence-target-${entryTarget.renderTargetId}`}
                      />
                      <span className="fla-frame-sequence-target-copy">
                        <strong title={entryTarget.userLabel}>{entryTarget.userLabel}</strong>
                        <small>{entryTarget.frameCount} 帧</small>
                        {showException ? (
                          <small
                            className={entry.previewSupported ? 'fla-frame-sequence-target-fidelity' : 'fla-frame-sequence-unsupported'}
                            title={entry.previewSupported ? compatibilitySummary(entryTarget.compatibility) : entry.unsupportedReason}
                          >
                            {entry.previewSupported ? '需注意兼容性' : '暂不可预览'}
                          </small>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
              {visibleEntries.length === 0 ? (
                <li className="fla-frame-sequence-targets-empty">没有匹配的目标，请清除搜索。</li>
              ) : null}
            </ul>
          </section>
        </aside>

        <section className="fla-frame-sequence-preview-region" data-testid="fla-frame-sequence-preview-region">
          <header className="fla-frame-sequence-region-heading">
            <div>
              <p className="fla-render-panel-kicker">帧序列</p>
              <h3>当前帧预览</h3>
            </div>
            <output
              aria-live="polite"
              data-preview-state={previewState}
              data-testid="fla-frame-sequence-preview-status"
            >
              {sequencePreviewStatus(phase, hasPreview)}
            </output>
          </header>

          <div
            className="fla-frame-sequence-preview-stage"
            data-preview-state={previewState}
            data-testid="fla-frame-sequence-preview-area"
          >
            {selectedPreviewUrl && selectedPreviewItem ? (
              <img
                alt={`${target.userLabel} 第 ${selectedPreviewItem.frameIndex + 1} 帧预览`}
                data-testid="fla-frame-sequence-preview-image"
                src={selectedPreviewUrl}
              />
            ) : (
              <div className="fla-frame-sequence-preview-placeholder" data-testid="fla-frame-sequence-preview-placeholder">
                <strong>{phase === 'rendering' ? '正在生成帧序列…' : phase === 'error' ? '序列生成失败' : '等待生成帧序列'}</strong>
                <span>{phase === 'rendering' ? `已完成 ${completedFrameCount} / ${validation.valid ? validation.frameCount : 0} 帧` : '生成后可在这里检查当前帧。'}</span>
              </div>
            )}
          </div>

          <div
            className="fla-frame-sequence-range"
            data-range-end={String(endFrameIndex)}
            data-range-start={String(startFrameIndex)}
            data-testid="fla-frame-sequence-range"
            aria-labelledby="fla-frame-sequence-range-heading"
          >
            <header className="fla-frame-sequence-range-heading">
              <div>
                <p className="fla-render-panel-kicker">范围</p>
                <h3 id="fla-frame-sequence-range-heading">帧范围</h3>
              </div>
              <output aria-live="polite" data-testid="fla-frame-sequence-count">
                {validation.valid ? `${validation.frameCount} 帧` : '范围无效'}
              </output>
            </header>
            <div className="fla-frame-sequence-range-inputs" aria-disabled={intentLocked}>
              <label>
                <span>开始</span>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, targetFrameCount - 1)}
                  value={startFrameIndex}
                  disabled={intentLocked}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) setStartFrameIndex(Math.trunc(value));
                  }}
                  onInput={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) setStartFrameIndex(Math.trunc(value));
                  }}
                  data-testid="fla-frame-sequence-start"
                />
              </label>
              <span className="fla-frame-sequence-range-arrow" aria-hidden="true">→</span>
              <label>
                <span>结束</span>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, targetFrameCount - 1)}
                  value={endFrameIndex}
                  disabled={intentLocked}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) setEndFrameIndex(Math.trunc(value));
                  }}
                  onInput={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) setEndFrameIndex(Math.trunc(value));
                  }}
                  data-testid="fla-frame-sequence-end"
                />
              </label>
              <output className="fla-frame-sequence-range-result" aria-live="polite">
                = {validation.valid ? `${validation.frameCount} 帧` : '—'}
              </output>
            </div>
            <p className="fla-frame-sequence-range-cap">最多 {MAX_SEQUENCE_FRAMES} 帧</p>
            {!validation.valid && validation.message ? (
              <p role="alert" data-testid="fla-frame-sequence-range-error">{validation.message}</p>
            ) : null}
          </div>

          <div className="fla-frame-sequence-filmstrip-region" data-testid="fla-frame-sequence-filmstrip-region">
            <header className="fla-frame-sequence-filmstrip-heading">
              <span>序列预览</span>
              <small>{orderedSequenceItems.length > 0 ? `${orderedSequenceItems.length} 帧` : '尚未生成'}</small>
            </header>
            <div className="fla-frame-sequence-filmstrip" data-testid="fla-frame-sequence-filmstrip" role="list" aria-label="已生成帧序列">
              {orderedSequenceItems.length > 0 ? orderedSequenceItems.map((item, index) => {
                const url = previewUrls[index];
                return (
                  <div key={`${item.frameIndex}-${item.preview.requestId}`} role="listitem">
                    <button
                      aria-label={`查看第 ${item.frameIndex + 1} 帧`}
                      aria-pressed={selectedPreviewIndex === index}
                      className={selectedPreviewIndex === index ? 'is-selected' : undefined}
                      data-frame-index={item.frameIndex}
                      data-testid={`fla-frame-sequence-filmstrip-item-${item.frameIndex}`}
                      onClick={() => setSelectedPreviewIndex(index)}
                      type="button"
                    >
                      <span className="fla-frame-sequence-filmstrip-thumb">
                        {url ? <img alt="" src={url} /> : null}
                      </span>
                      <span>{String(item.frameIndex + 1).padStart(2, '0')}</span>
                    </button>
                  </div>
                );
              }) : (
                <p data-testid="fla-frame-sequence-filmstrip-empty">生成后将在这里按顺序显示缩略图。</p>
              )}
            </div>
          </div>
        </section>

        <aside className="fla-frame-sequence-details-region" data-testid="fla-frame-sequence-details-region">
          <p className="fla-render-panel-kicker">序列详情</p>
          <h3 title={target.userLabel}>{target.userLabel}</h3>
          <dl className="fla-frame-sequence-details" data-testid="fla-frame-sequence-details">
            <div><dt>素材</dt><dd>{renderTargetKindLabel(target.kind)} · {targetFrameCount} 帧</dd></div>
            <div><dt>输出</dt><dd>PNG 序列</dd></div>
            <div><dt>范围</dt><dd>{startFrameIndex}–{endFrameIndex} · {validation.valid ? `${validation.frameCount} 帧` : '无效'}</dd></div>
            <div><dt>结果</dt><dd>{orderedSequenceItems.length > 0 ? `${orderedSequenceItems.length} 帧已生成` : '待生成'}</dd></div>
          </dl>
          {hasFidelityCaveat(target.compatibility) ? (
            <p className="fla-frame-sequence-detail-warning" role="note">
              保真度：{sequenceFidelityLabel(target.compatibility)}
            </p>
          ) : null}
          <details className="fla-frame-sequence-more" data-testid="fla-frame-sequence-more-details">
            <summary>更多详情</summary>
            <ul>
              {target.compatibility.map((status) => (
                <li data-status={status} key={status}>{compatibilityNote(status)}</li>
              ))}
            </ul>
            <dl className="fla-frame-sequence-detail-more">
              <div><dt>目标标识</dt><dd title={target.renderTargetId}>{target.renderTargetId}</dd></div>
              {target.sourceLibraryItemName ? (
                <div><dt>源元件</dt><dd title={target.sourceLibraryItemName}>{target.sourceLibraryItemName}</dd></div>
              ) : null}
              {target.sourceTimelineIndex !== undefined ? (
                <div><dt>源时间线</dt><dd>{target.sourceTimelineIndex}</dd></div>
              ) : null}
            </dl>
            {!supported ? <p className="fla-frame-sequence-unsupported">{selectedEntry.unsupportedReason}</p> : null}
          </details>
        </aside>
      </div>

      <div className="fla-frame-sequence-action-bar" data-testid="fla-frame-sequence-action-bar">
        <div className="fla-frame-sequence-action-status">
          <strong data-testid="fla-frame-sequence-action-state" title={target.userLabel}>
            {target.userLabel} · {startFrameIndex}–{endFrameIndex} · {validation.valid ? `${validation.frameCount} 帧` : '范围无效'} · {sequenceFooterState(phase, supported, sequenceIsCurrent)}
          </strong>
          {phase === 'rendering' ? (
            <output aria-live="polite" data-testid="fla-frame-sequence-progress">
              正在生成 {completedFrameCount} / {validation.valid ? validation.frameCount : 0}
            </output>
          ) : null}
          {phase === 'cancelled' ? (
            <output data-testid="fla-frame-sequence-cancelled">
              已取消：{completedFrameCount} / {validation.valid ? validation.frameCount : 0} 帧
            </output>
          ) : null}
          {errorMessage ? <span role="alert" data-testid="fla-frame-sequence-error">{errorMessage}</span> : null}
          {phase === 'committed' && commitResponse?.ok && commitResponse.status === 'completed' ? (
            <span data-testid="fla-frame-sequence-committed">
              {formatFlaFrameSequenceCommitResult(commitResponse)}
            </span>
          ) : null}
        </div>
        <div className="fla-frame-sequence-action-buttons">
          <button
            className="fla-frame-sequence-secondary-action"
            type="button"
            disabled={intentLocked}
            onClick={() => void close()}
            data-testid="fla-frame-sequence-close"
          >
            返回
          </button>
          {canGeneratePhase ? (
            <button
              className="fla-render-primary-action"
              type="button"
              disabled={!canGenerate}
              onClick={() => void renderSequence()}
              data-testid="fla-frame-sequence-render"
            >
              生成帧序列
            </button>
          ) : null}
          {phase === 'rendering' ? (
            <button
              className="fla-render-primary-action"
              type="button"
              onClick={() => void cancelSequence()}
              data-testid="fla-frame-sequence-cancel"
            >
              取消
            </button>
          ) : null}
          {phase === 'preview-ready' ? (
            <button
              className="fla-frame-sequence-secondary-action"
              type="button"
              onClick={() => void rerenderSequence()}
              data-testid="fla-frame-sequence-rerender"
            >
              重新生成
            </button>
          ) : null}
          {canImport ? (
            <button
              type="button"
              className="fla-render-primary-action fla-frame-sequence-import"
              disabled={!canImport}
              onClick={() => void commitSequence()}
              data-testid="fla-frame-sequence-import"
            >
              导入帧序列
            </button>
          ) : null}
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

function compatibilitySummary(compatibility: FlaRenderTarget['compatibility']): string {
  return compatibility.map((status) => compatibilityNote(status)).join(' ');
}

function compatibilityNote(status: FlaRenderTarget['compatibility'][number]): string {
  switch (status) {
    case 'exact':
      return '当前目标在安全渲染范围内。';
    case 'degraded':
      return '当前可预览，但部分时间轴或图形细节可能不完整。';
    case 'unsupported':
      return '当前目标不在可渲染范围内。';
    case 'unknown':
      return '当前目标兼容性尚未完全确认。';
    case 'not-present':
      return '源文件中未发现此类兼容性信息。';
    default:
      return '暂时无法确定此类内容的兼容性。';
  }
}

function hasFidelityCaveat(compatibility: FlaRenderTarget['compatibility']): boolean {
  return compatibility.some((status) => status === 'degraded' || status === 'unsupported' || status === 'unknown');
}

function sequenceFidelityLabel(compatibility: FlaRenderTarget['compatibility']): string {
  if (compatibility.some((status) => status === 'unsupported' || status === 'unknown')) {
    return '需要注意兼容性';
  }
  if (compatibility.includes('degraded')) return '部分兼容';
  return '当前支持范围内';
}

function sequencePreviewStatus(phase: RenderPhase, hasPreview: boolean): string {
  if (phase === 'rendering') return '正在生成';
  if (phase === 'committing') return '正在导入';
  if (phase === 'committed') return '已导入';
  if (phase === 'error') return '需要重试';
  if (phase === 'cancelled') return '已取消';
  return hasPreview ? '最新序列有效' : '等待生成';
}

function sequenceFooterState(phase: RenderPhase, supported: boolean, sequenceIsCurrent: boolean): string {
  if (!supported) return '不可预览';
  if (phase === 'rendering') return '生成中';
  if (phase === 'committing') return '导入中';
  if (phase === 'committed') return '已导入';
  if (sequenceIsCurrent) return '最新序列有效';
  if (phase === 'cancelled') return '已取消';
  if (phase === 'error') return '需要重试';
  return '待生成';
}
