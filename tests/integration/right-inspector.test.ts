import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { LayerService, ProjectSchema } from '../../src/domain';
import {
  getLayerBackgroundControlModel,
} from '../../src/renderer/features/properties/LayerBackgroundControl';
import {
  shouldDeleteSelectedLayer,
} from '../../src/renderer/features/properties/LayerOrderControls';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerStore } from '../../src/renderer/stores/layerStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import {
  getRightInspectorSelection,
} from '../../src/renderer/shell/RightInspector';

function snapshotWithLayers(): EditorProjectSnapshot {
  return {
    projectRoot: 'C:\\Projects\\Inspector.pandastage',
    project: {
      assets: [
        { id: 'asset-background', kind: 'image' },
        { id: 'asset-hero', kind: 'image' },
      ],
      shots: [
        {
          id: 'shot-a',
          backgroundLayerId: 'background',
          layers: [
            {
              id: 'background',
              name: 'Background',
              locked: false,
              source: { kind: 'asset', assetId: 'asset-background' },
            },
            {
              id: 'hero',
              name: 'Hero',
              locked: false,
              source: { kind: 'character' },
            },
            { id: 'locked', name: 'Locked', locked: true },
          ],
        },
      ],
    },
    dirty: false,
    revision: 0,
  } as unknown as EditorProjectSnapshot;
}

