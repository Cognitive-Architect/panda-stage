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
  assert.equal(bitDepth, 8, 'sandbox PNG must use 8-bit channels');
  assert.equal(colorType, 6, 'sandbox PNG must preserve RGBA alpha');
  assert.equal(interlace, 0, 'sandbox PNG must be non-interlaced');
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

function assertPixel(image, x, y, expected, tolerance = 1) {
  const actual = image.pixel(x, y);
  for (let channel = 0; channel < 4; channel += 1) {
    assert.ok(
      Math.abs(actual[channel] - expected[channel]) <= tolerance,
      `PNG pixel (${x},${y}) channel ${channel}: expected ${expected[channel]} ± ${tolerance}, got ${actual[channel]} (${actual.join(',')})`,
    );
  }
}

async function buildTwoRegionSvg() {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument width="4" height="2" frameRate="24">
  <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1">
    <frames><DOMFrame index="0"><elements><DOMShape>
      <fills>
        <FillStyle index="2"><SolidColor color="#0000ff" alpha="0.5"/></FillStyle>
        <FillStyle index="1"><SolidColor color="#ff0000" alpha="1"/></FillStyle>
      </fills>
      <edges>
        <Edge fillStyle1="1" cubics="!0 0|40 0"/>
        <Edge fillStyle0="1" fillStyle1="2" cubics="!40 40|40 0"/>
        <Edge fillStyle1="1" cubics="!40 40|0 40"/>
        <Edge fillStyle1="1" cubics="!0 40|0 0"/>
        <Edge fillStyle1="2" cubics="!40 0|80 0"/>
        <Edge fillStyle1="2" cubics="!80 0|80 40"/>
        <Edge fillStyle1="2" cubics="!80 40|40 40"/>
      </edges>
    </DOMShape></elements></DOMFrame></frames>
  </DOMLayer></layers></DOMTimeline></timelines>
</DOMDocument>`);
  const sourceBytes = await zip.generateAsync({ type: 'uint8array' });
  const catalog = await buildRenderableTargetCatalog(sourceBytes);
  if (!catalog.ok) throw new Error(`Synthetic C02 catalog failed: ${catalog.message}`);
  const scene = catalog.entries.find((entry) => entry.target.kind === 'scene');
  assert.ok(scene, 'generated multi-fill scene must be in the production render target catalog');
  const composed = await buildSvgForRenderTarget(sourceBytes, scene.target);
  if (!composed.ok) throw new Error(`Synthetic C02 SVG composition failed: ${composed.message}`);
  assert.equal(composed.width, 4);
  assert.equal(composed.height, 2);
  assert.equal(composed.composition.fillRegionCount, 2);
  assert.equal(composed.composition.fillContourCount, 2);
  assert.equal([...composed.svg.matchAll(/<path\b/gu)].length, 2);
  assert.deepEqual([...composed.svg.matchAll(/\bhref="([^"]+)"/gu)], []);
  return { scene: scene.target, composed };
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
    const { scene, composed } = await buildTwoRegionSvg();
    const raster = await manager.rasterize({
      requestId: crypto.randomUUID(),
      svg: composed.svg,
      width: composed.width,
      height: composed.height,
      pixelCount: composed.pixelCount,
    });
    assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    assert.equal(raster.width, 4);
    assert.equal(raster.height, 2);
    assert.equal(raster.pixelCount, 8);

    const image = decodeRgbaPng(Buffer.from(raster.pngBytes));
    assert.equal(image.width, 4);
    assert.equal(image.height, 2);
    const samples = { red: [], blue: [] };
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (x < 2) {
          assertPixel(image, x, y, [255, 0, 0, 255]);
          samples.red.push(image.pixel(x, y));
        } else {
          assertPixel(image, x, y, [0, 0, 255, 128]);
          samples.blue.push(image.pixel(x, y));
        }
      }
    }

    finish(null, {
      verifier: 'Issue #686 P2-C02 authored solid multi-fill raster acceptance',
      target: { kind: scene.kind, id: scene.renderTargetId },
      composition: composed.composition,
      png: {
        width: raster.width,
        height: raster.height,
        byteLength: raster.pngBytes.byteLength,
        sha256: crypto.createHash('sha256').update(Buffer.from(raster.pngBytes)).digest('hex'),
        samples,
        assertions: ['red left region preserved', 'half-alpha blue right region preserved', 'no color bleed across shared boundary'],
      },
      sandbox: security,
      svgSha256: crypto.createHash('sha256').update(composed.svg, 'utf8').digest('hex'),
      externalResourcesInSvg: 0,
    });
  } catch (error) {
    finish(error);
  }
});

app.on('window-all-closed', () => {
  if (!finished) finish(new Error('C02 snapshot verifier window closed before completion'));
});
