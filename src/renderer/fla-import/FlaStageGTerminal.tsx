import type { ReactNode } from 'react';
import type {
  FlaAssetCommitResponse,
} from '../../shared/fla-asset-commit-api';
import type {
  FlaFrameSequenceCommitResponse,
} from '../../shared/fla-frame-sequence-api';
import type {
  FlaStaticSnapshotCommitResponse,
} from '../../shared/fla-static-snapshot-api';

export type FlaStageGRoute = 'raster' | 'snapshot' | 'sequence';
export type FlaStageGTerminalState = 'active' | 'importing' | 'success' | 'recovery';

type FlaStageGRecoveryKind =
  | 'stale-preview'
  | 'stale-sequence'
  | 'stale-project'
  | 'retry'
  | 'unsafe'
  | 'return';

interface FlaStageGRecoveryModel {
  kind: FlaStageGRecoveryKind;
  title: string;
  description: string;
  primaryLabel: string;
}

const RETRYABLE_COMMIT_CODES = new Set([
  'ASSET_COMMIT_FAILED',
  'COMMIT_BUSY',
]);

const HIGH_SEVERITY_COMMIT_CODES = new Set([
  'ROLLBACK_FAILED',
  'JOURNAL_RECOVERY_FAILED',
]);

/**
 * Presentation-only recovery mapping. Route owners still decide whether a
 * candidate is current and provide the safe callback. This helper only turns
 * typed Main truth into beginner-facing language.
 */
export function mapFlaStageGRecovery(
  code: string,
  candidateStillCurrent: boolean,
): FlaStageGRecoveryModel {
  if (code === 'STALE_PREVIEW') {
    return {
      kind: 'stale-preview',
      title: '当前预览已失效',
      description: '为了避免导入错误的帧，请重新生成当前帧预览。',
      primaryLabel: '重新预览',
    };
  }
  if (code === 'STALE_SEQUENCE') {
    return {
      kind: 'stale-sequence',
      title: '当前帧序列已失效',
      description: '请重新生成序列后再导入。',
      primaryLabel: '重新生成',
    };
  }
  if (code === 'STALE_PROJECT_REVISION' || code === 'STALE_REVISION') {
    return {
      kind: 'stale-project',
      title: '项目在导入期间发生了变化',
      description: 'Panda 没有使用旧项目状态继续写入，请先回到最新项目状态，再重新完成导入。',
      primaryLabel: '返回素材库',
    };
  }
  if (HIGH_SEVERITY_COMMIT_CODES.has(code)) {
    return {
      kind: 'unsafe',
      title: '导入未能安全完成',
      description: 'Panda Stage 没能确认所有导入痕迹都已安全恢复，建议暂时不要继续导入这个 FLA。',
      primaryLabel: '返回素材库',
    };
  }
  if (candidateStillCurrent && RETRYABLE_COMMIT_CODES.has(code)) {
    return {
      kind: 'retry',
      title: '没有完成导入',
      description: '当前选择或预览仍然保留，可以安全地重新尝试。',
      primaryLabel: '重新尝试',
    };
  }
  return {
    kind: 'return',
    title: '这次导入没有完成',
    description: '当前导入条件已经不能安全继续，请回到素材库后重新检查这个 FLA。',
    primaryLabel: '返回素材库',
  };
}

export function FlaStageGImporting({
  route,
  headline,
  context,
}: {
  route: FlaStageGRoute;
  headline: string;
  context: string;
}): React.JSX.Element {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="fla-stage-g-terminal fla-stage-g-importing"
      data-fake-commit-cancel="false"
      data-fake-percent="false"
      data-route={route}
      data-stage-g-state="importing"
      data-testid="fla-stage-g-importing"
      role="status"
    >
      <div className="fla-stage-g-terminal-inner">
        <span aria-hidden="true" className="fla-stage-g-progress-mark">
          <span />
        </span>
        <div className="fla-stage-g-terminal-copy">
          <p className="fla-stage-g-kicker">正在安全写入项目</p>
          <h2>{headline}</h2>
          <p>{context}</p>
          <output data-testid="fla-stage-g-importing-status">
            Panda Stage 正在安全写入项目，请稍候。
          </output>
        </div>
      </div>
    </section>
  );
}

