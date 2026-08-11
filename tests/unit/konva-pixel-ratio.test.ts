import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  configureKonvaScenePixelRatio,
  resolveEditorCanvasPixelRatio,
  resolvePreviewCanvasPixelRatio,
  type KonvaSceneLayer,
} from '../../src/renderer/stage/konva-pixel-ratio';

function layerWithPixelRatio(initialPixelRatio: number): {
  layer: KonvaSceneLayer;
  getPixelRatio(): number;
  setPixelRatio: ReturnType<typeof vi.fn>;
  batchDraw: ReturnType<typeof vi.fn>;
} {
  let pixelRatio = initialPixelRatio;
  const setPixelRatio = vi.fn((nextPixelRatio: number) => {
    pixelRatio = nextPixelRatio;
  });
  const batchDraw = vi.fn();
  return {
    layer: {
      getCanvas: () => ({
        getPixelRatio: () => pixelRatio,
        setPixelRatio,
      }),
      batchDraw,
    },
    getPixelRatio: () => pixelRatio,
    setPixelRatio,
    batchDraw,
  };
}

describe('Konva scene pixel-ratio ownership', () => {
  it('configures preview and editor layers without process-global Konva writes', () => {
    const preview = readFileSync(
      'src/renderer/stage/StageRenderer.tsx',
      'utf8',
    );
    const editor = readFileSync(
      'src/renderer/features/canvas/CanvasStage.tsx',
      'utf8',
    );

    expect(preview).not.toContain('Konva.pixelRatio');
    expect(editor).not.toContain('Konva.pixelRatio');
    expect(preview).toContain('pixelRatio = PREVIEW_CANVAS_PIXEL_RATIO');
    expect(preview).toContain('configureKonvaScenePixelRatio(layer, pixelRatio)');
    expect(preview).toContain('ref={configurePreviewLayer}');
    expect(editor).toContain(
      'configureKonvaScenePixelRatio(layer, editorCanvasPixelRatio)',
    );
    expect(editor.match(/ref=\{configureEditorLayer\}/gu)).toHaveLength(2);
  });

  it('keeps a 150% editor and ActionPreset preview layer sharp', () => {
    const editor = layerWithPixelRatio(1);
    const preview = layerWithPixelRatio(1);

    configureKonvaScenePixelRatio(
      editor.layer,
      resolveEditorCanvasPixelRatio(1.5),
    );
    configureKonvaScenePixelRatio(
      preview.layer,
      resolvePreviewCanvasPixelRatio(1.5),
    );

    expect(editor.getPixelRatio()).toBe(1.5);
    expect(preview.getPixelRatio()).toBe(1.5);
    expect(editor.setPixelRatio).toHaveBeenCalledWith(1.5);
    expect(preview.setPixelRatio).toHaveBeenCalledWith(1.5);
  });

  it('caps editor backing-store scaling and avoids redundant redraws', () => {
    expect(resolveEditorCanvasPixelRatio(0.75)).toBe(1);
    expect(resolveEditorCanvasPixelRatio(1.25)).toBe(1.25);
    expect(resolveEditorCanvasPixelRatio(3)).toBe(2);
    expect(resolveEditorCanvasPixelRatio(Number.NaN)).toBe(1);
    expect(resolvePreviewCanvasPixelRatio(1.5)).toBe(1.5);
    expect(resolvePreviewCanvasPixelRatio(3)).toBe(2);

    const unchanged = layerWithPixelRatio(1.5);
    configureKonvaScenePixelRatio(unchanged.layer, 1.5);
    expect(unchanged.setPixelRatio).not.toHaveBeenCalled();
    expect(unchanged.batchDraw).not.toHaveBeenCalled();
  });

  it('rejects invalid per-layer ratios', () => {
    const target = layerWithPixelRatio(1);
    expect(() => configureKonvaScenePixelRatio(target.layer, 0)).toThrow(
      'positive finite number',
    );
  });
});
