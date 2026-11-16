// @vitest-environment happy-dom
import { act, createElement, Fragment, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RightInspector, getRightInspectorLayerSummary, getRightInspectorSelection, type RightInspectorProps } from '../../src/renderer/shell/RightInspector';
import { LayerBackgroundControl, type LayerBackgroundControlProps } from '../../src/renderer/features/properties/LayerBackgroundControl';
import { LayerTransformPanel, type LayerTransformPanelProps } from '../../src/renderer/features/properties/LayerTransformPanel';
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
it('reuses existing Image/Graphic asset thumbnails and keeps the frozen Part source after library edits', () => {
  const data = characterPartAnimationFixture();
  editorProjectStore.open('D:/test-motion-thumbnail', data.project);
  const snapshot = editorProjectStore.getSnapshot()!;
  const layer = snapshot.project.shots[0]!.layers.find(candidate => candidate.id === data.layerId)!;
  expect(getRightInspectorLayerSummary(snapshot, layer, data.imagePartId).asset?.id).toBe(IDS.assetChar);
  const graphicAssetId = snapshot.project.animations[0]!.frames[0]!.assetId;
  expect(getRightInspectorLayerSummary(snapshot, layer, data.graphicPartId).asset?.id).toBe(graphicAssetId);
  new CharacterMotionGesture(editorProjectStore, { shotId: IDS.shot, layerId: data.layerId, partId: data.imagePartId, timeMs: 500, autoKey: true }, () => true).commit({ 'transform.rotationDeg': 90 });
  const frozen = structuredClone(editorProjectStore.getSnapshot()!);
  const character = frozen.project.characters.find(candidate => candidate.id === data.characterId)!;
  if (character.mode === 'adaptive-parts') character.parts = [];
  const frozenLayer = frozen.project.shots[0]!.layers.find(candidate => candidate.id === data.layerId)!;
  expect(getRightInspectorLayerSummary(frozen, frozenLayer, data.imagePartId).asset?.id).toBe(IDS.assetChar);
});

