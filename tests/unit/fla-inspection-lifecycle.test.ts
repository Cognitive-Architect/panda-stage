import { describe, expect, it, vi } from 'vitest';
import type {
  AnimationImportIR,
  FlaInspectionStarted,
  FlaInspectionResponse,
} from '../../src/shared/fla-import-api';
import {
  FlaInspectionLifecycle,
  isFlaInspectionUserCancelled,
  subscribeToFlaInspection,
  type FlaInspectionClient,
} from '../../src/renderer/fla-import/fla-inspection-lifecycle';

const sessionIds = [
  '00000000-0000-4000-8000-000000000264',
  '00000000-0000-4000-8000-000000000265',
  '00000000-0000-4000-8000-000000000266',
];

function ir(): AnimationImportIR {
  return {
    source: {
      format: 'fla',
      basename: 'sample.fla',
      byteLength: 1,
      sha256: 'a'.repeat(64),
      parser: {
        package: 'lifeart/fla-viewer',
        entrypoint: 'FLAParser.parse',
        commit: '048000ccab67469980b8dedd1fc2b65a02d2b164',
      },
    },
    document: {
      width: 1,
      height: 1,
      frameRate: 1,
      backgroundColor: '#fff',
    },
    media: [],
    timelines: [],
    compatibility: [],
    summary: {
      placedInstanceCount: 0,
      libraryOnlyMediaCount: 0,
    },
  };
}

function success(sessionId: string): FlaInspectionResponse {
  return { ok: true, sessionId, ir: ir() };
}

function failure(message = 'inspection failed'): FlaInspectionResponse {
  return {
    ok: false,
    error: { code: 'PARSER_CRASH', message },
  };
}

