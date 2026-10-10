# Issue #752 — V1-T02 static-character evidence

**Result: `PARTIAL`.** Both real control sources have reviewable full-character previews and exact production catalog roots. The native Workbench import, placement, save/reopen, and #752 owner visual acceptance are not verified.

## Serial gate and scope

The owner recorded **HUMAN VISUAL PASS** for the three #751 screenshots on 2026-10-10; see [Issue #751](https://github.com/Cognitive-Architect/panda-stage/issues/751) and the [#750 roadmap](https://github.com/Cognitive-Architect/panda-stage/issues/750). The #751 serial gate is cleared. PR #677 remains open and draft.

This evidence reuses the existing FLA Workbench and Static Snapshot transaction. It does not introduce a second importer or semantic body-part mapping. The source Graphic remains a single static asset candidate.

## Reviewable full-character controls

### #747 accepted Hanfu

![Hanfu full-character production render](../issue-747/hanfu-full-character.png)

- Source: `汉服修仙女.fla`, SHA-256 `6af14990029d4ced2c4e305721321835180c1bf041178a8799e1d14a1f62e535`.
- Exact catalog root: `修仙女-cilisucai.com/修仙女-cilisucai.com1`, Graphic frame 0 of 30; production catalog ID `fla-render-target-106bdafd4a330d6c43443914a48082b52170913f4f187de0eab8387410adbb04`.
- Existing accepted PNG: 332×673, SHA-256 `D48AE620AA0C6B1669AC51F3180E9D83E43A9F89C5F4063C4EC3AA001E25BE6B`. The owner accepted this image under #747. It is shown here as the unchanged control, not as proof of the #752 Workbench flow.

### #734 S1 BlueWhite control

![BlueWhite full-character production render](bluewhite-full-character.png)

- Source: `蓝白古装男.fla`, SHA-256 `0d4aecbc159990ce54b9d0d8c31ea0f3354cd7ed86df77bac19a562dfc761fa2`.
- Exact catalog root: `蓝衣修士-cilisucai.com/蓝衣修士-cilisucai.com1`, Graphic frame 0 of 25; production catalog ID `fla-render-target-61150b04b44bc3e78c7f403b391bb95047031e97b7c1b0843c599e143a808636`.
- The prior #734 production PNG is 349×994, SHA-256 `0baf01e46b240a44b131a8e91e919eca0c29c32e1ea8a31efb51634e8dca14f4`. [The #734 truth table](../../research/issue-734-stage-b5-v0-character-truth-table.md) classified it S1 complete static character; this #752 artifact makes the image directly reviewable and does not claim a new owner verdict.

## Read-only catalog evidence

[`catalog-probe.json`](catalog-probe.json) records production Main `chooseAndInspect` → recovery/preflight → `staticSnapshotCatalog` results for both sources. It opened no project and called no commit API. The probe records matching source hashes before and after. `previewSupported: true` is a catalog classification; it does not by itself prove a successful Workbench preview or import.

The Hanfu source entered through in-memory recovery during the probe; the original FLA remained unchanged. The BlueWhite catalog contains other component roots; this receipt identifies the exact full-character Graphic root rather than selecting the first item.

## Validation and remaining acceptance

- `pnpm test:integration`: **PASS**, 38 files and 189 tests. Its configured typecheck and renderer/Electron builds passed. Vite reported existing empty legacy CSS imports and a large-chunk warning.
- Focused Static Snapshot multi-fill and commit checks: **PASS**, 12 tests across 2 files. These cover fail-closed unsupported bitmap fill and rollback after an injected post-save fault; they are not a real unsupported-FLA runtime receipt.
- The [#751 issue record](https://github.com/Cognitive-Architect/panda-stage/issues/751) reports that its 43-file corpus probe classified 577 catalog entries as preview-supported and found no real unsupported target. Runtime unsupported-target presentation therefore remains **UNVERIFIED**.
- A native-picker vertical run did not complete: one attempt opened a different FLA from Downloads and stopped when the requested exact root was absent; a follow-up run timed out before the Workbench route. No valid #752 preview/import/place/save/reopen receipt was produced.
- No #752 **HUMAN VISUAL PASS** is claimed. The owner still needs to review the BlueWhite control and the actual Workbench-to-shot result once a valid end-to-end run is available.

The existing renderer commit and rollback owner is [FlaStaticSnapshotCommitService](../../../src/main/services/FlaStaticSnapshotCommitService.ts). The focused tests remain under `tests/unit/fla-static-snapshot-c02-multi-fill.test.ts` and `tests/unit/fla-static-snapshot-commit.test.ts`.
