import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { dialogueStore } from '../../stores/dialogueStore';
import { shotStore } from '../../stores/shotStore';
import { formatTimecode, integerFrameSpanMs } from './timeGeometry';
import {
  isHorizontalPendingTrayGesture,
  isPendingDialoguePlacementGesture,
  isPointInsidePendingDropTarget,
  mapPendingDropXToStartMs,
} from './pendingDialogueDrag';

export type PendingDropState = 'outside' | 'invalid' | 'valid';

interface PendingDialogueSource {
  dialogueId: string;
  projectRoot: string;
  shotId: string;
  characterName: string;
  text: string;
  sourceElement: HTMLButtonElement | null;
}

interface PendingTrayPointerState extends PendingDialogueSource {
  pointerId: number;
  startX: number;
  startY: number;
  phase: 'pending' | 'swiping' | 'dragging';
  captureTarget: HTMLUListElement | null;
}

export interface PendingDialogueDragState extends PendingDialogueSource {
  pointerId: number;
  clientX: number;
  clientY: number;
  dropState: PendingDropState;
  mappedStartMs: number | null;
  previewStartMs: number | null;
  previewEndMs: number | null;
  message: string;
}

export interface PendingDialogueDropTarget {
  element: HTMLDivElement;
  durationMs: number;
  pixelsPerMs: number;
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

interface PendingDialoguePlacementContextValue {
  drag: PendingDialogueDragState | null;
  interaction: PendingTrayInteractionController;
  notice: string | null;
  registerDropTarget(target: PendingDialogueDropTarget | null): void;
}

const PendingDialoguePlacementContext =
  createContext<PendingDialoguePlacementContextValue | null>(null);

const CLOUD_TOUCH_LANDSCAPE_SELECTOR =
  ".editor-shell[data-editor-device-mode='cloud-touch'][data-editor-shell-layout='landscape']";

function isCloudTouchLandscapeElement(element: HTMLElement): boolean {
  return Boolean(element.closest(CLOUD_TOUCH_LANDSCAPE_SELECTOR));
}

export function PendingDialoguePlacementProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const pointerRef = useRef<PendingTrayPointerState | null>(null);
  const dragRef = useRef<PendingDialogueDragState | null>(null);
  const dropTargetRef = useRef<PendingDialogueDropTarget | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [drag, setDrag] = useState<PendingDialogueDragState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const publishDrag = useCallback(
    (next: PendingDialogueDragState | null): void => {
      dragRef.current = next;
      setDrag(next);
    },
    [],
  );

  const registerDropTarget = useCallback(
    (target: PendingDialogueDropTarget | null): void => {
      dropTargetRef.current = target;
    },
    [],
  );

