import {
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Character, Dialogue } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { dialogueSelectionStore } from '../../stores/dialogueSelectionStore';
import { dialogueStore } from '../../stores/dialogueStore';
import { DialogueAuthoringDraft } from './dialogueAuthoringDraft';
import { DialogueBatchPaste } from './DialogueBatchPaste';
import { DialogueInspector } from './DialogueInspector';
import { useTimelineUi } from '../timeline/timelineUiStore';
import { formatTimecode, integerFrameSpanMs } from '../timeline/timeGeometry';

/** Keep the Timeline presentation on the same timed/untimed truth as the
 * DialogueClip and DialogueInspector owners. */
export function isTimedDialogue(
  dialogue: Pick<Dialogue, 'startMs' | 'endMs'>,
): boolean {
  return dialogue.endMs > dialogue.startMs;
}

export type DialogueSelectionState = 'none' | 'untimed' | 'timed';

export type DialogueSheetState =
  | 'timeline-default'
  | 'timeline-untimed-selected'
  | 'timeline-timed-selected'
  | 'timeline-bulk-paste-open'
  | 'timeline-single-add-open';

export function getDialogueSheetState(input: {
  selectedDialogueState: DialogueSelectionState;
  batchOpen: boolean;
  singleAddOpen: boolean;
}): DialogueSheetState {
  if (input.batchOpen) return 'timeline-bulk-paste-open';
  if (input.singleAddOpen) return 'timeline-single-add-open';
  if (input.selectedDialogueState === 'timed') return 'timeline-timed-selected';
  if (input.selectedDialogueState === 'untimed') {
    return 'timeline-untimed-selected';
  }
  return 'timeline-default';
}

/**
 * Dialogue Sheet: the lower task surface of the single Timeline owner. It
 * shows either the existing timed-dialogue editor, the existing untimed queue,
 * or a compact empty state. Authoring inputs still live in one draft bound to
 * the (projectRoot, shotId) identity, so a Shot A draft can never be committed
 * into Shot B.
 */
