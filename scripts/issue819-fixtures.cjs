const { createHash, randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');
const { ProjectSchema } = require('../dist-electron/domain/models/project.js');

const repositoryRoot = path.resolve(__dirname, '..');
const demoProjectPath = path.join(repositoryRoot, 'demo-project', 'project-v1.example.json');

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function generateIssue819Fixture(baseDirectory) {
  const runRoot = path.join(
    path.resolve(baseDirectory),
    `run-${new Date().toISOString().replace(/[:.]/gu, '-')}-${process.pid}`,
  );
  const projectRoot = path.join(runRoot, 'Panda Stage formal export');
  const evidenceRoot = path.join(runRoot, 'evidence');
  await fsp.mkdir(path.join(projectRoot, 'assets'), { recursive: true });
  await fsp.mkdir(evidenceRoot, { recursive: true });

  const legacyProject = JSON.parse(await fsp.readFile(demoProjectPath, 'utf8'));
  const project = migrateProject(legacyProject);
  project.id = randomUUID();
  project.name = 'Panda Stage formal export';
  project.shots = project.shots.slice(0, 1);
  const shot = project.shots[0];
  if (!shot) throw new Error('The demo Project has no Shot for the Issue #819 fixture.');

  shot.durationMs = 6_501;
  shot.audioClips = [];
  shot.dialogues = shot.dialogues.map((dialogue, index) => {
    const result = { ...dialogue };
    delete result.audioClipId;
    if (index === 0) {
      result.startMs = 700;
      result.endMs = 6_150;
      result.text = 'Issue 819: Panda takes a brave first step.';
    }
    return result;
  });
  shot.timelineEvents = shot.timelineEvents.map((event) =>
    event.type === 'move' && event.startMs === 0
      ? { ...event, endMs: shot.durationMs }
      : event,
  );

  project.assets = project.assets.filter((asset) => asset.kind === 'image');
  for (const asset of project.assets) {
    const sourcePath = path.join(repositoryRoot, 'demo-project', asset.relativePath);
    const bytes = await fsp.readFile(sourcePath);
    if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') {
      throw new Error(`Issue #819 fixture image is not a PNG: ${asset.relativePath}`);
    }
    asset.width = bytes.readUInt32BE(16);
    asset.height = bytes.readUInt32BE(20);
    asset.sha256 = hash(bytes);
    await fsp.copyFile(sourcePath, path.join(projectRoot, asset.relativePath));
  }

  const validated = ProjectSchema.parse(project);
  if (validated.shots.length !== 1 || validated.shots[0]?.audioClips.length !== 0) {
    throw new Error('Issue #819 fixture must contain one silent Shot.');
  }
  await fsp.writeFile(
    path.join(projectRoot, 'project.json'),
    JSON.stringify(validated, null, 2),
    'utf8',
  );
  return { root: runRoot, projectRoot, evidenceRoot, project: validated };
}

module.exports = { generateIssue819Fixture };
