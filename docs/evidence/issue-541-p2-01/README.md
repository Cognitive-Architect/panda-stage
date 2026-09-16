# Issue #541 / P2-01 receipt

## Scope and boundary

- Issue: #541, `P2-01: preserve-order verification continuation + Tools view-mode pilot`.
- Starting live `main` HEAD: `fb5f91ecb8ee3ecdcea9bf2f242526feb3597859`.
- Canonical section: `S11-01`, segment `G097`, owner `shell-tools`, order `112`.
- Source: `src/renderer/styles/legacy-slices/11-tools-inspector-timeline-start.css`, blob `acf90acc825c7ffe2ffcdadc56451ad62083b9d3`.
- The exact local source range is L1-L54 (original global entry L21803-L21856), byte range `[0, 1182)`, SHA-256 `5137b65f7ceb77eba12778256b55e697bd47259f0379a5ec9e52076c5eb8bc83`.
- The boundary is the complete top-level `project-tools-view-mode-*` group immediately before `.project-tools-action-presets-view`; the preflight record is in [`preflight.json`](preflight.json).
- The exact bytes now live at `src/renderer/styles/shell/tools/view-mode.css`. The legacy S11 file begins with the untouched action-preset host rules, so the old location contains no duplicate view-mode group.
- `styles.css` imports the semantic file immediately before the S11 remainder. The extended verifier and ordered reader reconstruct the real production import traversal and compare it to the pinned baseline without sorting or recursively bundling CSS.
- `ProjectToolsDrawer` remains the presentation host; `canvasViewportStore` remains the single behavior/state owner. No DOM, copy, store, breakpoint, selector, declaration, or interaction redesign was made.

## Automated validation

- `node scripts/verify-css-split.cjs --preflight`: PASS.
- `node scripts/verify-css-split.cjs --write-p2-receipt`: PASS; real production entry import order equivalent, missing sections `0`, duplicate sections `0`, reconstruction SHA-256 `2404124609c88ee552288a51ffa3f5408cd2193adc754235af234cdd922ba3e7`.
- Issue-scoped contract plus CSS boundary/CI/manifest contracts: 4 files / 88 tests PASS.
- Tools view-mode focused unit batch: 5 files / 24 tests PASS.
- Affected editor-shell integrations (`editor-shell-layout`, `right-inspector-narrow`): 2 files / 21 tests PASS.
- `pnpm test:unit`: 275 files / 1782 tests PASS.
- `pnpm typecheck`: PASS. `pnpm lint`: PASS. `pnpm build:renderer`: PASS. `pnpm build:electron`: PASS.
- Native visible Electron smoke from the built worktree: PASS at 1366x768 and 1920x1080 for Tools open, `适应窗口`, `实际尺寸`, return to fit, and action-preset entry. External output: `D:\PandaStage-Acceptance\issue-460-two-mode-pan-tools\geometry-results.json`.
- `MANUAL_FULL_TRIGGERED=false`; `VERIFY_PROJECT_MANUALLY_RUN=false`.

## Acceptance status

The focused native smoke is automated evidence, not maintainer visual acceptance. Maintainer Windows acceptance of the final exact HEAD remains **PENDING**. Do not mark the PR Ready, merge it, or close the Issue until that acceptance and the normal required CI are complete.

The machine-readable receipt is [`receipt.json`](receipt.json).
