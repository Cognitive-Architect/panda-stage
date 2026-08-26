import { useEffect, useState } from 'react';
import { SHOT_MIN_DURATION_MS } from '../../../domain';
import { CirclePlus } from 'lucide-react';

export interface ShotCreateFormProps {
  disabled?: boolean;
  suggestedName: string;
  onBack: () => void;
  onCreate: (name: string, durationMs: number) => boolean;
}

export function ShotCreateForm({
  disabled = false,
  suggestedName,
  onBack,
  onCreate,
}: ShotCreateFormProps): React.JSX.Element {
  const [name, setName] = useState(suggestedName);
  const [nameEdited, setNameEdited] = useState(false);
  const [durationMs, setDurationMs] = useState(3_000);

  useEffect(() => {
    if (!nameEdited) setName(suggestedName);
  }, [nameEdited, suggestedName]);

  return (
    <section
      aria-labelledby="shot-create-heading"
      className="shot-create-view"
      data-testid="shot-create-view"
    >
      <div className="shot-create-heading">
        <div>
          <p className="eyebrow">镜头管理</p>
          <h3 id="shot-create-heading">新建镜头</h3>
        </div>
        <button
          data-testid="shot-create-back"
          onClick={onBack}
          type="button"
        >
          返回镜头列表
        </button>
      </div>
      <form
        className="shot-create-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (onCreate(name, durationMs)) onBack();
        }}
      >
        <label>
          名称
          <input
            disabled={disabled}
            maxLength={200}
            onChange={(event) => {
              setName(event.target.value);
              setNameEdited(true);
            }}
            value={name}
          />
        </label>
        <label>
          时长（毫秒）
          <input
            disabled={disabled}
            min={SHOT_MIN_DURATION_MS}
            onChange={(event) => setDurationMs(event.target.valueAsNumber)}
            step="1"
            type="number"
            value={Number.isNaN(durationMs) ? '' : durationMs}
          />
        </label>
        <p className="shot-create-hint">
          时长必须是整数，且不少于 {SHOT_MIN_DURATION_MS}ms。
        </p>
        <button
          className="ui-icon-label"
          disabled={disabled || !name.trim() || !Number.isInteger(durationMs)}
          type="submit"
        >
          <CirclePlus aria-hidden="true" className="ui-icon" focusable="false" size={18} />
          <span>创建镜头</span>
        </button>
      </form>
    </section>
  );
}
