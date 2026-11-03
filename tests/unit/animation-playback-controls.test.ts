// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import {
  AnimationPlaybackControls,
  parseAnimationStartTime,
  sameAnimationStartEditContext,
  type AnimationStartEditContext,
} from '../../src/renderer/features/properties/AnimationPlaybackControls';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { layerStore } from '../../src/renderer/stores/layerStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/animation-playback-controls.pandastage';

function projectWithAnimationLayer(startTimeMs = 1_000) {
  const project = buildProjectWithAnimation();
  const shot = project.shots.find((candidate) => candidate.id === IDS.shot);
  if (!shot) throw new Error('Animation controls fixture is missing its Shot.');
  const animationLayer = {
    id: IDS.animationLayer,
    name: 'test animation',
    source: { kind: 'animation' as const, animationId: IDS.animation },
    startTimeMs,
    animationPlayback: { mode: 'once' as const, endBehavior: 'hold' as const },
    anchor: 'center' as const,
    x: 400,
    y: 300,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    zIndex: 3,
    locked: false,
    flipX: false,
  };
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((candidate) =>
      candidate.id === IDS.shot
        ? { ...candidate, layers: [...candidate.layers, animationLayer] }
        : candidate,
    ),
  });
}

function currentAnimationLayer() {
  const snapshot = editorProjectStore.getSnapshot();
  return snapshot?.project.shots
    .find((shot) => shot.id === IDS.shot)
    ?.layers.find((layer) => layer.id === IDS.animationLayer);
}

let container: HTMLDivElement;
let root: Root;

function startInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    '[data-testid="animation-start-seconds"]',
  );
  if (!input) throw new Error('Animation start input is not mounted.');
  return input;
}

async function enterDraft(value: string): Promise<HTMLInputElement> {
  const input = startInput();
  await act(async () => input.focus());
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    if (!setter) throw new Error('HTMLInputElement.value setter is missing.');
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

async function pressKey(input: HTMLInputElement, key: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => input.dispatchEvent(event));
  return event;
}

async function blur(input: HTMLInputElement): Promise<void> {
  await act(async () => input.blur());
}

async function clickPlaybackTab(
  ariaLabel: string,
  optionLabel: string,
): Promise<void> {
  const tabList = Array.from(
    container.querySelectorAll<HTMLElement>('[role="tablist"]'),
  ).find((candidate) => candidate.getAttribute('aria-label') === ariaLabel);
  const tab = Array.from(
    tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
  ).find((candidate) => candidate.textContent?.trim() === optionLabel);
  if (!tab) throw new Error(`Missing ${optionLabel} option in ${ariaLabel}.`);
  await act(async () => tab.click());
}

