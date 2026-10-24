const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function deriveIssue844FixedProjectBackgroundEvidence(project, projectRoot, readFile = (filePath) => fsp.readFile(filePath)) {
  const { createHash: createProjectHash } = require('node:crypto');
  const assertProject = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const projectHash = (bytes) => createProjectHash('sha256').update(bytes).digest('hex');
  const resolvedProjectRoot = path.resolve(projectRoot);
  const backgrounds = await Promise.all(project.shots.map(async (shot, shotIndex) => {
    const layer = shot.layers.find((candidate) => candidate.id === shot.backgroundLayerId);
    const assetId = layer?.source.kind === 'asset' ? layer.source.assetId : null;
    const asset = assetId ? project.assets.find((candidate) => candidate.id === assetId) : null;
    if (!layer || !asset || asset.kind !== 'image') {
      throw new Error(`Shot ${shotIndex} has no persisted image background asset.`);
    }
    const absoluteAssetPath = path.resolve(resolvedProjectRoot, asset.relativePath);
    const relativeAssetPath = path.relative(resolvedProjectRoot, absoluteAssetPath);
    if (!relativeAssetPath || relativeAssetPath === '..' || relativeAssetPath.startsWith('..' + path.sep) || path.isAbsolute(relativeAssetPath)) {
      throw new Error(`Shot ${shotIndex} background path escapes its fixed Project root.`);
    }
    const actualSha256 = projectHash(await readFile(absoluteAssetPath));
    assertProject(actualSha256 === asset.sha256, `Persisted asset ${assetId} does not match its Project SHA-256.`);
    return {
      shotIndex,
      shotId: shot.id,
      backgroundLayerId: shot.backgroundLayerId,
      assetId,
      relativePath: asset.relativePath,
      sha256: actualSha256,
    };
  }));

  assertProject(project.shots.length === 3 && backgrounds.length === 3, 'Issue #844 fixed Project must have exactly three Shot backgrounds.');
  for (const field of ['shotId', 'backgroundLayerId', 'assetId', 'relativePath', 'sha256']) {
    assertProject(new Set(backgrounds.map((entry) => entry[field])).size === backgrounds.length, `Issue #844 Shot backgrounds must have distinct ${field} values.`);
  }
  return backgrounds;
}

function readAssetManifest(project, projectRoot) {
  assert(Array.isArray(project.assets) && project.assets.length === 10, 'Issue #844 frozen Project must contain exactly ten assets.');
  const manifest = project.assets.map((asset) => {
    const absoluteAssetPath = path.resolve(projectRoot, asset.relativePath);
    const relativeAssetPath = path.relative(path.resolve(projectRoot), absoluteAssetPath);
    assert(relativeAssetPath && relativeAssetPath !== '..' && !relativeAssetPath.startsWith('..' + path.sep) && !path.isAbsolute(relativeAssetPath), `Asset path escapes its fixed Project root: ${asset.relativePath}`);
    const bytes = fs.readFileSync(absoluteAssetPath);
    const actualSha256 = sha256(bytes);
    assert(actualSha256 === asset.sha256, `Asset ${asset.id} does not match its declared SHA-256.`);
    return { assetId: asset.id, relativePath: asset.relativePath, sha256: actualSha256 };
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  assert(new Set(manifest.map((asset) => asset.assetId)).size === manifest.length, 'Issue #844 frozen Project asset IDs are not distinct.');
  assert(new Set(manifest.map((asset) => asset.relativePath)).size === manifest.length, 'Issue #844 frozen Project asset paths are not distinct.');
  return manifest;
}

function loadExistingProjectPersistenceFingerprint(fileSystem = fsp) {
  const verifierPath = path.join(__dirname, 'verify-issue819-dl02.cjs');
  const verifierSource = fs.readFileSync(verifierPath, 'utf8').replace(/\r\n/gu, '\n');
  const startMarker = 'async function projectPersistenceFingerprint(project, projectRoot) {';
  const endMarker = '\n}\n\nfunction installProjectFixtureIpc()';
  const start = verifierSource.indexOf(startMarker);
  const end = start < 0 ? -1 : verifierSource.indexOf(endMarker, start);
  assert(start >= 0 && end >= 0, 'Could not locate the existing projectPersistenceFingerprint implementation.');
  const source = verifierSource.slice(start, end + 2);
  return new Function('fsp', 'path', 'hash', 'assert', `${source}\nreturn projectPersistenceFingerprint;`)(
    fileSystem,
    path,
    sha256,
    assert,
  );
}

async function expectFingerprintFailure(fingerprint, label, project, projectRoot) {
  try {
    await fingerprint(project, projectRoot);
  } catch (error) {
    return { label, result: 'REJECTED', error: String(error.message ?? error) };
  }
  throw new Error(`Negative case was accepted: ${label}`);
}

function projectAndAssetState(projectRoot, project, assetManifest) {
  const projectBytes = fs.readFileSync(path.join(projectRoot, 'project.json'));
  const assets = assetManifest.map((asset) => ({
    ...asset,
    sha256: sha256(fs.readFileSync(path.join(projectRoot, asset.relativePath))),
  }));
  return {
    projectJsonSha256: sha256(projectBytes),
    assetManifest: assets,
    projectAssetCount: project.assets.length,
  };
}

function requireAcceptancePath(candidate, label) {
  const acceptanceBase = path.resolve('D:\\PandaStage-Acceptance');
  const resolved = path.resolve(candidate);
  const relative = path.relative(acceptanceBase, resolved);
  assert(relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)), `${label} must stay under D:\\PandaStage-Acceptance.`);
  assert(fs.statSync(resolved).isDirectory(), `${label} does not exist or is not a directory: ${resolved}`);
  return resolved;
}

