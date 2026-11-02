import type { ExportRenderFrameRequest } from '../shared/export-types';

export interface WorkerPngEncodeTiming {
  snapshotMs: number;
  transferDispatchMs: number;
  workerDrawMs: number;
  convertToBlobMs: number;
  arrayBufferMs: number;
  workerEncodeMs: number;
  workerReturnMs: number;
  workerRoundTripMs: number;
}

export interface WorkerPngEncodeResult {
  pngBytes: Uint8Array<ArrayBuffer>;
  timing: WorkerPngEncodeTiming;
}

interface FrameIdentity {
  jobId: string;
  frameIndex: number;
  timeMs: number;
  shotId?: string;
  shotLocalTimeMs?: number;
}

interface WorkerEncodeRequest extends FrameIdentity {
  type: 'encode-png';
  width: number;
  height: number;
  bitmap: ImageBitmap;
}

interface WorkerEncodeResponse extends FrameIdentity {
  type: 'encoded-png';
  width: number;
  height: number;
  bytes: ArrayBuffer;
  workerDrawMs: number;
  convertToBlobMs: number;
  arrayBufferMs: number;
  workerEncodeMs: number;
}

interface WorkerEncodeFailure extends FrameIdentity {
  type: 'encode-error';
  error: string;
}

type WorkerPngMessage = WorkerEncodeResponse | WorkerEncodeFailure;

interface WorkerLike {
  onmessage: ((event: MessageEvent<WorkerPngMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: WorkerEncodeRequest, transfer: Transferable[]): void;
  terminate(): void;
}

interface PendingEncode {
  identity: FrameIdentity;
  promiseResolve: (result: WorkerPngEncodeResult) => void;
  promiseReject: (error: Error) => void;
  requestStartedAt: number;
  timer: ReturnType<typeof setTimeout>;
  dispatchedAt: number | null;
  snapshotMs: number | null;
  transferDispatchMs: number | null;
}

const WORKER_ENCODE_TIMEOUT_MS = 12_000;

function sameIdentity(left: FrameIdentity, right: FrameIdentity): boolean {
  return (
    left.jobId === right.jobId &&
    left.frameIndex === right.frameIndex &&
    left.timeMs === right.timeMs &&
    left.shotId === right.shotId &&
    left.shotLocalTimeMs === right.shotLocalTimeMs
  );
}

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** One bounded PNG encoder Worker owned by one hidden formal export Job. */
export class WorkerPngEncoder {
  private worker: WorkerLike | null = null;
  private pending: PendingEncode | null = null;
  private closed = false;
  private workerFailure: Error | null = null;

  constructor(
    private readonly options: {
      workerFactory?: () => WorkerLike;
      createBitmap?: (canvas: HTMLCanvasElement) => Promise<ImageBitmap>;
      timeoutMs?: number;
      jobId?: string;
    } = {},
  ) {}

  encode(
    canvas: HTMLCanvasElement,
    request: ExportRenderFrameRequest,
  ): Promise<WorkerPngEncodeResult> {
    if (this.closed) {
      return Promise.reject(new Error('PNG Worker encoder is closed.'));
    }
    if (this.workerFailure) return Promise.reject(this.workerFailure);
    if (this.pending) {
      return Promise.reject(
        new Error('PNG Worker encoder already has a frame in flight.'),
      );
    }

    let promiseResolve!: (result: WorkerPngEncodeResult) => void;
    let promiseReject!: (error: Error) => void;
    const promise = new Promise<WorkerPngEncodeResult>((resolve, reject) => {
      promiseResolve = resolve;
      promiseReject = reject;
    });
    const pending: PendingEncode = {
      identity: this.identityOf(request),
      promiseResolve,
      promiseReject,
      requestStartedAt: performance.now(),
      timer: setTimeout(
        () => this.failPending(new Error('PNG Worker encode timed out.'), true),
        this.options.timeoutMs ?? WORKER_ENCODE_TIMEOUT_MS,
      ),
      dispatchedAt: null,
      snapshotMs: null,
      transferDispatchMs: null,
    };
    this.pending = pending;

    void this.captureAndDispatch(canvas, pending);
    return promise;
  }

  close(reason = 'PNG Worker encoder closed.'): void {
    if (this.closed) return;
    this.closed = true;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.promiseReject(new Error(reason));
    }
    this.terminateWorker();
  }

