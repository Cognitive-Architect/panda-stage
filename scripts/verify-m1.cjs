const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  AutosaveService,
} = require('../dist-electron/main/services/AutosaveService.js');
const {
  ProjectFileSystemService,
} = require('../dist-electron/main/services/ProjectFileSystemService.js');
const {
  ProjectOperationCoordinator,
} = require('../dist-electron/main/services/ProjectOperationCoordinator.js');
const {
  ProjectService,
} = require('../dist-electron/main/services/ProjectService.js');
const {
  RecentProjectsService,
} = require('../dist-electron/main/services/RecentProjectsService.js');
const {
  RecoveryService,
} = require('../dist-electron/main/services/RecoveryService.js');
const {
  UnsavedCloseController,
} = require('../dist-electron/main/services/UnsavedCloseController.js');

const evidenceDirectory = path.join(__dirname, '../docs/evidence/m1');
const resultsPath = path.join(evidenceDirectory, 'results.json');
const logPath = path.join(evidenceDirectory, 'lifecycle.log');
const samplePath = path.join(
  evidenceDirectory,
  'project-final.example.json',
);
const PROJECT_ID = '15000000-0000-4000-8000-000000000001';
const SUBTITLE_ID = '15000000-0000-4000-8000-000000000002';
const ASSET_ID = '15000000-0000-4000-8000-000000000003';
const RECOVERY_TIME_MS = 4_102_444_800_000;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function hashFile(filePath) {
  return sha256(await readFile(filePath));
}

async function recoveryArtifacts(projectRoot) {
  const directory = path.join(projectRoot, 'recovery');
  return readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
}

async function temporaryArtifacts(projectRoot) {
  const rootNames = await readdir(projectRoot);
  const recoveryNames = await recoveryArtifacts(projectRoot);
  return [...rootNames, ...recoveryNames].filter((name) =>
    name.endsWith('.tmp'),
  );
}

async function rendererFileSystemMatches(directory) {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await rendererFileSystemMatches(entryPath)));
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/u.test(entry.name)) continue;
    const source = await readFile(entryPath, 'utf8');
    if (
      /(?:from\s+|require\()['"](?:node:)?(?:fs|path|child_process)['"]/u.test(
        source,
      )
    ) {
      matches.push(path.relative(process.cwd(), entryPath));
    }
  }
  return matches;
}

function git(...arguments_) {
  return execFileSync('git', arguments_, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  }).trim();
}

