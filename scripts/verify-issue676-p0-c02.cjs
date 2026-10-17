const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { deflateSync, inflateSync } = require('node:zlib');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.resolve(__dirname, '..');
const { IPC_CHANNELS } = require(path.join(root, 'dist-electron/shared/ipc/channels.js'));
const { resolveFlaDisplayList } = require(
  path.join(root, 'dist-electron/main/services/fla-display-list-resolver.js'),
);
const { adaptFlaXflDisplaySource } = require(
  path.join(root, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'),
);
const { buildSvgForResolvedDisplayList } = require(
  path.join(root, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'),
);
const { createFlaStaticSnapshotBitmapMediaLookup } = require(
  path.join(root, 'dist-electron/main/services/fla-static-snapshot-media-resolver.js'),
);
const { FlaStaticSnapshotWindowManager } = require(
  path.join(root, 'dist-electron/main/services/fla-static-snapshot-window-manager.js'),
);

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBytes, data]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(crcInput), 8 + data.length);
  return chunk;
}

function rgbaPng(width, height, pixels) {
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    scanlines[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = pixels[y * width + x] || [0, 0, 0, 0];
      for (let channel = 0; channel < 4; channel += 1) {
        scanlines[rowOffset + 1 + x * 4 + channel] = pixel[channel] || 0;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paethPredictor(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function decodeRgbaPng(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE, 'renderer must return PNG bytes');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const imageData = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= bytes.length, `truncated ${type} PNG chunk`);
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  assert.equal(bitDepth, 8, 'fixture verifier supports the renderer’s 8-bit PNG output');
  assert.equal(colorType, 6, 'renderer PNG must preserve RGBA alpha');
  assert.equal(interlace, 0, 'renderer PNG must be non-interlaced');
  const bytesPerPixel = 4;
  const rowBytes = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(imageData));
  assert.equal(inflated.length, height * (rowBytes + 1));
  const pixels = Buffer.alloc(height * rowBytes);
  let previousRow = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (rowBytes + 1);
    const filter = inflated[scanlineOffset];
    const row = Buffer.from(inflated.subarray(scanlineOffset + 1, scanlineOffset + 1 + rowBytes));
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const up = previousRow[index];
      const upperLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;
      if (filter === 1) row[index] = (row[index] + left) & 0xff;
      else if (filter === 2) row[index] = (row[index] + up) & 0xff;
      else if (filter === 3) row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[index] = (row[index] + paethPredictor(left, up, upperLeft)) & 0xff;
      else assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
    }
    row.copy(pixels, y * rowBytes);
    previousRow = row;
  }
  return {
    width,
    height,
    pixel(x, y) {
      const start = (y * width + x) * bytesPerPixel;
      return [...pixels.subarray(start, start + bytesPerPixel)];
    },
  };
}

function assertPixel(image, x, y, expected, tolerance = 0) {
  const actual = image.pixel(x, y);
  for (let channel = 0; channel < 4; channel += 1) {
    assert.ok(
      Math.abs(actual[channel] - expected[channel]) <= tolerance,
      `pixel (${x},${y}) channel ${channel}: expected ${expected[channel]} ± ${tolerance}, got ${actual[channel]} (${actual.join(',')})`,
    );
  }
}

function mediaItem(id, name, sourceReference, width, height, bytes, alpha) {
  return {
    id,
    name,
    sourceReference,
    bitmapDataReference: null,
    sourceFormat: 'png',
    width,
    height,
    payload: {
      mimeType: 'image/png',
      width,
      height,
      bytes: new Uint8Array(bytes),
      alpha,
    },
  };
}

function sourceLayerNamesFromXfl(xml) {
  return [...xml.matchAll(/<DOMLayer\b[^>]*\bname="([^"]+)"[^>]*>/gu)].map((match) => match[1]);
}

