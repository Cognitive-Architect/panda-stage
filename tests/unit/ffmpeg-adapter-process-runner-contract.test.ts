import { describe, expect, it } from 'vitest';
import {
  FFmpegAdapter,
  NodeProcessRunner,
  type ProcessResult,
  type ProcessRunOptions,
  type ProcessRunner,
} from '../../src/main/services/FFmpegAdapter';

/**
 * RH-01 contract lock — process-runner observable behavior exposed by the adapter.
 *
 * Locks externally meaningful behavior around active-process diagnostics, total
 * process count, the 256_000-character captured-output bound, and AbortSignal
 * cancellation mapping. These are observable through the public `ProcessRunner`
 * surface and `FFmpegAdapter.getProcessDiagnostics`/`getActiveProcessCount`, so
 * they must survive later extraction without a production-code change.
 */

// Mirrors the production `MAX_CAPTURED_OUTPUT_CHARS` contract. If the bound
// changes, this assertion fails and flags the contract regression.
const EXPECTED_MAX_CAPTURED_OUTPUT_CHARS = 256_000;

const VERSION_RESULT: ProcessResult = {
  code: 0,
  signal: null,
  stdout: 'ffmpeg version test-build Copyright test\n',
  stderr: '',
};

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 5));

class SignalRecordingRunner implements ProcessRunner {
  readonly calls: ProcessRunOptions[] = [];
  private started = 0;

  getActiveProcesses(): readonly never[] {
    return [];
  }

  getTotalProcessesStarted(): number {
    return this.started;
  }

  async run(
    _executable: string,
    _args: readonly string[],
    options?: ProcessRunOptions,
  ): Promise<ProcessResult> {
    this.started += 1;
    this.calls.push(options ?? {});
    return VERSION_RESULT;
  }
}

describe('NodeProcessRunner public surface', () => {
  it('implements the ProcessRunner contract with bounded, captured output', async () => {
    const runner = new NodeProcessRunner();
    const result = await runner.run(process.execPath, [
      '-e',
      "process.stdout.write('a'.repeat(300000) + 'END'); process.stderr.write('b'.repeat(300000) + 'ERR'); process.exit(0)",
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout.length).toBe(EXPECTED_MAX_CAPTURED_OUTPUT_CHARS);
    expect(result.stdout.endsWith('END')).toBe(true);
    expect(result.stderr.length).toBe(EXPECTED_MAX_CAPTURED_OUTPUT_CHARS);
    expect(result.stderr.endsWith('ERR')).toBe(true);
  });

  it('tracks active processes with executable, args, and pid diagnostics', async () => {
    const runner = new NodeProcessRunner();
    const controller = new AbortController();
    const pending = runner.run(
      process.execPath,
      ['-e', 'setTimeout(() => process.exit(0), 800)'],
      { signal: controller.signal },
    );

    while (runner.getActiveProcesses().length === 0) {
      await tick();
    }

    const active = runner.getActiveProcesses();
    expect(active.length).toBe(1);
    const diagnostic = active[0]!;
    expect(diagnostic.executable).toBe(process.execPath);
    expect(Array.isArray(diagnostic.args)).toBe(true);
    expect(typeof diagnostic.pid).toBe('number');
    expect(runner.getTotalProcessesStarted()).toBe(1);

    controller.abort();
    await pending;
    expect(runner.getActiveProcesses()).toHaveLength(0);
  });
});

describe('FFmpegAdapter process diagnostics delegation', () => {
  it('delegates total process count and active diagnostics to the runner', async () => {
    const runner = new SignalRecordingRunner();
    const adapter = new FFmpegAdapter({ runner });

    await adapter.getVersion();

    expect(adapter.getProcessDiagnostics().totalStarted).toBe(1);
    expect(adapter.getProcessDiagnostics().active).toEqual([]);
    expect(adapter.getActiveProcessCount()).toBe(0);
  });
});

describe('FFmpegAdapter AbortSignal cancellation mapping', () => {
  it('forwards the AbortSignal to the runner', async () => {
    const runner = new SignalRecordingRunner();
    const adapter = new FFmpegAdapter({ runner });
    const controller = new AbortController();

    await adapter.getVersion(controller.signal);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.signal).toBe(controller.signal);
  });

  it('maps an already-aborted signal to a PROCESS_CANCELLED error', async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new FFmpegAdapter({ runner: new SignalRecordingRunner() });

    await expect(adapter.getVersion(controller.signal)).rejects.toMatchObject({
      code: 'PROCESS_CANCELLED',
    });
  });
});
