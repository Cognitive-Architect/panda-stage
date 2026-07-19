import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';
import {
  AppPingRequestSchema,
  AppPingResponseSchema,
  HiddenReadyRequestSchema,
  HiddenReadyResponseSchema,
} from '../../src/shared/ipc/contracts';

describe('IPC channel registry', () => {
  it('keeps every channel unique and namespaced', () => {
    const channels = Object.values(IPC_CHANNELS);

    expect(new Set(channels).size).toBe(channels.length);
    expect(channels).toEqual(['app:ping', 'hidden:ready']);
  });
});

describe('IPC contracts', () => {
  it('accepts only the empty app ping request', () => {
    expect(AppPingRequestSchema.parse({})).toEqual({});
    expect(AppPingRequestSchema.safeParse({ command: 'fs.read' }).success).toBe(
      false,
    );
  });

  it('validates the pong response', () => {
    expect(
      AppPingResponseSchema.parse({ message: 'pong', receivedAtMs: 123 }),
    ).toEqual({ message: 'pong', receivedAtMs: 123 });
    expect(
      AppPingResponseSchema.safeParse({ message: 'unexpected', receivedAtMs: 123 })
        .success,
    ).toBe(false);
  });

  it('validates both sides of the hidden ready handshake', () => {
    expect(
      HiddenReadyRequestSchema.parse({
        role: 'hidden-renderer',
        loadedAtMs: 456,
      }),
    ).toEqual({ role: 'hidden-renderer', loadedAtMs: 456 });
    expect(
      HiddenReadyResponseSchema.parse({
        acknowledged: true,
        role: 'hidden-renderer',
      }),
    ).toEqual({ acknowledged: true, role: 'hidden-renderer' });
  });

  it('rejects hidden ready payloads with extra capabilities', () => {
    expect(
      HiddenReadyRequestSchema.safeParse({
        role: 'hidden-renderer',
        loadedAtMs: 456,
        execute: 'child_process',
      }).success,
    ).toBe(false);
  });
});
