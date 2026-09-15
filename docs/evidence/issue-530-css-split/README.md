# Issue #530 — P1-01 receipt

## Baseline and map

- Repository: `Cognitive-Architect/panda-stage`
- Baseline: `main@35fe7963a50e7bd9be68f1e39d12833c99bb4436`
- CSS source/blob: `src/renderer/styles.css` / `94c141fcff1df3fd0c309456c9b72f4df8773df0`
- Original source size: lines `L1-L32818`
- S01: original `L3-L1951` → `src/renderer/styles/legacy-slices/01-shell-import-review-base.css`
- Root order: tokens import, primitives import, S01 import, then the untouched remainder
- Structural map: 16 contiguous candidate slices, with no gaps or overlaps
- Boundary corrections recorded by the preflight:
  - candidate `L10344` was inside `@media (max-width: 1100px)`; actual boundary `L10555`
  - candidate `L27898` was inside `@media (max-width: 900px)` and the Issue #441 block; actual boundary `L27996`

The machine-readable map is `scripts/css-split-manifest.json`. The reusable verifier is
`node scripts/verify-css-split.cjs`.

## Evidence

- Preflight: `node scripts/verify-css-split.cjs --preflight` — PASS
- Final source-equivalence verifier: `node scripts/verify-css-split.cjs --write-receipt` — PASS
- S01 exact range SHA-256: `74fc242df333b3fe0bad7ee7ab912ac88f28c9fd212bf74d6e5379573edce7b7`
- Reconstructed full-source SHA-256 equals pinned baseline: `2404124609c88ee552288a51ffa3f5408cd2193adc754235af234cdd922ba3e7`
- S01 contains no `@import`, `url(...)`, or `@font-face`; relocation risk: none
- Direct stylesheet readers were searched under `tests/` and `scripts/`; 11 materially affected readers now use the shared ordered reader where implementation-body source is required. Entry-wiring assertions continue to inspect the real root entry.

## Validation

- `pnpm test:unit` — PASS, 273 files / 1775 tests
- `pnpm test:integration` — PASS, 32 files / 176 tests
- `pnpm typecheck` — PASS
- `pnpm lint` — PASS
- `pnpm build:renderer` — PASS
- `git diff --check` — PASS

## Windows Electron smoke

- Worktree: `D:\panda-issue530-css-split`
- Branch: `agent/issue-530-css-split`
- Window: `Panda Stage`, `Responding=True`
- Process: PID `13428`
- Isolated clean user data: `D:\PandaStage-Acceptance\issue-530-css-split-clean-20260915`

The application startup/window-response smoke passed. Human visual acceptance remains
pending maintainer inspection; no automated result is recorded as human PASS.

## Scope and residual risk

Only S01 was extracted. S02-S16 remain pending in the map. No selector, DOM, token,
geometry, or feature behavior was intentionally changed, and no manual Full CI,
`pnpm verify:project`, or repo-wide historical verifier sweep was run.
