const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const acceptanceRoot = path.resolve(
  process.env.PANDA_STAGE_ISSUE836_ROOT ?? 'D:\\PandaStage-Acceptance\\issue836-dl06-r0',
);
const runId = randomUUID();
const sourceCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();

process.env.PANDA_STAGE_ISSUE834_FOLLOWUP = '1';
process.env.PANDA_STAGE_ISSUE836_DL06_R0 = '1';
process.env.PANDA_STAGE_ISSUE836_RUN_ID = runId;
process.env.PANDA_STAGE_ISSUE836_SOURCE_SHA = sourceCommitSha;
process.env.PANDA_STAGE_ISSUE834_RUN_ID = runId;
process.env.PANDA_STAGE_ISSUE834_SOURCE_SHA = sourceCommitSha;
process.env.PANDA_STAGE_ISSUE834_ROOT = path.join(acceptanceRoot, runId);

require('./verify-issue819-dl02.cjs');
