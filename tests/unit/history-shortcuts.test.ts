import { describe, expect, it } from 'vitest';
import { resolveHistoryShortcut } from '../../src/renderer/features/editor/useHistoryShortcuts';

function event(
  overrides: Partial<Parameters<typeof resolveHistoryShortcut>[0]>,
): Parameters<typeof resolveHistoryShortcut>[0] {
  return {
    key: 'z',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target: null,
    ...overrides,
  };
}

describe('history shortcuts', () => {
  it('maps standard undo and redo combinations', () => {
    expect(resolveHistoryShortcut(event({}))).toBe('undo');
    expect(
      resolveHistoryShortcut(event({ key: 'Z', shiftKey: true })),
    ).toBe('redo');
    expect(resolveHistoryShortcut(event({ key: 'y' }))).toBe('redo');
    expect(
      resolveHistoryShortcut(
        event({ ctrlKey: false, metaKey: true }),
      ),
    ).toBe('undo');
  });

  it('does not hijack unrelated or already handled input', () => {
    expect(resolveHistoryShortcut(event({ ctrlKey: false }))).toBeNull();
    expect(resolveHistoryShortcut(event({ altKey: true }))).toBeNull();
    expect(resolveHistoryShortcut(event({ key: 'x' }))).toBeNull();
    expect(
      resolveHistoryShortcut(event({ defaultPrevented: true })),
    ).toBeNull();
  });
});
