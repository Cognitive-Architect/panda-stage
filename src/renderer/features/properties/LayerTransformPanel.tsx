import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import {
  LAYER_MAX_SCALE,
  LAYER_MIN_SCALE,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  type LayerTransformInput,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';

export interface LayerTransformDraft {
  x: string;
  y: string;
  scale: string;
  rotationDeg: string;
  opacity: string;
}

export type CommitTransformDraftResult =
  | 'committed'
  | 'noop'
  | 'invalid'
  | 'locked';

export interface LayerTransformPanelProps {
  /** The RightInspector owns this identity when the panel is mounted there. */
  backgroundLayerSelected?: boolean;
  /** Compact portrait presentation keeps the existing draft/commit contract. */
  compact?: boolean;
  /** Landscape contextual inspector exposes the real neutral-transform action. */
  showResetTransform?: boolean;
  /** Keep layer locking in the landscape 图层 section. */
  showLockControl?: boolean;
}

export function canRunTransformAction(
  result: CommitTransformDraftResult,
): boolean {
  return result === 'committed' || result === 'noop';
}

export function parseLayerTransformDraft(
  draft: LayerTransformDraft,
  flipX: boolean,
): LayerTransformInput {
  const entries = Object.entries(draft);
  if (entries.some(([, value]) => !value.trim())) {
    throw new Error('变换数值不能为空。');
  }
  const values = Object.fromEntries(
    entries.map(([key, value]) => [key, Number(value)]),
  ) as Record<keyof LayerTransformDraft, number>;
  if (Object.values(values).some((value) => !Number.isFinite(value))) {
    throw new Error('变换数值必须是有限数字。');
  }
  if (
    values.scale < LAYER_MIN_SCALE ||
    values.scale > LAYER_MAX_SCALE
  ) {
    throw new Error(
      `缩放必须在 ${LAYER_MIN_SCALE}–${LAYER_MAX_SCALE} 之间。`,
    );
  }
  if (values.opacity < 0 || values.opacity > 1) {
    throw new Error('不透明度必须在 0–1 之间。');
  }
  return {
    x: values.x,
    y: values.y,
    scale: values.scale,
    rotationDeg: values.rotationDeg,
    opacity: values.opacity,
    flipX,
  };
}

export function shouldCommitTransformBlur(
  contains: (target: EventTarget) => boolean,
  relatedTarget: EventTarget | null,
): boolean {
  return relatedTarget === null || !contains(relatedTarget);
}

const EMPTY_DRAFT: LayerTransformDraft = {
  x: '',
  y: '',
  scale: '',
  rotationDeg: '',
  opacity: '',
};

export function LayerTransformPanel({
  backgroundLayerSelected,
  compact = false,
  showResetTransform = false,
  showLockControl = true,
}: LayerTransformPanelProps = {}): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const shotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const selectedLayerId = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
  );
  const shot =
    snapshot?.project.shots.find((candidate) => candidate.id === shotId) ??
    null;
  const layer =
    shot?.layers.find((candidate) => candidate.id === selectedLayerId) ?? null;
  const isBackgroundLayer =
    Boolean(backgroundLayerSelected) ||
    Boolean(shot && layer && shot.backgroundLayerId === layer.id);
  const [draft, setDraft] = useState<LayerTransformDraft>(EMPTY_DRAFT);
  const [status, setStatus] = useState(
    compact ? '' : '选择普通图层后可编辑中心位置与静态变换。',
  );
  const formRef = useRef<HTMLFormElement>(null);
  const preserveCommitErrorRef = useRef(false);
  const draftVersionRef = useRef(0);
  const lastCommittedRef = useRef<{
    layerId: string;
    draftVersion: number;
  } | null>(null);

  useEffect(() => {
    setDraft(
      layer
        ? {
            x: String(layer.x),
            y: String(layer.y),
            scale: String(layer.scaleX),
            rotationDeg: String(layer.rotationDeg),
            opacity: String(layer.opacity),
          }
        : EMPTY_DRAFT,
    );
    if (layer) {
      preserveCommitErrorRef.current = false;
      setStatus(compact ? '' : layer.locked
        ? '图层已锁定；请先解锁再修改。'
        : 'X/Y 始终表示视觉中心；缩放保持等比。');
      if (isBackgroundLayer) {
        setStatus(compact ? '' : layer.locked
          ? 'Formal background is locked; unlock it before editing.'
          : 'Formal background is editable; lock it again when finished.');
      }
    } else if (!preserveCommitErrorRef.current) {
      setStatus(compact ? '' : '选择普通图层后可编辑中心位置与静态变换。');
    }
  }, [compact, isBackgroundLayer, layer]);

  const updateDraft = (
    key: keyof LayerTransformDraft,
    value: string,
  ): void => {
    draftVersionRef.current += 1;
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const commitPendingDraft = (
    reason: 'action' | 'blur' | 'submit',
  ): CommitTransformDraftResult => {
    if (!layer) return 'invalid';
    if (layer.locked) {
      setStatus('图层已锁定；属性草稿未提交。');
      return 'locked';
    }
    const commitIdentity = {
      layerId: layer.id,
      draftVersion: draftVersionRef.current,
    };
    if (
      lastCommittedRef.current?.layerId === commitIdentity.layerId &&
      lastCommittedRef.current.draftVersion ===
        commitIdentity.draftVersion
    ) {
      return 'noop';
    }
    try {
      const transform = parseLayerTransformDraft(draft, layer.flipX);
      const revisionBefore =
        editorProjectStore.getSnapshot()?.revision ?? null;
      layerStore.updateTransform(layer.id, transform);
      const revisionAfter =
        editorProjectStore.getSnapshot()?.revision ?? null;
      lastCommittedRef.current = commitIdentity;
      preserveCommitErrorRef.current = false;
      const result =
        revisionAfter === revisionBefore ? 'noop' : 'committed';
      setStatus(
        result === 'noop'
          ? '属性值未变化，未新增历史。'
          : reason === 'blur'
            ? '图层变换已在离开属性表单时写入项目。'
            : reason === 'submit'
              ? '图层变换已通过表单提交写入项目。'
              : '图层变换已在执行图层动作前写入项目。',
      );
      return result;
    } catch (error) {
      preserveCommitErrorRef.current = true;
      setStatus(
        error instanceof Error ? error.message : '图层变换失败。',
      );
      return 'invalid';
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    commitPendingDraft('submit');
  };

  const resetTransform = (): void => {
    if (!layer || layer.locked || isBackgroundLayer) return;
    try {
      layerStore.updateTransform(layer.id, {
        x: PROJECT_WIDTH / 2,
        y: PROJECT_HEIGHT / 2,
        scale: 1,
        rotationDeg: 0,
        opacity: 1,
        flipX: false,
      });
      setStatus('变换已重置到画布中心与中性状态。');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : '变换重置失败。',
      );
    }
  };

  const commitDraftRef = useRef(commitPendingDraft);
  commitDraftRef.current = commitPendingDraft;

  useEffect(() => {
    const onFocusOut = (event: FocusEvent): void => {
      const form = formRef.current;
      if (
        !form ||
        !shouldCommitTransformBlur(
          (target) => form.contains(target as Node),
          event.relatedTarget,
        )
      ) {
        return;
      }
      commitDraftRef.current('blur');
    };
    const onMouseDown = (event: MouseEvent): void => {
      // Konva can clear selection during this click, so commit while the
      // focused form still owns its draft.
      const form = formRef.current;
      const activeElement = document.activeElement;
      const target = event.target;
      if (
        form &&
        activeElement instanceof Node &&
        form.contains(activeElement) &&
        target instanceof Node &&
        !form.contains(target)
      ) {
        commitDraftRef.current('blur');
      }
    };
    const form = formRef.current;
    form?.addEventListener('focusout', onFocusOut);
    document.addEventListener('mousedown', onMouseDown, true);
    return () => {
      form?.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [layer?.id]);

  return (
    <section
      className="layer-transform-panel"
      data-background-protected={String(isBackgroundLayer)}
      data-compact={String(compact)}
      data-selected-layer-id={selectedLayerId ?? ''}
      data-testid="layer-transform-panel"
    >
      <div className="layer-transform-panel-heading">
        <p className="eyebrow">图层变换</p>
        <h3>图层变换</h3>
      </div>
      {layer ? (
        <form onSubmit={submit} ref={formRef}>
          <strong>{layer.name}</strong>
          {(
            [
              ['x', 'X（中心）'],
              ['y', 'Y（中心）'],
              ['scale', '等比缩放'],
              ['rotationDeg', '旋转（°）'],
              ['opacity', '不透明度'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                disabled={layer.locked}
                inputMode="decimal"
                onChange={(event) =>
                  updateDraft(key, event.target.value)
                }
                value={draft[key]}
              />
            </label>
          ))}
          {showResetTransform ? (
            <button
              data-testid="layer-transform-reset"
              disabled={layer.locked || isBackgroundLayer}
              onClick={resetTransform}
              type="button"
            >
              重置变换
            </button>
          ) : null}
          <button
            disabled={layer.locked}
            onClick={() => {
              if (
                !canRunTransformAction(
                  commitPendingDraft('action'),
                )
              ) {
                return;
              }
              try {
                layerStore.toggleFlipX(layer.id);
                setStatus('水平翻转已切换，中心坐标保持不变。');
              } catch (error) {
                setStatus(
                  error instanceof Error
                    ? error.message
                    : '水平翻转失败。',
                );
              }
            }}
            type="button"
          >
            {layer.flipX ? '取消水平翻转' : '水平翻转'}
          </button>
          {showLockControl ? (
            <label className="layer-lock-control">
              <input
                checked={layer.locked}
                onChange={(event) => {
                  const shouldLock = event.target.checked;
                  if (
                    shouldLock &&
                    !canRunTransformAction(
                      commitPendingDraft('action'),
                    )
                  ) {
                    return;
                  }
                  try {
                    layerStore.setLocked(layer.id, shouldLock);
                  } catch (error) {
                    setStatus(
                      error instanceof Error
                        ? error.message
                        : '锁定状态更新失败。',
                    );
                  }
                }}
                type="checkbox"
              />
              锁定图层
            </label>
          ) : null}
          <button disabled={layer.locked} type="submit">
            应用变换
          </button>
        </form>
      ) : (
        <p>
          {compact ? '请在画布中选择一个对象。' : '未选择普通图层。'}
        </p>
      )}
      {layer || !compact ? (
        <p data-testid="layer-transform-guidance">
          {isBackgroundLayer
            ? layer?.locked
              ? '正式背景已锁定，请先解锁后再编辑。'
              : '正式背景可编辑，完成后请重新锁定。'
            : layer?.locked
              ? '请先解锁图层，再修改变换。'
              : layer
                ? compact
                  ? 'X/Y 是视觉中心；离开字段或提交即可保存。'
                  : 'X/Y 表示视觉中心，缩放保持等比。'
                : '请在画布中选择图层以编辑变换。'}
        </p>
      ) : null}
      <output data-testid="layer-transform-status">{status}</output>
    </section>
  );
}
