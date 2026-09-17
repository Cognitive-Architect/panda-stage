# Issue #546 / P2-B06 receipt set

## Scope

- Issue: `P2-B06 / Wave 1 Lane B: layer properties + canvas + product preview`.
- Existing PR: #542, branch `agent/issue-541-p2-01`; no new or stacked PR was created.
- Starting PR head: `f5d25ef8adddbe88d42dcab2cc2212b4c0203590`.
- Canonical planning input: [`PandaStage_Phase2_Canonical_Section_Map_v1.1_2026-09-16.md`](../../decisions/PandaStage_Phase2_Canonical_Section_Map_v1.1_2026-09-16.md), committed at the starting head. The map is not an automatic-relocation approval; Issue #546 supplies the local implementation authorization.
- Pinned CSS baseline: commit `35fe7963a50e7bd9be68f1e39d12833c99bb4436`, source blob `94c141fcff1df3fd0c309456c9b72f4df8773df0`, normalized SHA-256 `2404124609c88ee552288a51ffa3f5408cd2193adc754235af234cdd922ba3e7`.

## Implemented boundaries

The three machine-readable receipts keep the Issue's P2 work items separate:

- [`p2-12-layer-properties.json`](p2-12-layer-properties.json): `G045`, `G047`, `G066`, `G081`, and `G100`; Sections `S06-02`, `S06-04`, `S07-10`, `S08-12`, `S08-13`, `S08-14`, `S11-05`, `S11-06`, and `S11-07`.
- [`p2-13-canvas.json`](p2-13-canvas.json): `G044` and `G067`; Sections `S06-01` and `S07-11`.
- [`p2-14-product-preview.json`](p2-14-product-preview.json): `G051`; Section `S06-09`.

All moved CSS is an exact normalized baseline range copy. Interior ranges retain ordered untouched remainder files at the original traversal positions. The production entry remains source-order equivalent; no feature sorting, deduplication, selector rewrite, declaration/value change, DOM/state/store/IPC change, or `canvasViewportStore` change was made.

## Automated validation

- `node scripts/verify-css-split.cjs`: PASS in the isolated clean verification worktree; reconstructed SHA-256 matches the pinned baseline.
- `pnpm exec vitest run tests/contract/issue541-p2-01.test.ts tests/contract/issue546-p2-b06.test.ts`: 2 files / 8 tests PASS.
- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm test:unit`: 276 files / 1,786 tests PASS.
- `pnpm build`: PASS (`build:renderer` and `build:electron`).
- `MANUAL_FULL_TRIGGERED=false`; `VERIFY_PROJECT_MANUALLY_RUN=false`.

## Human acceptance

Windows Electron visual/smoke acceptance remains `未测` / `PENDING_HUMAN_ACCEPTANCE`. The required surfaces are listed in each receipt: selected and unselected layer states, background/protected/locked states, transform/appearance/order controls, portrait and landscape compact layouts, Canvas fit/actual/pan and Timeline Canvas context, and Product Preview open/close/playback/aspect/subtitles/missing-image states.

The automated checks above do not substitute for that real Windows Electron acceptance or maintainer disposition. PR #542 must remain Draft/Open/Unmerged until the repository owner accepts it.
