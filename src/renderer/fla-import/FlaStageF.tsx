import { ChevronDown, FileWarning, X } from 'lucide-react';
import { useEffect, useId } from 'react';
import type { AnimationImportIR, FlaInspectionResponse } from '../../shared/fla-import-api';
import type { FlaRenderableTargetCatalogEntry } from '../../shared/fla-static-snapshot-api';
import { IconButton } from '../ui';
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
      className="fla-stage-f1-notice fla-stage-f1-render-notice"
      data-stage-f-severity="warning"
      data-testid="fla-stage-f1-warning"
      role="note"
    >
      <details data-testid="fla-stage-f1-details">
        <summary className="fla-stage-f1-summary" data-testid="fla-stage-f1-details-toggle">
          <span aria-hidden="true" className="fla-stage-f1-icon">⚠</span>
          <strong id="fla-stage-f1-warning-heading">部分内容可能与原 FLA 有差异</strong>
          <span className="fla-stage-f1-disclosure">· 查看 {warnings.length} 项说明</span>
        </summary>
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
 * F2 contract presentation for a catalog candidate that cannot be safely
 * previewed. It keeps that truth local and never exposes the raw developer
 * reason as beginner-facing copy.
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
  const titleId = useId();

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [onClose]);

  return (
    <section
      aria-labelledby={titleId}
      aria-modal="true"
      className="fla-review-session fla-compact-status fla-stage-f3-blocked"
      data-stage-f-severity="blocked"
      data-testid="fla-stage-f3-blocked"
      data-workbench-route="blocked"
      role="dialog"
    >
      <div className="fla-compact-status-message" role="alert">
        <FileWarning aria-hidden="true" className="fla-stage-f3-icon" size={18} />
        <h1 id={titleId}>无法读取素材</h1>
      </div>
      <IconButton
        aria-label="关闭并返回素材库"
        autoFocus
        className="fla-compact-status-close"
        data-testid="fla-stage-f3-return"
        icon={<X size={18} />}
        onClick={onClose}
        type="button"
        variant="secondary"
      />
      <details data-testid="fla-stage-f3-details">
        <summary>
          <ChevronDown aria-hidden="true" size={14} />
          查看详情
        </summary>
        <pre>{blockedDiagnosticDetails(response)}</pre>
      </details>
    </section>
  );
}

function blockedDiagnosticDetails(response: FlaInspectionResponse | null): string {
  const missingReason = '未返回更具体原因';
  if (!response || response.ok) return missingReason;
  const { code, message } = response.error;
  const reason = message.trim();
  const withCode = reason.startsWith(code + ':') ? reason : code + ': ' + reason;
  const primary = !reason || reason === code || reason === code + ':'
    ? code + ': ' + missingReason
    : withCode;
  const lines = [primary];
  const supplementary = [
    ...(response.diagnostics ?? []).map((entry) => entry.developerNote),
    ...(response.trace?.classifierReasonCodes ?? []),
  ];
  for (const item of supplementary) {
    const detail = item?.trim();
    if (detail && !lines.some((line) => line.includes(detail))) lines.push(detail);
  }

  return lines.join('\n').replace(
    /(\bAuthorization\s*:\s*(?:Bearer|Basic)\s+)[^\s,;]+/giu,
    '$1[已隐藏]',
  );
}
