/**
 * V2-R2 Frame Sequence — renderer review surface (H.2).
 *
 * Shown inside the existing FLA compatibility review (zero-raster branch),
 * alongside the R1 static snapshot review. The user picks one renderable
 * target and an inclusive frame range, renders the bounded sequence, sees
 * live progress, a real Cancel, an ordered bounded preview, Re-render, and
 * a commit/import action wired to the R2 preload API.
 *
 * Hard boundaries (R2-A/B/C/D/E + Corrective A/B/C/D):
 *  - previewing / importing never mutates the Project until explicit commit;
 *  - over-cap / reversed / out-of-range ranges are rejected before any IPC;
 *  - the per-frame PNG bytes stay Main-owned; the Renderer only holds
 *    transient object URLs for the current sequence and revokes them on
 *    unmount (R2-E — no Renderer PNG accumulation);
 *  - a stale / late completion cannot overwrite the current request or
 *    become commit-eligible (R2-D / Corrective C);
 *  - Re-render invalidates the prior commit candidate (Corrective C);
 *  - closing / unmounting cancels or invalidates live sequence work
 *    (Corrective C);
 *  - the R1 single-frame path is preserved untouched.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  FlaRenderableTargetCatalogEntry,
} from '../../shared/fla-static-snapshot-api';
import type {
  FlaFrameSequenceCommitResponse,
  FlaFrameSequenceResponse,
  FlaFrameSequenceSuccess,
} from '../../shared/fla-frame-sequence-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { flaStaticSnapshotClient } from './fla-static-snapshot-render';
import { flaFrameSequenceClient } from './fla-frame-sequence-render';
import {
  buildRange,
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
  onImported,
  onClose,
}: FlaFrameSequenceReviewProps): React.JSX.Element {
  const [phase, setPhase] = useState<RenderPhase>('loading');
  const [entries, setEntries] = useState<FlaRenderableTargetCatalogEntry[]>([]);
  const [summary, setSummary] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [startFrameIndex, setStartFrameIndex] = useState(0);
  const [endFrameIndex, setEndFrameIndex] = useState(0);
  const [completedFrameCount, setCompletedFrameCount] = useState(0);
  const [success, setSuccess] = useState<FlaFrameSequenceSuccess | null>(null);
  const [previewUrls, setPreviewUrls] = useState<ReadonlyArray<string>>([]);
  const [commitResponse, setCommitResponse] = useState<FlaFrameSequenceCommitResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // R2-D: the latest completed sequence the UI has accepted. Only this one
  // is commit-eligible; an older / stale result cannot become current.
  const activeRequestIdRef = useRef<string | null>(null);
  const acceptedRequestIdRef = useRef<string | null>(null);
  const latestSequenceRef = useRef<FlaFrameSequenceSuccess | null>(null);
  // Problem B (Corrective #296): active progress subscription handle.
  // Subscribed only while a request is in flight; removed on
  // cancel / re-render / completion / unmount. No raw Electron event
  // API is touched by the component — only the typed client.
  const progressUnsubRef = useRef<(() => void) | null>(null);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.target.renderTargetId === selectedTargetId) ?? null,
    [entries, selectedTargetId],
  );
  const targetFrameCount = selectedEntry?.target.frameCount ?? 0;

  const validation = useMemo(
    () => validateRange(startFrameIndex, endFrameIndex, targetFrameCount),
    [startFrameIndex, endFrameIndex, targetFrameCount],
  );

  // Revoke object URLs on unmount / sequence change.
  useEffect(() => {
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  // Load the catalog once (reused from R1 surface).
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
        setSummary(response.summary);
        const firstSupported = response.entries.find((entry) => entry.previewSupported);
        if (firstSupported) {
          setSelectedTargetId(firstSupported.target.renderTargetId);
          setStartFrameIndex(0);
          setEndFrameIndex(Math.max(0, firstSupported.target.frameCount - 1));
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

  // Changing target invalidates any prior sequence state (Corrective C).
  useEffect(() => {
    const reset = intentChangeReset();
    activeRequestIdRef.current = null;
    acceptedRequestIdRef.current = null;
    latestSequenceRef.current = null;
    setSuccess(reset.success);
    setCompletedFrameCount(reset.completedFrameCount);
    setPreviewUrls((current) => {
      for (const url of current) URL.revokeObjectURL(url);
      return [];
    });
    setCommitResponse(reset.commitResponse);
    setPhase((current) => (current === 'rendering' || current === 'committing' ? reset.phase : current));
    void flaFrameSequenceClient.cancel({ format: 'fla-frame-sequence-cancel', version: 1, sessionId });
  }, [selectedTargetId, sessionId]);

  // Problem A (Corrective #296): changing the selected render intent
  // (start/end frame) MUST immediately invalidate the prior accepted
  // sequence. The UI must never commit an old rendered range while
  // displaying a different range. We force the prior sequence into a
  // non-commit-eligible state and require an explicit re-render.
  useEffect(() => {
    // Skip until a render has produced an accepted sequence or a stale
    // candidate exists (the initial mount / catalog load path is
    // handled by the target-change effect above).
    if (!acceptedRequestIdRef.current && !success) return;
    const reset = intentChangeReset();
    activeRequestIdRef.current = null;
    acceptedRequestIdRef.current = null;
    latestSequenceRef.current = null;
    setSuccess(reset.success);
    setCompletedFrameCount(reset.completedFrameCount);
    setPreviewUrls((current) => {
      for (const url of current) URL.revokeObjectURL(url);
      return [];
    });
    setCommitResponse(reset.commitResponse);
    setPhase((current) => (current === 'rendering' || current === 'committing' ? reset.phase : current));
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
    // Bounded transient display only — the PNG bytes are not retained after
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
    // Problem B: subscribe to live progress for THIS request only.
    // Stale-request progress is ignored; the subscription is removed
    // on completion / cancel / re-render / unmount.
    progressUnsubRef.current?.();
    progressUnsubRef.current = flaFrameSequenceClient.progressSubscribe((progress) => {
      // Ignore progress for any request other than the active one.
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
      // Problem B: the request has settled — stop listening.
      progressUnsubRef.current?.();
      progressUnsubRef.current = null;
      if (response.ok) {
        const urls = buildPreviewUrls(response);
        setSuccess(response);
        setPreviewUrls(urls);
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
      // Problem B: settle the subscription on transport error.
      progressUnsubRef.current?.();
      progressUnsubRef.current = null;
      setErrorMessage(error instanceof Error ? error.message : '序列渲染失败。');
      setPhase('error');
    }
  };

  const cancelSequence = async (): Promise<void> => {
    if (phase !== 'rendering') return;
    // Problem B: stop listening before flipping phase.
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
    try {
      await flaFrameSequenceClient.cancel({ format: 'fla-frame-sequence-cancel', version: 1, sessionId });
    } catch {
      /* ignore — UI must not get stuck */
    }
    activeRequestIdRef.current = null;
    setPhase('selecting');
  };

  const rerenderSequence = async (): Promise<void> => {
    // Corrective C: re-render invalidates the prior commit candidate.
    // Problem B: drop the old progress subscription before starting new.
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
    const reset = rerenderReset();
    setPhase(reset.phase);
    acceptedRequestIdRef.current = null;
    latestSequenceRef.current = null;
    setSuccess(null);
    setPreviewUrls((current) => {
      for (const url of current) URL.revokeObjectURL(url);
      return [];
    });
    setCommitResponse(null);
    await renderSequence();
  };

  const commitSequence = async (): Promise<void> => {
    if (!success || !snapshot || phase !== 'preview-ready') return;
    if (!isCommitEligible(success, acceptedRequestIdRef.current === success.requestId)) return;
    const range = buildRange(success.renderTargetId, success.items[0]!.frameIndex, success.items[success.items.length - 1]!.frameIndex);
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
      <div className="fla-frame-sequence-review" data-testid="fla-frame-sequence-review" role="note">
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

  const supported = selectedEntry.previewSupported;
  const canRender = supported && validation.valid && phase === 'selecting';

  return (
    <div className="fla-frame-sequence-review" data-testid="fla-frame-sequence-review">
      <p className="fla-frame-sequence-intro" data-testid="fla-frame-sequence-summary">
        {summary}
      </p>

      <ul className="fla-frame-sequence-targets" data-testid="fla-frame-sequence-targets">
        {entries.map((entry) => (
          <li key={entry.target.renderTargetId}>
            <label>
              <input
                type="radio"
                name="fla-frame-sequence-target"
                checked={entry.target.renderTargetId === selectedTargetId}
                disabled={!entry.previewSupported || phase === 'rendering' || phase === 'committing'}
                onChange={() => setSelectedTargetId(entry.target.renderTargetId)}
                data-testid={`fla-frame-sequence-target-${entry.target.renderTargetId}`}
              />
              <span>{entry.target.userLabel}</span>
              {!entry.previewSupported ? (
                <span className="fla-frame-sequence-unsupported">（暂不可渲染：{entry.unsupportedReason}）</span>
              ) : null}
            </label>
          </li>
        ))}
      </ul>

      {supported ? (
        <fieldset className="fla-frame-sequence-range" data-testid="fla-frame-sequence-range" disabled={phase === 'rendering' || phase === 'committing'}>
          <legend>帧序列范围（含首尾）</legend>
          <div>
            <label>
              起始帧
              <input
                type="number"
                min={0}
                max={Math.max(0, targetFrameCount - 1)}
                value={startFrameIndex}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) setStartFrameIndex(Math.min(targetFrameCount - 1, Math.max(0, Math.trunc(value))));
                }}
                data-testid="fla-frame-sequence-start"
              />
            </label>
            <label>
              结束帧
              <input
                type="number"
                min={0}
                max={Math.max(0, targetFrameCount - 1)}
                value={endFrameIndex}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) setEndFrameIndex(Math.min(targetFrameCount - 1, Math.max(0, Math.trunc(value))));
                }}
                data-testid="fla-frame-sequence-end"
              />
            </label>
          </div>
          <p data-testid="fla-frame-sequence-count">
            将渲染 {validation.valid ? validation.frameCount : 0} 帧（上限 {MAX_SEQUENCE_FRAMES} 帧）
          </p>
          {!validation.valid && validation.message ? (
            <p role="alert" data-testid="fla-frame-sequence-range-error">{validation.message}</p>
          ) : null}
        </fieldset>
      ) : null}

      {phase === 'rendering' ? (
        <p data-testid="fla-frame-sequence-progress">
          正在渲染序列… {completedFrameCount} / {validation.valid ? validation.frameCount : 0}
        </p>
      ) : null}

      <div className="fla-frame-sequence-actions" data-testid="fla-frame-sequence-actions">
        <button
          type="button"
          disabled={!canRender}
          onClick={() => void renderSequence()}
          data-testid="fla-frame-sequence-render"
        >
          生成帧序列
        </button>
        {phase === 'rendering' ? (
          <button type="button" onClick={() => void cancelSequence()} data-testid="fla-frame-sequence-cancel">
            取消
          </button>
        ) : null}
        {phase === 'preview-ready' ? (
          <button type="button" onClick={() => void rerenderSequence()} data-testid="fla-frame-sequence-rerender">
            重新生成
          </button>
        ) : null}
        {phase === 'preview-ready' && success && isCommitEligible(success, acceptedRequestIdRef.current === success.requestId) ? (
          <button
            type="button"
            className="fla-frame-sequence-import"
            disabled={phase !== 'preview-ready'}
            onClick={() => void commitSequence()}
            data-testid="fla-frame-sequence-import"
          >
            导入帧序列
          </button>
        ) : null}
      </div>

      {previewUrls.length > 0 ? (
        <div className="fla-frame-sequence-preview-area" data-testid="fla-frame-sequence-preview-area">
          {previewUrls.map((url, index) => (
            <img
              key={index}
              src={url}
              alt={`帧序列预览 ${index + 1}`}
              data-testid={`fla-frame-sequence-preview-${index}`}
              style={{ maxWidth: '100%' }}
            />
          ))}
        </div>
      ) : null}

      {errorMessage ? (
        <p role="alert" data-testid="fla-frame-sequence-error">{errorMessage}</p>
      ) : null}

      {phase === 'committed' && commitResponse?.ok && commitResponse.status === 'completed' ? (
        <p data-testid="fla-frame-sequence-committed">
          已导入 {commitResponse.result.summary.importedCount} 帧为普通图片素材。
        </p>
      ) : null}

      <button type="button" disabled={phase === 'rendering' || phase === 'committing'} onClick={() => void close()} data-testid="fla-frame-sequence-close">
        返回
      </button>
    </div>
  );
}
