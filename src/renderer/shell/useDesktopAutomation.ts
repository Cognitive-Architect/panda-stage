import { useEffect, useRef } from 'react';
import type { Project } from '../../domain';
import type { DesktopAutomationRendererRequest } from '../../shared/desktop-automation-api';
import { executeDesktopAutomation } from './desktopAutomationCommands';

type EditorState = { isBusy: () => boolean; previewDraft: (project: Project, shotId: string) => boolean };

/** Commands share the live editor and wait for locally started gestures to finish. */
export function useDesktopAutomation(state: EditorState): void {
  const latest = useRef(state);
  useEffect(() => { latest.current = state; }, [state]);

  useEffect(() => {
    const bridge = window.pandaStage?.desktopAutomation;
    if (!bridge) return;
    const queue: DesktopAutomationRendererRequest[] = [];
    const pointers = new Set<number>();
    let htmlDrag = false;
    let timer: number | undefined;

    function schedule(delay = 0): void {
      if (timer === undefined && queue.length) timer = window.setTimeout(flush, delay);
    }

    function flush(): void {
      timer = undefined;
      while (queue.length) {
        const request = queue[0]!;
        const expired = Date.now() >= request.deadlineMs;
        if (!expired && (pointers.size || htmlDrag || latest.current.isBusy())) {
          schedule(30);
          return;
        }
        queue.shift();
        bridge?.respond({ requestId: request.requestId, result: executeDesktopAutomation(request, latest.current.previewDraft) });
      }
    }

    function onDown(event: PointerEvent): void {
      if (event.isPrimary && event.button === 0) pointers.add(event.pointerId);
    }
    function onEnd(event: PointerEvent): void {
      pointers.delete(event.pointerId);
      schedule();
    }
    function onDragStart(): void { htmlDrag = true; }
    function onDragEnd(): void { htmlDrag = false; schedule(); }
    function onBlur(): void { pointers.clear(); onDragEnd(); }

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('pointercancel', onEnd, true);
    window.addEventListener('lostpointercapture', onEnd, true);
    window.addEventListener('dragstart', onDragStart, true);
    window.addEventListener('dragend', onDragEnd, true);
    window.addEventListener('drop', onDragEnd, true);
    window.addEventListener('blur', onBlur);
    const unsubscribe = bridge.onRequest(request => {
      if (request.command.name === 'state') {
        bridge.respond({ requestId: request.requestId, result: executeDesktopAutomation(request, latest.current.previewDraft) });
        return;
      }
      queue.push(request);
      schedule();
    });

    return () => {
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointercancel', onEnd, true);
      window.removeEventListener('lostpointercapture', onEnd, true);
      window.removeEventListener('dragstart', onDragStart, true);
      window.removeEventListener('dragend', onDragEnd, true);
      window.removeEventListener('drop', onDragEnd, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
