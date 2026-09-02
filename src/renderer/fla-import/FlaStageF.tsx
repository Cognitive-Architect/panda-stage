import type { AnimationImportIR, FlaInspectionResponse } from '../../shared/fla-import-api';
import type { FlaRenderableTargetCatalogEntry } from '../../shared/fla-static-snapshot-api';
import { FLA_COMPATIBILITY_LABELS } from './fla-review';

type FlaCompatibilityEntry = AnimationImportIR['compatibility'][number];

const FLA_STAGE_F1_STATUSES = new Set<FlaCompatibilityEntry['status']>([
  'degraded',
  'unsupported',
  'unknown',
]);

/**
 * Stage F is a presentation layer over already-authoritative compatibility
 * facts. It deliberately does not infer a whole-file block from an
 * `unsupported` entry in a successful inspection.
 */
export function getFlaStageF1Warnings(
  compatibility: readonly FlaCompatibilityEntry[],
): readonly FlaCompatibilityEntry[] {
  return compatibility.filter((entry) => FLA_STAGE_F1_STATUSES.has(entry.status));
}

function featureLabel(feature: string): string {
  const labels: Readonly<Record<string, string>> = {
    actionscript: 'ActionScript 脚本',
    'basic-tweens': '基础补间',
    'bitmap-media': '位图素材',
    'symbol-movieclip-semantics': '元件 / 影片剪辑',
    'timeline-frame-placement': '时间轴使用',
    'unresolved-bitmap-reference': '位图引用',
    'vector-shape': '矢量图形',
    video: '视频内容',
    text: '文本内容',
  };
  return labels[feature] ?? '其他内容';
}

function warningExplanation(status: FlaCompatibilityEntry['status']): string {
  switch (status) {
    case 'degraded':
      return '当前流程仍可继续，但结果可能与原 FLA 存在差异。';
    case 'unsupported':
      return '这类内容不在当前导入范围内；当前可用内容仍可继续处理。';
    case 'unknown':
      return '当前无法完全确认这类内容的兼容性，请留意预览结果。';
    default:
      return '当前流程仍可继续，请按需查看详细说明。';
  }
}

/**
 * F1: one concise, progressively disclosed warning for a usable Workbench.
 * The warning intentionally has no primary-action styling, so a valid task
 * CTA in the child R1/R2 panel remains the visual authority.
 */