async function runOfflinePreflight({ aRoot, bRoot, acceptanceRoot }) {
  assert(aRoot && bRoot && acceptanceRoot, 'Offline preflight requires A root, B root, and a new receipt root.');
  const aProjectRoot = requireAcceptancePath(aRoot, 'A fixed Project');
  const bProjectRoot = requireAcceptancePath(bRoot, 'B fixed Project');
  const resolvedAcceptanceRoot = path.resolve(acceptanceRoot);
  const acceptanceRelative = path.relative(path.resolve('D:\\PandaStage-Acceptance'), resolvedAcceptanceRoot);
  assert(acceptanceRelative && !acceptanceRelative.startsWith('..' + path.sep) && !path.isAbsolute(acceptanceRelative), 'Preflight receipt root must be a new child of D:\\PandaStage-Acceptance.');
  assert(!fs.existsSync(resolvedAcceptanceRoot), `Preflight receipt root already exists: ${resolvedAcceptanceRoot}`);
  assert(aProjectRoot !== bProjectRoot, 'A and B must be independent Project copies.');
  assert(fs.realpathSync(aProjectRoot) !== fs.realpathSync(bProjectRoot), 'A and B resolve to the same physical Project directory.');

  const diagnosticSource = fs.readFileSync(path.join(__dirname, 'issue843-perf-diagnostic.cjs'), 'utf8');
  const verifierPath = path.join(__dirname, 'verify-issue819-dl02.cjs');
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');
  assert(diagnosticSource.includes('deriveIssue844FixedProjectBackgroundEvidence.toString()'), 'Fixed Project background adapter is not wired into the generated runtime.');
  assert(diagnosticSource.includes('fixture.backgroundEvidence = await deriveIssue844FixedProjectBackgroundEvidence(fixtureProject, fixture.projectRoot);'), 'Fixed Project background evidence is not derived after Project load.');
  assert(!diagnosticSource.includes('backgroundEvidence: []'), 'Fixed Project background evidence still has an empty placeholder.');
  assert(verifierSource.includes("assert(JSON.stringify(preExportPersistenceFingerprint.backgrounds.map((entry) => ({ shotId: entry.shotId, assetId: entry.assetId, sha256: entry.sha256 }))) === JSON.stringify(fixture.backgroundEvidence.map((entry) => ({ shotId: entry.shotId, assetId: entry.assetId, sha256: entry.sha256 }))), 'Project background references or bytes changed before formal export.');"), 'The existing pre-export fingerprint guard is missing or was changed.');

  const aProjectBytes = fs.readFileSync(path.join(aProjectRoot, 'project.json'));
  const bProjectBytes = fs.readFileSync(path.join(bProjectRoot, 'project.json'));
  assert(aProjectBytes.equals(bProjectBytes), 'A and B project.json bytes differ before preflight.');
  const aProject = JSON.parse(aProjectBytes.toString('utf8'));
  const bProject = JSON.parse(bProjectBytes.toString('utf8'));
  assert(JSON.stringify(aProject) === JSON.stringify(bProject), 'A and B parsed Project values differ.');
  const aAssetManifest = readAssetManifest(aProject, aProjectRoot);
  const bAssetManifest = readAssetManifest(bProject, bProjectRoot);
  assert(JSON.stringify(aAssetManifest) === JSON.stringify(bAssetManifest), 'A and B ten-asset manifests differ.');
  for (const asset of aAssetManifest) {
    assert(
      fs.readFileSync(path.join(aProjectRoot, asset.relativePath)).equals(fs.readFileSync(path.join(bProjectRoot, asset.relativePath))),
      `A and B asset bytes differ: ${asset.relativePath}`,
    );
  }

  const before = {
    A: projectAndAssetState(aProjectRoot, aProject, aAssetManifest),
    B: projectAndAssetState(bProjectRoot, bProject, bAssetManifest),
  };
  assert(before.A.projectJsonSha256 === before.B.projectJsonSha256, 'A and B project.json SHA-256 values differ.');
  const fingerprint = loadExistingProjectPersistenceFingerprint();
  const aBackgroundEvidence = await deriveIssue844FixedProjectBackgroundEvidence(aProject, aProjectRoot);
  const bBackgroundEvidence = await deriveIssue844FixedProjectBackgroundEvidence(bProject, bProjectRoot);
  const aFingerprint = await fingerprint(aProject, aProjectRoot);
  const bFingerprint = await fingerprint(bProject, bProjectRoot);
  const guardProjection = (entries) => entries.map(({ shotId, assetId, sha256: assetSha256 }) => ({ shotId, assetId, sha256: assetSha256 }));
  assert(JSON.stringify(guardProjection(aFingerprint.backgrounds)) === JSON.stringify(guardProjection(aBackgroundEvidence)), 'A adapter evidence does not satisfy the existing pre-export guard projection.');
  assert(JSON.stringify(guardProjection(bFingerprint.backgrounds)) === JSON.stringify(guardProjection(bBackgroundEvidence)), 'B adapter evidence does not satisfy the existing pre-export guard projection.');
  assert(JSON.stringify(aBackgroundEvidence) === JSON.stringify(bBackgroundEvidence), 'A and B derived background evidence differs.');

  const missingBackgroundProject = structuredClone(bProject);
  missingBackgroundProject.shots[0].backgroundLayerId = 'missing-background-layer';
  const missingBackground = await expectFingerprintFailure(fingerprint, 'missing-background', missingBackgroundProject, bProjectRoot);

  const firstBackground = bBackgroundEvidence[0];
  const replacedBytesFileSystem = {
    readFile: async (filePath, ...args) => {
      const bytes = await fsp.readFile(filePath, ...args);
      if (path.resolve(filePath) !== path.resolve(bProjectRoot, firstBackground.relativePath)) return bytes;
      const replaced = Buffer.from(bytes);
      replaced[0] ^= 0xff;
      return replaced;
    },
  };
  const replacedAssetFingerprint = loadExistingProjectPersistenceFingerprint(replacedBytesFileSystem);
  const replacedAsset = await expectFingerprintFailure(replacedAssetFingerprint, 'replaced-asset-bytes', bProject, bProjectRoot);

  const incorrectHashProject = structuredClone(bProject);
  const incorrectHashAsset = incorrectHashProject.assets.find((asset) => asset.id === firstBackground.assetId);
  assert(incorrectHashAsset, 'Could not find the first background asset for the incorrect-hash negative case.');
  incorrectHashAsset.sha256 = '0'.repeat(64);
  const incorrectDeclaredHash = await expectFingerprintFailure(fingerprint, 'incorrect-declared-sha256', incorrectHashProject, bProjectRoot);

  const after = {
    A: projectAndAssetState(aProjectRoot, aProject, aAssetManifest),
    B: projectAndAssetState(bProjectRoot, bProject, bAssetManifest),
  };
  assert(JSON.stringify(before) === JSON.stringify(after), 'A/B project.json or asset bytes changed during offline preflight.');

  return {
    status: 'OFFLINE_FIXED_PROJECT_PREFLIGHT_PASS',
    A: {
      root: aProjectRoot,
      projectJsonSha256Before: before.A.projectJsonSha256,
      projectJsonSha256After: after.A.projectJsonSha256,
    },
    B: {
      root: bProjectRoot,
      projectJsonSha256Before: before.B.projectJsonSha256,
      projectJsonSha256After: after.B.projectJsonSha256,
    },
    assetCount: aAssetManifest.length,
    assets: aAssetManifest.map((asset, index) => ({
      assetId: asset.assetId,
      relativePath: asset.relativePath,
      aSha256Before: before.A.assetManifest[index].sha256,
      aSha256After: after.A.assetManifest[index].sha256,
      bSha256Before: before.B.assetManifest[index].sha256,
      bSha256After: after.B.assetManifest[index].sha256,
    })),
    backgrounds: aBackgroundEvidence,
    negatives: [missingBackground, replacedAsset, incorrectDeclaredHash],
    projectAndAssetBytesUnchanged: true,
    existingFingerprintImplementationExecuted: true,
    existingGuardProjectionPassed: true,
    adapterWiredIntoGeneratedRuntime: true,
    electronSpawned: false,
    formalExportJobStarted: false,
    receiptRootCreated: false,
  };
}

async function main() {
  const result = await runOfflinePreflight({
    aRoot: process.env.PANDA_STAGE_ISSUE844_PREFLIGHT_A_ROOT,
    bRoot: process.env.PANDA_STAGE_ISSUE844_PREFLIGHT_B_ROOT,
    acceptanceRoot: process.env.PANDA_STAGE_ISSUE844_ACCEPTANCE_ROOT,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { deriveIssue844FixedProjectBackgroundEvidence, runOfflinePreflight };