async function runGate() {
  const operations = [];
  const parent = await mkdtemp(path.join(os.tmpdir(), 'panda-m1-gate-'));
  const originalRoot = path.join(
    parent,
    '熊猫 项目 生命周期 🐼.pandastage',
  );
  const movedRoot = path.join(
    parent,
    '已移动 熊猫 项目 🐼.pandastage',
  );
  const projectFile = () => path.join(originalRoot, 'project.json');
  const movedProjectFile = () => path.join(movedRoot, 'project.json');
  const configPath = path.join(
    parent,
    '应用 配置',
    'recent-projects.json',
  );
  const inertClock = {
    setInterval: () => 1,
    clearInterval: () => undefined,
  };
  const coordinator = new ProjectOperationCoordinator();
  let autosave = null;
  const recovery = new RecoveryService({
    nowMs: () => RECOVERY_TIME_MS,
  });
  const projects = new ProjectService({
    coordinator,
    now: () => new Date('2026-07-24T08:00:00.000Z'),
    createId: (() => {
      const ids = [PROJECT_ID, SUBTITLE_ID];
      return () => ids.shift();
    })(),
    onProjectSaved: async (projectRoot, project, revision) => {
      await recovery.cleanupAfterFormalSave(projectRoot, project.id);
      if (revision !== undefined) {
        autosave?.markFormalSaved(projectRoot, project, revision);
      }
    },
  });
  const recent = new RecentProjectsService({
    configurationFilePath: configPath,
    now: () => new Date('2026-07-24T08:30:00.000Z'),
  });

  try {
    const created = await projects.create(originalRoot, {
      name: 'M1 熊猫项目',
    });
    operations.push('create:PASS');
    await recent.record(created);

    const relativeAssetPath = 'assets/角色 图片 🐼.png';
    await writeFile(
      path.join(originalRoot, relativeAssetPath),
      'M1-relative-asset',
      'utf8',
    );
    const savedProject = {
      ...created.project,
      name: 'M1 已保存项目',
      assets: [
        {
          id: ASSET_ID,
          kind: 'image',
          name: '角色 图片',
          relativePath: relativeAssetPath,
          mimeType: 'image/png',
          width: 128,
          height: 128,
        },
      ],
      updatedAt: '2026-07-24T08:10:00.000Z',
    };
    await projects.save(originalRoot, savedProject, 1);
    const savedHash = await hashFile(projectFile());
    const reopened = await projects.open(originalRoot);
    assert.deepEqual(reopened.project, savedProject);
    operations.push('modify-save-close-reopen:PASS');

    const failingProjects = new ProjectService({
      coordinator,
      fileSystem: new ProjectFileSystemService({
        afterTemporarySync: () => {
          throw Object.assign(new Error('Injected M1 atomic-save fault.'), {
            code: 'EIO',
          });
        },
      }),
    });
    await assert.rejects(
      failingProjects.save(originalRoot, {
        ...savedProject,
        name: '不得写入正式文件',
      }),
      (error) => error.code === 'SAVE_FAILED',
    );
    assert.equal(await hashFile(projectFile()), savedHash);
    assert.deepEqual(await temporaryArtifacts(originalRoot), []);
    operations.push('atomic-save-fault-preserves-hash:PASS');

    autosave = new AutosaveService({
      recoveryService: recovery,
      coordinator,
      clock: inertClock,
    });
    autosave.track({
      projectRoot: originalRoot,
      project: savedProject,
      dirty: false,
      revision: 1,
    });
    const recoveredProject = {
      ...savedProject,
      name: 'M1 异常退出恢复内容',
      updatedAt: '2026-07-24T08:20:00.000Z',
    };
    autosave.update({
      projectRoot: originalRoot,
      project: recoveredProject,
      dirty: true,
      revision: 2,
    });
    await autosave.tick(originalRoot);
    await autosave.stop(originalRoot);
    const hashBeforeRestore = await hashFile(projectFile());
    assert.equal(hashBeforeRestore, savedHash);

    const restartedRecovery = new RecoveryService();
    const candidate = await restartedRecovery.detectLatest(
      originalRoot,
      savedProject,
    );
    assert(candidate);
    const restored = await restartedRecovery.restore(
      originalRoot,
      candidate.recoveryFilePath,
      savedProject.id,
    );
    assert.deepEqual(restored.project, recoveredProject);
    await restartedRecovery.ignore(
      originalRoot,
      candidate.recoveryFilePath,
      savedProject.id,
    );
    assert.equal(await hashFile(projectFile()), savedHash);
    assert.equal((await recoveryArtifacts(originalRoot)).length, 1);
    operations.push('crash-detect-restore-ignore-formal-unchanged:PASS');

    await rename(originalRoot, movedRoot);
    assert.equal(
      (await recent.list())[0].status,
      'missing',
    );
    const moved = await projects.open(movedRoot);
    const movedCandidate = await restartedRecovery.detectLatest(
      movedRoot,
      moved.project,
    );
    assert(movedCandidate);
    const relocated = await recent.relocate(originalRoot, moved);
    assert.equal(relocated[0].status, 'available');
    assert.equal(relocated[0].projectRoot, path.resolve(movedRoot));
    assert.equal(
      await readFile(path.join(movedRoot, relativeAssetPath), 'utf8'),
      'M1-relative-asset',
    );
    assert.equal(path.isAbsolute(relativeAssetPath), false);
    assert.equal(relativeAssetPath.includes('..'), false);
    operations.push('unicode-move-relocate-relative-asset-recovery:PASS');

    autosave = new AutosaveService({
      recoveryService: recovery,
      coordinator,
      clock: inertClock,
    });
    autosave.track({
      projectRoot: movedRoot,
      project: moved.project,
      dirty: false,
      revision: 2,
    });
    autosave.update({
      projectRoot: movedRoot,
      project: recoveredProject,
      dirty: true,
      revision: 3,
    });
    const saveController = new UnsavedCloseController({
      getDirtyProject: () => autosave.getDirtyProjectSnapshot(),
      prompt: async () => 'save',
      save: (snapshot) =>
        projects.save(
          snapshot.projectRoot,
          snapshot.project,
          snapshot.revision,
        ),
      discard: (snapshot) =>
        autosave.discard(snapshot.projectRoot, snapshot.project.id),
      reportSaveFailure: () => undefined,
      reportDiscardFailure: () => undefined,
    });
    assert.equal(await saveController.requestClose(), 'allow-close');
    assert.equal((await recoveryArtifacts(movedRoot)).length, 0);
    assert.deepEqual(
      (await projects.open(movedRoot)).project,
      recoveredProject,
    );
    operations.push('close-save-cleans-recovery:PASS');

    const discardProject = {
      ...recoveredProject,
      name: 'M1 明确放弃的修改',
      updatedAt: '2026-07-24T08:25:00.000Z',
    };
    autosave.update({
      projectRoot: movedRoot,
      project: discardProject,
      dirty: true,
      revision: 4,
    });
    await autosave.tick(movedRoot);
    const hashBeforeCancelDiscard = await hashFile(movedProjectFile());
    const cancelController = new UnsavedCloseController({
      getDirtyProject: () => autosave.getDirtyProjectSnapshot(),
      prompt: async () => 'cancel',
      save: () => Promise.resolve(),
      discard: () => Promise.resolve(),
      reportSaveFailure: () => undefined,
      reportDiscardFailure: () => undefined,
    });
    assert.equal(await cancelController.requestClose(), 'cancelled');
    assert.equal((await recoveryArtifacts(movedRoot)).length, 1);

    const discardController = new UnsavedCloseController({
      getDirtyProject: () => autosave.getDirtyProjectSnapshot(),
      prompt: async () => 'discard',
      save: () => Promise.resolve(),
      discard: (snapshot) =>
        autosave.discard(snapshot.projectRoot, snapshot.project.id),
      reportSaveFailure: () => undefined,
      reportDiscardFailure: () => undefined,
    });
    assert.equal(await discardController.requestClose(), 'allow-close');
    assert.equal(await hashFile(movedProjectFile()), hashBeforeCancelDiscard);
    assert.deepEqual(await recoveryArtifacts(movedRoot), []);
    assert.deepEqual(await temporaryArtifacts(movedRoot), []);
    assert.equal(
      await restartedRecovery.detectLatest(movedRoot, recoveredProject),
      null,
    );
    operations.push('close-cancel-retains-discard-cleans:PASS');

    const invalidRoot = path.join(
      parent,
      '损坏 项目 🐼.pandastage',
    );
    await mkdir(invalidRoot);
    const invalidPath = path.join(invalidRoot, 'project.json');
    const invalidBytes = '{"schemaVersion":1,';
    await writeFile(invalidPath, invalidBytes, 'utf8');
    await assert.rejects(
      projects.open(invalidRoot),
      (error) => error.code === 'INVALID_JSON',
    );
    assert.equal(await readFile(invalidPath, 'utf8'), invalidBytes);
    operations.push('invalid-project-read-only:PASS');

    const rendererMatches = await rendererFileSystemMatches(
      path.join(__dirname, '../src/renderer'),
    );
    assert.deepEqual(rendererMatches, []);
    const finalDocument = await projects.open(movedRoot);
    const finalSerialized = await readFile(movedProjectFile(), 'utf8');
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(samplePath, finalSerialized, 'utf8');

    const results = {
      gate: 'M1 Project Lifecycle',
      workOrder: 'B-15/45',
      result: 'PASS',
      branch: git('branch', '--show-current'),
      baselineSha: 'b47877c0d3df3eff1dba8ec6509430638314da49',
      testedSha: git('rev-parse', 'HEAD'),
      executedAt: new Date().toISOString(),
      environment: {
        platform: process.platform,
        node: process.version,
      },
      lifecycle: {
        unicodeAndSpaces: true,
        createSaveCloseReopen: true,
        formalHashAfterSave: savedHash,
        formalHashBeforeRestore: hashBeforeRestore,
        recoveryDidNotOverwriteFormal:
          hashBeforeRestore === savedHash,
        recoveryDetectedAfterRestart: true,
        recoveryMovedWithProject: true,
        recentOldPathStatus: 'missing',
        recentRelocatedStatus: 'available',
        relativeAssetPath,
        relativeAssetReadableAfterMove: true,
        cancelRetainedRecovery: true,
        discardRemovedRecovery: true,
        temporaryArtifactsAfterFaultAndDiscard: 0,
        finalProjectId: finalDocument.project.id,
      },
      atomicSave: {
        injectedFailureCode: 'SAVE_FAILED',
        beforeSha256: savedHash,
        afterSha256: savedHash,
        oldFormalFilePreserved: true,
      },
      architecture: {
        rendererFileSystemMatches: rendererMatches,
        recentConfigOutsideProject:
          !path.resolve(configPath).startsWith(path.resolve(movedRoot)),
        persistedAssetPathsAreRelative: true,
      },
      inheritedEvidence: {
        gateA: 'docs/test-receipts/GATE-A.md',
        day11: 'docs/test-receipts/DAY-11.md',
        day12: 'docs/test-receipts/DAY-12.md',
        day13: 'docs/test-receipts/DAY-13.md',
        day14: 'docs/test-receipts/DAY-14.md',
        recoveryUi: 'docs/evidence/day-13/ui-results.json',
        recentAndCloseUi: 'docs/evidence/day-14/ui-results.json',
      },
      operations,
    };
    await writeFile(
      resultsPath,
      `${JSON.stringify(results, null, 2)}\n`,
      'utf8',
    );
    await writeFile(logPath, `${operations.join('\n')}\n`, 'utf8');
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await autosave?.stopAll().catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
}

runGate().catch(async (error) => {
  await mkdir(evidenceDirectory, { recursive: true });
  const failure = {
    gate: 'M1 Project Lifecycle',
    workOrder: 'B-15/45',
    result: 'FAIL',
    executedAt: new Date().toISOString(),
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  };
  await writeFile(
    resultsPath,
    `${JSON.stringify(failure, null, 2)}\n`,
    'utf8',
  );
  console.error(error);
  process.exitCode = 1;
});
