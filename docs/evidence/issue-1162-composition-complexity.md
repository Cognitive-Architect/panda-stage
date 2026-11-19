# Issue #1162 composition complexity receipt

[Issue #1162](https://github.com/Cognitive-Architect/panda-stage/issues/1162) · [Roadmap #1161](https://github.com/Cognitive-Architect/panda-stage/issues/1161)

Baseline: PR #1156 at `6c04fe06daec2b95532d7e01e47683cd88434660`.
A-real is the issue's FLA ending in `2ca672a4127e4e49b28271e57d2866c7`,
Scene frame 0. Panda's existing archive recovery normalized the 54-byte EOCD
central-directory size discrepancy in memory. The original file hash was
unchanged after the Electron run.

The baseline rejected this frame with
`BUDGET_EXCEEDED: Composition style-run budget exceeded`. The probe bypassed
that composition check and used the existing reconstruction and output limits.

| Receipt metric | A-real | A-small |
| --- | ---: | ---: |
| Source Edge records | 67,716 | 1 |
| Raw style runs | 67,716 | 1 |
| Unique effective styles, summed per shape instance | 3,836 | 1 |
| Post-reconstruction fills | 3,835 | 1 |
| Post-reconstruction stroke paths | 2 | 0 |
| Declared fill styles | 3,835 | 1 |
| Declared stroke styles | 1 | 0 |
| Mid-edge style changes | 0 | 0 |
| Decoded path commands | 169,499 | 6 |
| Fill contours | 6,080 | 1 |
| Fill-boundary segments | 95,287 | 4 |
| Stroke segments | 8 | 0 |
| SVG bytes | 3,710,994 | 854 |
| Resolved nodes | 86 | 3 |

**Decision = A1-A.** The frame exceeded the former 65,536 aggregate raw-run
limit. The most fragmented shape instance had 12,655 runs, within its 16,384
cap. The frame passed the existing path-command, segment, SVG-byte, and
resolved-node budgets. The fix keeps aggregate raw runs in the composition
receipt and removes their independent rejection condition.

A-small is Scene frame 0 of the existing `buildMultiFrameGraphicFla()` fixture.
Its SVG was byte-identical before and after, with SHA-256
`9086e4ffea38ef5c521df05ebc0e2f4c6d26d2c1819c4edbaa9edef006b63397`.
The composer regression also renders 65,600 raw runs into eight fill paths.

The compiled fix ran on Windows Electron 43.1.1 using production FLA inspection,
SVG composition, and sandboxed snapshot rasterization. A-real produced a
1,920 × 1,080 PNG of 962,528 bytes with 461,798 nontransparent pixels.
The private PNG and full JSON receipt are in the local acceptance directory.
OWNER UAT: PASS. The owner reviewed the A-real PNG and confirmed that the
structure was recognizable with no large missing regions.
