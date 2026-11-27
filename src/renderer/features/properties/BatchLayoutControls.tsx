import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  MoveVertical,
  Users,
} from 'lucide-react';
import {
  DEFAULT_STANDING_GROUND_Y_RATIO,
  DEFAULT_STANDING_LEFT_X_RATIO,
  DEFAULT_STANDING_RIGHT_X_RATIO,
  LAYER_LAYOUT_ACTION_LABELS,
  layoutActionMinimumSelection,
  planLayerLayout,
  type Layer,
  type LayerLayoutAction,
  type LayerLayoutPlanResult,
  type NegativeGapStrategy,
  type Project,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { layoutPreviewStore } from '../../stores/layoutPreviewStore';
import { timelineUiStore } from '../timeline/timelineUiStore';

interface PreviewState {
  readonly action: LayerLayoutAction;
  readonly revision: number;
  readonly shotId: string;
  readonly timeMs: number;
  readonly autoKey: boolean;
  readonly selectionKey: string;
  readonly plan: LayerLayoutPlanResult;
}

const ALIGN_BUTTONS: ReadonlyArray<{
  readonly action: LayerLayoutAction;
  readonly label: string;
  readonly icon: typeof AlignStartVertical;
}> = [
  { action: 'align-left', label: '左对齐', icon: AlignStartVertical },
  { action: 'align-center-x', label: '水平居中', icon: AlignCenterVertical },
  { action: 'align-right', label: '右对齐', icon: AlignEndVertical },
  { action: 'align-top', label: '顶对齐', icon: AlignStartHorizontal },
  { action: 'align-center-y', label: '垂直居中', icon: AlignCenterHorizontal },
  { action: 'align-bottom', label: '底对齐', icon: AlignEndHorizontal },
];

export function BatchLayoutControls({
  snapshot,
  shotId,
  selectedLayers,
  onApply,
}: {
  snapshot: EditorProjectSnapshot;
  shotId: string;
  selectedLayers: readonly Layer[];
  onApply: (label: string, edit: (project: Project) => Project) => void;
}): React.JSX.Element {
  const timelineUi = useSyncExternalStore(
    timelineUiStore.subscribe,
    timelineUiStore.getSnapshot,
  );
  const [referenceLayerId, setReferenceLayerId] = useState<string>('');
  const [negativeGapStrategy, setNegativeGapStrategy] =
    useState<NegativeGapStrategy>('center-distribute');
  const [groundYPercent, setGroundYPercent] = useState<number>(
    Math.round(DEFAULT_STANDING_GROUND_Y_RATIO * 100),
  );
  const [leftXPercent, setLeftXPercent] = useState<number>(
    Math.round(DEFAULT_STANDING_LEFT_X_RATIO * 100),
  );
  const [rightXPercent, setRightXPercent] = useState<number>(
    Math.round(DEFAULT_STANDING_RIGHT_X_RATIO * 100),
  );
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const selectedIds = selectedLayers.map((layer) => layer.id);
  const selectionKey = selectedIds.join(',');
  const effectiveReferenceId =
    referenceLayerId && selectedIds.includes(referenceLayerId)
      ? referenceLayerId
      : '';

  const activePreview =
    preview &&
    preview.revision === snapshot.revision &&
    preview.shotId === shotId &&
    preview.timeMs === timelineUi.currentTimeMs &&
    preview.autoKey === timelineUi.layerMotionAutoKey &&
    preview.selectionKey === selectionKey
      ? preview
      : null;

  useEffect(() => {
    if (
      activePreview &&
      activePreview.plan.ok &&
      activePreview.plan.candidateProject
    ) {
      layoutPreviewStore.setPreview(
        shotId,
        activePreview.timeMs,
        LAYER_LAYOUT_ACTION_LABELS[activePreview.action],
        activePreview.plan.candidateProject,
      );
    } else {
      layoutPreviewStore.clear();
    }
  }, [activePreview, shotId]);

  useEffect(() => () => layoutPreviewStore.clear(), []);

  function runPreview(
    action: LayerLayoutAction,
    overrides?: {
      negativeGapStrategy?: NegativeGapStrategy;
      groundYPercent?: number;
      leftXPercent?: number;
      rightXPercent?: number;
      referenceId?: string;
    },
  ): void {
    const nextStrategy = overrides?.negativeGapStrategy ?? negativeGapStrategy;
    const nextGround = overrides?.groundYPercent ?? groundYPercent;
    const nextLeft = overrides?.leftXPercent ?? leftXPercent;
    const nextRight = overrides?.rightXPercent ?? rightXPercent;
    const nextRef =
      overrides?.referenceId !== undefined
        ? overrides.referenceId
        : effectiveReferenceId;

    const plan = planLayerLayout(snapshot.project, {
      shotId,
      layerIds: selectedIds,
      action,
      timeMs: timelineUi.currentTimeMs,
      autoKey: timelineUi.layerMotionAutoKey,
      referenceLayerId: nextRef || null,
      negativeGapStrategy: nextStrategy,
      standingOptions: {
        groundYRatio: nextGround / 100,
        leftXRatio: nextLeft / 100,
        rightXRatio: nextRight / 100,
      },
    });

    setPreview({
      action,
      revision: snapshot.revision,
      shotId,
      timeMs: timelineUi.currentTimeMs,
      autoKey: timelineUi.layerMotionAutoKey,
      selectionKey,
      plan,
    });
  }

  function handleCommit(): void {
    if (!activePreview?.plan.ok || !activePreview.plan.candidateProject) return;
    const candidate = activePreview.plan.candidateProject;
    const label = `排列图层：${LAYER_LAYOUT_ACTION_LABELS[activePreview.action]}`;
    layoutPreviewStore.clear();
    setPreview(null);
    onApply(label, () => candidate);
  }

  function handleCancel(): void {
    layoutPreviewStore.clear();
    setPreview(null);
  }

  const isStandingPreview = activePreview?.action === 'standing-layout';
  const isDistributePreview =
    activePreview?.action === 'distribute-horizontal' ||
    activePreview?.action === 'distribute-vertical';

  return (
    <div data-testid="batch-layout-controls">
      {selectedLayers.length >= 2 ? (
        <label>
          参照
          <select
            aria-label="排列参照对象"
            value={effectiveReferenceId}
            onChange={(event) => {
              const nextRef = event.target.value;
              setReferenceLayerId(nextRef);
              if (activePreview) {
                runPreview(activePreview.action, { referenceId: nextRef });
              }
            }}
          >
            <option value="">选区整体</option>
            {selectedLayers.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
                {layer.locked ? '（已锁定）' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="layer-order-actions" role="group" aria-label="六向对齐">
        {ALIGN_BUTTONS.map(({ action, label, icon: Icon }) => (
          <button
            key={action}
            type="button"
            aria-pressed={activePreview?.action === action}
            disabled={selectedLayers.length < layoutActionMinimumSelection(action)}
            onClick={() => runPreview(action)}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="layer-order-actions" role="group" aria-label="均分、等高与站位">
        <button
          type="button"
          aria-pressed={activePreview?.action === 'distribute-horizontal'}
          disabled={selectedLayers.length < 3}
          onClick={() => runPreview('distribute-horizontal')}
        >
          <AlignHorizontalSpaceBetween size={14} aria-hidden="true" />
          <span>水平均分</span>
        </button>
        <button
          type="button"
          aria-pressed={activePreview?.action === 'distribute-vertical'}
          disabled={selectedLayers.length < 3}
          onClick={() => runPreview('distribute-vertical')}
        >
          <AlignVerticalSpaceBetween size={14} aria-hidden="true" />
          <span>垂直均分</span>
        </button>
        <button
          type="button"
          aria-pressed={activePreview?.action === 'match-height'}
          disabled={selectedLayers.length < 2}
          onClick={() => runPreview('match-height')}
        >
          <MoveVertical size={14} aria-hidden="true" />
          <span>等高</span>
        </button>
        <button
          type="button"
          aria-pressed={activePreview?.action === 'standing-layout'}
          disabled={selectedLayers.length < 1}
          onClick={() => runPreview('standing-layout')}
        >
          <Users size={14} aria-hidden="true" />
          <span>落地站位</span>
        </button>
      </div>

      {isDistributePreview && activePreview.plan.negativeGapDetected ? (
        <div className="layer-order-actions" role="group" aria-label="空间不足策略">
          <button
            type="button"
            aria-pressed={negativeGapStrategy === 'center-distribute'}
            onClick={() => {
              setNegativeGapStrategy('center-distribute');
              runPreview(activePreview.action, {
                negativeGapStrategy: 'center-distribute',
              });
            }}
          >
            中心等分
          </button>
          <button
            type="button"
            aria-pressed={negativeGapStrategy === 'expand'}
            onClick={() => {
              setNegativeGapStrategy('expand');
              runPreview(activePreview.action, {
                negativeGapStrategy: 'expand',
              });
            }}
          >
            向外扩展
          </button>
        </div>
      ) : null}

      {isStandingPreview ? (
        <div className="layer-order-actions" role="group" aria-label="站位参数">
          <label>
            地线%
            <input
              type="number"
              min={10}
              max={95}
              step={1}
              value={groundYPercent}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                setGroundYPercent(value);
                runPreview('standing-layout', { groundYPercent: value });
              }}
            />
          </label>
          <label>
            左%
            <input
              type="number"
              min={10}
              max={90}
              step={1}
              value={leftXPercent}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                setLeftXPercent(value);
                runPreview('standing-layout', { leftXPercent: value });
              }}
            />
          </label>
          <label>
            右%
            <input
              type="number"
              min={10}
              max={90}
              step={1}
              value={rightXPercent}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                setRightXPercent(value);
                runPreview('standing-layout', { rightXPercent: value });
              }}
            />
          </label>
        </div>
      ) : null}

      {activePreview ? (
        <div data-testid="batch-layout-preview-bar">
          {activePreview.plan.ok ? (
            <div className="layer-order-actions">
              <button
                type="button"
                disabled={activePreview.plan.changedCount === 0}
                onClick={handleCommit}
              >
                应用{LAYER_LAYOUT_ACTION_LABELS[activePreview.action]}（
                {activePreview.plan.changedCount}）
              </button>
              <button type="button" onClick={handleCancel}>
                取消预览
              </button>
            </div>
          ) : (
            <p role="alert">{activePreview.plan.error}</p>
          )}
          {activePreview.plan.skipped.length > 0 ? (
            <p role="status">
              {activePreview.plan.skipped.map((item) => item.message).join(' ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
