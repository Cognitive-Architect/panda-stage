import { readFileSync } from 'node:fs';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { LayerService, ShotService, type Layer } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { OpacityPreviewStore } from '../../src/renderer/stores/opacityPreviewStore';
import {
  LayerOpacityControl,
  isOpacitySliderKey,
} from '../../src/renderer/features/properties/LayerBackgroundControl';
import {
  cancelActiveOpacityPreview,
  type LayerTransformController,
} from '../../src/renderer/features/properties/LayerTransformPanel';
import { buildProject, IDS } from './domain/testProject';

function harness() {
  const editor = new EditorProjectStore();
  editor.open('D:/opacity-preview.pandastage', buildProject());
  const shots = new ShotStore(editor, new ShotService());
  const selection = new LayerSelectionStore(editor, shots);
  const layers = new LayerStore(editor, shots, new LayerService());
  let timeMs = 0;
  const timeListeners = new Set<() => void>();
  const timeline = {
    getSnapshot: () => ({ currentTimeMs: timeMs }),
    subscribe: (listener: () => void) => {
      timeListeners.add(listener);
      return () => timeListeners.delete(listener);
    },
  };
  const preview = new OpacityPreviewStore({
    editorStore: editor,
    shotSelection: shots,
    layerSelection: selection,
    timeline,
  });
  selection.select(IDS.layerChar);
  const layer = (id: string = IDS.layerChar): Layer =>
    editor.getSnapshot()!.project.shots
      .find((shot) => shot.id === shots.getCurrentShotId())!.layers
      .find((candidate) => candidate.id === id)!;
  const commit = (id: string, opacity: number): void => {
    const current = layer(id);
    layers.updateTransform(id, {
      x: current.x,
      y: current.y,
      scale: current.scaleX,
      rotationDeg: current.rotationDeg,
      opacity,
      flipX: current.flipX,
    });
  };
  return {
    editor,
    shots,
    selection,
    layers,
    preview,
    layer,
    commit,
    setTime(value: number) {
      timeMs = value;
      for (const listener of timeListeners) listener();
    },
    dispose() {
      preview.dispose();
      selection.dispose();
      shots.dispose();
    },
  };
}

const activeHarnesses: ReturnType<typeof harness>[] = [];
function createHarness() {
  const value = harness();
  activeHarnesses.push(value);
  return value;
}
afterEach(() => {
  for (const value of activeHarnesses.splice(0)) value.dispose();
});

