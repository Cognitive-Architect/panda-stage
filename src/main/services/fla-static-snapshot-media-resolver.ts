/**
 * Narrow C02 bridge from Panda-owned inspection PNG payloads to the snapshot
 * compositor. It intentionally returns only image identity, dimensions, and
 * encoded bytes; parser/runtime objects and filesystem capabilities stay out.
 */

import type { AnimationImportIR } from '../../shared/fla-import-api';
import type {
  FlaStaticSnapshotBitmapMedia,
  FlaStaticSnapshotBitmapMediaLookup,
  FlaStaticSnapshotBitmapMediaLookupResult,
} from './fla-static-snapshot-svg-builder';

type FlaBitmapMedia = AnimationImportIR['media'][number];

type IndexedBitmapMedia = FlaStaticSnapshotBitmapMedia;

function normalizeReference(value: string): string | null {
  const normalized = value.trim().replaceAll('\\', '/').normalize('NFKC').toLocaleLowerCase('en-US');
  if (!normalized || normalized.includes('\0')) return null;
  return normalized;
}

function referenceBasename(value: string): string {
  return value.slice(value.lastIndexOf('/') + 1);
}

function addCandidate(
  index: Map<string, Map<string, IndexedBitmapMedia>>,
  alias: string,
  media: IndexedBitmapMedia,
): void {
  const key = normalizeReference(alias);
  if (!key) return;
  let candidates = index.get(key);
  if (!candidates) {
    candidates = new Map();
    index.set(key, candidates);
  }
  candidates.set(media.id, media);
}

function resolveCandidates(
  candidates: Map<string, IndexedBitmapMedia> | undefined,
): FlaStaticSnapshotBitmapMediaLookupResult {
  if (!candidates || candidates.size === 0) return { ok: false, reason: 'missing' };
  if (candidates.size !== 1) return { ok: false, reason: 'ambiguous' };
  const media = candidates.values().next().value as IndexedBitmapMedia | undefined;
  if (!media) return { ok: false, reason: 'missing' };
  return {
    ok: true,
    media: {
      id: media.id,
      width: media.width,
      height: media.height,
      pngBytes: media.pngBytes,
    },
  };
}

/**
 * Resolve an XFL library-item reference against the current inspection
 * session's already-decoded Panda-owned PNG media. Exact normalized aliases
 * take priority; basename fallback is accepted only when it is unambiguous.
 */
export function createFlaStaticSnapshotBitmapMediaLookup(
  mediaItems: readonly FlaBitmapMedia[],
): FlaStaticSnapshotBitmapMediaLookup {
  const exact = new Map<string, Map<string, IndexedBitmapMedia>>();
  const byBasename = new Map<string, Map<string, IndexedBitmapMedia>>();

  for (const item of mediaItems) {
    const aliases = [item.name, item.sourceReference, item.bitmapDataReference ?? '']
      .filter((value): value is string => Boolean(value));
    const indexed: IndexedBitmapMedia = {
      id: item.id,
      width: item.width,
      height: item.height,
      pngBytes: item.payload.bytes,
    };
    for (const alias of aliases) {
      addCandidate(exact, alias, indexed);
      addCandidate(byBasename, referenceBasename(alias.replaceAll('\\', '/')), indexed);
    }
  }

  return (sourceLibraryItemName) => {
    const key = normalizeReference(sourceLibraryItemName);
    if (!key) return { ok: false, reason: 'missing' };
    const exactCandidates = exact.get(key);
    if (exactCandidates?.size) return resolveCandidates(exactCandidates);
    return resolveCandidates(byBasename.get(referenceBasename(key)));
  };
}
