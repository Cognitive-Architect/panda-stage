'use strict';

function createPixelAlignedPngStackSvg(framing, partPngs) {
  const width = framing && framing.outputWidth;
  const height = framing && framing.outputHeight;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error('Pixel-aligned reassembly requires positive integer output dimensions.');
  }
  if (!Array.isArray(partPngs) || partPngs.length === 0) {
    throw new Error('Pixel-aligned reassembly requires at least one part image.');
  }

  const imageTags = partPngs.map((part) =>
    '<image x="0" y="0" width="' + width + '" height="' + height +
      '" preserveAspectRatio="none" href="data:image/png;base64,' + Buffer.from(part.pngBytes).toString('base64') + '"/>',
  ).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height +
    '" width="' + width + '" height="' + height + '">' + imageTags + '</svg>';
}

module.exports = { createPixelAlignedPngStackSvg };
