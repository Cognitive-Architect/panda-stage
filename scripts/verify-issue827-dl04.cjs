const { app } = require('electron');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const path = require('node:path');

const baseDirectory = path.resolve(
  process.env.PANDA_STAGE_ISSUE827_ROOT ?? 'D:\\PandaStage-Acceptance\\issue827-dl04',
);
const sampleId = Number(process.env.PANDA_STAGE_ISSUE827_SAMPLE ?? '0');

if (sampleId === 1 || sampleId === 2) {
  process.env.PANDA_STAGE_ISSUE827_DL04 = '1';
  process.env.PANDA_STAGE_ISSUE827_SAMPLE = String(sampleId);
  process.env.PANDA_STAGE_ISSUE827_ROOT = baseDirectory;
  require('./verify-issue819-dl02.cjs');
} else {
  const runChild = (id) => new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PANDA_STAGE_ISSUE827_DL04: '1',
      PANDA_STAGE_ISSUE827_SAMPLE: String(id),
      PANDA_STAGE_ISSUE827_ROOT: path.join(baseDirectory, `sample-${id}`),
    };
    const child = spawn(process.execPath, [__filename], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve({ sampleId: id, stdout: stdout.trim(), stderr: stderr.trim() })
      : reject(new Error(`Issue #827 sample ${id} exited ${code}: ${stderr.trim() || stdout.trim()}`)));
  });

  async function findReceipt(sampleRoot) {
    const directories = await fsp.readdir(sampleRoot, { withFileTypes: true }).catch(() => []);
    const candidates = directories
      .filter((item) => item.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of candidates) {
      const receiptPath = path.join(sampleRoot, entry.name, 'acceptance-receipt.json');
      try {
        return { path: receiptPath, receipt: JSON.parse(await fsp.readFile(receiptPath, 'utf8')) };
      } catch {
        // Keep searching the remaining generated run directories.
      }
    }
    throw new Error(`Issue #827 sample receipt was not written under ${sampleRoot}.`);
  }

  async function main() {
    await fsp.mkdir(baseDirectory, { recursive: true });
    const children = [];
    for (const id of [1, 2]) children.push(await runChild(id));
    const first = await findReceipt(path.join(baseDirectory, 'sample-1'));
    const second = await findReceipt(path.join(baseDirectory, 'sample-2'));
    if (first.receipt.auto !== 'PASS' || second.receipt.auto !== 'PASS') {
      throw new Error('Both Issue #827 Windows Electron samples must report AUTO PASS.');
    }
    const firstOutput = Object.values(first.receipt.outputs)[0];
    const secondOutput = Object.values(second.receipt.outputs)[0];
    if (!firstOutput || !secondOutput || firstOutput.sha256 === secondOutput.sha256) {
      throw new Error('The two distinct Issue #827 Project exports must have different MP4 SHA-256 hashes.');
    }
    const combined = {
      issue: 827,
      workOrder: 'DL-04 whole-Project multi-shot export',
      completedAt: new Date().toISOString(),
      auto: 'PASS',
      owner: 'NOT_ATTESTED',
      samples: [
        { sampleId: 1, receiptPath: first.path, receipt: first.receipt },
        { sampleId: 2, receiptPath: second.path, receipt: second.receipt },
      ],
      electronChildren: children,
      ownerReview: 'DEFERRED_TO_DL07',
    };
    const receiptPath = path.join(baseDirectory, 'combined-acceptance-receipt.json');
    await fsp.writeFile(receiptPath, JSON.stringify(combined, null, 2), 'utf8');
    console.log(`PASS #827 DL-04 two-Project Windows Electron acceptance: ${receiptPath}`);
    app.quit();
  }

  main().catch((error) => {
    console.error(error.stack ?? error);
    app.exit(1);
  });
}
