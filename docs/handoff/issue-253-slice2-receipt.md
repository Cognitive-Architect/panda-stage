# Issue #253 — FLA V1 Slice 2 delivery receipt

Status: Draft PR / Open / Unmerged. Slice 2 automated Windows Electron
verification is complete; maintainer human acceptance and review remain
pending. No PASS state was written back to the Issue or PR.

- Issue: [#253](https://github.com/Cognitive-Architect/panda-stage/issues/253)
- Existing Draft PR: [#252](https://github.com/Cognitive-Architect/panda-stage/pull/252)
- Base: `main` at `66ce42ab47c4829515385adca4af58b65aef7134`
- Implementation branch: `agent/issue-251-fla-v1-slice1`
- Slice 2 implementation commit: `a526e02`
- Parser source pin: [`lifeart/fla-viewer@048000cc`](https://github.com/lifeart/fla-viewer/tree/048000ccab67469980b8dedd1fc2b65a02d2b164)

## Delivered boundary

Slice 2 adds a direct **Import FLA...** action to the Asset Library. It reuses
the Slice 1 Main/preflight/isolated parser/session lifecycle and the existing
Panda-owned `AnimationImportIR`; it does not add a second parser, parser
worker, or Project session path.

The renderer review is read-only and presents:

- source basename and SHA-256;
- stage width, height, and frame rate;
- deterministic media count and the 156 placed / 2 library-only split;
- the exact status groups `EXACT`, `DEGRADED`, `UNSUPPORTED`, `UNKNOWN`, and
  `NOT_PRESENT`;
- source/library references, dimensions, source format, stable
  `fla-media-*` IDs, and lazy PNG thumbnails;
- alpha metadata for transparent raster inspection;
- deterministic future `.png` target-name previews, including Windows
  normalization, reserved-name, duplicate-name, and existing-Asset collision
  warnings; and
- select-all, clear-all, and individual raster selection.

The Continue/Confirm action validates and exposes only a
`fla-raster-selection` read-only intent keyed by stable media IDs. It does not
call the normal Asset import API, create an Asset, write `project.json`, alter
Project/Asset state, add History, or set dirty state. Slice 3 remains the
authorized boundary for materializing selected rasters.

## Lifecycle and containment

- Choosing a source continues through `window.pandaStage.fla.chooseAndInspect`
  and the existing Main-owned bounded preflight/parser session.
- Cancel is available while inspecting and after the review is ready.
- Closing the Resource Activity panel releases the review session and invokes
  the existing FLA cancellation path.
- Preview object URLs are created only from Panda-owned PNG bytes already in
  the IR and are revoked during effect cleanup; parser runtime objects and
  third-party types do not cross the renderer boundary.
- The FLA source remains unchanged, and the ordinary Asset/Project mutation
  APIs are not used by the review component.

Compatibility semantics are intentionally inspection-only: bitmap media is
`EXACT`; timeline placement is `DEGRADED` because timeline semantics are not
imported in V1; detected ActionScript, symbols/MovieClips, and tween semantics
are `UNSUPPORTED`; absent feature families are explicitly `NOT_PRESENT`; and
the existing `UNKNOWN` status remains representable.

## Verification routing

`package.json` now exposes `verify:issue253-slice2` as the package-level gate.
`scripts/verification-manifest.json` routes the `fla-import` renderer area to
the targeted FLA unit tests and the Issue #251/253 Windows Electron verifiers,
while retaining the full cross-process risk for the shared/Main/Preload
boundary.

## Validation evidence

Commands completed on Windows at the Slice 2 implementation commit:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:unit` — 119 files, 864 tests passed
- `pnpm test:integration` — 26 files, 147 tests passed
- `pnpm build`
- `pnpm verify:issue253-slice2`
- `pnpm exec electron scripts/verify-issue251-slice1.cjs`
- `git diff --cached --check`

The Slice 2 verifier used the real sample
`D:\表情合集\文件.fla`. Its source SHA-256 was
`84682edcd49b8fcc072ae740188677bae9d7d0fd603b8bed51a7ac4ddeb3119f` both
before and after review. The isolated real Electron run observed:

- Electron `43.1.1` and Node `24.18.0`;
- 1920×1080 at 30 fps;
- 158 media cards and 158/158 thumbnails;
- 156 placed media and 2 library-only media;
- transparent raster and JPEG-origin representatives;
- status counts `EXACT1`, `DEGRADED1`, `UNSUPPORTED2`, `UNKNOWN0`,
  `NOT_PRESENT4`;
- selection counts 158/158, 0/158, and a representative 3/158 subset;
- thumbnail `alt` identity matching for all 158 cards;
- read-only intent confirmation with zero Assets created;
- Project Asset count unchanged at 0 before and after confirmation;
- cancellation during inspection returning to the Asset browser; and
- review release after closing the Resource Activity panel.

The bounded JSON evidence is written to
`D:\PandaStage-Acceptance\issue-253-slice2\real-electron-review.json`.
The integration run also printed repeated `asset-thumbnail:read` “No handler
registered” messages from the existing integration harness, but all 147
integration tests passed and the command exited successfully; this unrelated
warning did not change the Slice 2 path or result.

## Human Windows acceptance handoff

Build and start the current PR branch in a dedicated acceptance checkout. A
normal renderer development launch is:

```powershell
pnpm build
pnpm dev:renderer
```

In a second PowerShell window:

```powershell
$env:VITE_DEV_SERVER_URL = 'http://localhost:5173/?debug=1'
pnpm exec electron dist-electron/main/index.js
```

Open or create a Panda Stage project, open the Asset Library, choose
**Import FLA...**, and use the real sample `D:\表情合集\文件.fla`. The
maintainer should manually check the source/stage/count summary, all five
compatibility groups, representative thumbnails and metadata, the 156/2
classification, target-name/collision previews, select-all/clear-all/
individual selection, read-only confirmation, cancel during inspection and
after review, and closing the Resource Activity panel. Confirm that the FLA
source and Project/Asset state remain unchanged.

Do not merge, mark PR #252 Ready, close PR #252, or close Issue #253 from this
receipt. Slice 3 import/materialization, atomic Project/Asset commit, and
save/reopen behavior are not included.

## Issue #254 UX follow-up

The bounded review-width, independent-scroll, responsive-card, and card-click
selection correction is recorded in the [Issue #254 UX receipt](./issue-254-slice2-ux-receipt.md).
It is implemented on the same Draft PR #252 branch at
`51eccb8979e5d38fa157b1c08a90251b797d4250`. Focused real Windows Electron
verification passed; maintainer re-acceptance of the affected UX remains
pending.