describe('Issue #643 runtime opacity preview', () => {
  it('previews many values without Project/History writes, then commits one Transform with Undo/Redo', () => {
    const h = createHarness();
    const session = h.preview.begin(IDS.layerChar)!;
    const originalRevision = h.editor.getSnapshot()!.revision;
    const originalProject = h.editor.getSnapshot()!.project;
    for (const opacity of [0.82, 0.65, 0.5]) {
      expect(session.setOpacity(opacity)).toBe(true);
      expect(h.preview.getSnapshot()?.opacity).toBe(opacity);
      expect(h.editor.getSnapshot()!.project).toBe(originalProject);
      expect(h.editor.getSnapshot()!.revision).toBe(originalRevision);
      expect(h.editor.history.getSnapshot().undoCount).toBe(0);
    }
    expect(session.finish((final) => h.commit(final.layerId, final.opacity))).toBe(true);
    expect(h.preview.getSnapshot()).toBeNull();
    expect(h.layer().opacity).toBe(0.5);
    expect(h.editor.getSnapshot()!.revision).toBe(originalRevision + 1);
    expect(h.editor.history.getSnapshot()).toMatchObject({ undoCount: 1, nextUndoLabel: 'Transform layer' });
    expect(session.finish((final) => h.commit(final.layerId, final.opacity))).toBe(false);
    expect(h.editor.history.getSnapshot().undoCount).toBe(1);
    expect(h.editor.undo()).toBe(true);
    expect(h.layer().opacity).toBe(1);
    expect(h.editor.redo()).toBe(true);
    expect(h.layer().opacity).toBe(0.5);
  });

  it('previews and commits an ordinary image through the same formal Layer path', () => {
    const h = createHarness();
    h.selection.select(IDS.layerAsset);
    const session = h.preview.begin(IDS.layerAsset)!;
    expect(session.setOpacity(0.35)).toBe(true);
    expect(h.layer(IDS.layerAsset).opacity).toBe(1);
    expect(h.editor.getSnapshot()!.revision).toBe(0);
    expect(session.finish((final) => h.commit(final.layerId, final.opacity))).toBe(true);
    expect(h.layer(IDS.layerAsset).opacity).toBe(0.35);
    expect(h.editor.history.getSnapshot().undoCount).toBe(1);
  });

  it('keeps repeated keyboard preview writes ephemeral and makes no-op completion inert', () => {
    const h = createHarness();
    expect(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].every(isOpacitySliderKey)).toBe(true);
    expect(isOpacitySliderKey('Tab')).toBe(false);
    const repeated = h.preview.begin(IDS.layerChar)!;
    for (const opacity of [0.9, 0.8, 0.7, 0.6]) {
      expect(repeated.setOpacity(opacity)).toBe(true);
    }
    expect(h.editor.history.getSnapshot().undoCount).toBe(0);
    expect(repeated.finish((final) => h.commit(final.layerId, final.opacity))).toBe(true);
    expect(h.editor.history.getSnapshot().undoCount).toBe(1);
    const next = h.preview.begin(IDS.layerChar)!;
    expect(next.setOpacity(0.8)).toBe(true);
    expect(next.setOpacity(0.6)).toBe(true);
    expect(next.finish((final) => h.commit(final.layerId, final.opacity))).toBe(true);
    expect(h.editor.history.getSnapshot().undoCount).toBe(1);
  });

  it('wires pointer/touch and keyboard completion to one gesture boundary', () => {
    const calls: string[] = [];
    let active = false;
    const controller = {
      draft: { opacity: '1' },
      layer: { locked: false },
      temporalInspection: false,
      beginOpacityPreview: (kind: string) => {
        active = true;
        calls.push(`begin:${kind}`);
      },
      updateOpacityPercentDraft: (value: string) => calls.push(`update:${value}`),
      finishOpacityPreview: () => {
        if (!active) return;
        active = false;
        calls.push('finish');
      },
      cancelOpacityPreview: () => {
        if (!active) return;
        active = false;
        calls.push('cancel');
      },
    } as unknown as LayerTransformController;
    const control = LayerOpacityControl({ controller });
    const range = React.Children.toArray(control.props.children).find(
      (child) => React.isValidElement<{ 'data-testid'?: string }>(child) &&
        child.props['data-testid'] === 'layer-opacity-range',
    ) as React.ReactElement<{
      onPointerDown: (event: React.PointerEvent<HTMLInputElement>) => void;
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
      onPointerUp: () => void;
      onPointerCancel: () => void;
      onLostPointerCapture: () => void;
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
      onKeyUp: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    }>;
    expect(range).toBeDefined();
    range.props.onPointerDown({
      pointerId: 1,
      currentTarget: { setPointerCapture: () => undefined },
    } as unknown as React.PointerEvent<HTMLInputElement>);
    range.props.onChange({ target: { value: '40' } } as React.ChangeEvent<HTMLInputElement>);
    range.props.onPointerUp();
    range.props.onLostPointerCapture();
    range.props.onKeyDown({ key: 'ArrowLeft' } as React.KeyboardEvent<HTMLInputElement>);
    range.props.onChange({ target: { value: '39.9' } } as React.ChangeEvent<HTMLInputElement>);
    range.props.onKeyUp({ key: 'ArrowLeft' } as React.KeyboardEvent<HTMLInputElement>);
    range.props.onPointerDown({
      pointerId: 2,
      currentTarget: { setPointerCapture: () => undefined },
    } as unknown as React.PointerEvent<HTMLInputElement>);
    range.props.onPointerCancel();
    range.props.onLostPointerCapture();
    expect(calls).toEqual([
      'begin:pointer', 'update:40', 'finish',
      'begin:keyboard', 'update:39.9', 'finish',
      'begin:pointer', 'cancel',
    ]);
  });

  it('keeps lost capture inert after pointerup but cancels an active pointer preview', () => {
    const h = createHarness();
    const ref = { current: h.preview.begin(IDS.layerChar) };
    let draftResetCount = 0;
    expect(ref.current?.setOpacity(0.4)).toBe(true);
    expect(h.editor.getSnapshot()!.revision).toBe(0);
    expect(h.editor.history.getSnapshot().undoCount).toBe(0);

    const completed = ref.current!;
    ref.current = null; // pointerup consumes the controller's active handle first
    expect(completed.finish((final) => h.commit(final.layerId, final.opacity))).toBe(true);
    expect(cancelActiveOpacityPreview(ref, () => { draftResetCount += 1; })).toBe(false);
    expect(cancelActiveOpacityPreview(ref, () => { draftResetCount += 1; })).toBe(false);
    expect(draftResetCount).toBe(0);
    expect(h.layer().opacity).toBe(0.4);
    expect(h.editor.getSnapshot()!.revision).toBe(1);
    expect(h.editor.history.getSnapshot().undoCount).toBe(1);

    ref.current = h.preview.begin(IDS.layerChar);
    expect(ref.current?.setOpacity(0.2)).toBe(true);
    expect(cancelActiveOpacityPreview(ref, () => { draftResetCount += 1; })).toBe(true);
    expect(cancelActiveOpacityPreview(ref, () => { draftResetCount += 1; })).toBe(false);
    expect(draftResetCount).toBe(1);
    expect(h.preview.getSnapshot()).toBeNull();
    expect(h.layer().opacity).toBe(0.4);
    expect(h.editor.history.getSnapshot().undoCount).toBe(1);
  });

  it('cancels pointer preview without mutating formal opacity, revision or History', () => {
    const h = createHarness();
    const session = h.preview.begin(IDS.layerAsset);
    // The selected Layer is still Character, so an unrelated handle cannot begin.
    expect(session).toBeNull();
    const active = h.preview.begin(IDS.layerChar)!;
    expect(active.setOpacity(0.4)).toBe(true);
    active.cancel();
    expect(h.preview.getSnapshot()).toBeNull();
    expect(h.layer().opacity).toBe(1);
    expect(h.editor.getSnapshot()!.revision).toBe(0);
    expect(h.editor.history.getSnapshot().undoCount).toBe(0);
    expect(active.finish((final) => h.commit(final.layerId, final.opacity))).toBe(false);
  });

  it('invalidates old capabilities on selection, Shot, Project-instance and timeline changes', () => {
    const h = createHarness();
    const first = h.preview.begin(IDS.layerChar)!;
    first.setOpacity(0.4);
    h.selection.select(IDS.layerAsset);
    expect(h.preview.getSnapshot()).toBeNull();
    expect(first.finish((final) => h.commit(final.layerId, final.opacity))).toBe(false);
    const second = h.preview.begin(IDS.layerAsset)!;
    h.shots.duplicate(IDS.shot);
    expect(h.preview.getSnapshot()).toBeNull();
    expect(second.finish((final) => h.commit(final.layerId, final.opacity))).toBe(false);
    h.shots.select(IDS.shot);
    h.selection.select(IDS.layerChar);
    const third = h.preview.begin(IDS.layerChar)!;
    const sameProject = h.editor.getSnapshot()!.project;
    h.editor.open('D:/opacity-preview.pandastage', sameProject);
    expect(h.preview.getSnapshot()).toBeNull();
    expect(third.finish((final) => h.commit(final.layerId, final.opacity))).toBe(false);
    h.selection.select(IDS.layerChar);
    const fourth = h.preview.begin(IDS.layerChar)!;
    h.setTime(500);
    expect(h.preview.getSnapshot()).toBeNull();
    expect(fourth.finish((final) => h.commit(final.layerId, final.opacity))).toBe(false);
    expect(h.preview.begin(IDS.layerChar)).toBeNull();
    expect(h.editor.history.getSnapshot().undoCount).toBe(0);
  });

  it('rejects locked or removed targets and stale handles cannot affect a replacement session', () => {
    const h = createHarness();
    const first = h.preview.begin(IDS.layerChar)!;
    h.layers.setLocked(IDS.layerChar, true);
    expect(h.preview.getSnapshot()).toBeNull();
    expect(h.preview.begin(IDS.layerChar)).toBeNull();
    expect(first.finish((final) => h.commit(final.layerId, final.opacity))).toBe(false);
    h.layers.setLocked(IDS.layerChar, false);
    const second = h.preview.begin(IDS.layerChar)!;
    second.setOpacity(0.7);
    expect(h.preview.begin(IDS.layerAsset)).toBeNull();
    expect(first.setOpacity(0.2)).toBe(false);
    expect(h.preview.getSnapshot()?.opacity).toBe(0.7);
    h.layers.deleteLayer(IDS.layerChar);
    expect(h.preview.getSnapshot()).toBeNull();
    expect(second.finish((final) => h.commit(final.layerId, final.opacity))).toBe(false);
    expect(h.editor.getSnapshot()!.project.shots[0]!.layers.some((layer) => layer.id === IDS.layerChar)).toBe(false);
  });

  it('routes only the visual root override and the existing shared Transform commit', () => {
    const canvas = readFileSync('src/renderer/features/canvas/CanvasStage.tsx', 'utf8');
    const controller = readFileSync('src/renderer/features/properties/LayerTransformPanel.tsx', 'utf8');
    const slider = readFileSync('src/renderer/features/properties/LayerBackgroundControl.tsx', 'utf8');
    expect(canvas).toContain('activeOpacityPreview?.layerId === layer.id');
    expect(canvas).toContain('opacity: activeOpacityPreview.opacity');
    expect(controller).toContain("commitPendingDraft('opacity', nextDraft)");
    expect(controller).toContain('useEffect(() => () => opacitySessionRef.current?.cancel(), []);');
    expect(controller).toContain('layerStore.updateTransform(layer.id, transform)');
    expect(controller).toContain('lastCommittedRef.current.draftVersion === commitIdentity.draftVersion');
    expect(controller).toContain("opacityGestureKindRef.current === 'keyboard'");
    expect(slider).toContain('onPointerCancel={() => controller.cancelOpacityPreview()}');
    expect(slider).toContain('onKeyUp={(event) => {');
    expect(slider).not.toContain('应用更改');
    expect(controller).not.toContain('透明度已更新');
  });
});
