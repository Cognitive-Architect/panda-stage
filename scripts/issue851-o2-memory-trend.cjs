function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summarizeMemoryTrend(samples, field = 'privateBytes') {
  const ordered = samples
    .filter((sample) => Number.isFinite(sample.elapsedMs) && Number.isFinite(sample[field]))
    .sort((left, right) => left.elapsedMs - right.elapsedMs);
  const buckets = Array.from({ length: 4 }, (_, index) => {
    const start = Math.floor(ordered.length * index / 4);
    const end = Math.floor(ordered.length * (index + 1) / 4);
    return median(ordered.slice(start, end).map((sample) => sample[field]));
  });
  const growthThresholdBytes = Math.max(64 * 1_024 * 1_024, (buckets[0] ?? 0) * 0.25);
  const bucketMediansNondecreasing = buckets.every((value, index) =>
    index === 0 || value === null || buckets[index - 1] === null || value >= buckets[index - 1],
  );
  const increaseBytes = ordered.length > 0
    ? ordered.at(-1)[field] - ordered[0][field]
    : null;
  const sustainedUncontrolledGrowth = ordered.length >= 8 &&
    bucketMediansNondecreasing &&
    (buckets.at(-1) ?? 0) - (buckets[0] ?? 0) >= growthThresholdBytes;
  const durationSeconds = ordered.length > 1
    ? (ordered.at(-1).elapsedMs - ordered[0].elapsedMs) / 1_000
    : null;
  return {
    sampleCount: ordered.length,
    startBytes: ordered[0]?.[field] ?? null,
    endBytes: ordered.at(-1)?.[field] ?? null,
    increaseBytes,
    slopeBytesPerSecond: durationSeconds && durationSeconds > 0
      ? increaseBytes / durationSeconds
      : null,
    quarterMedianBytes: buckets,
    growthThresholdBytes,
    sustainedUncontrolledGrowth,
    assessment: ordered.length < 8 ? 'INSUFFICIENT_SAMPLES' :
      sustainedUncontrolledGrowth ? 'SUSTAINED_UPWARD_GROWTH' : 'NO_SUSTAINED_UPWARD_GROWTH',
  };
}

module.exports = { summarizeMemoryTrend };
