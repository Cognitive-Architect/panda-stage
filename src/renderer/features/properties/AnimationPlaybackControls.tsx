import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';

export interface AnimationStartEditContext {
  projectInstanceId: number | null;
  projectId: string;
  projectRoot: string;
  shotId: string;
  layerId: string;
  revision: number;
  startTimeMs: number;
  shotDurationMs: number;
  locked: boolean;
}

export function sameAnimationStartEditContext(
  original: AnimationStartEditContext | null,
  current: AnimationStartEditContext | null,
): boolean {
  return Boolean(
    original &&
      current &&
      original.projectInstanceId === current.projectInstanceId &&
      original.projectId === current.projectId &&
      original.projectRoot === current.projectRoot &&
      original.shotId === current.shotId &&
      original.layerId === current.layerId &&
      original.revision === current.revision &&
      original.startTimeMs === current.startTimeMs &&
      original.shotDurationMs === current.shotDurationMs &&
      original.locked === current.locked,
  );
}

export type ParsedAnimationStartTime =
  | { kind: 'valid'; startTimeMs: number }
  | { kind: 'invalid'; message: string };

export function parseAnimationStartTime(
  value: string,
  shotDurationMs: number,
): ParsedAnimationStartTime {
  if (!value.trim()) {
    return { kind: 'invalid', message: '请输入动画开始时间。' };
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return {
      kind: 'invalid',
      message: '开始时间必须是 0 或更大的有效数字。',
    };
  }
  const rawStartTimeMs = seconds * 1_000;
  if (rawStartTimeMs > shotDurationMs) {
    return {
      kind: 'invalid',
      message: `开始时间不能超过当前镜头时长（${formatStartSeconds(shotDurationMs)} 秒）。`,
    };
  }
  const startTimeMs = Math.round(rawStartTimeMs);
  if (startTimeMs > shotDurationMs) {
    return {
      kind: 'invalid',
      message: `开始时间不能超过当前镜头时长（${formatStartSeconds(shotDurationMs)} 秒）。`,
    };
  }
  return { kind: 'valid', startTimeMs };
}

function formatStartSeconds(startTimeMs: number): string {
  return String(Number((startTimeMs / 1_000).toFixed(3)));
}

function currentAnimationStartEditContext(): AnimationStartEditContext | null {
  const snapshot = editorProjectStore.getSnapshot();
  const shotId = shotStore.getCurrentShotId();
  const layerId = selectionStore.getSelectedLayerId();
  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === shotId,
  );
  const layer = shot?.layers.find((candidate) => candidate.id === layerId);
  if (
    !snapshot ||
    !shot ||
    !layer ||
    layer.source.kind !== 'animation' ||
    !layer.animationPlayback
  ) {
    return null;
  }
  return {
    projectInstanceId: editorProjectStore.getProjectInstanceId(),
    projectId: snapshot.project.id,
    projectRoot: snapshot.projectRoot,
    shotId: shot.id,
    layerId: layer.id,
    revision: snapshot.revision,
    startTimeMs: layer.startTimeMs ?? 0,
    shotDurationMs: shot.durationMs,
    locked: layer.locked,
  };
}

