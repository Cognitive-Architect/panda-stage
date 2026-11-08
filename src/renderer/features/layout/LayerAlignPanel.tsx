import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  LAYOUT_ACTION_LABELS,
  LAYOUT_ALIGN_ACTIONS,
  describeLayoutBlock,
  layoutActionRequiresReference,
  listLayoutTargets,
  planLayerLayout,
  type LayoutAlignAction,
  type LayoutLayerTransform,
} from '../../../domain';
import { Button } from '../../ui';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { layerLayoutPreviewStore } from '../../stores/layerLayoutPreviewStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { useTimelineUi } from '../timeline/timelineUiStore';

const TIMELINE_BASE_NOTICE = '时间轴预览中 · 回到 0:00 可使用对齐与均分';

/**
 * EF-02 V0: one shot-scoped align/distribute page. The panel owns a local
 * selection set and a runtime-only preview; the formal commit happens once
 * through the Layer store, so one Undo restores the whole arrangement.
 */
export function LayerAlignPanel(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const { currentTimeMs } = useTimelineUi();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [action, setAction] = useState<LayoutAlignAction>('align-left');
  const [referenceLayerId, setReferenceLayerId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const initialized = useRef(false);

  const shot =
    snapshot?.project.shots.find(
      (candidate) => candidate.id === currentShotId,
    ) ?? null;
  const options = useMemo(
    () =>
      snapshot && shot ? listLayoutTargets(snapshot.project, shot) : [],
    [shot, snapshot],
  );

  // Prefill once per opening from the current canvas selection; the canvas
  // selection stays single-Layer and is never rewritten by this panel.
  useEffect(() => {
    if (initialized.current || !shot) return;
    initialized.current = true;
    const selected = selectionStore.getSelectedLayerId();
    if (selected && options.some((option) => option.layerId === selected)) {
      setSelectedIds([selected]);
      setReferenceLayerId(selected);
    }
  }, [options, shot]);

  // A deleted, retyped, or undone Layer must not stay in the local set.
  useEffect(() => {
    setSelectedIds((current) => {
      const kept = current.filter((layerId) =>
        options.some((option) => option.layerId === layerId),
      );
      return kept.length === current.length ? current : kept;
    });
  }, [options]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  useEffect(() => {
    if (referenceLayerId && !selectedIdSet.has(referenceLayerId)) {
      setReferenceLayerId(null);
    }
  }, [referenceLayerId, selectedIdSet]);

  const needsReference = layoutActionRequiresReference(action);
  const resolvedReferenceId = useMemo(() => {
    if (!needsReference) return null;
    if (referenceLayerId && selectedIdSet.has(referenceLayerId)) {
      return referenceLayerId;
    }
    const canvasSelected = selectionStore.getSelectedLayerId();
    if (canvasSelected && selectedIdSet.has(canvasSelected)) {
      return canvasSelected;
    }
    return selectedIds[0] ?? null;
  }, [needsReference, referenceLayerId, selectedIdSet, selectedIds]);

  const atTimelineBase = currentTimeMs === 0;
  const plan = useMemo(
    () =>
      snapshot && shot
        ? planLayerLayout(snapshot.project, shot, {
            action,
            layerIds: selectedIds,
            referenceLayerId: resolvedReferenceId,
          })
        : null,
    [action, resolvedReferenceId, selectedIds, shot, snapshot],
  );

  useEffect(() => {
    if (plan?.ok && atTimelineBase) {
      layerLayoutPreviewStore.show(
        new Map<string, LayoutLayerTransform>(
          plan.plan.transforms.map((transform) => [
            transform.layerId,
            transform,
          ]),
        ),
      );
      return;
    }
    layerLayoutPreviewStore.clear();
  }, [atTimelineBase, plan]);

  useEffect(() => () => layerLayoutPreviewStore.clear(), []);

  const notice = !atTimelineBase
    ? TIMELINE_BASE_NOTICE
    : (message ?? (plan && !plan.ok ? plan.message : null));
  const canApply = atTimelineBase && plan?.ok === true;

  const toggle = (layerId: string, checked: boolean): void => {
    setMessage(null);
    setSelectedIds((current) =>
      checked
        ? current.includes(layerId)
          ? current
          : [...current, layerId]
        : current.filter((candidate) => candidate !== layerId),
    );
  };

  const apply = (): void => {
    if (!snapshot || !shot) return;
    const current = planLayerLayout(snapshot.project, shot, {
      action,
      layerIds: selectedIds,
      referenceLayerId: resolvedReferenceId,
    });
    if (!current.ok) {
      setMessage(current.message);
      return;
    }
    try {
      const next = layerStore.applyLayoutTransforms(
        current.plan.transforms,
        'Arrange layers',
      );
      layerLayoutPreviewStore.clear();
      setMessage(next === snapshot.project ? '已经排列好了。' : '已应用排列。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '排列失败，请重试。');
    }
  };

  return (
    <section
      aria-label="对齐与均分"
      className="layer-align"
      data-layer-align-action={action}
      data-layer-align-ready={String(canApply)}
      data-testid="layer-align-panel"
    >
      <ul className="layer-align-list">
        {options.map((option) => {
          const reason = option.blocked
            ? describeLayoutBlock(option.name, option.blocked)
            : null;
          return (
            <li
              className="layer-align-item"
              data-layer-align-layer={option.layerId}
              key={option.layerId}
            >
              <label>
                <input
                  checked={selectedIdSet.has(option.layerId)}
                  disabled={Boolean(reason)}
                  onChange={(event) =>
                    toggle(option.layerId, event.target.checked)
                  }
                  type="checkbox"
                />
                <span>{option.label}</span>
              </label>
              {reason ? (
                <p
                  className="layer-align-item-reason"
                  data-testid={`layer-align-reason-${option.layerId}`}
                >
                  {reason}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="layer-align-actions" role="group" aria-label="排列动作">
        {LAYOUT_ALIGN_ACTIONS.map((candidate) => (
          <Button
            aria-pressed={candidate === action}
            className="layer-align-action"
            data-action={candidate}
            data-testid={`layer-align-action-${candidate}`}
            key={candidate}
            onClick={() => {
              setAction(candidate);
              setMessage(null);
            }}
            variant={candidate === action ? 'primary' : 'secondary'}
          >
            {LAYOUT_ACTION_LABELS[candidate]}
          </Button>
        ))}
      </div>

      {needsReference && selectedIds.length >= 2 ? (
        <div className="layer-align-reference">
          <label htmlFor="layer-align-reference">参照</label>
          <select
            className="layer-align-select"
            data-testid="layer-align-reference"
            id="layer-align-reference"
            onChange={(event) => {
              setReferenceLayerId(event.target.value || null);
              setMessage(null);
            }}
            value={resolvedReferenceId ?? ''}
          >
            {selectedIds.map((layerId) => {
              const option = options.find(
                (candidate) => candidate.layerId === layerId,
              );
              return (
                <option key={layerId} value={layerId}>
                  {option?.label ?? layerId}
                </option>
              );
            })}
          </select>
        </div>
      ) : null}

      {notice ? (
        <p
          className="layer-align-notice"
          data-testid="layer-align-notice"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <Button
        className="layer-align-apply"
        data-testid="layer-align-apply"
        disabled={!canApply}
        onClick={apply}
        variant="primary"
      >
        应用排列
      </Button>
    </section>
  );
}
