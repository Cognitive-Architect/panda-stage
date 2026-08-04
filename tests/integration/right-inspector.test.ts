import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  LayerService,
  ProjectSchema,
} from '../../src/domain';
import { shouldDeleteSelectedLayer } from '../../src/renderer/features/properties/LayerOrderControls';
import {
  getLayerBackgroundControlModel,
} from '../../src/renderer/features/properties/LayerBackgroundControl';
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
        {
          id: 'asset-background',
          kind: 'image',
        },
        {
          id: 'asset-hero',
          kind: 'image',
        },
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

describe('Stage 3-A RightInspector selection contract', () => {
  it('explains empty, invalid, background, selected, and locked states', () => {
    const snapshot = snapshotWithLayers();

    expect(getRightInspectorSelection(snapshot, 'shot-a', null)).toMatchObject({
      state: 'empty',
      message: '请先在画布选择普通图层。',
    });
    expect(
      getRightInspectorSelection(snapshot, 'shot-a', 'missing'),
    ).toMatchObject({
      state: 'invalid',
      message: '当前图层选择已失效，请重新选择普通图层。',
    });
    expect(
      getRightInspectorSelection(snapshot, 'shot-a', 'background'),
    ).toMatchObject({
      state: 'background',
      message: '已选择背景层；普通图层操作已禁用。',
    });
    expect(
      getRightInspectorSelection(snapshot, 'shot-a', 'hero'),
    ).toMatchObject({
      state: 'selected',
      message: '已选择图层：Hero',
    });
    expect(
      getRightInspectorSelection(snapshot, 'shot-a', 'locked'),
    ).toMatchObject({
      state: 'locked',
      message: '图层已锁定，请先解锁后再变换、排序或删除。',
    });
  });

  it('exposes an explicit background action only for direct image layers', () => {
    const snapshot = snapshotWithLayers();
    expect(
      getLayerBackgroundControlModel(snapshot, 'shot-a', null),
    ).toMatchObject({ state: 'empty', canSet: false });
    expect(
      getLayerBackgroundControlModel(snapshot, 'shot-a', 'background'),
    ).toMatchObject({ state: 'background', canSet: false });
    expect(
      getLayerBackgroundControlModel(snapshot, 'shot-a', 'hero'),
    ).toMatchObject({ state: 'unsupported', canSet: false });
  });

  it('restores the redone layer selection and inspector actions in the same shot', () => {
    const project = ProjectSchema.parse(exampleProject);
    const shot = project.shots[0]!;
    let currentShotId = shot.id;
    const listeners = new Set<() => void>();
    const shotSelection = {
      getCurrentShotId: () => currentShotId,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const editor = new EditorProjectStore();
    editor.open('D:\\Projects\\redo-selection.pandastage', project);
    const selection = new LayerSelectionStore(editor, shotSelection);
    const layers = new LayerStore(
      editor,
      shotSelection,
      new LayerService(),
      selection,
    );
    const asset = project.assets.find(
      (candidate) => candidate.kind === 'image',
    )!;
    const created = layers.createFromAsset({
      version: 2,
      assetId: asset.id,
      type: 'asset-image',
      position: { x: 640, y: 360 },
    });

    expect(selection.getSelectedLayerId()).toBe(created.id);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    expect(editor.undo()).toBe(true);
    expect(selection.getSelectedLayerId()).toBeNull();
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 1,
    });

    expect(editor.redo()).toBe(true);
    const snapshot = editor.getSnapshot()!;
    expect(selection.getSelectedLayerId()).toBe(created.id);
    expect(
      getRightInspectorSelection(snapshot, shot.id, created.id),
    ).toMatchObject({ state: 'selected', layer: { id: created.id } });
    expect(
      getLayerBackgroundControlModel(snapshot, shot.id, created.id),
    ).toMatchObject({ state: 'available', canSet: true });
    expect(snapshot.project.shots[0]!.layers.filter(
      (layer) => layer.id === created.id,
    )).toHaveLength(1);
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });

    currentShotId = 'another-shot';
    for (const listener of listeners) listener();
    expect(selection.getSelectedLayerId()).toBeNull();
    expect(editor.undo()).toBe(true);
    expect(editor.redo()).toBe(true);
    expect(selection.getSelectedLayerId()).toBeNull();
    selection.dispose();
  });

  it('blocks every background mutation surface without consuming Delete/Backspace', async () => {
    const { readFile } = await import('node:fs/promises');
    const [inspector, transform, order] = await Promise.all([
      readFile('src/renderer/shell/RightInspector.tsx', 'utf8'),
      readFile(
        'src/renderer/features/properties/LayerTransformPanel.tsx',
        'utf8',
      ),
      readFile(
        'src/renderer/features/properties/LayerOrderControls.tsx',
        'utf8',
      ),
    ]);
    const inspectorSource = inspector.toString();
    const transformSource = transform.toString();
    const orderSource = order.toString();

    expect(
      inspectorSource.match(
        /backgroundLayerSelected=\{selection\.state === 'background'\}/gu,
      ),
    ).toHaveLength(2);
    expect(transformSource).toContain(
      'Boolean(backgroundLayerSelected) ||',
    );
    expect(transformSource).toContain(
      'data-background-protected={String(isBackgroundLayer)}',
    );
    expect(
      transformSource.match(
        /disabled=\{layer\.locked \|\| isBackgroundLayer\}/gu,
      ),
    ).toHaveLength(3);
    expect(transformSource).toContain(
      'disabled={isBackgroundLayer}',
    );
    expect(orderSource).toContain(
      'Boolean(backgroundLayerSelected) ||',
    );
    expect(orderSource).toContain(
      'data-background-protected={String(isBackgroundLayer)}',
    );
    expect(
      orderSource.match(/disabled=\{disabled \|\| orderIndex/gu),
    ).toHaveLength(4);
    expect(orderSource).toContain('disabled={disabled}');

    const event = {
      key: 'Delete',
      target: null,
      defaultPrevented: false,
    } as const;
    expect(shouldDeleteSelectedLayer(event, 'background', true)).toBe(
      false,
    );
    expect(
      shouldDeleteSelectedLayer(
        { ...event, key: 'Backspace' },
        'background',
        true,
      ),
    ).toBe(false);
    expect(shouldDeleteSelectedLayer(event, 'hero', false)).toBe(true);
  });

  it('keeps editor state unchanged for background writes and restores ordinary writes', () => {
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
    const backgroundTransform = {
      x: background.x,
      y: background.y,
      scale: background.scaleX,
      rotationDeg: background.rotationDeg,
      opacity: background.opacity,
      flipX: background.flipX,
    };
    const before = editor.getSnapshot()!;
    const beforeProjectJson = JSON.stringify(before.project);

    for (const operation of [
      () => layers.updatePosition(background.id, { x: 1, y: 1 }),
      () =>
        layers.updateTransform(
          background.id,
          backgroundTransform,
        ),
      () => layers.toggleFlipX(background.id),
      () => layers.reorder(background.id, 'front'),
      () => layers.deleteLayer(background.id),
      () => layers.setLocked(background.id, true),
    ]) {
      expect(operation).toThrow(
        expect.objectContaining({ code: 'BACKGROUND_LAYER_PROTECTED' }),
      );
    }

    expect(editor.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 0,
    });
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
    expect(JSON.stringify(editor.getSnapshot()!.project)).toBe(
      beforeProjectJson,
    );

    layers.updateTransform(ordinary.id, {
      x: ordinary.x + 1,
      y: ordinary.y,
      scale: ordinary.scaleX,
      rotationDeg: ordinary.rotationDeg,
      opacity: ordinary.opacity,
      flipX: ordinary.flipX,
    });
    expect(editor.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 1,
    });
    expect(editor.history.getSnapshot().undoCount).toBe(1);
  });

  it('keeps the single owner and unchanged product state sources', async () => {
    const { readFile } = await import('node:fs/promises');
    const [shell, inspector, canvas, legacy] = await Promise.all([
      readFile('src/renderer/shell/EditorShell.tsx', 'utf8'),
      readFile('src/renderer/shell/RightInspector.tsx', 'utf8'),
      readFile('src/renderer/features/canvas/CanvasStage.tsx', 'utf8'),
      readFile('src/renderer/shell/LegacyWorkspace.tsx', 'utf8'),
    ]);
    const shellSource = shell.toString();
    const inspectorSource = inspector.toString();
    const canvasSource = canvas.toString();
    const legacySource = legacy.toString();

    expect(shellSource.match(/<RightInspector/gu)).toHaveLength(1);
    expect(inspectorSource.match(/<LayerTransformPanel/gu)).toHaveLength(1);
    expect(inspectorSource.match(/<LayerOrderControls/gu)).toHaveLength(1);
    expect(canvasSource.match(/<LayerTransformPanel/gu)).toBeNull();
    expect(canvasSource.match(/<LayerOrderControls/gu)).toBeNull();
    expect(canvasSource.match(/<HistoryControls/gu)).toHaveLength(1);
    expect(legacySource.match(/<ActionPresetPanel/gu)).toHaveLength(1);
    expect(inspectorSource).toContain('editorProjectStore.subscribe');
    expect(inspectorSource).toContain('selectionStore.subscribe');
    expect(inspectorSource).toContain('shotStore.subscribe');
    expect(inspectorSource).not.toContain('new EditorProjectStore');
    expect(inspectorSource).not.toContain('new HistoryStore');
  });
});
