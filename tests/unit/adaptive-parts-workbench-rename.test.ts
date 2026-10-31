import { describe, expect, it, vi } from 'vitest';
import { resolveAdaptivePartRename } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';

describe('Adaptive Parts inline rename completion', () => {
  it('keeps the controlled input value and error when the session rejects a rename', () => {
    const inputValue = '  C0 temporary name  ';
    const rename = vi.fn(() => ({ ok: false as const, message: 'The assembly session expired.' }));

    const result = resolveAdaptivePartRename(inputValue, 'com3', rename);

    expect(rename).toHaveBeenCalledWith('C0 temporary name');
    expect(result).toEqual({
      ok: false,
      inputValue,
      error: 'The assembly session expired.',
    });
  });

  it('keeps trim, empty-name, length, and no-change behavior', () => {
    const rename = vi.fn(() => ({ ok: true as const }));

    expect(resolveAdaptivePartRename('  New name  ', 'com3', rename)).toEqual({
      ok: true,
      value: 'New name',
    });
    expect(resolveAdaptivePartRename('com3', 'com3', rename)).toEqual({
      ok: true,
      value: 'com3',
    });
    expect(rename).toHaveBeenCalledTimes(1);
    expect(resolveAdaptivePartRename('   ', 'com3', rename).ok).toBe(false);
    expect(resolveAdaptivePartRename('x'.repeat(201), 'com3', rename).ok).toBe(false);
  });
});