export function FlaStageGSuccess({
  route,
  headline,
  children,
  onReturn,
}: {
  route: FlaStageGRoute;
  headline: string;
  children: ReactNode;
  onReturn: () => void;
}): React.JSX.Element {
  return (
    <section
      aria-live="polite"
      className="fla-stage-g-terminal fla-stage-g-success"
      data-route={route}
      data-stage-g-state="success"
      data-testid="fla-stage-g-success"
      role="status"
    >
      <div className="fla-stage-g-terminal-inner">
        <span aria-hidden="true" className="fla-stage-g-success-mark">✓</span>
        <div className="fla-stage-g-terminal-copy">
          <p className="fla-stage-g-kicker">导入已完成</p>
          <h2>{headline}</h2>
          <div className="fla-stage-g-receipt" data-testid="fla-stage-g-success-receipt">
            {children}
          </div>
          <button
            className="fla-stage-g-primary-action"
            data-testid="fla-stage-g-return-library"
            onClick={onReturn}
            type="button"
          >
            返回素材库
          </button>
        </div>
      </div>
    </section>
  );
}

export function FlaStageGRasterSuccess({
  response,
  onReturn,
}: {
  response: Extract<FlaAssetCommitResponse, { ok: true; status: 'completed' }>;
  onReturn: () => void;
}): React.JSX.Element {
  const { importedCount, duplicateCount, renamedCount, selectedCount } = response.summary;
  const allReused = importedCount === 0 && duplicateCount > 0;
  return (
    <div
      data-duplicate-count={duplicateCount}
      data-imported-count={importedCount}
      data-renamed-count={renamedCount}
      data-selected-count={selectedCount}
      data-testid="fla-stage-g-raster-success"
    >
      <FlaStageGSuccess
        headline={allReused ? '已完成' : '素材导入完成'}
        onReturn={onReturn}
        route="raster"
      >
        {allReused ? (
          <p className="fla-stage-g-receipt-lead">{selectedCount} 项均已存在于素材库，已复用已有素材，没有创建重复文件。</p>
        ) : null}
        <dl className="fla-stage-g-receipt-facts">
          {importedCount > 0 ? (
            <div><dt>新增</dt><dd>{importedCount} 项</dd></div>
          ) : null}
          {duplicateCount > 0 && !allReused ? (
            <div><dt>复用已有素材</dt><dd>{duplicateCount} 项</dd></div>
          ) : null}
          {renamedCount > 0 ? (
            <div><dt>重命名</dt><dd>{renamedCount} 项</dd></div>
          ) : null}
          <div><dt>共处理</dt><dd>{selectedCount} 项</dd></div>
        </dl>
      </FlaStageGSuccess>
    </div>
  );
}

export function FlaStageGSnapshotSuccess({
  response,
  onReturn,
}: {
  response: Extract<FlaStaticSnapshotCommitResponse, { ok: true; status: 'completed' }>;
  onReturn: () => void;
}): React.JSX.Element {
  const { result } = response;
  const duplicate = result.status === 'duplicate';
  return (
    <div
      data-commit-status={result.status}
      data-renamed={String(result.renamed)}
      data-target-file-name={result.targetFileName}
      data-testid="fla-stage-g-snapshot-success"
    >
      <FlaStageGSuccess
        headline={duplicate ? '已复用已有素材' : '当前帧已导入'}
        onReturn={onReturn}
        route="snapshot"
      >
        <p className="fla-stage-g-filename" title={result.targetFileName}>{result.targetFileName}</p>
        {duplicate ? <p className="fla-stage-g-receipt-lead">没有创建重复文件。</p> : null}
        {result.renamed ? <p className="fla-stage-g-receipt-note">已自动避免重名。</p> : null}
      </FlaStageGSuccess>
    </div>
  );
}

