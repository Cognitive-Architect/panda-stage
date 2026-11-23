import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';

const clip = '<DOMSymbolInstance libraryItemName="Child" name="moving"/>';
const square = (color: string) => '<DOMShape><fills><FillStyle index="1">' +
  '<SolidColor color="' + color + '"/></FillStyle></fills>' +
  '<edges><Edge fillStyle1="1" edges="!0 0|200 0|200 200|0 200|0 0"/></edges></DOMShape>';
const frame = (index: number, elements: string, duration = 1) =>
  '<DOMFrame index="' + index + '" duration="' + duration + '"><elements>' + elements + '</elements></DOMFrame>';
const timeline = (frames: string) =>
  '<DOMTimeline name="Test"><layers><DOMLayer><frames>' + frames + '</frames></DOMLayer></layers></DOMTimeline>';

async function fixture(frames: string, scripted = false) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<DOMDocument width="160" height="120"><timelines>' +
    timeline(frames) + '</timelines></DOMDocument>');
  zip.file('LIBRARY/Child.xml', '<DOMSymbolItem name="Child"><timeline>' +
    timeline(frame(0, square('#ff0000')) + frame(1, square('#0000ff')) +
      frame(2, square('#00ff00'))) + '</timeline>' +
    (scripted ? '<Actionscript><script><![CDATA[stop();]]></script></Actionscript>' : '') + '</DOMSymbolItem>');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
  if (!prepared.ok) throw new Error(prepared.message);
  const catalog = await buildRenderableTargetCatalog(bytes, undefined, {}, prepared.source);
  if (!catalog.ok) throw new Error(catalog.message);
  const scene = catalog.entries.find((entry) => entry.target.kind === 'scene');
  if (!scene || !scene.previewSupported) throw new Error(scene?.unsupportedReason ?? 'Missing scene');
  return {
    authoredFrameCount: prepared.source.sceneTimelines[0]?.frameCount,
    playbackFrameCount: scene.target.frameCount,
    async render(selectedFrameIndex: number) {
      const result = await buildSvgForRenderTarget(bytes, { ...scene.target, selectedFrameIndex }, undefined, prepared.source);
      if (!result.ok) throw new Error(result.message);
      return result.svg;
    },
  };
}

describe('FLA MovieClip playback sampling', () => {
  it('keeps the authored scene on frame zero while the child advances on seek', async () => {
    const movie = await fixture(frame(0, clip));
    expect(movie.authoredFrameCount).toBe(1);
    expect(movie.playbackFrameCount).toBe(3);
    expect(await movie.render(2)).toContain('fill="#00ff00"');
    expect(await movie.render(0)).toContain('fill="#ff0000"');
    expect(await movie.render(1)).toContain('fill="#0000ff"');
    expect(await movie.render(2)).toContain('fill="#00ff00"');
  });

  it('preserves the instance clock across held frames and keyframes, then restarts after a gap', async () => {
    const movie = await fixture(frame(0, clip, 2) + frame(2, clip) + frame(3, '') + frame(4, clip, 2));
    expect(movie.playbackFrameCount).toBe(6);
    expect(await movie.render(5)).toContain('fill="#0000ff"');
    expect(await movie.render(2)).toContain('fill="#00ff00"');
    expect(await movie.render(4)).toContain('fill="#ff0000"');
    expect(await movie.render(1)).toContain('fill="#0000ff"');
  });

  it('holds a scripted MovieClip locally without preventing the scene from advancing', async () => {
    const movie = await fixture(frame(0, clip, 2) + frame(2, square('#ffaa00')), true);
    expect(await movie.render(1)).toContain('fill="#ff0000"');
    expect(await movie.render(2)).toContain('fill="#ffaa00"');
  });
});
