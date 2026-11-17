// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LayerMotionService,
  LayerService,
  ProjectSchema,
  evaluateShotAtTime,
  layerCompositeKeyEasing,
  layerCompositeKeyTimes,
  layerMotionValues,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import { SelectableLayer } from '../../src/renderer/features/canvas/SelectableLayer';
import {
  LayerTransformPanel,
  useLayerTransformController,
  type LayerTransformPanelProps,
} from '../../src/renderer/features/properties/LayerTransformPanel';
import {
  isLayerMotionTransformEditableAtTime,
  isSupportedLayerMotionLayer,
} from '../../src/renderer/features/properties/layerTransformTemporalGuard';
import { TimelineDock } from '../../src/renderer/features/timeline/TimelineDock';
import { PendingDialoguePlacementProvider } from '../../src/renderer/features/timeline/PendingDialoguePlacement';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { layerStore } from '../../src/renderer/stores/layerStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../helpers/graphicFaceProject';
import { IDS } from './domain/testProject';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const TransformPanel = LayerTransformPanel as React.FunctionComponent<LayerTransformPanelProps>;

function createStandaloneGraphicProject(options: { secondGraphic?: boolean } = {}): {
  project: Project;
  graphicLayerId: string;
  secondGraphicLayerId?: string;
  imageLayerId: string;
} {
  const base = graphicFaceProject();
  const definition = base.animations[0] as FlaGraphicDefinition;
  definition.source.sourceFps = 4;
  definition.durationMs = 1_000;
  definition.frames = definition.frames.map((frame, ordinal) => ({
    ...frame,
    startMs: ordinal * 250,
    durationMs: 250,
  }));

  const cleaned: Project = ProjectSchema.parse({
    ...base,
    characters: [],
    voiceProfiles: [],
    shots: base.shots.map((shot) => ({
      ...shot,
      durationMs: 3_000,
      dialogues: [],
      timelineEvents: [],
      layers: shot.layers.filter((l) => l.id === shot.backgroundLayerId || l.id === IDS.layerAsset),
    })),
  });

  const service = new LayerService();
  const first = service.createFromAnimation(cleaned, IDS.shot, {
    animationId: FACE_GRAPHIC_ID,
    position: { x: 500, y: 400 },
    startTimeMs: 0,
    playback: { mode: 'loop', endBehavior: 'hold' },
  });
  let project = first.project;
  let secondGraphicLayerId: string | undefined;
  if (options.secondGraphic) {
    const second = service.createFromAnimation(project, IDS.shot, {
      animationId: FACE_GRAPHIC_ID,
      position: { x: 900, y: 420 },
      startTimeMs: 0,
      playback: { mode: 'loop', endBehavior: 'hold' },
    });
    project = second.project;
    secondGraphicLayerId = second.layer.id;
  }

  return {
    project,
    graphicLayerId: first.layer.id,
    secondGraphicLayerId,
    imageLayerId: IDS.layerAsset,
  };
}

function TransformHarness({ compact = true }: { compact?: boolean }) {
  const controller = useLayerTransformController({ compact });
  return createElement(TransformPanel, {
    compact,
    controller,
    showResetTransform: true,
  });
}

const TimelineDockView = TimelineDock as React.FunctionComponent<{
  presentation?: 'landscape' | 'portrait';
}>;

function TimelineHarness() {
  useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot);
  return createElement(
    PendingDialoguePlacementProvider,
    null,
    createElement(TimelineDockView, { presentation: 'landscape' }),
  );
}

