interface PngFrameRequest {
  width: number;
  height: number;
  bitmap: ImageBitmap;
}

interface PngEncodeContext {
  clearRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: ImageBitmap, dx: number, dy: number): void;
}

interface PngEncodeCanvas {
  width: number;
  height: number;
  getContext(
    contextId: '2d',
    options: { alpha: boolean },
  ): PngEncodeContext | null;
  convertToBlob(options: { type: 'image/png' }): Promise<Blob>;
}

export interface PngEncodeResult {
  bytes: ArrayBuffer;
  workerDrawMs: number;
  convertToBlobMs: number;
  arrayBufferMs: number;
  workerEncodeMs: number;
}

const PNG_WIDTH = 1_920;
const PNG_HEIGHT = 1_080;

/** Creates one per-Worker encoder that reuses its fixed-size canvas and context. */
export function createPngFrameEncoder(
  createCanvas: (width: number, height: number) => PngEncodeCanvas =
    (width, height) =>
      new OffscreenCanvas(width, height) as unknown as PngEncodeCanvas,
): (request: PngFrameRequest) => Promise<PngEncodeResult> {
  let canvas: PngEncodeCanvas | null = null;
  let context: PngEncodeContext | null = null;

  return async (request) => {
    const startedAt = performance.now();
    try {
      if (
        request.width !== PNG_WIDTH ||
        request.height !== PNG_HEIGHT ||
        request.bitmap.width !== request.width ||
        request.bitmap.height !== request.height
      ) {
        throw new Error('PNG Worker received an invalid canvas snapshot.');
      }

      if (!canvas) {
        const createdCanvas = createCanvas(request.width, request.height);
        const createdContext = createdCanvas.getContext('2d', { alpha: true });
        if (!createdContext) {
          throw new Error('PNG Worker could not create a 2D context.');
        }
        canvas = createdCanvas;
        context = createdContext;
      }

      if (canvas.width !== request.width || canvas.height !== request.height) {
        throw new Error('PNG Worker canvas dimensions changed during the Job.');
      }
      if (!context) throw new Error('PNG Worker 2D context is unavailable.');

      const drawStartedAt = performance.now();
      context.clearRect(0, 0, request.width, request.height);
      context.drawImage(request.bitmap, 0, 0);
      const workerDrawMs = performance.now() - drawStartedAt;

      const convertStartedAt = performance.now();
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const convertToBlobMs = performance.now() - convertStartedAt;
      if (blob.type !== 'image/png' || blob.size <= 8) {
        throw new Error('PNG Worker returned an empty or invalid PNG Blob.');
      }

      const arrayBufferStartedAt = performance.now();
      const bytes = await blob.arrayBuffer();
      const arrayBufferMs = performance.now() - arrayBufferStartedAt;
      return {
        bytes,
        workerDrawMs,
        convertToBlobMs,
        arrayBufferMs,
        workerEncodeMs: performance.now() - startedAt,
      };
    } finally {
      request.bitmap.close();
    }
  };
}
