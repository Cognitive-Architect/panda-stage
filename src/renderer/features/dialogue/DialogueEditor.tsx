import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  clampTime,
  snapToFrame,
} from '../timeline/timeGeometry';
import { layoutSubtitleText } from '../../../shared/preview/subtitle-layout';
import type { Character } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { dialogueStore } from '../../stores/dialogueStore';

export function DialogueEditor({
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
  const audioAssets = useMemo(
    () =>
      snapshot?.project.assets.filter(
        (asset) => asset.kind === 'audio',
      ) ?? [],
    [snapshot?.project.assets],
  );
  const attachedAudioAssetId = dialogue?.audioClipId
    ? shot?.audioClips.find((clip) => clip.id === dialogue.audioClipId)?.assetId ?? ''
    : '';
  const [text, setText] = useState(dialogue?.text ?? '');
  const [startMs, setStartMs] = useState(String(dialogue?.startMs ?? 0));
  const [endMs, setEndMs] = useState(String(dialogue?.endMs ?? 0));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(dialogue?.text ?? '');
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

  const character = characters.find(
    (candidate) => candidate.id === dialogue.characterId,
  );
  const subtitleStyle = snapshot?.project.subtitleStyles.find(
    (style) => style.id === dialogue.subtitleStyleId,
  );
  const subtitleWarning = layoutSubtitleText(
    dialogue.text,
    subtitleStyle ?? {
      fontSize: 44,
      maxWidth: 1_420,
    },
  ).warning;
  const commitTiming = (): void => {
    const rawStart = Number(startMs);
    const rawEnd = Number(endMs);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
      setError('开始和结束时间必须是整数毫秒。');
      return;
    }
    try {
      const nextStart = clampTime(snapToFrame(Math.round(rawStart)), shot.durationMs);
      const nextEnd = clampTime(snapToFrame(Math.round(rawEnd)), shot.durationMs);
      dialogueStore.setTiming(dialogue.id, nextStart, nextEnd);
      setStartMs(String(nextStart));
      setEndMs(String(nextEnd));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '对白时间段无效。');
    }
  };

  const commitText = (): void => {
    const next = text.trim();
    if (!next) {
      setText(dialogue.text);
      setError('对白文本不能为空。');
      return;
    }
    if (next !== dialogue.text) {
      try {
        dialogueStore.update(dialogue.id, { text: next });
        setError(null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '对白文本无效。');
      }
    }
  };

  const commitAudio = (assetId: string): void => {
    try {
      if (!assetId) dialogueStore.detachAudio(dialogue.id);
      else dialogueStore.attachAudio(dialogue.id, assetId);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '音频绑定失败。');
    }
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
            onChange={(event) => {
              try {
                dialogueStore.update(dialogue.id, {
                  characterId: event.target.value,
                });
                setError(null);
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : '角色无效。');
              }
            }}
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
          <span>台词（500 字以内）</span>
          <textarea
            data-testid="dialogue-inspector-text"
            value={text}
            rows={4}
            onChange={(event) => setText(event.target.value)}
            onBlur={commitText}
          />
        </label>
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
        <label className="dialogue-field">
          <span>字幕样式</span>
          <select
            data-testid="dialogue-inspector-style"
            value={dialogue.subtitleStyleId}
            onChange={(event) => {
              try {
                dialogueStore.setStyle(dialogue.id, event.target.value);
                setError(null);
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : '字幕样式无效。');
              }
            }}
          >
            {snapshot?.project.subtitleStyles.map((style) => (
              <option key={style.id} value={style.id}>
                {style.name}
              </option>
            ))}
          </select>
        </label>
        <label className="dialogue-field">
          <span>音频（不拉伸）</span>
          <select
            data-testid="dialogue-inspector-audio"
            value={attachedAudioAssetId}
            onChange={(event) => commitAudio(event.target.value)}
          >
            <option value="">不绑定音频</option>
            {audioAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}{asset.durationMs ? `（${asset.durationMs}ms）` : '（未探测时长）'}
              </option>
            ))}
          </select>
        </label>
        {error ? (
          <p className="dialogue-editor-error" data-testid="dialogue-editor-error" role="alert">
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
          时间段：{dialogue.startMs}–{dialogue.endMs}ms（24 FPS 整数毫秒）
        </p>
      </div>
    </>
  );
}
