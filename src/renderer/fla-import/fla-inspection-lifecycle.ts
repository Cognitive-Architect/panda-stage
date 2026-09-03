import type {
  FlaCancelResponse,
  FlaInspectionStarted,
  FlaInspectionResponse,
} from '../../shared/fla-import-api';

export interface FlaInspectionClient {
  chooseAndInspect: (requestId: string) => Promise<FlaInspectionResponse>;
  onInspectionStarted: (
    callback: (event: FlaInspectionStarted) => void,
  ) => () => void;
  cancel: (sessionId: string) => Promise<FlaCancelResponse>;
}

export interface FlaInspectionOperation {
  readonly requestId: string;
  /** Resolves after the native chooser has returned a selected source. */
  readonly inspectionStarted: Promise<void>;
  readonly response: Promise<FlaInspectionResponse>;
}

interface ActiveInspection {
  readonly operation: FlaInspectionOperation;
  cancelled: boolean;
  sessionId: string | null;
}

const cancelledResponse = (): FlaInspectionResponse => ({
  ok: false,
  error: {
    code: 'USER_CANCELLED',
    message: 'FLA inspection was cancelled',
  },
});

/**
 * Picker cancellation is an intentional dismissal, not an inspection
 * failure.  Keep this distinction next to the operation lifecycle so every
 * consumer can preserve the same three-outcome contract.
 */
export function isFlaInspectionUserCancelled(
  response: FlaInspectionResponse,
): boolean {
  return !response.ok && response.error.code === 'USER_CANCELLED';
}

/**
 * Owns one user-started FLA chooser/inspection operation at a time.
 *
 * The operation is created by an explicit Import action rather than by a
 * component mount effect.  That makes React StrictMode effect replay safe:
 * effects may subscribe twice, but they cannot create another native picker.
 */
export class FlaInspectionLifecycle {
  private active: ActiveInspection | null = null;
  private pendingCancellation: Promise<void> | null = null;

  public constructor(
    private readonly client: FlaInspectionClient,
    private readonly requestIdFactory: () => string = () => crypto.randomUUID(),
  ) {}

  public start(): FlaInspectionOperation {
    if (this.active) return this.active.operation;

    const requestId = this.requestIdFactory();
    const waitForCancellation = this.pendingCancellation;
    let resolveResponse!: (response: FlaInspectionResponse) => void;
    let rejectResponse!: (error: unknown) => void;
    let resolveInspectionStarted!: () => void;
    let inspectionStartedSettled = false;
    const response = new Promise<FlaInspectionResponse>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const inspectionStarted = new Promise<void>((resolve) => {
      resolveInspectionStarted = resolve;
    });
    let removeInspectionStartedListener: (() => void) | null = null;
    const cleanupInspectionStartedListener = (): void => {
      removeInspectionStartedListener?.();
      removeInspectionStartedListener = null;
    };
    const markInspectionStarted = (): void => {
      if (inspectionStartedSettled) return;
      inspectionStartedSettled = true;
      cleanupInspectionStartedListener();
      resolveInspectionStarted();
    };
    const operation: FlaInspectionOperation = {
      requestId,
      inspectionStarted,
      response,
    };
    removeInspectionStartedListener = this.client.onInspectionStarted((event) => {
      if (event.requestId === requestId) markInspectionStarted();
    });
    if (inspectionStartedSettled) cleanupInspectionStartedListener();
    const active: ActiveInspection = {
      operation,
      cancelled: false,
      sessionId: null,
    };
    this.active = active;

    const invoke = async (): Promise<void> => {
      try {
        if (waitForCancellation) await waitForCancellation;
        if (active.cancelled) {
          resolveResponse(cancelledResponse());
          return;
        }
        resolveResponse(await this.client.chooseAndInspect(requestId));
      } catch (error) {
        rejectResponse(error);
      }
    };
    void invoke();

    void response.then(
      (result) => {
        if (isFlaInspectionUserCancelled(result)) {
          cleanupInspectionStartedListener();
          return;
        }
        // The event is sent before Main enters preflight.  This response
        // fallback keeps the operation truthful even if a renderer subscribes
        // after a very fast inspection has already completed.
        markInspectionStarted();
        if (!result.ok) return;
        active.sessionId = result.sessionId;
        if (active.cancelled) {
          void this.client.cancel(result.sessionId).catch(() => undefined);
        }
      },
      () => markInspectionStarted(),
    );
    return operation;
  }

  public async cancel(): Promise<void> {
    const active = this.active;
    if (!active) {
      if (this.pendingCancellation) await this.pendingCancellation;
      return;
    }

    this.active = null;
    active.cancelled = true;
    const identifiers = [active.operation.requestId, active.sessionId].filter(
      (identifier): identifier is string => Boolean(identifier),
    );
    const cancellation = Promise.allSettled(
      identifiers.map((identifier) => this.client.cancel(identifier)),
    ).then(() => undefined);
    this.pendingCancellation = cancellation;
    try {
      await cancellation;
    } finally {
      if (this.pendingCancellation === cancellation) {
        this.pendingCancellation = null;
      }
    }
  }
}

/**
 * Subscribe to a live operation without allowing an obsolete subscription to
 * handle a later result.  The returned cleanup is intentionally local to the
 * subscription; it never cancels the user-owned operation.
 */
export function subscribeToFlaInspection(
  operation: FlaInspectionOperation,
  onResponse: (response: FlaInspectionResponse) => void,
  onError: (error: unknown) => void,
): () => void {
  let disposed = false;
  void operation.response.then(
    (response) => {
      if (!disposed) onResponse(response);
    },
    (error: unknown) => {
      if (!disposed) onError(error);
    },
  );
  return () => {
    disposed = true;
  };
}
