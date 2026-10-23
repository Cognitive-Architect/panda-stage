import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileArchive, X } from 'lucide-react';
import type {
  AssetImportResponse,
} from '../../../shared/asset-import-api';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { DecorativeIcon } from '../../ui';
import {
  applyAssetImportResponse,
} from './applyAssetImportResponse';
import type { AssetMetadataBatchOutcome } from './assetMetadataQueue';
import {
  createAssetImportFeedback,
  createAssetImportProgressFeedback,
  importedAudioFeedbackDetails,
  type AssetImportFeedback,
} from './assetImportFeedback';
import { useAssetDrop } from './useAssetDrop';

export interface AssetImportPanelProps {
  snapshot: EditorProjectSnapshot | null;
  importRequestToken?: number;
  onImportFla: () => void;
  compact?: boolean;
  showFlaAction?: boolean;
  onImportedAudioAssets?: (
    assetIds: readonly string[],
  ) => Promise<AssetMetadataBatchOutcome>;
}

export function selectImportedAudioAssetIds(
  response: AssetImportResponse,
): string[] {
  if (
    !response.ok ||
    response.status !== 'completed' ||
    !response.projectChanged
  ) {
    return [];
  }
  return response.results.flatMap((result) =>
    result.status === 'imported' && result.asset?.kind === 'audio'
      ? [result.asset.id]
      : [],
  );
}

interface ActiveImport {
  id: number;
  projectRoot: string;
  projectId: string;
}

type VisibleAssetImportFeedback = AssetImportFeedback & { id: number };

