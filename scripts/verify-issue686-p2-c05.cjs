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
    assert.ok(dataEnd + 4 <= bytes.length, 'truncated PNG chunk ' + type);
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
      else assert.equal(filter, 0, 'unsupported PNG filter ' + filter);
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
  };
}

function assertPixelNear(image, x, y, expected, tolerance) {
  const actual = image.pixel(x, y);
  for (let channel = 0; channel < 4; channel += 1) {
    assert.ok(
      Math.abs(actual[channel] - expected[channel]) <= tolerance,
      'PNG pixel (' + x + ',' + y + ') channel ' + channel +
        ': expected ' + expected[channel] + ' +/- ' + tolerance + ', got ' +
        actual[channel] + ' (' + actual.join(',') + ')',
    );
  }
}

function radialShape(focalPointRatio) {
  const focalAttribute = focalPointRatio === null ? '' : ' focalPointRatio="' + focalPointRatio + '"';
  return '<DOMShape><fills>' +
    '<FillStyle index="1"><RadialGradient' + focalAttribute + '>' +
    '<matrix><Matrix a="0.0048828125" b="0" c="0" d="0.0048828125" tx="4.5" ty="4.5"/></matrix>' +
    '<GradientEntry color="#ff0000" alpha="0.25" ratio="0"/>' +
    '<GradientEntry color="#0000ff" alpha="1" ratio="1"/>' +
    '</RadialGradient></FillStyle>' +
    '</fills><edges><Edge fillStyle1="1" cubics="!0 0|240 0|240 160|0 160|0 0"/></edges></DOMShape>';
}

async function makeRadialFla() {
  const sceneShape = radialShape(null);
  const graphicShape = radialShape('0.5');
  const zip = new JSZip();
  zip.file('DOMDocument.xml', '<?xml version="1.0" encoding="UTF-8"?>' +
    '<DOMDocument width="12" height="8" frameRate="24"><timelines>' +
    '<DOMTimeline name="Scene 1"><layers><DOMLayer name="Layer 1">' +
    '<frames><DOMFrame index="0"><elements>' + sceneShape + '</elements></DOMFrame></frames>' +
    '</DOMLayer></layers></DOMTimeline></timelines></DOMDocument>');
  zip.file('LIBRARY/radial-sample.xml', '<?xml version="1.0" encoding="UTF-8"?>' +
    '<DOMSymbolItem name="radial-sample" symbolType="graphic"><timeline>' +
    '<DOMTimeline name="radial-sample"><layers><DOMLayer name="Layer 1">' +
    '<frames><DOMFrame index="0"><elements>' + graphicShape + '</elements></DOMFrame></frames>' +
    '</DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>');
  return zip.generateAsync({ type: 'uint8array' });
}

async function buildTarget(sourceBytes, kind) {
  const catalog = await buildRenderableTargetCatalog(sourceBytes);
  if (!catalog.ok) throw new Error('C05 target catalog failed: ' + catalog.message);
  const entry = catalog.entries.find((candidate) => candidate.target.kind === kind);
  assert.ok(entry, 'synthetic ' + kind + ' target must be in the production catalog');
  assert.equal(entry.previewSupported, true, 'synthetic ' + kind + ' target must be previewable');
  const composed = await buildSvgForRenderTarget(sourceBytes, entry.target);
  if (!composed.ok) throw new Error('C05 SVG composition failed: ' + composed.message);
  assert.deepEqual([...composed.svg.matchAll(/\bhref="([^"]+)"/gu)], [], 'synthetic SVG must have no external resources');
  return { target: entry.target, composed };
}

function radialIds(svg) {
  return [...svg.matchAll(/<radialGradient\b id="([^"]+)"/gu)].map((match) => match[1]);
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

    const source = await makeRadialFla();
    const scene = await buildTarget(source, 'scene');
    const repeatedScene = await buildTarget(source, 'scene');
    const graphic = await buildTarget(source, 'graphic-symbol');
    const sceneIds = radialIds(scene.composed.svg);
    const repeatedSceneIds = radialIds(repeatedScene.composed.svg);
    const graphicIds = radialIds(graphic.composed.svg);
    assert.equal(sceneIds.length, 1);
    assert.deepEqual(sceneIds, repeatedSceneIds, 'radial ids must be deterministic for the same target');
    assert.equal(scene.composed.svg, repeatedScene.composed.svg);
    assert.equal(graphicIds.length, 1);
    assert.equal(sceneIds.filter((id) => graphicIds.includes(id)).length, 0, 'radial ids must be disjoint across targets');
    assert.match(scene.composed.svg, /<radialGradient\b[^>]*cx="0" cy="0" r="819\.2" fx="0" fy="0"/u);
    assert.match(scene.composed.svg, /gradientTransform="matrix\(0\.0048828125 0 0 0\.0048828125 4\.5 4\.5\)"/u);
    assert.equal(scene.composed.composition.radialGradientCount, 1);
    assert.equal(scene.composed.composition.radialGradientStopCount, 2);
    assert.match(graphic.composed.svg, /fx="409\.6" fy="0"/u);

    const rendered = await rasterize(scene.composed);
    const renderedGraphic = await rasterize(graphic.composed);
    assert.equal(rendered.raster.width, 12);
    assert.equal(rendered.raster.height, 8);
    assertPixelNear(rendered.image, 4, 4, [255, 0, 0, 64], 5);
    assertPixelNear(rendered.image, 0, 4, [0, 0, 255, 255], 3);
    assertPixelNear(renderedGraphic.image, 10, 8, [255, 0, 0, 64], 5);
    const centerAxisPixel = rendered.image.pixel(6, 4);
    assert.ok(centerAxisPixel[2] > 20, 'centered radial fill must advance away from its first stop');
    assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });

    finish(null, {
      verifier: 'Issue #686 P2-C05 radial-gradient fidelity acceptance',
      sandbox: security,
      targets: {
        scene: { id: scene.target.renderTargetId, radialGradientIds: sceneIds },
        graphic: { id: graphic.target.renderTargetId, radialGradientIds: graphicIds },
      },
      scenePng: {
        width: rendered.image.width,
        height: rendered.image.height,
        sha256: crypto.createHash('sha256').update(rendered.image.pixels).digest('hex'),
        center: rendered.image.pixel(4, 4),
        outsideRadius: rendered.image.pixel(0, 4),
      },
      focalRatioProbe: {
        centeredGradientAtFocal: rendered.image.pixel(4, 4),
        centeredGradientAwayFromFocal: centerAxisPixel,
        offCenterGradientAtFocal: renderedGraphic.image.pixel(10, 8),
      },
      gradients: scene.composed.composition,
      svgByteLength: Buffer.byteLength(scene.composed.svg, 'utf8'),
      rasterInput: 'Main-built composed SVG only',
      externalResourcesInSvg: 0,
    });
  } catch (error) {
    finish(error);
  }
});

app.on('window-all-closed', () => {
  if (!finished) finish(new Error('C05 snapshot verifier window closed before completion'));
});
