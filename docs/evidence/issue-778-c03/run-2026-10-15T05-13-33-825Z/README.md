# Issue 778 C03 viewport evidence

Windows Electron 43.1.1 run on the native 150% display. `pnpm verify:issue775-c03` passed on the worktree containing the Issue 778 viewport CSS change (parent Git HEAD `e10055e14ad4b57d2f8096b2de856c1931624f38`). The complete verifier receipt is `c03-receipt.json`.

At 1186×725, the generated frame preview measured 210 CSS px high. The full nontransparent frame was visible at fit zoom (`visibleContentRatio: 1`, `contentHeightRatio: 0.9657`); the range and filmstrip measured 114.7 px and 80 px high.

At 846×653, the preview also measured 210 px and showed the full frame. One native touch gesture scrolled the workbench from 0 to 245.3 px. After the gesture, the frame range input (76×44 px), regenerate action (75.3×48 px), and filmstrip item (56×60.7 px) were visible and met the verifier's touch target checks.

Screenshots:

- `fit-1186x725.png` — full frame at fit zoom.
- `narrow-846x653-top.png` — narrow viewport at scroll position 0.
- `narrow-846x653-touch-scrolled.png` — range, regenerate, and filmstrip after native touch scroll.

The host's separate Issue 396 Stage D run reached its later receipt capture but could not set the requested 846×653 content viewport; Windows Electron reported 848×654. The C03 verifier above independently reached exactly 846×653 and passed the generated-sequence fit and touch-reachability assertions. CI validation at 1008×681 and 784×521 remains required on the final pushed head.