it.each([{ compact: true, presentation: 'landscape' as const }, { compact: true, presentation: 'portrait' as const }, { compact: false }])('keeps normal background quiet and preserves failure/locked feedback (%j)', async options => {
  const data = characterPartAnimationFixture();
  editorProjectStore.open('D:/test-background-feedback', data.project);
  shotStore.select(IDS.shot); selectionStore.selectBackground(); timelineUiStore.seek(0, 3000);
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  const render = () => root.render(createElement(Fragment, null,
    createElement<LayerBackgroundControlProps>(LayerBackgroundControl, options),
    createElement<LayerTransformPanelProps>(LayerTransformPanel, { compact: options.compact, backgroundLayerSelected: true }),
  ));
  try {
    await act(async () => render());
    expect(getRightInspectorSelection(editorProjectStore.getSnapshot(), IDS.shot, IDS.layerBg).message).toBe('');
    expect(element.querySelector('[data-testid="layer-background-guidance"]')).toBeNull();
    expect(element.querySelector('[data-testid="layer-transform-guidance"]')).toBeNull();
    expect(element.querySelector('[data-testid="layer-transform-status"]')!.textContent).toBe('');
    await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="select-current-shot-background"]')!.click());
    expect(element.querySelector('[data-testid="layer-background-guidance"]')).toBeNull();
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    const failure = vi.spyOn(selectionStore, 'selectBackground').mockImplementationOnce(() => { throw new Error('选择背景失败，请重试。'); });
    await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="select-current-shot-background"]')!.click());
    expect(element.querySelector('[data-testid="layer-background-guidance"]')!.textContent).toBe('选择背景失败，请重试。');
    failure.mockRestore();
    await act(async () => element.querySelector<HTMLButtonElement>('[data-testid="select-current-shot-background"]')!.click());
    expect(element.querySelector('[data-testid="layer-background-guidance"]')).toBeNull();
    await act(async () => {
      const project = structuredClone(editorProjectStore.getSnapshot()!.project);
      project.shots[0]!.layers.find(layer => layer.id === IDS.layerBg)!.locked = true;
      editorProjectStore.open('D:/test-background-feedback-locked', project);
      shotStore.select(IDS.shot); selectionStore.selectBackground();
    });
    expect(element.querySelector('[data-testid="layer-background-guidance"]')!.textContent).toBe('背景已锁定。');
    expect(element.querySelector('[data-testid="layer-transform-guidance"]')!.textContent).toBe('背景已锁定。');
  } finally { vi.restoreAllMocks(); await act(async () => root.unmount()); element.remove(); }
});
function Harness() {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot)!;
  const ui = useSyncExternalStore(timelineUiStore.subscribe, timelineUiStore.getSnapshot);
  const layerId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedLayerId);
  return createElement(Fragment, null,
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
    const identity = element.querySelector('[data-testid="right-inspector-part-context"]')!;
    expect(identity.querySelector('strong')!.textContent).toBe(name);
    expect(identity.querySelector('.character-part-identity-copy > span')!.textContent).toBe(data.project.shots[0]!.layers.find(layer => layer.id === data.layerId)!.name);
    expect(identity.classList.contains('right-inspector-selection')).toBe(false);
    expect(identity.querySelector('svg')).not.toBeNull();
    const selector = element.querySelector('select')!;
    expect(element.querySelector(`label[for="${selector.id}"]`)!.textContent).toBe('部位');
    expect(selector.title).toBe(name);
    expect(element.querySelector('.character-motion-controls button svg')).not.toBeNull();
    expect(element.querySelector('.character-motion-lane .timeline-lane-label')!.textContent).toBe(name);
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
it.each([true, false])('commits steppers, Apply and Reset once through the same facade (autoKey=%s)', async autoKey => {
  const { data, element, root } = await mount('graphic', autoKey);
  const panel = () => element.querySelector('[data-testid="character-part-transform-panel"]')!;
  const button = (label: string) => [...panel().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label)!;
  const input = (label: string) => panel().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  try {
    expect(element.querySelectorAll('.character-motion-controls')).toHaveLength(1);
    expect(element.querySelector('.character-motion-controls')!.closest('[data-testid="character-motion-inspector-section"]')).not.toBeNull();
    expect(element.querySelectorAll('summary').item(0).textContent).toBe('动作');
    const x = input('位置 X');
    await act(async () => { x.focus(); props(x).onChange!({ target: { value: '12' } }); });
    const scaleUp = button('放大缩放');
    await act(async () => { props(x).onBlur!({ relatedTarget: scaleUp }); scaleUp.click(); });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    expect(input('位置 X')).toBe(x); // Field commits retain keyboard focus across revisions.
    expect(input('缩放 %').value).toBe('110');
    await act(async () => button('增加旋转角度').click());
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
    expect(input('旋转 °').value).toBe('15');
    await act(async () => button('缩小缩放').click());
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(3);
    expect(input('缩放 %').value).toBe('100');
    const y = input('位置 Y');
    await act(async () => { y.focus(); props(y).onChange!({ target: { value: '24' } }); });
    await act(async () => { button('应用变换').click(); y.blur(); });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(4);
    const committed = editorProjectStore.getSnapshot()!.project;
    await act(async () => { x.focus(); props(x).onChange!({ target: { value: '80' } }); });
    await act(async () => button('重置变换').click());
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(5);
    expect(['位置 X', '位置 Y', '缩放 %', '旋转 °'].map(label => input(label).value)).toEqual(['0', '0', '100', '0']);
    const reset = editorProjectStore.getSnapshot()!.project;
    if (!autoKey) expect(reset.shots).toEqual(data.project.shots);
    await act(async () => editorProjectStore.undo());
    expect(editorProjectStore.getSnapshot()!.project).toEqual(committed);
    await act(async () => editorProjectStore.redo());
    expect(editorProjectStore.getSnapshot()!.project).toEqual(reset);
    expect(panel().querySelectorAll('input')).toHaveLength(4);
    expect(panel().textContent).not.toMatch(/水平翻转|不透明度|离开输入框|位置为相对/);
  } finally { await act(async () => root.unmount()); element.remove(); }
});
it('submits a field on blur and clamps scale steppers without duplicate or out-of-range commands', async () => {
  const { element, root } = await mount('image', true);
  const scale = () => element.querySelector<HTMLInputElement>('[aria-label="缩放 %"]')!;
  const change = async (value: string) => {
    const field = scale();
    await act(async () => { field.focus(); props(field).onChange!({ target: { value } }); field.blur(); });
  };
  try {
    await change('5');
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="缩小缩放"]')!.click());
    expect(scale().value).toBe('5');
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    await change('2000');
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="放大缩放"]')!.click());
    expect(scale().value).toBe('2000');
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
  } finally { await act(async () => root.unmount()); element.remove(); }
});
