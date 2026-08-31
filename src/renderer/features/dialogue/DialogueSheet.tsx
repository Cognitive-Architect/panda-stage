import {
  useCallback,
  useEffect,
  useRef,
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
import { isHorizontalPendingTrayGesture } from '../timeline/pendingDialogueDrag';

export { isHorizontalPendingTrayGesture } from '../timeline/pendingDialogueDrag';

/** Keep the Timeline presentation on the same timed/untimed truth as the
 * DialogueClip and DialogueInspector owners. */
export function isTimedDialogue(
  dialogue: Pick<Dialogue, 'startMs' | 'endMs'>,
): boolean {
  return dialogue.endMs > dialogue.startMs;
}

export type DialogueSelectionState = 'none' | 'untimed' | 'timed';
export type DialogueAuthoringMode = 'none' | 'single' | 'batch';

// RightInspector's existing drawer fallback may return focus to its rail at
// 150ms when opening a Task Tray state clears dialogue selection. Run after
// that established transition so the newly active task keeps final focus.
const TASK_TRAY_FOCUS_DELAY_MS = 180;

function isCloudTouchLandscapeTray(element: HTMLElement): boolean {
  return Boolean(
    element.closest(
      ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']",
    ),
  );
}

interface PendingTrayPointerState {
  pointerId: number;
  startX: number;
  startY: number;
  swiping: boolean;
}

export interface PendingTrayInteractionController {
  onPointerDown(
    event: React.PointerEvent<HTMLUListElement>,
    dialogueId: string | null,
  ): void;
  onPointerMove(event: React.PointerEvent<HTMLUListElement>): void;
  onPointerUp(event: React.PointerEvent<HTMLUListElement>): void;
  onPointerCancel(event: React.PointerEvent<HTMLUListElement>): void;
  onClickCapture(event: React.MouseEvent<HTMLUListElement>): void;
}

export interface DialogueSheetProps {
  pendingTrayInteraction?: PendingTrayInteractionController;
  pendingDragDialogueId?: string | null;
  unifiedTaskTray?: boolean;
}

function pendingDialogueIdFromTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const select = target.closest<HTMLElement>(
    '[data-pending-card-select="true"]',
  );
  if (!select) return null;
  return (
    select.closest<HTMLElement>('[data-pending-card="true"]')?.dataset
      .dialogueId ?? null
  );
}

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
  | 'timeline-single-add-open'
  | 'timeline-empty';

export type DialogueTaskTrayState =
  | 'pending'
  | 'untimed-selected'
  | 'timed-selected'
  | 'single-add'
  | 'batch-paste'
  | 'empty';

/**
 * Derive the one visible Task Tray body from existing authoritative truth.
 * This is presentation only: selection, authoring draft, and dialogue data
 * remain owned by their existing stores/classes.
 */
export function getDialogueTaskTrayState(input: {
  authoringMode: DialogueAuthoringMode;
  selectedDialogueState: DialogueSelectionState;
  pendingCount: number;
}): DialogueTaskTrayState {
  if (input.authoringMode === 'batch') return 'batch-paste';
  if (input.authoringMode === 'single') return 'single-add';
  if (input.selectedDialogueState === 'timed') return 'timed-selected';
  if (input.selectedDialogueState === 'untimed') return 'untimed-selected';
  return input.pendingCount > 0 ? 'pending' : 'empty';
}

export function getDialogueSheetState(input: {
  authoringMode: DialogueAuthoringMode;
  selectedDialogueState: DialogueSelectionState;
  pendingCount?: number;
}): DialogueSheetState {
  const taskState = getDialogueTaskTrayState({
    ...input,
    // Preserve the pre-Stage-E helper contract for callers that only test
    // selection/authoring precedence and do not provide queue data.
    pendingCount: input.pendingCount ?? 1,
  });
  switch (taskState) {
    case 'batch-paste':
      return 'timeline-bulk-paste-open';
    case 'single-add':
      return 'timeline-single-add-open';
    case 'timed-selected':
      return 'timeline-timed-selected';
    case 'untimed-selected':
      return 'timeline-untimed-selected';
    case 'empty':
      return 'timeline-empty';
    case 'pending':
      return 'timeline-default';
  }
}

/**
 * Dialogue Sheet: the lower task surface of the single Timeline owner. It
 * shows either the existing timed-dialogue editor, the existing untimed queue,
 * or a compact empty state. Authoring inputs still live in one draft bound to
 * the (projectRoot, shotId) identity, so a Shot A draft can never be committed
 * into Shot B.
 */
