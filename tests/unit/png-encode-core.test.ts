import { describe, expect, it, vi } from 'vitest';
import { createPngFrameEncoder } from '../../src/export-renderer/png-encode-core';

class FakeCanvas {
  hasOpaquePixels = false;
  readonly context = {
    clearRect: vi.fn(() => {
      this.hasOpaquePixels = false;
    }),
    drawImage: vi.fn((bitmap: ImageBitmap) => {
      this.hasOpaquePixels = Boolean((bitmap as ImageBitmap & { opaque: boolean }).opaque);
    }),
  };
  readonly getContext = vi.fn(() => this.context);
  readonly convertToBlob = vi.fn(async () =>
    new Blob(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, this.hasOpaquePixels ? 1 : 0])],
      { type: 'image/png' },
    ),
  );
  readonly width = 1_920;
  readonly height = 1_080;
}

function makeBitmap(opaque: boolean): ImageBitmap & {
  close: ReturnType<typeof vi.fn>;
  opaque: boolean;
} {
  return {
    width: 1_920,
    height: 1_080,
    opaque,
    close: vi.fn(),
  } as unknown as ImageBitmap & {
    close: ReturnType<typeof vi.fn>;
    opaque: boolean;
  };
}

describe('reused PNG Worker canvas', () => {
  it('encodes 108 frames with one canvas and context and clears alternating alpha', async () => {
    const canvas = new FakeCanvas();
    const createCanvas = vi.fn(() => canvas);
    const encode = createPngFrameEncoder(createCanvas);
    const bitmaps = Array.from({ length: 108 }, (_, index) =>
      makeBitmap(index % 2 === 0),
    );
    const outputAlpha: number[] = [];

    for (const bitmap of bitmaps) {
      const result = await encode({ width: 1_920, height: 1_080, bitmap });
      expect(result.bytes.byteLength).toBeGreaterThan(8);
      outputAlpha.push(new Uint8Array(result.bytes).at(-1)!);
    }

    expect(createCanvas).toHaveBeenCalledOnce();
    expect(createCanvas).toHaveBeenCalledWith(1_920, 1_080);
    expect(canvas.getContext).toHaveBeenCalledOnce();
    expect(canvas.getContext).toHaveBeenCalledWith('2d', { alpha: true });
    expect(canvas.context.clearRect).toHaveBeenCalledTimes(108);
    expect(canvas.context.clearRect).toHaveBeenCalledWith(0, 0, 1_920, 1_080);
    expect(canvas.context.drawImage).toHaveBeenCalledTimes(108);
    expect(canvas.convertToBlob).toHaveBeenCalledTimes(108);
    expect(outputAlpha).toEqual(bitmaps.map((bitmap) => (bitmap.opaque ? 1 : 0)));
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(true);
    for (let index = 0; index < 108; index += 1) {
      expect(canvas.context.clearRect.mock.invocationCallOrder[index]).toBeLessThan(
        canvas.context.drawImage.mock.invocationCallOrder[index]!,
      );
    }
  });

  it('closes the current bitmap if PNG encoding fails', async () => {
    const canvas = new FakeCanvas();
    canvas.convertToBlob.mockRejectedValueOnce(new Error('encode failed'));
    const encode = createPngFrameEncoder(() => canvas);
    const bitmap = makeBitmap(true);

    await expect(
      encode({ width: 1_920, height: 1_080, bitmap }),
    ).rejects.toThrow('encode failed');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
