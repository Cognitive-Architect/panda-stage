const { createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { formalFrameCount, iterateFormalProjectFrameSchedule } = require('../dist-electron/shared/export-types.js');
const { mapProjectTime } = require('../dist-electron/domain/selectors/projectTime.js');
const { generateIssue827Fixture } = require('./issue819-fixtures.cjs');

const baseDirectory = path.resolve(
  process.env.PANDA_STAGE_ISSUE827_ROOT ?? 'D:\\PandaStage-Acceptance\\issue827-dl04-fixtures',
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function writeSampleEvidence(fixture, sampleId) {
  const projectPath = path.join(fixture.projectRoot, 'project.json');
  const projectBytes = await fsp.readFile(projectPath);
  const assets = await Promise.all(fixture.project.assets.map(async (asset) => {
    const bytes = await fsp.readFile(path.join(fixture.projectRoot, asset.relativePath));
    return {
      assetId: asset.id,
      kind: asset.kind,
      relativePath: asset.relativePath,
      sha256: hash(bytes),
      byteLength: bytes.length,
    };
  }));
  let shotStartMs = 0;
  const shotPrefixes = fixture.project.shots.map((shot, shotIndex) => {
    const row = { shotIndex, shotId: shot.id, name: shot.name, startMs: shotStartMs, durationMs: shot.durationMs, endMs: shotStartMs + shot.durationMs };
    shotStartMs += shot.durationMs;
    return row;
  });
  const frames = Array.from(iterateFormalProjectFrameSchedule(fixture.project));
  const receipt = {
    issue: 827,
    sampleId,
    projectPath,
    projectSha256: hash(projectBytes),
    totalDurationMs: shotStartMs,
    frameCount: formalFrameCount(shotStartMs),
    shotPrefixes,
    assetHashes: assets,
    backgrounds: fixture.backgroundEvidence,
    audioMap: fixture.audioMixFixture.mappedClips,
    frames,
  };
  await fsp.writeFile(path.join(fixture.evidenceRoot, 'generated-project-receipt.json'), JSON.stringify(receipt, null, 2), 'utf8');
  return { root: fixture.root, projectRoot: fixture.projectRoot, evidenceRoot: fixture.evidenceRoot, projectSha256: receipt.projectSha256, shotPrefixes, backgrounds: fixture.backgroundEvidence, assetCount: assets.length, frameCount: frames.length };
}

async function writeMathFixture(outputDirectory, projectTemplate) {
  const sourceShot = projectTemplate.shots[0];
  const project = {
    ...projectTemplate,
    shots: Array.from({ length: 3 }, (_, index) => ({
      ...structuredClone(sourceShot),
      id: `50000000-0000-4000-8000-00000000000${index + 1}`,
      name: `math-shot-${index + 1}`,
      durationMs: 1_001,
      audioClips: [],
    })),
  };
  const frames = Array.from(iterateFormalProjectFrameSchedule(project));
  const position = (timeMs) => {
    const mapped = mapProjectTime(project, timeMs);
    return { projectTimeMs: mapped.projectTimeMs, shotId: mapped.shot?.id ?? null, shotIndex: mapped.shotIndex, shotStartMs: mapped.shotStartMs, shotLocalTimeMs: mapped.shotLocalTimeMs };
  };
  const boundaries = [1_001, 2_002].map((boundaryMs) => ({
    boundaryMs,
    before: position(boundaryMs - 1),
    at: position(boundaryMs),
    after: position(boundaryMs + 1),
  }));
  const receipt = { totalDurationMs: 3_003, fps: 24, frameCount: formalFrameCount(3_003), incorrectPerShotCeilFrameCount: 75, frames, boundaries };
  if (receipt.frameCount !== 73 || frames.length !== 73) throw new Error('Three 1001 ms Shots must produce one 73-frame global schedule.');
  await fsp.writeFile(path.join(outputDirectory, 'math-3x1001ms-73-frames.json'), JSON.stringify(receipt, null, 2), 'utf8');
}

async function main() {
  await fsp.mkdir(baseDirectory, { recursive: true });
  const samples = [];
  let templateProject = null;
  for (const sampleId of [1, 2]) {
    const fixture = await generateIssue827Fixture(path.join(baseDirectory, `sample-${sampleId}`), sampleId);
    templateProject ??= fixture.project;
    samples.push(await writeSampleEvidence(fixture, sampleId));
  }
  const mathDirectory = path.join(baseDirectory, 'math-fixture');
  await fsp.mkdir(mathDirectory, { recursive: true });
  if (!templateProject) throw new Error('Issue #827 fixture generation produced no Project template.');
  await writeMathFixture(mathDirectory, templateProject);
  const manifest = { issue: 827, generatedAt: new Date().toISOString(), samples, mathFixturePath: path.join(mathDirectory, 'math-3x1001ms-73-frames.json') };
  await fsp.writeFile(path.join(baseDirectory, 'fixture-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
