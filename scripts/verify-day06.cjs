const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  registerIpcHandlers,
} = require('../dist-electron/main/ipc/register-ipc-handlers.js');
const {
  HiddenWindowManager,
} = require('../dist-electron/main/windows/hidden-window-manager.js');
const {
  ExportService,
} = require('../dist-electron/main/services/ExportService.js');
const {
  FileSystemService,
} = require('../dist-electron/main/services/FileSystemService.js');

app.on('window-all-closed', () => {});

function inspectPng(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error(`Invalid PNG signature: ${signature}`);
  }
  return {
    signature,
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.byteLength,
  };
}

async function inspectExport(fileSystem, result, evidenceDirectory) {
  const files = await fileSystem.listFrameFiles(result.outputDirectory);
  const expected = Array.from(
    { length: result.totalFrames },
    (_, index) => `frame_${String(index).padStart(6, '0')}.png`,
  );
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    throw new Error(`Frame sequence is not continuous for Job ${result.jobId}.`);
  }

  const indices = [0, Math.floor(files.length / 2), files.length - 1];
  const samples = [];
  for (const index of indices) {
    const fileName = files[index];
    const source = path.join(result.outputDirectory, fileName);
    const buffer = await fs.readFile(source);
    const inspection = inspectPng(buffer);
    if (inspection.width !== 1_920 || inspection.height !== 1_080) {
      throw new Error(`Unexpected dimensions for ${fileName}.`);
    }
    samples.push({ fileName, ...inspection });
    if (evidenceDirectory) {
      await fs.copyFile(source, path.join(evidenceDirectory, fileName));
    }
  }
  if (new Set(samples.map((sample) => sample.sha256)).size < 2) {
    throw new Error('Sampled frames are unexpectedly identical.');
  }
  return { count: files.length, first: files[0], last: files.at(-1), samples };
}

async function runControlledWriteFailure(hidden, fileSystem) {
  const failingFileSystem = {
    createJobDirectory: fileSystem.createJobDirectory.bind(fileSystem),
    listFrameFiles: fileSystem.listFrameFiles.bind(fileSystem),
    cleanupJobDirectory: fileSystem.cleanupJobDirectory.bind(fileSystem),
    writeFrame: async (directory, fileName, bytes) => {
      if (fileName === 'frame_000004.png') {
        throw new Error('simulated controlled write failure');
      }
      return fileSystem.writeFrame(directory, fileName, bytes);
    },
  };
  let message = null;
  try {
    await new ExportService(hidden, failingFileSystem).runProbe({
      durationMs: 3_000,
      fps: 24,
    });
  } catch (error) {
    message = error.message;
  }
  if (!message || !message.includes('simulated controlled write failure')) {
    throw new Error(`Controlled write failure was not propagated: ${message}`);
  }
  return message;
}

async function runVerification() {
  const hidden = new HiddenWindowManager();
  const removeIpcHandlers = registerIpcHandlers({
    getMainWindow: () => null,
    getHiddenWindow: () => hidden.getWindow(),
    markHiddenReady: (senderId) => hidden.markReady(senderId),
    markProbeLoaded: (senderId, payload) => hidden.markProbeLoaded(senderId, payload),
    markFrameReady: (senderId, payload) => hidden.markFrameReady(senderId, payload),
    markFrameFailed: (senderId, payload) => hidden.markFrameFailed(senderId, payload),
  });
  const verificationRoot = path.join(
    os.tmpdir(),
    'panda-stage',
    `day06-verification-${process.pid}-${Date.now()}`,
  );
  const evidenceDirectory = path.resolve(__dirname, '../docs/evidence/day-06');
  const fileSystem = new FileSystemService(verificationRoot);
  const service = new ExportService(hidden, fileSystem);
  const completedDirectories = [];

  try {
    await fs.mkdir(evidenceDirectory, { recursive: true });
    await hidden.create();

    if (process.env.DAY06_FAILURE_ONLY === '1') {
      const message = await runControlledWriteFailure(hidden, fileSystem);
      const entries = await fs.readdir(verificationRoot);
      if (entries.length !== 0) {
        throw new Error('Failure-only verification left a temporary directory.');
      }
      console.log(JSON.stringify({ message, partialDirectoryRemoved: true }, null, 2));
      return;
    }

    const first = await service.runProbe({ durationMs: 3_000, fps: 24 });
    completedDirectories.push(first.outputDirectory);
    const firstInspection = await inspectExport(fileSystem, first, evidenceDirectory);
    console.log(`Day 06 progress: first 3s Job completed in ${first.elapsedMs}ms.`);

    const second = await service.runProbe({ durationMs: 3_000, fps: 24 });
    completedDirectories.push(second.outputDirectory);
    const secondInspection = await inspectExport(fileSystem, second, null);
    console.log(`Day 06 progress: second 3s Job completed in ${second.elapsedMs}ms.`);

    const fiveSecond = await service.runProbe({ durationMs: 5_000, fps: 24 });
    completedDirectories.push(fiveSecond.outputDirectory);
    const fiveSecondInspection = await inspectExport(fileSystem, fiveSecond, null);
    console.log(`Day 06 progress: 5s Job completed in ${fiveSecond.elapsedMs}ms.`);

    const writeFailure = await runControlledWriteFailure(hidden, fileSystem);

    const rootEntriesAfterFailure = await fs.readdir(verificationRoot);
    if (rootEntriesAfterFailure.length !== completedDirectories.length) {
      throw new Error('Failed Job left an unexpected temporary directory.');
    }

    const result = {
      configuration: { fps: 24, maxPendingFrames: 3 },
      firstThreeSecond: { ...first, inspection: firstInspection },
      secondThreeSecond: { ...second, inspection: secondInspection },
      fiveSecond: { ...fiveSecond, inspection: fiveSecondInspection },
      writeFailure: {
        message: writeFailure,
        partialDirectoryRemoved: true,
      },
      resourceObservation: {
        firstHeapDelta: first.memory.heapUsedEnd - first.memory.heapUsedStart,
        secondHeapDelta: second.memory.heapUsedEnd - second.memory.heapUsedStart,
        firstRssDelta: first.memory.rssEnd - first.memory.rssStart,
        secondRssDelta: second.memory.rssEnd - second.memory.rssStart,
      },
    };
    await fs.writeFile(
      path.join(evidenceDirectory, 'results.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    for (const directory of completedDirectories) {
      await fileSystem.cleanupJobDirectory(directory);
    }
    await fs.rm(verificationRoot, { recursive: true, force: true });
    removeIpcHandlers();
    hidden.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (BrowserWindow.getAllWindows().length !== 0) {
    throw new Error('Day 06 verification left BrowserWindows open.');
  }
}

app
  .whenReady()
  .then(runVerification)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
