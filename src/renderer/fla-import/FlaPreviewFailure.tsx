import { ChevronDown, ImageOff, Info, RotateCcw } from 'lucide-react';
import { Button } from '../ui';

export function FlaPreviewFailure({
  details, heading = '预览加载失败', guidance, onRetry, retryDisabled = false,
  retryLabel = '请重试', testIdPrefix, retryTestId,
}: {
  details: string;
  heading?: string;
  guidance?: string;
  onRetry?: () => void;
  retryDisabled?: boolean;
  retryLabel?: string;
  testIdPrefix: string;
  retryTestId?: string;
}): React.JSX.Element {
  return (
    <div className="fla-preview-failure" data-testid={`${testIdPrefix}-preview-failure`} role="alert">
      <div className="fla-preview-failure-body">
        <ImageOff aria-hidden="true" size={26} />
        <strong>{heading}</strong>
        {guidance ? <p>{guidance}</p> : null}
        {onRetry ? (
          <Button
            aria-label={retryLabel}
            className="fla-preview-failure-retry"
            data-testid={retryTestId ?? `${testIdPrefix}-reset-preview`}
            disabled={retryDisabled}
            onClick={onRetry}
            type="button"
            variant="secondary"
          >
            <RotateCcw aria-hidden="true" size={16} />
            <span>{retryLabel}</span>
          </Button>
        ) : null}
      </div>
      <details className="fla-c03-preview-diagnostics" data-testid={`${testIdPrefix}-error-details`}>
        <summary>
          <Info aria-hidden="true" size={14} />
          <span>详细信息</span>
          <ChevronDown aria-hidden="true" className="fla-c03-preview-diagnostics-chevron" size={14} />
        </summary>
        <pre>{details}</pre>
      </details>
    </div>
  );
}
