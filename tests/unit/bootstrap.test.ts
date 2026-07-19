import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_MESSAGE } from '../../src/shared/bootstrap';

describe('Day 01 bootstrap contract', () => {
  it('keeps the required renderer-ready message stable', () => {
    expect(BOOTSTRAP_MESSAGE).toBe('Panda Stage — Bootstrap Ready');
  });
});
