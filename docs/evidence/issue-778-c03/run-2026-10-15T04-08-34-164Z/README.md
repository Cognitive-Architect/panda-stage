# Issue 778: generated sequence preview

Windows Electron evidence from run `2026-10-15T04-08-34-164Z` on branch `issue-676-p0-c01-display-list-resolver`, built from a worktree based at HEAD `3c7aef8`. The original FLA SHA-256 remained `86eb123fdd42f1dac80754c9260b793404072be70523b41d012598138c35c6d2`.

## Before and after

| View | Before | After |
| --- | --- | --- |
| Normal | [Before](sequence-before-normal.png) | [After at Fit](sequence-after-normal.png) |
| Narrow generated preview | [Before](sequence-before-narrow.png) | [After at top](sequence-after-narrow-top.png) |
| Narrow touch access | n/a | [After touch scroll](sequence-after-narrow-controls.png) |

## Measurements

| Measurement | Before | After |
| --- | ---: | ---: |
| Normal main preview height | 101.55 CSS px | 210 CSS px |
| Normal range panel height | 152.35 CSS px | 114.67 CSS px |
| Normal preview-to-range height ratio | 0.67x | 1.83x |

The generated image is 274 by 466 pixels with nontransparent bounds of 258 by 450 pixels. At Fit zoom and `object-fit: contain`, the displayed alpha bounds are 202.79 CSS px tall inside the 210 CSS px main preview; measured visible-content ratio is 1.0 in both normal and narrow layouts.

The narrow viewport measured 846 by 653 CSS px at 150% Windows scaling. A native CDP touch gesture scrolled the workbench from 0 to 245.33 CSS px. After scrolling, the frame range input (76 by 44 CSS px), regenerate action (75.33 by 48 CSS px), and filmstrip item (56 by 60.67 CSS px) were fully visible. The existing C03 verifier's 44 px touch-target assertions also passed.

## Validation and limits

`pnpm verify:issue775-c03` passed on the Windows Electron host. The run includes typecheck and production renderer/Electron builds. `node --check scripts/verify-issue775-c03.cjs` and `git diff --check` passed. See [receipt.json](receipt.json) for all verifier assertions and measured geometry.

Automated evidence does not replace owner visual acceptance. The existing PR remains Draft and Issue 778 remains open for independent re-review.