function buildAcceptanceFixture() {
  const backgroundPixels = Array.from({ length: 16 }, () => [0, 0, 255, 255]);
  backgroundPixels[15] = [0, 0, 0, 0];
  const overlayPixels = [
    [255, 0, 0, 255], [0, 0, 0, 0],
    [255, 0, 0, 128], [0, 0, 0, 0],
  ];
  const backgroundPng = rgbaPng(4, 4, backgroundPixels);
  const overlayPng = rgbaPng(2, 2, overlayPixels);
  const mediaItems = [
    mediaItem(
      'fla-media-c02-background',
      'background.png',
      'LIBRARY/background.png',
      4,
      4,
      backgroundPng,
      { kind: 'transparent', zeroAlphaPixels: 1, partialAlphaPixels: 0 },
    ),
    mediaItem(
      'fla-media-c02-overlay',
      'overlay.png',
      'LIBRARY/overlay.png',
      2,
      2,
      overlayPng,
      { kind: 'mixed', zeroAlphaPixels: 2, partialAlphaPixels: 1 },
    ),
  ];
  // XFL timeline layers are authored front/top to back/bottom. Keep the
  // foreground on the first source layer so this raster gate exercises the
  // production adapter's single conversion to Panda painter order.
  const xflDocumentXml = `<DOMDocument width="4" height="4" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="Scene 1"><layers>
    <DOMLayer name="Layer 2"><frames><DOMFrame index="0"><elements>
      <DOMSymbolInstance libraryItemName="front-symbol"><matrix a="1" d="1" tx="1" ty="0"/></DOMSymbolInstance>
    </elements></DOMFrame></frames></DOMLayer>
    <DOMLayer name="Layer 1"><frames><DOMFrame index="0"><elements>
      <DOMBitmapInstance libraryItemName="LIBRARY/background.png"/>
      <DOMShape><matrix><Matrix a="1" d="1" tx="0" ty="3"/></matrix>
        <fills><FillStyle index="1"><SolidColor color="#00ff00" alpha="1"/></FillStyle></fills>
        <edges><Edge fillStyle1="1" cubics="!0 0|20 0|20 20|0 20|0 0"/></edges>
      </DOMShape>
    </elements></DOMFrame></frames></DOMLayer>
  </layers></DOMTimeline></timelines>
</DOMDocument>`;
  const xflLibraryXml = `<DOMSymbolItem name="front-symbol" symbolType="graphic">
  <timeline><DOMTimeline name="front-symbol-timeline"><layers>
    <DOMLayer name="front-symbol-layer"><frames><DOMFrame index="0"><elements>
      <DOMGroup><matrix><Matrix a="1" d="1" tx="1" ty="1"/></matrix><members>
        <DOMBitmapInstance libraryItemName="overlay.png"/>
      </members></DOMGroup>
    </elements></DOMFrame></frames></DOMLayer>
  </layers></DOMTimeline></timeline>
</DOMSymbolItem>`;
  assert.match(xflLibraryXml, /<DOMSymbolItem\b[^>]*\bsymbolType="graphic"/u);
  const sourceLayerOrder = sourceLayerNamesFromXfl(xflDocumentXml);
  assert.deepEqual(sourceLayerOrder, ['Layer 2', 'Layer 1']);
  const adapted = adaptFlaXflDisplaySource(xflDocumentXml, [{
    name: 'LIBRARY/front-symbol.xml',
    xml: xflLibraryXml,
  }]);
  assert.equal(adapted.ok, true, `production display-list adapter failed: ${adapted.message ?? ''}`);
  if (!adapted.ok) throw new Error(`Production display-list adapter failed: ${adapted.message}`);
  const frameContext = adapted.source.sceneTimelines[0]?.frameContext;
  assert.ok(frameContext, 'production adapter returned no selected Scene frame');
  assert.deepEqual(frameContext.layers.map((layer) => layer.name), ['Layer 1', 'Layer 2']);
  const resolved = resolveFlaDisplayList({
    root: {
      kind: 'scene',
      name: 'C02 generated overlap fixture',
      frameContext,
    },
    symbols: adapted.source.symbols,
  });
  if (!resolved.ok) throw new Error(`Generated C02 resolver fixture failed: ${resolved.code}`);
  assert.deepEqual(resolved.displayList.layers.map((layer) => layer.name), ['Layer 1', 'Layer 2']);

  const composed = buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    renderTargetId: 'c02-generated-overlap-fixture',
    stageWidth: 4,
    stageHeight: 4,
    shapeBlocks: adapted.source.shapeBlocks,
    resolveBitmapMedia: createFlaStaticSnapshotBitmapMediaLookup(mediaItems),
  });
  if (!composed.ok) throw new Error(`Generated C02 SVG composition failed: ${composed.message}`);
  const hrefs = [...composed.svg.matchAll(/\bhref="([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(hrefs.every((href) => href.startsWith('data:image/png;base64,') || href.startsWith('#')));
  assert.equal(composed.composition.bitmapInstanceCount, 2);
  assert.equal(composed.composition.shapeCount, 1);
  return { composed, resolved: resolved.displayList, sourceLayerOrder };
}

let manager;
const channelHandlers = [];
let finished = false;

function finish(error, receipt) {
  if (finished) return;
  finished = true;
  for (const [channel, listener] of channelHandlers) ipcMain.removeListener(channel, listener);
  manager?.close();
  if (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(receipt, null, 2));
  }
  app.exit(process.exitCode || 0);
}

