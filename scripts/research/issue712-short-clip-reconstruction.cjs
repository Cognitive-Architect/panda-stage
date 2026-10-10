#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.resolve(__dirname, '..', '..');
app.on('window-all-closed', () => {});
const TARGET_FRAMES = Object.freeze([20, 21, 22, 23, 24, 25]);
const EXPECTED_STATUSES = Object.freeze([
  'AUTHORED',
  'TWEEN_RECONSTRUCTED',
  'AUTHORED',
  'TWEEN_RECONSTRUCTED',
  'TWEEN_RECONSTRUCTED',
  'AUTHORED',
]);
const HASH = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--source') args.source = argv[++index];
    else if (value === '--expected-source-sha256') args.expectedSourceSha256 = argv[++index];
    else if (value === '--accepted-run') args.acceptedRun = argv[++index];
    else if (value === '--out') args.out = argv[++index];
    else if (value === '--ffmpeg') args.ffmpegPath = argv[++index];
    else if (value === '--ffprobe') args.ffprobePath = argv[++index];
  }
  for (const name of ['source', 'expectedSourceSha256', 'acceptedRun', 'out']) {
    assert.ok(args[name], 'missing required option --' + name.replace(/[A-Z]/gu, (letter) => '-' + letter.toLowerCase()));
  }
  assert.match(args.expectedSourceSha256, /^[a-f0-9]{64}$/iu, '--expected-source-sha256 must be SHA-256 hex');
  return {
    ...args,
    source: path.resolve(args.source),
    acceptedRun: path.resolve(args.acceptedRun),
    out: path.resolve(args.out),
    ffmpegPath: args.ffmpegPath || process.env.PANDA_STAGE_FFMPEG_PATH || 'ffmpeg.exe',
    ffprobePath: args.ffprobePath || process.env.PANDA_STAGE_FFPROBE_PATH ||
      path.join(ROOT, 'node_modules', '@ffprobe-installer', 'win32-x64', 'ffprobe.exe'),
  };
}

function assertExternalDirectory(directory) {
  const relative = path.relative(ROOT, directory);
  assert.ok(
    path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep),
    'Issue #712 acceptance artifacts must remain outside the repository',
  );
}

function resolveWithin(directory, relativePath) {
  assert.equal(typeof relativePath, 'string');
  const result = path.resolve(directory, relativePath);
  const relative = path.relative(directory, result);
  assert.ok(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative),
    'accepted artifact path escapes its run directory');
  return result;
}

function parseTag(xml, tagName) {
  const start = xml.indexOf('<' + tagName);
  assert.notEqual(start, -1, 'missing XML tag ' + tagName);
  const end = xml.indexOf('>', start);
  assert.notEqual(end, -1, 'unterminated XML tag ' + tagName);
  return xml.slice(start, end + 1);
}

function tagAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/gu)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function parseDecimalRational(value, label) {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(String(value).trim());
  assert.ok(match, label + ' must be a positive decimal number');
  const fractionDigits = match[2] || '';
  const denominator = 10 ** fractionDigits.length;
  const numerator = Number(match[1]) * denominator + Number(fractionDigits || '0');
  assert.ok(Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && numerator > 0,
    label + ' is outside the supported exact rational range');
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function formatRational(value) {
  return value.numerator + '/' + value.denominator;
}

function numberForRational(value) {
  return value.numerator / value.denominator;
}

function parseRationalString(value, label) {
  const match = /^(\d+)\/(\d+)$/u.exec(String(value));
  assert.ok(match, label + ' must be an exact rational');
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  assert.ok(Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && numerator > 0 && denominator > 0,
    label + ' is invalid');
  return { numerator, denominator };
}

function replaceSvgAttribute(tag, name, value) {
  const expression = new RegExp('(^|\\s)' + name + '="[^"]*"', 'u');
  assert.match(tag, expression, 'accepted SVG is missing ' + name);
  return tag.replace(expression, (whole, prefix) => prefix + name + '="' + value + '"');
}

function reframeSvgToStage(svg, frame, width, height, matteColor) {
  const svgStart = svg.indexOf('<svg');
  const svgEnd = svg.indexOf('>', svgStart);
  assert.ok(svgStart >= 0 && svgEnd > svgStart, 'accepted SVG has no root svg element');
  const oldTag = svg.slice(svgStart, svgEnd + 1);
  const attributes = tagAttributes(oldTag);
  const oldViewBox = String(attributes.viewBox || '').split(/\s+/u).map(Number);
  assert.equal(oldViewBox.length, 4, 'accepted SVG viewBox must contain four numbers');
  const expectedViewBox = frame.composition.framing.viewBox;
  for (let index = 0; index < 4; index += 1) {
    assert.ok(Math.abs(oldViewBox[index] - [
      expectedViewBox.x,
      expectedViewBox.y,
      expectedViewBox.width,
      expectedViewBox.height,
    ][index]) < 1e-8, 'accepted SVG viewBox differs from the #711 receipt');
  }

  let nextTag = replaceSvgAttribute(oldTag, 'viewBox', '0 0 ' + width + ' ' + height);
  nextTag = replaceSvgAttribute(nextTag, 'width', String(width));
  nextTag = replaceSvgAttribute(nextTag, 'height', String(height));
  const matte = '<rect x="0" y="0" width="' + width + '" height="' + height +
    '" fill="' + matteColor + '"/>';
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
  return {
    path: path.basename(filePath),
    sha256: HASH(written),
    byteLength: written.length,
  };
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
    async render(svg, width, height) {
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

function ffmpegArgs(inputPattern, frameRate, outputPath, trackTimescale) {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-framerate', formatRational(frameRate),
    '-start_number', String(TARGET_FRAMES[0]),
    '-i', inputPattern,
    '-map', '0:v:0',
    '-frames:v', String(TARGET_FRAMES.length),
    '-an',
    '-vsync', '0',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-threads', '1',
    '-bf', '0',
    '-g', String(TARGET_FRAMES.length),
    '-video_track_timescale', String(trackTimescale),
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    '-metadata', 'creation_time=1970-01-01T00:00:00Z',
    '-fflags', '+bitexact',
    '-flags:v', '+bitexact',
    outputPath,
  ];
}

async function probeVideo(ffprobePath, videoPath, frameRate, width, height) {
  const result = await runChild(ffprobePath, [
    '-v', 'error',
    '-count_frames',
    '-show_frames',
    '-show_entries',
    'stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate,time_base,duration,duration_ts,nb_frames,nb_read_frames:format=duration:frame=best_effort_timestamp,best_effort_timestamp_time,pkt_duration,pkt_duration_time',
    '-of', 'json',
    videoPath,
  ], 'ffprobe');
  const value = JSON.parse(result.stdout);
  const videos = (value.streams || []).filter((stream) => stream.codec_type === 'video');
  const audios = (value.streams || []).filter((stream) => stream.codec_type === 'audio');
  assert.equal(videos.length, 1, 'clip must have exactly one video stream');
  assert.equal(audios.length, 0, 'clip must be silent');
  const stream = videos[0];
  assert.equal(stream.codec_name, 'h264');
  assert.equal(stream.pix_fmt, 'yuv420p');
  assert.equal(stream.width, width);
  assert.equal(stream.height, height);
  assert.equal(stream.avg_frame_rate, formatRational(frameRate));
  assert.equal(stream.r_frame_rate, formatRational(frameRate));
  assert.equal(Number(stream.nb_read_frames), TARGET_FRAMES.length);
  assert.equal((value.frames || []).length, TARGET_FRAMES.length);

  const timeBase = parseRationalString(stream.time_base, 'video time_base');
  const timestampStep = frameRate.denominator * timeBase.denominator /
    (frameRate.numerator * timeBase.numerator);
  assert.ok(Number.isSafeInteger(timestampStep) && timestampStep > 0, 'source frame rate is not exact in the video time base');
  const timestamps = value.frames.map((frame) => Number(frame.best_effort_timestamp));
  assert.equal(timestamps[0], 0, 'clip must start at presentation timestamp zero');
  for (let index = 1; index < timestamps.length; index += 1) {
    assert.equal(timestamps[index] - timestamps[index - 1], timestampStep,
      'clip has a dropped, duplicated, reordered, or held frame timestamp');
  }
  const expectedDurationSeconds = TARGET_FRAMES.length * frameRate.denominator / frameRate.numerator;
  const streamDuration = Number(stream.duration);
  const formatDuration = Number(value.format?.duration);
  assert.ok(Number.isFinite(streamDuration) && Math.abs(streamDuration - expectedDurationSeconds) < 1e-6,
    'stream duration differs from the source-derived six-frame duration');
  assert.ok(Number.isFinite(formatDuration) && Math.abs(formatDuration - expectedDurationSeconds) < 1e-6,
    'container duration differs from the source-derived six-frame duration');
  if (stream.duration_ts !== undefined) {
    assert.equal(Number(stream.duration_ts), timestampStep * TARGET_FRAMES.length,
      'container timebase does not encode the full six-frame duration');
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
    containerDurationSeconds: formatDuration,
    hasAudio: audios.length > 0,
  };
}

async function readSourceAndAcceptedFrames(args) {
  const sourceBytes = await fs.promises.readFile(args.source);
  const sourceSha256 = HASH(sourceBytes);
  assert.equal(sourceSha256, args.expectedSourceSha256.toLowerCase(), 'primary FLA source hash changed');

  const acceptedReceiptPath = path.join(args.acceptedRun, 'completion-receipt.json');
  const acceptedReceipt = JSON.parse(await fs.promises.readFile(acceptedReceiptPath, 'utf8'));
  assert.equal(acceptedReceipt.schemaVersion, 'issue711-continuous-state-reconstruction/1');
  assert.equal(acceptedReceipt.source.originalSha256, sourceSha256, '#711 accepted frames use a different primary FLA');
  assert.equal(acceptedReceipt.hierarchy.sceneRootSymbolName, '肌肉男-cilisucai.com11 3');
  assert.equal(acceptedReceipt.hierarchy.frameCount, 47, '#711 accepted receipt does not describe the expected root Graphic');
  assert.equal(acceptedReceipt.temporalContactSheet.repeatedPngIdentical, true);

  const probes = acceptedReceipt.probes;
  assert.deepEqual(probes.map((probe) => probe.requestedRootGraphicFrame), TARGET_FRAMES);
  const frameInputs = [];
  for (let index = 0; index < TARGET_FRAMES.length; index += 1) {
    const frame = TARGET_FRAMES[index];
    const probe = probes[index];
    assert.equal(probe.status, EXPECTED_STATUSES[index], 'unexpected #711 state status for F' + frame);
    assert.equal(probe.determinism.repeatedPngIdentical, true, 'accepted #711 raster was not deterministic at F' + frame);
    const sourceSvgPath = resolveWithin(args.acceptedRun, probe.artifacts.svg.path);
    const sourcePngPath = resolveWithin(args.acceptedRun, probe.artifacts.png.path);
    const svgBytes = await fs.promises.readFile(sourceSvgPath);
    const pngBytes = await fs.promises.readFile(sourcePngPath);
    assert.equal(HASH(svgBytes), probe.artifacts.svg.sha256, 'accepted SVG hash mismatch at F' + frame);
    assert.equal(HASH(pngBytes), probe.determinism.pngSha256, 'accepted PNG hash mismatch at F' + frame);

    const prefix = 'issue711-root:' + acceptedReceipt.hierarchy.sceneRootSymbolName + '@' + frame + '/layer-0-frame-20/';
    const nested = probe.nestedSelections.filter((selection) => selection.sourceAddress.startsWith(prefix));
    assert.equal(nested.length, 1, 'missing held Play Once nested Graphic evidence at F' + frame);
    assert.equal(nested[0].playbackMode, 'play once');
    assert.equal(nested[0].childFrameCount, 11);
    assert.equal(nested[0].selectedChildFrameIndex, frame - TARGET_FRAMES[0],
      'nested child Graphic does not advance one child frame per root frame');

    frameInputs.push({
      frame,
      status: probe.status,
      sourceSvgPath,
      sourceSvgSha256: probe.artifacts.svg.sha256,
      sourcePngPath,
      sourcePngSha256: probe.determinism.pngSha256,
      sourcePngDimensions: readPngDimensions(pngBytes, 'accepted #711 PNG F' + frame),
      composition: probe.composition,
      nestedChildFrame: nested[0].selectedChildFrameIndex,
    });
  }
  assert.equal(new Set(frameInputs.map((frame) => frame.sourcePngSha256)).size, TARGET_FRAMES.length,
    'accepted #711 states contain duplicate neighboring PNGs');

  for (const frame of [20, 21, 22, 25]) {
    assert.equal(acceptedReceipt.controls[frame].matchesAcceptedOutput, true,
      'accepted #711 control does not match at F' + frame);
  }

  const classifier = require(path.join(ROOT, 'src/main/services/fla-recovery-classifier.js'));
  const classification = classifier.classifyForFlaRecovery(sourceBytes);
  const normalized = classifier.normalizeRecoveryCandidate(sourceBytes, classification);
  if (classification.state === classifier.STATES.RECOVERY_CANDIDATE) {
    assert.equal(normalized.applied, true, 'bounded FLA recovery normalization did not apply');
  } else {
    assert.equal(classification.state, classifier.STATES.STRICT_VALID, 'source FLA failed bounded archive classification');
    assert.equal(normalized.applied, false);
  }
  const archiveBytes = normalized.applied ? normalized.bytes : sourceBytes;
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const zip = await JSZip.loadAsync(archiveBytes);
  const documentEntry = zip.file('DOMDocument.xml');
  assert.ok(documentEntry, 'normalized FLA is missing DOMDocument.xml');
  const documentXml = await documentEntry.async('string');
  const documentAttributes = tagAttributes(parseTag(documentXml, 'DOMDocument'));
  const frameRate = parseDecimalRational(documentAttributes.frameRate, 'DOMDocument frameRate');
  const width = Number(documentAttributes.width);
  const height = Number(documentAttributes.height);
  assert.ok(Number.isSafeInteger(width) && width > 0, 'DOMDocument width is invalid');
  assert.ok(Number.isSafeInteger(height) && height > 0, 'DOMDocument height is invalid');
  assert.equal(frameRate.numerator, 30, 'Issue #712 source FLA is no longer 30 FPS');
  assert.equal(frameRate.denominator, 1);
  assert.equal(width, 1920);
  assert.equal(height, 1080);

  const rootSymbolName = acceptedReceipt.hierarchy.sceneRootSymbolName;
  const rootSymbolEntry = zip.file('LIBRARY/' + rootSymbolName + '.xml');
  assert.ok(rootSymbolEntry, 'source FLA is missing the accepted root Graphic library item');
  const rootSymbolXml = await rootSymbolEntry.async('string');
  const rootSymbolAttributes = tagAttributes(parseTag(rootSymbolXml, 'DOMSymbolItem'));
  assert.equal(rootSymbolAttributes.name, rootSymbolName);
  assert.equal(rootSymbolAttributes.symbolType, 'graphic');
  const rootTimelineAttributes = tagAttributes(parseTag(rootSymbolXml, 'DOMTimeline'));

  return {
    sourceBytes,
    sourceSha256,
    acceptedReceipt,
    frameInputs,
    sourceCensus: {
      originalSha256: sourceSha256,
      archiveClassification: classification.state,
      normalization: normalized.applied
        ? {
          applied: true,
          field: normalized.field,
          deltaBytes: normalized.deltaBytes,
          mode: normalized.mode,
          originalBytesWritten: normalized.originalBytesWritten,
          normalizedArchiveSha256: HASH(archiveBytes),
        }
        : { applied: false, mode: 'strict-valid' },
      documentWidth: width,
      documentHeight: height,
      frameRate,
      rootGraphic: {
        name: rootSymbolName,
        symbolType: rootSymbolAttributes.symbolType,
        frameCount: acceptedReceipt.hierarchy.frameCount,
        timelineName: rootTimelineAttributes.name || rootSymbolName,
        currentFrame: Number(rootTimelineAttributes.currentFrame),
        frames: TARGET_FRAMES,
      },
      childGraphicPlayback: {
        layerIndex: 0,
        mode: 'play once',
        childFrameCount: 11,
        selectedFrames: frameInputs.map((frame) => frame.nestedChildFrame),
        changesCadence: false,
      },
    },
  };
}

async function writeFrames(args, rasterizer, sourceCensus, frameInputs, matteColor) {
  const outputFrames = [];
  for (const frame of frameInputs) {
    const acceptedSvg = await fs.promises.readFile(frame.sourceSvgPath, 'utf8');
    const fullStageSvg = reframeSvgToStage(
      acceptedSvg,
      frame,
      sourceCensus.documentWidth,
      sourceCensus.documentHeight,
      matteColor,
    );
    const firstRaster = await rasterizer.render(
      fullStageSvg,
      sourceCensus.documentWidth,
      sourceCensus.documentHeight,
    );
    const repeatedRaster = await rasterizer.render(
      fullStageSvg,
      sourceCensus.documentWidth,
      sourceCensus.documentHeight,
    );
    assert.equal(firstRaster.width, sourceCensus.documentWidth);
    assert.equal(firstRaster.height, sourceCensus.documentHeight);
    assert.equal(HASH(repeatedRaster.pngBytes), HASH(firstRaster.pngBytes),
      'repeated production raster differs at F' + frame.frame);

    const svgArtifact = await writeNewVerified(
      path.join(args.out, 'stage-frame-' + frame.frame + '.svg'),
      Buffer.from(fullStageSvg, 'utf8'),
    );
    const pngBytes = Buffer.from(firstRaster.pngBytes);
    assert.deepEqual(readPngDimensions(pngBytes, 'stage PNG F' + frame.frame), {
      width: sourceCensus.documentWidth,
      height: sourceCensus.documentHeight,
    });
    const pngArtifact = await writeNewVerified(
      path.join(args.out, 'clip-frame-' + frame.frame + '.png'),
      pngBytes,
    );
    outputFrames.push({
      frame: frame.frame,
      status: frame.status,
      sourceTimeOffset: formatRational({
        numerator: (frame.frame - TARGET_FRAMES[0]) * sourceCensus.frameRate.denominator,
        denominator: sourceCensus.frameRate.numerator,
      }),
      sourceAcceptedSvg: { path: frame.sourceSvgPath, sha256: frame.sourceSvgSha256 },
      sourceAcceptedPng: {
        path: frame.sourcePngPath,
        sha256: frame.sourcePngSha256,
        dimensions: frame.sourcePngDimensions,
      },
      stageSvg: svgArtifact,
      stagePng: pngArtifact,
      stagePngRepeatedRasterIdentical: true,
      nestedChildFrame: frame.nestedChildFrame,
    });
  }
  return outputFrames;
}

async function run(args) {
  assertExternalDirectory(args.out);
  assert.ok(!fs.existsSync(args.out), 'refusing to overwrite existing acceptance directory: ' + args.out);
  assert.ok(fs.existsSync(args.source), 'primary source FLA does not exist');
  assert.ok(fs.existsSync(args.acceptedRun), 'accepted #711 run directory does not exist');
  assert.ok(fs.existsSync(args.ffprobePath), 'ffprobe executable does not exist: ' + args.ffprobePath);
  await fs.promises.mkdir(args.out, { recursive: true });

  const source = await readSourceAndAcceptedFrames(args);
  const sourceCensus = source.sourceCensus;
  const frameRate = sourceCensus.frameRate;
  const clipDuration = {
    numerator: TARGET_FRAMES.length * frameRate.denominator,
    denominator: frameRate.numerator,
  };
  const reducedDurationDivisor = gcd(clipDuration.numerator, clipDuration.denominator);
  clipDuration.numerator /= reducedDurationDivisor;
  clipDuration.denominator /= reducedDurationDivisor;
  const sourceStart = {
    numerator: TARGET_FRAMES[0] * frameRate.denominator,
    denominator: frameRate.numerator,
  };
  const reducedStartDivisor = gcd(sourceStart.numerator, sourceStart.denominator);
  sourceStart.numerator /= reducedStartDivisor;
  sourceStart.denominator /= reducedStartDivisor;
  const matteColor = '#ffffff';
  const trackTimescale = frameRate.numerator * 1000;
  assert.ok(Number.isSafeInteger(trackTimescale) && trackTimescale > 0 && trackTimescale <= 0xffffffff,
    'source FPS cannot be represented in a 32-bit MP4 track timescale');

  const rasterizer = createResearchRasterizer();
  let outputFrames;
  try {
    outputFrames = await writeFrames(args, rasterizer, sourceCensus, source.frameInputs, matteColor);
  } finally {
    rasterizer.close();
  }

  const ffmpegPath = args.ffmpegPath;
  const inputPattern = path.join(args.out, 'clip-frame-%02d.png');
  const clipPath = path.join(args.out, 'issue712-f20-f25-30fps.mp4');
  const repeatPath = path.join(args.out, 'repeat-check.mp4');
  await runChild(ffmpegPath, ffmpegArgs(inputPattern, frameRate, clipPath, trackTimescale), 'FFmpeg clip encode');
  const probe = await probeVideo(
    args.ffprobePath,
    clipPath,
    frameRate,
    sourceCensus.documentWidth,
    sourceCensus.documentHeight,
  );
  await runChild(ffmpegPath, ffmpegArgs(inputPattern, frameRate, repeatPath, trackTimescale), 'FFmpeg repeat encode');
  const repeatProbe = await probeVideo(
    args.ffprobePath,
    repeatPath,
    frameRate,
    sourceCensus.documentWidth,
    sourceCensus.documentHeight,
  );
  assert.deepEqual(repeatProbe, probe, 'repeated encode probe metadata differs');

  const clipBytes = await fs.promises.readFile(clipPath);
  const repeatBytes = await fs.promises.readFile(repeatPath);
  const clipSha256 = HASH(clipBytes);
  const repeatClipSha256 = HASH(repeatBytes);
  const repeatByteIdentical = clipSha256 === repeatClipSha256;
  if (repeatByteIdentical) await fs.promises.unlink(repeatPath);

  const sourceSha256After = HASH(await fs.promises.readFile(args.source));
  assert.equal(sourceSha256After, source.sourceSha256, 'source FLA changed during clip reconstruction');
  const receipt = {
    schemaVersion: 'issue712-short-clip-reconstruction/1',
    issue: 'https://github.com/Cognitive-Architect/panda-stage/issues/712',
    motherPullRequest: 'https://github.com/Cognitive-Architect/panda-stage/pull/677',
    prerequisite: {
      issue: 'https://github.com/Cognitive-Architect/panda-stage/issues/711',
      state: 'CLOSED',
      acceptance: 'The current Issue #711 body records Gate C HUMAN CONTINUITY PASS, CI PASS, and Code review PASS.',
      acceptedRunDirectory: args.acceptedRun,
    },
    source: {
      path: args.source,
      originalSha256: source.sourceSha256,
      originalSha256After: sourceSha256After,
      sourceHashInvariant: sourceSha256After === source.sourceSha256,
      archiveClassification: sourceCensus.archiveClassification,
      normalization: sourceCensus.normalization,
    },
    gate0: {
      classification: 'GO',
      sourceCensus,
      sourceStartFrame: TARGET_FRAMES[0],
      sourceStartTime: {
        rationalSeconds: formatRational(sourceStart),
        seconds: numberForRational(sourceStart),
      },
      frameCount: TARGET_FRAMES.length,
      perFrameDuration: {
        rationalSeconds: formatRational({
          numerator: frameRate.denominator,
          denominator: frameRate.numerator,
        }),
        seconds: frameRate.denominator / frameRate.numerator,
      },
      expectedClipDuration: {
        rationalSeconds: formatRational(clipDuration),
        seconds: numberForRational(clipDuration),
      },
      uniformCadence: true,
    },
    gateA: {
      acceptedStateSequenceReused: true,
      exactOrder: TARGET_FRAMES,
      statuses: EXPECTED_STATUSES,
      clipFrameCount: outputFrames.length,
      noAdditionalFrames: true,
      sourceTimingDerived: true,
    },
    gateB: {
      clip: {
        path: path.basename(clipPath),
        sha256: clipSha256,
        byteLength: clipBytes.length,
        ...probe,
      },
      frameTimingManifest: outputFrames,
      encoding: {
        format: 'MP4',
        codec: 'H.264/libx264',
        quality: 'CRF 18',
        pixelFormat: 'yuv420p',
        whiteMatte: matteColor,
        dimensions: sourceCensus.documentWidth + 'x' + sourceCensus.documentHeight,
        frameRate: formatRational(frameRate),
        trackTimescale: trackTimescale,
        audio: 'none',
        scaling: 'none; SVG coordinates use the source document stage viewBox 0 0 width height',
        interpolation: 'none; one accepted state per source frame, -vsync 0, no filters, no output -r',
        frameDuplication: 'none',
        frameOrder: 'F20 -> F21 -> F22 -> F23 -> F24 -> F25',
      },
      determinism: {
        repeatedStageRasterBytesIdentical: true,
        repeatedClipProbeIdentical: true,
        repeatedClipSha256: repeatClipSha256,
        repeatedClipBytesIdentical: repeatByteIdentical,
        repeatFileRemovedAfterHashing: repeatByteIdentical,
      },
      sourceFrameEvidenceRetained: true,
    },
    gateC: {
      sourceReference: 'Pending maintainer selection/confirmation of the approved source or material-site animation for motion review.',
      maintainerMotionResult: 'PENDING_MAINTAINER',
      cadence: 'PENDING_MAINTAINER',
      continuity: 'PENDING_MAINTAINER',
      effectTiming: 'PENDING_MAINTAINER',
    },
    clipFrameSvgStagePngMutation: 'NO',
    sourceMutation: 'NO',
    fixtureSpecificProductionBranch: 'NO',
    movieClipRuntimeAdded: 'NO',
    scriptExecutionAdded: 'NO',
    playbackUiAdded: 'NO',
    result: 'CLIP_READY_FOR_HUMAN_MOTION_REVIEW',
  };
  const receiptPath = path.join(args.out, 'completion-receipt.json');
  await writeNewVerified(receiptPath, Buffer.from(JSON.stringify(receipt, null, 2) + '\n', 'utf8'));
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
}

const args = parseArgs(process.argv.slice(2));
run(args).then(
  () => app.quit(),
  (error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    app.quit();
    process.exitCode = 1;
  },
);
