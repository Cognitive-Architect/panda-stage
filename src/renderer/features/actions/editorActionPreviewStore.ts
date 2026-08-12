import type { EditorActionPreviewSession } from './editorActionPreviewModel';

export interface EditorActionPreviewState {
  active: boolean;
  /** True only after the current run has a valid authoritative render frame. */
  playing: boolean;
  /** Monotonic identity for one Apply or Replay preparation/playback run. */
  runId: number;
  session: EditorActionPreviewSession | null;
  /** Current playback position in milliseconds within the active session. */
  timeMs: number;
}

/**
 * Injectable clock so unit tests can drive frames deterministically without a
 * real animation frame. In the browser this is backed by
 * `performance.now()` + `requestAnimationFrame`.
 */
export interface PreviewClock {
  now(): number;
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(handle: number): void;
}

const defaultClock: PreviewClock = {
  now: () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now(),
  requestFrame: (callback) =>
    typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame(callback)
      : 0,
  cancelFrame: (handle) => {
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(handle);
    }
  },
};

/**
 * Transient editor-side preview of an applied ActionPreset.
 *
 * Contract (Issue #162):
 *   - Owns ONLY its own playback clock (`timeMs`) and the session identity. It
 *     never reads or writes the project, the revision, the dirty flag, the
 *     selection or the history. It reuses the formal evaluator via
 *     `evaluatePreviewFrame`; it does not implement a second animation model.
 *   - Readiness handshake: Apply/Replay first enter an active preparation state
 *     pinned at `session.startMs`. The bounded clock starts only when the
 *     formal renderer authorizes that exact `runId` after a valid first frame.
 *   - Bounded: once authorized, a session runs from `session.startMs` to
 *     `session.endMs` and then stops, restoring the normal editor render path.
 *   - Single session mutex: starting a new preview (or calling `replay`) always
 *     deterministically cancels any in-flight frame loop of the previous one via
 *     a monotonically increasing `sessionToken`, so no two loops can interleave.
 *   - The clock is injectable so unit tests can drive frames deterministically.
 */
export class EditorActionPreviewStore {
  private state: EditorActionPreviewState = {
    active: false,
    playing: false,
    runId: 0,
    session: null,
    timeMs: 0,
  };
  private clock: PreviewClock = defaultClock;
  private frameHandle: number | null = null;
  private lastTickAt = 0;
  private sessionToken = 0;
  private readonly listeners = new Set<() => void>();

  readonly getState = (): EditorActionPreviewState => this.state;
  readonly getSnapshot = (): EditorActionPreviewState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Test seam: replace the wall-clock / rAF scheduler. */
  setClock(clock: PreviewClock): void {
    this.clock = clock;
  }

  isActive(): boolean {
    return this.state.active;
  }

  hasSession(): boolean {
    return this.state.session !== null;
  }

  /** Begin a bounded preview over the session window. Returns false if invalid. */
  start(session: EditorActionPreviewSession): boolean {
    if (!session || session.endMs <= session.startMs) {
      return false;
    }
    this.stop();
    const runId = ++this.sessionToken;
    this.state = {
      active: true,
      playing: false,
      runId,
      session: { ...session },
      timeMs: session.startMs,
    };
    this.emit();
    return true;
  }

  /** Re-run the retained session from its start. No-op when nothing to replay. */
  replay(): void {
    const session = this.state.session;
    if (!session) return;
    const runId = ++this.sessionToken;
    this.clearFrame();
    this.state = {
      ...this.state,
      active: true,
      playing: false,
      runId,
      timeMs: session.startMs,
    };
    this.emit();
  }

  /** Start the bounded clock only for the exact run whose first frame is ready. */
  beginPlayback(runId: number): boolean {
    if (
      runId !== this.sessionToken ||
      runId !== this.state.runId ||
      !this.state.active ||
      !this.state.session
    ) {
      return false;
    }
    if (this.state.playing) {
      return true;
    }
    this.state = { ...this.state, playing: true };
    this.emit();
    this.scheduleTick(runId);
    return true;
  }

  /** Immediately end the preview and drop the retained session. */
  stop(): void {
    this.sessionToken += 1;
    this.clearFrame();
    if (this.state.active || this.state.session) {
      this.state = {
        active: false,
        playing: false,
        runId: this.sessionToken,
        session: null,
        timeMs: 0,
      };
      this.emit();
    }
  }

  private scheduleTick(token: number): void {
    this.lastTickAt = this.clock.now();
    this.frameHandle = this.clock.requestFrame((now) => this.tick(token, now));
  }

  private tick(token: number, now: number): void {
    if (token !== this.sessionToken) {
      this.clearFrame();
      return;
    }
    const session = this.state.session;
    if (!session || !this.state.active || !this.state.playing) {
      this.clearFrame();
      return;
    }
    const delta = Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;
    const next = this.state.timeMs + delta;
    if (next >= session.endMs) {
      this.state = { ...this.state, timeMs: session.endMs };
      this.emit();
      this.clearFrame();
      this.finish();
      return;
    }
    this.state = { ...this.state, timeMs: next };
    this.emit();
    if (token === this.sessionToken) {
      this.scheduleTick(token);
    }
  }

  private finish(): void {
    this.sessionToken += 1;
    // Keep the session (so "重播动作"/replay stays available) and the final
    // position (so the last rendered frame is the action's end state), but stop
    // active playback so the editor's normal render path is restored.
    this.state = {
      active: false,
      playing: false,
      runId: this.sessionToken,
      session: this.state.session,
      timeMs: this.state.timeMs,
    };
    this.emit();
  }

  private clearFrame(): void {
    if (this.frameHandle !== null) {
      this.clock.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const editorActionPreviewStore = new EditorActionPreviewStore();
