const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');
const { AudioClipService } = require('../dist-electron/domain/services/AudioClipService.js');
const { ProjectService } = require('../dist-electron/main/services/ProjectService.js');
const { registerProjectIpcHandlers } = require('../dist-electron/main/ipc/register-project-ipc-handlers.js');
const example = require('../demo-project/project-v1.example.json');

let window;
let unregister;
let temporaryRoot;
const timeout = setTimeout(() => {
  console.error('A01 Electron verifier timed out.');
  app.exit(1);
}, 45000);

async function run() {
  temporaryRoot = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-a01-electron-'));
  app.setPath('userData', path.join(temporaryRoot, 'user-data'));
  await app.whenReady();
  const root = path.join(temporaryRoot, 'audio.pandastage');
  await fs.mkdir(root);
  const current = migrateProject(example);
  const legacy = { ...current, schemaVersion: 7, shots: current.shots.map((shot) => ({ ...shot,
    audioClips: shot.audioClips.map(({ role, ...clip }) => { void role; return clip; }),
  })) };
  await fs.writeFile(path.join(root, 'project.json'), JSON.stringify(legacy));
  window = new BrowserWindow({ show: false, webPreferences: {
    preload: path.resolve(__dirname, '../dist-electron/preload/index.js'),
    sandbox: true, contextIsolation: true, nodeIntegration: false,
  } });
  unregister = registerProjectIpcHandlers({ getMainWindow: () => window, projectService: new ProjectService() });
  await window.loadURL('data:text/html,<title>A01 IPC verifier</title>');
  const open = () => window.webContents.executeJavaScript(`window.pandaStage.project.open({projectRoot:${JSON.stringify(root)}})`);
  const migrated = await open();
  assert.equal(migrated.ok, true);
  assert.equal(migrated.value.sourceVersion, 7);
  assert.equal(migrated.value.project.schemaVersion, 8);
  assert.deepEqual(migrated.value.project.shots[0].audioClips, legacy.shots[0].audioClips.map((clip) => ({ ...clip, role: 'dialogue' })));
  const service = new AudioClipService();
  const shotId = migrated.value.project.shots[0].id;
  const assetId = migrated.value.project.shots[0].audioClips[0].assetId;
  let project = service.create(migrated.value.project, { shotId, assetId, role: 'bgm', startMs: 100 });
  project = service.create(project, { shotId, assetId, role: 'sfx', startMs: 400 });
  const clipId = project.shots[0].audioClips.at(-1).id;
  project = service.trimStart(project, { shotId, clipId, startMs: 700 });
  project = service.setVolume(project, { shotId, clipId, volume: 1.8 });
  const save = await window.webContents.executeJavaScript(`window.pandaStage.project.save(${JSON.stringify({ projectRoot: root, project, revision: 1 })})`);
  assert.equal(save.ok, true);
  const reopened = await open();
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.value.project.shots[0].audioClips, project.shots[0].audioClips);
  assert.equal(reopened.value.migrated, false);
  const invalid = structuredClone(project);
  invalid.shots[0].audioClips.at(-1).role = 'music';
  const rejected = await window.webContents.executeJavaScript(`(async()=>{try{await window.pandaStage.project.save(${JSON.stringify({ projectRoot: root, project: invalid, revision: 2 })});return false;}catch{return true;}})()`);
  assert.equal(rejected, true);
  const disk = JSON.parse(await fs.readFile(path.join(root, 'project.json'), 'utf8'));
  assert.deepEqual(disk, project);
  assert.ok(!JSON.stringify(disk).includes('selectedAudioClipId'));
  console.log('PASS A01: sandboxed Preload/Main IPC, v7→v8, dialogue/bgm/sfx, gain=1.8, save/reopen, invalid-role rejection.');
}

run().then(async () => {
  clearTimeout(timeout);
  unregister?.();
  window?.destroy();
  // Each target is an explicitly created per-run temporary directory.
  await fs.rm(temporaryRoot, { recursive: true, force: true });
  app.exit(0);
}).catch(async (error) => {
  clearTimeout(timeout);
  console.error(error);
  unregister?.();
  window?.destroy();
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
  app.exit(1);
});
