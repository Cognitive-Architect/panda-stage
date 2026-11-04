# C5-KF-00 evidence index

Run the bounded research harness with `pnpm research:c5-kf-00`. It evaluates the
original synthetic fixture, checks absolute-time interpolation and the current
Adaptive Parts geometry, then asks Electron to rasterize the static/neutral
comparison and contact sheet.

The public fixture is original vector art:

- [Synthetic contact sheet (SVG)](synthetic-contact-sheet.svg)
- [Synthetic contact sheet (PNG)](synthetic-contact-sheet.png)

For a private real-asset run, set `PANDA_C5_KF00_REAL_PROJECT_DIR` and
`PANDA_C5_KF00_SOURCE_FLA` to the authorized local inputs before running the
command. The real contact sheets (`private-real-contact-sheet.png` and
`private-real-shoulder-contact-sheet.png`), raster frames, manifest, receipt,
and review record stay in the dedicated local acceptance directory; they must
not be copied into this repository or uploaded to public GitHub.
