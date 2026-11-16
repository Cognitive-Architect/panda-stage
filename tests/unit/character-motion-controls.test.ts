// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { CharacterMotionControls } from '../../src/renderer/features/canvas/CharacterMotionControls';
import { CharacterMotionLane } from '../../src/renderer/features/timeline/CharacterMotionLane';
import { CharacterMotionGesture } from '../../src/renderer/features/canvas/characterMotionGesture';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { IDS } from './domain/testProject';

it('selects a Part, uses Chinese Auto-Key and Timeline key state, seeks markers and reconciles selection', async () => {
  const data = characterPartAnimationFixture();
  editorProjectStore.open('D:/test-motion-controls', data.project);
  shotStore.select(IDS.shot); selectionStore.select(data.layerId);
  timelineUiStore.seek(500, 3000); timelineUiStore.setCharacterMotionAutoKey(false);
  const element = document.createElement('div'), root = createRoot(element);
  const render = () => {
    const project = editorProjectStore.getSnapshot()!.project;
    root.render(createElement(Fragment, null,
      createElement(CharacterMotionControls, { project, shot: project.shots[0]!, layerId: data.layerId }),
      createElement(CharacterMotionLane, { project, shot: project.shots[0]!, layerId: data.layerId, currentTimeMs: timelineUiStore.getSnapshot().currentTimeMs, pixelsPerMs: 0.2 }),
    ));
  };
  try {
    await act(async () => render());
    const select = element.querySelector('select')!;
    await act(async () => { select.value = data.graphicPartId; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(selectionStore.getSelectedCharacterPartId()).toBe(data.graphicPartId);
    expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
    const toggle = element.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    expect(toggle.textContent).toBe('自动关键帧');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    await act(async () => {
      new CharacterMotionGesture(editorProjectStore, { shotId: IDS.shot, layerId: data.layerId, partId: data.graphicPartId, timeMs: 500, autoKey: true }, () => true).commit({ 'transform.rotationDeg': 90 });
      render();
    });
    expect(element.querySelector('[data-testid="character-motion-key-state"]')).toBeNull();
    expect(element.querySelector('.character-motion-keys button[aria-current="true"]')?.textContent).toBe('◆');
    const markers = element.querySelectorAll<HTMLButtonElement>('.character-motion-keys button');
    expect(markers).toHaveLength(2);
    await act(async () => markers[0]!.click());
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(0);
    await act(async () => timelineUiStore.seek(250, 3000));
    await act(async () => render());
    expect(element.querySelector('.character-motion-keys button[aria-current="true"]')).toBeNull();
    await act(async () => selectionStore.select(IDS.layerAsset));
    expect(selectionStore.getSelectedCharacterPartId()).toBeNull();
  } finally { await act(async () => root.unmount()); selectionStore.clear(); timelineUiStore.setCharacterMotionAutoKey(false); }
});
