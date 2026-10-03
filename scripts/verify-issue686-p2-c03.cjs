const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { inflateSync } = require('node:zlib');
const { app, BrowserWindow, ipcMain } = require('electron');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const { IPC_CHANNELS } = require(path.join(root, 'dist-electron/shared/ipc/channels.js'));
const {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
} = require(path.join(root, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'));
const { FlaStaticSnapshotWindowManager } = require(
  path.join(root, 'dist-electron/main/services/fla-static-snapshot-window-manager.js'),
);

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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
  assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE, 'sandbox renderer must return PNG bytes');
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
  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6, 'sandbox PNG must preserve RGBA alpha');
  assert.equal(interlace, 0);
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
    pixels,
    pixel(x, y) {
      const start = (y * width + x) * bytesPerPixel;
      return [...pixels.subarray(start, start + bytesPerPixel)];
    },
    alphaBounds() {
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (this.pixel(x, y)[3] === 0) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      return { minX, minY, maxX, maxY };
    },
  };
}

function assertPixel(image, x, y, expected, tolerance = 1) {
  const actual = image.pixel(x, y);
  for (let channel = 0; channel < 4; channel += 1) {
    assert.ok(
      Math.abs(actual[channel] - expected[channel]) <= tolerance,
      `PNG pixel (${x},${y}) channel ${channel}: expected ${expected[channel]} ± ${tolerance}, got ${actual[channel]} (${actual.join(',')})`,
    );
  }
}

function strokeShape({ weight, color, alpha = '1', caps, joints = 'round', miterLimit = 3, cubics, matrix = '' }) {
  return `<DOMShape>${matrix}
    <strokes><StrokeStyle index="1"><SolidStroke weight="${weight}" caps="${caps}" joints="${joints}" miterLimit="${miterLimit}"><fill><SolidColor color="${color}" alpha="${alpha}"/></fill></SolidStroke></StrokeStyle></strokes>
    <edges><Edge strokeStyle="1" cubics="${cubics}"/></edges>
  </DOMShape>`;
}

