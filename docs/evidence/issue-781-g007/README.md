# Issue #781 G007 — Windows Electron evidence

The same real FLA source was opened read-only for both captures. Its size was
1,777,905 bytes and its SHA-256 stayed
`3fdb31478c6e5fe3ffca30f27fe69d9b3ba8f29f4bcf28eb39b9ce1b0fa3fdf2`.

## Before and after captures

- Before-layout baseline: [receipt](before/run-2026-10-16T01-07-14-817Z/receipt.json), [first 24-frame screenshot](before/run-2026-10-16T01-07-14-817Z/sequence-start-1.png).
- Current G007 layout: [receipt](after/run-2026-10-16T02-15-47-661Z/receipt.json), [first 24-frame screenshot](after/run-2026-10-16T02-15-47-661Z/sequence-start-1.png), [fit preview](after/run-2026-10-16T02-15-47-661Z/sequence-generated-fit-normal.png).
- Ordinary snapshot preview during A→B→A: [snapshot remains on the canvas while the checked sequence's controls remain below it](after/run-2026-10-16T02-15-47-661Z/g007-snapshot-focus-with-sequence-controls.png).
- Narrow view: [full character at the top of the workbench](after/run-2026-10-16T02-15-47-661Z/sequence-generated-narrow-top.png), [range, regenerate, and filmstrip controls after a native touch scroll](after/run-2026-10-16T02-15-47-661Z/sequence-generated-narrow-controls.png).
- 560 CSS-pixel breakpoint: [initial simulated view](after/run-2026-10-16T02-15-47-661Z/sequence-generated-560-css-simulation.png), [controls and filmstrip after simulated touch scroll](after/run-2026-10-16T02-15-47-661Z/sequence-generated-560-css-simulation-controls.png).

The before and after runs used the same 333-frame character target, the first
24-frame range, 1186 × 724 logical content bounds, and the host's 150% Windows
display scale. The displayed character is 8.1% larger in both width and height
after the layout change; all nontransparent character pixels remain visible.
The controls sit below the checkerboard canvas in the after capture.

The 846 × 653 CSS-pixel narrow run shows the entire canvas without scrolling.
A native touch gesture then scrolls to the range input, regenerate action, and
filmstrip; each tested target meets the 44 CSS-pixel minimum. The source FLA
hash is unchanged after both runs.
The regenerate action is 48 CSS pixels high, matching the existing C03
interaction verifier's button-size contract.

During the A→B→A path, the ordinary snapshot image remains visible in the
canvas while the checked sequence's range controls stay below the canvas. The
sequence selection remains checked during the preview-only focus change.

The 560 × 500 CSS-pixel breakpoint was exercised with Chromium CDP
`Emulation.setDeviceMetricsOverride` at device scale factor 1. This is a
simulation, not a Windows-native window measurement. The breakpoint was active,
the full canvas fit before scrolling, and an emulated touch scroll moved the
workbench by about 245 CSS pixels. The range input, regenerate action, and a
filmstrip item were then visible and each met the 44 CSS-pixel minimum.

The baseline is intentionally a capture of the old layout. Its receipt records
that canvas separation and the new range summary were not present before the
change. Current-layout requirements are asserted by the after-layout receipt.

## Validation

- `pnpm typecheck` — PASS
- `pnpm lint` — PASS
- `pnpm test:unit` — PASS, 351 files / 2,575 tests
- `pnpm test:integration` — PASS, 38 files / 189 tests
- `pnpm build` — PASS; Vite reported existing empty legacy CSS imports and a
  chunk-size warning
- G007 Windows Electron verifier — PASS; includes a clearly labeled 560 CSS-pixel CDP simulation; see the after-layout receipt above
- 125% Windows DPI — NOT RUN; the host exposed a 150% display only
- Owner's real Windows Gate C acceptance — PENDING; automated evidence does
  not represent owner acceptance