describe('Issue 121 RightInspector selection and ownership', () => {
  it('exposes empty, invalid, background, selected, and locked states', () => {
    const snapshot = snapshotWithLayers();

    expect(getRightInspectorSelection(snapshot, 'shot-a', null)).toMatchObject({
      state: 'empty',
      layer: null,
    });
    expect(
      getRightInspectorSelection(snapshot, 'shot-a', 'missing'),
    ).toMatchObject({ state: 'invalid', layer: null });
    expect(
      getRightInspectorSelection(snapshot, 'shot-a', 'background'),
    ).toMatchObject({ state: 'background', layer: { id: 'background' } });
    expect(
      getRightInspectorSelection(snapshot, 'shot-a', 'hero'),
    ).toMatchObject({ state: 'selected', layer: { id: 'hero' } });
    expect(
      getRightInspectorSelection(snapshot, 'shot-a', 'locked'),
    ).toMatchObject({ state: 'locked', layer: { id: 'locked' } });
  });

  it('allows background management only for a direct image layer', () => {
    const snapshot = snapshotWithLayers();
    expect(
      getLayerBackgroundControlModel(snapshot, 'shot-a', null),
    ).toMatchObject({
      state: 'empty',
      canSet: false,
      canSelect: true,
      canClear: true,
      canFill: true,
    });
    expect(
      getLayerBackgroundControlModel(snapshot, 'shot-a', 'background'),
    ).toMatchObject({ state: 'background', canSet: false });
    expect(
      getLayerBackgroundControlModel(snapshot, 'shot-a', 'hero'),
    ).toMatchObject({ state: 'unsupported', canSet: false });
  });

  it('keeps background transforms editable but blocks ordinary order/delete actions', () => {
    const project = ProjectSchema.parse(exampleProject);
    const shot = project.shots[0]!;
    const background = shot.layers.find(
      (layer) => layer.id === shot.backgroundLayerId,
    )!;
    const ordinary = shot.layers.find(
      (layer) => layer.id !== shot.backgroundLayerId,
    )!;
    const editor = new EditorProjectStore();
    editor.open('D:\\Projects\\background-guard.pandastage', project);
    const layers = new LayerStore(
      editor,
      { getCurrentShotId: () => shot.id },
      new LayerService(),
    );

    layers.updateTransform(background.id, {
      x: 820,
      y: 440,
      scale: 1.2,
      rotationDeg: 12,
      opacity: 0.7,
      flipX: true,
    });
    expect(editor.getSnapshot()!.project.shots[0]!.layers[0]).toMatchObject({
      x: 820,
      y: 440,
      scaleX: 1.2,
      rotationDeg: 12,
      opacity: 0.7,
      flipX: true,
    });
    expect(() => layers.reorder(background.id, 'front')).toThrow(
      expect.objectContaining({ code: 'BACKGROUND_LAYER_PROTECTED' }),
    );
    expect(() => layers.deleteLayer(background.id)).toThrow(
      expect.objectContaining({ code: 'BACKGROUND_LAYER_PROTECTED' }),
    );
    layers.updateTransform(ordinary.id, {
      x: ordinary.x + 1,
      y: ordinary.y,
      scale: ordinary.scaleX,
      rotationDeg: ordinary.rotationDeg,
      opacity: ordinary.opacity,
      flipX: ordinary.flipX,
    });
    expect(editor.history.getSnapshot().undoCount).toBe(2);
  });

  it('keeps explicit background selection coherent across bind and clear', () => {
    const project = ProjectSchema.parse(exampleProject);
    const shot = project.shots[0]!;
    const editor = new EditorProjectStore();
    editor.open('D:\\Projects\\background-history.pandastage', project);
    const selection = new LayerSelectionStore(editor, {
      getCurrentShotId: () => shot.id,
      subscribe: () => () => undefined,
    });
    const layers = new LayerStore(
      editor,
      { getCurrentShotId: () => shot.id },
      new LayerService(),
      selection,
    );
    const created = layers.createFromAsset({
      version: 2,
      assetId: project.assets[0]!.id,
      type: 'asset-image',
      position: { x: 700, y: 400 },
    });

    layers.setBackground(created.id);
    selection.selectBackground();
    expect(selection.getSelectedLayerId()).toBe(created.id);
    expect(
      getRightInspectorSelection(editor.getSnapshot(), shot.id, created.id),
    ).toMatchObject({ state: 'background', layer: { locked: true } });

    layers.clearBackground();
    expect(editor.getSnapshot()!.project.shots[0]!.backgroundLayerId).toBeNull();
    expect(
      getRightInspectorSelection(editor.getSnapshot(), shot.id, created.id),
    ).toMatchObject({ state: 'selected' });
    selection.dispose();
  });

  it('keeps repeated background selection idempotent and history-clean', () => {
    const project = ProjectSchema.parse(exampleProject);
    const shot = project.shots[0]!;
    const background = shot.layers.find(
      (layer) => layer.id === shot.backgroundLayerId,
    )!;
    const editor = new EditorProjectStore();
    editor.open('D:\\Projects\\background-selection.pandastage', project);
    const selection = new LayerSelectionStore(editor, {
      getCurrentShotId: () => shot.id,
      subscribe: () => () => undefined,
    });
    const listener = vi.fn();
    selection.subscribe(listener);

    selection.selectExplicit(background.id);
    selection.selectExplicit(background.id);

    expect(selection.getSelectedLayerId()).toBe(background.id);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(editor.getSnapshot()!.dirty).toBe(false);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
    selection.dispose();
  });

  it('keeps one owner for the inspector, panels, canvas, and history', () => {
    const shell = readFileSync('src/renderer/shell/EditorShell.tsx', 'utf8');
    const inspector = readFileSync('src/renderer/shell/RightInspector.tsx', 'utf8');
    const canvas = readFileSync(
      'src/renderer/features/canvas/CanvasStage.tsx',
      'utf8',
    );
    const legacy = readFileSync('src/renderer/shell/LegacyWorkspace.tsx', 'utf8');

    expect(shell.match(/<RightInspector/gu)).toHaveLength(1);
    expect(shell).not.toContain('right-inspector-placeholder');
    expect(inspector.match(/<LayerTransformPanel/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerOrderControls/gu)).toHaveLength(1);
    expect(inspector.match(/<LayerBackgroundControl/gu)).toHaveLength(1);
    expect(canvas).not.toContain('<LayerTransformPanel');
    expect(canvas).not.toContain('<LayerOrderControls');
    expect(canvas.match(/<HistoryControls/gu)).toHaveLength(1);
    expect(legacy).not.toContain('<CanvasStage');
  });

  it('protects background keyboard deletion while retaining ordinary deletion', () => {
    const event = {
      key: 'Delete',
      target: null,
      defaultPrevented: false,
    } as const;
    expect(shouldDeleteSelectedLayer(event, 'background', true)).toBe(false);
    expect(
      shouldDeleteSelectedLayer(
        { ...event, key: 'Backspace' },
        'background',
        true,
      ),
    ).toBe(false);
    expect(shouldDeleteSelectedLayer(event, 'ordinary', false)).toBe(true);
  });
});
