const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..');
const sourceSha = 'c6c356f660001af694bb706cc7553974ff8d1cfc';
const runName = 'issue838-export-performance-' + new Date().toISOString().replace(/[:.]/gu, '-') + '-' + process.pid;
const acceptanceRoot = path.join('D:\\PandaStage-Acceptance', runName);
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
const parent = spawnSync('git', ['rev-parse', 'HEAD^'], { cwd: repoRoot, encoding: 'utf8' });
const trackedDiff = spawnSync('git', ['diff', '--quiet', 'HEAD', '--'], { cwd: repoRoot, stdio: 'ignore' });
if (
  head.status !== 0 ||
  (head.stdout.trim() !== sourceSha && (parent.status !== 0 || parent.stdout.trim() !== sourceSha))
) {
  throw new Error('Expected pinned source ' + sourceSha + ' at HEAD or its direct parent.');
}
if (trackedDiff.status !== 0) throw new Error('Tracked worktree changes exist; refusing to launch.');
if (process.platform !== 'win32') throw new Error('This diagnostic requires Windows Electron.');
if (fs.existsSync(acceptanceRoot)) throw new Error('Acceptance run directory already exists: ' + acceptanceRoot);
for (const requiredPath of [
  path.join(repoRoot, 'dist-electron', 'main', 'index.js'),
  path.join(repoRoot, 'dist', 'renderer', 'index.html'),
]) {
  if (!fs.existsSync(requiredPath)) throw new Error('Built app missing; run pnpm build first: ' + requiredPath);
}
const fragmentText = fs.readFileSync(path.join(__dirname, 'issue838-perf-runtime.fragments'), 'utf8');
const fragments = new Map();
let fragmentName = null;
for (const line of fragmentText.split(/\r?\n/u)) {
  const marker = line.match(/^@@ ([A-Z0-9_]+)$/u);
  if (marker) {
    fragmentName = marker[1];
    fragments.set(fragmentName, []);
  } else if (fragmentName) fragments.get(fragmentName).push(line);
}
function fragment(name) {
  if (!fragments.has(name)) throw new Error('Missing runtime fragment: ' + name);
  return fragments.get(name).join('\n').replace(/\s+$/u, '');
}
function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error('Expected one exact verifier anchor for ' + label);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}
const verifierPath = path.join(repoRoot, 'scripts', 'verify-issue819-dl02.cjs');
let runtime = fs.readFileSync(verifierPath, 'utf8').replace(/\r\n/gu, '\n');
runtime = replaceOnce(runtime, "const { existsSync } = require('node:fs');",
  "const { existsSync, statfsSync } = require('node:fs');\nconst os = require('node:os');", 'OS sampling imports');
runtime = replaceOnce(runtime,
  "const issue836R2PathSuccessMode = process.env.PANDA_STAGE_ISSUE836_R2_PATH_SUCCESS === '1';",
  "const issue836R2PathSuccessMode = process.env.PANDA_STAGE_ISSUE836_R2_PATH_SUCCESS === '1';\nconst issue838PerfMode = process.env.PANDA_STAGE_ISSUE838_PERF === '1';",
  'Issue #838 mode flag');
runtime = replaceOnce(runtime, 'const formalCommitRecords = [];', fragment('GLOBAL_DIAGNOSTICS'), 'timing state');
runtime = replaceOnce(runtime, 'function controlledGate() {',
  fragment('SHORT_PROJECT') + '\n\nfunction controlledGate() {', 'short fixture');
runtime = replaceOnce(runtime,
  "  const mediaAdapter = new FFmpegAdapter({ ffmpegPath: mediaTools.ffmpegPath, ffprobePath: mediaTools.ffprobePath });\n  const encodePngSequence",
  fragment('PROBE_TIMERS'), 'probe timers');
runtime = replaceOnce(runtime, '      return await encodePngSequence(request, signal);',
  fragment('ENCODE_TIMER'), 'encode timer');
runtime = replaceOnce(runtime, '    if (!replaceDialogueSourceBeforeNextMix) return muxAudioMix(request, signal);',
  fragment('MUX_TIMER'), 'audio mux timer');
runtime = replaceOnce(runtime, '  exportFileSystem = new class extends FileSystemService {\n    async commitFormalOutputNoReplace',
  fragment('CLEANUP_TIMER'), 'cleanup timer');
runtime = replaceOnce(runtime, '      await super.commitFormalOutputNoReplace(stagingPath, outputPath);',
  fragment('COMMIT_TIMER'), 'commit timer');
runtime = replaceOnce(runtime, '        handle = exportService.startFormalExport(\n          input,',
  fragment('JOB_START'), 'Job start');
runtime = replaceOnce(runtime, '      formalStarts.at(-1).jobId = handle.jobId;',
  fragment('JOB_COMPLETION'), 'Job completion result');
runtime = replaceOnce(runtime,
  "    startAction = 'quick-action-export';\n    await clickSelector('[data-testid=\"quick-action-export\"]');",
  "    startAction = 'quick-action-export';\n    if (issue838PerfMode) issue838Perf.clickAt = performance.now();\n    await clickSelector('[data-testid=\"quick-action-export\"]');",
  'UI click timer');
const tick = String.fromCharCode(96);
const completionWaitAnchor =
  '  await waitForRenderer(' + tick + "['completed', 'failed'].includes(" + '$' + '{taskStatus})' +
  tick + ', completionTimeoutMs);';
