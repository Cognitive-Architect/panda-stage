import { createPngFrameEncoder } from './png-encode-core';

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
const encodeFrame = createPngFrameEncoder();

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
  try {
    const encoded = await encodeFrame(request);
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
        bytes: encoded.bytes,
        workerDrawMs: encoded.workerDrawMs,
        convertToBlobMs: encoded.convertToBlobMs,
        arrayBufferMs: encoded.arrayBufferMs,
        workerEncodeMs: encoded.workerEncodeMs,
      },
      [encoded.bytes],
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
  }
}
