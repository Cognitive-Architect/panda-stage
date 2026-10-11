import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  FlaStaticSnapshotCommitError,
  FlaRenderableTargetCatalogEntry,
  FlaStaticSnapshotCommitResponse,
} from '../../shared/fla-static-snapshot-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { boundedUnsupportedReason, FlaStageF2UnavailableDetails } from './FlaStageF';
import { FlaStageGRecovery, type FlaStageGTerminalState } from './FlaStageGTerminal';
import { flaStaticSnapshotClient } from './fla-static-snapshot-render';
import {
  flaStaticSnapshotCandidateKey,
  flaStaticSnapshotCandidateKindLabel,
  flaStaticSnapshotCandidateLabel,
  groupFlaStaticSnapshotCandidates,
  type FlaStaticSnapshotCandidatePreview,
  type FlaStaticSnapshotCandidatePreviews,
} from './fla-static-snapshot-candidates';

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
  onCommitStateChange?: (busy: boolean) => void;
  onTerminalStateChange?: (state: FlaStageGTerminalState) => void;
}

type SnapshotPhase = 'loading' | 'scanning' | 'ready' | 'committing' | 'completed' | 'partial' | 'error';
type ImportItemStatus = 'imported' | 'duplicate' | 'failed' | 'not-attempted';

interface SnapshotImportItem {
  key: string;
  label: string;
  status: ImportItemStatus;
  assetId?: string;
  assetFileName?: string;
  message?: string;
}

interface SnapshotImportReceipt {
  selectedCount: number;
  items: SnapshotImportItem[];
  partial: boolean;
  recovery?: Pick<FlaStaticSnapshotCommitError, 'code' | 'message' | 'residualPaths'>;
}

