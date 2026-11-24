import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractFlaSound, FlaSoundService } from '../../src/main/services/FlaSoundService';
import { preflightFlaBytes } from '../../src/main/services/fla-import-preflight-service';

type Entry = Parameters<typeof extractFlaSound>[0];

async function source(sound: Partial<Entry['sound']>, artifact: string, payload: Uint8Array): Promise<Entry> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<DOMDocument/>');
  zip.file(artifact, payload);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return {
    bytes,
    entries: preflightFlaBytes(bytes, 'synthetic.fla').entries,
    sound: { id: 'voice', name: 'Voice', href: 'Voice.wav', dataHref: 'voice.dat', ...sound },
  };
}

describe('selected FLA sound extraction', () => {
  it.each([false, true])('preserves complete MP3 frames and excludes appended cache (ID3 %s)', async (id3) => {
    // MPEG-1 Layer III, 128 kb/s at 44.1 kHz gives 417-byte unpadded frames.
    const frame = new Uint8Array(417);
    frame.set([255, 251, 144, 100]);
    const tag = id3 ? [73, 68, 51, 4, 0, 0, 0, 0, 0, 0] : [];
    const mp3 = Uint8Array.from([...tag, ...frame, ...frame]);
    const fixture = await source({
      format: '44kHz 16bit Stereo', dataLength: mp3.length,
    }, 'bin/voice.dat', Uint8Array.from([...mp3, 12, 24, 42]));
    expect(extractFlaSound(fixture)).toEqual({ mimeType: 'audio/mpeg', bytes: mp3 });
    expect(() => extractFlaSound({ ...fixture, sound: { ...fixture.sound, dataLength: mp3.length + 5 } })).toThrow('invalid data length');
    expect(() => extractFlaSound({ ...fixture, sound: { ...fixture.sound, dataLength: undefined } })).toThrow('cache boundary');
  });

  it.each([0, -1])('treats a PCM first sample of %i as PCM with and without a cache boundary', async (first) => {
    const pcm = Buffer.alloc(8820, 0);
    pcm.writeInt16LE(first);
    pcm.writeInt16LE(12345, 2);
    for (const dataLength of [undefined, pcm.length]) {
      const fixture = await source({ format: '44kHz 16bit Mono', sampleCount: 4410, dataLength }, 'bin/voice.dat', pcm);
      const result = extractFlaSound(fixture);
      expect(result.mimeType).toBe('audio/wav');
      const wav = Buffer.from(result.bytes);
      expect(wav.readUInt32LE(24)).toBe(44100);
      expect(wav.readUInt16LE(22)).toBe(1);
      expect(wav.readUInt32LE(40)).toBe(8820);
      expect(wav.subarray(44)).toEqual(pcm);
    }
  });

  it('preserves 16-bit little-endian PCM and writes the standard sample rate and channel count', async () => {
    const data = Uint8Array.from([2, 1, 255, 128, 0, 64, 0, 0]);
    const fixture = await source({ format: '44kHz 16bit Stereo', sampleCount: 4 }, 'bin/voice.dat', data);
    const result = extractFlaSound(fixture);
    const wav = Buffer.from(result.bytes);
    expect(result.mimeType).toBe('audio/wav');
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(44100);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(8);
    expect(Array.from(wav.subarray(44))).toEqual(Array.from(data));
  });

  it('decodes the existing 4-bit SWF ADPCM format and rejects truncated payloads', async () => {
    // Code type 2, predictor 4096, step index 0, amplitude codes 0, 7, 15, 1.
    const bits = '10' + '0001000000000000' + '000000' + '0000011111110001';
    const data = Uint8Array.from(bits.match(/.{8}/gu)!.map((byte) => parseInt(byte, 2)));
    const metadata = { format: '22kHz 16bit Mono ADPCM', sampleCount: 5 };
    const result = extractFlaSound(await source(metadata, 'bin/voice.dat', data));
    const wav = Buffer.from(result.bytes);
    expect(wav.readUInt32LE(24)).toBe(22050);
    expect(Array.from({ length: 5 }, (_, i) => wav.readInt16LE(44 + i * 2)))
      .toEqual([4096, 4096, 4107, 4077, 4089]);
    const malformed = await source(metadata, 'bin/voice.dat', data.subarray(0, -1));
    expect(() => extractFlaSound(malformed)).toThrow(/ADPCM size/u);
  });

  it('rejects out-of-library references and unavailable or over-budget sound entries locally', async () => {
    const fixture = await source({}, 'bin/voice.dat', Uint8Array.from([0, 0]));
    expect(() => extractFlaSound({ ...fixture, sound: { ...fixture.sound, dataHref: '../voice.dat' } })).toThrow('library path');
    expect(() => extractFlaSound({ ...fixture, sound: { ...fixture.sound, dataHref: 'missing.dat' } })).toThrow('missing');
    const entries = fixture.entries.map((entry) => entry.name === 'bin/voice.dat'
      ? { ...entry, uncompressedSize: 17 * 1024 * 1024 } : entry);
    expect(() => extractFlaSound({ ...fixture, entries })).toThrow('byte limit');
  });

  it('cancels the active sound probe for a request without cancelling the session', async () => {
    const fixture = await source({ format: '44kHz 16bit Mono', sampleCount: 2 }, 'bin/voice.dat', Uint8Array.from([0, 1, 0, 2]));
    let probeStarted!: () => void;
    const started = new Promise<void>((resolve) => { probeStarted = resolve; });
    const service = new FlaSoundService(
      (_session, soundId) => soundId === 'voice' ? fixture : null,
      async (_path, signal) => {
        probeStarted();
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      },
      { importCandidates: async () => { throw new Error('not used during preview'); } },
    );
    const pending = service.preview({ sessionId: 'session', requestId: 'request', soundId: 'voice' });
    await started;
    expect(service.cancelPreview('session', 'previous')).toBe(false);
    expect(service.cancelPreview('session', 'request')).toBe(true);
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'USER_CANCELLED' } });
    await expect(service.preview({ sessionId: 'session', requestId: 'next', soundId: 'missing' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'MEDIA_DECODE_FAILED' } });
  });
});
