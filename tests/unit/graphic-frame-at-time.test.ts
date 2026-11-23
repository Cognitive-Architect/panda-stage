// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LayerService } from '../../src/domain';
import { RightInspector, type RightInspectorProps } from '../../src/renderer/shell/RightInspector';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

it('browses without edits, applies at the latest time, and discards choice when switching objects', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const service = new LayerService();
  const placement = { animationId: FACE_GRAPHIC_ID, startTimeMs: 0, position: { x: 200, y: 100 } };
  const first = service.createFromAnimation(graphicFaceProject(), IDS.shot, placement);
  const second = service.createFromAnimation(first.project, IDS.shot, placement);
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const control = () => element.querySelector('[data-testid="graphic-frame-at-time"]')!;
  const findButton = (label: string) => [...control().querySelectorAll('button')].find((entry) => entry.textContent === label);
  const button = (label: string) => findButton(label)!;
  try {
    editorProjectStore.open('D:/graphic-frame-ui', second.project);
    shotStore.select(IDS.shot);
    selectionStore.select(first.layer.id);
    timelineUiStore.seek(0, 3_000);
    const before = editorProjectStore.getSnapshot()!;
    await act(async () => root.render(createElement<RightInspectorProps>(RightInspector, { embedded: true, shellMode: 'landscape' })));
    await act(async () => button('选择显示帧').click());
    await act(async () => control().querySelector<HTMLButtonElement>('[data-testid="graphic-instance-frame-2"]')!.click());
    expect(editorProjectStore.getSnapshot()).toBe(before);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    await act(async () => {
      timelineUiStore.seek(1_000, 3_000);
      button('应用到播放头').click();
    });
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents)
      .toMatchObject([{ type: 'graphic-frame', layerId: first.layer.id, startMs: 1_000, sourceFrameIndex: 9 }]);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    await act(async () => timelineUiStore.seek(1_500, 3_000));
    expect(findButton('清除这次切换')).toBeUndefined();
    await act(async () => timelineUiStore.seek(1_000, 3_000));
    await act(async () => button('清除这次切换').click());
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents).toHaveLength(0);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
    await act(async () => { editorProjectStore.undo(); });
    expect(findButton('清除这次切换')).toBeDefined();
    await act(async () => selectionStore.select(second.layer.id));
    await act(async () => button('选择显示帧').click());
    expect(button('应用到播放头').disabled).toBe(true);
    expect(findButton('清除这次切换')).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    element.remove();
    editorProjectStore.clear();
    vi.unstubAllGlobals();
  }
});
