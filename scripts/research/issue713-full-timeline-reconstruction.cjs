#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
const FRAME_COUNT = 47;
const SOURCE_FPS = Object.freeze({ numerator: 30, denominator: 1 });
const STAGE = Object.freeze({ width: 1920, height: 1080 });
const REQUIRED_INTERVALS = Object.freeze([
  Object.freeze({ start: 0, end: 14 }),
  Object.freeze({ start: 14, end: 20 }),
  Object.freeze({ start: 20, end: 22 }),
  Object.freeze({ start: 22, end: 25 }),
  Object.freeze({ start: 25, end: 30 }),
  Object.freeze({ start: 30, end: 47 }),
]);
const CHECKPOINTS = Object.freeze([0, 5, 10, 14, 19, 20, 25, 30, 35, 40, 46]);
const HASH = (value) => crypto.createHash('sha256').update(value).digest('hex');

app.on('window-all-closed', () => {});

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--source') args.source = argv[++index];
    else if (value === '--expected-source-sha256') args.expectedSourceSha256 = argv[++index];
    else if (value === '--root-symbol-name') args.rootSymbolName = argv[++index];
    else if (value === '--gate0-receipt') args.gate0Receipt = argv[++index];
    else if (value === '--accepted-issue712-run') args.acceptedIssue712Run = argv[++index];
    else if (value === '--out') args.out = argv[++index];
    else if (value === '--ffmpeg') args.ffmpegPath = argv[++index];
    else if (value === '--ffprobe') args.ffprobePath = argv[++index];
  }
  for (const name of [
    'source', 'expectedSourceSha256', 'rootSymbolName', 'gate0Receipt', 'acceptedIssue712Run', 'out',
  ]) {
    assert.ok(args[name], 'missing required option --' + name.replace(/[A-Z]/gu, (letter) => '-' + letter.toLowerCase()));
  }
  assert.match(args.expectedSourceSha256, /^[a-f0-9]{64}$/iu, '--expected-source-sha256 must be SHA-256 hex');
  return {
    ...args,
    source: path.resolve(args.source),
    gate0Receipt: path.resolve(args.gate0Receipt),
    acceptedIssue712Run: path.resolve(args.acceptedIssue712Run),
    out: path.resolve(args.out),
    ffmpegPath: args.ffmpegPath || process.env.PANDA_STAGE_FFMPEG_PATH || 'ffmpeg.exe',
    ffprobePath: args.ffprobePath || process.env.PANDA_STAGE_FFPROBE_PATH ||
      path.join(ROOT, 'node_modules', '@ffprobe-installer', 'win32-x64', 'ffprobe.exe'),
  };
}

function assertExternalNewDirectory(directory) {
  const relative = path.relative(ROOT, directory);
  assert.ok(
    path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep),
    'Issue #713 acceptance artifacts must remain outside the repository',
  );
  assert.ok(!fs.existsSync(directory), 'refusing to overwrite existing evidence directory: ' + directory);
}

function tagAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/gu)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function replaceSvgAttribute(tag, name, value) {
  const expression = new RegExp('(^|\\s)' + name + '="[^"]*"', 'u');
  assert.match(tag, expression, 'production SVG is missing ' + name);
  return tag.replace(expression, (whole, prefix) => prefix + name + '="' + value + '"');
}

function reframeSvgToStage(svg, composition) {
  const svgStart = svg.indexOf('<svg');
  const svgEnd = svg.indexOf('>', svgStart);
  assert.ok(svgStart >= 0 && svgEnd > svgStart, 'production SVG has no root svg element');
  const oldTag = svg.slice(svgStart, svgEnd + 1);
  const attributes = tagAttributes(oldTag);
  const oldViewBox = String(attributes.viewBox || '').split(/\s+/u).map(Number);
  assert.equal(oldViewBox.length, 4, 'production SVG viewBox must contain four numbers');
  const expected = composition.framing.viewBox;
  for (let index = 0; index < 4; index += 1) {
    assert.ok(Math.abs(oldViewBox[index] - [expected.x, expected.y, expected.width, expected.height][index]) < 1e-8,
      'production SVG viewBox differs from its display-list composition');
  }
  let nextTag = replaceSvgAttribute(oldTag, 'viewBox', `0 0 ${STAGE.width} ${STAGE.height}`);
  nextTag = replaceSvgAttribute(nextTag, 'width', String(STAGE.width));
  nextTag = replaceSvgAttribute(nextTag, 'height', String(STAGE.height));
  const matte = `<rect x="0" y="0" width="${STAGE.width}" height="${STAGE.height}" fill="#ffffff"/>`;
  return svg.slice(0, svgStart) + nextTag + matte + svg.slice(svgEnd + 1);
}

