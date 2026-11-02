import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExportRenderFrameRequest } from '../../src/shared/export-types';
import { WorkerPngEncoder } from '../../src/export-renderer/worker-png-encoder';
import { captureExportStageCanvas } from '../../src/export-renderer/stage-capture';

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn((message: unknown, transfer?: Transferable[]) => {
    this.lastMessage = message;
    this.lastTransfer = transfer;
  });
  terminate = vi.fn();
  lastMessage: unknown = null;
  lastTransfer: Transferable[] | undefined;

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function makeFrame(frameIndex = 4): ExportRenderFrameRequest {
  return {
    jobId: randomUUID(),
    frameIndex,
    timeMs: frameIndex * 42,
    shotId: randomUUID(),
    shotLocalTimeMs: frameIndex * 42,
  };
}

function makeBitmap(): ImageBitmap & { close: ReturnType<typeof vi.fn> } {
  return {
    width: 1_920,
    height: 1_080,
    close: vi.fn(),
  } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
}

function makeCanvas(): HTMLCanvasElement {
  return { width: 1_920, height: 1_080 } as HTMLCanvasElement;
}

function encodedMessage(
  frame: ExportRenderFrameRequest,
  bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]).buffer,
) {
  return {
    type: 'encoded-png',
    jobId: frame.jobId,
    frameIndex: frame.frameIndex,
    timeMs: frame.timeMs,
    shotId: frame.shotId,
    shotLocalTimeMs: frame.shotLocalTimeMs,
    width: 1_920,
    height: 1_080,
    bytes,
    workerDrawMs: 2,
    convertToBlobMs: 8,
    arrayBufferMs: 1,
    workerEncodeMs: 11,
  };
}

describe('WorkerPngEncoder', () => {
  afterEach(() => vi.useRealTimers());

  it('reuses one Worker sequentially and accepts only the correlated frame', async () => {
    const worker = new FakeWorker();
    const firstBitmap = makeBitmap();
    const secondBitmap = makeBitmap();
    const bitmapQueue = [firstBitmap, secondBitmap];
    const workerFactory = vi.fn(() => worker as unknown as Worker);
    const encoder = new WorkerPngEncoder({
      workerFactory,
      createBitmap: async () => bitmapQueue.shift()!,
    });
    const firstFrame = makeFrame(4);
    const first = encoder.encode(makeCanvas(), firstFrame);
    await vi.waitFor(() => expect(worker.lastMessage).not.toBeNull());

    await expect(encoder.encode(makeCanvas(), makeFrame(5))).rejects.toThrow(
      /already has a frame in flight/,
    );
    const firstMessage = worker.lastMessage as { bitmap: ImageBitmap };
    expect(worker.lastTransfer).toEqual([firstMessage.bitmap]);
    worker.emit(encodedMessage({ ...firstFrame, timeMs: firstFrame.timeMs + 1 }));
    worker.emit(encodedMessage(firstFrame));
    const firstResult = await first;
    expect(Array.from(firstResult.pngBytes)).toEqual([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    expect(firstResult.timing).toMatchObject({
      snapshotMs: expect.any(Number),
      workerDrawMs: 2,
      convertToBlobMs: 8,
      arrayBufferMs: 1,
      workerEncodeMs: 11,
    });

    const secondFrame = makeFrame(5);
    const second = encoder.encode(makeCanvas(), secondFrame);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    worker.emit(encodedMessage(secondFrame));
    await expect(second).resolves.toMatchObject({ pngBytes: expect.any(Uint8Array) });
    expect(workerFactory).toHaveBeenCalledTimes(1);
    encoder.close();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('fails closed and terminates the Worker on an error', async () => {
    const worker = new FakeWorker();
    const encoder = new WorkerPngEncoder({
      workerFactory: () => worker as unknown as Worker,
      createBitmap: async () => makeBitmap(),
    });
    const request = encoder.encode(makeCanvas(), makeFrame());
    await vi.waitFor(() => expect(worker.lastMessage).not.toBeNull());
    const preventDefault = vi.fn();
    worker.onerror?.({ message: 'worker crashed', preventDefault } as unknown as ErrorEvent);
    await expect(request).rejects.toThrow('worker crashed');
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(encoder.encode(makeCanvas(), makeFrame(5))).rejects.toThrow(
      'worker crashed',
    );
  });

  it('snapshots only the already drawn single-layer or composite output canvas', async () => {
    const worker = new FakeWorker();
    const singleLayerCanvas = makeCanvas();
    const compositeCanvas = makeCanvas();
    const createBitmap = vi.fn(async () => makeBitmap());
    const encoder = new WorkerPngEncoder({
      workerFactory: () => worker as unknown as Worker,
      createBitmap,
    });
    const singleLayer = captureExportStageCanvas({
      getLayers: () => [{ getNativeCanvasElement: () => singleLayerCanvas }],
      toCanvas: vi.fn(),
    });
    const multiLayer = captureExportStageCanvas({
      getLayers: () => [
        { getNativeCanvasElement: () => makeCanvas() },
        { getNativeCanvasElement: () => makeCanvas() },
      ],
      toCanvas: () => compositeCanvas,
    });
    expect(singleLayer.strategy).toBe('drawn-output-layer');
    expect(multiLayer.strategy).toBe('stage-composite');

    const firstFrame = makeFrame(0);
    const first = encoder.encode(singleLayer.canvas, firstFrame);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
    expect(createBitmap).toHaveBeenNthCalledWith(1, singleLayerCanvas);
    expect(worker.lastMessage).not.toBe(singleLayerCanvas);
    worker.emit(encodedMessage(firstFrame));
    await first;

    const secondFrame = makeFrame(1);
    const second = encoder.encode(multiLayer.canvas, secondFrame);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    expect(createBitmap).toHaveBeenNthCalledWith(2, compositeCanvas);
    expect(worker.lastMessage).not.toBe(compositeCanvas);
    worker.emit(encodedMessage(secondFrame));
    await second;
    encoder.close();
  });

  it('times out a stuck Worker and releases its pending frame', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const encoder = new WorkerPngEncoder({
      workerFactory: () => worker as unknown as Worker,
      createBitmap: async () => makeBitmap(),
      timeoutMs: 50,
    });
    const request = encoder.encode(makeCanvas(), makeFrame());
    await Promise.resolve();
    await Promise.resolve();
    expect(worker.lastMessage).not.toBeNull();
    const rejected = expect(request).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    encoder.close();
  });

  it('closes a late snapshot after cancellation without creating a Worker', async () => {
    let resolveBitmap!: (bitmap: ImageBitmap) => void;
    const bitmapPromise = new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
    });
    const workerFactory = vi.fn(() => new FakeWorker() as unknown as Worker);
    const encoder = new WorkerPngEncoder({
      workerFactory,
      createBitmap: () => bitmapPromise,
    });
    const request = encoder.encode(makeCanvas(), makeFrame());
    const rejected = expect(request).rejects.toThrow(/cancelled/);
    encoder.close('Export Job cancelled.');
    await rejected;
    const bitmap = makeBitmap();
    resolveBitmap(bitmap);
    await Promise.resolve();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(workerFactory).not.toHaveBeenCalled();
  });
});
