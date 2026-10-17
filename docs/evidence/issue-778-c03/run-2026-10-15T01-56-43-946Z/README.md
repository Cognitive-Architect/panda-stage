# Issue 778 fresh C03 Windows evidence

Run 2026-10-15T01-56-43-946Z passed the bounded C03 Windows Electron verifier on the existing mother PR branch. The verifier ran at base commit 8bbb4b5 with the focused verifier changes in the working tree; those changes are included in the follow-up commit that adds this evidence. The disposable acceptance project was created outside the repository.

## Fresh proof

- Bulk confirmation described 398 eligible items as “即将勾选 398 项素材，暂不会导入” with the action “确认勾选”. Cancelling left zero checked items and the project file hash and revision unchanged.
- A source-backed shortened candidate label opened the full name on native touch without checking the item. Selected-only mode retained the no-result query and displayed “正在查看已选 · 搜索已暂停”.
- Sequence ranges generated 1–24, 25–30, and 28–30 for a 30-frame target. Preview focus A→B→A retained the checked sequence; changing its range invalidated the stale check. Sequence range text measured 11:1 contrast against its dark panel, and the generate action measured 7.1:1.
- Mixed snapshot plus bitmap import succeeded; the duplicate path made no project change; a later raster failure preserved the first snapshot commit and showed plain-language guidance with technical diagnostics collapsed. Save and reopen retained the imported assets.
- The partial-failure receipt was checked at native 846×653 and 786×524 viewports at 150% display scaling. Footer and import action stayed visible. Native touch scrolling reached the last receipt item; Tab reached the receipt summary while the import action was disabled and visible.

The original FLA was read-only during the run. SHA-256 remained 86eb123fdd42f1dac80754c9260b793404072be70523b41d012598138c35c6d2. See receipt.json for all required assertions and per-screenshot hashes.

## Screenshots

- [Truthful bulk confirmation](bulk-confirmation.png) · [cancelled without mutation](bulk-confirmation-cancelled.png)
- [Selected-only search explanation](selected-view-ignores-search.png) · [full source name on touch](composed-character-preview.png)
- [Sequence range 1](sequence-start-1.png) · [range 25](sequence-start-25.png) · [near end](sequence-near-end.png)
- [Mixed import success](mixed-import-success.png) · [save and reopen](reopened-workbench.png) · [duplicate no-op](stop-after-current-receipt.png)
- [Partial failure at 846×653, top](partial-failure-receipt-viewport846x653-top.png) · [after touch scroll](partial-failure-receipt-viewport846x653-scrolled.png) · [keyboard path](partial-failure-receipt-viewport846x653-keyboard.png)
- [Partial failure at narrow width, top](partial-failure-receipt-narrowNative-top.png) · [after touch scroll](partial-failure-receipt-narrowNative-scrolled.png) · [keyboard path](partial-failure-receipt-narrowNative-keyboard.png)

## Validation and limits

pnpm build passed before the final verifier-only refinements. The final pnpm exec electron scripts/verify-issue775-c03.cjs --acceptance-root <dedicated external acceptance directory> run passed, followed by node --check and focused ESLint for scripts/verify-issue775-c03.cjs. Native 125% scaling was NOT RUN. Owner visual acceptance is still required; PR #677 remains Draft/Open, and parent #775 Gate C remains HOLD. The S2 progress-schema error remains unresolved and requires separate authorization. The 645 omitted catalog entries remain OUT OF SCOPE.