function dispatchPointer(
  target: Element,
  type: string,
  init: {
    clientX?: number;
    clientY?: number;
    button?: number;
    pointerId?: number;
    pointerType?: string;
    shiftKey?: boolean;
  },
): void {
  const PointerCtor = window.PointerEvent ?? MouseEvent;
  const event = new PointerCtor(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
    shiftKey: init.shiftKey ?? false,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
  target.dispatchEvent(event);
}

async function setInputAndSubmit(
  form: HTMLFormElement,
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  await act(async () => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('Issue #1144 Layer Motion Product Wiring', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    timelineUiStore.setLayerMotionAutoKey(false);
    timelineUiStore.seek(0, 3_000);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    selectionStore.clear();
    editorProjectStore.clear();
    timelineUiStore.setLayerMotionAutoKey(false);
    timelineUiStore.seek(0, 3_000);
    vi.restoreAllMocks();
  });

  it('exposes Inspector Auto-Key for Character=0 FLA Graphic Layer, writes relative keys without double-writing static, and syncs Basis when OFF', async () => {
    const { project, graphicLayerId, imageLayerId } = createStandaloneGraphicProject();
    editorProjectStore.open('D:/test-1144-inspector', project);
    shotStore.select(IDS.shot);
    selectionStore.select(imageLayerId);

    await act(async () => root.render(createElement(TransformHarness)));
    expect(container.querySelector('[data-testid="layer-motion-auto-key"]')).toBeNull();

    await act(async () => selectionStore.select(graphicLayerId));
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="layer-motion-auto-key"]')!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    // Scrub to 500ms and turn Auto-Key ON -> 0 Project/History side effect.
    await act(async () => {
      timelineUiStore.seek(500, 3_000);
      toggle.click();
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);

    const form = container.querySelector('form')!;
    const xInput = container.querySelector<HTMLInputElement>('[data-testid="layer-transform-x"]')!;
    const rotInput = container.querySelector<HTMLInputElement>(
      '[data-testid="layer-transform-rotation"] input',
    )!;
    const scalePlus = container.querySelector<HTMLButtonElement>('button[aria-label="放大缩放"]')!;

    await setInputAndSubmit(form, xInput, '660');
    await setInputAndSubmit(form, rotInput, '45');
    await act(async () => scalePlus.click());

    const afterKeyedProject = editorProjectStore.getSnapshot()!.project;
    const afterLayer = afterKeyedProject.shots[0]!.layers.find((l) => l.id === graphicLayerId)!;
    // Static Layer coordinates remain the original 0ms base (no double write).
    expect(afterLayer.x).toBe(500);
    expect(afterLayer.y).toBe(400);
    expect(afterLayer.rotationDeg).toBe(0);
    expect(afterLayer.scaleX).toBe(1);
    expect(afterLayer.animationClip?.version).toBe(2);
    expect(layerCompositeKeyTimes(afterLayer)).toEqual([0, 500]);
    expect(
      layerMotionValues(afterKeyedProject, {
        shotId: IDS.shot,
        layerId: graphicLayerId,
        timeMs: 500,
      }),
    ).toMatchObject({
      'transform.offsetX': 160,
      'transform.rotationDeg': 45,
      'transform.scaleX': 1.1,
      'transform.scaleY': 1.1,
    });

    // Seeking 0ms displays neutral 500/0/100; seeking 500ms displays 660/45/110.
    await act(async () => timelineUiStore.seek(0, 3_000));
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="layer-transform-x"]')!.value,
    ).toBe('500');
    await act(async () => timelineUiStore.seek(500, 3_000));
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="layer-transform-x"]')!.value,
    ).toBe('660');
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="layer-transform-rotation"] input')!
        .value,
    ).toBe('45');
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="layer-transform-scale"] input')!
        .value,
    ).toBe('110');

    // Auto-Key OFF edits Basis + static together while keeping 500ms relative offset.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="layer-motion-auto-key"]')!.click();
      timelineUiStore.seek(0, 3_000);
    });
    await setInputAndSubmit(
      container.querySelector('form')!,
      container.querySelector<HTMLInputElement>('[data-testid="layer-transform-x"]')!,
      '550',
    );
    const updatedProject = editorProjectStore.getSnapshot()!.project;
    const updatedLayer = updatedProject.shots[0]!.layers.find((l) => l.id === graphicLayerId)!;
    expect(updatedLayer.x).toBe(550);
    expect(updatedLayer.animationClip?.version).toBe(2);
    if (updatedLayer.animationClip?.version === 2) {
      expect(updatedLayer.animationClip.targetBases[0]?.baseTransform.x).toBe(550);
    }
    const eval500 = evaluateShotAtTime(updatedProject.shots[0]!, 500, updatedProject).layers.find(
      (l) => l.id === graphicLayerId,
    )!;
    expect(eval500.x).toBe(710);
  });

  it('wires Stage continuity (including 0ms Clip v2), single-gesture History, and editability guards', () => {
    const { project, graphicLayerId, secondGraphicLayerId, imageLayerId } =
      createStandaloneGraphicProject({ secondGraphic: true });
    editorProjectStore.open('D:/test-1144-stage', project);
    shotStore.select(IDS.shot);
    selectionStore.select(graphicLayerId);

    const shot = editorProjectStore.getSnapshot()!.project.shots[0]!;
    expect(
      isSupportedLayerMotionLayer(
        project,
        shot,
        shot.layers.find((l) => l.id === graphicLayerId),
      ),
    ).toBe(true);
    expect(
      isSupportedLayerMotionLayer(
        project,
        shot,
        shot.layers.find((l) => l.id === imageLayerId),
      ),
    ).toBe(false);
    expect(isLayerMotionTransformEditableAtTime(project, IDS.shot, graphicLayerId, 500)).toBe(true);
    expect(isLayerMotionTransformEditableAtTime(project, IDS.shot, imageLayerId, 500)).toBe(false);

    // Stage move + transform gesture at 500ms records 1 History per commit and leaves sibling instance untouched.
    const baseline = editorProjectStore.getSnapshot()!.project;
    layerStore.applyMotionTransform(graphicLayerId, 500, true, { x: 640, y: 360 });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);

    layerStore.applyMotionTransform(graphicLayerId, 500, true, {
      scaleX: 1.5,
      scaleY: 1.5,
      rotationDeg: 30,
    });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);

    // No-op commit produces 0 extra History entries.
    layerStore.applyMotionTransform(graphicLayerId, 500, true, {
      x: 640,
      y: 360,
      scaleX: 1.5,
      scaleY: 1.5,
      rotationDeg: 30,
    });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);

    // Sibling instance using same Definition has zero tracks written.
    const current = editorProjectStore.getSnapshot()!.project;
    const secondLayer = current.shots[0]!.layers.find((l) => l.id === secondGraphicLayerId)!;
    expect(secondLayer.animationClip).toBeUndefined();
    // Graphic internal frame continues advancing at 500ms (ordinal 2).
    const evalGraphic500 = evaluateShotAtTime(current.shots[0]!, 500, current).layers.find(
      (l) => l.id === graphicLayerId,
    )!;
    expect(evalGraphic500.animationFrame?.frameOrdinal).toBe(2);

    // Even a non-zero 0ms key offset is reflected by buildEditorTemporalCanvasModel at 0ms.
    layerStore.applyMotionTransform(graphicLayerId, 0, true, { x: 525 });
    const withZeroOffset = editorProjectStore.getSnapshot()!.project;
    const editorZero = buildEditorTemporalCanvasModel({
      project: withZeroOffset,
      shot: withZeroOffset.shots[0]!,
      currentTimeMs: 0,
      readyAssetIds: new Set(withZeroOffset.assets.map((a) => a.id)),
      previousVisuals: new Map(),
    });
    const renderedAtZero = editorZero.stageModel.layers.find(
      (l) => l.layer.id === graphicLayerId,
    )!;
    expect(renderedAtZero.render.x).toBe(525);

    expect(editorProjectStore.history.undo()).toBe(true);
    expect(editorProjectStore.history.undo()).toBe(true);
    expect(editorProjectStore.history.undo()).toBe(true);
    expect(editorProjectStore.getSnapshot()!.project).toEqual(baseline);
  });

  it('renders Timeline「对象动作」Lane with Composite Keys, retime, Copy/Paste, Delete, Easing, Shift batch move, and Touch nearest-hit routing', async () => {
    const { project, graphicLayerId, imageLayerId } = createStandaloneGraphicProject();
    const motion = new LayerMotionService();
    let seeded = motion.applyKeys(
      project,
      { shotId: IDS.shot, layerId: graphicLayerId, timeMs: 500 },
      { 'transform.offsetX': 120, 'transform.rotationDeg': 30 },
    );
    seeded = motion.applyKeys(
      seeded,
      { shotId: IDS.shot, layerId: graphicLayerId, timeMs: 1_000 },
      { 'transform.offsetX': 240, 'transform.rotationDeg': 60 },
    );
    editorProjectStore.open('D:/test-1144-timeline', seeded);
    shotStore.select(IDS.shot);
    selectionStore.select(imageLayerId);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList?.contains('character-motion-keys')) {
        return {
          left: 100,
          right: 700,
          top: 0,
          bottom: 38,
          width: 600,
          height: 38,
          x: 100,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        left: 0,
        right: 800,
        top: 0,
        bottom: 40,
        width: 800,
        height: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    await act(async () => root.render(createElement(TimelineHarness)));
    expect(container.querySelector('[data-testid="layer-motion-lane"]')).toBeNull();

    // Selecting FLA Graphic Layer displays single「对象动作」Lane + portal toolbar.
    await act(async () => selectionStore.select(graphicLayerId));
    const lane = container.querySelector('[data-testid="layer-motion-lane"]')!;
    expect(lane).not.toBeNull();
    expect(lane.querySelector('.timeline-lane-label')?.textContent).toBe('对象动作');

    const keysWrap = lane.querySelector('.character-motion-keys')!;
    const markers = () =>
      Array.from(keysWrap.querySelectorAll<HTMLButtonElement>('button[data-time-ms]'));
    expect(markers().map((m) => m.dataset.timeMs)).toEqual(['0', '500', '1000']);

    // Click 500ms marker -> selects it & seeks playhead with 0 History.
    await act(async () => markers()[1]!.click());
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(500);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);

    // Outgoing easing at 500ms -> ease-in-out.
    const easingSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="layer-motion-easing"]',
    )!;
    await act(async () => {
      easingSelect.value = 'ease-in-out';
      easingSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(
      layerCompositeKeyEasing(
        editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find(
          (l) => l.id === graphicLayerId,
        )!,
        500,
      ),
    ).toBe('ease-in-out');

    // Copy pose at 500ms -> Next Key (1000ms) / Seek 1500ms -> Paste Pose.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="layer-motion-copy-pose"]')!.click();
    });
    await act(async () => timelineUiStore.seek(1_500, 3_000));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="layer-motion-paste-pose"]')!.click();
    });
    expect(
      layerCompositeKeyTimes(
        editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find(
          (l) => l.id === graphicLayerId,
        )!,
      ),
    ).toEqual([0, 500, 1_000, 1_500]);
    expect(
      layerMotionValues(editorProjectStore.getSnapshot()!.project, {
        shotId: IDS.shot,
        layerId: graphicLayerId,
        timeMs: 1_500,
      }),
    ).toMatchObject({
      'transform.offsetX': 120,
      'transform.rotationDeg': 30,
    });

    // Delete 0ms is disabled; delete 1500ms succeeds.
    await act(async () => markers()[0]!.click());
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="layer-motion-delete-key"]')!
        .disabled,
    ).toBe(true);
    await act(async () => markers()[3]!.click());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="layer-motion-delete-key"]')!.click();
    });
    expect(
      layerCompositeKeyTimes(
        editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find(
          (l) => l.id === graphicLayerId,
        )!,
      ),
    ).toEqual([0, 500, 1_000]);

    // Shift+click 500ms and 1000ms -> shows count badge; drag to shift group forward cleanly.
    const pxPerMs = Number(
      keysWrap.querySelector<HTMLButtonElement>('button[data-time-ms="1000"]')!.style.left.replace(
        'px',
        '',
      ),
    ) / 1_000;
    const undoBeforeGroup = editorProjectStore.history.getSnapshot().undoCount;
    await act(async () => markers()[1]!.click());
    await act(async () => {
      markers()[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    });
    expect(
      container.querySelector('[data-testid="layer-motion-selection-count"]')?.textContent,
    ).toContain('已选 2 个关键帧');

    const deltaPx = Math.round(250 * pxPerMs);
    await act(async () => {
      const m500 = markers()[1]!;
      dispatchPointer(m500, 'pointerdown', { clientX: 200, pointerType: 'mouse' });
      dispatchPointer(m500, 'pointermove', { clientX: 200 + deltaPx, pointerType: 'mouse' });
      dispatchPointer(m500, 'pointerup', { clientX: 200 + deltaPx, pointerType: 'mouse' });
    });
    const timesAfterShift = layerCompositeKeyTimes(
      editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find(
        (l) => l.id === graphicLayerId,
      )!,
    );
    expect(timesAfterShift[0]).toBe(0);
    expect(timesAfterShift[1]).toBeGreaterThan(500);
    expect(timesAfterShift[2]! - timesAfterShift[1]!).toBeGreaterThanOrEqual(450);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoBeforeGroup + 1);

    // Shift+select 0ms + moved key -> drag blocked with '基础姿势不能批量移动' and 0 History change.
    const revisionBeforeBlocked = editorProjectStore.getSnapshot()!.revision;
    const undoBeforeBlocked = editorProjectStore.history.getSnapshot().undoCount;
    await act(async () => {
      markers()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    });
    await act(async () => {
      const m0 = markers()[0]!;
      dispatchPointer(m0, 'pointerdown', { clientX: 100, pointerType: 'mouse' });
      dispatchPointer(m0, 'pointermove', { clientX: 140, pointerType: 'mouse' });
      dispatchPointer(m0, 'pointerup', { clientX: 140, pointerType: 'mouse' });
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('基础姿势不能批量移动');
    expect(editorProjectStore.getSnapshot()!.revision).toBe(revisionBeforeBlocked);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoBeforeBlocked);

    // Touch ±22px nearest-hit capture routes to closest key cleanly.
    const thirdTimeMs = timesAfterShift[2]!;
    const thirdLocalX = thirdTimeMs * pxPerMs;
    await act(async () => {
      dispatchPointer(keysWrap, 'pointerdown', {
        clientX: 100 + thirdLocalX + 12,
        pointerId: 9,
        pointerType: 'touch',
      });
      dispatchPointer(keysWrap, 'pointerup', {
        clientX: 100 + thirdLocalX + 12,
        pointerId: 9,
        pointerType: 'touch',
      });
    });
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(thirdTimeMs);
  });

  it('freezes Copy/Paste pose snapshot on sparse properties across source edit, retime, delete, and scope switch (#1145)', async () => {
    const { project, graphicLayerId, secondGraphicLayerId } = createStandaloneGraphicProject({
      secondGraphic: true,
    });
    const motion = new LayerMotionService();
    // Sparse tracks ONLY: transform.offsetX & transform.rotationDeg (no offsetY/scaleX/scaleY).
    const seeded = motion.applyKeys(
      project,
      { shotId: IDS.shot, layerId: graphicLayerId, timeMs: 500 },
      { 'transform.offsetX': 120, 'transform.rotationDeg': 30 },
    );
    editorProjectStore.open('D:/test-1145-clipboard', seeded);
    shotStore.select(IDS.shot);
    selectionStore.select(graphicLayerId);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);

    await act(async () => root.render(createElement(TimelineHarness)));
    const markers = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="layer-motion-lane"] button[data-time-ms]'));

    // Copy at 500ms.
    await act(async () => markers()[1]!.click());
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="layer-motion-copy-pose"]')!.click();
    });

    // Mutate source key at 500ms, retime 500ms -> 750ms, then delete 750ms completely!
    await act(async () => {
      const m1 = motion.applyKeys(
        editorProjectStore.getSnapshot()!.project,
        { shotId: IDS.shot, layerId: graphicLayerId, timeMs: 500 },
        { 'transform.offsetX': 480, 'transform.rotationDeg': 90 },
      );
      const m2 = motion.retimeKey(m1, {
        shotId: IDS.shot,
        layerId: graphicLayerId,
        fromTimeMs: 500,
        toTimeMs: 750,
      });
      const m3 = motion.deleteKey(m2, {
        shotId: IDS.shot,
        layerId: graphicLayerId,
        timeMs: 750,
      });
      editorProjectStore.updateProject(m3, 'Mutate/retime/delete copied key');
    });

    // Paste at 1500ms -> STILL writes frozen snapshot (120, 30) and keeps sparse tracks (1 History).
    const undoBeforePaste = editorProjectStore.history.getSnapshot().undoCount;
    await act(async () => timelineUiStore.seek(1_500, 3_000));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="layer-motion-paste-pose"]')!.click();
    });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoBeforePaste + 1);
    const pastedProject = editorProjectStore.getSnapshot()!.project;
    const pastedLayer = pastedProject.shots[0]!.layers.find((l) => l.id === graphicLayerId)!;
    const clip = pastedLayer.animationClip;
    expect(clip?.version).toBe(2);
    // Missing sparse properties (offsetY, scaleX, scaleY) must NOT be materialized.
    if (clip?.version === 2) {
      expect(clip.tracks.map((t) => t.property).sort()).toEqual([
        'transform.offsetX',
        'transform.rotationDeg',
      ]);
    }
    expect(
      layerMotionValues(pastedProject, {
        shotId: IDS.shot,
        layerId: graphicLayerId,
        timeMs: 1_500,
      }),
    ).toMatchObject({
      'transform.offsetX': 120,
      'transform.rotationDeg': 30,
      'transform.scaleX': 1,
      'transform.scaleY': 1,
    });

    // Switching selected Layer clears clipboard isolation cleanly.
    await act(async () => selectionStore.select(secondGraphicLayerId!));
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="layer-motion-paste-pose"]')?.disabled,
    ).toBe(true);
  });

  it('preserves non-uniform scale (2, 1) across SelectableLayer rotate-only gestures while keeping scale gestures working (#1145)', () => {
    const { project, graphicLayerId } = createStandaloneGraphicProject();
    const nonUniformProject: Project = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shotCandidate) => ({
        ...shotCandidate,
        layers: shotCandidate.layers.map((layerCandidate) =>
          layerCandidate.id === graphicLayerId
            ? { ...layerCandidate, scaleX: 2, scaleY: 1 }
            : layerCandidate,
        ),
      })),
    });
    editorProjectStore.open('D:/test-1145-nonuniform', nonUniformProject);
    shotStore.select(IDS.shot);
    selectionStore.select(graphicLayerId);
    timelineUiStore.seek(500, 3_000);

    const shot = editorProjectStore.getSnapshot()!.project.shots[0]!;
    const layer = shot.layers.find((l) => l.id === graphicLayerId)!;
    const temporalModel = buildEditorTemporalCanvasModel({
      project: editorProjectStore.getSnapshot()!.project,
      shot,
      currentTimeMs: 500,
      readyAssetIds: new Set(nonUniformProject.assets.map((a) => a.id)),
      previousVisuals: new Map(),
    });
    const stageLayer = temporalModel.stageModel.layers.find((l) => l.layer.id === graphicLayerId)!;
    const axisCommits: Array<{
      x: number;
      y: number;
      scaleX: number;
      scaleY: number;
      rotationDeg: number;
    }> = [];

    const element = SelectableLayer({
      layer,
      nodeRef: { current: null },
      render: stageLayer.render,
      selected: true,
      onSelect: vi.fn(),
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onCommitAxisTransform: (_id, next) => {
        axisCommits.push(next);
        const current = editorProjectStore.getSnapshot()!.project;
        const evalLayer = evaluateShotAtTime(
          current.shots[0]!,
          timelineUiStore.getSnapshot().currentTimeMs,
          current,
        ).layers.find((l) => l.id === graphicLayerId)!;
        const patch: {
          x?: number;
          y?: number;
          scaleX?: number;
          scaleY?: number;
          rotationDeg?: number;
        } = {};
        if (Math.abs(next.x - evalLayer.x) > 1e-5) patch.x = next.x;
        if (Math.abs(next.y - evalLayer.y) > 1e-5) patch.y = next.y;
        if (Math.abs(next.scaleX - evalLayer.scaleX) > 1e-5) patch.scaleX = next.scaleX;
        if (Math.abs(next.scaleY - evalLayer.scaleY) > 1e-5) patch.scaleY = next.scaleY;
        if (Math.abs(next.rotationDeg - evalLayer.rotationDeg) > 1e-5) {
          patch.rotationDeg = next.rotationDeg;
        }
        if (Object.keys(patch).length > 0) {
          layerStore.applyMotionTransform(
            graphicLayerId,
            timelineUiStore.getSnapshot().currentTimeMs,
            timelineUiStore.getSnapshot().layerMotionAutoKey,
            patch,
          );
        }
      },
      onError: vi.fn(),
    });

    let scaleX = 2;
    let scaleY = 1;
    let rotation = 0;
    const targetNode = {
      x: () => stageLayer.render.x,
      y: () => stageLayer.render.y,
      scaleX: (val?: number) => {
        if (val !== undefined) scaleX = val;
        return scaleX;
      },
      scaleY: (val?: number) => {
        if (val !== undefined) scaleY = val;
        return scaleY;
      },
      rotation: () => rotation,
      position: vi.fn(),
      scale: vi.fn(),
    };
    const handlers = element.props as {
      onTransformEnd: (event: { target: typeof targetNode }) => void;
    };

    // 1. Rotate-only with Auto-Key OFF: scaleY must stay 1 (never overwritten with 2), static/Basis untouched.
    timelineUiStore.setLayerMotionAutoKey(false);
    rotation = 45;
    handlers.onTransformEnd({ target: targetNode });
    expect(scaleX).toBe(2);
    expect(scaleY).toBe(1);
    expect(axisCommits[0]).toMatchObject({ scaleX: 2, scaleY: 1, rotationDeg: 45 });
    const afterRotateOff = editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find(
      (l) => l.id === graphicLayerId,
    )!;
    expect(afterRotateOff.scaleX).toBe(2);
    expect(afterRotateOff.scaleY).toBe(1);
    expect(afterRotateOff.rotationDeg).toBe(45);
    expect(afterRotateOff.animationClip).toBeUndefined();

    // 2. Rotate-only with Auto-Key ON: creates ONLY rotation track, keeps scaleX=2/scaleY=1 with zero scale keys!
    timelineUiStore.setLayerMotionAutoKey(true);
    rotation = 90;
    handlers.onTransformEnd({ target: targetNode });
    expect(scaleX).toBe(2);
    expect(scaleY).toBe(1);
    const afterRotateOnProj = editorProjectStore.getSnapshot()!.project;
    const afterRotateOn = afterRotateOnProj.shots[0]!.layers.find(
      (l) => l.id === graphicLayerId,
    )!;
    expect(afterRotateOn.scaleX).toBe(2);
    expect(afterRotateOn.scaleY).toBe(1);
    if (afterRotateOn.animationClip?.version === 2) {
      expect(afterRotateOn.animationClip.tracks.map((t) => t.property)).toEqual([
        'transform.rotationDeg',
      ]);
    }
    const evalAfterRotateOn = evaluateShotAtTime(
      afterRotateOnProj.shots[0]!,
      500,
      afterRotateOnProj,
    ).layers.find((l) => l.id === graphicLayerId)!;
    expect(evalAfterRotateOn).toMatchObject({ scaleX: 2, scaleY: 1, rotationDeg: 90 });

    // 3. Real scale gesture (e.g. 1.5x keepRatio -> scaleX=3, scaleY=1.5): writes both scales accurately & keeps 1 History.
    const undoBeforeScale = editorProjectStore.history.getSnapshot().undoCount;
    scaleX = 3;
    scaleY = 1.5;
    handlers.onTransformEnd({ target: targetNode });
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoBeforeScale + 1);
    const evalAfterScale = evaluateShotAtTime(
      editorProjectStore.getSnapshot()!.project.shots[0]!,
      500,
      editorProjectStore.getSnapshot()!.project,
    ).layers.find((l) => l.id === graphicLayerId)!;
    expect(evalAfterScale).toMatchObject({ scaleX: 3, scaleY: 1.5, rotationDeg: 90 });
  });
});
