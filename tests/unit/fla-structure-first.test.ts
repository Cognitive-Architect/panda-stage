// @vitest-environment happy-dom
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnimationImportIRSchema,
  FlaStructureIRSchema,
} from '../../src/shared/fla-import-api';
import { adaptFlaDocument } from '../../src/renderer/fla-import/fla-viewer-adapter';
import { FLAParser } from '../../src/renderer/fla-import/parser-core/fla-parser';

async function archive() {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', [
    '<DOMDocument width="320" height="240" frameRate="24">',
    '<media>',
    '<DOMBitmapItem name="left/icon.png" href="left/icon.png" frameRight="160" frameBottom="200"/>',
    '<DOMBitmapItem name="right/icon.png" href="right/icon.png"/>',
    '<DOMSoundItem name="audio/track" href="library/track.wav" format="44kHz 16bit Stereo"/>',
    '<DOMVideoItem name="video/clip" videoDataHRef="clip.dat" width="128" height="96" fps="12"/>',
    '</media>',
    '<symbols><Include href="Part.xml"/></symbols>',
    '<timelines><DOMTimeline name="Scene"><layers><DOMLayer name="Layer"><frames><DOMFrame index="0">',
    '<elements><DOMBitmapInstance libraryItemName="left/icon.png"/>',
    '<DOMBitmapInstance libraryItemName="right/icon.png"/></elements>',
    '</DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines>',
    '</DOMDocument>',
  ].join(''));
  zip.file('LIBRARY/Part.xml', '<DOMSymbolItem name="Part" symbolType="graphic"><timeline><DOMTimeline name="Part"><layers><DOMLayer name="Layer"><frames><DOMFrame index="0"><elements/></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>');
  return zip.generateAsync({ type: 'arraybuffer' });
}

type MediaLoaders = {
  loadBitmapImage: () => Promise<void>;
  loadSoundAudio: () => Promise<void>;
  loadVideoFLV: () => Promise<void>;
};

function spyOnMediaLoading() {
  const methods = FLAParser.prototype as unknown as MediaLoaders;
  return {
    bitmap: vi.spyOn(methods, 'loadBitmapImage').mockResolvedValue(),
    sound: vi.spyOn(methods, 'loadSoundAudio').mockResolvedValue(),
    video: vi.spyOn(methods, 'loadVideoFLV').mockResolvedValue(),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('FLA structure-first parsing and adaptation', () => {
  it('preserves media metadata and structure while skipping all three media loaders', async () => {
    const media = spyOnMediaLoading();
    const file = new File([await archive()], 'media.fla');
    const structure = await new FLAParser().parse(file, undefined, undefined, { structureOnly: true });
    expect(media.bitmap).not.toHaveBeenCalled();
    expect(media.sound).not.toHaveBeenCalled();
    expect(media.video).not.toHaveBeenCalled();
    expect(structure.bitmaps.get('left/icon.png')).toMatchObject({
      href: 'left/icon.png', width: 8, height: 10,
    });
    expect(structure.sounds.get('audio/track')).toMatchObject({
      href: 'library/track.wav', format: '44kHz 16bit Stereo', sampleRate: 44000, channels: 2,
    });
    expect(structure.videos.get('video/clip')).toMatchObject({
      href: 'clip.dat', width: 128, height: 96, fps: 12,
    });
    expect(structure.symbols.has('Part')).toBe(true);
    expect(structure.timelines.map(({ name }) => name)).toEqual(['Scene']);

    const full = await new FLAParser().parse(file);
    expect(media.bitmap).toHaveBeenCalledTimes(2);
    expect(media.sound).toHaveBeenCalledOnce();
    expect(media.video).toHaveBeenCalledOnce();
    expect(full).toEqual(structure);
  });

  it('keeps sound loads out of the visual raster compatibility fallback', async () => {
    const loaders = spyOnMediaLoading();
    const bytes = new Uint8Array(await archive());
    const ir = await adaptFlaDocument({
      basename: 'media.fla', byteLength: bytes.length, sha256: 'a'.repeat(64),
      bytes, containsActionScript: false,
    }, () => undefined, () => false, 'raster-compatibility');
    expect(loaders.sound).not.toHaveBeenCalled();
    expect(ir.sounds).toHaveLength(1);
  });

  it('emits distinct stable raster candidates and placement references without a Canvas or PNG payload', async () => {
    const bytes = new Uint8Array(await archive());
    const source = {
      basename: 'media.fla', byteLength: bytes.length, sha256: 'a'.repeat(64),
      bytes, containsActionScript: false,
    };
    const progress = vi.fn();
    const canvas = vi.spyOn(document, 'createElement');
    const catalog = await adaptFlaDocument(source, progress, () => false, 'structure');
    expect(progress.mock.calls.flat().some((message: string) => message.startsWith('Encoding bitmap '))).toBe(false);
    expect(canvas.mock.calls.some(([tag]) => String(tag) === 'canvas')).toBe(false);
    expect(FlaStructureIRSchema.safeParse(catalog).success).toBe(true);
    expect(AnimationImportIRSchema.safeParse(catalog).success).toBe(false);
    expect(catalog.media.map(({ sourceReference }) => sourceReference)).toEqual(['left/icon.png', 'right/icon.png']);
    expect(catalog.media[1]).toMatchObject({ width: 0, height: 0 });
    expect(catalog.media.every((item) => !('payload' in item))).toBe(true);
    expect(catalog.sounds).toEqual([expect.objectContaining({
      id: expect.stringContaining('fla-sound'), name: 'audio/track', href: 'library/track.wav', format: '44kHz 16bit Stereo',
    })]);
    const ids = catalog.media.map(({ id }) => id);
    expect(new Set(ids).size).toBe(2);
    expect(catalog.timelines[0]?.layers[0]?.frames[0]?.instances.map(({ mediaId }) => mediaId)).toEqual(ids);
    expect((await adaptFlaDocument(source, () => undefined, () => false, 'structure')).media.map(({ id }) => id)).toEqual(ids);
  });
});
