import { describe, expect, it, vi } from 'vitest';
import { drawStageLayersSynchronously } from '../../src/renderer/stage/stage-draw-completion';

describe('synchronous export Stage drawing', () => {
  it('draws every output layer before returning the completed layer count', () => {
    const order: string[] = [];
    const layers = [
      { draw: vi.fn(() => order.push('background')) },
      { draw: vi.fn(() => order.push('characters-and-subtitles')) },
    ];

    expect(drawStageLayersSynchronously(layers)).toBe(2);
    expect(order).toEqual(['background', 'characters-and-subtitles']);
    expect(layers.every((layer) => layer.draw.mock.calls.length === 1)).toBe(true);
  });

  it('fails closed when the Stage has no output layers', () => {
    expect(() => drawStageLayersSynchronously([])).toThrow(
      'no scene layers to draw',
    );
  });
});