export function DialogueSheet(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const selectedDialogueId = useSyncExternalStore(
    dialogueSelectionStore.subscribe,
    dialogueSelectionStore.getSelectedDialogueId,
  );
  const timelineUi = useTimelineUi();
  const [draft] = useState(() => new DialogueAuthoringDraft());
  const [singleAddOpen, setSingleAddOpen] = useState(false);
  const draftState = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const [queueError, setQueueError] = useState<{
    dialogueId: string;
    message: string;
  } | null>(null);

  const projectRoot = snapshot?.projectRoot ?? '';
  const shotId = currentShotId ?? null;
  useEffect(() => {
    draft.bindIdentity({ projectRoot, shotId });
    setSingleAddOpen(false);
  }, [draft, projectRoot, shotId]);

  useEffect(() => {
    setQueueError(null);
  }, [currentShotId, selectedDialogueId]);

  const characters: readonly Character[] = snapshot?.project.characters ?? [];
  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  );
  const dialogues = shot?.dialogues ?? [];
  const selectedDialogue = dialogues.find(
    (dialogue) => dialogue.id === selectedDialogueId,
  );
  const selectedTimedDialogue =
    selectedDialogue && isTimedDialogue(selectedDialogue)
      ? selectedDialogue
      : undefined;
  const selectedUntimedDialogue =
    selectedDialogue && !isTimedDialogue(selectedDialogue)
      ? selectedDialogue
      : undefined;
  const untimedDialogues = dialogues.filter(
    (dialogue) => !isTimedDialogue(dialogue),
  );
  const canAdd =
    draftState.singleCharacterId !== '' &&
    draftState.singleText.trim().length > 0;

  if (!shot) {
    return (
      <div className="dialogue-sheet" data-testid="dialogue-sheet">
        <p>请选择一个镜头以编辑对白。</p>
      </div>
    );
  }

  const handleAdd = (): void => {
    if (!canAdd) return;
    dialogueStore.create(
      draftState.singleCharacterId,
      draftState.singleText.trim(),
    );
    draft.setSingleText('');
  };

  const handleArrange = (dialogueId: string): void => {
    try {
      // Reuse the existing one-frame arrangement path. This is intentionally
      // not a new scheduler or a "nearest free slot" algorithm.
      dialogueStore.arrange(dialogueId, integerFrameSpanMs());
      setQueueError(null);
    } catch (nextError) {
      setQueueError(
        {
          dialogueId,
          message:
            nextError instanceof Error ? nextError.message : '字幕安排失败。',
        },
      );
    }
  };

  const characterName = (id: string): string =>
    characters.find((candidate) => candidate.id === id)?.name ?? id;

  const selectedDialogueState: DialogueSelectionState = selectedTimedDialogue
    ? 'timed'
    : selectedUntimedDialogue
      ? 'untimed'
      : 'none';
  const timelineState = getDialogueSheetState({
    batchOpen: draftState.batchOpen,
    selectedDialogueState,
    singleAddOpen,
  });
  const showTimedEditor = timelineState === 'timeline-timed-selected';
  const subtitleState = showTimedEditor
    ? 'selected-timed'
    : selectedUntimedDialogue
      ? 'untimed-selected'
      : untimedDialogues.length > 0
        ? 'untimed-queue'
        : 'empty';
  const showInlineActions = timelineState === 'timeline-untimed-selected';

  return (
    <div
      className="dialogue-sheet dialogue-sheet-timeline"
      data-state={timelineState}
      data-subtitle-state={subtitleState}
      data-timeline-state={timelineState}
      data-testid="dialogue-sheet"
    >
      <header
        className={`dialogue-sheet-header${
          showTimedEditor ? ' dialogue-sheet-header-timed' : ''
        }`}
      >
        {!showTimedEditor ? (
          <div className="dialogue-sheet-heading">
            <p className="eyebrow">字幕任务</p>
            <h3>
              {untimedDialogues.length > 0 ? (
                <>
                  待安排字幕{' '}
                  <span
                    className="dialogue-untimed-count"
                    data-testid="dialogue-untimed-count"
                  >
                    {untimedDialogues.length} 条
                  </span>
                </>
              ) : (
                '暂无待安排字幕'
              )}
            </h3>
          </div>
        ) : null}
        <button
          aria-expanded={draftState.batchOpen}
          type="button"
          className="dialogue-secondary-action"
          data-testid="dialogue-batch-open"
          onClick={() => draft.openBatch()}
        >
          批量粘贴
        </button>
      </header>

      {showTimedEditor && selectedTimedDialogue ? (
        <section
          className="timeline-subtitle-editor"
          data-state="selected-timed"
          data-testid="timeline-subtitle-editor"
        >
          <DialogueInspector
            dialogueId={selectedTimedDialogue.id}
            presentation="timeline"
          />
        </section>
      ) : untimedDialogues.length > 0 ? (
        <section
          className="timeline-subtitle-queue"
          data-testid="timeline-subtitle-queue"
        >
          {timelineState === 'timeline-default' ? (
            <p className="timeline-subtitle-queue-intro">
              这些台词还没有安排到时间轴上。
            </p>
          ) : null}
          <ul className="dialogue-untimed-queue">
            {untimedDialogues.map((dialogue) => {
              const selected = dialogue.id === selectedDialogueId;
              return (
                <li
                  className={`dialogue-untimed-item${
                    selected ? ' selected' : ''
                  }`}
                  data-dialogue-id={dialogue.id}
                  data-selected={String(selected)}
                  data-testid="dialogue-untimed-item"
                  key={dialogue.id}
                >
                  <button
                    aria-label={`选择字幕：${characterName(dialogue.characterId)}：${dialogue.text}`}
                    aria-pressed={selected}
                    type="button"
                    className="dialogue-untimed-select"
                    data-testid="dialogue-untimed-select"
                    onClick={() => dialogueSelectionStore.select(dialogue.id)}
                  >
                    <span className="dialogue-untimed-speaker">
                      {characterName(dialogue.characterId)}
                    </span>
                    <span className="dialogue-untimed-text">
                      {dialogue.text}
                    </span>
                    <span className="dialogue-untimed-status">
                      未定时
                    </span>
                    <span
                      aria-hidden="true"
                      className="dialogue-untimed-affordance"
                    >
                      {selected ? '✓' : '›'}
                    </span>
                  </button>
                  {selected && showInlineActions ? (
                    <div
                      className="dialogue-untimed-action-strip"
                      data-dialogue-id={dialogue.id}
                      data-testid="dialogue-untimed-action-strip"
                    >
                      <div className="dialogue-untimed-action-meta">
                        <span className="dialogue-untimed-playhead-label">
                          当前播放头
                        </span>
                        <output
                          aria-label={`当前播放头 ${formatTimecode(timelineUi.currentTimeMs)}`}
                          aria-live="polite"
                          className="dialogue-untimed-playhead-time"
                          data-current-time={timelineUi.currentTimeMs}
                          data-testid="dialogue-untimed-playhead"
                        >
                          {formatTimecode(timelineUi.currentTimeMs)}
                        </output>
                      </div>
                      <div className="dialogue-untimed-action-buttons">
                        <button
                          type="button"
                          className="dialogue-untimed-arrange"
                          aria-label={`安排一帧：${characterName(dialogue.characterId)}：${dialogue.text}`}
                          data-dialogue-id={dialogue.id}
                          data-testid="dialogue-untimed-arrange"
                          onClick={() => handleArrange(dialogue.id)}
                        >
                          安排一帧
                        </button>
                        <button
                          type="button"
                          className="dialogue-untimed-cancel"
                          data-dialogue-id={dialogue.id}
                          data-testid="dialogue-untimed-cancel"
                          onClick={() => {
                            setQueueError(null);
                            dialogueSelectionStore.clear();
                          }}
                        >
                          取消选择
                        </button>
                      </div>
                      {queueError?.dialogueId === dialogue.id ? (
                        <p
                          className="dialogue-editor-error dialogue-untimed-error"
                          data-testid="dialogue-untimed-error"
                          role="alert"
                        >
                          {queueError.message}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <div
          className="timeline-subtitle-empty"
          data-testid="timeline-subtitle-empty"
        >
          <strong>暂无待安排字幕</strong>
          <span>点击下方入口添加字幕，或从时间轴选择已有字幕。</span>
        </div>
      )}

      <details
        className="dialogue-secondary-tools dialogue-add-disclosure"
        data-open={String(singleAddOpen)}
        data-testid="dialogue-add-disclosure"
        open={singleAddOpen}
        onToggle={(event) => setSingleAddOpen(event.currentTarget.open)}
      >
        <summary>+ 添加单条字幕</summary>
        <div className="dialogue-secondary-tools-body">
          <div className="dialogue-add">
            <select
              aria-label="字幕角色"
              data-testid="dialogue-add-speaker"
              value={draftState.singleCharacterId}
              onChange={(event) =>
                draft.setSingleCharacterId(event.target.value)
              }
            >
              <option value="">选择角色</option>
              {characters.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
            <input
              aria-label="字幕台词"
              data-testid="dialogue-add-text"
              value={draftState.singleText}
              placeholder="输入台词"
              onChange={(event) => draft.setSingleText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canAdd) handleAdd();
              }}
            />
            <button
              type="button"
              data-testid="dialogue-add"
              disabled={!canAdd}
              onClick={handleAdd}
            >
              新增
            </button>
          </div>
        </div>
      </details>

      {draftState.batchOpen ? (
        <DialogueBatchPaste draft={draft} onClose={() => draft.closeBatch()} />
      ) : null}
    </div>
  );
}