export function FlaStageF1Notice({
  compatibility,
}: {
  compatibility: readonly FlaCompatibilityEntry[];
}): React.JSX.Element | null {
  const warnings = getFlaStageF1Warnings(compatibility);
  if (warnings.length === 0) return null;

  return (
    <section
      aria-labelledby="fla-stage-f1-warning-heading"
      className="fla-stage-f1-notice"
      data-stage-f-severity="warning"
      data-testid="fla-stage-f1-warning"
      role="note"
    >
      <div className="fla-stage-f1-summary">
        <span aria-hidden="true" className="fla-stage-f1-icon">⚠</span>
        <div>
          <strong id="fla-stage-f1-warning-heading">部分内容可能与原 FLA 有差异</strong>
          <span>当前流程仍可继续，详情按需查看。</span>
        </div>
      </div>
      <details data-testid="fla-stage-f1-details">
        <summary data-testid="fla-stage-f1-details-toggle">查看 {warnings.length} 项说明</summary>
        <ul data-testid="fla-stage-f1-detail-list">
          {warnings.map((entry) => (
            <li key={`${entry.feature}:${entry.status}`}>
              <strong>{FLA_COMPATIBILITY_LABELS[entry.status]} · {featureLabel(entry.feature)}</strong>
              <span>{warningExplanation(entry.status)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/**
 * F2 contract presentation. Production target discovery currently does not
 * emit unavailable entries, but the shared catalog contract already carries
 * one. This component keeps that truth local and never exposes the raw
 * developer reason as beginner-facing copy.
 */
export function FlaStageF2UnavailableDetails({
  entry,
}: {
  entry: FlaRenderableTargetCatalogEntry;
}): React.JSX.Element {
  return (
    <div
      className="fla-stage-f2-unavailable-details"
      data-preview-supported="false"
      data-stage-f-severity="target-unavailable"
      data-testid="fla-stage-f2-unavailable-details"
      role="note"
    >
      <span className="fla-stage-f2-unavailable-badge">暂不可预览</span>
      <h3 title={entry.target.userLabel}>{entry.target.userLabel}</h3>
      <p>这个目标使用了 Panda 当前还不能安全渲染的内容。</p>
      <p>其他可用目标不受影响。</p>
      <details data-testid="fla-stage-f2-more-details">
        <summary>更多说明</summary>
        <p>{boundedUnsupportedReason(entry.unsupportedReason)}</p>
      </details>
    </div>
  );
}

/**
 * Convert a producer-facing reason into bounded user copy. Exact developer
 * detail remains in existing diagnostic channels, not in the primary UI.
 */
export function boundedUnsupportedReason(reason: string | undefined): string {
  const normalized = reason?.toLocaleLowerCase() ?? '';
  if (normalized.includes('shape') || normalized.includes('vector')) {
    return '该目标包含当前还不能安全渲染的矢量内容。';
  }
  if (normalized.includes('video')) {
    return '该目标包含当前还不能安全渲染的视频内容。';
  }
  if (normalized.includes('text')) {
    return '该目标包含当前还不能安全渲染的文本内容。';
  }
  if (normalized.includes('timeline') || normalized.includes('frame')) {
    return '该目标的时间轴内容当前无法安全确认。';
  }
  return 'Panda 当前无法安全确认该目标的渲染结果。';
}

/**
 * F3: the existing blocked inspection route gets a dedicated Workbench
 * composition. No render, target, mode, preview, generate, or import control
 * is rendered here; the single exit action is owned by this state.
 */
export function FlaStageF3Blocked({
  response,
  onClose,
}: {
  response: FlaInspectionResponse | null;
  onClose: () => void;
}): React.JSX.Element {
  const diagnosticEntry = response?.diagnostics?.find(
    (entry) => entry.category === 'archive-malformed',
  ) ?? response?.diagnostics?.[0];
  const diagnostic = safeBlockedDiagnostic(diagnosticEntry?.category, diagnosticEntry?.userMessage);
  const canClaimSourceUnchanged = Boolean(response?.trace);

  return (
    <section
      aria-label="FLA 工作台"
      aria-modal="true"
      className="fla-review-session fla-stage-f3-session"
      data-stage-f-severity="blocked"
      data-testid="fla-stage-f3-blocked"
      data-workbench-route="blocked"
      role="dialog"
    >
      <header className="fla-review-heading fla-stage-f3-header" data-testid="fla-review-header">
        <div>
          <p className="eyebrow">只读安全检查</p>
          <h2>FLA 工作台</h2>
          <p>当前文件未进入预览或导入流程</p>
        </div>
        <span className="fla-stage-f3-readonly">只读</span>
      </header>
      <div className="fla-review-body fla-review-status-body fla-stage-f3-body" data-testid="fla-review-body">
        <div className="fla-stage-f3-blocked" data-stage-f-severity="blocked" role="alert">
          <div className="fla-stage-f3-blocked-copy">
            <span aria-hidden="true" className="fla-stage-f3-icon">!</span>
            <p className="fla-render-panel-kicker">安全检查已停止</p>
            <h1>这个 FLA 暂时无法安全处理</h1>
            <p>文件结构存在 Panda 当前无法安全确认的问题，因此已停止继续读取。</p>
            <p data-testid="fla-review-diagnostic">{diagnostic}</p>
            {canClaimSourceUnchanged ? (
              <p className="fla-stage-f3-source-unchanged" data-testid="fla-stage-f3-source-unchanged">
                ✓ 原文件没有被修改
              </p>
            ) : null}
            <details data-testid="fla-stage-f3-details">
              <summary>为什么会这样？</summary>
              <p>Panda 已停止继续读取当前文件。返回素材库后，你可以重新选择一个文件。</p>
            </details>
          </div>
          <button
            autoFocus
            className="fla-stage-f3-return"
            data-testid="fla-stage-f3-return"
            onClick={onClose}
            type="button"
          >
            返回素材库
          </button>
        </div>
      </div>
    </section>
  );
}

function safeBlockedDiagnostic(
  category: string | undefined,
  candidate: string | undefined,
): string {
  const fallback = category === 'archive-malformed'
    ? '此 FLA 文件的结构未通过安全检查，Panda 已停止继续读取。'
    : category === 'unsupported-or-unknown'
      ? '此 FLA 包含当前无法安全确认的内容，Panda 已停止继续读取。'
      : 'Panda 无法确认这个文件的结构，因此已停止继续读取。';
  if (!candidate) return fallback;
  if (/MALFORMED_ARCHIVE|EOCD|centralDirectory|lifeart\/fla-viewer|[A-Za-z]:[\\/]|\b[0-9a-f]{64}\b|\bF[123]\b/iu.test(candidate)) {
    return fallback;
  }
  return candidate;
}