export function AnimationPlaybackControls(): React.JSX.Element | null {
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

  const startTimeMs = layer?.source.kind === 'animation'
    ? layer.startTimeMs ?? 0
    : 0;
  const projectInstanceId = editorProjectStore.getProjectInstanceId();
  const [startDraft, setStartDraft] = useState(() =>
    formatStartSeconds(startTimeMs),
  );
  const [status, setStatus] = useState('');
  const activeStartEditRef = useRef<{
    id: number;
    context: AnimationStartEditContext;
  } | null>(null);
  const nextStartEditIdRef = useRef(0);
  const cancelOnBlurIdRef = useRef<number | null>(null);

  useEffect(() => {
    const activeEdit = activeStartEditRef.current;
    const currentContext = currentAnimationStartEditContext();
    const discardedStaleDraft =
      activeEdit !== null &&
      !sameAnimationStartEditContext(activeEdit.context, currentContext);
    activeStartEditRef.current = null;
    cancelOnBlurIdRef.current = null;
    setStartDraft(formatStartSeconds(startTimeMs));
    setStatus(
      discardedStaleDraft && currentContext
        ? currentContext.locked
          ? '动画图层已锁定，开始时间草稿已取消。'
          : '工程状态已变化，开始时间草稿已取消，请重新编辑。'
        : '',
    );
  }, [
    layer?.id,
    layer?.locked,
    projectInstanceId,
    snapshot?.project.id,
    snapshot?.projectRoot,
    snapshot?.revision,
    shot?.durationMs,
    shot?.id,
    startTimeMs,
  ]);

  if (
    !snapshot ||
    !shot ||
    !layer ||
    layer.source.kind !== 'animation' ||
    !layer.animationPlayback
  ) {
    return null;
  }

  const assertCurrentSelection = (): void => {
    const currentSnapshot = editorProjectStore.getSnapshot();
    if (
      currentSnapshot?.project.id !== snapshot.project.id ||
      currentSnapshot.projectRoot !== snapshot.projectRoot ||
      editorProjectStore.getProjectInstanceId() !== projectInstanceId ||
      shotStore.getCurrentShotId() !== shot.id ||
      selectionStore.getSelectedLayerId() !== layer.id
    ) {
      throw new Error('工程或图层已切换，请重新选择动画图层后再修改。');
    }
  };

  const updatePlayback = (input: {
    startTimeMs?: number;
    mode?: 'once' | 'loop';
    endBehavior?: 'hold' | 'hide';
  }): boolean => {
    try {
      assertCurrentSelection();
      layerStore.updateAnimationPlayback(layer.id, input);
      setStatus('');
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '动画播放设置未能更新。');
      return false;
    }
  };

  const commitStartTime = (): void => {
    const activeEdit = activeStartEditRef.current;
    if (!activeEdit) return;
    if (cancelOnBlurIdRef.current === activeEdit.id) {
      activeStartEditRef.current = null;
      cancelOnBlurIdRef.current = null;
      return;
    }
    activeStartEditRef.current = null;
    cancelOnBlurIdRef.current = null;

    const currentContext = currentAnimationStartEditContext();
    const savedStartTimeMs = currentContext?.startTimeMs ?? startTimeMs;
    if (currentContext?.locked) {
      setStartDraft(formatStartSeconds(savedStartTimeMs));
      setStatus('动画图层已锁定，开始时间草稿已取消。');
      return;
    }
    if (!sameAnimationStartEditContext(activeEdit.context, currentContext)) {
      setStartDraft(formatStartSeconds(savedStartTimeMs));
      setStatus(currentContext ? '工程状态已变化，开始时间草稿已取消，请重新编辑。' : '');
      return;
    }

    const parsed = parseAnimationStartTime(startDraft, activeEdit.context.shotDurationMs);
    if (parsed.kind === 'invalid') {
      setStartDraft(formatStartSeconds(savedStartTimeMs));
      setStatus(parsed.message);
      return;
    }
    if (parsed.startTimeMs === activeEdit.context.startTimeMs) {
      setStartDraft(formatStartSeconds(savedStartTimeMs));
      setStatus('');
      return;
    }

    if (!updatePlayback({ startTimeMs: parsed.startTimeMs })) {
      const latestContext = currentAnimationStartEditContext();
      setStartDraft(
        formatStartSeconds(latestContext?.startTimeMs ?? savedStartTimeMs),
      );
    }
  };

  const beginStartEdit = (): void => {
    const context = currentAnimationStartEditContext();
    activeStartEditRef.current = context
      ? { id: ++nextStartEditIdRef.current, context }
      : null;
    cancelOnBlurIdRef.current = null;
  };

  const changeStartDraft = (value: string): void => {
    const context = currentAnimationStartEditContext();
    const activeEdit = activeStartEditRef.current;
    if (activeEdit && !sameAnimationStartEditContext(activeEdit.context, context)) {
      activeStartEditRef.current = null;
      cancelOnBlurIdRef.current = null;
      setStartDraft(formatStartSeconds(context?.startTimeMs ?? startTimeMs));
      setStatus(context ? '工程状态已变化，开始时间草稿已取消，请重新编辑。' : '');
      return;
    }
    if (!activeEdit) {
      if (!context || context.locked) return;
      activeStartEditRef.current = {
        id: ++nextStartEditIdRef.current,
        context,
      };
    }
    setStartDraft(value);
    setStatus('');
  };

  const cancelStartEdit = (input: HTMLInputElement): void => {
    const currentContext = currentAnimationStartEditContext();
    const activeEdit = activeStartEditRef.current;
    cancelOnBlurIdRef.current = activeEdit?.id ?? null;
    setStartDraft(
      formatStartSeconds(currentContext?.startTimeMs ?? startTimeMs),
    );
    setStatus('');
    input.blur();
  };

  const locked = layer.locked;
  return (
    <section
      aria-label="动画播放设置"
      className="animation-playback-controls"
      data-testid="animation-playback-controls"
    >
      <h3>动画播放</h3>
      <div className="animation-playback-fields">
        <label>
          <span>开始时间（秒）</span>
          <input
            aria-label="动画开始时间（秒）"
            data-testid="animation-start-seconds"
            disabled={locked}
            max={shot.durationMs / 1_000}
            min={0}
            onBlur={commitStartTime}
            onChange={(event) => changeStartDraft(event.target.value)}
            onFocus={beginStartEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancelStartEdit(event.currentTarget);
              }
            }}
            step="0.001"
            type="number"
            value={startDraft}
          />
        </label>
        <label>
          <span>播放方式</span>
          <select
            aria-label="动画播放方式"
            data-testid="animation-playback-mode"
            disabled={locked}
            onChange={(event) =>
              updatePlayback({ mode: event.target.value as 'once' | 'loop' })
            }
            value={layer.animationPlayback.mode}
          >
            <option value="once">单次</option>
            <option value="loop">循环</option>
          </select>
        </label>
        {layer.animationPlayback.mode === 'once' ? (
          <label>
            <span>播放结束</span>
            <select
              aria-label="动画播放结束"
              data-testid="animation-end-behavior"
              disabled={locked}
              onChange={(event) =>
                updatePlayback({
                  endBehavior: event.target.value as 'hold' | 'hide',
                })
              }
              value={layer.animationPlayback.endBehavior}
            >
              <option value="hold">保持最后一帧</option>
              <option value="hide">隐藏</option>
            </select>
          </label>
        ) : null}
      </div>
      {status ? <output role="alert">{status}</output> : null}
    </section>
  );
}
