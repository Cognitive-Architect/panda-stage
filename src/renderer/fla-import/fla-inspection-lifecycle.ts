import type {
  FlaCancelResponse,
  FlaInspectionResponse,
} from '../../shared/fla-import-api';

export interface FlaInspectionClient {
  chooseAndInspect: (requestId: string) => Promise<FlaInspectionResponse>;
  cancel: (sessionId: string) => Promise<FlaCancelResponse>;
}

export interface FlaInspectionOperation {
  readonly requestId: string;
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
    const response = new Promise<FlaInspectionResponse>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const operation: FlaInspectionOperation = { requestId, response };
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
        if (!result.ok) return;
        active.sessionId = result.sessionId;
        if (active.cancelled) {
          void this.client.cancel(result.sessionId).catch(() => undefined);
        }
      },
      () => undefined,
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
