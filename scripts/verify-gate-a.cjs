const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const releaseDirectory = path.join(root, 'release');
const unpackedDirectory = path.join(releaseDirectory, 'win-unpacked');
const executablePath = path.join(unpackedDirectory, 'Panda Stage.exe');
const resourcesDirectory = path.join(unpackedDirectory, 'resources');
const ffmpegPath = path.join(resourcesDirectory, 'media', 'ffmpeg.exe');
const ffprobePath = path.join(resourcesDirectory, 'media', 'ffprobe.exe');
const evidenceDirectory = path.join(root, 'docs', 'evidence', 'gate-a');
const outputRoot = path.join(evidenceDirectory, '打包输出 中文 空格 🐼');
const missingRoot = path.join(evidenceDirectory, '资源缺失负向测试');
const keyFrames = [0, 24, 48, 71];

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      ...options,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) =>
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }),
    );
  });
}

async function hashFile(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function isolatedEnvironment(extra) {
  const environment = { ...process.env, ...extra };
  delete environment.PANDA_STAGE_FFMPEG_PATH;
  delete environment.PANDA_STAGE_FFPROBE_PATH;
  delete environment.PANDA_STAGE_PROBE_AUDIO_PATH;
  delete environment.NODE_PATH;
  environment.Path = `${process.env.SystemRoot || 'C:\\Windows'}\\System32`;
  environment.PATH = environment.Path;
  return environment;
}

async function extractRgb(mediaPath, frameIndex) {
  const result = await run(ffmpegPath, [
    '-v',
    'error',
    '-i',
    mediaPath,
    '-vf',
    `select=eq(n\\,${frameIndex})`,
    '-vsync',
    '0',
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]);
  if (result.code !== 0) {
    throw new Error(`Keyframe extraction failed: ${result.stderr.toString('utf8')}`);
  }
  const expectedBytes = 1_920 * 1_080 * 3;
  if (result.stdout.length !== expectedBytes) {
    throw new Error(`Frame ${frameIndex} has ${result.stdout.length} RGB bytes; expected ${expectedBytes}.`);
  }
  return result.stdout;
}

function pixelDifference(left, right) {
  let changedPixels = 0;
  const pixels = left.length / 3;
  for (let offset = 0; offset < left.length; offset += 3) {
    if (
      left[offset] !== right[offset] ||
      left[offset + 1] !== right[offset + 1] ||
      left[offset + 2] !== right[offset + 2]
    ) {
      changedPixels += 1;
    }
  }
  return { changedPixels, pixels, ratio: changedPixels / pixels };
}

async function findInstaller() {
  const entries = await fs.readdir(releaseDirectory);
  const name = entries.find((entry) => /^Panda-Stage-.*-Windows-x64\.exe$/u.test(entry));
  if (!name) throw new Error('Windows NSIS installer was not produced.');
  return path.join(releaseDirectory, name);
}

async function main() {
  await fs.access(executablePath);
  await fs.access(ffmpegPath);
  await fs.access(ffprobePath);
  const installerPath = await findInstaller();
  await fs.rm(evidenceDirectory, { recursive: true, force: true });
  await fs.mkdir(evidenceDirectory, { recursive: true });

  const packagedRun = await run(executablePath, [], {
    cwd: unpackedDirectory,
    env: isolatedEnvironment({
      PANDA_STAGE_GATE_A: '1',
      PANDA_STAGE_GATE_A_OUTPUT: outputRoot,
    }),
  });
  if (packagedRun.code !== 0) {
    throw new Error(`Packaged Gate exited ${packagedRun.code}: ${packagedRun.stderr.toString('utf8')}`);
  }
  const packagedReportPath = path.join(outputRoot, 'packaged-gate-results.json');
  try {
    await fs.access(packagedReportPath);
  } catch (error) {
    const gateErrorPath = path.join(outputRoot, 'packaged-gate-error.json');
    const gateError = await fs.readFile(gateErrorPath, 'utf8').catch(() => null);
    throw new Error(
      `Packaged Gate did not produce a PASS report: ${gateError || error.message}`,
      { cause: error },
    );
  }
  const packaged = JSON.parse(await fs.readFile(packagedReportPath, 'utf8'));
  if (packaged.status !== 'PASS' || packaged.packaged !== true || packaged.runs.length !== 3) {
    throw new Error('Packaged report did not contain three successful production runs.');
  }
  const normalizedResources = path.resolve(resourcesDirectory).toLowerCase();
  for (const resourcePath of [
    packaged.resourcePaths.ffmpegPath,
    packaged.resourcePaths.ffprobePath,
    packaged.resourcePaths.audioProbePath,
  ]) {
    if (!path.resolve(resourcePath).toLowerCase().startsWith(`${normalizedResources}${path.sep}`)) {
      throw new Error(`Packaged resource escaped resources directory: ${resourcePath}`);
    }
  }
  if (new Set(packaged.runs.map((entry) => entry.configHash)).size !== 1) {
    throw new Error('Packaged runs did not share one project/config hash.');
  }

  const comparisons = [];
  const decoded = new Map();
  for (const runEntry of packaged.runs) {
    for (const frameIndex of keyFrames) {
      decoded.set(`${runEntry.index}:${frameIndex}`, await extractRgb(runEntry.outputPath, frameIndex));
    }
  }
  for (const frameIndex of keyFrames) {
    for (const rightRun of [2, 3]) {
      const difference = pixelDifference(
        decoded.get(`1:${frameIndex}`),
        decoded.get(`${rightRun}:${frameIndex}`),
      );
      if (difference.ratio >= 0.01) {
        throw new Error(`Frame ${frameIndex} run 1/run ${rightRun} difference is ${difference.ratio}.`);
      }
      comparisons.push({ frameIndex, leftRun: 1, rightRun, ...difference });
    }
  }

  const ffprobeReports = [];
  for (const runEntry of packaged.runs) {
    const probe = await run(ffprobePath, [
      '-v',
      'error',
      '-count_frames',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      runEntry.outputPath,
    ]);
    if (probe.code !== 0) throw new Error(probe.stderr.toString('utf8'));
    const parsed = JSON.parse(probe.stdout.toString('utf8'));
    const video = parsed.streams.find((stream) => stream.codec_type === 'video');
    const audio = parsed.streams.find((stream) => stream.codec_type === 'audio');
    if (Number(video.nb_read_frames) !== 72 || video.codec_name !== 'h264' || audio.codec_name !== 'aac') {
      throw new Error(`Run ${runEntry.index} ffprobe mismatch.`);
    }
    ffprobeReports.push({ run: runEntry.index, video, audio, format: parsed.format });
  }

  const missingRun = await run(executablePath, [], {
    cwd: unpackedDirectory,
    env: isolatedEnvironment({
      PANDA_STAGE_GATE_A: '1',
      PANDA_STAGE_GATE_A_FORCE_MISSING_MEDIA: '1',
      PANDA_STAGE_GATE_A_OUTPUT: missingRoot,
    }),
  });
  if (missingRun.code === 0) throw new Error('Missing-resource packaged run unexpectedly passed.');
  const missingReport = JSON.parse(
    await fs.readFile(path.join(missingRoot, 'packaged-gate-error.json'), 'utf8'),
  );
  if (!/packaged resource is missing.*Reinstall/iu.test(missingReport.message)) {
    throw new Error(`Missing-resource error is not actionable: ${missingReport.message}`);
  }

  const runArtifacts = [];
  for (const runEntry of packaged.runs) {
    const stats = await fs.stat(runEntry.outputPath);
    runArtifacts.push({
      run: runEntry.index,
      path: path.relative(root, runEntry.outputPath),
      bytes: stats.size,
      sha256: await hashFile(runEntry.outputPath),
    });
  }
  const result = {
    status: 'PASS',
    execution: {
      executable: path.relative(root, executablePath),
      packaged: true,
      developmentServerUsed: false,
      isolatedPath: `${process.env.SystemRoot || 'C:\\Windows'}\\System32`,
      globalNodePnpmFfmpegRequired: false,
    },
    artifacts: {
      installer: {
        path: path.relative(root, installerPath),
        sha256: await hashFile(installerPath),
      },
      unpackedExecutable: {
        path: path.relative(root, executablePath),
        sha256: await hashFile(executablePath),
      },
      ffmpeg: { path: path.relative(root, ffmpegPath), sha256: await hashFile(ffmpegPath) },
      ffprobe: { path: path.relative(root, ffprobePath), sha256: await hashFile(ffprobePath) },
      runs: runArtifacts,
    },
    packaged,
    ffprobeReports,
    keyframeComparisons: comparisons,
    missingResource: { exitCode: missingRun.code, ...missingReport },
  };
  await fs.writeFile(
    path.join(evidenceDirectory, 'results.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify({
    status: result.status,
    installer: result.artifacts.installer,
    runs: result.artifacts.runs,
    maximumKeyframeDifference: Math.max(...comparisons.map((entry) => entry.ratio)),
    missingResource: result.missingResource,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
