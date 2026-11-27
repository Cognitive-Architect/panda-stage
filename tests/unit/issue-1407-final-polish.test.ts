// @vitest-environment happy-dom
import { randomUUID } from 'node:crypto';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import demo from '../../demo-project/project-v1.example.json';
import {
  addShotCameraOverride,
  applyCameraMotionPreset,
  migrateProject,
  planCameraMotionPreset,
  prepareShotCamera,
  ProjectSchema,
  setLayerDepth,
  setShotCameraKey,
  setShotCameraMode,
  ShotService,
  sliceAnimationCurve,
  type Layer,
} from '../../src/domain';
import * as cameraPresetsModule from '../../src/domain/camera-motion-presets';
import * as evaluateShotModule from '../../src/domain/evaluate-shot-at-time';
import * as shotCameraModule from '../../src/domain/shot-camera';
import { ShotCameraControls } from '../../src/renderer/features/canvas/ShotCameraControls';
import { LayerDepthControl } from '../../src/renderer/features/properties/LayerDepthControl';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OVR_A = '34000000-0000-4000-8000-000000000001';
const OVR_B = '34000000-0000-4000-8000-000000000002';

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

function mountElement(element: React.JSX.Element): HTMLDivElement {
  unmountElement();
  mountedContainer = document.createElement('div');
  document.body.appendChild(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  act(() => {
    mountedRoot!.render(element);
  });
  return mountedContainer;
}

function rerenderElement(element: React.JSX.Element): void {
  if (!mountedRoot) throw new Error('Expected mounted root');
  act(() => {
    mountedRoot!.render(element);
  });
}

function unmountElement(): void {
  if (mountedRoot) {
    act(() => {
      mountedRoot!.unmount();
    });
    mountedRoot = null;
  }
  if (mountedContainer) {
    mountedContainer.remove();
    mountedContainer = null;
  }
}

function openDetails(details: HTMLDetailsElement): void {
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
}

function closeDetails(details: HTMLDetailsElement): void {
  act(() => {
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
  });
}

function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
}

afterEach(() => {
  unmountElement();
  shotStore.selectCameraOverride(null);
  timelineUiStore.seek(0, 10_000);
  vi.restoreAllMocks();
});

