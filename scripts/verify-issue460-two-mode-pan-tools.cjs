// Issue #460 reuses the real Electron harness from Issues #456/#457 and adds
// native Actual Size pan plus the simplified Tools-surface assertions.
process.env.PANDA_STAGE_VERIFY_ISSUE460 = '1';
require('./verify-issue456-quick-action.cjs');
