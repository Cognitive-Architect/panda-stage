// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LayerService, ShotService } from '../../src/domain';
import { RightInspector, type RightInspectorProps } from '../../src/renderer/shell/RightInspector';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { GraphicFrameTargetProvider } from '../../src/renderer/features/properties/GraphicFrameAtTimeControl';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

it('commits ready thumbnails at the live playhead and keeps a fixed target across selection changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(), drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const images: HTMLImageElement[] = [];
  vi.spyOn(window, 'Image').mockImplementation(function () {
    const image = document.createElement('img');
    images.push(image);
    return image;
  });
  const failId = '92000000-0000-4000-8000-000000000001';
  let fail = true;
  Object.defineProperty(window, 'pandaStage', { configurable: true, value: { assets: {
    readThumbnail: vi.fn(async () => ({ ok: true, status: 'missing' })),
    readCanvasImage: vi.fn(async ({ assetId }: { assetId: string }) => fail && assetId === failId
      ? { ok: true, status: 'missing' }
      : { ok: true, status: 'ready', bytes: new Uint8Array(1), mimeType: 'image/png' }),
  } } });
  const service = new LayerService();
  const placement = { animationId: FACE_GRAPHIC_ID, startTimeMs: 0, position: { x: 200, y: 100 } };
  const first = service.createFromAnimation(graphicFaceProject(false), IDS.shot, placement);
  const second = service.createFromAnimation(first.project, IDS.shot, placement);
  const project = new ShotService().create(second.project, { name: 'Another shot', durationMs: 3_000 });
  const secondShotId = project.shots[1]!.id;
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const control = () => element.querySelector('[data-testid="graphic-frame-at-time"]')!;
  const findButton = (label: string) => [...control().querySelectorAll('button')].find((entry) => entry.textContent === label);
  const button = (label: string) => findButton(label)!;
  const frame = (index: number) => control().querySelector<HTMLButtonElement>(`[data-testid="graphic-instance-frame-${index}"]`)!;
  const events = () => editorProjectStore.getSnapshot()!.project.shots[0]!.timelineEvents;
  const decode = () => act(async () => images.forEach((image) => image.onload?.(new Event('load'))));
  const render = (showInspector: boolean) => root.render(createElement(GraphicFrameTargetProvider, {
    children: showInspector ? createElement<RightInspectorProps>(RightInspector, { embedded: true, shellMode: 'landscape' }) : null,
  }));
  try {
    editorProjectStore.open('D:/graphic-frame-ui', project);
    shotStore.select(IDS.shot);
    selectionStore.select(first.layer.id);
    timelineUiStore.seek(0, 3_000);
    const before = editorProjectStore.getSnapshot()!;
    await act(async () => render(true));
    await act(async () => button('选择显示帧').click());
    expect(frame(0).dataset.thumbnailStatus).toBe('failed');
    expect(frame(2).disabled).toBe(true);
    await act(async () => frame(2).click());
    fail = false;
    await act(async () => frame(0).click());
    await decode();
    expect(frame(0).dataset.thumbnailStatus).toBe('ready');
    expect(frame(2).dataset.thumbnailStatus).toBe('ready');
    expect(editorProjectStore.getSnapshot()).toBe(before);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    await act(async () => button('固定目标').click());
    expect(control().querySelector('button[aria-pressed="true"]')?.textContent).toContain(first.layer.name);
    await act(async () => render(false));
    await act(async () => selectionStore.select(second.layer.id));
    await act(async () => render(true));
    await decode();
    await act(async () => {
      timelineUiStore.seek(1_000, 3_000);
      frame(2).click();
    });
    expect(events()).toMatchObject([{ type: 'graphic-frame', layerId: first.layer.id, startMs: 1_000, sourceFrameIndex: 9 }]);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    const originalId = events()[0]!.id;
    await act(async () => frame(1).click());
    expect(events()).toMatchObject([{ id: originalId, sourceFrameIndex: 8 }]);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
    await act(async () => { timelineUiStore.seek(1_500, 3_000); frame(3).click(); });
    await act(async () => { timelineUiStore.seek(2_000, 3_000); frame(0).click(); });
    expect(events()).toMatchObject([
      { layerId: first.layer.id, startMs: 1_000, sourceFrameIndex: 8 },
      { layerId: first.layer.id, startMs: 1_500, sourceFrameIndex: 10 },
      { layerId: first.layer.id, startMs: 2_000, sourceFrameIndex: 7 },
    ]);
    await act(async () => button('清除这次切换').click());
    expect(events()).toHaveLength(2);
    await act(async () => { editorProjectStore.undo(); });
    expect(findButton('清除这次切换')).toBeDefined();
    await act(async () => button(`取消固定 · ${first.layer.name}`).click());
    await act(async () => button('选择显示帧').click());
    expect(findButton('清除这次切换')).toBeUndefined();
    await decode();
    await act(async () => frame(1).click());
    expect(events().at(-1)).toMatchObject({ layerId: second.layer.id, startMs: 2_000, sourceFrameIndex: 8 });
    await act(async () => button('固定目标').click());
    await act(async () => selectionStore.select(first.layer.id));
    await act(async () => {
      const beforeLock = editorProjectStore.getSnapshot()!;
      editorProjectStore.updateProject(service.setLocked(beforeLock.project, IDS.shot, second.layer.id, true), 'Lock');
      frame(2).click();
    });
    expect(events()).toHaveLength(4);
    expect(findButton(`取消固定 · ${second.layer.name}`)).toBeUndefined();

    await act(async () => button('选择显示帧').click());
    await act(async () => button('固定目标').click());
    await act(async () => render(false));
    await act(async () => { shotStore.select(secondShotId); });
    await act(async () => { shotStore.select(IDS.shot); selectionStore.select(first.layer.id); });
    await act(async () => render(true));
    expect(findButton(`取消固定 · ${first.layer.name}`)).toBeUndefined();

    await act(async () => button('选择显示帧').click());
    await act(async () => button('固定目标').click());
    await act(async () => { editorProjectStore.open('D:/graphic-frame-ui', project); });
    await act(async () => selectionStore.select(first.layer.id));
    expect(findButton(`取消固定 · ${first.layer.name}`)).toBeUndefined();
    expect(events()).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    element.remove();
    editorProjectStore.clear();
    Reflect.deleteProperty(window, 'pandaStage');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
