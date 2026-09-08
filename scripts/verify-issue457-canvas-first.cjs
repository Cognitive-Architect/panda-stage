// Issue #457 reuses the existing Issue #456 real Electron harness and adds
// the Canvas-first geometry/feedback assertions at runtime.
process.env.PANDA_STAGE_VERIFY_ISSUE457 = '1';
require('./verify-issue456-quick-action.cjs');
