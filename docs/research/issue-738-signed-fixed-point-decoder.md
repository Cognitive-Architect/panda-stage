# Issue #738 — XFL Signed Fixed-Point Decoder Closeout

- Date: 2026-10-08
- Base HEAD: `63f7c23a065c77a21a4da3316323dbbbee69186a`
- Branch: `issue-676-p0-c01-display-list-resolver`
- Delivery: existing PR #677; it remains Draft/Open.

## Production change

All three production decoders now compute a signed integer component plus an unsigned fractional magnitude, then apply the existing twips-to-pixels scale:

- [Main static snapshot decoder](../../src/main/services/fla-static-snapshot-svg-builder.ts)
- [Renderer Edge decoder](../../src/renderer/fla-import/parser-core/edge-decoder.ts)
- MorphShape coordinate decoding in [FLAParser](../../src/renderer/fla-import/parser-core/fla-parser.ts)

The patch changes no edge grouping, fill ownership, contour reconstruction, path assembly, endpoint tolerance, snapping, or connector geometry. No source FLA was modified.

## Regression coverage

The tests exercise the Main static SVG builder, the public `decodeEdgesWithStyleChanges` seam, and the public `FLAParser.parse()` result for MorphShape coordinates. The same matrix is asserted across all three paths.

| XFL coordinate | Expected twips | Expected pixels |
| --- | ---: | ---: |
| `#000001.F0` | `1.9375` | `0.096875` |
| `#FFF086.FB` | `-3961.01953125` | `-198.0509765625` |
| `#000000.F0` | `0.9375` | `0.046875` |
| `#000001` | `1` | `0.05` |
| `#FFF086` | `-3962` | `-198.1` |

Coverage lives in [the Main static renderer tests](../../tests/unit/fla-static-snapshot-edge-command-semantics.test.ts) and [the cross-path signed fixed-point tests](../../tests/unit/fla-xfl-signed-fixed-point.test.ts).

## Validation

- Targeted regression run: 2 test files, 21 tests passed.
- `pnpm test:unit`: 343 test files, 2,446 tests passed.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build`: passed.
- `git diff --check`: passed.

The build emitted existing warnings for empty legacy CSS imports and a renderer chunk above 500 kB; the build completed successfully.

## Bounded real-fixture impact

Evidence is under `D:\PandaStage-Acceptance\issue738-signed-fixed-point-20261008-run01`. The Black target was rerun with the existing [Issue #736 selected-Shape probe](../../scripts/research/issue736-xfl-panda-oracle.cjs). Alchemy and the three V0 character sources were rerun with the existing [Issue #734 static fixture probe](../../scripts/research/issue734-character-static-probe.cjs). Each probe verified its source hash; hashes were also rechecked after all runs.

| Fixture | Source SHA-256 | Current result |
| --- | --- | --- |
| `黑衣修仙男.fla` | `A328A163DD212F0369E27B30E5078178FD42744954203FDAD6A9CD06F3B171FA` | Selected Shape renders. The token control point moved from `-198.1490234375 px` to `-198.0509765625 px` (`+0.098046875 px`); the Scene SVG hash changed from `F78FF2AF1894F595A5D3BA5844B9E9603D3E515BCBA4E89713F7D7EB41A4AFFF` to `0DCE6AFE94B6BD2E85C0838904E3D61571E53916600F5B94BA7FC5C40EF11D88`. Its target fill still has 98 boundary segments, 98 balanced endpoints, and 3 cycles. |
| `炼丹房.fla` | `3ED47C25685ECE18AFE50E646996DE9C39AB22B29DCDE96A81FAB291368209D2` | Scene and root Graphic both render (2/2 candidates). No pre-fix render receipt was available for a causal before/after claim. The recovery normalization was in-memory only; the source hash remained unchanged. |
| `汉服修仙女.fla` | `6AF14990029D4CED2C4E305721321835180C1BF041178A8799E1D14A1F62E535` | Scene blocked on an open fill; 0/15 candidates render. |
| `青绫修仙女（四视角）.fla` | `D0958D4432DECBF6C54566BA15A2F5E97BD88C82D75DCB2F84603E9B2273F0E4` | Scene blocked on an open fill; 0/49 candidates render. |
| `修仙男.fla` | `565C5609A7610EF64ED9F98B09D98DD82D5A45255ADB4D3D410A5A365E0EF4A5` | Scene blocked on an open fill; 1/25 candidate renders, the previously identified frame-5 head/hair fragment. No complete character was recovered. |

Probe receipts in the evidence directory are `black-selected-shape.json` and each fixture folder's `static-truth-probe.json`.

The corrected coordinate changes the selected Black Shape geometry, but its boundary topology is unchanged. The historical #693 99-segment/two-imbalanced-vertex diagnostic did not reproduce: the current selected Shape has 98 boundary segments and three balanced cycles. This patch does not explain that historical diagnostic, and the three V0 open-fill blockers remain unresolved. No broader fill repair is claimed.

The Issue #734 probe receipts retain their frozen `baseline` field (`93fe7fa…`); that field names the Issue #734 baseline, not the code executed here. The production build and probes ran from the worktree based on the Base HEAD above, with the Issue #738 changes in this receipt applied.

## Animate 2023 inspection

`D:\AN2023\Adobe Animate 2023\Animate.exe` is present as version `23.0.0.407` and was already running. Windows reports Authenticode status `HashMismatch` for that executable. It was not launched, controlled, or used for a new oracle capture. The comparison continues to rely on the existing #737 JSFL receipt; the local Animate installation's vendor integrity remains unverified.

## Disposition

The signed fixed-point decoding defect is corrected across all production paths and covered by regression tests. The Black selected Shape shows the expected sub-pixel geometry change, while the prior #693 topology diagnosis and the three V0 open-fill blockers remain separate unresolved issues.
