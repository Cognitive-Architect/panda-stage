// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CharacterActionAtTimeControl } from '../../src/renderer/features/properties/CharacterActionAtTimeControl';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { characterActionGraphicFixture } from '../helpers/characterActionGraphicFixture';
import { IDS } from './domain/testProject';

it('adds a full Graphic at the latest playhead and retains explicit and existing ranges on seek', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const project = characterActionGraphicFixture();
  project.shots[0]!.timelineEvents = [];
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const button = (label: string) => Array.from(element.querySelectorAll('button'))
    .find((entry) => entry.textContent === label)!;
  const range = () => [...element.querySelectorAll<HTMLInputElement>('input')];
  const currentShot = () => editorProjectStore.getSnapshot()!.project.shots[0]!;
  const draw = () => {
    const snapshot = editorProjectStore.getSnapshot()!;
    const shot = currentShot();
    root.render(createElement(CharacterActionAtTimeControl, {
      project: snapshot.project, shot, layer: shot.layers.find((layer) => layer.id === IDS.layerChar)!,
    }));
  };
  const seek = (time: number) => timelineUiStore.seek(time, 3000);
  try {
    editorProjectStore.open('D:/action-range-test', project);
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerChar);
    seek(0);
    await act(async () => draw());
    await act(async () => seek(1_000));
    expect(range()).toHaveLength(0);
    await act(async () => button('添加动作').click());
    const first = currentShot().timelineEvents[0]!;
    expect(first).toMatchObject({ startMs: 1_000, endMs: 1_542, layerId: IDS.layerChar });
    await act(async () => draw());
    await act(async () => button('编辑').click());
    await act(async () => seek(2_000));
    expect(range().map((field) => field.value)).toEqual(['1000', '1542']);
    await act(async () => button('取消').click());
    await act(async () => button('调整时间').click());
    expect(range().map((field) => field.value)).toEqual(['2000', '2542']);
    const start = range()[0]!;
    const reactProps = Object.keys(start).find((key) => key.startsWith('__reactProps$'))!;
    const onChange = (start as unknown as Record<string, { onChange: (event: unknown) => void }>)[reactProps]!.onChange;
    await act(async () => onChange({ target: { value: '2200' } }));
    await act(async () => seek(2_750));
    expect(range().map((field) => field.value)).toEqual(['2200', '2542']);
    await act(async () => button('取消').click());
    await act(async () => button('添加动作').click());
    expect(currentShot().timelineEvents).toContainEqual(expect.objectContaining({ startMs: 2_750, endMs: 3_000 }));
  } finally {
    await act(async () => root.unmount());
    element.remove();
    selectionStore.clear();
    editorProjectStore.clear();
    vi.unstubAllGlobals();
  }
});
