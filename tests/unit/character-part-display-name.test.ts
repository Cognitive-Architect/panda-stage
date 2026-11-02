import { describe, expect, it } from 'vitest';
import { localizeDefaultAdaptivePartName } from '../../src/renderer/features/characters/characterPartDisplayName';

describe('adaptive Part display names', () => {
  it('localizes only the generated Part N default labels', () => {
    expect(localizeDefaultAdaptivePartName('Part 1')).toBe('零件 1');
    expect(localizeDefaultAdaptivePartName('Part 5')).toBe('零件 5');
    expect(localizeDefaultAdaptivePartName('Hair')).toBe('Hair');
    expect(localizeDefaultAdaptivePartName('Part 1 (2)')).toBe('Part 1 (2)');
    expect(localizeDefaultAdaptivePartName('part 1')).toBe('part 1');
  });
});