describe('AnimationPlaybackControls start-time editing', () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    editorProjectStore.open(PROJECT_ROOT, projectWithAnimationLayer());
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.animationLayer);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(AnimationPlaybackControls)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    selectionStore.clear();
  });

  it('uses segmented playback settings and retains the end choice through looping', async () => {
    const fields = container.querySelector('.animation-playback-fields');
    expect(
      Array.from(fields?.children ?? []).map((field) => field.tagName),
    ).toEqual(['LABEL', 'DIV', 'DIV']);
    expect(
      container.querySelector('.animation-playback-time-field > span:first-child')
        ?.textContent,
    ).toBe('开始时间');
    expect(
      container.querySelector('.animation-playback-time-unit')?.textContent?.trim(),
    ).toBe('秒');

    const holdButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="animation-end-behavior"] [role="tab"]',
      ),
    ).find((button) => button.textContent?.trim() === '定格');
    expect(holdButton?.getAttribute('aria-label')).toBe(
      '播放结束时定格在最后一帧',
    );
    expect(holdButton?.title).toBe('播放结束时定格在最后一帧');

    await clickPlaybackTab('动画播放方式', '循环');

    expect(currentAnimationLayer()?.animationPlayback).toEqual({
      mode: 'loop',
      endBehavior: 'hold',
    });
    expect(
      container.querySelector('[data-testid="animation-end-behavior"]'),
    ).toBeNull();

    await clickPlaybackTab('动画播放方式', '单次');
    await clickPlaybackTab('动画播放结束', '隐藏');
    expect(currentAnimationLayer()?.animationPlayback).toEqual({
      mode: 'once',
      endBehavior: 'hide',
    });

    await clickPlaybackTab('动画播放方式', '循环');
    expect(
      container.querySelector('[data-testid="animation-end-behavior"]'),
    ).toBeNull();
    await clickPlaybackTab('动画播放方式', '单次');

    expect(currentAnimationLayer()?.animationPlayback).toEqual({
      mode: 'once',
      endBehavior: 'hide',
    });
  });

  it('keeps the start-time field millisecond-precise with a decorative seconds suffix', () => {
    const input = startInput();
    expect(input.type).toBe('number');
    expect(input.step).toBe('0.001');
    expect(input.min).toBe('0');
    expect(input.max).toBe('3');
    expect(input.getAttribute('aria-label')).toBe('动画开始时间（秒）');

    const unit = input.parentElement?.querySelector<HTMLElement>(
      '.animation-playback-time-unit',
    );
    expect(unit?.textContent?.trim()).toBe('秒');
    expect(unit?.getAttribute('aria-hidden')).toBe('true');
  });

  it('duplicates only from Animation Playback and keeps the existing History behavior', async () => {
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="duplicate-animation-layer"]',
    );
    expect(button).not.toBeNull();
    expect(
      container.querySelector('[data-testid="layer-order-controls"]'),
    ).toBeNull();

    await act(async () => button!.click());

    const animationLayers = editorProjectStore
      .getSnapshot()!
      .project.shots.find((candidate) => candidate.id === IDS.shot)!
      .layers.filter((candidate) => candidate.source.kind === 'animation');
    expect(animationLayers).toHaveLength(2);
    expect(new Set(animationLayers.map((candidate) => candidate.id)).size).toBe(2);
    expect(animationLayers.map((candidate) => candidate.source)).toEqual([
      { kind: 'animation', animationId: IDS.animation },
      { kind: 'animation', animationId: IDS.animation },
    ]);
    const duplicateId = animationLayers.find(
      (candidate) => candidate.id !== IDS.animationLayer,
    )!.id;
    expect(selectionStore.getSelectedLayerId()).toBe(duplicateId);
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });

    await act(async () => editorProjectStore.undo());
    expect(
      editorProjectStore.getSnapshot()!.project.shots[0]!.layers.filter(
        (candidate) => candidate.source.kind === 'animation',
      ),
    ).toHaveLength(1);
    await act(async () => editorProjectStore.redo());
    expect(
      editorProjectStore.getSnapshot()!.project.shots[0]!.layers.filter(
        (candidate) => candidate.source.kind === 'animation',
      ),
    ).toHaveLength(2);
  });

  it('cancels Escape before its synchronous blur without touching project or History', async () => {
    const originalSnapshot = editorProjectStore.getSnapshot();
    const originalHistory = editorProjectStore.history.getSnapshot();
    const input = await enterDraft('5');

    const escape = await pressKey(input, 'Escape');

    expect(escape.defaultPrevented).toBe(true);
    expect(input.value).toBe('1');
    expect(editorProjectStore.getSnapshot()).toBe(originalSnapshot);
    expect(editorProjectStore.history.getSnapshot()).toEqual(originalHistory);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });
    expect(currentAnimationLayer()?.startTimeMs).toBe(1_000);
  });

  it.each(['Enter', 'ordinary blur'])('commits a valid edit once on %s', async (commit) => {
    const input = await enterDraft('2.251');
    if (commit === 'Enter') await pressKey(input, 'Enter');
    else await blur(input);

    expect(currentAnimationLayer()?.startTimeMs).toBe(2_251);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 1,
    });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
  });

  it('does not create History for an unchanged blur', async () => {
    const input = startInput();
    await act(async () => input.focus());
    await blur(input);

    expect(editorProjectStore.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
  });

  it.each([
    ['empty', '', '请输入动画开始时间。'],
    ['NaN sanitized by the number input', 'NaN', '请输入动画开始时间。'],
    ['negative', '-0.1', '开始时间必须是 0 或更大的有效数字。'],
    ['past the Shot end', '3.001', '不能超过当前镜头时长'],
  ])('rejects %s and restores the saved start time', async (_label, value, message) => {
    const input = await enterDraft(value);
    await blur(input);

    expect(input.value).toBe('1');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
    expect(currentAnimationLayer()?.startTimeMs).toBe(1_000);
  });

  it('accepts the Shot-duration boundary and parses non-finite and negative values as invalid', async () => {
    const input = await enterDraft('3');
    await blur(input);

    expect(currentAnimationLayer()?.startTimeMs).toBe(3_000);
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(parseAnimationStartTime('NaN', 3_000).kind).toBe('invalid');
    expect(parseAnimationStartTime('-0.001', 3_000).kind).toBe('invalid');
    expect(parseAnimationStartTime('3.0001', 3_000).kind).toBe('invalid');
    expect(parseAnimationStartTime('2.9999', 3_000)).toEqual({
      kind: 'valid',
      startTimeMs: 3_000,
    });
  });

  it('drops a revision-stale draft, then accepts a fresh edit after an unrelated Layer change', async () => {
    const input = await enterDraft('5');
    await act(async () => layerStore.updatePosition(IDS.layerAsset, { x: 505, y: 600 }));

    expect(input.value).toBe('1');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('工程状态已变化');
    expect(currentAnimationLayer()?.startTimeMs).toBe(1_000);
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 1 });

    await enterDraft('2');
    await blur(input);

    expect(currentAnimationLayer()?.startTimeMs).toBe(2_000);
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: 2, dirty: true });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 2 });
  });

  it('drops a draft when the same Project ID and root are reopened as a new session', async () => {
    const input = await enterDraft('5');
    await act(async () => editorProjectStore.open(PROJECT_ROOT, projectWithAnimationLayer(2_000)));

    expect(input.value).toBe('2');
    await blur(input);
    expect(currentAnimationLayer()?.startTimeMs).toBe(2_000);
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: 0, dirty: false });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 0 });
  });

  it('drops a draft when the same Project ID is opened under another root', async () => {
    const input = await enterDraft('5');
    await act(async () => editorProjectStore.open('D:/other-root.pandastage', projectWithAnimationLayer(2_000)));

    expect(container.querySelector('[data-testid="animation-start-seconds"]')).toBeNull();
    await blur(input);
    expect(currentAnimationLayer()?.startTimeMs).toBe(2_000);
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: 0, dirty: false });
  });

  it('drops a draft when selection changes and does not create a Project revision', async () => {
    const input = await enterDraft('5');
    await act(async () => selectionStore.select(IDS.layerAsset));

    expect(container.querySelector('[data-testid="animation-start-seconds"]')).toBeNull();
    expect(container.querySelector('[data-testid="animation-playback-controls"]')).toBeNull();
    expect(container.querySelector('[data-testid="duplicate-animation-layer"]')).toBeNull();
    await blur(input);
    expect(currentAnimationLayer()?.startTimeMs).toBe(1_000);
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: 0, dirty: false });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 0 });
  });

  it('drops a draft when the selected animation becomes locked', async () => {
    const input = await enterDraft('5');
    await act(async () => layerStore.setLocked(IDS.animationLayer, true));

    expect(input.disabled).toBe(true);
    expect(input.value).toBe('1');
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="duplicate-animation-layer"]',
      )?.disabled,
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        .every((tab) => tab.disabled),
    ).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('已锁定');
    expect(currentAnimationLayer()).toMatchObject({
      startTimeMs: 1_000,
      locked: true,
    });
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 1 });
  });

  it('does not commit a draft after its selected animation layer is deleted', async () => {
    const input = await enterDraft('5');
    await act(async () => layerStore.deleteLayer(IDS.animationLayer));

    expect(container.querySelector('[data-testid="animation-start-seconds"]')).toBeNull();
    await blur(input);
    expect(currentAnimationLayer()).toBeUndefined();
    expect(editorProjectStore.getSnapshot()?.project.animations).toHaveLength(1);
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 1 });
  });
});

describe('animation start edit context', () => {
  const context: AnimationStartEditContext = {
    projectInstanceId: 1,
    projectId: IDS.project,
    projectRoot: PROJECT_ROOT,
    shotId: IDS.shot,
    layerId: IDS.animationLayer,
    revision: 4,
    startTimeMs: 1_000,
    shotDurationMs: 3_000,
    locked: false,
  };

  it('matches an unchanged edit context and rejects session, path, selection, or revision changes', () => {
    expect(sameAnimationStartEditContext(context, { ...context })).toBe(true);
    expect(sameAnimationStartEditContext(context, { ...context, projectInstanceId: 2 })).toBe(false);
    expect(sameAnimationStartEditContext(context, { ...context, projectRoot: 'D:/other.pandastage' })).toBe(false);
    expect(sameAnimationStartEditContext(context, { ...context, layerId: IDS.layerAsset })).toBe(false);
    expect(sameAnimationStartEditContext(context, { ...context, revision: 5 })).toBe(false);
    expect(sameAnimationStartEditContext(context, null)).toBe(false);
  });
});