export function FlaStageGSequenceSuccess({
  response,
  rangeStart,
  rangeEnd,
  onReturn,
}: {
  response: Extract<FlaFrameSequenceCommitResponse, { ok: true; status: 'completed' }>;
  rangeStart: number;
  rangeEnd: number;
  onReturn: () => void;
}): React.JSX.Element {
  const { requestedFrameCount, importedCount, duplicateCount, renamedCount } = response.result.summary;
  const allReused = importedCount === 0 && duplicateCount > 0;
  return (
    <div
      data-duplicate-count={duplicateCount}
      data-imported-count={importedCount}
      data-net-new-image-asset-count={response.result.summary.netNewImageAssetCount}
      data-renamed-count={renamedCount}
      data-requested-frame-count={requestedFrameCount}
      data-range-end={rangeEnd}
      data-range-start={rangeStart}
      data-testid="fla-stage-g-sequence-success"
    >
      <FlaStageGSuccess
        headline={allReused ? '帧序列已处理' : '帧序列导入完成'}
        onReturn={onReturn}
        route="sequence"
      >
        {allReused ? (
          <p className="fla-stage-g-receipt-lead">{requestedFrameCount} 帧均复用了已有素材，没有创建重复文件。</p>
        ) : null}
        <dl className="fla-stage-g-receipt-facts">
          {importedCount > 0 ? (
            <div><dt>新增</dt><dd>{importedCount} 帧</dd></div>
          ) : null}
          {duplicateCount > 0 && !allReused ? (
            <div><dt>复用已有素材</dt><dd>{duplicateCount} 帧</dd></div>
          ) : null}
          {renamedCount > 0 ? (
            <div><dt>重命名</dt><dd>{renamedCount} 帧</dd></div>
          ) : null}
          <div><dt>共处理</dt><dd>{requestedFrameCount} 帧</dd></div>
          <div><dt>范围</dt><dd>{rangeStart}–{rangeEnd}</dd></div>
        </dl>
      </FlaStageGSuccess>
    </div>
  );
}

export function FlaStageGRecovery({
  route,
  code,
  message,
  residualPaths,
  candidateStillCurrent,
  onPrimary,
  onClose,
}: {
  route: FlaStageGRoute;
  code: string;
  message: string;
  residualPaths?: readonly string[];
  candidateStillCurrent: boolean;
  onPrimary: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const model = mapFlaStageGRecovery(code, candidateStillCurrent);
  const primaryReturns = model.kind === 'stale-project' || model.kind === 'unsafe' || model.kind === 'return';
  const hasTechnicalDetails = Boolean(message || residualPaths?.length);
  return (
    <section
      aria-live="assertive"
      className={`fla-stage-g-terminal fla-stage-g-recovery fla-stage-g-recovery-${model.kind}`}
      data-recovery-code={code}
      data-recovery-kind={model.kind}
      data-route={route}
      data-stage-g-state="recovery"
      data-testid="fla-stage-g-recovery"
      role="alert"
    >
      <div className="fla-stage-g-terminal-inner">
        <span aria-hidden="true" className="fla-stage-g-recovery-mark">{model.kind === 'unsafe' ? '!' : 'i'}</span>
        <div className="fla-stage-g-terminal-copy">
          <p className="fla-stage-g-kicker">需要处理</p>
          <h2>{model.title}</h2>
          <p>{model.description}</p>
          {hasTechnicalDetails ? (
            <details className="fla-stage-g-technical-details" data-testid="fla-stage-g-technical-details">
              <summary>查看技术详情</summary>
              <p>{message}</p>
              {residualPaths && residualPaths.length > 0 ? (
                <ul>
                  {residualPaths.map((path) => <li key={path}><code>{path}</code></li>)}
                </ul>
              ) : null}
            </details>
          ) : null}
          <div className="fla-stage-g-recovery-actions">
            <button
              className="fla-stage-g-primary-action"
              data-testid="fla-stage-g-recovery-primary"
              onClick={primaryReturns ? onClose : onPrimary}
              type="button"
            >
              {model.primaryLabel}
            </button>
            {!primaryReturns ? (
              <button
                className="fla-stage-g-secondary-action"
                data-testid="fla-stage-g-recovery-return"
                onClick={onClose}
                type="button"
              >
                返回素材库
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
