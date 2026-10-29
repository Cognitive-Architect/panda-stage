const path = require('node:path');

const issueCase = process.env.PANDA_STAGE_ISSUE888_CASE;
const projectRoot = process.env.PANDA_STAGE_ISSUE888_PROJECT_ROOT;
if (!['F01', 'F02'].includes(issueCase)) throw new Error('PANDA_STAGE_ISSUE888_CASE must be F01 or F02.');
if (!projectRoot) throw new Error('PANDA_STAGE_ISSUE888_PROJECT_ROOT is required.');

process.env.PANDA_STAGE_ISSUE887_CASE = issueCase;
process.env.PANDA_STAGE_ISSUE887_PROJECT_ROOT = path.resolve(projectRoot);
process.env.PANDA_STAGE_ISSUE888_PHASE ??= 'baseline';
require('./verify-issue887-au03-capacity.cjs');