runtime = replaceOnce(runtime, completionWaitAnchor,
  completionWaitAnchor + '\n  if (issue838PerfMode) issue838Perf.uiCompletedAt = performance.now();',
  'UI completion timer');
runtime = replaceOnce(runtime,
  "  fixtureProject = ProjectSchema.parse(JSON.parse(await fsp.readFile(path.join(fixture.projectRoot, 'project.json'), 'utf8')));\n  if (dl05FollowupMode) {",
  fragment('FIXTURE_RETIMER'), 'fixture retimer');
runtime = replaceOnce(runtime,
  "  assert(!(issue836R2PathBoundaryMode || issue836R2PathSuccessMode) || (dl04Mode && dl04SampleId === 1), 'Issue #836 R2 path mode requires the single Issue #827 sample 1 Creator UI fixture.');",
  "  assert(!(issue836R2PathBoundaryMode || issue836R2PathSuccessMode) || (dl04Mode && dl04SampleId === 1), 'Issue #836 R2 path mode requires the single Issue #827 sample 1 Creator UI fixture.');\n  assert(!issue838PerfMode || (dl04Mode && dl04SampleId === 1), 'Issue #838 requires generated Issue #827 sample 1.');",
  'fixture mode guard');
runtime = replaceOnce(runtime, '  if (issue836R2PathSuccessMode) {\n    const pathLimit = 259;',
  fragment('DIAGNOSTIC_BRANCH') + '\n  if (issue836R2PathSuccessMode) {\n    const pathLimit = 259;',
  'bounded one-export branch');
runtime = replaceOnce(runtime,
  "      assert(fixtureProject.shots.reduce((total, shot) => total + shot.durationMs, 0) === 30_000, 'Issue #827/832 fixture must be 30 seconds long.');",
  "      assert(issue838PerfMode || fixtureProject.shots.reduce((total, shot) => total + shot.durationMs, 0) === 30_000, 'Issue #827/832 fixture must be 30 seconds long.');",
  'short fixture duration guard');
runtime = replaceOnce(runtime,
  "      assert(fixtureProject.shots.every((shot) => shot.durationMs >= 9_000), 'Issue #827/832 fixture Shots must each be long enough to cross a global frame boundary.');",
  "      assert(issue838PerfMode || fixtureProject.shots.every((shot) => shot.durationMs >= 9_000), 'Issue #827/832 fixture Shots must each be long enough to cross a global frame boundary.');",
  'short fixture shot guard');

fs.mkdirSync(acceptanceRoot, { recursive: false });
const runtimePath = path.join(__dirname, '.issue838-runtime-' + process.pid + '-' + randomUUID() + '.cjs');
fs.writeFileSync(runtimePath, runtime, { flag: 'wx' });
const electronPath = require('electron');
if (typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
  fs.unlinkSync(runtimePath);
  throw new Error('Could not resolve installed Electron.');
}
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) if (key.startsWith('PANDA_STAGE_ISSUE')) delete childEnv[key];
childEnv.PANDA_STAGE_ISSUE827_DL04 = '1';
childEnv.PANDA_STAGE_ISSUE827_SAMPLE = '1';
childEnv.PANDA_STAGE_ISSUE827_ROOT = acceptanceRoot;
childEnv.PANDA_STAGE_ISSUE836_SOURCE_SHA = sourceSha;
childEnv.PANDA_STAGE_ISSUE838_PERF = '1';
const child = spawn(electronPath, [runtimePath], {
  cwd: repoRoot, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
});
const stdoutChunks = [];
const stderrChunks = [];
child.stdout.setEncoding('utf8').on('data', (chunk) => { stdoutChunks.push(chunk); process.stdout.write(chunk); });
child.stderr.setEncoding('utf8').on('data', (chunk) => { stderrChunks.push(chunk); process.stderr.write(chunk); });
child.once('error', (error) => fs.writeFileSync(
  path.join(acceptanceRoot, 'launcher-error.txt'), String(error.stack ?? error),
));
child.once('close', (exitCode, signal) => {
  try {
    fs.writeFileSync(path.join(acceptanceRoot, 'electron-stdout.log'), stdoutChunks.join(''), 'utf8');
    fs.writeFileSync(path.join(acceptanceRoot, 'electron-stderr.log'), stderrChunks.join(''), 'utf8');
    const runDirectory = fs.readdirSync(acceptanceRoot).filter((name) => name.startsWith('run-'))
      .map((name) => path.join(acceptanceRoot, name)).sort().at(-1) ?? null;
    const evidenceDirectory = runDirectory ? path.join(runDirectory, 'evidence') : null;
    const receiptPath = evidenceDirectory
      ? path.join(evidenceDirectory, 'issue838-export-performance-receipt.json') : null;
    fs.writeFileSync(path.join(acceptanceRoot, 'launcher-receipt.json'), JSON.stringify({
      issue: 838, sourceCommitSha: sourceSha, exitCode, signal,
      status: exitCode === 0 ? 'COMPLETED' : 'STOP_OR_PARTIAL',
      runDirectory,
      receiptPath: receiptPath && fs.existsSync(receiptPath) ? receiptPath : null,
      stdoutPath: path.join(acceptanceRoot, 'electron-stdout.log'),
      stderrPath: path.join(acceptanceRoot, 'electron-stderr.log'),
    }, null, 2), 'utf8');
    process.exitCode = exitCode ?? 1;
  } finally {
    try { fs.unlinkSync(runtimePath); } catch {}
  }
});