const onReady = (event) => manager.markReady(event.sender.id);
const onResult = (event, payload) => manager.markResult(event.sender.id, payload);
const onError = (event, payload) => manager.markError(event.sender.id, payload);
for (const [channel, listener] of [
  [IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY, onReady],
  [IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, onResult],
  [IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, onError],
]) {
  ipcMain.on(channel, listener);
  channelHandlers.push([channel, listener]);
}

app.whenReady().then(async () => {
  try {
    const security = { sandbox: false, contextIsolation: false, nodeIntegration: true };
    manager = new FlaStaticSnapshotWindowManager(
      { readyTimeoutMs: 15_000, rasterizeWallTimeMs: 30_000 },
      {
        create(options) {
          security.sandbox = options.webPreferences?.sandbox === true;
          security.contextIsolation = options.webPreferences?.contextIsolation === true;
          security.nodeIntegration = options.webPreferences?.nodeIntegration === true;
          const window = new BrowserWindow(options);
          window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
          return window;
        },
      },
    );
    const { composed, resolved, sourceLayerOrder } = buildAcceptanceFixture();
    const requestId = crypto.randomUUID();
    const raster = await manager.rasterize({
      requestId,
      svg: composed.svg,
      width: composed.width,
      height: composed.height,
      pixelCount: composed.pixelCount,
    });
    assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    assert.equal(raster.width, 4);
    assert.equal(raster.height, 4);
    assert.equal(raster.pixelCount, 16);

    const image = decodeRgbaPng(Buffer.from(raster.pngBytes));
    assert.equal(image.width, 4);
    assert.equal(image.height, 4);
    assertPixel(image, 0, 0, [0, 0, 255, 255]);
    assertPixel(image, 2, 1, [255, 0, 0, 255]);
    assertPixel(image, 3, 1, [0, 0, 255, 255]);
    assertPixel(image, 2, 2, [128, 0, 127, 255], 4);
    assertPixel(image, 0, 3, [0, 255, 0, 255], 1);
    assert.equal(image.pixel(3, 3)[3], 0, 'transparent Panda PNG alpha must remain transparent in the snapshot');

    const receipt = {
      verifier: 'P0-C02 generated overlap raster acceptance',
      root: resolved.kind,
      sourceXflLayerOrder: sourceLayerOrder,
      sourceLayerOrder: resolved.layers.map((layer) => layer.name),
      composition: composed.composition,
      png: {
        width: raster.width,
        height: raster.height,
        byteLength: raster.pngBytes.byteLength,
        sha256: crypto.createHash('sha256').update(Buffer.from(raster.pngBytes)).digest('hex'),
        samples: {
          background: image.pixel(0, 0),
          foregroundAboveBackground: image.pixel(2, 1),
          transparentForegroundShowsBackground: image.pixel(3, 1),
          halfAlphaForegroundBlend: image.pixel(2, 2),
          vectorShapeBesideBitmaps: image.pixel(0, 3),
          transparentSourcePixel: image.pixel(3, 3),
        },
      },
      sandbox: security,
      svgSha256: crypto.createHash('sha256').update(composed.svg, 'utf8').digest('hex'),
      rasterInput: 'Main-built composed SVG only',
      externalResourcesInSvg: 0,
    };
    finish(null, receipt);
  } catch (error) {
    finish(error);
  }
});

app.on('window-all-closed', () => {
  if (!finished) finish(new Error('Snapshot verifier window closed before completion'));
});
