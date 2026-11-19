# Issue #1165 Classic Motion endpoint matrix acceptance

[Issue #1165](https://github.com/Cognitive-Architect/panda-stage/issues/1165)

Fix: `348ced4`. An omitted Classic Motion endpoint matrix is evaluated as
identity. Explicit invalid matrices still fail validation.

The real FLA previously reproduced `UNSUPPORTED_TWEEN`. With the fix, Windows
Electron 43.1.1 composed and rasterized 85 nonblank frames across the six affected
Graphic targets. One target was rendered at every frame from 0 through 59 and
the other five were sampled at frames 0, 15, 30, 44, and 59. The source hash
was unchanged.

Build and type checks, lint, 3,667 unit tests, and 260 integration tests
passed. One integration test was skipped.

**OWNER visual acceptance: PASS.** The owner reviewed the real FLA preview and
accepted the result.