export function DialogueSheet({
  pendingTrayInteraction,
  pendingDragDialogueId = null,
  unifiedTaskTray = false,
}: DialogueSheetProps = {}): React.JSX.Element {
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
  const taskSheetRef = useRef<HTMLDivElement>(null);
  const pendingTrayPointerRef = useRef<PendingTrayPointerState | null>(null);

  const focusDefaultTaskControl = useCallback((): void => {
    window.setTimeout(() => {
      const sheet = taskSheetRef.current;
      const candidates = [
        sheet?.querySelector<HTMLButtonElement>(
          '[data-testid="dialogue-untimed-select"]',
        ),
        sheet?.querySelector<HTMLButtonElement>(
          '[data-testid="dialogue-authoring-open"]',
        ),
      ];
      const nextControl = candidates.find(
        (candidate) => candidate && candidate.getClientRects().length > 0,
      );
      nextControl?.focus();
    }, TASK_TRAY_FOCUS_DELAY_MS);
  }, []);

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
      focusDefaultTaskControl();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [authoringMode, draft, focusDefaultTaskControl]);

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
      focusDefaultTaskControl();
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
    window.setTimeout(() => {
      const tab = taskSheetRef.current?.querySelector<HTMLButtonElement>(
        `[data-testid="dialogue-authoring-tab-${mode}"]`,
      );
      const close = taskSheetRef.current?.querySelector<HTMLButtonElement>(
        '[data-testid="dialogue-authoring-close"]',
      );
      (tab && tab.getClientRects().length > 0 ? tab : close)?.focus();
    }, TASK_TRAY_FOCUS_DELAY_MS);
  };

  const handleCloseAuthoring = (): void => {
    draft.clear();
    dialogueSelectionStore.clear();
    setAuthoringMode('none');
    setSingleTouched({ speaker: false, text: false });
    setSingleSubmitError(null);
    focusDefaultTaskControl();
  };

  const handleClearSelection = (): void => {
    setQueueError(null);
    dialogueSelectionStore.clear();
    focusDefaultTaskControl();
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

  const handlePendingTrayPointerDown = (
    event: React.PointerEvent<HTMLUListElement>,
  ): void => {
    if (!isCloudTouchLandscapeTray(event.currentTarget)) return;
    if (pendingTrayInteraction) {
      pendingTrayInteraction.onPointerDown(
        event,
        pendingDialogueIdFromTarget(event.target),
      );
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      pendingTrayPointerRef.current = null;
      return;
    }
    pendingTrayPointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      swiping: false,
    };
  };

  const handlePendingTrayPointerMove = (
    event: React.PointerEvent<HTMLUListElement>,
  ): void => {
    if (!isCloudTouchLandscapeTray(event.currentTarget)) return;
    if (pendingTrayInteraction) {
      pendingTrayInteraction.onPointerMove(event);
      return;
    }
    const gesture = pendingTrayPointerRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.swiping) {
      return;
    }
    if (
      isHorizontalPendingTrayGesture(
        gesture.startX,
        gesture.startY,
        event.clientX,
        event.clientY,
      )
    ) {
      gesture.swiping = true;
    }
  };

  const handlePendingTrayPointerUp = (
    event: React.PointerEvent<HTMLUListElement>,
  ): void => {
    if (!isCloudTouchLandscapeTray(event.currentTarget)) return;
    if (pendingTrayInteraction) {
      pendingTrayInteraction.onPointerUp(event);
      return;
    }
    const gesture = pendingTrayPointerRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.swiping) {
      pendingTrayPointerRef.current = null;
      return;
    }

    // Keep the swipe marker through the browser's subsequent click dispatch,
    // then clear it even when the platform emits no click for the swipe.
    const pointerId = gesture.pointerId;
    window.setTimeout(() => {
      if (pendingTrayPointerRef.current?.pointerId === pointerId) {
        pendingTrayPointerRef.current = null;
      }
    }, 0);
  };

  const handlePendingTrayPointerCancel = (
    event: React.PointerEvent<HTMLUListElement>,
  ): void => {
    if (!isCloudTouchLandscapeTray(event.currentTarget)) return;
    if (pendingTrayInteraction) {
      pendingTrayInteraction.onPointerCancel(event);
      return;
    }
    if (pendingTrayPointerRef.current?.pointerId === event.pointerId) {
      pendingTrayPointerRef.current = null;
    }
  };

  const handlePendingTrayClickCapture = (
    event: React.MouseEvent<HTMLUListElement>,
  ): void => {
    if (!isCloudTouchLandscapeTray(event.currentTarget)) return;
    if (pendingTrayInteraction) {
      pendingTrayInteraction.onClickCapture(event);
      return;
    }
    if (!pendingTrayPointerRef.current?.swiping) return;
    event.preventDefault();
    event.stopPropagation();
    pendingTrayPointerRef.current = null;
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
    pendingCount: untimedDialogues.length,
  });
  const taskTrayState = getDialogueTaskTrayState({
    authoringMode,
    selectedDialogueState,
    pendingCount: untimedDialogues.length,
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
  const displayedUntimedDialogues = unifiedTaskTray && selectedUntimedDialogue
    ? [selectedUntimedDialogue]
    : untimedDialogues;

  return (
    <div
      className="dialogue-sheet dialogue-sheet-timeline"
      data-state={timelineState}
      data-subtitle-state={subtitleState}
      data-task-tray-state={taskTrayState}
      data-timeline-state={timelineState}
      data-testid="dialogue-sheet"
      ref={taskSheetRef}
    >
      {authoringMode === 'none' ? (
        <header
          className={`dialogue-sheet-header${
            showTimedEditor ? ' dialogue-sheet-header-timed' : ''
          }`}
        >
          {showTimedEditor && unifiedTaskTray && selectedTimedDialogue ? (
            <div
              aria-live="polite"
              className="dialogue-timed-task-context"
              data-testid="dialogue-timed-task-context"
            >
              <span className="dialogue-timed-task-context-label">
                已安排字幕
              </span>
              <strong data-testid="dialogue-timed-task-identity">
                {characterName(selectedTimedDialogue.characterId)}
              </strong>
              <span
                className="dialogue-timed-status-chip"
                data-testid="dialogue-timed-task-status"
              >
                已定时
              </span>
            </div>
          ) : !showTimedEditor ? (
            <div className="dialogue-sheet-heading">
              <p className="eyebrow">字幕任务</p>
              <h3>
                {unifiedTaskTray && selectedUntimedDialogue ? (
                  <>安排字幕</>
                ) : untimedDialogues.length > 0 ? (
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
                onClick={handleClearSelection}
              >
                <ArrowLeft aria-hidden="true" focusable="false" size={16} />
                返回待安排字幕
              </button>
            ) : null}
            {unifiedTaskTray && selectedUntimedDialogue ? (
              <button
                type="button"
                className="dialogue-secondary-action dialogue-untimed-cancel"
                data-testid="dialogue-untimed-cancel"
                onClick={handleClearSelection}
              >
                <ArrowLeft aria-hidden="true" focusable="false" size={16} />
                返回待安排字幕
              </button>
            ) : null}
            {!unifiedTaskTray ||
            (!selectedUntimedDialogue && !showTimedEditor) ? (
              <button
                type="button"
                className="dialogue-secondary-action dialogue-authoring-open"
                data-testid="dialogue-authoring-open"
                onClick={() => handleOpenAuthoring('single')}
              >
                <Plus aria-hidden="true" focusable="false" size={16} />
                <span>新建字幕</span>
              </button>
            ) : null}
          </div>
        </header>
      ) : (
        <section
          aria-labelledby="dialogue-authoring-title"
          className="dialogue-authoring-shell dialogue-task-body dialogue-task-body-authoring"
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
          className="timeline-subtitle-editor dialogue-task-body dialogue-task-body-timed"
          data-state="selected-timed"
          data-testid="timeline-subtitle-editor"
        >
          <DialogueInspector
            dialogueId={selectedTimedDialogue.id}
            presentation="timeline"
          />
        </section>
      ) : unifiedTaskTray && authoringMode !== 'none' ? null : untimedDialogues.length > 0 ? (
        <section
          className="timeline-subtitle-queue timeline-pending-tray"
          data-pending-count={untimedDialogues.length}
          data-pending-tray="true"
          data-task-body={taskTrayState}
          data-testid="timeline-subtitle-queue"
        >
          {timelineState === 'timeline-default' ? (
            <p className="timeline-subtitle-queue-intro">
              这些台词还没有安排到时间轴上。
            </p>
          ) : authoringMode !== 'none' ? (
            <h4 className="dialogue-authoring-queue-heading">待安排字幕</h4>
          ) : null}
          <ul
            aria-label="待安排字幕列表"
            className="dialogue-untimed-queue dialogue-pending-tray-list"
            data-testid="dialogue-pending-tray-list"
            onClickCapture={handlePendingTrayClickCapture}
            onPointerCancel={handlePendingTrayPointerCancel}
            onPointerDown={handlePendingTrayPointerDown}
            onPointerMove={handlePendingTrayPointerMove}
            onPointerUp={handlePendingTrayPointerUp}
          >
            {displayedUntimedDialogues.map((dialogue) => {
              const selected = dialogue.id === selectedDialogueId;
              return (
                <li
                  className={`dialogue-untimed-item dialogue-pending-card${
                    selected ? ' selected' : ''
                  }${
                    pendingDragDialogueId === dialogue.id
                      ? ' is-pending-dragging'
                      : ''
                  }`}
                  data-dialogue-id={dialogue.id}
                  data-pending-card="true"
                  data-pending-dragging={String(
                    pendingDragDialogueId === dialogue.id,
                  )}
                  data-selected={String(selected)}
                  data-testid="dialogue-untimed-item"
                  key={dialogue.id}
                >
                  <button
                    aria-label={`选择字幕：${characterName(dialogue.characterId)}：${dialogue.text}`}
                    aria-pressed={selected}
                    type="button"
                    className="dialogue-untimed-select dialogue-pending-card-select"
                    data-pending-card-select="true"
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
                        {!unifiedTaskTray ? (
                          <button
                            type="button"
                            className="dialogue-untimed-cancel"
                            data-dialogue-id={dialogue.id}
                            data-testid="dialogue-untimed-cancel"
                            onClick={handleClearSelection}
                          >
                            取消选择
                          </button>
                        ) : null}
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
          className="timeline-subtitle-empty dialogue-task-body dialogue-task-body-empty"
          data-testid="timeline-subtitle-empty"
        >
          <strong>暂无待安排字幕</strong>
          <span>点击下方入口添加字幕，或从时间轴选择已有字幕。</span>
        </div>
      )}

    </div>
  );
}
