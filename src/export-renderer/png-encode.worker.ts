interface EncodePngRequest {
  type: 'encode-png';
  jobId: string;
  frameIndex: number;
  timeMs: number;
  shotId?: string;
  shotLocalTimeMs?: number;
  width: number;
  height: number;
  bitmap: ImageBitmap;
}

const scope = self as DedicatedWorkerGlobalScope;
let encoding = false;

scope.addEventListener('message', (event: MessageEvent<EncodePngRequest>) => {
  const request = event.data;
  if (!request || request.type !== 'encode-png') return;
  if (encoding) {
    request.bitmap?.close();
    scope.postMessage({
      type: 'encode-error',
      jobId: request.jobId,
      frameIndex: request.frameIndex,
      timeMs: request.timeMs,
      ...(request.shotId === undefined
        ? {}
        : {
            shotId: request.shotId,
            shotLocalTimeMs: request.shotLocalTimeMs,
          }),
      error: 'PNG Worker received more than one in-flight frame.',
    });
    return;
  }
  encoding = true;
  void encodePng(request).finally(() => {
    encoding = false;
  });
});

async function encodePng(request: EncodePngRequest): Promise<void> {
  const startedAt = performance.now();
  try {
    if (
      request.width !== 1_920 ||
      request.height !== 1_080 ||
      request.bitmap.width !== request.width ||
      request.bitmap.height !== request.height
    ) {
      throw new Error('PNG Worker received an invalid canvas snapshot.');
    }
    const canvas = new OffscreenCanvas(request.width, request.height);
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('PNG Worker could not create a 2D context.');
    const drawStartedAt = performance.now();
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
    scope.postMessage(
      {
        type: 'encoded-png',
        jobId: request.jobId,
        frameIndex: request.frameIndex,
        timeMs: request.timeMs,
        ...(request.shotId === undefined
          ? {}
          : {
              shotId: request.shotId,
              shotLocalTimeMs: request.shotLocalTimeMs,
            }),
        width: request.width,
        height: request.height,
        bytes,
        workerDrawMs,
        convertToBlobMs,
        arrayBufferMs,
        workerEncodeMs: performance.now() - startedAt,
      },
      [bytes],
    );
  } catch (error) {
    scope.postMessage({
      type: 'encode-error',
      jobId: request.jobId,
      frameIndex: request.frameIndex,
      timeMs: request.timeMs,
      ...(request.shotId === undefined
        ? {}
        : {
            shotId: request.shotId,
            shotLocalTimeMs: request.shotLocalTimeMs,
          }),
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    request.bitmap.close();
  }
}
