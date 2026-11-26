import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createFlaVideoPresentationIndex, extractFlaNativeIsoVideo, readFlaEmbeddedVideo } from '../../src/main/services/fla-native-video';
import { preflightFlaBytes } from '../../src/main/services/fla-import-preflight-service';

const box = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length + 8);
  return Buffer.concat([length, Buffer.from(type), data]);
};
const media = Buffer.concat([
  box('ftyp', Buffer.from('isom\x00\x00\x00\x00mp42')),
  box('mdat', Buffer.from([1, 2, 3])),
  box('moov', Buffer.from([4, 5, 6])),
]);
const wrapped = Buffer.concat([Buffer.from([3, 8, 0, 0, 0, 0, 0, 0, 0, 0]), media]);

describe('FLA native ISO video payload and presentation index', () => {
  it('accepts bounded, complete ISO boxes and rejects a magic-string-only or truncated payload', () => {
    expect(Buffer.from(extractFlaNativeIsoVideo(wrapped)!.bytes)).toEqual(media);
    expect(extractFlaNativeIsoVideo(wrapped.subarray(0, -1))).toBeNull();
    expect(extractFlaNativeIsoVideo(Buffer.from('0000ftyp0000'))).toBeNull();
    expect(extractFlaNativeIsoVideo(Buffer.concat([Buffer.alloc(65), media]))).toBeNull();
  });

  it('resolves only the declared DAT inside the bounded archive', async () => {
    const zip = new JSZip();
    zip.file('DOMDocument.xml', '<DOMDocument><media><DOMVideoItem name="Clip" videoDataHRef="clip.dat"/><DOMVideoItem name="External" videoDataHRef="../clip.dat"/></media></DOMDocument>');
    zip.file('bin/clip.dat', wrapped);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const archive = preflightFlaBytes(bytes, 'movie.fla');
    expect(readFlaEmbeddedVideo(bytes, archive.entries, 'Clip')).toMatchObject({ mimeType: 'video/mp4', originalEntryName: 'bin/clip.dat' });
    expect(readFlaEmbeddedVideo(bytes, archive.entries, 'External')).toBeNull();
  });

  it('selects half-open VFR intervals with negative timestamps and repeatable reverse seeks', () => {
    const frameAt = createFlaVideoPresentationIndex([-30, 0, 17, 17, 58], 99)!;
    expect([98, 17, -30, 16, 99, -31, 57].map(frameAt)).toEqual([4, 3, 0, 1, null, null, 3]);
    expect(createFlaVideoPresentationIndex([0, -1], 10)).toBeNull();
  });
});
