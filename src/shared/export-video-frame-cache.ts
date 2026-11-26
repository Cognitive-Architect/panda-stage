export const EXPORT_VIDEO_FRAME_CACHE_LIMIT = 16;

export function touchExportVideoFrame<T>(cache: Map<string, T>, key: string): boolean {
  const entry = cache.get(key);
  if (entry === undefined) return false;
  cache.delete(key);
  cache.set(key, entry);
  return true;
}

export function storeExportVideoFrame<T>(
  cache: Map<string, T>,
  key: string,
  entry: T,
  release?: (entry: T) => void,
): void {
  const previous = cache.get(key);
  if (previous !== undefined) release?.(previous);
  cache.delete(key);
  cache.set(key, entry);
  const oldest = cache.keys().next().value;
  if (cache.size > EXPORT_VIDEO_FRAME_CACHE_LIMIT && oldest !== undefined) {
    const evicted = cache.get(oldest);
    cache.delete(oldest);
    if (evicted !== undefined) release?.(evicted);
  }
}
