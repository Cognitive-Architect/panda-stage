import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Character } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { dialogueStore } from '../../stores/dialogueStore';

/**
 * Editor for the currently selected dialogue. Rendered inside the single
 * RightInspector when a dialogue is selected; the layer/background inspector is
 * shown otherwise. The speaker is committed immediately on change; the textarea
 * commits on blur so a single edit is one History command rather than one per
 * keystroke.
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

  const [text, setText] = useState(dialogue?.text ?? '');
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setText(dialogue?.text ?? '');
  }, [dialogue?.text]);

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

  const handleSpeaker = (characterId: string): void => {
    if (characterId !== dialogue.characterId) {
      dialogueStore.update(dialogueId, { characterId });
    }
  };
  const handleTextChange = (next: string): void => setText(next);
  const handleTextBlur = (): void => {
    focusedRef.current = false;
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setText(dialogue.text);
      return;
    }
    if (trimmed !== dialogue.text) {
      dialogueStore.update(dialogueId, { text: trimmed });
    } else {
      setText(dialogue.text);
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
          {`已选择对白：${character?.name ?? dialogue.characterId}`}
        </span>
      </section>
      <div className="dialogue-inspector" data-testid="dialogue-inspector">
        <label className="dialogue-field">
          <span>角色（说话人）</span>
          <select
            data-testid="dialogue-inspector-speaker"
            value={dialogue.characterId}
            onChange={(event) => handleSpeaker(event.target.value)}
          >
            {characters.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label className="dialogue-field">
          <span>台词</span>
          <textarea
            data-testid="dialogue-inspector-text"
            value={text}
            rows={4}
            onChange={(event) => handleTextChange(event.target.value)}
            onFocus={() => {
              focusedRef.current = true;
            }}
            onBlur={handleTextBlur}
          />
        </label>
        <button
          type="button"
          className="dialogue-delete"
          data-testid="dialogue-inspector-delete"
          onClick={() => dialogueStore.remove(dialogueId)}
        >
          删除对白
        </button>
        <p className="dialogue-point-time">
          {`时间点：${dialogue.startMs}ms（来自时间轴播放头）`}
        </p>
      </div>
    </>
  );
}