export function FlaStaticSnapshotReview({
  sessionId,
  source,
  stage,
  snapshot,
  onImported,
  onClose,
  onCommitStateChange,
  onTerminalStateChange,
}: FlaStaticSnapshotReviewProps): React.JSX.Element {
  const [phase, setPhase] = useState<SnapshotPhase>('loading');
  const [entries, setEntries] = useState<FlaRenderableTargetCatalogEntry[]>([]);
  const [catalogSummary, setCatalogSummary] = useState('');
  const [omittedCandidateCount, setOmittedCandidateCount] = useState(0);
  const [previews, setPreviews] = useState<FlaStaticSnapshotCandidatePreviews>({});
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [focusedCandidateKey, setFocusedCandidateKey] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [scanProgress, setScanProgress] = useState(0);
  const [importProgress, setImportProgress] = useState(0);
  const [receipt, setReceipt] = useState<SnapshotImportReceipt | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const previewUrlsRef = useRef(new Set<string>());

  const entryByKey = useMemo(
    () => new Map(entries.map((entry) => [flaStaticSnapshotCandidateKey(entry), entry])),
    [entries],
  );
  const visibleGroups = useMemo(
    () => groupFlaStaticSnapshotCandidates(entries, previews, candidateSearch),
    [candidateSearch, entries, previews],
  );
  const focusedEntry = focusedCandidateKey ? entryByKey.get(focusedCandidateKey) ?? null : null;
  const supportedEntries = useMemo(
    () => entries.filter((entry) => previews[flaStaticSnapshotCandidateKey(entry)]?.status === 'supported'),
    [entries, previews],
  );
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedCandidateKeys.has(flaStaticSnapshotCandidateKey(entry))),
    [entries, selectedCandidateKeys],
  );
  const blankCount = entries.filter((entry) => entry.isBlank).length;
  const unsupportedCount = entries.filter((entry) => {
    const result = previews[flaStaticSnapshotCandidateKey(entry)];
    return !entry.isBlank && (result?.status === 'unsupported' || (!result && !entry.previewSupported));
  }).length;
  const checkedCatalogSummary = entries.length === 0
    ? catalogSummary
    : phase === 'scanning'
      ? `正在检查候选预览 ${scanProgress} / ${entries.length}；目前 ${supportedEntries.length} 项可导入、${unsupportedCount} 项暂不可导入、${blankCount} 项为空白。`
      : `检查完成：${supportedEntries.length} 项可导入、${unsupportedCount} 项暂不可导入、${blankCount} 项为空白。`;

  useEffect(() => {
    onCommitStateChange?.(false);
    onTerminalStateChange?.('active');
    let disposed = false;
    let activeRequestId: string | null = null;

    const setCandidatePreview = (key: string, preview: FlaStaticSnapshotCandidatePreview): void => {
      setPreviews((current) => ({ ...current, [key]: preview }));
    };

    void (async () => {
      try {
        const response = await flaStaticSnapshotClient.catalog(sessionId, { includeAuthoredStates: true });
        if (disposed) return;
        if (!response.ok) {
          setErrorMessage(response.error.message);
          setPhase('error');
          return;
        }

        setEntries(response.entries);
        setCatalogSummary(response.summary);
        setOmittedCandidateCount(response.omittedCandidateCount);
        const firstReviewable = response.entries.find((entry) => entry.previewSupported && !entry.isBlank);
        const firstEntry = firstReviewable ?? response.entries[0];
        setFocusedCandidateKey(firstEntry ? flaStaticSnapshotCandidateKey(firstEntry) : null);
        setPhase('scanning');

        for (let index = 0; index < response.entries.length; index += 1) {
          if (disposed) return;
          const entry = response.entries[index];
          if (!entry) continue;
          const key = flaStaticSnapshotCandidateKey(entry);
          if (entry.isBlank) {
            setCandidatePreview(key, { status: 'blank' });
            setScanProgress(index + 1);
            continue;
          }
          if (!entry.previewSupported) {
            setCandidatePreview(key, {
              status: 'unsupported',
              reason: entry.unsupportedReason ?? '当前无法安全生成预览。',
            });
            setScanProgress(index + 1);
            continue;
          }

          const requestId = crypto.randomUUID();
          activeRequestId = requestId;
          try {
            const preview = await flaStaticSnapshotClient.preview({
              format: 'fla-static-snapshot-preview',
              version: 1,
              requestId,
              sessionId,
              target: {
                ...entry.target,
                selectedFrameIndex: entry.target.selectedFrameIndex ?? 0,
              },
            });
            if (disposed) return;
            if (!preview.ok || !preview.bytes) {
              setCandidatePreview(key, {
                status: 'unsupported',
                reason: preview.ok ? '预览没有返回图像。' : preview.error.message,
              });
            } else {
              try {
                const previewUrl = await createCandidateThumbnailUrl(preview.bytes);
                if (disposed) {
                  URL.revokeObjectURL(previewUrl);
                  return;
                }
                previewUrlsRef.current.add(previewUrl);
                setCandidatePreview(key, {
                  status: 'supported',
                  previewUrl,
                  sha256: preview.sha256,
                });
              } catch (error) {
                setCandidatePreview(key, {
                  status: 'unsupported',
                  reason: error instanceof Error ? error.message : '无法显示预览图像。',
                });
              }
            }
          } catch (error) {
            if (!disposed) {
              setCandidatePreview(key, {
                status: 'unsupported',
                reason: error instanceof Error ? error.message : '预览失败。',
              });
            }
          } finally {
            await flaStaticSnapshotClient.cancel({
              format: 'fla-static-snapshot-cancel',
              version: 1,
              requestId,
            });
            if (activeRequestId === requestId) activeRequestId = null;
          }
          if (!disposed) setScanProgress(index + 1);
        }
        if (!disposed) setPhase('ready');
      } catch (error) {
        if (disposed) return;
        setErrorMessage(error instanceof Error ? error.message : '无法检查 FLA 候选。');
        setPhase('error');
      }
    })();

    return () => {
      disposed = true;
      onCommitStateChange?.(false);
      onTerminalStateChange?.('active');
      if (activeRequestId) {
        void flaStaticSnapshotClient.cancel({
          format: 'fla-static-snapshot-cancel',
          version: 1,
          requestId: activeRequestId,
        });
      }
      void flaStaticSnapshotClient.cancel({
        format: 'fla-static-snapshot-cancel',
        version: 1,
        sessionId,
      });
      for (const previewUrl of previewUrlsRef.current) URL.revokeObjectURL(previewUrl);
      previewUrlsRef.current.clear();
    };
  }, [onCommitStateChange, onTerminalStateChange, sessionId]);

  const close = (): void => {
    if (phase === 'committing') return;
    void flaStaticSnapshotClient.cancel({
      format: 'fla-static-snapshot-cancel',
      version: 1,
      sessionId,
    });
    onClose();
  };

  const toggleCandidate = (entry: FlaRenderableTargetCatalogEntry): void => {
    if (phase !== 'ready') return;
    const key = flaStaticSnapshotCandidateKey(entry);
    if (previews[key]?.status !== 'supported') return;
    setSelectedCandidateKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setFocusedCandidateKey(key);
  };

  const selectVisibleSupported = (): void => {
    if (phase !== 'ready') return;
    setSelectedCandidateKeys((current) => {
      const next = new Set(current);
      for (const group of visibleGroups) {
        for (const entry of group.entries) {
          const key = flaStaticSnapshotCandidateKey(entry);
          if (previews[key]?.status === 'supported') next.add(key);
        }
      }
      return next;
    });
  };

  const clearSelection = (): void => setSelectedCandidateKeys(new Set());

  const importSelected = async (): Promise<void> => {
    if (phase !== 'ready' || selectedEntries.length === 0 || !snapshot) return;
    setPhase('committing');
    setImportProgress(0);
    setReceipt(null);
    setErrorMessage('');
    onCommitStateChange?.(true);
    onTerminalStateChange?.('importing');

    let currentProject = snapshot.project;
    let currentRevision = snapshot.revision;
    let stopAfterCommitError = false;
    let recovery: SnapshotImportReceipt['recovery'];
    const items: SnapshotImportItem[] = [];

    for (let index = 0; index < selectedEntries.length; index += 1) {
      const entry = selectedEntries[index];
      if (!entry) continue;
      const key = flaStaticSnapshotCandidateKey(entry);
      const label = flaStaticSnapshotCandidateLabel(entry);
      const expectedPreview = previews[key];
      if (stopAfterCommitError) {
        items.push({ key, label, status: 'not-attempted', message: '前一项导入失败，未继续提交。' });
        setImportProgress(index + 1);
        continue;
      }
      if (!expectedPreview?.sha256) {
        items.push({ key, label, status: 'failed', message: '缺少已检查的预览，未导入。' });
        setImportProgress(index + 1);
        continue;
      }

      const requestId = crypto.randomUUID();
      try {
        const preview = await flaStaticSnapshotClient.preview({
          format: 'fla-static-snapshot-preview',
          version: 1,
          requestId,
          sessionId,
          target: {
            ...entry.target,
            selectedFrameIndex: entry.target.selectedFrameIndex ?? 0,
          },
        });
        if (!preview.ok || !preview.bytes) {
          items.push({
            key,
            label,
            status: 'failed',
            message: preview.ok ? '重新检查时没有得到预览图像。' : preview.error.message,
          });
        } else if (preview.sha256 !== expectedPreview.sha256) {
          items.push({ key, label, status: 'failed', message: '候选图像已变化；为避免导入未确认内容，此项未导入。' });
        } else {
          const response = await flaStaticSnapshotClient.commit({
            format: 'fla-static-snapshot-commit',
            version: 1,
            projectRoot: snapshot.projectRoot,
            project: currentProject,
            baseRevision: currentRevision,
            sessionId,
            confirmedPreviewRequestId: preview.requestId,
            source,
            target: {
              ...entry.target,
              selectedFrameIndex: entry.target.selectedFrameIndex ?? 0,
            },
            preview: {
              sha256: preview.sha256,
              width: preview.width,
              height: preview.height,
              byteLength: preview.bytes.byteLength,
            },
            confirmed: true,
          });
          if (response.ok) {
            currentProject = response.project;
            currentRevision = response.savedRevision;
            onImported(response);
            items.push({
              key,
              label,
              status: response.result.status === 'imported' ? 'imported' : 'duplicate',
              assetId: response.result.assetId,
              assetFileName: response.result.targetFileName,
              message: response.result.message,
            });
          } else {
            items.push({ key, label, status: 'failed', message: response.error.message });
            recovery = {
              code: response.error.code,
              message: response.error.message,
              residualPaths: response.error.residualPaths,
            };
            stopAfterCommitError = true;
          }
        }
      } catch (error) {
        items.push({
          key,
          label,
          status: 'failed',
          message: error instanceof Error ? error.message : '导入失败。',
        });
        stopAfterCommitError = true;
      } finally {
        await flaStaticSnapshotClient.cancel({
          format: 'fla-static-snapshot-cancel',
          version: 1,
          requestId,
        });
        setImportProgress(index + 1);
      }
    }

    const partial = items.some((item) => item.status === 'failed' || item.status === 'not-attempted');
    setReceipt({ selectedCount: selectedEntries.length, items, partial, recovery });
    setPhase(partial ? 'partial' : 'completed');
    onCommitStateChange?.(false);
    onTerminalStateChange?.(partial ? 'recovery' : 'success');
  };

  if (phase === 'loading' || phase === 'error') {
    return (
      <div
        className="fla-snapshot-review fla-render-workbench-panel"
        data-preview-state={phase === 'error' ? 'error' : 'needs-preview'}
        data-testid="fla-snapshot-review"
        data-workbench-panel="snapshot"
        role="note"
      >
        {phase === 'loading'
          ? <p data-testid="fla-snapshot-loading">正在读取候选状态…</p>
          : <p role="alert" data-testid="fla-snapshot-error">{errorMessage || '无法读取 FLA 候选。'}</p>}
        <button type="button" data-testid="fla-snapshot-close" onClick={close}>返回</button>
      </div>
    );
  }

  if (receipt && (phase === 'completed' || phase === 'partial')) {
    const importedCount = receipt.items.filter((item) => item.status === 'imported').length;
    const duplicateCount = receipt.items.filter((item) => item.status === 'duplicate').length;
    const failedCount = receipt.items.filter((item) => item.status === 'failed').length;
    const notAttemptedCount = receipt.items.filter((item) => item.status === 'not-attempted').length;
    return (
      <section
        className="fla-snapshot-review fla-render-workbench-panel fla-snapshot-batch-receipt"
        data-testid="fla-snapshot-review"
        data-stage-g-state={phase === 'completed' ? 'success' : 'recovery'}
        data-workbench-panel="snapshot"
        aria-labelledby="fla-snapshot-receipt-heading"
      >
        <header>
          <h3 id="fla-snapshot-receipt-heading">{phase === 'completed' ? '导入完成' : '已完成部分导入'}</h3>
          <output data-testid="fla-snapshot-import-counts">
            共处理 {receipt.selectedCount} 项 · 新导入 {importedCount} 项 · 复用已有素材 {duplicateCount} 项 · 失败 {failedCount} 项 · 未尝试 {notAttemptedCount} 项
          </output>
        </header>
        <ul className="fla-snapshot-receipt-items" data-testid="fla-snapshot-import-receipt">
          {receipt.items.map((item) => (
            <li data-status={item.status} key={item.key}>
              <strong>{item.label}</strong>
              <span>{item.status === 'imported' ? '已新建' : item.status === 'duplicate' ? '已复用' : item.status === 'not-attempted' ? '未尝试' : '失败'}</span>
              {item.assetFileName ? <small>{item.assetFileName}</small> : null}
              {item.message ? <small>{item.message}</small> : null}
            </li>
          ))}
        </ul>
        {receipt.recovery ? (
          <FlaStageGRecovery
            candidateStillCurrent={false}
            code={receipt.recovery.code}
            message={receipt.recovery.message}
            onClose={close}
            onPrimary={() => {
              onTerminalStateChange?.('active');
              setReceipt(null);
              setPhase('ready');
            }}
            residualPaths={receipt.recovery.residualPaths}
            route="snapshot"
          />
        ) : (
          <div className="fla-snapshot-action-buttons">
            <button type="button" data-testid="fla-snapshot-close" onClick={close}>返回素材库</button>
          </div>
        )}
      </section>
    );
  }

  if (entries.length === 0 && phase === 'ready') {
    return (
      <div className="fla-snapshot-review fla-render-workbench-panel" data-testid="fla-snapshot-review" role="note">
        <p data-testid="fla-snapshot-empty">这个 FLA 没有发现可检查的图形状态。</p>
        <button type="button" data-testid="fla-snapshot-close" onClick={close}>返回</button>
      </div>
    );
  }

  const focusedStatus = focusedEntry
    ? previews[flaStaticSnapshotCandidateKey(focusedEntry)]
    : undefined;
  const focusedUnavailableEntry = focusedEntry && focusedStatus?.status === 'unsupported'
    ? {
        ...focusedEntry,
        previewSupported: false,
        unsupportedReason: focusedStatus.reason ?? focusedEntry.unsupportedReason ?? '当前无法安全生成预览。',
      }
    : null;
  const canImport = phase === 'ready' && selectedEntries.length > 0 && Boolean(snapshot);

  return (
    <div
      className="fla-snapshot-review fla-render-workbench-panel"
      data-preview-state={phase === 'scanning' ? 'rendering' : phase === 'committing' ? 'committing' : 'ready'}
      data-fla-session-id={sessionId}
      data-testid="fla-snapshot-review"
      data-workbench-panel="snapshot"
    >
      <div className="fla-snapshot-workbench" data-testid="fla-snapshot-workbench">
        <aside className="fla-snapshot-source-region" data-testid="fla-snapshot-source-region">
          <section className="fla-snapshot-target-region" aria-labelledby="fla-snapshot-target-heading">
            <header>
              <div>
                <p className="fla-render-panel-kicker">FLA 候选</p>
                <h3 id="fla-snapshot-target-heading">可用素材预览</h3>
              </div>
              <span data-testid="fla-snapshot-target-count">{entries.length} 项</span>
            </header>
            {stage ? (
              <p className="fla-snapshot-stage-fact" data-testid="fla-snapshot-source-facts">
                {stage.width} × {stage.height} · {stage.frameRate} fps
              </p>
            ) : null}
            <p className="fla-snapshot-catalog-summary" data-testid="fla-snapshot-catalog-summary">{checkedCatalogSummary}</p>
            {omittedCandidateCount > 0 ? (
              <p className="fla-snapshot-limit-warning" data-testid="fla-snapshot-catalog-limit" role="status">
                另有 {omittedCandidateCount} 项未列出；这些项目尚未检查，不能导入。
              </p>
            ) : null}
            <label className="fla-snapshot-target-search">
              <span>搜索素材</span>
              <input
                aria-label="搜索候选名称"
                data-testid="fla-snapshot-target-search"
                onChange={(event) => setCandidateSearch(event.currentTarget.value)}
                placeholder="按名称搜索"
                type="search"
                value={candidateSearch}
              />
            </label>
            <div className="fla-snapshot-candidate-tools" aria-label="候选选择工具">
              <button type="button" data-testid="fla-snapshot-select-supported" disabled={phase !== 'ready' || supportedEntries.length === 0} onClick={selectVisibleSupported}>
                选中可预览项
              </button>
              <button type="button" data-testid="fla-snapshot-clear-selection" disabled={phase !== 'ready' || selectedCandidateKeys.size === 0} onClick={clearSelection}>
                清空
              </button>
            </div>
            {phase === 'scanning' ? (
              <output className="fla-snapshot-scan-progress" data-testid="fla-snapshot-scan-progress" role="status">
                正在逐项检查预览 {scanProgress} / {entries.length}
              </output>
            ) : null}
            <ul className="fla-snapshot-targets fla-snapshot-candidates" data-testid="fla-snapshot-targets">
              {visibleGroups.map((group) => {
                const firstEntry = group.entries[0];
                if (!firstEntry) return null;
                return (
                  <li
                    className={group.duplicate ? 'is-duplicate-group' : undefined}
                    data-status={group.status}
                    data-duplicate={group.duplicate ? 'true' : 'false'}
                    data-testid={`fla-snapshot-candidate-group-${group.key}`}
                    key={group.key}
                  >
                    {group.duplicate ? <small className="fla-snapshot-duplicate-label">画面完全相同 · {group.sourceCount} 个来源</small> : null}
                    {group.entries.map((entry) => {
                      const key = flaStaticSnapshotCandidateKey(entry);
                      const candidatePreview = previews[key];
                      const status = candidatePreview?.status ?? (entry.previewSupported ? 'checking' : 'unsupported');
                      const selectable = status === 'supported' && phase === 'ready';
                      const focused = key === focusedCandidateKey;
                      return (
                        <div
                          className={`fla-snapshot-candidate-row${focused ? ' is-focused' : ''}`}
                          data-focused={focused ? 'true' : 'false'}
                          data-preview-supported={selectable ? 'true' : 'false'}
                          data-testid={`fla-snapshot-candidate-${key}`}
                          key={key}
                        >
                          <button
                            aria-pressed={focused}
                            className="fla-snapshot-candidate-focus"
                            disabled={phase === 'committing'}
                            onClick={() => setFocusedCandidateKey(key)}
                            type="button"
                          >
                            {candidatePreview?.previewUrl ? (
                              <img src={candidatePreview.previewUrl} alt="" />
                            ) : (
                              <span className={`fla-snapshot-candidate-placeholder is-${status}`} aria-hidden="true">
                                {status === 'blank' ? '空白' : status === 'unsupported' ? '不可预览' : status === 'checking' ? '检查中' : '预览'}
                              </span>
                            )}
                            <span className="fla-snapshot-candidate-copy">
                              <strong title={flaStaticSnapshotCandidateLabel(entry)}>{flaStaticSnapshotCandidateLabel(entry)}</strong>
                              <small>{flaStaticSnapshotCandidateKindLabel(entry)}</small>
                            </span>
                          </button>
                          <label className="fla-snapshot-candidate-select">
                            <input
                              aria-label={`选择 ${flaStaticSnapshotCandidateLabel(entry)}`}
                              checked={selectedCandidateKeys.has(key)}
                              disabled={!selectable}
                              onChange={() => toggleCandidate(entry)}
                              type="checkbox"
                            />
                            <span className="sr-only">选择素材</span>
                          </label>
                          <span className={`fla-snapshot-candidate-status is-${status}`}>
                            {status === 'supported' ? '可导入' : status === 'blank' ? '空白状态' : status === 'checking' ? '检查中' : '暂不可导入'}
                          </span>
                        </div>
                      );
                    })}
                  </li>
                );
              })}
              {visibleGroups.length === 0 ? <li className="fla-snapshot-targets-empty">没有匹配的候选。</li> : null}
            </ul>
          </section>
        </aside>

        <section className="fla-snapshot-preview-region" data-testid="fla-snapshot-preview-region">
          <header className="fla-snapshot-region-heading">
            <h3>{focusedEntry ? '候选预览' : '预览'}</h3>
            <output aria-live="polite" data-preview-state={focusedStatus?.status ?? 'checking'} data-testid="fla-snapshot-preview-status">
              {focusedStatus?.status === 'supported' ? '可导入' : focusedStatus?.status === 'blank' ? '空白状态' : focusedStatus?.status === 'unsupported' ? '暂不可导入' : phase === 'scanning' ? '正在检查' : '等待检查'}
            </output>
          </header>
          <div className="fla-snapshot-preview-stage" data-testid="fla-snapshot-preview-area">
            {focusedStatus?.previewUrl ? (
              <img
                alt={focusedEntry ? flaStaticSnapshotCandidateLabel(focusedEntry) : 'FLA 候选预览'}
                data-testid="fla-snapshot-preview-image"
                src={focusedStatus.previewUrl}
              />
            ) : (
              <div className="fla-snapshot-preview-placeholder" data-testid="fla-snapshot-preview-placeholder">
                <strong>{focusedStatus?.status === 'blank' ? '这是空白状态' : focusedStatus?.status === 'unsupported' ? '此项暂不可导入' : phase === 'scanning' ? '正在生成候选预览…' : '选择一个候选查看'}</strong>
                <span>{focusedStatus?.status === 'unsupported' ? boundedUnsupportedReason(focusedStatus.reason) : '只有成功生成并显示的预览才能加入导入选择。'}</span>
              </div>
            )}
          </div>
          {phase === 'committing' ? (
            <output className="fla-snapshot-import-progress" data-testid="fla-snapshot-import-progress" role="status">
              正在导入 {importProgress} / {selectedEntries.length}
            </output>
          ) : null}
        </section>

        <aside className="fla-snapshot-details-region" data-testid="fla-snapshot-details-region">
          {focusedUnavailableEntry ? (
            <FlaStageF2UnavailableDetails entry={focusedUnavailableEntry} />
          ) : focusedEntry ? (
            <>
              <h3 title={focusedEntry.target.userLabel}>{flaStaticSnapshotCandidateLabel(focusedEntry)}</h3>
              <dl className="fla-snapshot-details" data-testid="fla-snapshot-details">
                <div><dt>来源类型</dt><dd>{flaStaticSnapshotCandidateKindLabel(focusedEntry)}</dd></div>
                <div><dt>时间线范围</dt><dd>{focusedEntry.target.frameCount} 帧</dd></div>
                <div><dt>当前状态</dt><dd>{focusedStatus?.status === 'supported' ? '可导入' : focusedStatus?.status === 'blank' ? '空白状态' : focusedStatus?.status === 'unsupported' ? '暂不可导入' : '正在检查'}</dd></div>
                {focusedStatus?.sha256 ? <div><dt>预览去重</dt><dd title={focusedStatus.sha256}>{focusedStatus.sha256.slice(0, 12)}</dd></div> : null}
              </dl>
              <details className="fla-snapshot-compatibility" data-testid="fla-snapshot-compatibility-details">
                <summary>来源详情</summary>
                <dl className="fla-snapshot-detail-more">
                  <div><dt>目标名称</dt><dd title={focusedEntry.target.userLabel}>{focusedEntry.target.userLabel}</dd></div>
                  {focusedEntry.target.sourceLibraryItemName ? <div><dt>源元件</dt><dd title={focusedEntry.target.sourceLibraryItemName}>{focusedEntry.target.sourceLibraryItemName}</dd></div> : null}
                  <div><dt>源帧</dt><dd>{(focusedEntry.target.selectedFrameIndex ?? 0) + 1}</dd></div>
                  <div><dt>目标标识</dt><dd title={focusedEntry.target.renderTargetId}>{focusedEntry.target.renderTargetId}</dd></div>
                </dl>
              </details>
            </>
          ) : (
            <p>选择一个候选以查看来源和状态。</p>
          )}
          <dl className="fla-snapshot-details" data-testid="fla-snapshot-candidate-summary">
            <div><dt>可导入</dt><dd>{supportedEntries.length}</dd></div>
            <div><dt>暂不可导入</dt><dd>{unsupportedCount}</dd></div>
            <div><dt>空白状态</dt><dd>{blankCount}</dd></div>
            <div><dt>已选择</dt><dd>{selectedEntries.length}</dd></div>
          </dl>
        </aside>
      </div>

      <div className="fla-snapshot-action-bar" data-testid="fla-snapshot-action-bar">
        <div className="fla-snapshot-action-status">
          <strong data-testid="fla-snapshot-action-state">
            {phase === 'scanning' ? `检查候选 ${scanProgress} / ${entries.length}` : phase === 'committing' ? `导入 ${importProgress} / ${selectedEntries.length}` : `${selectedEntries.length} 项已选`}
          </strong>
          {errorMessage ? <span role="alert" data-testid="fla-snapshot-error">{errorMessage}</span> : null}
        </div>
        <div className="fla-snapshot-action-buttons">
          <button
            className="fla-snapshot-close-action"
            disabled={phase === 'committing'}
            onClick={close}
            type="button"
            data-testid="fla-snapshot-close"
          >
            取消
          </button>
          <button
            className="fla-render-primary-action"
            disabled={!canImport}
            onClick={() => void importSelected()}
            type="button"
            data-testid="fla-snapshot-import"
          >
            {phase === 'scanning' ? '正在检查…' : `确认并导入 ${selectedEntries.length} 项`}
          </button>
        </div>
      </div>
    </div>
  );
}

async function createCandidateThumbnailUrl(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const bitmap = await createImageBitmap(new Blob([copy.buffer], { type: 'image/png' }));
  try {
    const maxSide = 160;
    const scale = Math.min(1, maxSide / bitmap.width, maxSide / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法显示候选预览。');
    context.drawImage(bitmap, 0, 0, width, height);
    const thumbnail = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('无法生成候选缩略图。'));
      }, 'image/png');
    });
    return URL.createObjectURL(thumbnail);
  } finally {
    bitmap.close();
  }
}
