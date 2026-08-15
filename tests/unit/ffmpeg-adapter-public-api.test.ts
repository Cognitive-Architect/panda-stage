import { describe, expect, it } from 'vitest';
import {
  FFmpegAdapter,
  FFmpegAdapterError,
  NodeProcessRunner,
  type ActiveProcessDiagnostic,
  type FFmpegDiagnostics,
  type FFmpegErrorCode,
  type ProcessResult,
  type ProcessRunOptions,
  type ProcessRunner,
} from '../../src/main/services/FFmpegAdapter';

/**
 * RH-01 contract lock — public import/export surface.
 *
 * These tests must keep passing when a later extraction (RH-02/RH-03) moves the
 * adapter/error/runner types into separate modules, as long as the repository's
 * public entry point `src/main/services/FFmpegAdapter` keeps re-exporting the
 * symbols the rest of the codebase depends on.
 */

// Compile-time lock: every contract error code must remain a member of the
// `FFmpegErrorCode` union. Removing or renaming a value is a type error, which
// fails `pnpm typecheck` and blocks the refactor from silently breaking callers.
const CONTRACT_ERROR_CODES: readonly FFmpegErrorCode[] = [
  'EXECUTABLE_NOT_FOUND',
  'ENCODER_UNAVAILABLE',
  'FRAME_SEQUENCE_INVALID',
  'VIDEO_INPUT_INVALID',
  'AUDIO_INPUT_INVALID',
  'OUTPUT_ALREADY_EXISTS',
  'OUTPUT_NOT_WRITABLE',
  'PROCESS_FAILED',
  'PROCESS_CANCELLED',
  'PROBE_FAILED',
  'PROBE_MISMATCH',
];

// Structural compile-time locks for the interface shapes. If a field is renamed
// or removed, these assignments fail typecheck.
const _diagnosticsShape: FFmpegDiagnostics = { executable: 'ffmpeg', args: [] };
const _activeShape: ActiveProcessDiagnostic = {
  executable: 'ffmpeg',
  args: [],
  pid: 1,
};
void _diagnosticsShape;
void _activeShape;

// Minimal runner used to prove dependency injection without spawning a process.
type Queued = ProcessResult | Error;
class StubRunner implements ProcessRunner {
  readonly calls: Array<{
    executable: string;
    args: readonly string[];
    options?: ProcessRunOptions;
  }> = [];

  constructor(private readonly queue: Queued[]) {}

  async run(
    executable: string,
    args: readonly string[],
    options?: ProcessRunOptions,
  ): Promise<ProcessResult> {
    this.calls.push({ executable, args: [...args], options });
    const next = this.queue.shift();
    if (!next) throw new Error('StubRunner queue empty');
    if (next instanceof Error) throw next;
    return next;
  }
}

const VERSION_RESULT: ProcessResult = {
  code: 0,
  signal: null,
  stdout: 'ffmpeg version test-build Copyright test\n',
  stderr: '',
};
const ENCODERS_RESULT: ProcessResult = {
  code: 0,
  signal: null,
  stdout: ' V..... libx264 H.264 encoder\n',
  stderr: '',
};

describe('FFmpegAdapter public export surface', () => {
  it('exports the public adapter/error/runner symbols as runtime values', () => {
    expect(typeof FFmpegAdapter).toBe('function');
    expect(typeof FFmpegAdapterError).toBe('function');
    expect(typeof NodeProcessRunner).toBe('function');
  });

  it('exposes the full public method surface on an adapter instance', () => {
    const adapter = new FFmpegAdapter({ runner: new StubRunner([]) });
    const methods = [
      'getVersion',
      'validateExecutable',
      'validateAudioMuxExecutable',
      'encodePngSequence',
      'muxSingleAudio',
      'probeVideo',
      'probeAudioFile',
      'analyzeAudioTiming',
      'assertProbeMatches',
      'assertMuxProbeMatches',
      'getActiveProcessCount',
      'getProcessDiagnostics',
    ] as const;
    for (const method of methods) {
      expect(typeof (adapter as unknown as Record<string, unknown>)[method]).toBe(
        'function',
      );
    }
  });

  it('honors injected ffmpeg/ffprobe paths on the public options contract', () => {
    const adapter = new FFmpegAdapter({
      ffmpegPath: 'C:\\Tools\\ffmpeg.exe',
      ffprobePath: 'C:\\Tools\\ffprobe.exe',
      runner: new StubRunner([]),
    });
    expect(adapter.ffmpegPath).toBe('C:\\Tools\\ffmpeg.exe');
    expect(adapter.ffprobePath).toBe('C:\\Tools\\ffprobe.exe');
  });

  it('injects a custom ProcessRunner instead of spawning a real process', async () => {
    const runner = new StubRunner([VERSION_RESULT, ENCODERS_RESULT]);
    const adapter = new FFmpegAdapter({ runner });

    await expect(adapter.validateExecutable()).resolves.toMatchObject({
      hasLibx264: true,
    });
    expect(runner.calls.map((call) => call.args)).toEqual([
      ['-version'],
      ['-hide_banner', '-encoders'],
    ]);
  });

  it('keeps NodeProcessRunner assignable to the public ProcessRunner interface', () => {
    // Compile-time lock: NodeProcessRunner must satisfy the public ProcessRunner
    // interface so a later extraction can preserve the same contract.
    const _runnerSatisfiesInterface: ProcessRunner = new NodeProcessRunner();
    void _runnerSatisfiesInterface;
  });
});

describe('FFmpegErrorCode contract set', () => {
  it('locks the exact set of observable error codes', () => {
    expect(CONTRACT_ERROR_CODES).toHaveLength(11);
    for (const code of CONTRACT_ERROR_CODES) {
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    }
  });
});
