/*
 * Issue #260 / FLA V1 Slice 4: built-runtime all-158 stress acceptance.
 *
 * The shared Slice 3 verifier owns the end-to-end Electron probe. This entry
 * selects all 158 real-sample media and writes a separately classified stress
 * receipt without changing the normal 3-item verifier contract.
 */
process.env.PANDA_STAGE_FLA_STRESS = '1';
require('./verify-issue257-slice3.cjs');