describe('Issue #1407 Wave A/B Final Polish Review Fixes', () => {
  describe('P2-01 (#1398): curve control-point numeric inputs ignore no-op blur/Enter/Escape and preserve exact values & curve.window', () => {
    it('preserves high-precision cubic bezier (1/3) and equivalent curve.window on focus/blur, Enter, and Escape, and commits real edits once', () => {
      const base = migrateProject(structuredClone(demo));
      const shotId = base.shots[0]!.id;
      let project = setShotCameraMode(base, shotId, 'manual');
      const exactBezier = { x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 1 };
      project = setShotCameraKey(project, shotId, 0, {
        centerX: 960,
        centerY: 540,
        zoom: 1,
        rotationDeg: 0,
        curveToNext: { bezier: exactBezier },
      });
      project = setShotCameraKey(project, shotId, 1_000, {
        centerX: 800,
        centerY: 500,
        zoom: 1.5,
        rotationDeg: 15,
      });

      editorProjectStore.open('D:/p201-curve-cubic.pandastage', project);
      shotStore.select(shotId);

      const renderControls = () =>
        createElement(ShotCameraControls, {
          shot: editorProjectStore.getSnapshot()!.project.shots[0]!,
          timeMs: 0,
          throughCamera: true,
          cameraTool: false,
          onViewChange: () => {},
          onToolChange: () => {},
        });

      const container = mountElement(renderControls());
      const x1Input = [...container.querySelectorAll<HTMLLabelElement>('label')]
        .find((label) => label.textContent?.startsWith('X1'))!
        .querySelector<HTMLInputElement>('input')!;
      expect(x1Input.value).toBe('0.3333');

      // 1) Focus + blur without edit => no revision/History, exact 1/3 preserved
      act(() => {
        x1Input.focus();
        x1Input.blur();
      });
      expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
      expect(editorProjectStore.getSnapshot()!.project.shots[0]!.camera!.keys[0]!.curveToNext?.bezier?.x1).toBe(1 / 3);

      // 2) Focus + unmodified Enter => no revision/History
      act(() => {
        x1Input.focus();
        x1Input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);

      // 3) Modify then Escape => reverts display and writes zero History
      act(() => {
        x1Input.focus();
        x1Input.value = '0.5';
        x1Input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(x1Input.value).toBe('0.3333');
      expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
      expect(editorProjectStore.getSnapshot()!.project.shots[0]!.camera!.keys[0]!.curveToNext?.bezier?.x1).toBe(1 / 3);

      // 4) Equivalent windowed curve: focus/blur and Escape MUST preserve curve.window untouched!
      const windowedCurve = sliceAnimationCurve({ bezier: exactBezier }, 0, 0.5);
      const windowedProject = setShotCameraKey(project, shotId, 0, {
        curveToNext: windowedCurve,
      });
      editorProjectStore.open('D:/p201-curve-window.pandastage', windowedProject);
      shotStore.select(shotId);
      rerenderElement(renderControls());

      const winX1Input = [...container.querySelectorAll<HTMLLabelElement>('label')]
        .find((label) => label.textContent?.startsWith('X1'))!
        .querySelector<HTMLInputElement>('input')!;
      const initialFormatted = winX1Input.value;

      act(() => {
        winX1Input.focus();
        winX1Input.blur();
      });
      expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
      expect(editorProjectStore.getSnapshot()!.project.shots[0]!.camera!.keys[0]!.curveToNext?.window).toEqual(
        windowedCurve.window,
      );

      act(() => {
        winX1Input.focus();
        winX1Input.value = '0.45';
        winX1Input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(winX1Input.value).toBe(initialFormatted);
      expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
      expect(editorProjectStore.getSnapshot()!.project.shots[0]!.camera!.keys[0]!.curveToNext?.window).toEqual(
        windowedCurve.window,
      );

      // 5) Real valid numeric edit commits ONCE, converts to plain bezier, and is Undoable
      act(() => {
        winX1Input.focus();
        winX1Input.value = '0.25';
        winX1Input.blur();
      });
      expect(editorProjectStore.getSnapshot()!.revision).toBe(1);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
      const editedCurve = editorProjectStore.getSnapshot()!.project.shots[0]!.camera!.keys[0]!.curveToNext;
      expect(editedCurve?.window).toBeUndefined();
      expect(editedCurve?.bezier?.x1).toBe(0.25);

      expect(editorProjectStore.undo()).toBe(true);
      expect(editorProjectStore.getSnapshot()!.project.shots[0]!.camera!.keys[0]!.curveToNext?.window).toEqual(
        windowedCurve.window,
      );
      expect(editorProjectStore.redo()).toBe(true);
      expect(editorProjectStore.getSnapshot()!.project.shots[0]!.camera!.keys[0]!.curveToNext?.bezier?.x1).toBe(0.25);

      // 6) Invalid edit (X1 > X2) reverts without writing History
      rerenderElement(renderControls());
      const afterEditX1 = [...container.querySelectorAll<HTMLLabelElement>('label')]
        .find((label) => label.textContent?.startsWith('X1'))!
        .querySelector<HTMLInputElement>('input')!;
      act(() => {
        afterEditX1.focus();
        afterEditX1.value = '0.99';
        afterEditX1.blur();
      });
      expect(afterEditX1.value).toBe('0.25');
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
    });
  });

  describe('P2-02 (#1400): Hybrid new-override preset starts from effective automatic framing instead of stale manual track', () => {
    it('samples live auto-follow zoom 1.5 -> 2.025 when creating a new override in an auto interval despite existing manual keys at zoom 2.0', () => {
      const base = migrateProject(structuredClone(demo));
      const shot0 = base.shots[0]!;
      const charLayer = shot0.layers.find((l) => l.source.kind === 'character')!;
      const character = base.characters.find(
        (c) => charLayer.source.kind === 'character' && c.id === charLayer.source.characterId,
      )!;
      let project = ProjectSchema.parse({
        ...base,
        shots: [
          {
            ...shot0,
            durationMs: 4_000,
            camera: undefined,
            audioClips: [],
            timelineEvents: [],
            dialogues: [
              {
                id: randomUUID(),
                characterId: character.id,
                voiceProfileId: character.defaultVoiceProfileId,
                text: '自动段说话人台词',
                startMs: 1_500,
                endMs: 3_500,
                subtitleStyleId: shot0.defaultSubtitleStyleId,
              },
            ],
          },
        ],
      });
      project = setShotCameraMode(project, shot0.id, 'hybrid');
      // Existing manual override [0, 1000) with manual key at zoom=2.0, rotationDeg=25
      project = setShotCameraKey(project, shot0.id, 0, {
        centerX: 700,
        centerY: 420,
        zoom: 2.0,
        rotationDeg: 25,
      });
      project = addShotCameraOverride(project, shot0.id, {
        id: OVR_A,
        startMs: 0,
        endMs: 1_000,
        blendInMs: 0,
        blendOutMs: 0,
      });
      project = setShotCameraKey(project, shot0.id, 1_000, {
        centerX: 700,
        centerY: 420,
        zoom: 2.0,
        rotationDeg: 25,
      });

      // At t=2000ms (pure auto interval, settled speaker-focus after 250ms transition): zoom = 1.5, rotationDeg = 0
      const effectiveBefore = prepareShotCamera(project, project.shots[0]!, 'speaker-focus')(2_000)!;
      expect(effectiveBefore.zoom).toBeCloseTo(1.5, 6);
      expect(effectiveBefore.rotationDeg ?? 0).toBe(0);

      // Apply push-in 1.35x with hybridAction='create-override' at 2000ms -> [2000, 3000)
      const applied = applyCameraMotionPreset(project, shot0.id, {
        preset: 'push-in',
        startTimeMs: 2_000,
        durationMs: 1_000,
        amplitude: 1.35,
        hybridAction: 'create-override',
      });
      const updatedShot = applied.shots[0]!;
      const startKey = updatedShot.camera!.keys.find((k) => k.timeMs === 2_000)!;
      const endKey = updatedShot.camera!.keys.find((k) => k.timeMs === 3_000)!;

      // Start key MUST equal pre-apply effective auto camera (NOT old manual zoom=2.0 / rotation=25!)
      expect(startKey.centerX).toBeCloseTo(effectiveBefore.centerX, 6);
      expect(startKey.centerY).toBeCloseTo(effectiveBefore.centerY, 6);
      expect(startKey.zoom).toBeCloseTo(1.5, 6);
      expect(startKey.rotationDeg).toBe(0);
      // End key zoom = 1.5 * 1.35 = 2.025 (NOT 2.7!)
      expect(endKey.zoom).toBeCloseTo(2.025, 6);
      expect(endKey.rotationDeg).toBe(0);

      // Existing manual override key at 0ms remains completely untouched!
      expect(updatedShot.camera!.keys.find((k) => k.timeMs === 0)).toMatchObject({
        centerX: 700,
        centerY: 420,
        zoom: 2.0,
        rotationDeg: 25,
      });

      // Explicit startPose still takes precedence over sampled auto view
      const explicitStart = planCameraMotionPreset(project, shot0.id, {
        preset: 'push-in',
        startTimeMs: 2_000,
        durationMs: 1_000,
        amplitude: 1.35,
        startPose: { zoom: 1.2, rotationDeg: 10 },
        hybridAction: 'create-override',
      });
      expect(explicitStart.keysToWrite[0]!.zoom).toBeCloseTo(1.2, 6);
      expect(explicitStart.keysToWrite[0]!.rotationDeg).toBe(10);
      expect(explicitStart.keysToWrite[1]!.zoom).toBeCloseTo(1.62, 6);

      // Reusing an existing manual override STILL starts from manual track (zoom 2.0 -> 2.7)
      const reusePlan = planCameraMotionPreset(project, shot0.id, {
        preset: 'push-in',
        startTimeMs: 250,
        durationMs: 500,
        amplitude: 1.35,
        hybridAction: 'use-selected-override',
        selectedOverrideId: OVR_A,
      });
      expect(reusePlan.keysToWrite[0]!.zoom).toBeCloseTo(2.0, 6);
      expect(reusePlan.keysToWrite[0]!.rotationDeg).toBe(25);
      expect(reusePlan.keysToWrite[1]!.zoom).toBeCloseTo(2.7, 6);

      // Single Undo/Redo & JSON save/reopen parity
      editorProjectStore.open('D:/p202-hybrid-preset.pandastage', project);
      editorProjectStore.updateProject(applied, '应用运镜预设');
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
      const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(editorProjectStore.getSnapshot()!.project)));
      expect(prepareShotCamera(reopened, reopened.shots[0]!, 'speaker-focus')(2_000)?.zoom).toBeCloseTo(1.5, 6);
      expect(prepareShotCamera(reopened, reopened.shots[0]!, 'speaker-focus')(2_750)?.zoom).toBeGreaterThan(1.5);
      expect(editorProjectStore.undo()).toBe(true);
      expect(editorProjectStore.getSnapshot()!.project.shots[0]!.camera!.overrides).toHaveLength(1);
    });
  });

  describe('P2-03 (#1400): overwrite confirmation is bound to current conflict range & keys', () => {
    it('invalidates prior overwrite confirmation when playhead, duration, returnToStart, external key edit, or shot/project changes, while surviving harmless re-renders', () => {
      const base = migrateProject(structuredClone(demo));
      const shotId = base.shots[0]!.id;
      let project = setShotCameraMode(base, shotId, 'manual');
      project = setShotCameraKey(project, shotId, 250, { centerX: 900, centerY: 540, zoom: 1.1, rotationDeg: 0 });
      project = setShotCameraKey(project, shotId, 1_500, { centerX: 820, centerY: 540, zoom: 1.4, rotationDeg: 0 });
      project = new ShotService().create(project, { name: 'Shot 2', durationMs: 4_000 });
      project = setShotCameraMode(project, project.shots[1]!.id, 'manual');
      project = setShotCameraKey(project, project.shots[1]!.id, 250, { centerX: 960, centerY: 540, zoom: 1.2, rotationDeg: 0 });

      editorProjectStore.open('D:/p203-overwrite.pandastage', project);
      shotStore.select(shotId);

      const renderAt = (timeMs: number, shotIndex = 0) =>
        createElement(ShotCameraControls, {
          shot: editorProjectStore.getSnapshot()!.project.shots[shotIndex]!,
          timeMs,
          throughCamera: true,
          cameraTool: false,
          onViewChange: () => {},
          onToolChange: () => {},
        });

      const container = mountElement(renderAt(0));
      openDetails(container.querySelector<HTMLDetailsElement>('details.shot-camera-control')!);
      openDetails(container.querySelector<HTMLDetailsElement>('details.shot-camera-presets')!);

      const getOverwriteCheckbox = () =>
        [...container.querySelectorAll<HTMLLabelElement>('label.shot-camera-checkbox')]
          .find((l) => l.textContent?.includes('覆盖已有关键帧'))
          ?.querySelector<HTMLInputElement>('input') ?? null;
      const getApplyBtn = () =>
        [...container.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent === '应用运镜',
        )!;

      // Range A [0, 1000] conflicts with key@250
      let checkbox = getOverwriteCheckbox()!;
      expect(checkbox).not.toBeNull();
      expect(checkbox.checked).toBe(false);
      expect(getApplyBtn().disabled).toBe(true);

      // Confirm overwrite for range A
      act(() => {
        checkbox.click();
      });
      expect(getOverwriteCheckbox()!.checked).toBe(true);
      expect(getApplyBtn().disabled).toBe(false);

      // Normal re-render on SAME plan MUST NOT clear confirmation
      rerenderElement(renderAt(0));
      expect(getOverwriteCheckbox()!.checked).toBe(true);
      expect(getApplyBtn().disabled).toBe(false);

      // Move playhead to 1000ms -> range B [1000, 2000] conflicts with key@1500 -> old confirmation MUST be invalid!
      rerenderElement(renderAt(1_000));
      checkbox = getOverwriteCheckbox()!;
      expect(checkbox).not.toBeNull();
      expect(checkbox.checked).toBe(false);
      expect(getApplyBtn().disabled).toBe(true);

      // Confirm for range B, then change duration (1000 -> 500) -> still conflicts with 1500, range changed -> invalidated!
      act(() => {
        checkbox.click();
      });
      expect(getOverwriteCheckbox()!.checked).toBe(true);
      const durationInput = container.querySelector<HTMLInputElement>('input[aria-label="预设时长"]')!;
      act(() => {
        setNativeValue(durationInput, '500');
        durationInput.dispatchEvent(new Event('input', { bubbles: true }));
        durationInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(getOverwriteCheckbox()!.checked).toBe(false);
      expect(getApplyBtn().disabled).toBe(true);

      // Confirm, then toggle returnToStart -> range expands -> invalidated!
      act(() => {
        getOverwriteCheckbox()!.click();
      });
      expect(getOverwriteCheckbox()!.checked).toBe(true);
      const returnCheckbox = [...container.querySelectorAll<HTMLLabelElement>('label.shot-camera-checkbox')]
        .find((l) => l.textContent?.includes('结束后回原构图'))!
        .querySelector<HTMLInputElement>('input')!;
      act(() => {
        returnCheckbox.click();
      });
      expect(getOverwriteCheckbox()!.checked).toBe(false);

      // Confirm on range [0, 1000], then external edit modifies key@250 -> invalidated!
      act(() => {
        returnCheckbox.click(); // off
      });
      rerenderElement(renderAt(0));
      act(() => {
        getOverwriteCheckbox()!.click();
      });
      expect(getOverwriteCheckbox()!.checked).toBe(true);
      act(() => {
        const mutated = setShotCameraKey(editorProjectStore.getSnapshot()!.project, shotId, 250, { zoom: 1.9 });
        editorProjectStore.updateProject(mutated, 'External key edit');
      });
      rerenderElement(renderAt(0));
      expect(getOverwriteCheckbox()!.checked).toBe(false);

      // Confirm on Shot 1, then switch to Shot 2 (which also has key@250!) -> invalidated!
      act(() => {
        getOverwriteCheckbox()!.click();
      });
      expect(getOverwriteCheckbox()!.checked).toBe(true);
      act(() => {
        shotStore.select(project.shots[1]!.id);
      });
      rerenderElement(renderAt(0, 1));
      expect(getOverwriteCheckbox()!.checked).toBe(false);

      // Explicitly confirm on Shot 2 and apply -> succeeds with 1 Undo restoring key@250
      const undoBefore = editorProjectStore.history.getSnapshot().undoCount;
      act(() => {
        getOverwriteCheckbox()!.click();
      });
      expect(getApplyBtn().disabled).toBe(false);
      act(() => {
        getApplyBtn().click();
      });
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(undoBefore + 1);
      expect(editorProjectStore.undo()).toBe(true);
      expect(
        editorProjectStore.getSnapshot()!.project.shots[1]!.camera!.keys.some((k) => k.timeMs === 250),
      ).toBe(true);
    });
  });

  describe('P3-01 (#1400): collapsed camera/preset details do not run preset planner on seek', () => {
    it('invokes zero planCameraMotionPreset / prepareShotCamera / evaluateShotAtTime calls while outer or inner details are closed, and plans immediately when expanded', () => {
      const base = migrateProject(structuredClone(demo));
      const shotId = base.shots[0]!.id;
      let project = setShotCameraMode(base, shotId, 'hybrid');
      project = addShotCameraOverride(project, shotId, { id: OVR_B, startMs: 0, endMs: 1_000, blendInMs: 0, blendOutMs: 0 });
      editorProjectStore.open('D:/p301-lazy-preset.pandastage', project);
      shotStore.select(shotId);

      const planSpy = vi.spyOn(cameraPresetsModule, 'planCameraMotionPreset');
      const prepCamSpy = vi.spyOn(shotCameraModule, 'prepareShotCamera');
      const evalShotSpy = vi.spyOn(evaluateShotModule, 'evaluateShotAtTime');

      const renderAt = (timeMs: number) =>
        createElement(ShotCameraControls, {
          shot: editorProjectStore.getSnapshot()!.project.shots[0]!,
          timeMs,
          throughCamera: true,
          cameraTool: false,
          onViewChange: () => {},
          onToolChange: () => {},
        });

      const container = mountElement(renderAt(0));
      // 1) Outer closed: seeking across multiple frames calls planner 0 times
      for (const t of [42, 83, 250, 500, 750]) {
        rerenderElement(renderAt(t));
      }
      expect(planSpy).toHaveBeenCalledTimes(0);
      expect(prepCamSpy).toHaveBeenCalledTimes(0);
      expect(evalShotSpy).toHaveBeenCalledTimes(0);

      // 2) Outer open, inner presets collapsed: seeking still calls planner 0 times
      const outer = container.querySelector<HTMLDetailsElement>('details.shot-camera-control')!;
      openDetails(outer);
      for (const t of [1_000, 1_250, 1_500]) {
        rerenderElement(renderAt(t));
      }
      expect(planSpy).toHaveBeenCalledTimes(0);
      expect(prepCamSpy).toHaveBeenCalledTimes(0);
      expect(evalShotSpy).toHaveBeenCalledTimes(0);

      // 3) Expand inner presets -> computes plan immediately; collapsing stops again; no Project/History writes
      const inner = container.querySelector<HTMLDetailsElement>('details.shot-camera-presets')!;
      openDetails(inner);
      expect(planSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const countAfterOpen = planSpy.mock.calls.length;
      rerenderElement(renderAt(250));
      expect(planSpy.mock.calls.length).toBe(countAfterOpen + 1);

      closeDetails(inner);
      const countAfterClose = planSpy.mock.calls.length;
      rerenderElement(renderAt(500));
      expect(planSpy.mock.calls.length).toBe(countAfterClose);
      expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
    });
  });

  describe('P3-02 (#1397): static independent depth numeric input preserves full exact precision', () => {
    it('displays exact 123.456 without 2-decimal truncation, does not mutate on view/blur, and commits real edits once', () => {
      const base = migrateProject(structuredClone(demo));
      const asset = base.assets.find((a) => a.kind === 'image')!;
      const layerId = randomUUID();
      const targetLayer: Layer = {
        id: layerId,
        name: '精确深度层',
        source: { kind: 'asset', assetId: asset.id },
        anchor: 'center',
        x: 640,
        y: 420,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
        opacity: 1,
        visible: true,
        zIndex: 5,
        locked: false,
        flipX: false,
        depth: 123.456,
      };
      const project = ProjectSchema.parse({
        ...base,
        shots: [
          {
            ...base.shots[0]!,
            durationMs: 2_000,
            dialogues: [],
            audioClips: [],
            timelineEvents: [],
            layers: [base.shots[0]!.layers[0]!, targetLayer],
          },
        ],
      });

      editorProjectStore.open('D:/p302-exact-depth.pandastage', project);
      shotStore.select(project.shots[0]!.id);
      selectionStore.select(layerId);
      timelineUiStore.seek(0, 2_000);

      const snap = editorProjectStore.getSnapshot()!;
      const shot = snap.project.shots[0]!;
      const layer = shot.layers.find((l) => l.id === layerId)!;
      const container = mountElement(createElement(LayerDepthControl, { layer, shot, snapshot: snap }));

      const input = container.querySelector<HTMLInputElement>(`#layer-depth-input-${layerId}`)!;
      expect(input.value).toBe('123.456');

      // Focus + blur without change => exact 123.456 preserved, zero History
      act(() => {
        input.focus();
        input.blur();
      });
      expect(editorProjectStore.getSnapshot()!.revision).toBe(0);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);
      expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === layerId)!.depth).toBe(123.456);

      // Escape after typing => reverts to exact 123.456, zero History
      act(() => {
        input.focus();
        input.value = '200';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(input.value).toBe('123.456');
      expect(editorProjectStore.getSnapshot()!.revision).toBe(0);

      // Real edit commits once with full precision
      act(() => {
        input.focus();
        input.value = '234.5678';
        input.blur();
      });
      expect(editorProjectStore.getSnapshot()!.revision).toBe(1);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
      expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.find((l) => l.id === layerId)!.depth).toBe(234.5678);

      // Verify setLayerDepth preserves exact precision too
      const direct = setLayerDepth(project, shot.id, layerId, -45.6789);
      expect(direct.shots[0]!.layers.find((l) => l.id === layerId)!.depth).toBe(-45.6789);
    });
  });
});
