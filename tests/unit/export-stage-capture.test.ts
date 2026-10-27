import { describe, expect, it, vi } from 'vitest';
import {
  captureExportStageCanvas,
  type ExportSceneStageCanvas,
} from '../../src/export-renderer/stage-capture';

function makeCanvas(): HTMLCanvasElement {
  return { width: 1_920, height: 1_080 } as HTMLCanvasElement;
}

function makeLayer(canvas: HTMLCanvasElement) {
  return { getNativeCanvasElement: () => canvas };
}

describe('captureExportStageCanvas', () => {
  it('captures the already drawn scene canvas without drawing the Stage again', () => {
    const layerCanvas = makeCanvas();
    const toCanvas = vi.fn(() => makeCanvas());
    const stage: ExportSceneStageCanvas = {
      getLayers: () => [makeLayer(layerCanvas)],
      toCanvas,
    };

    expect(captureExportStageCanvas(stage)).toEqual({
      canvas: layerCanvas,
      strategy: 'drawn-output-layer',
    });
    expect(toCanvas).not.toHaveBeenCalled();
  });

  it('composites every layer when the Stage has multiple output layers', () => {
    const compositeCanvas = makeCanvas();
    const toCanvas = vi.fn(() => compositeCanvas);
    const stage: ExportSceneStageCanvas = {
      getLayers: () => [makeLayer(makeCanvas()), makeLayer(makeCanvas())],
      toCanvas,
    };

    expect(captureExportStageCanvas(stage)).toEqual({
      canvas: compositeCanvas,
      strategy: 'stage-composite',
    });
    expect(toCanvas).toHaveBeenCalledWith({ pixelRatio: 1 });
  });

  it('rejects a Stage with no output layers', () => {
    const stage: ExportSceneStageCanvas = {
      getLayers: () => [],
      toCanvas: vi.fn(() => makeCanvas()),
    };

    expect(() => captureExportStageCanvas(stage)).toThrow(/no output scene layers/);
  });
});
