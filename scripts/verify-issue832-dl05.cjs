const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const acceptanceRoot = path.resolve(
  process.env.PANDA_STAGE_ISSUE832_ROOT ?? 'D:\\PandaStage-Acceptance\\issue832-dl05',
);
const runId = randomUUID();
const sourceCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();

process.env.PANDA_STAGE_ISSUE832_DL05 = '1';
process.env.PANDA_STAGE_ISSUE832_RUN_ID = runId;
process.env.PANDA_STAGE_ISSUE832_SOURCE_SHA = sourceCommitSha;
process.env.PANDA_STAGE_ISSUE832_ROOT = path.join(acceptanceRoot, runId);

require('./verify-issue819-dl02.cjs');