async function makeSceneFla(elements, width, height) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="${width}" height="${height}" frameRate="24">
  <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1">
    <frames><DOMFrame index="0"><elements>${elements}</elements></DOMFrame></frames>
  </DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function makeGraphicFla(shapeXml) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="24" height="24" frameRate="24">
  <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1">
    <frames><DOMFrame index="0"><elements/></DOMFrame></frames>
  </DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`);
  zip.file('LIBRARY/stroke-sample.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem name="stroke-sample" symbolType="graphic">
  <timeline><DOMTimeline name="stroke-sample"><layers><DOMLayer name="Layer 1">
    <frames><DOMFrame index="0"><elements>${shapeXml}</elements></DOMFrame></frames>
  </DOMLayer></layers></DOMTimeline></timeline>
</DOMSymbolItem>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function buildTarget(sourceBytes, kind) {
  const catalog = await buildRenderableTargetCatalog(sourceBytes);
  if (!catalog.ok) throw new Error(`C03 target catalog failed: ${catalog.message}`);
  const entry = catalog.entries.find((candidate) => candidate.target.kind === kind);
  assert.ok(entry, `synthetic ${kind} target must be in the production catalog`);
  assert.equal(entry.previewSupported, true, `synthetic ${kind} target must be previewable`);
  const composed = await buildSvgForRenderTarget(sourceBytes, entry.target);
  if (!composed.ok) throw new Error(`C03 SVG composition failed: ${composed.message}`);
  assert.deepEqual([...composed.svg.matchAll(/\bhref="([^"]+)"/gu)], []);
  return { target: entry.target, composed };
}

let manager;
let finished = false;
const channelHandlers = [];

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
    const rasterize = async (composed) => {
      const raster = await manager.rasterize({
        requestId: crypto.randomUUID(),
        svg: composed.svg,
        width: composed.width,
        height: composed.height,
        pixelCount: composed.pixelCount,
      });
      return { raster, image: decodeRgbaPng(Buffer.from(raster.pngBytes)) };
    };

    const capSource = await makeSceneFla([
      strokeShape({ weight: 4, color: '#ff0000', caps: 'none', cubics: '!100 80|200 80' }),
      strokeShape({ weight: 4, color: '#00cc44', alpha: '0.5', caps: 'round', cubics: '!100 240|200 240' }),
      strokeShape({ weight: 4, color: '#0000ff', caps: 'square', cubics: '!240 400|340 400' }),
    ].join(''), 22, 26);
    const capTarget = await buildTarget(capSource, 'scene');
    const caps = await rasterize(capTarget.composed);
    assert.equal(caps.raster.width, 22);
    assert.equal(caps.raster.height, 26);
    assertPixel(caps.image, 3, 4, [0, 0, 0, 0]);
    assertPixel(caps.image, 4, 12, [0, 204, 68, 128]);
    assertPixel(caps.image, 11, 20, [0, 0, 255, 255]);
    assert.ok(caps.image.alphaBounds().maxX >= 18, 'stroke-only shapes must render visible pixels');

    const joinImages = {};
    const joinHashes = {};
    for (const join of ['miter', 'bevel', 'round']) {
      const source = await makeSceneFla(
        strokeShape({
          weight: 8,
          color: '#202020',
          caps: 'butt',
          joints: join,
          miterLimit: 6,
          cubics: '!80 280|200 480|220 280',
        }),
        24,
        32,
      );
      const target = await buildTarget(source, 'scene');
      assert.match(target.composed.svg, new RegExp(`stroke-linejoin="${join}"`, 'u'));
      const rendered = await rasterize(target.composed);
      joinImages[join] = rendered.image;
      joinHashes[join] = crypto.createHash('sha256').update(rendered.image.pixels).digest('hex');
    }
    assert.notEqual(joinHashes.miter, joinHashes.bevel, 'miter and bevel joins must rasterize differently');
    assert.notEqual(joinHashes.miter, joinHashes.round, 'miter and round joins must rasterize differently');
    assert.notEqual(joinHashes.bevel, joinHashes.round, 'bevel and round joins must rasterize differently');

    const transformedSource = await makeGraphicFla(`<DOMShape>
      <matrix><Matrix a="2" b="0.5" c="0" d="1.5" tx="3" ty="4"/></matrix>
      ${strokeShape({ weight: 4, color: '#7a2030', caps: 'round', joints: 'bevel', cubics: '!0 0|120 0' }).replace(/^<DOMShape>|<\/DOMShape>$/gu, '')}
    </DOMShape>`);
    const transformedTarget = await buildTarget(transformedSource, 'graphic-symbol');
    const { composed: transformedSvg } = transformedTarget;
    const contentBounds = transformedSvg.composition.framing.contentBounds;
    assert.ok(contentBounds, 'stroked Graphic needs content bounds');
    assert.ok(contentBounds.x <= -1, 'transformed stroke extends content bounds beyond its centerline');
    assert.ok(contentBounds.y < 1, 'transformed stroke expands the top/bottom bounds');
    assert.ok(contentBounds.width >= 20);
    assert.ok(contentBounds.height > 9);
    assert.equal(transformedSvg.composition.framing.padding, 4);
    const transformed = await rasterize(transformedSvg);
    const alphaBounds = transformed.image.alphaBounds();
    assert.ok(alphaBounds.maxX >= alphaBounds.minX && alphaBounds.maxY >= alphaBounds.minY, 'transformed stroke must paint pixels');
    assert.ok(alphaBounds.minX >= 2 && alphaBounds.minY >= 2, 'stroke must retain transparent padding inside its viewBox');
    assert.ok(alphaBounds.maxX <= transformed.image.width - 3 && alphaBounds.maxY <= transformed.image.height - 3,
      'stroke bounds must not clip at the raster edges');

    assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    finish(null, {
      verifier: 'Issue #686 P2-C03 solid stroke and stroke-aware bounds acceptance',
      sandbox: security,
      capPng: {
        width: caps.image.width,
        height: caps.image.height,
        sha256: crypto.createHash('sha256').update(caps.image.pixels).digest('hex'),
        buttCapOutsidePixel: caps.image.pixel(3, 4),
        roundCapInteriorHalfAlphaPixel: caps.image.pixel(4, 12),
        squareCapInteriorPixel: caps.image.pixel(11, 20),
        alphaBounds: caps.image.alphaBounds(),
      },
      joinPngSha256: joinHashes,
      transformedGraphic: {
        targetId: transformedTarget.target.renderTargetId,
        contentBounds,
        viewBox: transformedSvg.composition.framing.viewBox,
        output: { width: transformed.image.width, height: transformed.image.height },
        alphaBounds,
        pngSha256: crypto.createHash('sha256').update(transformed.image.pixels).digest('hex'),
      },
      rasterInput: 'Main-built composed SVG only',
      externalResourcesInSvg: 0,
    });
  } catch (error) {
    finish(error);
  }
});

app.on('window-all-closed', () => {
  if (!finished) finish(new Error('C03 snapshot verifier window closed before completion'));
});
