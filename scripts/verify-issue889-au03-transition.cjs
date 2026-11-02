const path = require('node:path');

const projectRoot = process.env.PANDA_STAGE_ISSUE889_PROJECT_ROOT;
if (!projectRoot) throw new Error('PANDA_STAGE_ISSUE889_PROJECT_ROOT is required.');

process.env.PANDA_STAGE_ISSUE887_CASE = 'S01';
process.env.PANDA_STAGE_ISSUE887_PROJECT_ROOT = path.resolve(projectRoot);
process.env.PANDA_STAGE_ISSUE889_PHASE ??= 'candidate';
require('./verify-issue887-au03-capacity.cjs');