  const suppressClick = useCallback((): void => {
    suppressClickRef.current = true;
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current);
    }
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressClickTimerRef.current = null;
    }, 0);
  }, []);

  const showNotice = useCallback((message: string): void => {
    setNotice(message);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 1800);
  }, []);

  const clearDrag = useCallback((restoreFocus: boolean): void => {
    const pointer = pointerRef.current;
    const active = dragRef.current;
    const captureTarget = pointer?.captureTarget;
    if (
      captureTarget &&
      pointer &&
      captureTarget.hasPointerCapture(pointer.pointerId)
    ) {
      captureTarget.releasePointerCapture(pointer.pointerId);
    }
    pointerRef.current = null;
    publishDrag(null);
    if (restoreFocus) {
      (active?.sourceElement ?? pointer?.sourceElement)?.focus();
    }
  }, [publishDrag]);

  const readSource = useCallback(
    (
      dialogueId: string,
      sourceElement: HTMLButtonElement | null,
    ): PendingDialogueSource | null => {
      const currentSnapshot = editorProjectStore.getSnapshot();
      const shotId = shotStore.getCurrentShotId();
      const shot = currentSnapshot?.project.shots.find(
        (candidate) => candidate.id === shotId,
      );
      const dialogue = shot?.dialogues.find(
        (candidate) => candidate.id === dialogueId,
      );
      if (!currentSnapshot || !shot || !dialogue) return null;
      if (dialogue.endMs !== dialogue.startMs) return null;
      return {
        dialogueId,
        projectRoot: currentSnapshot.projectRoot,
        shotId: shot.id,
        characterName:
          currentSnapshot.project.characters.find(
            (character) => character.id === dialogue.characterId,
          )?.name ?? dialogue.characterId,
        text: dialogue.text,
        sourceElement,
      };
    },
    [],
  );

  const resolveDrag = useCallback(
    (
      source: PendingDialogueSource,
      pointerId: number,
      clientX: number,
      clientY: number,
    ): PendingDialogueDragState => {
      const base = { ...source, pointerId, clientX, clientY };
      const target = dropTargetRef.current;
      if (!target || target.pixelsPerMs <= 0) {
        return {
          ...base,
          dropState: 'outside',
          mappedStartMs: null,
          previewStartMs: null,
          previewEndMs: null,
          message: '当前时间轴不可放置字幕',
        };
      }
      const rect = target.element.getBoundingClientRect();
      if (!isPointInsidePendingDropTarget(clientX, clientY, rect)) {
        return {
          ...base,
          dropState: 'outside',
          mappedStartMs: null,
          previewStartMs: null,
          previewEndMs: null,
          message: '请将字幕拖到字幕轨道',
        };
      }
      const mappedStartMs = mapPendingDropXToStartMs(
        clientX,
        rect.left,
        target.pixelsPerMs,
        target.durationMs,
      );
      const preview = dialogueStore.previewArrange(
        source.dialogueId,
        integerFrameSpanMs(),
        mappedStartMs,
      );
      if (!preview.ok) {
        return {
          ...base,
          dropState: 'invalid',
          mappedStartMs,
          previewStartMs: null,
          previewEndMs: null,
          message: preview.message,
        };
      }
      return {
        ...base,
        dropState: 'valid',
        mappedStartMs,
        previewStartMs: preview.startMs,
        previewEndMs: preview.endMs,
        message: `可放置于 ${formatTimecode(preview.startMs)}`,
      };
    },
    [],
  );

  const interaction = useMemo<PendingTrayInteractionController>(() => ({
    onPointerDown(event, dialogueId) {
      if (!isCloudTouchLandscapeElement(event.currentTarget)) return;
      if (pointerRef.current) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (!dialogueId) return;
      const sourceElement =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>(
              '[data-pending-card-select="true"]',
            )
          : null;
      const source = readSource(dialogueId, sourceElement);
      if (!source) return;
      pointerRef.current = {
        ...source,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        phase: 'pending',
        captureTarget: null,
      };
    },
    onPointerMove(event) {
      if (!isCloudTouchLandscapeElement(event.currentTarget)) return;
      const pointer = pointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      if (pointer.phase === 'dragging') {
        event.preventDefault();
        event.stopPropagation();
        publishDrag(
          resolveDrag(pointer, pointer.pointerId, event.clientX, event.clientY),
        );
        return;
      }
      if (pointer.phase === 'swiping') return;
      const rightWorkspaceSource = Boolean(
        event.currentTarget.closest('.dialogue-sheet-right-workspace'),
      );
      if (
        rightWorkspaceSource &&
        isPendingDialoguePlacementGesture(
          pointer.startX,
          pointer.startY,
          event.clientX,
          event.clientY,
          'any-direction',
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        try {
          event.currentTarget.setPointerCapture(pointer.pointerId);
        } catch {
          return;
        }
        pointer.phase = 'dragging';
        pointer.captureTarget = event.currentTarget;
        suppressClick();
        publishDrag(
          resolveDrag(pointer, pointer.pointerId, event.clientX, event.clientY),
        );
        return;
      }
      if (
        isHorizontalPendingTrayGesture(
          pointer.startX,
          pointer.startY,
          event.clientX,
          event.clientY,
        )
      ) {
        pointer.phase = 'swiping';
        return;
      }
      if (
        rightWorkspaceSource ||
        !isPendingDialoguePlacementGesture(
          pointer.startX,
          pointer.startY,
          event.clientX,
          event.clientY,
        )
      ) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(pointer.pointerId);
      } catch {
        return;
      }
      pointer.phase = 'dragging';
      pointer.captureTarget = event.currentTarget;
      suppressClick();
      publishDrag(
        resolveDrag(pointer, pointer.pointerId, event.clientX, event.clientY),
      );
    },
    onPointerUp(event) {
      if (!isCloudTouchLandscapeElement(event.currentTarget)) return;
      const pointer = pointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      if (pointer.phase === 'pending') {
        pointerRef.current = null;
        return;
      }
      if (pointer.phase === 'swiping') {
        suppressClick();
        pointerRef.current = null;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const active = dragRef.current;
      const validDrop =
        active?.dropState === 'valid' && active.mappedStartMs !== null;
      clearDrag(!validDrop);
      suppressClick();
      if (!active || !validDrop || active.mappedStartMs === null) {
        if (active) showNotice(active.message);
        return;
      }
      const currentSource = readSource(active.dialogueId, active.sourceElement);
      if (
        !currentSource ||
        currentSource.projectRoot !== active.projectRoot ||
        currentSource.shotId !== active.shotId
      ) {
        showNotice('字幕来源已变化，未提交拖拽');
        return;
      }
      try {
        dialogueStore.arrange(
          active.dialogueId,
          integerFrameSpanMs(),
          active.mappedStartMs,
        );
      } catch (error) {
        showNotice(error instanceof Error ? error.message : '字幕安排失败。');
      }
    },
    onPointerCancel(event) {
      if (!isCloudTouchLandscapeElement(event.currentTarget)) return;
      const pointer = pointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      if (pointer.phase === 'dragging' || pointer.phase === 'swiping') {
        event.preventDefault();
        event.stopPropagation();
        suppressClick();
      }
      clearDrag(true);
    },
    onClickCapture(event) {
      if (!isCloudTouchLandscapeElement(event.currentTarget)) return;
      if (!suppressClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = null;
      }
    },
  }), [
    clearDrag,
    publishDrag,
    readSource,
    resolveDrag,
    showNotice,
    suppressClick,
  ]);

  const cancelDrag = useCallback((): void => {
    const pointer = pointerRef.current;
    if (!pointer) return;
    if (pointer.phase === 'dragging' || pointer.phase === 'swiping') {
      suppressClick();
    }
    clearDrag(true);
  }, [clearDrag, suppressClick]);

  useEffect(() => {
    const active = dragRef.current ?? pointerRef.current;
    if (!active) return;
    if (
      active.projectRoot !== (snapshot?.projectRoot ?? '') ||
      active.shotId !== currentShotId
    ) cancelDrag();
  }, [cancelDrag, currentShotId, snapshot?.projectRoot]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !pointerRef.current) return;
      event.preventDefault();
      cancelDrag();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [cancelDrag]);

  useEffect(
    () => () => {
      const pointer = pointerRef.current;
      if (pointer?.captureTarget?.hasPointerCapture(pointer.pointerId)) {
        pointer.captureTarget.releasePointerCapture(pointer.pointerId);
      }
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
      }
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  const value = useMemo(
    () => ({ drag, interaction, notice, registerDropTarget }),
    [drag, interaction, notice, registerDropTarget],
  );

  return (
    <PendingDialoguePlacementContext.Provider value={value}>
      {children}
      {drag ? (
        <div
          className="timeline-pending-drag-layer"
          data-testid="timeline-pending-drag-layer"
        >
          <div
            className={`pending-dialogue-drag-ghost pending-dialogue-drag-ghost-${drag.dropState}`}
            data-dialogue-id={drag.dialogueId}
            data-drop-state={drag.dropState}
            data-testid="pending-dialogue-drag-ghost"
            style={{ left: `${drag.clientX}px`, top: `${drag.clientY}px` }}
          >
            <span className="pending-dialogue-drag-identity">
              <strong>{drag.characterName}</strong>
              <span> · {drag.text}</span>
            </span>
            <output
              aria-live="polite"
              className="pending-dialogue-drag-status"
              data-testid="pending-dialogue-drop-status"
            >
              {drag.message}
            </output>
          </div>
        </div>
      ) : null}
      {notice ? (
        <div
          className="timeline-pending-drop-notice"
          data-testid="timeline-pending-drop-notice"
          role="status"
        >
          {notice}
        </div>
      ) : null}
    </PendingDialoguePlacementContext.Provider>
  );
}

export function usePendingDialoguePlacement(): PendingDialoguePlacementContextValue {
  const context = useContext(PendingDialoguePlacementContext);
  if (!context) {
    throw new Error(
      'usePendingDialoguePlacement must be used within PendingDialoguePlacementProvider',
    );
  }
  return context;
}
