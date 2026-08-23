#!/usr/bin/env node
/**
 * Compatibility entry point for the C2 research harness.
 *
 * The implementation lives under Main so production and research cannot
 * silently drift. This wrapper intentionally contains no classifier logic.
 */

'use strict';

module.exports = require('../src/main/services/fla-recovery-classifier.js');