  private async captureAndDispatch(
    canvas: HTMLCanvasElement,
    pending: PendingEncode,
  ): Promise<void> {
    let bitmap: ImageBitmap | null = null;
    try {
      const snapshotStartedAt = performance.now();
      bitmap = await (this.options.createBitmap ?? createImageBitmap)(canvas);
      pending.snapshotMs = performance.now() - snapshotStartedAt;
      if (this.pending !== pending || this.closed) {
        bitmap.close();
        return;
      }

      const worker = this.requireWorker();
      const dispatchStartedAt = performance.now();
      pending.dispatchedAt = dispatchStartedAt;
      const message: WorkerEncodeRequest = {
        type: 'encode-png',
        ...pending.identity,
        width: canvas.width,
        height: canvas.height,
        bitmap,
      };
      worker.postMessage(message, [bitmap]);
      pending.transferDispatchMs = performance.now() - dispatchStartedAt;
      bitmap = null;
    } catch (error) {
      bitmap?.close();
      if (this.pending === pending) this.failPending(errorFrom(error), true);
    }
  }

  private requireWorker(): WorkerLike {
    if (this.workerFailure) throw this.workerFailure;
    if (this.worker) return this.worker;
    const factory =
      this.options.workerFactory ??
      (() =>
        new Worker(
          new URL('./png-encode.worker.ts', import.meta.url),
          { type: 'module' },
        ));
    const worker = factory();
    worker.onmessage = (event) => this.onWorkerMessage(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      this.failPending(
        new Error(event.message || 'PNG Worker raised an error.'),
        true,
      );
    };
    worker.onmessageerror = () =>
      this.failPending(new Error('PNG Worker returned an unreadable message.'), true);
    this.worker = worker;
    console.info(
      'PANDA_STAGE_O2_WORKER ' +
        JSON.stringify({ event: 'created', jobId: this.options.jobId ?? null }),
    );
    return worker;
  }

  private onWorkerMessage(message: WorkerPngMessage): void {
    const pending = this.pending;
    if (!pending || !sameIdentity(message, pending.identity)) return;
    if (message.type === 'encode-error') {
      this.failPending(new Error(message.error), true);
      return;
    }

    if (
      message.width !== 1_920 ||
      message.height !== 1_080 ||
      !(message.bytes instanceof ArrayBuffer) ||
      message.bytes.byteLength <= 8 ||
      ![
        message.workerDrawMs,
        message.convertToBlobMs,
        message.arrayBufferMs,
        message.workerEncodeMs,
      ].every((value) => Number.isFinite(value) && value >= 0)
    ) {
      this.failPending(new Error('PNG Worker returned an invalid frame.'), true);
      return;
    }

    clearTimeout(pending.timer);
    this.pending = null;
    const workerRoundTripMs =
      pending.dispatchedAt === null
        ? 0
        : Math.max(0, performance.now() - pending.dispatchedAt);
    pending.promiseResolve({
      pngBytes: new Uint8Array(message.bytes),
      timing: {
        snapshotMs: pending.snapshotMs ?? 0,
        transferDispatchMs: pending.transferDispatchMs ?? 0,
        workerDrawMs: message.workerDrawMs,
        convertToBlobMs: message.convertToBlobMs,
        arrayBufferMs: message.arrayBufferMs,
        workerEncodeMs: message.workerEncodeMs,
        workerReturnMs: Math.max(0, workerRoundTripMs - message.workerEncodeMs),
        workerRoundTripMs,
      },
    });
  }

  private failPending(error: Error, terminate: boolean): void {
    if (terminate) {
      this.workerFailure = error;
      this.terminateWorker();
    }
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.promiseReject(error);
  }

  private terminateWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      console.info(
        'PANDA_STAGE_O2_WORKER ' +
          JSON.stringify({ event: 'terminated', jobId: this.options.jobId ?? null }),
      );
    }
  }

  private identityOf(request: ExportRenderFrameRequest): FrameIdentity {
    return {
      jobId: request.jobId,
      frameIndex: request.frameIndex,
      timeMs: request.timeMs,
      ...(request.shotId === undefined
        ? {}
        : {
            shotId: request.shotId,
            shotLocalTimeMs: request.shotLocalTimeMs,
          }),
    };
  }
}
