import { getFlaXflDirectChildren } from './fla-static-snapshot-display-list-adapter';
import { readSelectedFlaArchiveEntry, type FlaArchiveEntry } from './fla-import-preflight-service';
import { FLA_IMPORT_LIMITS } from '../../shared/fla-import-api';

const MAX_PREFIX_BYTES = 64;
const MAX_ISO_BOXES = 4096;
const allowedBrand = /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |qt {2})$/u;

export function extractFlaNativeIsoVideo(dat: Uint8Array): { bytes: Uint8Array; mimeType: 'video/mp4' | 'video/quicktime' } | null {
  if (dat.byteLength > FLA_IMPORT_LIMITS.maxSingleEntryBytes) return null;
  const view = new DataView(dat.buffer, dat.byteOffset, dat.byteLength);
  const ascii = (offset: number) => String.fromCharCode(...dat.subarray(offset, offset + 4));
  const requireMovie = (start: number) => {
    let offset = start;
    const boxes = new Set<string>();
    for (let count = 0; offset < dat.length && count < MAX_ISO_BOXES; count += 1) {
      if (dat.length - offset < 8) return false;
      const shortSize = view.getUint32(offset);
      const type = ascii(offset + 4);
      const headerSize = shortSize === 1 ? 16 : 8;
      if (dat.length - offset < headerSize || !/^[\u0020-\u007e]{4}$/u.test(type)) return false;
      const size = shortSize === 1 ? Number(view.getBigUint64(offset + 8))
        : shortSize === 0 ? dat.length - offset : shortSize;
      if (!Number.isSafeInteger(size) || size < headerSize || size > dat.length - offset) return false;
      if ((type === 'mdat' || type === 'moov') && size > headerSize) boxes.add(type);
      offset += size;
    }
    return offset === dat.length && boxes.has('mdat') && boxes.has('moov');
  };
  for (let start = 0; start <= MAX_PREFIX_BYTES && start + 16 <= dat.length; start += 1) {
    if (ascii(start + 4) !== 'ftyp') continue;
    const size = view.getUint32(start);
    if (size < 16 || (size - 16) % 4 !== 0 || size > 128 || size > dat.length - start) continue;
    const brand = ascii(start + 8);
    const compatible = Array.from({ length: (size - 16) / 4 }, (_, index) => ascii(start + 16 + index * 4));
    if (![brand, ...compatible].some((value) => allowedBrand.test(value)) || !requireMovie(start)) continue;
    return { bytes: dat.subarray(start), mimeType: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' };
  }
  return null;
}

/** Resolve only declared, uniquely matched internal media entries of an already-preflighted archive. */
export function readFlaEmbeddedVideo(source: Uint8Array, entries: readonly FlaArchiveEntry[], videoName: string) {
  const documents = entries.filter((entry) => entry.name === 'DOMDocument.xml');
  if (documents.length !== 1) return null;
  const document = new TextDecoder('utf-8', { fatal: true })
    .decode(readSelectedFlaArchiveEntry(source, documents[0]!, FLA_IMPORT_LIMITS.maxXmlBytes));
  const media = getFlaXflDirectChildren(document, 'DOMDocument').filter(({ name }) => name === 'media');
  if (media.length !== 1) return null;
  const declared = getFlaXflDirectChildren(media[0]!.xml, 'media')
    .filter((item) => item.name === 'DOMVideoItem' && item.attributes.name === videoName);
  if (declared.length !== 1) return null;
  const href = declared[0]?.attributes.videoDataHRef;
  if (!href || !/^[^\\/:]+\.dat$/iu.test(href) || href.startsWith('.') ||
      Array.from(href).some((character) => character.charCodeAt(0) < 32)) return null;
  const matched = entries.filter(({ name }) => name === 'bin/' + href || name === 'LIBRARY/' + href);
  if (matched.length !== 1) return null;
  const entry = matched[0]!;
  const mediaData = extractFlaNativeIsoVideo(readSelectedFlaArchiveEntry(source, entry, FLA_IMPORT_LIMITS.maxSingleEntryBytes));
  return mediaData ? { ...mediaData, originalEntryName: entry.name } : null;
}

/** A validated display-order index. Duplicate PTS use the last decoded frame at that timestamp. */
export function createFlaVideoPresentationIndex(pts: readonly number[], endTick: number) {
  if (!pts.length || !Number.isSafeInteger(endTick) || endTick <= pts.at(-1)! ||
      pts.some((tick, i) => !Number.isSafeInteger(tick) || (i > 0 && tick < pts[i - 1]!))) return null;
  const timeline = [...pts];
  return (sourceTick: number): number | null => {
    if (!Number.isFinite(sourceTick) || sourceTick < timeline[0]! || sourceTick >= endTick) return null;
    let low = 0;
    let high = timeline.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (timeline[middle]! <= sourceTick) low = middle;
      else high = middle;
    }
    return low;
  };
}
