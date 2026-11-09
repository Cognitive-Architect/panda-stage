import { ArrowLeftRight, Check } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  describeQuickLayoutBlock,
  listQuickLayoutCharacters,
  planQuickCharacterLayout,
} from '../../../domain';
import { Button, DecorativeIcon, IconButton } from '../../ui';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { quickLayoutPreviewStore } from '../../stores/quickLayoutPreviewStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { useTimelineUi } from '../timeline/timelineUiStore';

const TIMELINE_BASE_NOTICE = '时间轴预览中 · 回到 0:00 可使用快速布阵';

/**
 * AUTO-01 V0: one frozen two-person dialogue stance. The panel owns the two
 * slot ids and a runtime-only preview; the formal commit happens once through
 * the Layer store, so one Undo restores both people.
 */
export function QuickCharacterLayoutPanel(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const { currentTimeMs } = useTimelineUi();
  const [leftLayerId, setLeftLayerId] = useState<string | null>(null);
  const [rightLayerId, setRightLayerId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const initialized = useRef(false);

  const shot =
    snapshot?.project.shots.find(
      (candidate) => candidate.id === currentShotId,
    ) ?? null;
  const options = useMemo(
    () =>
      snapshot && shot
        ? listQuickLayoutCharacters(snapshot.project, shot)
        : [],
    [shot, snapshot],
  );

  // Prefill once per opening: the canvas selection wins the left slot, and a
  // Shot with exactly two characters fills both slots.
  useEffect(() => {
    if (initialized.current || !shot) return;
    initialized.current = true;
    const selected = selectionStore.getSelectedLayerId();
    if (options.length === 2) {
      const [first, second] = options as [
        (typeof options)[number],
        (typeof options)[number],
      ];
      if (selected === second.layerId) {
        setLeftLayerId(second.layerId);
        setRightLayerId(first.layerId);
      } else {
        setLeftLayerId(first.layerId);
        setRightLayerId(second.layerId);
      }
      return;
    }
    if (selected && options.some((option) => option.layerId === selected)) {
      setLeftLayerId(selected);
    }
  }, [options, shot]);

  // A deleted, retyped, or undone Layer must not leave a stale slot behind.
  useEffect(() => {
    if (
      leftLayerId &&
      !options.some((option) => option.layerId === leftLayerId)
    ) {
      setLeftLayerId(null);
    }
    if (
      rightLayerId &&
      !options.some((option) => option.layerId === rightLayerId)
    ) {
      setRightLayerId(null);
    }
  }, [leftLayerId, options, rightLayerId]);

  const atTimelineBase = currentTimeMs === 0;
  const plan = useMemo(
    () =>
      snapshot && shot
        ? planQuickCharacterLayout(
            snapshot.project,
            shot,
            leftLayerId,
            rightLayerId,
          )
        : null,
    [leftLayerId, rightLayerId, shot, snapshot],
  );

  useEffect(() => {
    if (plan?.ok && atTimelineBase) {
      quickLayoutPreviewStore.show(plan.plan);
      return;
    }
    quickLayoutPreviewStore.clear();
  }, [atTimelineBase, plan]);

  useEffect(() => () => quickLayoutPreviewStore.clear(), []);

  const reasonFor = (layerId: string | null): string | null => {
    if (!layerId) return null;
    const option = options.find((candidate) => candidate.layerId === layerId);
    if (!option?.blocked) return null;
    return describeQuickLayoutBlock(option.name, option.blocked);
  };
  const leftReason = reasonFor(leftLayerId);
  const rightReason = reasonFor(rightLayerId);
  const blockingNotice =
    plan && !plan.ok && plan.reason !== 'incomplete'
      ? plan.reason === 'same-layer' ||
        plan.reason === 'not-character' ||
        plan.reason === 'out-of-canvas'
        ? plan.message
        : null
      : null;
  const notice = !atTimelineBase
    ? TIMELINE_BASE_NOTICE
    : (message ?? blockingNotice);
  const canApply = atTimelineBase && plan?.ok === true;

  const apply = (): void => {
    if (!snapshot || !shot) return;
    const current = planQuickCharacterLayout(
      snapshot.project,
      shot,
      leftLayerId,
      rightLayerId,
    );
    if (!current.ok) {
      setMessage(current.message);
      return;
    }
    try {
      const next = layerStore.updatePositions(
        [
          {
            layerId: current.plan.leftLayerId,
            position: current.plan.left,
          },
          {
            layerId: current.plan.rightLayerId,
            position: current.plan.right,
          },
        ],
        'Quick layout characters',
      );
      quickLayoutPreviewStore.clear();
      setMessage(
        next === snapshot.project ? '两个人已经站在这里了。' : '已应用双人站位。',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '布阵失败，请重试。',
      );
    }
  };

  const swap = (): void => {
    setLeftLayerId(rightLayerId);
    setRightLayerId(leftLayerId);
    setMessage(null);
  };

  const renderSelect = (
    slot: 'left' | 'right',
    value: string | null,
    onChange: (next: string | null) => void,
  ): React.JSX.Element => (
    <select
      className="quick-layout-select"
      data-testid={`quick-layout-${slot}`}
      id={`quick-layout-${slot}`}
      onChange={(event) => {
        onChange(event.target.value || null);
        setMessage(null);
      }}
      value={value ?? ''}
    >
      <option value="">选择人物</option>
      {options.map((option) => (
        <option key={option.layerId} value={option.layerId}>
          {option.label}
        </option>
      ))}
    </select>
  );

  return (
    <section
      aria-label="快速布阵"
      className="quick-layout"
      data-quick-layout-ready={String(canApply)}
      data-testid="quick-layout-panel"
    >
      <div className="quick-layout-people">
        <div className="quick-layout-people-head">
          <span className="quick-layout-people-title">人物</span>
          <IconButton
            aria-label="交换左右"
            className="quick-layout-swap"
            data-testid="quick-layout-swap"
            disabled={!leftLayerId && !rightLayerId}
            icon={<DecorativeIcon icon={ArrowLeftRight} size={18} />}
            onClick={swap}
            variant="secondary"
          />
        </div>
        <div className="quick-layout-person" data-quick-layout-slot="left">
          <label htmlFor="quick-layout-left">左侧</label>
          {renderSelect('left', leftLayerId, setLeftLayerId)}
          {leftReason ? (
            <p
              className="quick-layout-reason"
              data-testid="quick-layout-left-reason"
            >
              {leftReason}
            </p>
          ) : null}
        </div>
        <div className="quick-layout-person" data-quick-layout-slot="right">
          <label htmlFor="quick-layout-right">右侧</label>
          {renderSelect('right', rightLayerId, setRightLayerId)}
          {rightReason ? (
            <p
              className="quick-layout-reason"
              data-testid="quick-layout-right-reason"
            >
              {rightReason}
            </p>
          ) : null}
        </div>
      </div>

      <div className="quick-layout-rules">
        <span className="quick-layout-rules-title">站位</span>
        <ul>
          <li>
            <DecorativeIcon icon={Check} size={14} />
            <span>双人对话</span>
          </li>
          <li>
            <DecorativeIcon icon={Check} size={14} />
            <span>底部对齐</span>
          </li>
        </ul>
      </div>

      {notice ? (
        <p
          className="quick-layout-notice"
          data-testid="quick-layout-notice"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <Button
        className="quick-layout-apply"
        data-testid="quick-layout-apply"
        disabled={!canApply}
        onClick={apply}
        variant="primary"
      >
        应用站位
      </Button>
    </section>
  );
}
