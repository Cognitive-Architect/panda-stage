import { describe, expect, it } from 'vitest';
import {
  FFmpegAdapterError,
  type FFmpegErrorCode,
  type FFmpegDiagnostics,
} from '../../src/main/services/FFmpegAdapter';

/**
 * RH-01 contract lock — structured error behavior.
 *
 * Locks the observable `FFmpegAdapterError` contract that later extraction work
 * (RH-02/RH-03) must preserve: the fixed `name`, `code`/`message`/`diagnostics`
 * separation, `cause` propagation, and the `PROCESS_CANCELLED` cancellation code.
 */

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

function makeError(
  code: FFmpegErrorCode,
  diagnostics: FFmpegDiagnostics,
): FFmpegAdapterError {
  return new FFmpegAdapterError(code, `user message for ${code}`, diagnostics);
}

describe('FFmpegAdapterError identity contract', () => {
  it('uses the fixed constructor name, not the default Error name', () => {
    const error = makeError('PROCESS_FAILED', { executable: 'ffmpeg', args: [] });
    expect(error.name).toBe('FFmpegAdapterError');
    expect(error.toString()).toMatch(/^FFmpegAdapterError:/u);
  });

  it('remains an instance of Error and FFmpegAdapterError', () => {
    const error = makeError('PROBE_FAILED', { executable: 'ffprobe', args: [] });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FFmpegAdapterError);
  });

  it('exposes code, message, and diagnostics as distinct, accessible members', () => {
    const diagnostics: FFmpegDiagnostics = {
      executable: 'ffmpeg',
      args: ['-version'],
      exitCode: 1,
      signal: null,
      stderr: 'hidden technical detail',
    };
    const error = makeError('PROCESS_FAILED', diagnostics);

    expect(error.code).toBe('PROCESS_FAILED');
    expect(error.message).toBe('user message for PROCESS_FAILED');
    expect(error.diagnostics).toBe(diagnostics);
    expect(error.diagnostics.stderr).toBe('hidden technical detail');
  });

  it('keeps the user message separate from the diagnostic detail', () => {
    const technicalDetail = 'filter graph exploded: XYZ-123';
    const error = makeError('PROCESS_FAILED', {
      executable: 'ffmpeg',
      args: [],
      stderr: technicalDetail,
    });

    expect(error.message).not.toContain(technicalDetail);
    expect(error.diagnostics.stderr).toContain(technicalDetail);
  });

  it('propagates diagnostics.cause into the Error cause', () => {
    const cause = new Error('underlying spawn failure');
    const error = makeError('EXECUTABLE_NOT_FOUND', {
      executable: 'ffmpeg',
      args: [],
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});

describe('FFmpegErrorCode value contract', () => {
  it('produces a well-formed error for every contract code', () => {
    for (const code of CONTRACT_ERROR_CODES) {
      const error = makeError(code, { executable: 'ffmpeg', args: [] });
      expect(error).toBeInstanceOf(FFmpegAdapterError);
      expect(error.code).toBe(code);
      expect(error.name).toBe('FFmpegAdapterError');
      expect(typeof error.message).toBe('string');
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});

describe('FFmpegAdapterError cancellation contract', () => {
  it('preserves the PROCESS_CANCELLED code and signal in diagnostics', () => {
    const error = makeError('PROCESS_CANCELLED', {
      executable: 'ffmpeg',
      args: ['-version'],
      exitCode: null,
      signal: 'SIGTERM',
    });

    expect(error.code).toBe('PROCESS_CANCELLED');
    expect(error.diagnostics.signal).toBe('SIGTERM');
  });

  it('carries a diagnostic signal even when the process had no exit code', () => {
    const error = makeError('PROCESS_CANCELLED', {
      executable: 'ffprobe',
      args: [],
      signal: 'SIGTERM',
    });
    expect(error.code).toBe('PROCESS_CANCELLED');
    expect(error.diagnostics.signal).toBe('SIGTERM');
    expect(error.diagnostics.exitCode).toBeUndefined();
  });
});