function readPngDimensions(bytes, label) {
  assert.ok(bytes.length >= 24, label + ' is too small to be a PNG');
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', label + ' is not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function writeNewVerified(filePath, bytes) {
  const value = Buffer.from(bytes);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, value, { flag: 'wx' });
  const written = await fs.promises.readFile(filePath);
  assert.equal(HASH(written), HASH(value), 'artifact write verification failed: ' + filePath);
  return { path: path.basename(filePath), sha256: HASH(written), byteLength: written.length };
}

function createResearchRasterizer() {
  const { IPC_CHANNELS } = require(path.join(ROOT, 'dist-electron/shared/ipc/channels.js'));
  const { FlaStaticSnapshotWindowManager } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-window-manager.js'),
  );
  const manager = new FlaStaticSnapshotWindowManager(
    { readyTimeoutMs: 15_000, rasterizeWallTimeMs: 60_000 },
    {
      create(options) {
        assert.equal(options.webPreferences?.sandbox, true, 'rasterizer must keep sandbox enabled');
        assert.equal(options.webPreferences?.contextIsolation, true, 'rasterizer must keep context isolation enabled');
        assert.equal(options.webPreferences?.nodeIntegration, false, 'rasterizer must keep Node integration disabled');
        const window = new BrowserWindow(options);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        return window;
      },
    },
  );
  const handlers = [
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDERER_READY, (event) => manager.markReady(event.sender.id)],
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDER_RESULT, (event, payload) => manager.markResult(event.sender.id, payload)],
    [IPC_CHANNELS.FLA_SNAPSHOT_RENDER_ERROR, (event, payload) => manager.markError(event.sender.id, payload)],
  ];
  for (const [channel, handler] of handlers) ipcMain.on(channel, handler);
  return {
    render(svg, width, height) {
      return manager.rasterize({
        requestId: crypto.randomUUID(),
        svg,
        width,
        height,
        pixelCount: width * height,
      });
    },
    close() {
      for (const [channel, handler] of handlers) ipcMain.removeListener(channel, handler);
      manager.close();
    },
  };
}

function collectVisibleSymbols(elements, output = []) {
  for (const element of elements) {
    if (element.visible === false) continue;
    if (element.kind === 'symbol') output.push(element);
    else if (element.kind === 'group') collectVisibleSymbols(element.elements, output);
  }
  return output;
}

function applySceneRootTransform(frameContext, rootInstance) {
  const transform = rootInstance.localTransform ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  return {
    ...frameContext,
    layers: frameContext.layers.map((layer, layerIndex) => {
      if (!layer.visible) return layer;
      return {
        ...layer,
        elements: [{
          kind: 'group',
          groupId: 'issue713-scene-root-' + crypto.createHash('sha256')
            .update(`${rootInstance.sourceAddress ?? ''}:${layerIndex}`, 'utf8').digest('hex').slice(0, 24),
          localTransform: transform,
          elements: layer.elements,
        }],
      };
    }),
  };
}

function findSceneRoot(source, expectedRootSymbolName) {
  const timeline = source.sceneTimelines[0];
  assert.ok(timeline, 'normalized archive has no Scene timeline');
  const sceneContext = source.buildSceneFrameContext(timeline.xml, 0, `issue713-scene:${timeline.name}@0`);
  assert.equal(sceneContext.ok, true, sceneContext.message || 'Scene frame 0 cannot be built');
  const symbols = collectVisibleSymbols(sceneContext.value.layers.flatMap((layer) => layer.elements));
  assert.equal(symbols.length, 1, `expected one visible Scene symbol instance, found ${symbols.length}`);
  const rootInstance = symbols[0];
  assert.equal(rootInstance.symbolType, 'graphic', 'Issue #713 Scene root must be a Graphic instance');
  const descriptor = source.graphicSymbols.find((symbol) =>
    symbol.sourceLibraryItemName === rootInstance.libraryItemName);
  assert.ok(descriptor, `Scene root Graphic definition not found: ${rootInstance.libraryItemName}`);
  assert.equal(descriptor.sourceLibraryItemName, expectedRootSymbolName, 'Scene root does not match --root-symbol-name');
  return { timeline, rootInstance, descriptor };
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character]);
}

