# C5-KF-00 evidence index

Run the bounded research harness with `pnpm research:c5-kf-00`. It evaluates the
original synthetic fixture, checks direct unwrapped absolute-time interpolation
and the current Adaptive Parts geometry, then asks Electron to rasterize the
research SVG static/neutral comparison and contact sheet.

The zero-difference pixel result is scoped to the two SVGs emitted by this
research harness: `RESEARCH_SVG_NEUTRAL_PIXEL_EQUAL` records 850,000 compared
pixels and zero differences when the harness produces that result. Both images
use the same research SVG rendering path. This does not establish parity with
the production `StageRenderer`; `PRODUCTION_STAGE_PIXEL_PARITY=NOT_VERIFIED`.

The public fixture is original vector art:

- [Synthetic contact sheet (SVG)](synthetic-contact-sheet.svg)
- [Synthetic contact sheet (PNG)](synthetic-contact-sheet.png)

For a private real-asset run, set `PANDA_C5_KF00_REAL_PROJECT_DIR` and
`PANDA_C5_KF00_SOURCE_FLA` to the authorized local inputs before running the
command. The real contact sheets (`private-real-contact-sheet.png` and
`private-real-shoulder-contact-sheet.png`), raster frames, manifest, receipt,
and review record stay in the dedicated local acceptance directory; they must
not be copied into this repository or uploaded to public GitHub.

Private visual review is bound to the experiment commit, source FLA and Part
image hashes, migrated project snapshot hash, both generated contact-sheet PNG
hashes, pivot, and tested angle range. A valid local review is reported as
`CODEX_LOCAL_VISUAL_PASS_PROVISIONAL / OWNER_NOT_ATTESTED`; it is not owner
acceptance.
