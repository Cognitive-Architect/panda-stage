import { useEffect, useState, useSyncExternalStore } from 'react';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';

function formatStartSeconds(startTimeMs: number): string {
  return String(Number((startTimeMs / 1_000).toFixed(3)));
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
  const [startDraft, setStartDraft] = useState(() =>
    formatStartSeconds(startTimeMs),
  );
  const [status, setStatus] = useState('');

  useEffect(() => {
    setStartDraft(formatStartSeconds(startTimeMs));
    setStatus('');
  }, [layer?.id, shot?.id, startTimeMs]);

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
  }): void => {
    try {
      assertCurrentSelection();
      layerStore.updateAnimationPlayback(layer.id, input);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '动画播放设置未能更新。');
    }
  };

  const commitStartTime = (): void => {
    if (!startDraft.trim()) {
      setStatus('请输入动画开始时间。');
      setStartDraft(formatStartSeconds(layer.startTimeMs ?? 0));
      return;
    }
    const seconds = Number(startDraft);
    if (!Number.isFinite(seconds) || seconds < 0) {
      setStatus('开始时间必须是 0 或更大的有效数字。');
      setStartDraft(formatStartSeconds(layer.startTimeMs ?? 0));
      return;
    }
    updatePlayback({ startTimeMs: Math.round(seconds * 1_000) });
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
            onChange={(event) => setStartDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setStartDraft(formatStartSeconds(layer.startTimeMs ?? 0));
                event.currentTarget.blur();
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
