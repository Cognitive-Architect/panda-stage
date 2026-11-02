# CA-01-FIX-04 viewBox precision result

This sanitized report records the authorized precision-only change and its same-source 21-frame retest. It contains no source artwork, rendered frames, or owner machine paths.

## D1: same-rasterizer A/B

- Both variants used the same FLA source (SHA-256 `0D4AECBC159990CE54B9D0D8C31EA0F3354CD7ED86DF77BAC19A562DFC761FA2`), rasterizer instance, part SVG inner markup, transforms, draw order, output dimensions, and integer-grid PNG reassembly. Only the root `viewBox` number formatting differed: full precision (A) versus six decimals (B).
- Every sampled A/B pair had identical inner SVG markup. The table reports differing pixels / maximum channel delta against the native frame.

| Frame | A: full precision | B: six decimals | A/B image delta |
| --- | ---: | ---: | ---: |
| F0 | 0 / 0 | 0 / 0 | 0 / 0 |
| F1 | 0 / 0 | 34 / 3 | 34 / 3 |
| F5 | 48 / 1 | 94 / 15 | 46 / 15 |
| F8 | 473 / 2 | 473 / 2 | 0 / 0 |
| F20 | 0 / 0 | 0 / 0 | 0 / 0 |

This proves six-decimal rounding causes the sampled F1 mismatch and contributes to F5. F5 retains 48 differing pixels under full precision, and F8 is unchanged, so precision does not explain all residuals.

## D2: bounded change

- Commit: `c6a9a0de2609490e537da96c193035fa26335efc` (`fix(fla): preserve com8 part viewBox precision (#924)`).
- Isolated-part SVG `viewBox` values now use JavaScript's shortest round-trip number string instead of `toFixed(6)`. The integer pixel-grid stack implementation is unchanged.
- Added focused checks for high-precision positive/negative coordinates and rejection of non-finite values.

## D3: committed 21-frame retest

- Compared baseline commit `23f4c0bcee4b91e58793a140e22ca0671b6cc4d5` with the committed fix above, using the same source and render target. Source SHA-256 before and after the probe remained `0D4AECBC159990CE54B9D0D8C31EA0F3354CD7ED86DF77BAC19A562DFC761FA2`.
- Native full-frame rendering still matches the same-source reference on 21/21 frames. Strict part-reassembly equality improved from 2/21 to 3/21 (F0, F1, F20). The summed differing-pixel count fell from 2,997 to 2,895; the largest channel delta fell from 15 to 3.
- F5 improved from 94 pixels / max delta 15 to 48 / 1. F8 remains 473 / 2. Residual part-reassembly differences remain from F2 through F19; strict acceptance is blocked.
- The probe emitted two source-occurrence candidates with 21 states each, distinct draw orders, and private ActionClipDraft/playback artifacts built from real part outputs. They remain candidates: no editable-track or product acceptance is claimed, and no project integration was made.

| Frame | Before pixels / max delta | After pixels / max delta |
| --- | ---: | ---: |
| F0 | 0 / 0 | 0 / 0 |
| F1 | 34 / 3 | 0 / 0 |
| F2 | 10 / 1 | 10 / 1 |
| F3 | 26 / 1 | 26 / 1 |
| F4 | 42 / 2 | 42 / 2 |
| F5 | 94 / 15 | 48 / 1 |
| F6 | 100 / 2 | 100 / 2 |
| F7 | 382 / 2 | 382 / 2 |
| F8 | 473 / 2 | 473 / 2 |
| F9 | 197 / 2 | 197 / 2 |
| F10 | 136 / 2 | 114 / 2 |
| F11 | 123 / 2 | 123 / 2 |
| F12 | 135 / 1 | 135 / 1 |
| F13 | 144 / 2 | 144 / 2 |
| F14 | 133 / 2 | 133 / 2 |
| F15 | 131 / 3 | 131 / 3 |
| F16 | 238 / 2 | 238 / 2 |
| F17 | 382 / 2 | 382 / 2 |
| F18 | 216 / 2 | 216 / 2 |
| F19 | 1 / 1 | 1 / 1 |
| F20 | 0 / 0 | 0 / 0 |

## Validation and verdict

- Focused unit: PASS, 4 tests. `pnpm typecheck`: PASS. `pnpm lint`: PASS. `pnpm build`: PASS; Vite reported existing empty legacy CSS imports and large-chunk notices.
- Integration, full unit, and Full CI: NOT_RUN. No independent Animate 2023 comparison or human Windows product acceptance is claimed; the native comparison is against the existing same-source Panda reference.
- The committed full probe completed all 21 frames and preserved the source hash. Its strict result is `BLOCKED/UNSUPPORTED`; no GO verdict is claimed.
- Verdict: `FIX_PASS + STILL_BLOCKED`. No second fix was attempted. Further non-precision investigation or a visual tolerance decision requires owner direction.
- Private run labels: `run-20261102-924-d1-viewbox-ab` and `run-20261102-924-d3-final-c6a9a0d`; baseline label: `run-20261102-922-d3-final-23f4c0b`.
