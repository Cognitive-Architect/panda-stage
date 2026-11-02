import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { summarizeMemoryTrend } = require('../../scripts/issue851-o2-memory-trend.cjs') as {
  summarizeMemoryTrend: (
    samples: Array<{ elapsedMs: number; privateBytes: number; workingSetBytes?: number }>,
    field?: 'privateBytes' | 'workingSetBytes',
  ) => {
    sampleCount: number;
    sustainedUncontrolledGrowth: boolean;
    assessment: string;
  };
};

const MiB = 1_024 * 1_024;

describe('Issue #851 live memory trend gate', () => {
  it('does not classify a stable memory series with small fluctuations as rising', () => {
    const samples = Array.from({ length: 12 }, (_, index) => ({
      elapsedMs: index * 500,
      privateBytes: 100 * MiB + (index % 2) * MiB,
      workingSetBytes: 140 * MiB + (index % 2) * MiB,
    }));

    const trend = summarizeMemoryTrend(samples);
    expect(trend.sampleCount).toBe(12);
    expect(trend.sustainedUncontrolledGrowth).toBe(false);
    expect(trend.assessment).toBe('NO_SUSTAINED_UPWARD_GROWTH');
  });

  it('flags sustained growth across all four time buckets', () => {
    const bucketValues = [100, 110, 160, 170, 250, 260, 400, 410];
    const samples = bucketValues.map((value, index) => ({
      elapsedMs: index * 500,
      privateBytes: value * MiB,
      workingSetBytes: (value + 40) * MiB,
    }));

    const trend = summarizeMemoryTrend(samples);
    expect(trend.sampleCount).toBe(8);
    expect(trend.sustainedUncontrolledGrowth).toBe(true);
    expect(trend.assessment).toBe('SUSTAINED_UPWARD_GROWTH');
    expect(summarizeMemoryTrend(samples, 'workingSetBytes').sustainedUncontrolledGrowth).toBe(true);
  });
});
