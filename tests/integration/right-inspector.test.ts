import { describe, expect, it } from 'vitest';
import type { EditorProjectSnapshot } from '../../src/renderer/stores/EditorProjectStore';
import {
  getRightInspectorSelection,
} from '../../src/renderer/shell/RightInspector';

function snapshotWithLayers(): EditorProjectSnapshot {
  return {
    projectRoot: 'C:\\Projects\\Inspector.pandastage',
    project: {
      shots: [
        {
          id: 'shot-a',
          backgroundLayerId: 'background',
          layers: [
            { id: 'background', name: 'Background', locked: false },
            { id: 'hero', name: 'Hero', locked: false },
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
      message: '背景层不可执行普通图层操作。',
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