function deferredClient(): {
  client: FlaInspectionClient;
  resolve: (requestId: string, response: FlaInspectionResponse) => void;
  emitStarted: (requestId: string) => void;
  chooseAndInspect: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  const resolvers = new Map<
    string,
    (response: FlaInspectionResponse) => void
  >();
  const startedListeners = new Set<
    (event: FlaInspectionStarted) => void
  >();
  const chooseAndInspect = vi.fn(
    (requestId: string) =>
      new Promise<FlaInspectionResponse>((resolve) => {
        resolvers.set(requestId, resolve);
      }),
  );
  const onInspectionStarted = vi.fn(
    (callback: (event: FlaInspectionStarted) => void) => {
      startedListeners.add(callback);
      return () => startedListeners.delete(callback);
    },
  );
  const cancel = vi.fn(async () => ({ accepted: true as const }));
  return {
    client: { chooseAndInspect, onInspectionStarted, cancel },
    chooseAndInspect,
    cancel,
    emitStarted: (requestId) => {
      for (const listener of startedListeners) listener({ requestId });
    },
    resolve: (requestId, response) => {
      const resolver = resolvers.get(requestId);
      if (!resolver) throw new Error(`No pending request: ${requestId}`);
      resolvers.delete(requestId);
      resolver(response);
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('FLA chooser and inspection lifecycle', () => {
  it('keeps native picker cancellation distinct from a genuine failure', () => {
    expect(isFlaInspectionUserCancelled({
      ok: false,
      error: { code: 'USER_CANCELLED', message: 'cancelled' },
    })).toBe(true);
    expect(isFlaInspectionUserCancelled(failure())).toBe(false);
  });

  it('resolves inspectionStarted only for the matching authoritative selection', async () => {
    const harness = deferredClient();
    const lifecycle = new FlaInspectionLifecycle(
      harness.client,
      () => '00000000-0000-4000-8000-000000000264',
    );
    const operation = lifecycle.start();
    let started = false;
    void operation.inspectionStarted.then(() => {
      started = true;
    });

    harness.emitStarted('00000000-0000-4000-8000-000000000265');
    await flushPromises();
    expect(started).toBe(false);

    harness.emitStarted(operation.requestId);
    await flushPromises();
    expect(started).toBe(true);
  });

  it('keeps a StrictMode-equivalent repeated start single-flight', () => {
    const harness = deferredClient();
    const lifecycle = new FlaInspectionLifecycle(
      harness.client,
      () => '00000000-0000-4000-8000-000000000264',
    );

    const first = lifecycle.start();
    const replayedStart = lifecycle.start();

    expect(replayedStart).toBe(first);
    expect(harness.chooseAndInspect).toHaveBeenCalledTimes(1);
    expect(harness.chooseAndInspect).toHaveBeenCalledWith(first.requestId);
  });

  it('does not let the first StrictMode subscription consume the live result', async () => {
    const harness = deferredClient();
    const lifecycle = new FlaInspectionLifecycle(
      harness.client,
      () => '00000000-0000-4000-8000-000000000264',
    );
    const operation = lifecycle.start();
    const firstResults: FlaInspectionResponse[] = [];
    const secondResults: FlaInspectionResponse[] = [];

    const cleanupFirst = subscribeToFlaInspection(
      operation,
      (response) => firstResults.push(response),
      () => undefined,
    );
    cleanupFirst();
    const cleanupSecond = subscribeToFlaInspection(
      operation,
      (response) => secondResults.push(response),
      () => undefined,
    );

    harness.resolve(operation.requestId, success(sessionIds[0]!));
    await flushPromises();
    cleanupSecond();

    expect(firstResults).toEqual([]);
    expect(secondResults).toHaveLength(1);
    expect(secondResults[0]).toMatchObject({
      ok: true,
      sessionId: sessionIds[0],
    });
  });

  it('ignores a stale result after cancel and reopen', async () => {
    const harness = deferredClient();
    let nextId = 0;
    const lifecycle = new FlaInspectionLifecycle(
      harness.client,
      () => `00000000-0000-4000-8000-00000000026${++nextId}`,
    );
    const first = lifecycle.start();
    const staleResults: FlaInspectionResponse[] = [];
    const cleanupFirst = subscribeToFlaInspection(
      first,
      (response) => staleResults.push(response),
      () => undefined,
    );

    await lifecycle.cancel();
    cleanupFirst();
    const second = lifecycle.start();
    const liveResults: FlaInspectionResponse[] = [];
    const cleanupSecond = subscribeToFlaInspection(
      second,
      (response) => liveResults.push(response),
      () => undefined,
    );

    harness.resolve(first.requestId, success(sessionIds[0]!));
    harness.resolve(second.requestId, success(sessionIds[1]!));
    await flushPromises();
    cleanupSecond();

    expect(staleResults).toEqual([]);
    expect(liveResults).toHaveLength(1);
    expect(liveResults[0]).toMatchObject({
      ok: true,
      sessionId: sessionIds[1],
    });
  });

  it('transitions successful and bounded error responses out of inspecting', async () => {
    const harness = deferredClient();
    const lifecycle = new FlaInspectionLifecycle(
      harness.client,
      () => '00000000-0000-4000-8000-000000000264',
    );
    const operation = lifecycle.start();
    let phase: 'inspecting' | 'ready' | 'error' = 'inspecting';
    const cleanup = subscribeToFlaInspection(
      operation,
      (response) => {
        phase = response.ok ? 'ready' : 'error';
      },
      () => {
        phase = 'error';
      },
    );

    harness.resolve(operation.requestId, failure());
    await flushPromises();
    cleanup();
    expect(phase).toBe('error');

    await lifecycle.cancel();
    const second = lifecycle.start();
    phase = 'inspecting';
    const secondCleanup = subscribeToFlaInspection(
      second,
      (response) => {
        phase = response.ok ? 'ready' : 'error';
      },
      () => {
        phase = 'error';
      },
    );
    harness.resolve(second.requestId, success(sessionIds[1]!));
    await flushPromises();
    secondCleanup();
    expect(phase).toBe('ready');
  });

  it('cancels request and session identities and supports repeated reopen', async () => {
    const harness = deferredClient();
    let nextId = 0;
    const lifecycle = new FlaInspectionLifecycle(
      harness.client,
      () => `00000000-0000-4000-8000-00000000026${++nextId}`,
    );

    for (const sessionId of sessionIds) {
      const operation = lifecycle.start();
      harness.resolve(operation.requestId, success(sessionId));
      await flushPromises();
      await lifecycle.cancel();
    }

    expect(harness.chooseAndInspect).toHaveBeenCalledTimes(sessionIds.length);
    expect(harness.cancel.mock.calls).toEqual(
      sessionIds.flatMap((sessionId, index) => [
        [`00000000-0000-4000-8000-00000000026${index + 1}`],
        [sessionId],
      ]),
    );
  });
});
