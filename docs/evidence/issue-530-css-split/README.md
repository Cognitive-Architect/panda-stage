# Issue #532 / PR #531 — P1-01 corrective receipt

## Baseline and canonical map

- Repository: `Cognitive-Architect/panda-stage`
- Fixed baseline: `main@35fe7963a50e7bd9be68f1e39d12833c99bb4436`
- CSS source/blob: `src/renderer/styles.css` / `94c141fcff1df3fd0c309456c9b72f4df8773df0`
- Original source size: `L1-L32818`
- Canonical map: `docs/PandaStage_Phase1_Section_Map_v1.0_2026-09-15.md` at `8bac6f217246d25ba4eb6b6bd76ab7bcc11ab332`
- S01: canonical `L3-L1951` → `src/renderer/styles/legacy-slices/01-shell-import-review-base.css`
- The generated manifest now matches all 16 canonical ranges, work items, and target filenames. All 16 candidate boundaries are safe under the strengthened complete-rule check; no boundary adjustment is recorded.
- Root order: tokens import, primitives import, S01 import, then the untouched remainder

The machine-readable map is `scripts/css-split-manifest.json`. The reusable verifier is
`node scripts/verify-css-split.cjs`.

## Boundary and source evidence

- The preflight combines delimiter balance, comment/string closure, and an empty top-level CSS statement prelude. This rejects zero-depth cuts inside multiline selector lists or partial at-rule headers.
- Focused regression coverage is in `tests/contract/css-split-boundary.test.ts`.
- Preflight: `node scripts/verify-css-split.cjs --preflight` — PASS
- Final source-equivalence verifier: `node scripts/verify-css-split.cjs --write-receipt` — PASS
- S01 exact range SHA-256: `74fc242df333b3fe0bad7ee7ab912ac88f28c9fd212bf74d6e5379573edce7b7`
- Reconstructed full-source SHA-256 equals pinned baseline: `2404124609c88ee552288a51ffa3f5408cd2193adc754235af234cdd922ba3e7`
- S01 contains no `@import`, `url(...)`, or `@font-face`; relocation risk: none
- Direct stylesheet readers were searched under `tests/` and `scripts/`; 11 materially affected readers use the shared ordered reader where implementation-body source is required. Entry-wiring assertions continue to inspect the real root entry.

## CI ownership routing

The new CSS split manifest/boundary helper and focused contract are explicitly registered with the existing CI ownership manifest. The CSS entry, legacy slice, receipt, shared reader, and split verifier are registered on the existing `editor-shell` route; the control manifest/helper and boundary contract remain on the existing `ci-build-infrastructure` route. The local Draft classification is `focused` with no unknown paths. The fail-closed unknown-route policy is unchanged.

## Validation

- `node scripts/verify-css-split.cjs --preflight` — PASS
- `node scripts/verify-css-split.cjs --write-receipt` — PASS, final source equivalence
- focused contracts — PASS, 4 files / 88 tests
- `pnpm test:unit` — PASS, 274 files / 1778 tests
- `pnpm typecheck` — PASS
- `pnpm lint` — PASS
- `pnpm build:renderer` — PASS
- `git diff --check` — PASS
- GitHub Actions run `34932636009` / CI #874 — PASS: classifier, Typecheck, Lint, Unit, Integration, Build, and manifest-selected regression suites
- The focused route completed successfully; Full quality, unknown-route, and unrelated paths were not selected.

## Windows Electron smoke

- Worktree: `D:\panda-issue530-css-split`
- Branch: `agent/issue-530-css-split`
- Window: `Panda Stage`, `Responding=True`
- Process: PID `13364`
- Isolated clean user data: `D:\PandaStage-Acceptance\clean-latest-20260915-114855`

The application startup/window-response smoke passed before the final test-only commit;
the final commit changes no product code. Human visual acceptance remains pending
maintainer inspection; no automated result is recorded as human PASS.

## Scope and residual risk

Only S01 was extracted. S02-S16 remain pending in the canonical map. No selector, DOM,
token, geometry, or feature behavior was intentionally changed. No manual Full CI,
`pnpm verify:project`, or repo-wide historical verifier sweep was run.
