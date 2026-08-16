import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Character } from '../../../domain';
import { layoutSubtitleText } from '../../../shared/preview/subtitle-layout';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { dialogueStore } from '../../stores/dialogueStore';
import { shotStore } from '../../stores/shotStore';
import {
  clampTime,
  integerFrameSpanMs,
  snapToFrame,
} from '../timeline/timeGeometry';

/**
 * The existing single RightInspector owner, extended only with Day28 timing.
 * Text still commits on blur; timing and Untimed arrangement are explicit,
 * one-command actions.
 */
export function DialogueInspector({
  dialogueId,
}: {
  dialogueId: string;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  );
  const dialogue = shot?.dialogues.find(
    (candidate) => candidate.id === dialogueId,
  );
  const characters: readonly Character[] = snapshot?.project.characters ?? [];
  const character = characters.find(
    (candidate) => candidate.id === dialogue?.characterId,
  );
  const subtitleStyle = snapshot?.project.subtitleStyles.find(
    (style) => style.id === dialogue?.subtitleStyleId,
  );

  const [text, setText] = useState(dialogue?.text ?? '');
  const [startMs, setStartMs] = useState(String(dialogue?.startMs ?? 0));
  const [endMs, setEndMs] = useState(String(dialogue?.endMs ?? 0));
  const [error, setError] = useState<string | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(dialogue?.text ?? '');
    setStartMs(String(dialogue?.startMs ?? 0));
    setEndMs(String(dialogue?.endMs ?? 0));
    setError(null);
  }, [dialogue?.id, dialogue?.text, dialogue?.startMs, dialogue?.endMs]);

  if (!shot || !dialogue) {
    return (
      <div className="right-inspector-heading">
        <div>
          <p className="eyebrow">右侧检查器</p>
          <h2 id="right-inspector-heading">对白检查器</h2>
        </div>
        <span>当前镜头</span>
      </div>
    );
  }

  const timed = dialogue.endMs > dialogue.startMs;
  const subtitleWarning = layoutSubtitleText(
    dialogue.text,
    subtitleStyle ?? { fontSize: 44, maxWidth: 1_420 },
  ).warning;

  const report = (action: () => void, fallback: string): void => {
    try {
      action();
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : fallback);
    }
  };

  const commitText = (): void => {
    focusedRef.current = false;
    const trimmed = text.trim();
    if (!trimmed) {
      setText(dialogue.text);
      setError('对白文本不能为空。');
      return;
    }
    if (trimmed !== dialogue.text) {
      report(
        () => dialogueStore.update(dialogue.id, { text: trimmed }),
        '对白文本无效。',
      );
    } else {
      setText(dialogue.text);
    }
  };

  const commitTiming = (): void => {
    const rawStart = Number(startMs);
    const rawEnd = Number(endMs);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
      setError('开始和结束时间必须是整数毫秒。');
      return;
    }
    const nextStart = clampTime(
      snapToFrame(Math.round(rawStart)),
      shot.durationMs,
    );
    const nextEnd = clampTime(
      snapToFrame(Math.round(rawEnd)),
      shot.durationMs,
    );
    report(() => {
      dialogueStore.setTiming(dialogue.id, nextStart, nextEnd);
      setStartMs(String(nextStart));
      setEndMs(String(nextEnd));
    }, '对白时间段无效。');
  };

  return (
    <>
      <div className="right-inspector-heading">
        <div>
          <p className="eyebrow">右侧检查器</p>
          <h2 id="right-inspector-heading">对白检查器</h2>
        </div>
        <span>当前镜头</span>
      </div>
      <section
        aria-live="polite"
        className="right-inspector-selection"
        data-selection-state="dialogue"
        data-testid="right-inspector-selection"
      >
        <p className="eyebrow">当前选择</p>
        <strong>{character?.name ?? '未知角色'}</strong>
        <span data-testid="right-inspector-selection-message">
          已选择对白：{character?.name ?? dialogue.characterId}
        </span>
      </section>
      <div className="dialogue-inspector" data-testid="dialogue-inspector">
        <label className="dialogue-field">
          <span>角色（说话人）</span>
          <select
            data-testid="dialogue-inspector-speaker"
            value={dialogue.characterId}
            onChange={(event) =>
              report(
                () =>
                  dialogueStore.update(dialogue.id, {
                    characterId: event.target.value,
                  }),
                '角色无效。',
              )
            }
          >
            {characters.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        {subtitleWarning ? (
          <p
            className="dialogue-editor-error"
            data-testid="dialogue-subtitle-warning"
            role="status"
          >
            {subtitleWarning}
          </p>
        ) : null}
        <label className="dialogue-field">
          <span>台词</span>
          <textarea
            data-testid="dialogue-inspector-text"
            value={text}
            rows={4}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => {
              focusedRef.current = true;
            }}
            onBlur={commitText}
          />
        </label>
        {timed ? (
          <div className="dialogue-timing-fields">
            <label className="dialogue-field">
              <span>开始（ms）</span>
              <input
                data-testid="dialogue-inspector-start"
                inputMode="numeric"
                min={0}
                onChange={(event) => setStartMs(event.target.value)}
                type="number"
                value={startMs}
              />
            </label>
            <label className="dialogue-field">
              <span>结束（ms）</span>
              <input
                data-testid="dialogue-inspector-end"
                inputMode="numeric"
                min={0}
                onChange={(event) => setEndMs(event.target.value)}
                type="number"
                value={endMs}
              />
            </label>
            <button
              data-testid="dialogue-inspector-apply-timing"
              onClick={commitTiming}
              type="button"
            >
              应用时间
            </button>
          </div>
        ) : (
          <button
            className="dialogue-arrange"
            data-testid="dialogue-inspector-arrange"
            onClick={() =>
              report(
                () =>
                  dialogueStore.arrange(
                    dialogue.id,
                    integerFrameSpanMs(),
                  ),
                '未定时对白安排失败。',
              )
            }
            type="button"
          >
            安排为一帧
          </button>
        )}
        {error ? (
          <p
            className="dialogue-editor-error"
            data-testid="dialogue-editor-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="dialogue-delete"
          data-testid="dialogue-inspector-delete"
          onClick={() => dialogueStore.remove(dialogue.id)}
        >
          删除对白
        </button>
        <p className="dialogue-point-time">
          {timed
            ? `时间段：${dialogue.startMs}–${dialogue.endMs}ms`
            : `未定时：${dialogue.startMs}ms（选择“安排为一帧”后才产生字幕窗口）`}
        </p>
      </div>
    </>
  );
}
