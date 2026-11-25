/** Shared header checks for ordinary audio inspection and embedded FLA streams. */
export function readId3AudioOffset(initial: Buffer): number {
  if (initial.toString('ascii', 0, 3) !== 'ID3') return 0;
  if (initial.length < 10) throw new Error('Truncated ID3 header.');
  const size = initial.subarray(6, 10);
  if (size.some((value) => value > 0x7f)) throw new Error('Invalid ID3 synchsafe size.');
  return 10 + (size[0]! << 21) + (size[1]! << 14) + (size[2]! << 7) + size[3]!;
}

export function readMpegAudioHeader(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length) return undefined;
  const second = bytes[offset + 1]!;
  const third = bytes[offset + 2]!;
  const version = (second >> 3) & 3;
  const layer = (second >> 1) & 3;
  const bitrateIndex = third >> 4;
  const rateIndex = (third >> 2) & 3;
  if (bytes[offset] !== 255 || (second & 224) !== 224 || version === 1 || layer === 0 ||
      bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return undefined;
  return { version, layer, bitrateIndex, rateIndex, padding: (third >> 1) & 1 };
}

const mpeg1Layer3Rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const mpeg2Layer3Rates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

function readLayer3Frame(bytes: Uint8Array, offset: number) {
  const header = readMpegAudioHeader(bytes, offset);
  if (!header || header.layer !== 1) return undefined;
  const mpeg1 = header.version === 3;
  const sampleRate = [44100, 48000, 32000][header.rateIndex]! / (mpeg1 ? 1 : header.version === 2 ? 2 : 4);
  const bitrate = (mpeg1 ? mpeg1Layer3Rates : mpeg2Layer3Rates)[header.bitrateIndex]!;
  const length = Math.floor((mpeg1 ? 144000 : 72000) * bitrate / sampleRate) + header.padding;
  return { sampleRate, end: offset + length };
}

/** Confirm an exact Layer III boundary before selecting the MP3 decode path. */
export function inspectEmbeddedMp3(bytes: Uint8Array): 'none' | 'valid' | 'truncated' {
  const prefix = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 10));
  let offset: number;
  try {
    offset = readId3AudioOffset(prefix);
  } catch {
    return 'none';
  }
  if (offset > 0) {
    const version = prefix[3]!;
    if (version < 2 || version > 4) return 'none';
    if (version === 4 && (prefix[5]! & 0x10)) {
      if (Buffer.from(bytes.subarray(offset, offset + 3)).toString('ascii') !== '3DI') return 'none';
      offset += 10;
    }
  }
  const first = readLayer3Frame(bytes, offset);
  if (!first || first.end > bytes.length) return 'none';
  const streamEnd = bytes.length >= 128 &&
    Buffer.from(bytes.subarray(bytes.length - 128, bytes.length - 125)).toString('ascii') === 'TAG'
    ? bytes.length - 128 : bytes.length;
  if (first.end === streamEnd) return 'valid';
  const second = readLayer3Frame(bytes, first.end);
  if (!second || second.sampleRate !== first.sampleRate) return 'none';
  let end = second.end;
  for (let count = 2; end < streamEnd && count < 10_000; count += 1) {
    const frame = readLayer3Frame(bytes, end);
    if (!frame || frame.sampleRate !== first.sampleRate) return 'truncated';
    end = frame.end;
  }
  return end === streamEnd ? 'valid' : 'truncated';
}
