import { useState } from 'react';
import { LegacyWorkspace } from './LegacyWorkspace';

export interface LegacyCompatibilityActivityProps {
  projectRoot: string;
}

/**
 * Explicitly gates the temporary ActionPreset owner behind a visible left
 * workspace entry. The compatibility tree is not mounted until activated.
 */
export function LegacyCompatibilityActivity({
  projectRoot,
}: LegacyCompatibilityActivityProps): React.JSX.Element {
  const [active, setActive] = useState(false);

  return (
    <section
      aria-labelledby="legacy-compatibility-heading"
      className="legacy-compatibility-activity"
      data-active={String(active)}
      data-testid="legacy-compatibility-activity"
    >
      <div className="legacy-compatibility-heading">
        <div>
          <p className="eyebrow">兼容功能</p>
          <h2 id="legacy-compatibility-heading">兼容编辑工具</h2>
        </div>
        <span>兼容工作区保留入口</span>
      </div>
      <button
        aria-controls="legacy-workspace"
        aria-expanded={active}
        data-testid="legacy-compatibility-toggle"
        onClick={() => setActive((current) => !current)}
        type="button"
      >
        {active ? '收起兼容功能' : '打开兼容功能'}
      </button>
      {active ? <LegacyWorkspace key={projectRoot} /> : null}
    </section>
  );
}