function contactSheetSvg(interval, frames) {
  const columns = 4;
  const tileWidth = 360;
  const tileHeight = 240;
  const headerHeight = 56;
  const rows = Math.ceil(frames.length / columns);
  const width = columns * tileWidth;
  const height = headerHeight + rows * tileHeight;
  const statusColors = {
    AUTHORED: '#245b3a',
    TWEEN_RECONSTRUCTED: '#155e9a',
    HELD: '#7c5500',
    BLOCKED: '#a61b1b',
  };
  const cells = frames.map((frame, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * tileWidth;
    const y = headerHeight + row * tileHeight;
    const color = statusColors[frame.status] || '#475569';
    const image = frame.pngBytes
      ? `<image x="${x + 12}" y="${y + 45}" width="336" height="189" href="data:image/png;base64,${frame.pngBytes.toString('base64')}" preserveAspectRatio="xMidYMid meet"/>`
      : `<text x="${x + 180}" y="${y + 142}" text-anchor="middle" font-size="16" fill="#7f1d1d">No resolved image</text>`;
    const blocker = frame.blockerReason
      ? `<text x="${x + 12}" y="${y + 234}" font-size="11" fill="#7f1d1d">${escapeXml(frame.blockerReason.slice(0, 80))}</text>`
      : '';
    return `<g>
      <rect x="${x + 4}" y="${y + 4}" width="${tileWidth - 8}" height="${tileHeight - 8}" rx="8" fill="#ffffff" stroke="#aeb8c2"/>
      <text x="${x + 14}" y="${y + 29}" font-size="17" font-weight="700" fill="#152536">F${frame.frameIndex}</text>
      <text x="${x + tileWidth - 14}" y="${y + 29}" text-anchor="end" font-size="12" font-weight="700" fill="${color}">${frame.status}</text>
      ${image}${blocker}
    </g>`;
  }).join('\n');
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#edf1f5"/>
      <text x="18" y="38" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="#152536">Issue #713 · frames [${interval.start},${interval.end}) · chronological</text>
      <g font-family="Arial, sans-serif">${cells}</g>
    </svg>`,
  };
}

function runChild(executable, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: ROOT,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => reject(new Error(label + ' could not start: ' + error.message)));
    child.once('close', (code, signal) => {
      const output = Buffer.concat(stdout).toString('utf8');
      const diagnostics = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        reject(new Error(label + ' failed (exit=' + code + ', signal=' + signal + '): ' + diagnostics.slice(-6000)));
        return;
      }
      resolve({ stdout: output, stderr: diagnostics });
    });
  });
}

function ffmpegArgs(inputPattern, outputPath) {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-framerate', `${SOURCE_FPS.numerator}/${SOURCE_FPS.denominator}`,
    '-start_number', '0', '-i', inputPattern,
    '-map', '0:v:0', '-frames:v', String(FRAME_COUNT), '-an', '-vsync', '0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-threads', '1', '-bf', '0', '-g', String(FRAME_COUNT),
    '-video_track_timescale', String(SOURCE_FPS.numerator * 1000),
    '-movflags', '+faststart', '-map_metadata', '-1',
    '-metadata', 'creation_time=1970-01-01T00:00:00Z',
    '-fflags', '+bitexact', '-flags:v', '+bitexact', outputPath,
  ];
}

function parseRational(value, label) {
  const match = /^(\d+)\/(\d+)$/u.exec(String(value));
  assert.ok(match, label + ' must be an exact rational');
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  assert.ok(Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && denominator > 0,
    label + ' is invalid');
  return { numerator, denominator };
}

async function probeVideo(ffprobePath, videoPath) {
  const result = await runChild(ffprobePath, [
    '-v', 'error', '-count_frames', '-show_frames',
    '-show_entries',
    'stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate,time_base,duration,duration_ts,nb_frames,nb_read_frames:format=duration:frame=best_effort_timestamp,best_effort_timestamp_time,pkt_duration,pkt_duration_time',
    '-of', 'json', videoPath,
  ], 'ffprobe');
  const value = JSON.parse(result.stdout);
  const videos = (value.streams || []).filter((stream) => stream.codec_type === 'video');
  const audios = (value.streams || []).filter((stream) => stream.codec_type === 'audio');
  assert.equal(videos.length, 1, 'clip must have exactly one video stream');
  assert.equal(audios.length, 0, 'clip must be silent');
  const stream = videos[0];
  assert.equal(stream.codec_name, 'h264');
  assert.equal(stream.pix_fmt, 'yuv420p');
  assert.equal(stream.width, STAGE.width);
  assert.equal(stream.height, STAGE.height);
  assert.equal(stream.avg_frame_rate, '30/1');
  assert.equal(stream.r_frame_rate, '30/1');
  assert.equal(Number(stream.nb_read_frames), FRAME_COUNT);
  assert.equal((value.frames || []).length, FRAME_COUNT);
  const timeBase = parseRational(stream.time_base, 'video time_base');
  const timestampStep = SOURCE_FPS.denominator * timeBase.denominator /
    (SOURCE_FPS.numerator * timeBase.numerator);
  assert.ok(Number.isSafeInteger(timestampStep) && timestampStep > 0,
    'source frame rate is not exact in the video time base');
  const timestamps = value.frames.map((frame) => Number(frame.best_effort_timestamp));
  assert.equal(timestamps[0], 0, 'clip must start at presentation timestamp zero');
  for (let index = 1; index < timestamps.length; index += 1) {
    assert.equal(timestamps[index] - timestamps[index - 1], timestampStep,
      'clip has a dropped, duplicated, reordered, or held presentation timestamp');
  }
  const expectedDuration = FRAME_COUNT * SOURCE_FPS.denominator / SOURCE_FPS.numerator;
  const streamDuration = Number(stream.duration);
  const containerDuration = Number(value.format?.duration);
  assert.ok(Number.isFinite(streamDuration) && Math.abs(streamDuration - expectedDuration) < 1e-6,
    'stream duration differs from the exact source-derived duration');
  assert.ok(Number.isFinite(containerDuration) && Math.abs(containerDuration - expectedDuration) < 1e-6,
    'container duration differs from the exact source-derived duration');
  if (stream.duration_ts !== undefined) {
    assert.equal(Number(stream.duration_ts), timestampStep * FRAME_COUNT,
      'container timebase does not encode the exact full-timeline duration');
  }
  return {
    codec: stream.codec_name,
    pixelFormat: stream.pix_fmt,
    width: stream.width,
    height: stream.height,
    frameRate: stream.avg_frame_rate,
    frameCount: Number(stream.nb_read_frames),
    timeBase: stream.time_base,
    timestampStepTicks: timestampStep,
    presentationTimestamps: timestamps,
    durationSeconds: streamDuration,
    containerDurationSeconds: containerDuration,
    hasAudio: audios.length > 0,
  };
}

async function loadProductionSource(sourceBytes) {
  const classifier = require(path.join(ROOT, 'dist-electron/main/services/fla-recovery-classifier.js'));
  const classification = classifier.classifyForFlaRecovery(sourceBytes);
  const normalized = classifier.normalizeRecoveryCandidate(sourceBytes, classification);
  const archiveBytes = normalized.applied ? normalized.bytes : sourceBytes;
  assert.equal(classifier.classifyForFlaRecovery(archiveBytes).state, classifier.STATES.STRICT_VALID,
    'in-memory normalized archive did not pass strict source classification');
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(archiveBytes);
  const document = zip.file('DOMDocument.xml');
  assert.ok(document, 'normalized archive is missing DOMDocument.xml');
  const documentXml = await document.async('string');
  const libraryXmlEntries = [];
  for (const name of Object.keys(zip.files).filter((entry) => /^LIBRARY\/.*\.xml$/iu.test(entry)).sort()) {
    const file = zip.file(name);
    if (file) libraryXmlEntries.push({ name, xml: await file.async('string') });
  }
  const { adaptFlaXflDisplaySource } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-display-list-adapter.js'),
  );
  const adapted = adaptFlaXflDisplaySource(documentXml, libraryXmlEntries);
  assert.equal(adapted.ok, true, adapted.message || 'production XFL adapter rejected normalized archive');
  return {
    source: adapted.source,
    normalization: normalized.applied ? {
      applied: true,
      field: normalized.field,
      deltaBytes: normalized.deltaBytes,
      mode: normalized.mode,
      originalBytesWritten: normalized.originalBytesWritten,
      normalizedArchiveSha256: HASH(archiveBytes),
    } : { applied: false, mode: 'strict-valid' },
    archiveClassification: classification.state,
    documentXml,
  };
}

async function reconstructFrame(source, descriptor, rootInstance, frameIndex, status, rasterizer, out) {
  const { prepareFlaNestedGraphicFrameSelections } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-nested-graphic-frame-selector.js'),
  );
  const { resolveFlaDisplayList } = require(path.join(ROOT, 'dist-electron/main/services/fla-display-list-resolver.js'));
  const { buildSvgForResolvedDisplayList } = require(
    path.join(ROOT, 'dist-electron/main/services/fla-static-snapshot-svg-builder.js'),
  );
  const frameContextResult = source.buildGraphicFrameContext(
    descriptor.timelineXml,
    descriptor.frameSpanIndex,
    frameIndex,
    `issue713-root:${descriptor.sourceLibraryItemName}@${frameIndex}`,
  );
  if (!frameContextResult.ok) {
    return { frameIndex, status: 'BLOCKED', blockerReason: frameContextResult.message };
  }
  const root = {
    kind: 'graphic',
    name: descriptor.sourceLibraryItemName,
    frameContext: applySceneRootTransform(frameContextResult.value, rootInstance),
  };
  const prepared = prepareFlaNestedGraphicFrameSelections(source, root);
  if (!prepared.ok) return { frameIndex, status: 'BLOCKED', blockerReason: prepared.message };
  const resolved = resolveFlaDisplayList(prepared.resolverInput);
  if (!resolved.ok) return { frameIndex, status: 'BLOCKED', blockerReason: resolved.message };
  const composed = buildSvgForResolvedDisplayList({
    displayList: resolved.displayList,
    renderTargetId: `issue713:${descriptor.sourceLibraryItemName}@${frameIndex}`,
    stageWidth: source.stageWidth,
    stageHeight: source.stageHeight,
    shapeBlocks: source.shapeBlocks,
    resolveBitmapMedia: () => ({ ok: false, reason: 'missing' }),
  });
  if (!composed.ok) return { frameIndex, status: 'BLOCKED', blockerReason: composed.message };
  if (composed.composition.shapeCount <= 0) {
    return { frameIndex, status: 'BLOCKED', blockerReason: 'Resolved frame contains no visible source shapes' };
  }
  const stageSvg = reframeSvgToStage(composed.svg, composed.composition);
  const firstRaster = await rasterizer.render(stageSvg, STAGE.width, STAGE.height);
  const repeatedRaster = await rasterizer.render(stageSvg, STAGE.width, STAGE.height);
  const pngBytes = Buffer.from(firstRaster.pngBytes);
  const repeatedPngSha256 = HASH(repeatedRaster.pngBytes);
  const pngSha256 = HASH(pngBytes);
  assert.deepEqual(readPngDimensions(pngBytes, 'full-stage PNG F' + frameIndex), STAGE);
  assert.equal(firstRaster.width, repeatedRaster.width);
  assert.equal(firstRaster.height, repeatedRaster.height);
  const basename = `full-frame-${String(frameIndex).padStart(2, '0')}`;
  const svgArtifact = await writeNewVerified(path.join(out, basename + '.svg'), Buffer.from(stageSvg, 'utf8'));
  const pngArtifact = await writeNewVerified(path.join(out, basename + '.png'), pngBytes);
  return {
    frameIndex,
    status,
    sourceTime: `${frameIndex}/${SOURCE_FPS.numerator}`,
    clipTimeOffset: `${frameIndex}/${SOURCE_FPS.numerator}`,
    nestedSelections: prepared.selections.map((selection) => ({
      sourceAddress: selection.sourceAddress,
      libraryItemName: selection.libraryItemName,
      playbackMode: selection.playbackMode,
      childFrameCount: selection.childFrameCount,
      selectedChildFrameIndex: selection.selectedChildFrameIndex,
      selectionRule: selection.selectionRule,
    })),
    composition: {
      shapeCount: composed.composition.shapeCount,
      bitmapInstanceCount: composed.composition.bitmapInstanceCount,
      expandedSymbolCount: composed.composition.expandedSymbolCount,
      resolvedNodeCount: composed.composition.resolvedNodeCount,
      framing: composed.composition.framing,
    },
    determinism: {
      pngSha256,
      repeatedPngSha256,
      repeatedPngIdentical: pngSha256 === repeatedPngSha256,
    },
    artifacts: { svg: svgArtifact, png: pngArtifact },
    pngBytes,
  };
}

async function writeContactSheets(rasterizer, outputDirectory, frameArtifacts) {
  const sheets = [];
  for (const interval of REQUIRED_INTERVALS) {
    const frames = frameArtifacts.filter((frame) =>
      frame.frameIndex >= interval.start && frame.frameIndex < interval.end);
    const sheet = contactSheetSvg(interval, frames);
    const firstRaster = await rasterizer.render(sheet.svg, sheet.width, sheet.height);
    const repeatedRaster = await rasterizer.render(sheet.svg, sheet.width, sheet.height);
    const pngBytes = Buffer.from(firstRaster.pngBytes);
    const repeatedPngSha256 = HASH(repeatedRaster.pngBytes);
    const pngSha256 = HASH(pngBytes);
    const stem = `interval-${String(interval.start).padStart(2, '0')}-${String(interval.end - 1).padStart(2, '0')}`;
    const svgArtifact = await writeNewVerified(
      path.join(outputDirectory, stem + '.svg'), Buffer.from(sheet.svg, 'utf8'));
    const pngArtifact = await writeNewVerified(path.join(outputDirectory, stem + '.png'), pngBytes);
    sheets.push({
      interval: `[${interval.start},${interval.end})`,
      frames: frames.map((frame) => frame.frameIndex),
      width: sheet.width,
      height: sheet.height,
      statusLabelsPresent: frames.every((frame) => Boolean(frame.status)),
      repeatedPngIdentical: pngSha256 === repeatedPngSha256,
      sha256: { svg: svgArtifact.sha256, png: pngSha256, repeatedPng: repeatedPngSha256 },
      artifacts: { svg: svgArtifact, png: pngArtifact },
    });
  }
  return sheets;
}

async function run(args) {
  assertExternalNewDirectory(args.out);
  assert.ok(fs.existsSync(args.source), 'primary source FLA does not exist');
  assert.ok(fs.existsSync(args.gate0Receipt), 'Gate 0 receipt does not exist');
  assert.ok(fs.existsSync(args.acceptedIssue712Run), 'accepted Issue #712 run directory does not exist');
  assert.ok(fs.existsSync(args.ffprobePath), 'ffprobe executable does not exist: ' + args.ffprobePath);

  const gate0Receipt = JSON.parse(await fs.promises.readFile(args.gate0Receipt, 'utf8'));
  assert.equal(gate0Receipt.schemaVersion, 'issue713-full-timeline-gate0/2');
  assert.equal(gate0Receipt.source.originalSha256, args.expectedSourceSha256.toLowerCase());
  assert.equal(gate0Receipt.gate0.gateA?.allFramesResolved, true, 'Gate 0/Gate A production resolution is incomplete');
  assert.equal(gate0Receipt.gate0.gateA?.repeatedProductionResolutionDeterministic, true,
    'repeated production frame resolution is not deterministic');
  const gate0Frames = gate0Receipt.gate0.existingProductionResolution.frames;
  assert.equal(gate0Frames.length, FRAME_COUNT);
  assert.deepEqual(gate0Frames.map((frame) => frame.frameIndex), Array.from({ length: FRAME_COUNT }, (_, index) => index));

  const acceptedReceiptPath = path.join(args.acceptedIssue712Run, 'completion-receipt.json');
  const acceptedReceipt = JSON.parse(await fs.promises.readFile(acceptedReceiptPath, 'utf8'));
  assert.equal(acceptedReceipt.schemaVersion, 'issue712-short-clip-reconstruction/1');
  assert.equal(acceptedReceipt.source.originalSha256, args.expectedSourceSha256.toLowerCase(),
    'accepted Issue #712 controls use a different primary FLA');
  assert.deepEqual(acceptedReceipt.gateA.exactOrder, [20, 21, 22, 23, 24, 25]);
  const acceptedFrames = new Map(acceptedReceipt.gateB.frameTimingManifest.map((frame) => [frame.frame, frame]));

  await fs.promises.mkdir(args.out, { recursive: true });
  const sourceBytes = await fs.promises.readFile(args.source);
  const originalSha256 = HASH(sourceBytes);
  assert.equal(originalSha256, args.expectedSourceSha256.toLowerCase(), 'primary FLA source hash changed');
  const loaded = await loadProductionSource(sourceBytes);
  const source = loaded.source;
  assert.equal(source.stageWidth, STAGE.width);
  assert.equal(source.stageHeight, STAGE.height);
  const { timeline, rootInstance, descriptor } = findSceneRoot(source, args.rootSymbolName);
  assert.equal(descriptor.frameCount, FRAME_COUNT);
  assert.equal(descriptor.frameSpanIndex.layers.filter((layer) => layer.visible).length, 12);

  const rasterizer = createResearchRasterizer();
  const frames = [];
  try {
    for (const proof of gate0Frames) {
      const frame = await reconstructFrame(
        source,
        descriptor,
        rootInstance,
        proof.frameIndex,
        proof.status,
        rasterizer,
        args.out,
      );
      if (frame.status !== 'BLOCKED') {
        assert.equal(frame.status, proof.status, `source status changed at F${frame.frameIndex}`);
        assert.equal(frame.determinism.repeatedPngIdentical, true,
          `repeated production PNG differs at F${frame.frameIndex}`);
        if (frame.frameIndex >= 20 && frame.frameIndex <= 25) {
          const accepted = acceptedFrames.get(frame.frameIndex);
          assert.ok(accepted, 'accepted #712 control is missing at F' + frame.frameIndex);
          assert.equal(frame.artifacts.png.sha256, accepted.stagePng.sha256,
            `accepted Issue #712 stage control changed at F${frame.frameIndex}`);
        }
      }
      frames.push(frame);
    }

    const sheets = await writeContactSheets(rasterizer, args.out, frames);
    assert.equal(sheets.reduce((total, sheet) => total + sheet.frames.length, 0), FRAME_COUNT,
      'interval contact sheets do not cover all requested frames exactly once');
    assert.equal(new Set(sheets.flatMap((sheet) => sheet.frames)).size, FRAME_COUNT,
      'interval contact sheets repeat or omit a frame');
    assert.ok(sheets.every((sheet) => sheet.statusLabelsPresent && sheet.repeatedPngIdentical),
      'contact sheet status labels or repeated rendering are incomplete');

    const allFramesResolved = frames.length === FRAME_COUNT && frames.every((frame) => frame.status !== 'BLOCKED');
    const allRepeatedRendersIdentical = frames.every((frame) => frame.determinism?.repeatedPngIdentical === true);
    let clip = null;
    if (allFramesResolved) {
      const inputPattern = path.join(args.out, 'full-frame-%02d.png');
      const clipPath = path.join(args.out, 'issue713-full-timeline-f0-f46-30fps.mp4');
      const repeatPath = path.join(args.out, 'repeat-check.mp4');
      await runChild(args.ffmpegPath, ffmpegArgs(inputPattern, clipPath), 'FFmpeg full-timeline encode');
      const probe = await probeVideo(args.ffprobePath, clipPath);
      await runChild(args.ffmpegPath, ffmpegArgs(inputPattern, repeatPath), 'FFmpeg repeat encode');
      const repeatProbe = await probeVideo(args.ffprobePath, repeatPath);
      assert.deepEqual(repeatProbe, probe, 'repeated full-timeline encode probe metadata differs');
      const clipBytes = await fs.promises.readFile(clipPath);
      const repeatedClipBytes = await fs.promises.readFile(repeatPath);
      clip = {
        path: path.basename(clipPath),
        sha256: HASH(clipBytes),
        byteLength: clipBytes.length,
        repeatPath: path.basename(repeatPath),
        repeatedSha256: HASH(repeatedClipBytes),
        repeatedByteIdentical: HASH(clipBytes) === HASH(repeatedClipBytes),
        ...probe,
      };
    }

    const sourceSha256After = HASH(await fs.promises.readFile(args.source));
    assert.equal(sourceSha256After, originalSha256, 'source FLA changed during reconstruction');
    const statusCounts = frames.reduce((counts, frame) => ({
      ...counts,
      [frame.status]: (counts[frame.status] || 0) + 1,
    }), {});
    const manifestFrames = frames.map((frame) => ({
      frame: frame.frameIndex,
      status: frame.status,
      sourceTime: `${frame.frameIndex}/${SOURCE_FPS.numerator}`,
      presentationTime: `${frame.frameIndex}/${SOURCE_FPS.numerator}`,
      blockerReason: frame.blockerReason ?? null,
      nestedSelections: frame.nestedSelections ?? [],
      composition: frame.composition ?? null,
      determinism: frame.determinism ?? null,
      artifacts: frame.artifacts ?? null,
    }));
    const evidenceMap = {
      frameOrder: frames.map((frame) => frame.frameIndex),
      frameCount: frames.length,
      allStatusesPresent: manifestFrames.every((frame) =>
        ['AUTHORED', 'TWEEN_RECONSTRUCTED', 'HELD', 'BLOCKED'].includes(frame.status)),
      chronological: frames.every((frame, index) => frame.frameIndex === index),
      statusCounts,
      checkpoints: CHECKPOINTS.map((frameIndex) => ({
        frame: frameIndex,
        status: frames[frameIndex]?.status ?? 'MISSING',
        png: frames[frameIndex]?.artifacts?.png ?? null,
      })),
      intervalSheets: sheets,
      manifestPath: 'evidence-map.json',
      individualFrameArtifactsRetained: frames.every((frame) => frame.status === 'BLOCKED' || Boolean(frame.artifacts?.png)),
    };
    const evidenceMapBytes = Buffer.from(JSON.stringify({
      issue: 713,
      rootGraphic: descriptor.sourceLibraryItemName,
      frameRate: '30/1',
      frameCount: FRAME_COUNT,
      frameTimingManifest: manifestFrames,
      ...evidenceMap,
    }, null, 2) + '\n', 'utf8');
    const evidenceMapArtifact = await writeNewVerified(path.join(args.out, 'evidence-map.json'), evidenceMapBytes);

    const receipt = {
      schemaVersion: 'issue713-full-timeline-reconstruction/1',
      issue: 'https://github.com/Cognitive-Architect/panda-stage/issues/713',
      motherPullRequest: 'https://github.com/Cognitive-Architect/panda-stage/pull/677',
      prerequisite: {
        issue: 'https://github.com/Cognitive-Architect/panda-stage/issues/712',
        state: 'CLOSED',
        acceptedRunDirectory: args.acceptedIssue712Run,
      },
      source: {
        path: args.source,
        originalSha256,
        originalSha256After: sourceSha256After,
        sourceHashInvariant: sourceSha256After === originalSha256,
        archiveClassification: loaded.archiveClassification,
        normalization: loaded.normalization,
      },
      rootGraphic: {
        name: descriptor.sourceLibraryItemName,
        firstFrame: 0,
        lastFrame: FRAME_COUNT - 1,
        frameCount: FRAME_COUNT,
        frameRate: '30/1',
        exactClipDuration: `${FRAME_COUNT}/${SOURCE_FPS.numerator} seconds`,
        stageWidth: source.stageWidth,
        stageHeight: source.stageHeight,
        sceneTimelineName: timeline.name,
        sceneRootTransform: rootInstance.localTransform ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      },
      gate0: {
        receiptPath: args.gate0Receipt,
        classification: gate0Receipt.gate0.classification,
        capabilityCounts: gate0Receipt.gate0.intervalClassificationCounts,
        boundedDurationExtensions: gate0Receipt.gate0.longerMotionDurationsNeedingExtension,
        allRootFramesProductionResolved: gate0Receipt.gate0.gateA.allFramesResolved,
        repeatedResolutionDeterministic: gate0Receipt.gate0.gateA.repeatedProductionResolutionDeterministic,
      },
      gateA: {
        requestedFrameCount: frames.length,
        resolvedFrameCount: frames.filter((frame) => frame.status !== 'BLOCKED').length,
        statusCounts,
        everyFrameHasExactlyOneStatus: evidenceMap.allStatusesPresent,
        allFramesResolved,
        productionResolutionDeterministic: gate0Receipt.gate0.gateA.repeatedProductionResolutionDeterministic,
        repeatedRasterBytesIdentical: allRepeatedRendersIdentical,
        acceptedIssue712StageControlsMatch: frames.filter((frame) => frame.frameIndex >= 20 && frame.frameIndex <= 25)
          .every((frame) => frame.status !== 'BLOCKED' &&
            frame.artifacts.png.sha256 === acceptedFrames.get(frame.frameIndex)?.stagePng.sha256),
        frameTimingManifest: manifestFrames,
      },
      gateB: {
        evidenceMap: { ...evidenceMap, artifact: evidenceMapArtifact },
        contactSheets: sheets,
        individualFrameArtifactsRetained: evidenceMap.individualFrameArtifactsRetained,
      },
      gateC: {
        clipGenerated: Boolean(clip),
        clip,
        sourceFrameCadence: '30/1 FPS',
        encoderInterpolation: 'none; one PNG per source frame, -vsync 0, no filters, no output -r',
        manualFrameDuplication: 'none',
        frameOrder: 'F0 -> F1 -> ... -> F46',
      },
      gateD: {
        sourceReference: 'Primary FLA: ' + args.source,
        maintainerFullMotionResult: 'PENDING_MAINTAINER',
        notes: 'Full-motion review remains required before recording PASS, PARTIAL, or FAIL.',
      },
      sourceMutation: 'NO',
      projectMutation: 'NONE: source-side reconstruction and raster evidence only',
      manualPoseOrImageRepair: 'NO',
      fixtureSpecificProductionBranch: 'NO',
      movieClipRuntimeAdded: 'NO',
      scriptExecutionAdded: 'NO',
      playbackUiAdded: 'NO',
      result: allFramesResolved && clip
        ? 'FULL_TIMELINE_RECONSTRUCTED_READY_FOR_MAINTAINER_FULL_MOTION_REVIEW'
        : 'PARTIAL_BLOCKED_WITH_COMPLETE_CAPABILITY_MAP',
    };
    const receiptArtifact = await writeNewVerified(
      path.join(args.out, 'completion-receipt.json'),
      Buffer.from(JSON.stringify(receipt, null, 2) + '\n', 'utf8'),
    );
    process.stdout.write(JSON.stringify({
      outputDirectory: args.out,
      receiptArtifact,
      sourceSha256: originalSha256,
      frameCount: FRAME_COUNT,
      statusCounts,
      allFramesResolved,
      repeatedRasterBytesIdentical: allRepeatedRendersIdentical,
      contactSheets: sheets.map((sheet) => ({ interval: sheet.interval, png: sheet.artifacts.png.path })),
      clip,
      gateD: receipt.gateD,
      result: receipt.result,
    }, null, 2) + '\n');
  } finally {
    rasterizer.close();
  }
}

const args = parseArgs(process.argv.slice(2));
app.whenReady().then(() => run(args)).then(
  () => app.quit(),
  (error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    app.quit();
    process.exitCode = 1;
  },
);
