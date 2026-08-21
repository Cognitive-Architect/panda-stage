/**
 * V2-R1 Static Snapshot — renderable-content review (R1-C + R1-D + R1-F).
 *
 * Shown inside the existing FLA compatibility review when the file has
 * zero directly-importable bitmap media but Panda can still render one
 * frame of its vector content. The user picks one renderable target and
 * one frame, previews it, sees an honest fidelity note, and only then
 * imports that one frame as an ordinary Panda ImageAsset.
 *
 * Hard boundaries (R1-D):
 *  - previewing never mutates the Project, assets, revision, or files;
 *  - switching target/frame invalidates a stale preview;
 *  - the import button is disabled until a valid preview exists.
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

interface FlaStaticSnapshotReviewProps {
  sessionId: string;
  source: { basename: string; sha256: string };
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
  degraded: '当前可预览，但时间轴动画、渐变方向、描边等细节可能不完整。',
  unsupported: '该内容暂不在当前单帧渲染范围内。',
  unknown: '该内容的兼容性暂未完全确认。',
};

export function FlaStaticSnapshotReview({
  sessionId,
  source,
  snapshot,
  onImported,
  onClose,
}: FlaStaticSnapshotReviewProps): React.JSX.Element {
  const [phase, setPhase] = useState<SnapshotPhase>('loading');
  const [entries, setEntries] = useState<FlaRenderableTargetCatalogEntry[]>([]);
  const [summary, setSummary] = useState('');
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

  // Load the catalog once.
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
          setSelectedFrameIndex(0);
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

  // Revoke preview object URL on change/unmount.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // A target/frame change invalidates any prior preview (R1-D stale guard).
  const selecting = selectedEntry?.target;
  useEffect(() => {
    setPreview(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    previewRequestIdRef.current = null;
    if (phase === 'preview-ready' || phase === 'committing') setPhase('selecting');
  }, [selectedTargetId, selectedFrameIndex]);

  if (!selectedEntry || !selecting) {
    return (
      <div className="fla-snapshot-review" data-testid="fla-snapshot-review" role="note">
        {phase === 'loading' ? (
          <p data-testid="fla-snapshot-loading">正在分析可渲染的图形…</p>
        ) : phase === 'error' ? (
          <p role="alert" data-testid="fla-snapshot-error">{errorMessage}</p>
        ) : (
          <p data-testid="fla-snapshot-empty">这个 FLA 没有可渲染的矢量内容。</p>
        )}
      </div>
    );
  }

  const supported = selectedEntry.previewSupported;
  const frameCount = selecting.frameCount;

  const previewNow = async (): Promise<void> => {
    if (!supported || !snapshot) return;
    setPhase('previewing');
    setErrorMessage('');
    const requestId = crypto.randomUUID();
    previewRequestIdRef.current = requestId;
    const target: FlaRenderTarget = {
      ...selecting,
      selectedFrameIndex: frameCount > 0 ? selectedFrameIndex : undefined,
    };
    try {
      const response = await flaStaticSnapshotClient.preview({
        format: 'fla-static-snapshot-preview',
        version: 1,
        requestId,
        sessionId,
        target,
      });
      if (previewRequestIdRef.current !== requestId) return; // superseded
      setPreview(response);
      if (response.ok && response.bytes) {
        const url = URL.createObjectURL(
          new Blob([response.bytes.buffer as ArrayBuffer], { type: 'image/png' }),
        );
        setPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return url;
        });
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
    if (!preview || !preview.ok || !snapshot || phase !== 'preview-ready') return;
    setPhase('committing');
    setErrorMessage('');
    const target: FlaRenderTarget = {
      ...selecting,
      selectedFrameIndex: frameCount > 0 ? selectedFrameIndex : undefined,
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
    if (previewRequestIdRef.current) {
      void flaStaticSnapshotClient.cancel({ format: 'fla-static-snapshot-cancel', version: 1, requestId: previewRequestIdRef.current, sessionId });
    }
    onClose();
  };

  const compatibilityNote = selecting.compatibility
    .map((status) => COMPATIBILITY_NOTE[status])
    .filter(Boolean)
    .join(' ');

  return (
    <div className="fla-snapshot-review" data-testid="fla-snapshot-review">
      <p className="fla-snapshot-intro" data-testid="fla-snapshot-summary">
        {summary}
      </p>

      <ul className="fla-snapshot-targets" data-testid="fla-snapshot-targets">
        {entries.map((entry) => (
          <li key={entry.target.renderTargetId}>
            <label>
              <input
                type="radio"
                name="fla-snapshot-target"
                checked={entry.target.renderTargetId === selectedTargetId}
                disabled={!entry.previewSupported || phase === 'committing' || phase === 'committed'}
                onChange={() => setSelectedTargetId(entry.target.renderTargetId)}
                data-testid={`fla-snapshot-target-${entry.target.renderTargetId}`}
              />
              <span>{entry.target.userLabel}</span>
              {!entry.previewSupported ? (
                <span className="fla-snapshot-unsupported">（暂不可预览：{entry.unsupportedReason}）</span>
              ) : null}
            </label>
          </li>
        ))}
      </ul>

      {supported && frameCount > 1 ? (
        <div className="fla-snapshot-frame" data-testid="fla-snapshot-frame">
          <span>帧</span>
          <button
            type="button"
            disabled={selectedFrameIndex <= 0 || phase === 'committing'}
            onClick={() => setSelectedFrameIndex((i) => Math.max(0, i - 1))}
            data-testid="fla-snapshot-frame-prev"
          >
            上一帧
          </button>
          <input
            type="number"
            min={0}
            max={frameCount - 1}
            value={selectedFrameIndex}
            disabled={phase === 'committing'}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                setSelectedFrameIndex(Math.min(frameCount - 1, Math.max(0, value)));
              }
            }}
            data-testid="fla-snapshot-frame-input"
          />
          <span>/ {frameCount - 1}</span>
          <button
            type="button"
            disabled={selectedFrameIndex >= frameCount - 1 || phase === 'committing'}
            onClick={() => setSelectedFrameIndex((i) => Math.min(frameCount - 1, i + 1))}
            data-testid="fla-snapshot-frame-next"
          >
            下一帧
          </button>
        </div>
      ) : null}

      <button
        type="button"
        disabled={!supported || phase === 'previewing' || phase === 'committing' || phase === 'committed'}
        onClick={() => void previewNow()}
        data-testid="fla-snapshot-preview"
      >
        {phase === 'previewing' ? '正在预览…' : '预览当前帧'}
      </button>

      {previewUrl ? (
        <div className="fla-snapshot-preview-area" data-testid="fla-snapshot-preview-area">
          <img
            src={previewUrl}
            alt="FLA 单帧预览"
            data-testid="fla-snapshot-preview-image"
            style={{ backgroundImage: 'linear-gradient(45deg,#ccc 25%,transparent 25%)', maxWidth: '100%' }}
          />
        </div>
      ) : null}

      {compatibilityNote ? (
        <p className="fla-snapshot-fidelity" role="note" data-testid="fla-snapshot-fidelity">
          {compatibilityNote}
        </p>
      ) : null}

      {phase === 'preview-ready' ? (
        <button
          type="button"
          className="fla-snapshot-import"
          disabled={phase !== 'preview-ready'}
          onClick={() => void importFrame()}
          data-testid="fla-snapshot-import"
        >
          导入当前帧
        </button>
      ) : null}

      {errorMessage ? (
        <p role="alert" data-testid="fla-snapshot-error">{errorMessage}</p>
      ) : null}

      {phase === 'committed' && commitResponse?.ok && commitResponse.status === 'completed' ? (
        <p data-testid="fla-snapshot-committed">
          已导入为普通图片素材：{commitResponse.result.targetFileName}
        </p>
      ) : null}

      <button type="button" disabled={phase === 'committing'} onClick={() => void close()} data-testid="fla-snapshot-close">
        返回
      </button>
    </div>
  );
}