export function AssetImportPanel({
  snapshot,
  importRequestToken,
  onImportFla,
  compact = false,
  showFlaAction = true,
  onImportedAudioAssets,
}: AssetImportPanelProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] =
    useState<VisibleAssetImportFeedback | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const requestId = useRef(0);
  const feedbackTimer = useRef<number | null>(null);
  const progressTimer = useRef<number | null>(null);
  const dismissDeadline = useRef(0);
  const remainingDismissMs = useRef(0);
  const pointerInside = useRef(false);
  const focusInside = useRef(false);
  const projectIdentity = useRef(
    `${snapshot?.projectRoot ?? ''}\u0000${snapshot?.project.id ?? ''}`,
  );

  const clearFeedbackTimer = useCallback((): void => {
    if (feedbackTimer.current !== null) {
      window.clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
  }, []);

  const clearProgressTimer = useCallback((): void => {
    if (progressTimer.current !== null) {
      window.clearTimeout(progressTimer.current);
      progressTimer.current = null;
    }
  }, []);

  const clearFeedback = useCallback((): void => {
    clearFeedbackTimer();
    clearProgressTimer();
    pointerInside.current = false;
    focusInside.current = false;
    setFeedback(null);
    setDetailsOpen(false);
  }, [clearFeedbackTimer, clearProgressTimer]);

  const beginImport = useCallback((): ActiveImport | null => {
    const current = editorProjectStore.getSnapshot();
    if (!current) return null;
    requestId.current += 1;
    clearFeedback();
    setBusy(true);
    return {
      id: requestId.current,
      projectRoot: current.projectRoot,
      projectId: current.project.id,
    };
  }, [clearFeedback]);

  const isCurrentImport = useCallback((request: ActiveImport): boolean => {
    const current = editorProjectStore.getSnapshot();
    return Boolean(
      requestId.current === request.id &&
        current?.projectRoot === request.projectRoot &&
        current.project.id === request.projectId,
    );
  }, []);

  const showFeedback = useCallback(
    (
      request: ActiveImport,
      nextFeedback: AssetImportFeedback | null,
    ): void => {
      if (!isCurrentImport(request)) return;
      clearProgressTimer();
      clearFeedbackTimer();
      setDetailsOpen(false);
      setFeedback(
        nextFeedback ? { ...nextFeedback, id: request.id } : null,
      );
    },
    [clearFeedbackTimer, clearProgressTimer, isCurrentImport],
  );

  const showError = useCallback(
    (request: ActiveImport, message: string): void => {
      showFeedback(request, {
        kind: 'error',
        summary: message,
        details: [{ sourceName: '导入操作', message }],
        dismissAfterMs: null,
      });
    },
    [showFeedback],
  );

  const pauseDismissTimer = useCallback((): void => {
    if (feedbackTimer.current === null) return;
    window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = null;
    remainingDismissMs.current = Math.max(
      0,
      dismissDeadline.current - Date.now(),
    );
  }, []);

  const resumeDismissTimer = useCallback((): void => {
    if (
      pointerInside.current ||
      focusInside.current ||
      !feedback ||
      feedback.dismissAfterMs === null ||
      feedbackTimer.current !== null
    ) {
      return;
    }
    const id = feedback.id;
    const delay = remainingDismissMs.current;
    dismissDeadline.current = Date.now() + delay;
    feedbackTimer.current = window.setTimeout(() => {
      feedbackTimer.current = null;
      setFeedback((current) =>
        current?.id === id ? null : current,
      );
      setDetailsOpen(false);
    }, delay);
  }, [feedback]);

  useEffect(() => {
    if (!feedback || feedback.dismissAfterMs === null) return;
    remainingDismissMs.current = feedback.dismissAfterMs;
    if (!pointerInside.current && !focusInside.current) {
      dismissDeadline.current = Date.now() + remainingDismissMs.current;
      const id = feedback.id;
      feedbackTimer.current = window.setTimeout(() => {
        feedbackTimer.current = null;
        setFeedback((current) =>
          current?.id === id ? null : current,
        );
        setDetailsOpen(false);
      }, remainingDismissMs.current);
    }
    return clearFeedbackTimer;
  }, [clearFeedbackTimer, feedback?.dismissAfterMs, feedback?.id]);

  useEffect(() => {
    const nextIdentity =
      `${snapshot?.projectRoot ?? ''}\u0000${snapshot?.project.id ?? ''}`;
    if (projectIdentity.current === nextIdentity) return;
    projectIdentity.current = nextIdentity;
    requestId.current += 1;
    setBusy(false);
    pointerInside.current = false;
    focusInside.current = false;
    clearFeedback();
  }, [clearFeedback, snapshot?.project.id, snapshot?.projectRoot]);

  useEffect(() => {
    return () => {
      requestId.current += 1;
      clearFeedbackTimer();
      clearProgressTimer();
    };
  }, [clearFeedbackTimer, clearProgressTimer]);

  const applyResponse = useCallback(
    async (
      response: AssetImportResponse,
      request: ActiveImport,
    ): Promise<void> => {
      clearProgressTimer();
      if (!isCurrentImport(request)) return;
      const outcome = applyAssetImportResponse(
        response,
        editorProjectStore,
      );
      if (response.ok && response.status === 'cancelled') {
        showFeedback(request, null);
        return;
      }

      const importedAudioIds = selectImportedAudioAssetIds(response);
      let audioFailures: ReturnType<typeof importedAudioFeedbackDetails> = [];
      if (importedAudioIds.length > 0 && onImportedAudioAssets) {
        progressTimer.current = window.setTimeout(() => {
          progressTimer.current = null;
          showFeedback(request, {
            ...createAssetImportProgressFeedback(),
            summary: '正在分析导入音频的时长…',
          });
        }, 350);
        const metadata = await onImportedAudioAssets(importedAudioIds);
        clearProgressTimer();
        if (!isCurrentImport(request)) return;
        if (metadata.stopped) {
          showFeedback(request, null);
          return;
        }
        audioFailures = importedAudioFeedbackDetails(
          response.ok ? response.results : [],
          metadata.failures,
        );
      }
      showFeedback(
        request,
        createAssetImportFeedback(response, outcome.status, audioFailures),
      );
    },
    [
      clearProgressTimer,
      isCurrentImport,
      onImportedAudioAssets,
      showFeedback,
    ],
  );

  const chooseFiles = useCallback(async (): Promise<void> => {
    const request = beginImport();
    if (!request) return;
    try {
      const current = editorProjectStore.getSnapshot();
      if (!current || !isCurrentImport(request)) return;
      await applyResponse(
        await window.pandaStage.assets.choose({
          projectRoot: current.projectRoot,
          project: current.project,
          baseRevision: current.revision,
        }),
        request,
      );
    } catch (error) {
      if (isCurrentImport(request)) {
        showError(
          request,
          error instanceof Error ? error.message : '素材导入失败。',
        );
      }
    } finally {
      if (requestId.current === request.id) setBusy(false);
    }
  }, [applyResponse, beginImport, isCurrentImport, showError]);

  const lastImportRequest = useRef(importRequestToken ?? 0);
  useEffect(() => {
    if (
      importRequestToken === undefined ||
      importRequestToken === lastImportRequest.current
    ) {
      return;
    }
    lastImportRequest.current = importRequestToken;
    void chooseFiles();
  }, [chooseFiles, importRequestToken]);

  const importDroppedFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      const request = beginImport();
      if (!request) return;
      progressTimer.current = window.setTimeout(() => {
        progressTimer.current = null;
        showFeedback(request, createAssetImportProgressFeedback());
      }, 400);
      try {
        const current = editorProjectStore.getSnapshot();
        if (!current || !isCurrentImport(request)) return;
        await applyResponse(
          await window.pandaStage.assets.importDropped(
            {
              projectRoot: current.projectRoot,
              project: current.project,
              baseRevision: current.revision,
            },
            files,
          ),
          request,
        );
      } catch (error) {
        if (isCurrentImport(request)) {
          showError(
            request,
            error instanceof Error ? error.message : '拖入素材失败。',
          );
        }
      } finally {
        clearProgressTimer();
        if (requestId.current === request.id) setBusy(false);
      }
    },
    [
      applyResponse,
      beginImport,
      clearProgressTimer,
      isCurrentImport,
      showError,
      showFeedback,
    ],
  );
  const dropHandlers = useAssetDrop(
    busy || snapshot === null,
    importDroppedFiles,
  );

  const feedbackPortal =
    feedback && typeof document !== 'undefined'
      ? createPortal(
          <aside
            aria-live={
              feedback.kind === 'warning' || feedback.kind === 'error'
                ? 'assertive'
                : 'polite'
            }
            className={`asset-import-feedback asset-import-feedback-${feedback.kind}${compact ? ' asset-import-feedback-compact' : ''}`}
            data-testid="asset-import-feedback"
            data-feedback-kind={feedback.kind}
            onBlurCapture={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && event.currentTarget.contains(next)) return;
              focusInside.current = false;
              resumeDismissTimer();
            }}
            onFocusCapture={() => {
              focusInside.current = true;
              pauseDismissTimer();
            }}
            onPointerEnter={() => {
              pointerInside.current = true;
              pauseDismissTimer();
            }}
            onPointerLeave={() => {
              pointerInside.current = false;
              resumeDismissTimer();
            }}
            role={
              feedback.kind === 'warning' || feedback.kind === 'error'
                ? 'alert'
                : 'status'
            }
          >
            <p className="asset-import-feedback-summary">{feedback.summary}</p>
            <div className="asset-import-feedback-actions">
              {feedback.details.length > 0 ? (
                <button
                  aria-controls="asset-import-feedback-details"
                  aria-expanded={detailsOpen}
                  className="asset-import-feedback-details-toggle"
                  onClick={() => setDetailsOpen((open) => !open)}
                  type="button"
                >
                  {detailsOpen ? '收起详情' : '查看详情'}
                </button>
              ) : null}
              <button
                aria-label="关闭导入提示"
                className="asset-import-feedback-close"
                data-testid="asset-import-feedback-close"
                onClick={clearFeedback}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {detailsOpen && feedback.details.length > 0 ? (
              <div
                className="asset-import-feedback-details"
                data-testid="asset-import-feedback-details"
                id="asset-import-feedback-details"
              >
                <ul>
                  {feedback.details.map((detail, index) => (
                    <li key={`${detail.sourceName}:${index}`}>
                      <strong>{detail.sourceName}</strong>
                      <span>{detail.message}</span>
                    </li>
                  ))}
                </ul>
                <p>检查文件后可重新导入；音频时长问题可在素材详情中重试。</p>
              </div>
            ) : null}
          </aside>,
          document.body,
        )
      : null;

  return (
    <>
      <section
        className={[
          'asset-import-panel',
          compact ? 'asset-import-panel-compact' : '',
        ].filter(Boolean).join(' ')}
        aria-labelledby="asset-import-heading"
        {...dropHandlers}
      >
        <div className="asset-import-heading">
          <div>
            <p className="eyebrow">安全素材导入</p>
            <h2 id="asset-import-heading">导入项目素材</h2>
          </div>
          <span className="asset-import-header-note">使用工作区顶部“导入素材”</span>
        </div>
        {showFlaAction ? (
          <div className="asset-import-actions">
            <button
              className="asset-import-fla-button"
              data-testid="asset-import-fla"
              disabled={snapshot === null || busy}
              onClick={onImportFla}
              type="button"
            >
              <DecorativeIcon icon={FileArchive} size={18} />
              <span>导入 FLA</span>
            </button>
            <span>打开 FLA 后可先预览并选择需要的素材，确认导入前不会修改项目。</span>
          </div>
        ) : null}
        {!snapshot ? (
          <p className="asset-import-drop">请先打开一个 .pandastage 项目。</p>
        ) : null}
      </section>
      {feedbackPortal}
    </>
  );
}
