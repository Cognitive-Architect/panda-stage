# Issue #654 — right-rail rhythm repair

Baseline: PR #628 branch `issue-627-s09-r01` at `3625586`. Windows screenshot acceptance is pending.

The local #653 stylesheet no longer overrides the original activity rail's bounded `min(100%, 360px)` height, three equal rows, 72px minimum, or 8px gaps. The rail stack now fills the right workspace height in normal flex flow. The mode group uses the remaining space and sits toward the bottom; at constrained heights the navigation can shrink only to its original minimum rows, with scrolling as the last-resort fallback rather than clipping or overlap. The right rail stays 56px wide, and no editor grid or Canvas width rule changed.

The `自动运镜` button remains semantically outside activity navigation. Its full accessible name and pressed state are preserved while the visible label uses compact `自动` / `运镜` lines in the incumbent 52px × 72px button footprint. No Camera state or Preview behavior changed.

Validation: focused rail/Preview contracts (4 files / 19 tests), `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` (325 files / 2196 tests), `pnpm build`, and `git diff --check` passed. No manual Full CI or repository-wide verifier sweep was run. The Windows Electron app was restarted and responds; human screenshot comparison of the incumbent rail, mode hierarchy, clipping, and Canvas width is still required.
