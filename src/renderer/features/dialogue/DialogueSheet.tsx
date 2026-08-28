import {
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { ArrowLeft, Plus, X } from 'lucide-react';
import type { Character, Dialogue } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { dialogueSelectionStore } from '../../stores/dialogueSelectionStore';
import { dialogueStore } from '../../stores/dialogueStore';
import {
  DIALOGUE_AUTHORING_TEXT_MAX_LENGTH,
  DialogueAuthoringDraft,
  validateSingleDialogueDraft,
} from './dialogueAuthoringDraft';
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
export type DialogueAuthoringMode = 'none' | 'single' | 'batch';

export interface DialogueUiState {
  authoringMode: DialogueAuthoringMode;
  selectedDialogueState: DialogueSelectionState;
}

export type DialogueUiEvent =
  | { type: 'select'; dialogueState: Exclude<DialogueSelectionState, 'none'> }
  | { type: 'clear-selection' }
  | { type: 'open-authoring'; mode: Exclude<DialogueAuthoringMode, 'none'> }
  | { type: 'close-authoring' };

/**
 * The portrait subtitle workflow has exactly one visible mode. Selection
 * interrupts authoring; opening authoring clears selection; closing either
 * returns to the stable default state.
 */
export function transitionDialogueUiState(
  state: DialogueUiState,
  event: DialogueUiEvent,
): DialogueUiState {
  switch (event.type) {
    case 'select':
      return {
        authoringMode: 'none',
        selectedDialogueState: event.dialogueState,
      };
    case 'clear-selection':
      return { ...state, selectedDialogueState: 'none' };
    case 'open-authoring':
      return {
        authoringMode: event.mode,
        selectedDialogueState: 'none',
      };
    case 'close-authoring':
      return { authoringMode: 'none', selectedDialogueState: 'none' };
  }
}

export type DialogueSheetState =
  | 'timeline-default'
  | 'timeline-untimed-selected'
  | 'timeline-timed-selected'
  | 'timeline-bulk-paste-open'
  | 'timeline-single-add-open';

export function getDialogueSheetState(input: {
  authoringMode: DialogueAuthoringMode;
  selectedDialogueState: DialogueSelectionState;
}): DialogueSheetState {
  if (input.authoringMode === 'batch') return 'timeline-bulk-paste-open';
  if (input.authoringMode === 'single') return 'timeline-single-add-open';
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
  const [authoringMode, setAuthoringMode] =
    useState<DialogueAuthoringMode>('none');
  const draftState = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const [singleTouched, setSingleTouched] = useState({
    speaker: false,
    text: false,
  });
  const [singleSubmitError, setSingleSubmitError] = useState<string | null>(
    null,
  );
  const [queueError, setQueueError] = useState<{
    dialogueId: string;
    message: string;
  } | null>(null);

  const projectRoot = snapshot?.projectRoot ?? '';
  const shotId = currentShotId ?? null;
  useEffect(() => {
    draft.bindIdentity({ projectRoot, shotId });
    setAuthoringMode('none');
    setSingleTouched({ speaker: false, text: false });
    setSingleSubmitError(null);
  }, [draft, projectRoot, shotId]);

  useEffect(() => {
    if (selectedDialogueId === null) return;
    if (authoringMode !== 'none') draft.clear();
    setAuthoringMode('none');
    setSingleTouched({ speaker: false, text: false });
    setSingleSubmitError(null);
  }, [authoringMode, draft, selectedDialogueId]);

  useEffect(() => {
    if (authoringMode === 'none') return undefined;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      draft.clear();
      dialogueSelectionStore.clear();
      setAuthoringMode('none');
      setSingleTouched({ speaker: false, text: false });
      setSingleSubmitError(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [authoringMode, draft]);

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
  const singleErrors = validateSingleDialogueDraft(
    draftState,
    characters.map((character) => character.id),
  );
  const canAdd = singleErrors.speaker === null && singleErrors.text === null;

  if (!shot) {
    return (
      <div className="dialogue-sheet" data-testid="dialogue-sheet">
        <p>请选择一个镜头以编辑对白。</p>
      </div>
    );
  }

  const handleAdd = (): void => {
    setSingleTouched({ speaker: true, text: true });
    if (!canAdd) return;
    try {
      dialogueStore.create(
        draftState.singleCharacterId,
        draftState.singleText.trim(),
      );
      draft.clear();
      dialogueSelectionStore.clear();
      setAuthoringMode('none');
      setSingleTouched({ speaker: false, text: false });
      setSingleSubmitError(null);
    } catch (nextError) {
      setSingleSubmitError(
        nextError instanceof Error ? nextError.message : '新增字幕失败。',
      );
    }
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

  const handleSelectDialogue = (dialogueId: string): void => {
    if (authoringMode !== 'none') draft.clear();
    setAuthoringMode('none');
    setSingleTouched({ speaker: false, text: false });
    setSingleSubmitError(null);
    dialogueSelectionStore.toggle(dialogueId);
  };

  const handleOpenAuthoring = (
    mode: Exclude<DialogueAuthoringMode, 'none'>,
  ): void => {
    if (authoringMode === 'none') {
      draft.clear();
      setSingleTouched({ speaker: false, text: false });
      setSingleSubmitError(null);
    }
    dialogueSelectionStore.clear();
    setAuthoringMode(mode);
  };

  const handleCloseAuthoring = (): void => {
    draft.clear();
    dialogueSelectionStore.clear();
    setAuthoringMode('none');
    setSingleTouched({ speaker: false, text: false });
    setSingleSubmitError(null);
  };

  const handleAuthoringTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextMode = authoringMode === 'single' ? 'batch' : 'single';
    handleOpenAuthoring(nextMode);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          `[data-testid="dialogue-authoring-tab-${nextMode}"]`,
        )
        ?.focus();
    });
  };

  const characterName = (id: string): string =>
    characters.find((candidate) => candidate.id === id)?.name ?? id;

  const selectedDialogueState: DialogueSelectionState = selectedTimedDialogue
    ? 'timed'
    : selectedUntimedDialogue
      ? 'untimed'
      : 'none';
  const timelineState = getDialogueSheetState({
    authoringMode,
    selectedDialogueState,
  });
  const showTimedEditor = timelineState === 'timeline-timed-selected';
  const subtitleState = showTimedEditor
    ? 'selected-timed'
    : timelineState === 'timeline-untimed-selected'
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
      {authoringMode === 'none' ? (
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
          <div className="dialogue-sheet-header-actions">
            {showTimedEditor ? (
              <button
                type="button"
                className="dialogue-secondary-action dialogue-timed-back"
                data-testid="dialogue-timed-back"
                onClick={() => dialogueSelectionStore.clear()}
              >
                <ArrowLeft aria-hidden="true" focusable="false" size={16} />
                返回待安排字幕
              </button>
            ) : null}
            <button
              type="button"
              className="dialogue-secondary-action dialogue-authoring-open"
              data-testid="dialogue-authoring-open"
              onClick={() => handleOpenAuthoring('single')}
            >
              <Plus aria-hidden="true" focusable="false" size={16} />
              <span>新建字幕</span>
            </button>
          </div>
        </header>
      ) : (
        <section
          aria-labelledby="dialogue-authoring-title"
          className="dialogue-authoring-shell"
          data-mode={authoringMode}
          data-testid="dialogue-authoring-shell"
        >
          <header className="dialogue-authoring-header">
            <div>
              <p className="eyebrow">字幕任务</p>
              <h3 id="dialogue-authoring-title">新建字幕</h3>
              <p>创建新的未定时字幕或批量导入。</p>
            </div>
            <button
              aria-label="关闭新建字幕"
              className="dialogue-authoring-close"
              data-testid="dialogue-authoring-close"
              type="button"
              onClick={handleCloseAuthoring}
            >
              <X aria-hidden="true" size={20} strokeWidth={2} />
            </button>
          </header>

          <div
            aria-label="新建字幕方式"
            className="dialogue-authoring-tabs"
            role="tablist"
          >
            <button
              aria-controls="dialogue-authoring-panel-single"
              aria-selected={authoringMode === 'single'}
              className="dialogue-authoring-tab"
              data-testid="dialogue-authoring-tab-single"
              id="dialogue-authoring-tab-single"
              role="tab"
              tabIndex={authoringMode === 'single' ? 0 : -1}
              type="button"
              onClick={() => handleOpenAuthoring('single')}
              onKeyDown={handleAuthoringTabKeyDown}
            >
              单条
            </button>
            <button
              aria-controls="dialogue-authoring-panel-batch"
              aria-selected={authoringMode === 'batch'}
              className="dialogue-authoring-tab"
              data-testid="dialogue-authoring-tab-batch"
              id="dialogue-authoring-tab-batch"
              role="tab"
              tabIndex={authoringMode === 'batch' ? 0 : -1}
              type="button"
              onClick={() => handleOpenAuthoring('batch')}
              onKeyDown={handleAuthoringTabKeyDown}
            >
              批量粘贴
            </button>
          </div>

          {authoringMode === 'single' ? (
            <div
              aria-labelledby="dialogue-authoring-tab-single"
              className="dialogue-authoring-mode dialogue-authoring-single"
              data-testid="dialogue-authoring-single"
              id="dialogue-authoring-panel-single"
              role="tabpanel"
            >
              <section className="dialogue-authoring-section">
                <label htmlFor="dialogue-add-speaker">角色（说话人）</label>
                <select
                  aria-describedby={
                    singleTouched.speaker && singleErrors.speaker
                      ? 'dialogue-add-speaker-error'
                      : undefined
                  }
                  aria-invalid={Boolean(
                    singleTouched.speaker && singleErrors.speaker,
                  )}
                  data-testid="dialogue-add-speaker"
                  id="dialogue-add-speaker"
                  value={draftState.singleCharacterId}
                  onBlur={() =>
                    setSingleTouched((current) => ({
                      ...current,
                      speaker: true,
                    }))
                  }
                  onChange={(event) => {
                    setSingleSubmitError(null);
                    draft.setSingleCharacterId(event.target.value);
                  }}
                >
                  <option value="">选择现有角色</option>
                  {characters.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
                {singleTouched.speaker && singleErrors.speaker ? (
                  <p
                    className="dialogue-authoring-error"
                    id="dialogue-add-speaker-error"
                    role="alert"
                  >
                    {singleErrors.speaker}
                  </p>
                ) : null}
              </section>

              <section className="dialogue-authoring-section">
                <label htmlFor="dialogue-add-text">
                  台词内容 <span aria-hidden="true">*</span>
                </label>
                <textarea
                  aria-describedby="dialogue-add-text-message dialogue-add-text-count"
                  aria-invalid={Boolean(singleTouched.text && singleErrors.text)}
                  data-testid="dialogue-add-text"
                  id="dialogue-add-text"
                  placeholder="请输入台词内容…"
                  rows={5}
                  value={draftState.singleText}
                  onBlur={() =>
                    setSingleTouched((current) => ({
                      ...current,
                      text: true,
                    }))
                  }
                  onChange={(event) => {
                    setSingleSubmitError(null);
                    draft.setSingleText(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      (event.ctrlKey || event.metaKey)
                    ) {
                      event.preventDefault();
                      handleAdd();
                    }
                  }}
                />
                <div className="dialogue-authoring-field-meta">
                  <span id="dialogue-add-text-message">
                    {singleTouched.text && singleErrors.text
                      ? singleErrors.text
                      : '普通 Enter 换行，Ctrl/Cmd + Enter 提交'}
                  </span>
                  <output id="dialogue-add-text-count">
                    {`${draftState.singleText.length} / ${DIALOGUE_AUTHORING_TEXT_MAX_LENGTH}`}
                  </output>
                </div>
              </section>

              <section className="dialogue-authoring-section dialogue-authoring-placement">
                <div>
                  <h4>创建位置</h4>
                  <p>将在当前播放头处创建未定时字幕。</p>
                </div>
                <div>
                  <span>当前播放头</span>
                  <output
                    data-current-time={timelineUi.currentTimeMs}
                    data-testid="dialogue-authoring-playhead"
                  >
                    {formatTimecode(timelineUi.currentTimeMs)}
                  </output>
                </div>
              </section>

              {singleSubmitError ? (
                <p className="dialogue-authoring-error" role="alert">
                  {singleSubmitError}
                </p>
              ) : null}

              <footer className="dialogue-authoring-footer">
                <button
                  className="dialogue-authoring-cancel"
                  data-testid="dialogue-authoring-cancel"
                  type="button"
                  onClick={handleCloseAuthoring}
                >
                  取消
                </button>
                <button
                  className="dialogue-authoring-submit"
                  data-testid="dialogue-add"
                  disabled={!canAdd}
                  type="button"
                  onClick={handleAdd}
                >
                  新增字幕
                </button>
              </footer>
            </div>
          ) : (
            <DialogueBatchPaste
              draft={draft}
              onCancel={handleCloseAuthoring}
              onSuccess={handleCloseAuthoring}
            />
          )}
        </section>
      )}

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
          ) : authoringMode !== 'none' ? (
            <h4 className="dialogue-authoring-queue-heading">待安排字幕</h4>
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
                    onClick={() => handleSelectDialogue(dialogue.id)}
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

    </div>
  );
}
