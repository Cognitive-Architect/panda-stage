// @vitest-environment happy-dom
import { act, createElement, Fragment, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RightInspector, type RightInspectorProps } from '../../src/renderer/shell/RightInspector';
import { CharacterMotionControls } from '../../src/renderer/features/canvas/CharacterMotionControls';
import { CharacterMotionLane } from '../../src/renderer/features/timeline/CharacterMotionLane';
import { CharacterMotionGesture } from '../../src/renderer/features/canvas/characterMotionGesture';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { IDS } from './domain/testProject';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => { selectionStore.clear(); editorProjectStore.clear(); timelineUiStore.setCharacterMotionAutoKey(false); });
function props(node: Element) {
  return (node as unknown as Record<string, Record<string, (event: unknown) => void>>)[Object.keys(node).find(k => k.startsWith('__reactProps$'))!]!;
}
function Harness() {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot)!;
  const ui = useSyncExternalStore(timelineUiStore.subscribe, timelineUiStore.getSnapshot);
  const layerId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedLayerId);
  return createElement(Fragment, null,
    createElement(CharacterMotionControls, { project: snapshot.project, shot: snapshot.project.shots[0]!, layerId }),
    createElement(CharacterMotionLane, { project: snapshot.project, shot: snapshot.project.shots[0]!, layerId, currentTimeMs: ui.currentTimeMs, pixelsPerMs: 1 }),
    createElement<RightInspectorProps>(RightInspector, { embedded: true, shellMode: 'landscape' }),
  );
}
async function mount(source: 'image' | 'graphic', autoKey: boolean) {
  const data = characterPartAnimationFixture();
  const character = data.project.characters.find(c => c.id === data.characterId)!;
  if (character.mode === 'adaptive-parts') { character.parts[0]!.displayName = '右手'; character.parts[1]!.displayName = '配件'; }
  editorProjectStore.open('D:/test-motion-inspector', data.project);
  shotStore.select(IDS.shot); selectionStore.select(data.layerId);
  selectionStore.selectCharacterPart(source === 'image' ? data.imagePartId : data.graphicPartId);
  timelineUiStore.seek(500, 3000); timelineUiStore.setCharacterMotionAutoKey(autoKey);
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element); await act(async () => root.render(createElement(Harness)));
  return { data, element, root };
}
it.each((['image', 'graphic'] as const).flatMap(source => [true, false].map(autoKey => ({ source, autoKey }))))('$source Inspector and Stage share authoring and one-command History (autoKey=$autoKey)', async ({ source, autoKey }) => {
  const { data, element, root } = await mount(source, autoKey);
  try {
    const name = source === 'image' ? '右手' : '配件';
    expect(element.querySelector('[data-testid="right-inspector-part-context"]')!.textContent).toContain(`› ${name}`);
    expect(element.querySelector('.timeline-lane-label')!.textContent).toBe(name);
    expect(element.querySelector('select')!.selectedOptions[0]!.textContent).toBe(name);
    expect(element.querySelector('[data-testid="layer-transform-rotation"]')).toBeNull();
    expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
    const input = element.querySelector<HTMLInputElement>('[aria-label="旋转 °"]')!;
    await act(async () => { input.focus(); props(input).onChange!({ target: { value: '90' } }); });
    expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
    const form = element.querySelector('form')!;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); input.blur(); });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    const after = editorProjectStore.getSnapshot()!.project;
    const layer = after.shots[0]!.layers.find(l => l.id === data.layerId)!;
    if (autoKey) {
      expect(layer.animationClip!.tracks.map(t => t.property)).toEqual(['transform.rotationDeg']);
      expect(layer.animationClip!.tracks[0]!.keys).toHaveLength(2);
      expect(element.querySelector('.character-motion-keys button[aria-current="true"]')).not.toBeNull();
    } else { expect(layer.animationClip).toBeUndefined(); expect(after.shots).toEqual(data.project.shots); }
    const partId = selectionStore.getSelectedCharacterPartId()!;
    await act(async () => new CharacterMotionGesture(editorProjectStore, { shotId: IDS.shot, layerId: data.layerId, partId, timeMs: 500, autoKey }, () => true).commit({ 'transform.offsetX': 40 }));
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
    expect(element.querySelector<HTMLInputElement>('[aria-label="位置 X"]')!.value).toBe('40');
    await act(async () => editorProjectStore.undo());
    expect(editorProjectStore.getSnapshot()!.project).toEqual(after);
    await act(async () => editorProjectStore.undo());
    expect(editorProjectStore.getSnapshot()!.project).toEqual(data.project);
    await act(async () => editorProjectStore.redo());
    expect(editorProjectStore.getSnapshot()!.project).toEqual(after);
    const select = element.querySelector('select')!;
    await act(async () => { select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(selectionStore.getSelectedCharacterPartId()).toBeNull();
    expect(element.querySelector('[data-testid="character-part-transform-panel"]')).toBeNull();
    expect(element.querySelector('[data-testid="layer-transform-rotation"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); element.remove(); }
});
it('cancels stale Inspector drafts on seek and keeps validation failures out of History', async () => {
  const { element, root } = await mount('image', true);
  try {
    let input = element.querySelector<HTMLInputElement>('[aria-label="旋转 °"]')!;
    await act(async () => { input.focus(); props(input).onChange!({ target: { value: '90' } }); });
    await act(async () => timelineUiStore.seek(250, 3000));
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    expect(element.querySelector<HTMLInputElement>('[aria-label="旋转 °"]')!.value).toBe('0');
    input = element.querySelector<HTMLInputElement>('[aria-label="缩放 %"]')!;
    await act(async () => { input.focus(); props(input).onChange!({ target: { value: '0' } }); element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
  } finally { await act(async () => root.unmount()); element.remove(); }
});
it('commits uniform scale once on Enter and keeps frozen targets usable after Library Part removal', async () => {
  const { data, element, root } = await mount('graphic', true);
  try {
    const input = element.querySelector<HTMLInputElement>('[aria-label="缩放 %"]')!;
    await act(async () => { input.focus(); props(input).onChange!({ target: { value: '125' } }); });
    await act(async () => props(input).onKeyDown!({ key: 'Enter', preventDefault() {} }));
    const authored = editorProjectStore.getSnapshot()!.project;
    const clip = authored.shots[0]!.layers.find(l => l.id === data.layerId)!.animationClip!;
    expect(clip.tracks.map(t => t.property)).toEqual(['transform.scaleX', 'transform.scaleY']);
    expect(clip.tracks.map(t => t.keys[1]!.value)).toEqual([1.25, 1.25]);
    await act(async () => input.blur());
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    const updated = structuredClone(authored);
    const character = updated.characters.find(c => c.id === data.characterId)!;
    if (character.mode === 'adaptive-parts') character.parts = character.parts.filter(p => p.partId !== data.graphicPartId);
    await act(async () => { editorProjectStore.updateProject(updated); timelineUiStore.setCharacterMotionAutoKey(false); });
    expect(element.querySelector('[role="alert"]')!.textContent).toContain('开启自动关键帧');
    expect(element.querySelector<HTMLInputElement>('[aria-label="缩放 %"]')!.disabled).toBe(true);
    const history = editorProjectStore.history.getSnapshot().undoCount;
    await act(async () => timelineUiStore.setCharacterMotionAutoKey(true));
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelector<HTMLInputElement>('[aria-label="缩放 %"]')!.value).toBe('125');
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(history);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find(l => l.id === data.layerId)!.animationClip).toEqual(clip);
  } finally { await act(async () => root.unmount()); element.remove(); }
});
