# Issue 778 Stage D CI parity — 2026-10-15

This folder records the fresh Windows Electron Stage D verifier run for the R1 CI correction in commit `c97d8da`. The verifier exercised the production C03 workbench with its generated zero-raster FLA fixture in a dedicated acceptance directory outside the repository. The fixture, project, and raw absolute paths are not committed.

## Result

The [sanitized receipt](stage-d-receipt.json) reports `response.ok: true`; every response check passed. It verifies 27 supported targets, three generated sequence frames, A→B→A selection retention, native keyboard/touch reachability, one newly committed snapshot plus one exact duplicate reuse, revision advance, and unchanged generated-source SHA-256.

Scan cancellation sampled the actual `rendering` phase at `0 / 27`, cancelled back to the asset browser, and left project asset count and revision unchanged. The progress was incomplete when the verifier cancelled it.

The native Windows display scale was 150% (DPR 1.5), recorded as `native150Percent: PASS`. The receipt viewport was set and measured exactly at 846×653; the narrow viewport measured 787×525. Receipt screenshots show touch scrolling and the import action remaining visible. Native 125% scaling was **NOT RUN**.

## Screenshots

- [Target list at top](stage-d-top-target.png) · [target list at bottom](stage-d-bottom-target.png)
- [Sequence controls, wide](stage-d-sequence-wide.png) · [narrow at top](stage-d-sequence-narrow-top.png) · [narrow after touch scroll](stage-d-sequence-narrow-scrolled.png)
- [Receipt at 846×653, top](stage-d-receipt-846x653-top.png) · [after touch scroll](stage-d-receipt-846x653-scrolled.png)
- [Receipt at 787×525, top](stage-d-receipt-narrow-top.png) · [after touch scroll](stage-d-receipt-narrow-scrolled.png)

## Validation

- `pnpm exec electron scripts/verify-issue396-stage-d.cjs --acceptance-root <dedicated external acceptance directory>` — PASS
- `node --check scripts/verify-issue396-stage-d.cjs` — PASS
- `pnpm exec eslint scripts/verify-issue396-stage-d.cjs tests/unit/fla-stage-d-v11-layout.test.ts` — PASS
- `pnpm exec vitest run tests/unit/fla-stage-d-v11-layout.test.ts` — PASS, 3 tests
- `git diff --check` — PASS

The verifier-only change did not alter Main, Preload, IPC, or renderer production code. Owner visual acceptance and parent #775 Gate C remain pending.